import { Prisma } from '@prisma/client';
import { toDecimal, toMoneyString } from '@hotelos/core';
import { JOURNAL_SOURCE_LABELS, fromCents, toCents } from '@hotelos/hotel-contracts';
import { NotFoundError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { counterWeights } from './completers.js';
import { aggregateLines, convertAtRate, diffByAccount, effectiveJournalDate, groupRecords, journalSourceKeyOf, netDebitOf, payrollLiabilityKeyOf, splitCounter } from './rules.js';
import { JournalError, dateOnly, day, dotted, ensureChart, ensureTreasuryGlAccount, ledgerContext, loadRuleBook, money, prisma, resolveRule, writeJournal } from './shared.js';

/**
 * Otomatik fiş motoru (modül 48).
 *
 * - `journalizeSource(hotelId, sourceId)`: kaynağın (ödeme, fiş, mal kabul, bordro, çek…) **fişlenmemiş** ön muhasebe
 *   kayıtlarını (cari + kasa / banka) kilitler, belgeye göre gruplar ve her grubu bir yevmiye fişine çevirir: kasa /
 *   banka hareketi kasa hesabına (artı borç, eksi alacak), cari hareketi türünün kontrol hesabına, kalan fark
 *   tamamlayıcının ağırlıklarıyla karşı hesaplara. Kayıtların `journalEntryId`'si dolar: aynı kayıt ikinci kez
 *   fişlenmez; aynı anda iki çağrı sıralanır (FOR UPDATE), ikincisi fişlenecek kayıt bulmaz.
 * - `journalizeDay(hotelId, day)`: günün gelir fişi — folyo kalemleri (hizmet günü), kapanan adisyonlar ve spa
 *   randevuları; hedef ile daha önce yazılanın **farkı** yazılır (yeniden çalıştırma düzeltir, iki kez yazmaz).
 * - `syncJournals(hotelId, {from, to})`: dönemde fişlenmemiş kayıtların kaynakları ve kapanmış günler.
 *
 * Her fiş kendi işleminde; iş kuralı hatası (`JournalError`, 409) yeniden denemekle düzelmez — aktör manuel göreve
 * düşürür, muhasebeci kuralı / hesabı düzeltir ve Eşitle çalıştırır.
 */

const LEDGER_RECORD_SQL = (hotelId, sourceId) => Prisma.sql`
  SELECT e."id", e."accountId", e."date", e."debit"::text AS "debit", e."credit"::text AS "credit", e."description", e."sourceType"::text AS "sourceType",
         e."sourceId", e."sourceKey", a."type"::text AS "accountType", a."name" AS "accountName"
  FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId"
  WHERE e."hotelId" = ${hotelId} AND e."sourceId" = ${sourceId} AND e."journalEntryId" IS NULL
  ORDER BY e."id" FOR UPDATE OF e`;

const TREASURY_RECORD_SQL = (hotelId, sourceId) => Prisma.sql`
  SELECT m."id", m."treasuryAccountId", m."date", m."amount"::text AS "amount", m."description", m."sourceType"::text AS "sourceType", m."sourceId", m."sourceKey",
         m."originalAmount"::text AS "originalAmount", m."originalCurrency", m."exchangeRate"::text AS "exchangeRate", m."ledgerAccountId",
         t."kind"::text AS "kind", t."name" AS "treasuryName", t."currency" AS "currency"
  FROM "TreasuryMovement" m JOIN "TreasuryAccount" t ON t."id" = m."treasuryAccountId"
  WHERE m."hotelId" = ${hotelId} AND m."sourceId" = ${sourceId} AND m."journalEntryId" IS NULL
  ORDER BY m."id" FOR UPDATE OF m`;

/**
 * Kaynağın fişlenmemiş kayıtlarını fişler.
 * @param {string} hotelId @param {string} sourceId
 * @returns {Promise<{ posted: boolean, skipped?: string, message: string | null, journalIds: string[] }>}
 */
export async function journalizeSource(hotelId, sourceId) {
  await ensureChart(hotelId);
  const context = await ledgerContext(hotelId);
  return writeWithEvents(async (tx, stage) => {
    const [ledgerRows, treasuryRows] = [await tx.$queryRaw(LEDGER_RECORD_SQL(hotelId, sourceId)), await tx.$queryRaw(TREASURY_RECORD_SQL(hotelId, sourceId))];
    const records = [
      .../** @type {any[]} */ (ledgerRows).map((row) => ({ ...row, kind: 'LEDGER', date: day(row.date) })),
      .../** @type {any[]} */ (treasuryRows).map((row) => ({ ...row, kind: 'TREASURY', date: day(row.date) })),
    ];
    if (records.length === 0) return { posted: false, skipped: 'Fişlenecek hareket yok', message: null, journalIds: [] };
    const book = await loadRuleBook(tx, hotelId);
    const journalIds = [];
    const messages = [];
    for (const group of groupRecords(records)) {
      const written = await journalizeGroup(tx, { hotelId, context, book, group });
      journalIds.push(written.id);
      messages.push(written.message);
    }
    await stage('ledger.changed', { hotelId, change: 'JOURNAL', journalIds: journalIds.slice(0, 50) });
    return { posted: true, message: messages.join('; '), journalIds };
  });
}

/**
 * Tek belgenin fişi.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ hotelId: string, context: Awaited<ReturnType<typeof ledgerContext>>, book: Awaited<ReturnType<typeof loadRuleBook>>, group: ReturnType<typeof groupRecords>[number] }} input
 */
async function journalizeGroup(tx, { hotelId, context, book, group }) {
  const parts = [];
  let hasFx = false;
  for (const record of group.records) {
    if (record.kind === 'LEDGER') {
      const account = ledgerControlAccount(book, record);
      parts.push({
        accountId: account.id,
        code: account.code,
        amount: toCents(record.debit) - toCents(record.credit),
        ledgerAccountId: record.accountId,
        description: record.description,
      });
    } else {
      const account = await treasuryGlAccount(tx, hotelId, book, record);
      if (record.currency !== context.currency) hasFx = true;
      const value = await hotelCurrencyValue(tx, hotelId, context, record);
      parts.push({ accountId: account.id, code: account.code, amount: toCents(value), treasuryAccountId: record.treasuryAccountId, description: record.description });
    }
  }
  const net = netDebitOf(parts);
  const weights = await counterWeights(tx, hotelId, group);
  if (weights.length && net !== 0n) {
    const split = splitCounter(-net, weights.map((weight, index) => ({ key: String(index), weight: weight.weight })));
    for (const share of split) {
      const weight = weights[Number(share.key)];
      const account = weight.accountId ? await directAccount(tx, hotelId, weight.accountId) : resolveRule(book, weight.source, weight.key);
      parts.push({ accountId: account.id, code: account.code, amount: share.amount, description: weight.description ?? null });
    }
  }
  const residual = netDebitOf(parts);
  if (residual !== 0n && !hasFx) {
    // Otel parasındaki bir belgede kalan fark olamaz (tamamlayıcı kuruşa kadar böler): ön muhasebe kaydı tutarsız.
    throw new JournalError(`${group.key}: kayıtlar ${fromCents(residual)} tutarında dengesiz; ön muhasebe kayıtlarını kontrol edin`, 'JOURNAL_UNBALANCED_SOURCE');
  }
  if (residual !== 0n) {
    const account = resolveRule(book, residual > 0n ? 'FX_GAIN' : 'FX_LOSS');
    parts.push({ accountId: account.id, code: account.code, amount: -residual, description: 'Kur / yuvarlama farkı' });
  }
  const lines = aggregateLines(parts);
  if (lines.length < 2) throw new JournalError(`${group.key}: fiş tek satıra indi (kaynak kayıtlar birbirini götürüyor); elle fiş gerekir`, 'JOURNAL_DEGENERATE');
  const when = effectiveJournalDate(group.date, context.lockedThrough);
  const label = JOURNAL_SOURCE_LABELS[group.sourceType] ?? group.sourceType;
  const first = group.records[0].description ?? '';
  const description = `${label}${group.reversal ? ' — ters kayıt' : ''} · ${first}${when.deferred ? ` (kilitli dönem ${dotted(group.date)}, ${dotted(when.date)} gününe yazıldı)` : ''}`.slice(0, 300);
  const entry = await writeJournal(tx, { hotelId, type: 'AUTO', source: group.sourceType, sourceId: group.sourceId, sourceKey: journalSourceKeyOf(group), date: when.date, description, lines, createdBy: 'accounting-worker' });
  const ledgerIds = group.records.filter((record) => record.kind === 'LEDGER').map((record) => record.id);
  const treasuryIds = group.records.filter((record) => record.kind === 'TREASURY').map((record) => record.id);
  if (ledgerIds.length) await tx.ledgerEntry.updateMany({ where: { id: { in: ledgerIds }, hotelId }, data: { journalEntryId: entry.id } });
  if (treasuryIds.length) await tx.treasuryMovement.updateMany({ where: { id: { in: treasuryIds }, hotelId }, data: { journalEntryId: entry.id } });
  return { id: entry.id, message: `${entry.number} (${label}, ${lines.length} satır, ${entry.total} ${context.currency})` };
}

/**
 * Cari hareketinin kontrol hesabı: carinin kendi kuralı → LEDGER_ACCOUNT; bordro yükümlülük carisi (SGK / vergi / BES /
 * icra: anahtardan ya da bordro ayarındaki cari kimliğinden) → PAYROLL_LIABILITY; türü → LEDGER_TYPE. Böylece SGK'ya
 * yapılan ödeme fişi de tahakkukla aynı hesabı (361) kapatır.
 */
function ledgerControlAccount(book, record) {
  if (book.byKey.has(`LEDGER_ACCOUNT|${record.accountId}`)) return resolveRule(book, 'LEDGER_ACCOUNT', record.accountId);
  const liability = payrollLiabilityKeyOf(record.sourceKey) ?? book.payrollAccounts.get(record.accountId) ?? null;
  if (liability) return resolveRule(book, 'PAYROLL_LIABILITY', liability);
  return resolveRule(book, 'LEDGER_TYPE', record.accountType);
}

/** Kasa / banka hesabının yevmiye hesabı (kural yoksa açılır ve kural defterine eklenir). */
async function treasuryGlAccount(tx, hotelId, book, record) {
  const key = `TREASURY|${record.treasuryAccountId}`;
  const known = book.byKey.get(key);
  if (known) {
    if (!known.isActive || !known.isPostable) return resolveRule(book, 'TREASURY', record.treasuryAccountId);
    return known;
  }
  const account = await ensureTreasuryGlAccount(tx, hotelId, { id: record.treasuryAccountId, kind: record.kind, name: record.treasuryName, currency: record.currency });
  const full = { ...account, isPostable: true, isActive: true };
  book.byKey.set(key, full);
  return full;
}

/** Fişte doğrudan seçilen hesap (kasa / banka giriş-çıkış fişinin karşı hesabı). */
async function directAccount(tx, hotelId, accountId) {
  const account = await tx.glAccount.findFirst({ where: { id: accountId, hotelId }, select: { id: true, code: true, name: true, isPostable: true, isActive: true } });
  if (!account) throw new NotFoundError('Fişte seçilen hesap bulunamadı');
  if (!account.isActive || !account.isPostable) throw new JournalError(`${account.code} ${account.name} satır alamaz (pasif ya da ana hesap)`, 'JOURNAL_ACCOUNT_NOT_POSTABLE');
  return account;
}

/**
 * Kasa / banka hareketinin otel parasıyla değeri: hesap otel parasındaysa tutar; dövizli hesapta ön büro ödemesinin
 * folyo karşılığı (kesin), yoksa hareket gününün (ya da öncesindeki son) kuru; kur yoksa iş hatası.
 */
async function hotelCurrencyValue(tx, hotelId, context, record) {
  if (record.currency === context.currency) return record.amount;
  if (record.sourceType === 'FOLIO_PAYMENT') {
    const payment = await tx.payment.findFirst({ where: { id: record.sourceId, hotelId }, select: { folioAmount: true } });
    if (payment) {
      const value = toDecimal(String(payment.folioAmount)).abs();
      return toMoneyString(toDecimal(record.amount).isNegative() ? value.negated() : value);
    }
  }
  const rate = await tx.exchangeRate.findFirst({ where: { hotelId, currency: record.currency, date: { lte: dateOnly(record.date) } }, orderBy: { date: 'desc' }, select: { rate: true } });
  if (!rate) throw new JournalError(`${record.treasuryName} (${record.currency}) hareketi için ${dotted(record.date)} kuru yok: Kasa → Kurlar ekranından girin`, 'EXCHANGE_RATE_MISSING');
  return convertAtRate(record.amount, String(rate.rate));
}

/* ═══════════════ Günlük gelir fişi ═══════════════ */

/**
 * Günün gelir hedefi: hesap → işaretli kuruş (artı borç, eksi alacak) ve açıklama izi.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} dayText
 * @param {{ timezone: string }} context @param {Awaited<ReturnType<typeof loadRuleBook>>} book
 */
async function dailyRevenueTarget(tx, hotelId, dayText, context, book) {
  /** @type {Map<string, bigint>} */
  const target = new Map();
  /** @type {Map<string, string>} */
  const codes = new Map();
  const add = (account, cents) => {
    if (cents === 0n) return;
    target.set(account.id, (target.get(account.id) ?? 0n) + cents);
    codes.set(account.id, account.code);
  };
  let guest = 0n;

  // Folyo kalemleri: tür bazında net gelir, vergi dökümü oran bazında.
  const items = /** @type {Array<{ type: string, net: string, total: string }>} */ (
    await tx.$queryRaw`
      SELECT i."type"::text AS "type", COALESCE(SUM(i."netAmount"), 0)::text AS "net", COALESCE(SUM(i."total"), 0)::text AS "total"
      FROM "FolioItem" i WHERE i."hotelId" = ${hotelId} AND i."serviceDate" = ${dayText}::date AND i."deletedAt" IS NULL
      GROUP BY i."type"`
  );
  for (const row of items) {
    add(resolveRule(book, 'REVENUE', row.type), -toCents(money(row.net)));
    guest += toCents(money(row.total));
  }
  const taxes = /** @type {Array<{ rate: string, amount: string }>} */ (
    await tx.$queryRaw`
      SELECT COALESCE(t->>'rate', '') AS "rate", COALESCE(SUM((t->>'amount')::numeric), 0)::text AS "amount"
      FROM "FolioItem" i CROSS JOIN LATERAL jsonb_array_elements(i."taxLines") t
      WHERE i."hotelId" = ${hotelId} AND i."serviceDate" = ${dayText}::date AND i."deletedAt" IS NULL
      GROUP BY t->>'rate'`
  );
  for (const row of taxes) add(resolveRule(book, 'VAT_OUTPUT', toDecimal(row.rate || '0').toString()), -toCents(money(row.amount)));

  // Kapanan adisyonlar: odaya yazılmayan pay (odaya yazılan folyo kaleminde zaten var), net / vergi oranıyla.
  const [pos] = /** @type {Array<{ net: string, tax: string, grand: string, room: string }>} */ (
    await tx.$queryRaw`
      SELECT COALESCE(SUM(c."netTotal"), 0)::text AS "net", COALESCE(SUM(c."taxTotal"), 0)::text AS "tax",
             COALESCE(SUM(c."grandTotal"), 0)::text AS "grand", COALESCE(SUM(c."roomChargeTotal"), 0)::text AS "room"
      FROM "PosCheck" c WHERE c."hotelId" = ${hotelId} AND c."status" = 'CLOSED' AND c."businessDate" = ${dayText}::date`
  );
  const posShare = toCents(money(pos.grand)) - toCents(money(pos.room));
  if (posShare !== 0n) {
    const parts = splitCounter(posShare, [{ key: 'net', weight: money(toDecimal(pos.net).abs()) }, { key: 'tax', weight: money(toDecimal(pos.tax).abs()) }]);
    for (const part of parts) add(resolveRule(book, part.key === 'net' ? 'REVENUE' : 'VAT_OUTPUT', part.key === 'net' ? 'POS' : ''), -part.amount);
    guest += posShare;
  }

  // Spa: gününde tamamlanan ya da bedeli kesinleşen randevuların spa kasasında ödenen payı (odaya yazılan folyoda).
  const [spa] = /** @type {Array<{ net: string, total: string, room: string }>} */ (
    await tx.$queryRaw`
      SELECT COALESCE(SUM(a."amountDue"), 0)::text AS "net", COALESCE(SUM(a."totalDue"), 0)::text AS "total", COALESCE(SUM(a."roomChargeTotal"), 0)::text AS "room"
      FROM "SpaAppointment" a
      WHERE a."hotelId" = ${hotelId} AND a."totalDue" > 0 AND a."status" IN ('COMPLETED', 'NO_SHOW', 'CANCELLED')
        AND (((CASE WHEN a."status" = 'COMPLETED' THEN a."startsAt" ELSE COALESCE(a."cancelledAt", a."startsAt") END) AT TIME ZONE 'UTC') AT TIME ZONE ${context.timezone})::date = ${dayText}::date`
  );
  const spaShare = toCents(money(spa.total)) - toCents(money(spa.room));
  if (spaShare !== 0n) {
    const tax = toDecimal(spa.total).minus(spa.net);
    const parts = splitCounter(spaShare, [{ key: 'net', weight: money(toDecimal(spa.net).abs()) }, { key: 'tax', weight: money(tax.abs()) }]);
    for (const part of parts) add(resolveRule(book, part.key === 'net' ? 'REVENUE' : 'VAT_OUTPUT', part.key === 'net' ? 'SPA' : ''), -part.amount);
    guest += spaShare;
  }
  if (guest !== 0n) add(resolveRule(book, 'GUEST_LEDGER'), guest);
  return { target, codes };
}

/**
 * Günün daha önce yazılmış gelir fişlerinin hesap toplamı (iptal edilen fişin ters kaydı da sayılır).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} dayText
 */
async function dailyRevenuePosted(tx, hotelId, dayText) {
  const rows = /** @type {Array<{ accountId: string, code: string, amount: string, count: number }>} */ (
    await tx.$queryRaw`
      SELECT l."accountId", a."code", COALESCE(SUM(l."debit" - l."credit"), 0)::text AS "amount", 0 AS "count"
      FROM "JournalLine" l JOIN "JournalEntry" j ON j."id" = l."entryId" JOIN "GlAccount" a ON a."id" = l."accountId"
      LEFT JOIN "JournalEntry" o ON o."id" = j."reversalOfId"
      WHERE j."hotelId" = ${hotelId}
        AND ((j."source" = 'DAILY_REVENUE' AND j."sourceId" = ${dayText}) OR (o."source" = 'DAILY_REVENUE' AND o."sourceId" = ${dayText}))
      GROUP BY l."accountId", a."code"`
  );
  const [{ count }] = /** @type {Array<{ count: number }>} */ (await tx.$queryRaw`SELECT count(*)::int AS "count" FROM "JournalEntry" WHERE "hotelId" = ${hotelId} AND "source" = 'DAILY_REVENUE' AND "sourceId" = ${dayText}`);
  return { existing: new Map(rows.map((row) => [row.accountId, toCents(money(row.amount))])), codes: new Map(rows.map((row) => [row.accountId, row.code])), count };
}

/**
 * Günün gelir fişi (fark yazımı).
 * @param {string} hotelId @param {string} dayText "YYYY-AA-GG"
 * @returns {Promise<{ posted: boolean, skipped?: string, message: string | null, journalIds: string[] }>}
 */
export async function journalizeDay(hotelId, dayText) {
  await ensureChart(hotelId);
  const context = await ledgerContext(hotelId);
  if (dayText < context.startDate) return { posted: false, skipped: `${dotted(dayText)}: muhasebe başlangıcından önce`, message: null, journalIds: [] };
  return writeWithEvents(async (tx, stage) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ledger-day:${hotelId}:${dayText}`}))`;
    const book = await loadRuleBook(tx, hotelId);
    const { target, codes } = await dailyRevenueTarget(tx, hotelId, dayText, context, book);
    const posted = await dailyRevenuePosted(tx, hotelId, dayText);
    const diff = diffByAccount(target, posted.existing);
    if (diff.size === 0) return { posted: false, skipped: `${dotted(dayText)}: gelir fişi güncel`, message: null, journalIds: [] };
    const lines = aggregateLines([...diff].map(([accountId, amount]) => ({ accountId, code: codes.get(accountId) ?? posted.codes.get(accountId) ?? '', amount })));
    if (lines.length < 2) throw new JournalError(`${dotted(dayText)}: gelir fişi dengesiz (tek hesap)`, 'JOURNAL_DEGENERATE');
    const when = effectiveJournalDate(dayText, context.lockedThrough);
    const correction = posted.count > 0;
    const description = `Günlük gelir fişi ${dotted(dayText)}${correction ? ' (düzeltme)' : ''}${when.deferred ? ` — kilitli dönem, ${dotted(when.date)} gününe yazıldı` : ''}`;
    const entry = await writeJournal(tx, { hotelId, type: 'AUTO', source: 'DAILY_REVENUE', sourceId: dayText, sourceKey: `DAILY_REVENUE:${dayText}#${posted.count + 1}`, date: when.date, description, lines, createdBy: 'accounting-worker' });
    await stage('ledger.changed', { hotelId, change: 'JOURNAL', journalIds: [entry.id] });
    return { posted: true, message: `${entry.number}: ${dotted(dayText)} gelir fişi${correction ? ' düzeltildi' : ''} (${lines.length} satır, ${entry.total} ${context.currency})`, journalIds: [entry.id] };
  });
}

/* ═══════════════ Dönem eşitlemesi ═══════════════ */

const SYNC_ERROR_DETAIL = 25;
const SYNC_BATCH = 2000;
const SYNC_TIME_BUDGET_MS = 20_000;

/**
 * Dönemde fişlenmemiş hareketlerin kaynaklarını ve kapanmış günleri fişler; süre sınırına takılan kalanı sayar.
 * @param {string} hotelId @param {{ from: string, to: string }} period @param {{ budgetMs?: number }} [options]
 */
export async function syncJournals(hotelId, { from, to }, { budgetMs = SYNC_TIME_BUDGET_MS } = {}) {
  const deadline = Date.now() + budgetMs;
  await ensureChart(hotelId);
  const context = await ledgerContext(hotelId);
  const start = from < context.startDate ? context.startDate : from;
  const report = { from: start, to, posted: 0, skipped: 0, failed: 0, remaining: 0, errors: /** @type {Array<{ source: string, id: string, message: string, count: number }>} */ ([]) };
  if (start > to) return report;
  const sources = /** @type {Array<{ sourceId: string }>} */ (
    await prisma.$queryRaw`
      SELECT DISTINCT "sourceId" FROM (
        SELECT e."sourceId", MIN(e."date") AS "d" FROM "LedgerEntry" e WHERE e."hotelId" = ${hotelId} AND e."journalEntryId" IS NULL AND e."date" BETWEEN ${start}::date AND ${to}::date GROUP BY e."sourceId"
        UNION ALL
        SELECT m."sourceId", MIN(m."date") FROM "TreasuryMovement" m WHERE m."hotelId" = ${hotelId} AND m."journalEntryId" IS NULL AND m."date" BETWEEN ${start}::date AND ${to}::date GROUP BY m."sourceId"
      ) s ORDER BY "sourceId" LIMIT ${SYNC_BATCH + 1}`
  );
  const days = /** @type {Array<{ day: Date }>} */ (
    await prisma.$queryRaw`SELECT "date" AS "day" FROM "NightAudit" WHERE "hotelId" = ${hotelId} AND "status" = 'CLOSED' AND "deletedAt" IS NULL AND "date" BETWEEN ${start}::date AND ${to}::date ORDER BY "date"`
  );
  const work = [
    ...sources.slice(0, SYNC_BATCH).map((row) => ({ source: 'RECORDS', id: row.sourceId, run: () => journalizeSource(hotelId, row.sourceId) })),
    ...days.map((row) => ({ source: 'DAILY_REVENUE', id: day(row.day) ?? '', run: () => journalizeDay(hotelId, /** @type {string} */ (day(row.day))) })),
  ];
  let attempted = 0;
  for (const item of work) {
    if (Date.now() >= deadline) break;
    attempted += 1;
    try {
      const result = await item.run();
      if (result.posted) report.posted += 1;
      else report.skipped += 1;
    } catch (error) {
      report.failed += 1;
      const message = /** @type {Error} */ (error).message;
      const known = report.errors.find((row) => row.source === item.source && row.message === message);
      if (known) known.count += 1;
      else if (report.errors.length < SYNC_ERROR_DETAIL) report.errors.push({ source: item.source, id: item.id, message, count: 1 });
    }
  }
  report.remaining = work.length - attempted + Math.max(0, sources.length - SYNC_BATCH);
  return report;
}

/** Fişlenmemiş hareket sayıları (ayar ve mizan ekranı uyarısı). @param {string} hotelId @param {string} startDate */
export async function unpostedCounts(hotelId, startDate) {
  const [ledgerEntries, treasuryMovements] = await Promise.all([
    prisma.ledgerEntry.count({ where: { hotelId, journalEntryId: null, date: { gte: dateOnly(startDate) } } }),
    prisma.treasuryMovement.count({ where: { hotelId, journalEntryId: null, date: { gte: dateOnly(startDate) } } }),
  ]);
  return { ledgerEntries, treasuryMovements };
}

export { fromCents };
