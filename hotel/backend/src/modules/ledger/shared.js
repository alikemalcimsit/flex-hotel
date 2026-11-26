import { randomUUID } from 'node:crypto';
import { currentActor, toIsoDay } from '@hotelos/core';
import { DEFAULT_JOURNAL_RULES, JOURNAL_NUMBER_PREFIX, compareGlCodes, fromCents, glClassOfCode, glDepthOf, parentCodeOf, toCents } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { ensureSettings, hotelContext, nextVoucherNumber } from '../accounting/shared.js';
import { ACCOUNT_DEPARTMENTS, HOTEL_SUB_ACCOUNTS, TEK_DUZEN_ACCOUNTS, TEK_DUZEN_GROUPS, TREASURY_PARENT_CODES } from './chart-of-accounts.js';

/**
 * Genel muhasebenin ortak parçaları (modül 48): hesap planının yüklenmesi, kural çözümü, fiş yazıcı, kasa / banka
 * alt hesabı, ayar okuma. Fiş yazıcı her zaman çağıranın işlemi içinde çalışır; borç = alacak denetimi burada
 * (son savunma — şema ve motor da denetler).
 */

export { prisma };

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
export const day = (value) => (value ? toIsoDay(value) : null);
/** @param {string} text */
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);
/** @param {unknown} value */
export const money = (value) => fromCents(toCents(String(value ?? 0)));
/** "2026-10-30" → "30.10.2026" @param {string} text */
export const dotted = (text) => text.split('-').reverse().join('.');

/** İş kuralı hatası (yeniden denemekle düzelmez): aktör manuel göreve düşürür. */
export class JournalError extends AppError {
  constructor(message, code = 'LEDGER_POSTING') {
    super(message, { statusCode: 409, code });
  }
}

/* ─────────────── Ayar ve bağlam ─────────────── */

/**
 * Genel muhasebe bağlamı: otel (para birimi, saat dilimi, bugün), ön muhasebe başlangıç günü, dönem kilidi.
 * @param {string} hotelId
 */
export async function ledgerContext(hotelId) {
  const context = await hotelContext(hotelId);
  const accounting = await ensureSettings(hotelId, context.today);
  const row = await prisma.accountingSettings.findUnique({ where: { hotelId }, select: { glLockedThrough: true, glChartSeededAt: true, updatedAt: true } });
  return {
    today: context.today,
    currency: context.currency,
    timezone: context.timezone,
    startDate: accounting.startDate,
    lockedThrough: day(row?.glLockedThrough),
    chartSeededAt: iso(row?.glChartSeededAt),
    updatedAt: iso(row?.updatedAt),
  };
}

/* ─────────────── Hesap planı ─────────────── */

/**
 * Hesap planı yüklü mü; değilse Tek Düzen + otel alt hesapları + varsayılan kurallar + kasa / banka alt hesapları
 * yüklenir. İdempotent: var olan kod atlanır, var olan kural ezilmez. İlk genel muhasebe kullanımında (ekran,
 * otomatik fiş) bir kez; "Tek Düzen'i tamamla" düğmesi `force` ile eksikleri tamamlar.
 *
 * @param {string} hotelId @param {{ force?: boolean }} [options]
 * @returns {Promise<{ created: number, rules: number, seeded: boolean }>}
 */
export async function ensureChart(hotelId, { force = false } = {}) {
  const context = await hotelContext(hotelId);
  await ensureSettings(hotelId, context.today);
  const settings = await prisma.accountingSettings.findUnique({ where: { hotelId }, select: { glChartSeededAt: true } });
  if (settings?.glChartSeededAt && !force) return { created: 0, rules: 0, seeded: false };
  const actor = currentActor();
  return prisma.$transaction(
    async (tx) => {
      // Aynı otel için iki eşzamanlı yükleme sıralansın (kod tekil; ikinci bir şey yazmaz ama çakışmayla düşmesin).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ledger-chart:${hotelId}`}))`;
      let created = 0;
      /** @type {Map<string, string>} kod → kimlik */
      const ids = new Map((await tx.glAccount.findMany({ where: { hotelId }, select: { id: true, code: true } })).map((row) => [row.code, row.id]));
      const insert = async (rows) => {
        const missing = rows.filter((row) => !ids.has(row.code));
        if (missing.length === 0) return;
        const data = missing.map((row) => {
          const id = randomUUID();
          ids.set(row.code, id);
          const parentCode = parentCodeOf(row.code);
          return {
            id,
            hotelId,
            code: row.code,
            name: row.name,
            parentId: parentCode ? (ids.get(parentCode) ?? null) : null,
            depth: glDepthOf(row.code),
            class: glClassOfCode(row.code),
            department: row.department ?? null,
            isPostable: row.postable,
            isSystem: true,
            createdBy: actor,
          };
        });
        await tx.glAccount.createMany({ data, skipDuplicates: true });
        created += data.length;
      };
      await insert(TEK_DUZEN_GROUPS.filter(([code]) => code.length === 1).map(([code, name]) => ({ code, name, postable: false })));
      await insert(TEK_DUZEN_GROUPS.filter(([code]) => code.length === 2).map(([code, name]) => ({ code, name, postable: false })));
      const subParents = new Set(HOTEL_SUB_ACCOUNTS.map((row) => parentCodeOf(row.code)));
      subParents.add(TREASURY_PARENT_CODES.CASH).add(TREASURY_PARENT_CODES.BANK);
      await insert(TEK_DUZEN_ACCOUNTS.map(([code, name]) => ({ code, name, postable: !subParents.has(code), department: ACCOUNT_DEPARTMENTS[code] ?? null })));
      await insert(HOTEL_SUB_ACCOUNTS.map((row) => ({ ...row, postable: true })));
      // Alt hesabı olan ana hesaplar satır almaz (sonradan açılan alt hesaplar için de).
      await tx.$executeRaw`
        UPDATE "GlAccount" a SET "isPostable" = false
        WHERE a."hotelId" = ${hotelId} AND a."isPostable" = true AND EXISTS (SELECT 1 FROM "GlAccount" c WHERE c."parentId" = a."id")`;
      // Varsayılan kurallar tabloya yazılmaz: kural defteri koddan (DEFAULT_JOURNAL_RULES) okur; otel yazdığı kuralla ezer,
      // sildiğinde varsayılana döner. Yalnız kasa / banka alt hesapları (hesaba özel) kural satırı alır.
      const missingDefaults = DEFAULT_JOURNAL_RULES.filter((rule) => !ids.has(rule.code)).length;
      if (missingDefaults) throw new JournalError('Varsayılan kuralların hesapları hesap planında yok', 'GL_CHART_MISSING');
      const ruleRows = [];
      // Kasa / banka alt hesapları.
      const treasuries = await tx.treasuryAccount.findMany({ where: { hotelId }, select: { id: true, kind: true, name: true, currency: true }, orderBy: { createdAt: 'asc' } });
      for (const treasury of treasuries) await ensureTreasuryGlAccount(tx, hotelId, treasury);
      await tx.accountingSettings.update({ where: { hotelId }, data: { glChartSeededAt: settings?.glChartSeededAt ?? new Date() } });
      return { created, rules: ruleRows.length, seeded: true };
    },
    { timeout: 30_000 },
  );
}

/**
 * Kasa / banka hesabının yevmiye hesabı: TREASURY kuralı yoksa 100 / 102 altında ilk boş alt kodla açılır ve kural
 * yazılır. Çağıranın işleminde; aynı hesap için iki eşzamanlı çağrı kural tekilliğine takılmaz (kural varsa okunur).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId
 * @param {{ id: string, kind: string, name: string, currency: string }} treasury
 * @returns {Promise<{ id: string, code: string, name: string }>}
 */
export async function ensureTreasuryGlAccount(tx, hotelId, treasury) {
  const rule = await tx.journalRule.findFirst({ where: { hotelId, source: 'TREASURY', key: treasury.id }, select: { account: { select: { id: true, code: true, name: true } } } });
  if (rule) return rule.account;
  const parentCode = TREASURY_PARENT_CODES[treasury.kind] ?? TREASURY_PARENT_CODES.CASH;
  const parent = await tx.glAccount.findFirst({ where: { hotelId, code: parentCode }, select: { id: true } });
  if (!parent) throw new JournalError(`Hesap planında ${parentCode} yok: Genel muhasebe → Ayarlar → Tek Düzen'i tamamla`, 'GL_CHART_MISSING');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ledger-treasury:${hotelId}:${parentCode}`}))`;
  // Kilitten sonra yeniden bak: eşzamanlı ikinci çağrı aynı kasa için ikinci alt hesap açmasın.
  const raced = await tx.journalRule.findFirst({ where: { hotelId, source: 'TREASURY', key: treasury.id }, select: { account: { select: { id: true, code: true, name: true } } } });
  if (raced) return raced.account;
  const siblings = await tx.glAccount.findMany({ where: { hotelId, parentId: parent.id }, select: { code: true } });
  const used = new Set(siblings.map((row) => row.code));
  let index = 1;
  while (used.has(`${parentCode}.${String(index).padStart(2, '0')}`)) index += 1;
  const code = `${parentCode}.${String(index).padStart(2, '0')}`;
  const name = `${treasury.name}${treasury.currency ? ` (${treasury.currency})` : ''}`.slice(0, 160);
  const account = await tx.glAccount.create({
    data: { hotelId, code, name, parentId: parent.id, depth: glDepthOf(code), class: glClassOfCode(code), isPostable: true, isSystem: true, createdBy: currentActor() },
    select: { id: true, code: true, name: true },
  });
  await tx.glAccount.updateMany({ where: { id: parent.id, isPostable: true }, data: { isPostable: false } });
  await tx.journalRule.upsert({
    where: { hotelId_source_key: { hotelId, source: 'TREASURY', key: treasury.id } },
    create: { hotelId, source: 'TREASURY', key: treasury.id, accountId: account.id, updatedBy: currentActor() },
    update: {},
  });
  return account;
}

/* ─────────────── Kurallar ─────────────── */

/**
 * @typedef {{ id: string, code: string, name: string, isPostable: boolean, isActive: boolean }} RuleAccount
 * @typedef {{ byKey: Map<string, RuleAccount>, byCode: Map<string, RuleAccount>, defaults: Map<string, string>, payrollAccounts: Map<string, string> }} RuleBook
 */

/**
 * Otelin kuralları + varsayılanlar (kodla). Fiş motoru belge başına değil, çağrı başına bir kez okur.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId
 * @returns {Promise<RuleBook>}
 */
export async function loadRuleBook(client, hotelId) {
  const [rules, accounts, payroll, garnishments] = await Promise.all([
    client.journalRule.findMany({ where: { hotelId }, select: { source: true, key: true, account: { select: { id: true, code: true, name: true, isPostable: true, isActive: true } } } }),
    client.glAccount.findMany({ where: { hotelId }, select: { id: true, code: true, name: true, isPostable: true, isActive: true } }),
    client.payrollSettings.findFirst({ where: { hotelId }, select: { sgkLedgerAccountId: true, taxLedgerAccountId: true, besLedgerAccountId: true } }),
    client.garnishment.findMany({ where: { hotelId, ledgerAccountId: { not: null } }, select: { ledgerAccountId: true } }),
  ]);
  // Bordro yükümlülük carileri (SGK / vergi / BES / icra): ödeme fişleri de tahakkuk hesabını kapatsın.
  const payrollAccounts = new Map();
  if (payroll?.sgkLedgerAccountId) payrollAccounts.set(payroll.sgkLedgerAccountId, 'SGK');
  if (payroll?.taxLedgerAccountId) payrollAccounts.set(payroll.taxLedgerAccountId, 'TAX');
  if (payroll?.besLedgerAccountId) payrollAccounts.set(payroll.besLedgerAccountId, 'BES');
  for (const row of garnishments) if (row.ledgerAccountId) payrollAccounts.set(row.ledgerAccountId, 'GARN');
  return {
    byKey: new Map(rules.map((rule) => [`${rule.source}|${rule.key}`, rule.account])),
    byCode: new Map(accounts.map((account) => [account.code, account])),
    defaults: new Map(DEFAULT_JOURNAL_RULES.map((rule) => [`${rule.source}|${rule.key}`, rule.code])),
    payrollAccounts,
  };
}

/**
 * (kaynak, anahtar) → hesap: otel kuralı (anahtarlı → boş anahtar), sonra varsayılan (anahtarlı → boş anahtar).
 * Hesap yaprak ve etkin olmalı; yoksa iş hatası (manuel görev: kuralı girin / hesabı açın).
 *
 * @param {RuleBook} book @param {string} source @param {string} [key]
 * @returns {RuleAccount}
 */
export function resolveRule(book, source, key = '') {
  const candidates = [book.byKey.get(`${source}|${key}`), key ? book.byKey.get(`${source}|`) : undefined];
  for (const code of [book.defaults.get(`${source}|${key}`), key ? book.defaults.get(`${source}|`) : undefined]) {
    if (code) candidates.push(book.byCode.get(code));
  }
  const account = candidates.find(Boolean);
  const label = key ? `${source} / ${key}` : source;
  if (!account) throw new JournalError(`"${label}" için hesap kuralı yok: Genel muhasebe → Kurallar`, 'JOURNAL_RULE_MISSING');
  if (!account.isActive) throw new JournalError(`${account.code} ${account.name} pasif; "${label}" kuralını etkin bir hesaba çevirin`, 'JOURNAL_ACCOUNT_INACTIVE');
  if (!account.isPostable) throw new JournalError(`${account.code} ${account.name} alt hesapları olan bir ana hesap; "${label}" kuralını bir alt hesaba çevirin`, 'JOURNAL_ACCOUNT_NOT_POSTABLE');
  return account;
}

/* ─────────────── Fiş yazıcı ─────────────── */

/**
 * Yevmiye fişini satırlarıyla yazar (çağıranın işleminde). Borç toplamı alacak toplamına eşit ve sıfırdan büyük
 * olmalı; satırların tek tarafı dolu olmalı. Kaynak anahtarı tekil (ikinci yazım kısıta takılır — çağıran yakalar).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{
 *   hotelId: string, type: 'AUTO' | 'MANUAL', source: string, sourceId?: string | null, sourceKey?: string | null, date: string,
 *   description: string, reference?: string | null, requestId?: string | null, reversalOfId?: string | null, createdBy?: string,
 *   lines: Array<{ accountId: string, debit: string, credit: string, description?: string | null, ledgerAccountId?: string | null, treasuryAccountId?: string | null }>,
 * }} input
 * @returns {Promise<{ id: string, number: string, total: string }>}
 */
export async function writeJournal(tx, input) {
  if (input.lines.length < 2) throw new ValidationError('Fişte en az iki satır olmalı');
  let debit = 0n;
  let credit = 0n;
  for (const line of input.lines) {
    const d = toCents(line.debit);
    const c = toCents(line.credit);
    if (d < 0n || c < 0n || (d === 0n) === (c === 0n)) throw new ValidationError('Fiş satırının borç ya da alacak tarafından yalnız biri dolu olmalı');
    debit += d;
    credit += c;
  }
  if (debit !== credit) throw new ValidationError(`Fiş dengesiz: borç ${fromCents(debit)}, alacak ${fromCents(credit)}`);
  if (debit === 0n) throw new ValidationError('Fiş toplamı sıfır olamaz');
  const number = await nextVoucherNumber(tx, input.hotelId, JOURNAL_NUMBER_PREFIX, input.date);
  const entry = await tx.journalEntry.create({
    data: {
      hotelId: input.hotelId,
      number,
      type: input.type,
      source: /** @type {any} */ (input.source),
      sourceId: input.sourceId ?? null,
      sourceKey: input.sourceKey ?? null,
      date: dateOnly(input.date),
      description: input.description.slice(0, 300),
      reference: input.reference?.slice(0, 60) ?? null,
      total: fromCents(debit),
      lineCount: input.lines.length,
      requestId: input.requestId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      createdBy: input.createdBy ?? currentActor(),
      lines: {
        create: input.lines.map((line, index) => ({
          hotelId: input.hotelId,
          sortOrder: index + 1,
          accountId: line.accountId,
          date: dateOnly(input.date),
          debit: money(line.debit),
          credit: money(line.credit),
          description: line.description?.slice(0, 300) ?? null,
          ledgerAccountId: line.ledgerAccountId ?? null,
          treasuryAccountId: line.treasuryAccountId ?? null,
        })),
      },
    },
    select: { id: true, number: true },
  });
  return { id: entry.id, number: entry.number, total: fromCents(debit) };
}

/**
 * Hesap kimliklerinin yaprak ve etkin olduğunu denetler (elle fiş).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId @param {string[]} accountIds
 * @returns {Promise<Map<string, RuleAccount>>}
 */
export async function assertPostableAccounts(client, hotelId, accountIds) {
  const unique = [...new Set(accountIds)];
  const rows = await client.glAccount.findMany({ where: { hotelId, id: { in: unique } }, select: { id: true, code: true, name: true, isPostable: true, isActive: true } });
  const map = new Map(rows.map((row) => [row.id, row]));
  for (const id of unique) {
    const account = map.get(id);
    if (!account) throw new NotFoundError('Hesap bulunamadı');
    if (!account.isActive) throw new ConflictError(`${account.code} ${account.name} pasif`, 'JOURNAL_ACCOUNT_INACTIVE');
    if (!account.isPostable) throw new ConflictError(`${account.code} ${account.name} alt hesapları olan bir ana hesap; alt hesabını seçin`, 'JOURNAL_ACCOUNT_NOT_POSTABLE');
  }
  return map;
}

/** Hesap listesi sırası: Tek Düzen kod sırası. @param {Array<{ code: string }>} rows */
export const sortByCode = (rows) => [...rows].sort((a, b) => compareGlCodes(a.code, b.code));
