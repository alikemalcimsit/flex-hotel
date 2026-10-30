import { Prisma } from '@prisma/client';
import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import { AGING_BUCKETS, LEDGER_ACCOUNT_CODE_PREFIXES, MAX_ACCOUNT_PICKER_RESULTS, ageBalance } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import {
  accountCode,
  cursorTime,
  day,
  decodeStatementCursor,
  encodeStatementCursor,
  ensurePartnerAccount,
  ensureSettings,
  hotelContext,
  iso,
  money,
  nextSequence,
  prisma,
} from './shared.js';

/**
 * Cari hesaplar (modül 47): liste, seçici, kart (bakiye + yaşlandırma), ekstre (devir + yürüyen bakiye),
 * yaşlandırma raporu; elle cari açma / düzenleme ve bağlı kart için cari açma.
 *
 * Bağlı (acente / tedarikçi / etkinlik müşterisi) carinin ünvan, vergi ve iletişim bilgisi o karttan gelir ve
 * kart değişince eşitlenir (`subscribers.js`); muhasebe yalnız vadeyi, notu ve kullanımını değiştirir.
 */

const ACCOUNT_SELECT = Object.freeze({
  id: true,
  code: true,
  name: true,
  type: true,
  agencyId: true,
  supplierId: true,
  eventClientId: true,
  taxOffice: true,
  taxNumber: true,
  contactName: true,
  phone: true,
  email: true,
  address: true,
  paymentTermDays: true,
  balance: true,
  debitTotal: true,
  creditTotal: true,
  lastEntryOn: true,
  isActive: true,
  notes: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {any} row */
export const accountView = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  type: row.type,
  linked: row.agencyId ? { kind: 'AGENCY', id: row.agencyId } : row.supplierId ? { kind: 'SUPPLIER', id: row.supplierId } : row.eventClientId ? { kind: 'EVENT_CLIENT', id: row.eventClientId } : null,
  taxOffice: row.taxOffice,
  taxNumber: row.taxNumber,
  contactName: row.contactName,
  phone: row.phone,
  email: row.email,
  address: row.address,
  paymentTermDays: row.paymentTermDays,
  balance: money(row.balance),
  debitTotal: money(row.debitTotal),
  creditTotal: money(row.creditTotal),
  lastEntryOn: day(row.lastEntryOn),
  isActive: row.isActive,
  notes: row.notes,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/**
 * Cari listesi: tür, bakiye yönü, durum ve ad / kod / vergi no araması; ada, bakiyeye ya da koda göre sıralı.
 * Toplamlar (borçlu ve alacaklı cariler) süzgece göre tek sorguda.
 *
 * @param {string} hotelId @param {any} query
 */
export async function listAccounts(hotelId, query) {
  const context = await hotelContext(hotelId);
  await ensureSettings(hotelId, context.today);
  /** @type {any} */
  const where = { hotelId };
  if (query.type) where.type = query.type;
  if (query.active !== 'all') where.isActive = query.active === 'true';
  if (query.balance === 'DEBIT') where.balance = { gt: 0 };
  else if (query.balance === 'CREDIT') where.balance = { lt: 0 };
  else if (query.balance === 'ANY') where.balance = { not: 0 };
  const search = query.search?.trim();
  if (search) {
    where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { code: { startsWith: search.toUpperCase() } }, { taxNumber: { startsWith: search.replace(/\s+/g, '') } }];
  }
  const orderBy = query.sort === 'balance' ? [{ balance: 'desc' }, { id: 'asc' }] : query.sort === 'code' ? [{ code: 'asc' }] : [{ name: 'asc' }, { id: 'asc' }];
  const [rows, total, sums] = await Promise.all([
    prisma.ledgerAccount.findMany({ where, select: ACCOUNT_SELECT, orderBy, ...toSkipTake(query) }),
    prisma.ledgerAccount.count({ where }),
    prisma.$queryRaw`
      SELECT COALESCE(sum("balance") FILTER (WHERE "balance" > 0), 0) AS "receivable",
             COALESCE(-sum("balance") FILTER (WHERE "balance" < 0), 0) AS "payable"
      FROM "LedgerAccount" WHERE "hotelId" = ${hotelId} AND "isActive"`,
  ]);
  const totals = /** @type {any[]} */ (sums)[0];
  return { ...buildPage(rows.map(accountView), total, query), currency: context.currency, totals: { receivable: money(totals.receivable), payable: money(totals.payable) } };
}

/**
 * Seçici (fiş, ödeme penceresi): ad / kod / vergi no ile etkin cariler; boş aramada en son hareket görenler.
 * @param {string} hotelId @param {{ search: string, type?: string }} query
 */
export async function pickAccounts(hotelId, { search, type }) {
  const context = await hotelContext(hotelId);
  await ensureSettings(hotelId, context.today);
  /** @type {any} */
  const where = { hotelId, isActive: true, ...(type ? { type } : {}) };
  const text = search.trim();
  if (text) where.OR = [{ name: { contains: text, mode: 'insensitive' } }, { code: { startsWith: text.toUpperCase() } }, { taxNumber: { startsWith: text.replace(/\s+/g, '') } }];
  const rows = await prisma.ledgerAccount.findMany({
    where,
    select: { id: true, code: true, name: true, type: true, balance: true, agencyId: true, paymentTermDays: true },
    orderBy: text ? [{ name: 'asc' }] : [{ lastEntryOn: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
    take: MAX_ACCOUNT_PICKER_RESULTS,
  });
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, type: row.type, agencyId: row.agencyId, balance: money(row.balance), paymentTermDays: row.paymentTermDays }));
}

/**
 * Cari kartı: bilgiler, bakiye, yaşlandırma (FIFO), açık çek / senetler ve son fişler.
 * @param {string} hotelId @param {string} accountId
 */
export async function getAccount(hotelId, accountId) {
  const context = await hotelContext(hotelId);
  const row = await prisma.ledgerAccount.findFirst({ where: { id: accountId, hotelId }, select: ACCOUNT_SELECT });
  if (!row) throw new NotFoundError('Cari bulunamadı');
  const [aging, instruments, opening] = await Promise.all([
    agingOf(hotelId, accountId, money(row.balance), context.today),
    prisma.instrument.groupBy({ by: ['direction', 'status'], where: { hotelId, ledgerAccountId: accountId, status: { in: ['PORTFOLIO', 'AT_BANK', 'OUTSTANDING'] } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.accountingVoucher.findFirst({ where: { hotelId, ledgerAccountId: accountId, type: 'OPENING', status: { not: 'VOIDED' } }, select: { id: true, number: true, amount: true, openingSide: true } }),
  ]);
  return {
    account: accountView(row),
    currency: context.currency,
    today: context.today,
    aging,
    openInstruments: instruments.map((group) => ({ direction: group.direction, status: group.status, count: group._count._all, amount: money(group._sum.amount) })),
    opening: opening ? { voucherId: opening.id, number: opening.number, amount: money(opening.amount), side: opening.openingSide } : null,
  };
}

/**
 * Yaşlandırma: bakiyeyi kapatan en yeni hareketler (bakiyenin yönünde) tek sorguda seçilir — yürüyen toplam
 * bakiyeyi geçince durur; dilimleme saf kuralda (`ageBalance`).
 * @param {string} hotelId @param {string} accountId @param {string} balance @param {string} today
 */
async function agingOf(hotelId, accountId, balance, today) {
  const amount = toDecimal(balance);
  if (amount.isZero()) return ageBalance([], balance, today);
  const side = amount.greaterThan(0) ? 'debit' : 'credit';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_char("date", 'YYYY-MM-DD') AS "date", to_char("dueDate", 'YYYY-MM-DD') AS "dueDate", "debit"::text AS "debit", "credit"::text AS "credit"
     FROM (
       SELECT "date", "dueDate", "debit", "credit",
              sum("${side}") OVER (ORDER BY "date" DESC, "createdAt" DESC, "id" DESC) - "${side}" AS "before"
       FROM "LedgerEntry" WHERE "accountId" = $1 AND "hotelId" = $2 AND "${side}" > 0
     ) t
     WHERE "before" < $3::numeric`,
    accountId,
    hotelId,
    toMoneyString(amount.abs()),
  );
  return ageBalance(/** @type {any[]} */ (rows), balance, today);
}

/**
 * Ekstre: dönem başı devir, dönemin hareketleri (belge günü + kayıt anı sırasıyla, imleçli) ve yürüyen bakiye,
 * dönem toplamları ve kapanış. Devir, dönem toplamları ve kapanış yalnız ilk sayfada döner (ekran onları ilk
 * sayfadan okur); imleçli sayfada yalnız sayfanın açılış bakiyesi (imlece kadar her şeyin toplamı) hesaplanır.
 *
 * @param {string} hotelId @param {string} accountId @param {{ from?: string, to?: string, cursor?: string, limit: number }} query
 */
export async function getStatement(hotelId, accountId, query) {
  const context = await hotelContext(hotelId);
  const account = await prisma.ledgerAccount.findFirst({ where: { id: accountId, hotelId }, select: { id: true, code: true, name: true, balance: true } });
  if (!account) throw new NotFoundError('Cari bulunamadı');
  const from = query.from ?? `${context.today.slice(0, 4)}-01-01`;
  const to = query.to ?? context.today;
  if (from > to) throw new ValidationError('Bitiş başlangıçtan önce olamaz');
  const cursor = decodeStatementCursor(query.cursor);
  const [openingRow, periodRow, rows] = await Promise.all([
    cursor
      ? prisma.$queryRaw`
          SELECT COALESCE(sum("debit" - "credit"), 0) AS "value" FROM "LedgerEntry"
          WHERE "accountId" = ${accountId} AND "hotelId" = ${hotelId} AND ("date", "createdAt", "id") <= (${cursor.date}::date, ${cursorTime(cursor.createdAt)}, ${cursor.id})`
      : prisma.$queryRaw`SELECT COALESCE(sum("debit" - "credit"), 0) AS "value" FROM "LedgerEntry" WHERE "accountId" = ${accountId} AND "hotelId" = ${hotelId} AND "date" < ${from}::date`,
    cursor
      ? Promise.resolve(null)
      : prisma.$queryRaw`
          SELECT COALESCE(sum("debit"), 0) AS "debit", COALESCE(sum("credit"), 0) AS "credit", count(*)::int AS "count"
          FROM "LedgerEntry" WHERE "accountId" = ${accountId} AND "hotelId" = ${hotelId} AND "date" BETWEEN ${from}::date AND ${to}::date`,
    prisma.$queryRaw`
      SELECT e."id", e."date", e."dueDate", e."debit", e."credit", e."description", e."reference", e."sourceType", e."sourceId", e."voucherId",
             e."instrumentId", e."reversalOfId", e."createdBy", e."createdAt", v."number" AS "voucherNumber",
             EXISTS (SELECT 1 FROM "LedgerEntry" r WHERE r."reversalOfId" = e."id") AS "reversed"
      FROM "LedgerEntry" e
      LEFT JOIN "AccountingVoucher" v ON v."id" = e."voucherId"
      WHERE e."accountId" = ${accountId} AND e."hotelId" = ${hotelId} AND e."date" BETWEEN ${from}::date AND ${to}::date
        ${cursor ? prismaCursor(cursor) : emptySql}
      ORDER BY e."date", e."createdAt", e."id"
      LIMIT ${query.limit + 1}`,
  ]);
  // İlk sayfada dönem başı devri, imleçli sayfada imlece kadarki bakiye: ikisi de sayfanın ilk satırından önceki bakiye.
  const opening = toDecimal(String(/** @type {any[]} */ (openingRow)[0].value));
  const period = periodRow ? /** @type {any[]} */ (periodRow)[0] : null;
  let running = opening;
  const list = /** @type {any[]} */ (rows);
  const hasMore = list.length > query.limit;
  const page = list.slice(0, query.limit).map((row) => {
    running = running.plus(toDecimal(String(row.debit))).minus(toDecimal(String(row.credit)));
    return {
      id: row.id,
      date: day(row.date),
      dueDate: day(row.dueDate),
      debit: money(row.debit),
      credit: money(row.credit),
      balance: toMoneyString(running),
      description: row.description,
      reference: row.reference,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      voucherId: row.voucherId,
      voucherNumber: row.voucherNumber,
      instrumentId: row.instrumentId,
      reversalOfId: row.reversalOfId,
      reversed: row.reversed,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
    };
  });
  const last = list[Math.min(list.length, query.limit) - 1];
  const debit = period ? toDecimal(String(period.debit)) : null;
  const credit = period ? toDecimal(String(period.credit)) : null;
  return {
    account: { id: account.id, code: account.code, name: account.name, balance: money(account.balance) },
    currency: context.currency,
    from,
    to,
    opening: period ? toMoneyString(opening) : null,
    totals: period && debit && credit ? { debit: toMoneyString(debit), credit: toMoneyString(credit), count: period.count } : null,
    closing: period && debit && credit ? toMoneyString(opening.plus(debit).minus(credit)) : null,
    items: page,
    nextCursor: hasMore && last ? encodeStatementCursor(last) : null,
  };
}

/* İmleç koşulu ham SQL parçası (Prisma.sql) — ayrı tutulur, sorgu okunur kalsın. */
const emptySql = Prisma.empty;
/** @param {{ date: string, createdAt: Date, id: string }} cursor */
const prismaCursor = (cursor) => Prisma.sql`AND (e."date", e."createdAt", e."id") > (${cursor.date}::date, ${cursorTime(cursor.createdAt)}, ${cursor.id})`;

/**
 * Yaşlandırma raporu: alacak (borçlu cariler) ya da borç (alacaklı cariler) dilimleri — bütün cariler tek
 * sorguda, sayfalı; vadesi geçmiş tutara, sonra en eski vadeye göre sıralı. Toplam satırı süzgece göre.
 *
 * Her cari için bakiyeyi kapatan en yeni hareketler LATERAL alt sorguyla, yönün kısmi kapsayan index'inden
 * (`LedgerEntry_debit_fifo_idx` / `LedgerEntry_credit_fifo_idx`: cari + yeniden eskiye sıra, tutar / vade / otel
 * içeride) tabloya dokunmadan okunur. Özet (sayı + dilim toplamları) sayfadan ayrı hesaplanır: sayfa
 * aralığın dışındaysa da toplamlar doğru döner.
 *
 * @param {string} hotelId @param {{ side: 'DEBIT' | 'CREDIT', type?: string, page: number, pageSize: number }} query
 */
export async function agingReport(hotelId, query) {
  const context = await hotelContext(hotelId);
  const side = Prisma.raw(query.side === 'CREDIT' ? '"credit"' : '"debit"');
  const sign = query.side === 'CREDIT' ? -1 : 1;
  const typeFilter = query.type ? Prisma.sql`AND a."type" = ${query.type}::"LedgerAccountType"` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    WITH acc AS (
      SELECT a."id", a."balance" * ${sign} AS "open" FROM "LedgerAccount" a
      WHERE a."hotelId" = ${hotelId} AND a."isActive" AND a."balance" * ${sign} > 0 ${typeFilter}
    ),
    parts AS (
      SELECT acc."id" AS "accountId", acc."open", p."due", ${context.today}::date - p."due" AS "late", LEAST(p."amount", acc."open" - p."before") AS "part"
      FROM acc CROSS JOIN LATERAL (
        SELECT COALESCE(e."dueDate", e."date") AS "due", e.${side} AS "amount",
               sum(e.${side}) OVER (ORDER BY e."date" DESC, e."createdAt" DESC, e."id" DESC) - e.${side} AS "before"
        FROM "LedgerEntry" e WHERE e."accountId" = acc."id" AND e."hotelId" = ${hotelId} AND e.${side} > 0
      ) p
      WHERE p."before" < acc."open"
    ),
    buckets AS (
      SELECT "accountId", max("open") AS "open", min("due") AS "oldestDue",
             COALESCE(sum("part") FILTER (WHERE "late" <= 0), 0) AS "notDue",
             COALESCE(sum("part") FILTER (WHERE "late" BETWEEN 1 AND 30), 0) AS "d30",
             COALESCE(sum("part") FILTER (WHERE "late" BETWEEN 31 AND 60), 0) AS "d60",
             COALESCE(sum("part") FILTER (WHERE "late" BETWEEN 61 AND 90), 0) AS "d90",
             COALESCE(sum("part") FILTER (WHERE "late" > 90), 0) AS "d90Plus"
      FROM parts GROUP BY "accountId"
    ),
    summary AS (
      SELECT count(*)::int AS "total", COALESCE(sum("open"), 0) AS "sumOpen", COALESCE(sum("notDue"), 0) AS "sumNotDue", COALESCE(sum("d30"), 0) AS "sumD30",
             COALESCE(sum("d60"), 0) AS "sumD60", COALESCE(sum("d90"), 0) AS "sumD90", COALESCE(sum("d90Plus"), 0) AS "sumD90Plus"
      FROM buckets
    ),
    page AS (
      SELECT b.*, a."code", a."name", a."type",
             row_number() OVER (ORDER BY (b."d90Plus" + b."d90" + b."d60" + b."d30") DESC, b."oldestDue", a."name", a."id") AS "rank"
      FROM buckets b JOIN "LedgerAccount" a ON a."id" = b."accountId"
      ORDER BY "rank"
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
    )
    SELECT s.*, p.* FROM summary s LEFT JOIN page p ON true ORDER BY p."rank"`;
  const list = /** @type {any[]} */ (rows);
  const summary = list[0];
  const bucketsOf = (row, prefix = '') => ({
    NOT_DUE: money(row[prefix ? `${prefix}NotDue` : 'notDue']),
    D30: money(row[prefix ? `${prefix}D30` : 'd30']),
    D60: money(row[prefix ? `${prefix}D60` : 'd60']),
    D90: money(row[prefix ? `${prefix}D90` : 'd90']),
    D90_PLUS: money(row[prefix ? `${prefix}D90Plus` : 'd90Plus']),
  });
  return {
    ...buildPage(
      list
        .filter((row) => row.accountId)
        .map((row) => ({ accountId: row.accountId, code: row.code, name: row.name, type: row.type, open: money(row.open), oldestDue: day(row.oldestDue), buckets: bucketsOf(row) })),
      summary.total,
      query,
    ),
    side: query.side,
    currency: context.currency,
    today: context.today,
    bucketLabels: AGING_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label })),
    totals: { open: money(summary.sumOpen), buckets: bucketsOf(summary, 'sum') },
  };
}

/* ─────────────── Yazma ─────────────── */

/**
 * Elle cari aç (şirket / şahıs / diğer). Kod boşsa türün önekiyle sıradaki numara; dolu kod tekil olmalı.
 * @param {string} hotelId @param {any} input
 */
export async function createAccount(hotelId, input) {
  const context = await hotelContext(hotelId);
  await ensureSettings(hotelId, context.today);
  const actor = currentActor();
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      const code = input.code ?? accountCode(LEDGER_ACCOUNT_CODE_PREFIXES[input.type], await nextSequence(tx, hotelId, LEDGER_ACCOUNT_CODE_PREFIXES[input.type], 0));
      const created = await tx.ledgerAccount.create({
        data: {
          hotelId,
          code,
          name: input.name,
          type: input.type,
          taxOffice: input.taxOffice ?? null,
          taxNumber: input.taxNumber ?? null,
          contactName: input.contactName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          paymentTermDays: input.paymentTermDays,
          notes: input.notes ?? null,
          createdBy: actor,
        },
        select: { id: true },
      });
      await recordAudit(tx, { hotelId, entity: 'LedgerAccount', entityId: created.id, action: 'CREATE', after: { code, name: input.name, type: input.type, taxNumber: input.taxNumber ?? null } });
      await stage('accounting.account.changed', { hotelId, accountId: created.id, change: 'CREATED' });
      return created.id;
    });
    return getAccount(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu cari kodu kullanılıyor' });
  }
}

/**
 * Cari kartını düzenle (sürüm damgasıyla). Bağlı cariye ünvan / vergi / iletişim bu ekrandan yazılmaz (kartından
 * gelir). Bakiyesi olan cari kullanımdan kaldırılamaz.
 * @param {string} hotelId @param {string} accountId @param {any} input
 */
export async function updateAccount(hotelId, accountId, input) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await tx.ledgerAccount.findFirst({ where: { id: accountId, hotelId }, select: ACCOUNT_SELECT });
      if (!before) throw new NotFoundError('Cari bulunamadı');
      if (before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError('Cari bu arada değişti; yenileyip tekrar deneyin');
      const linked = Boolean(before.agencyId || before.supplierId || before.eventClientId);
      if (!input.isActive && !toDecimal(String(before.balance)).isZero()) throw new ConflictError('Bakiyesi olan cari kullanımdan kaldırılamaz', 'ACCOUNT_HAS_BALANCE');
      const data = linked
        ? // Acente / tedarikçi carisinde vade kartından gelir; etkinlik müşterisinde carinin kendisi.
          { paymentTermDays: before.eventClientId ? input.paymentTermDays : before.paymentTermDays, notes: input.notes ?? null, isActive: input.isActive }
        : {
            name: input.name,
            code: input.code ?? before.code,
            taxOffice: input.taxOffice ?? null,
            taxNumber: input.taxNumber ?? null,
            contactName: input.contactName ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            address: input.address ?? null,
            paymentTermDays: input.paymentTermDays,
            notes: input.notes ?? null,
            isActive: input.isActive,
          };
      const changed = await tx.ledgerAccount.updateMany({ where: { id: accountId, hotelId, updatedAt: input.expectedUpdatedAt }, data });
      if (changed.count !== 1) throw new StaleWriteError('Cari bu arada değişti; yenileyip tekrar deneyin');
      await recordAudit(tx, { hotelId, entity: 'LedgerAccount', entityId: accountId, action: 'UPDATE', before: pick(before, Object.keys(data)), after: data });
      await stage('accounting.account.changed', { hotelId, accountId, change: 'UPDATED' });
    });
    return getAccount(hotelId, accountId);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu cari kodu kullanılıyor' });
  }
}

/**
 * Acente / tedarikçi / etkinlik müşterisi için cariyi aç ya da var olanı getir.
 * @param {string} hotelId @param {{ agencyId?: string | null, supplierId?: string | null, eventClientId?: string | null }} link
 */
export async function linkAccount(hotelId, link) {
  const context = await hotelContext(hotelId);
  await ensureSettings(hotelId, context.today);
  const id = await writeWithEvents(async (tx, stage) => {
    const before = await tx.ledgerAccount.findFirst({ where: { hotelId, OR: [{ agencyId: link.agencyId ?? '-' }, { supplierId: link.supplierId ?? '-' }, { eventClientId: link.eventClientId ?? '-' }] }, select: { id: true } });
    const account = await ensurePartnerAccount(tx, hotelId, link);
    if (!before) await stage('accounting.account.changed', { hotelId, accountId: account.id, change: 'CREATED' });
    return account.id;
  });
  return getAccount(hotelId, id);
}

/** @param {Record<string, any>} row @param {string[]} keys */
function pick(row, keys) {
  return Object.fromEntries(keys.map((key) => [key, row[key] instanceof Date ? iso(row[key]) : typeof row[key] === 'object' && row[key] !== null ? String(row[key]) : row[key]]));
}

