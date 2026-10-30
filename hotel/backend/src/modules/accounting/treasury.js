import { Prisma } from '@prisma/client';
import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import { TREASURY_CHANNELS, TREASURY_CHANNEL_METHODS, TREASURY_CODE_PREFIXES, formatIban } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import {
  DEFAULT_PAYMENT_APPROVAL_AMOUNT,
  accountCode,
  cursorTime,
  day,
  decodeStatementCursor,
  encodeStatementCursor,
  ensureSettings,
  hotelContext,
  iso,
  money,
  nextSequence,
  prisma,
} from './shared.js';

/**
 * Kasa / banka (modül 47): hesaplar ve bakiyeleri, hareketler (devir + yürüyen bakiye, imleçli), muhasebe
 * ayarı (başlangıç günü, ödeme fişi onay eşiği) ve yöntem → kasa / banka eşlemesi.
 *
 * Hesabın türü ve para birimi hareket gördükten sonra değişmez (geçmiş hareketlerin anlamı değişirdi);
 * bakiyesi olan ya da eşlemede kullanılan hesap kullanımdan kaldırılamaz.
 */

const TREASURY_SELECT = Object.freeze({
  id: true,
  kind: true,
  code: true,
  name: true,
  currency: true,
  bankName: true,
  branch: true,
  iban: true,
  accountNumber: true,
  balance: true,
  lastMovementOn: true,
  isActive: true,
  notes: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {any} row */
export const treasuryView = (row) => ({
  id: row.id,
  kind: row.kind,
  code: row.code,
  name: row.name,
  currency: row.currency,
  bankName: row.bankName,
  branch: row.branch,
  iban: row.iban,
  ibanText: row.iban ? formatIban(row.iban) : null,
  accountNumber: row.accountNumber,
  balance: money(row.balance),
  lastMovementOn: day(row.lastMovementOn),
  isActive: row.isActive,
  notes: row.notes,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/**
 * Bütün kasa / banka hesapları (otel başına onlarca; sayfasız ama sınırlı) ve para birimine göre toplamlar.
 * @param {string} hotelId @param {{ kind?: string, active?: string }} [query]
 */
export async function listTreasuryAccounts(hotelId, query = {}) {
  const context = await hotelContext(hotelId);
  await ensureSettings(hotelId, context.today);
  /** @type {any} */
  const where = { hotelId };
  if (query.kind) where.kind = query.kind;
  if (query.active !== 'all') where.isActive = true;
  const rows = await prisma.treasuryAccount.findMany({ where, select: TREASURY_SELECT, orderBy: [{ kind: 'asc' }, { name: 'asc' }], take: 200 });
  /** @type {Record<string, Record<string, import('decimal.js').Decimal>>} */
  const totals = {};
  for (const row of rows) {
    totals[row.kind] ??= {};
    totals[row.kind][row.currency] = (totals[row.kind][row.currency] ?? toDecimal(0)).plus(toDecimal(String(row.balance)));
  }
  return {
    items: rows.map(treasuryView),
    currency: context.currency,
    totals: Object.entries(totals).flatMap(([kind, byCurrency]) => Object.entries(byCurrency).map(([currency, sum]) => ({ kind, currency, balance: toMoneyString(sum) }))),
  };
}

/** @param {string} hotelId @param {string} treasuryAccountId */
export async function getTreasuryAccount(hotelId, treasuryAccountId) {
  const row = await prisma.treasuryAccount.findFirst({ where: { id: treasuryAccountId, hotelId }, select: TREASURY_SELECT });
  if (!row) throw new NotFoundError('Kasa / banka hesabı bulunamadı');
  const [mappings, opening, instruments] = await Promise.all([
    prisma.treasuryMapping.findMany({ where: { hotelId, treasuryAccountId }, select: { channel: true, method: true, currency: true } }),
    prisma.accountingVoucher.findFirst({ where: { hotelId, treasuryAccountId, type: 'OPENING', status: { not: 'VOIDED' } }, select: { id: true, number: true, amount: true } }),
    prisma.instrument.groupBy({ by: ['direction', 'status'], where: { hotelId, treasuryAccountId, status: { in: ['AT_BANK', 'OUTSTANDING'] } }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  return {
    account: treasuryView(row),
    mappings,
    opening: opening ? { voucherId: opening.id, number: opening.number, amount: money(opening.amount) } : null,
    instruments: instruments.map((group) => ({ direction: group.direction, status: group.status, count: group._count._all, amount: money(group._sum.amount) })),
  };
}

/**
 * Hesap hareketleri: dönem başı devir, hareketler (gün + kayıt anı, imleçli), yürüyen bakiye, giriş / çıkış toplamı
 * (devir, toplamlar ve kapanış yalnız ilk sayfada; imleçli sayfada null).
 * @param {string} hotelId @param {string} treasuryAccountId @param {{ from?: string, to?: string, cursor?: string, limit: number, source?: string }} query
 */
export async function listMovements(hotelId, treasuryAccountId, query) {
  const context = await hotelContext(hotelId);
  const account = await prisma.treasuryAccount.findFirst({ where: { id: treasuryAccountId, hotelId }, select: { id: true, code: true, name: true, kind: true, currency: true, balance: true } });
  if (!account) throw new NotFoundError('Kasa / banka hesabı bulunamadı');
  const from = query.from ?? `${context.today.slice(0, 7)}-01`;
  const to = query.to ?? context.today;
  if (from > to) throw new ValidationError('Bitiş başlangıçtan önce olamaz');
  const cursor = decodeStatementCursor(query.cursor);
  // Kaynak süzgecinde yürüyen bakiye anlamsız (araya giren hareketler gizli): yalnız tutarlar.
  const source = query.source ? Prisma.sql`AND m."sourceType" = ${query.source}::"TreasurySource"` : Prisma.empty;
  const after = cursor ? Prisma.sql`AND (m."date", m."createdAt", m."id") > (${cursor.date}::date, ${cursorTime(cursor.createdAt)}, ${cursor.id})` : Prisma.empty;
  // Devir, dönem toplamları ve kapanış yalnız ilk sayfada (ekran onları ilk sayfadan okur). İmleçli sayfada
  // yalnız sayfanın açılış bakiyesi: imlece kadar her şeyin toplamı (kaynak süzgecinde yürüyen bakiye yok).
  const [openingRow, periodRow, rows] = await Promise.all([
    cursor
      ? query.source
        ? Promise.resolve([{ value: 0 }])
        : prisma.$queryRaw`
            SELECT COALESCE(sum("amount"), 0) AS "value" FROM "TreasuryMovement"
            WHERE "treasuryAccountId" = ${treasuryAccountId} AND "hotelId" = ${hotelId} AND ("date", "createdAt", "id") <= (${cursor.date}::date, ${cursorTime(cursor.createdAt)}, ${cursor.id})`
      : prisma.$queryRaw`SELECT COALESCE(sum("amount"), 0) AS "value" FROM "TreasuryMovement" WHERE "treasuryAccountId" = ${treasuryAccountId} AND "hotelId" = ${hotelId} AND "date" < ${from}::date`,
    cursor
      ? Promise.resolve(null)
      : prisma.$queryRaw`
          SELECT COALESCE(sum("amount") FILTER (WHERE "amount" > 0), 0) AS "inflow", COALESCE(-sum("amount") FILTER (WHERE "amount" < 0), 0) AS "outflow", count(*)::int AS "count"
          FROM "TreasuryMovement" m WHERE m."treasuryAccountId" = ${treasuryAccountId} AND m."hotelId" = ${hotelId} AND m."date" BETWEEN ${from}::date AND ${to}::date ${source}`,
    prisma.$queryRaw`
      SELECT m."id", m."date", m."amount", m."description", m."reference", m."sourceType", m."sourceId", m."voucherId", m."instrumentId", m."reversalOfId",
             m."originalAmount", m."originalCurrency", m."exchangeRate", m."createdBy", m."createdAt", m."ledgerAccountId",
             l."name" AS "ledgerAccountName", v."number" AS "voucherNumber",
             EXISTS (SELECT 1 FROM "TreasuryMovement" r WHERE r."reversalOfId" = m."id") AS "reversed"
      FROM "TreasuryMovement" m
      LEFT JOIN "LedgerAccount" l ON l."id" = m."ledgerAccountId"
      LEFT JOIN "AccountingVoucher" v ON v."id" = m."voucherId"
      WHERE m."treasuryAccountId" = ${treasuryAccountId} AND m."hotelId" = ${hotelId} AND m."date" BETWEEN ${from}::date AND ${to}::date ${source} ${after}
      ORDER BY m."date", m."createdAt", m."id"
      LIMIT ${query.limit + 1}`,
  ]);
  const opening = toDecimal(String(/** @type {any[]} */ (openingRow)[0].value));
  const period = periodRow ? /** @type {any[]} */ (periodRow)[0] : null;
  let running = opening;
  const list = /** @type {any[]} */ (rows);
  const hasMore = list.length > query.limit;
  const items = list.slice(0, query.limit).map((row) => {
    running = running.plus(toDecimal(String(row.amount)));
    return {
      id: row.id,
      date: day(row.date),
      amount: money(row.amount),
      balance: query.source ? null : toMoneyString(running),
      description: row.description,
      reference: row.reference,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      voucherId: row.voucherId,
      voucherNumber: row.voucherNumber,
      instrumentId: row.instrumentId,
      ledgerAccount: row.ledgerAccountId ? { id: row.ledgerAccountId, name: row.ledgerAccountName } : null,
      original: row.originalAmount === null ? null : { amount: money(row.originalAmount), currency: row.originalCurrency, rate: String(row.exchangeRate) },
      reversalOfId: row.reversalOfId,
      reversed: row.reversed,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
    };
  });
  const last = list[Math.min(list.length, query.limit) - 1];
  const inflow = period ? toDecimal(String(period.inflow)) : null;
  const outflow = period ? toDecimal(String(period.outflow)) : null;
  return {
    account: { id: account.id, code: account.code, name: account.name, kind: account.kind, currency: account.currency, balance: money(account.balance) },
    from,
    to,
    opening: period ? toMoneyString(opening) : null,
    totals: period && inflow && outflow ? { inflow: toMoneyString(inflow), outflow: toMoneyString(outflow), count: period.count } : null,
    closing: period && inflow && outflow && !query.source ? toMoneyString(opening.plus(inflow).minus(outflow)) : null,
    items,
    nextCursor: hasMore && last ? encodeStatementCursor(last) : null,
  };
}

/* ─────────────── Hesap tanımı ─────────────── */

/** @param {any} input */
const treasuryData = (input) => ({
  name: input.name,
  currency: input.currency,
  bankName: input.kind === 'BANK' ? (input.bankName ?? null) : null,
  branch: input.kind === 'BANK' ? (input.branch ?? null) : null,
  iban: input.kind === 'BANK' ? (input.iban ?? null) : null,
  accountNumber: input.kind === 'BANK' ? (input.accountNumber ?? null) : null,
  notes: input.notes ?? null,
});

/** @param {string} hotelId @param {any} input */
export async function createTreasuryAccount(hotelId, input) {
  const context = await hotelContext(hotelId);
  await ensureSettings(hotelId, context.today);
  const actor = currentActor();
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      const prefix = TREASURY_CODE_PREFIXES[input.kind];
      const code = input.code ?? accountCode(prefix, await nextSequence(tx, hotelId, prefix, 0));
      const created = await tx.treasuryAccount.create({ data: { hotelId, kind: input.kind, code, ...treasuryData(input), createdBy: actor }, select: { id: true } });
      await recordAudit(tx, { hotelId, entity: 'TreasuryAccount', entityId: created.id, action: 'CREATE', after: { code, kind: input.kind, ...treasuryData(input) } });
      await stage('accounting.treasury.changed', { hotelId, treasuryAccountId: created.id, change: 'CREATED' });
      return created.id;
    });
    return getTreasuryAccount(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kod ya da IBAN başka bir hesapta kayıtlı' });
  }
}

/** @param {string} hotelId @param {string} treasuryAccountId @param {any} input */
export async function updateTreasuryAccount(hotelId, treasuryAccountId, input) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await tx.treasuryAccount.findFirst({ where: { id: treasuryAccountId, hotelId }, select: TREASURY_SELECT });
      if (!before) throw new NotFoundError('Kasa / banka hesabı bulunamadı');
      if (before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError('Hesap bu arada değişti; yenileyip tekrar deneyin');
      const moved = await tx.treasuryMovement.findFirst({ where: { hotelId, treasuryAccountId }, select: { id: true } });
      if (moved && (before.kind !== input.kind || before.currency !== input.currency)) {
        throw new ConflictError('Hareket görmüş hesabın türü ve para birimi değişmez; yeni hesap açın', 'TREASURY_LOCKED_FIELDS');
      }
      if (!input.isActive && before.isActive) {
        if (!toDecimal(String(before.balance)).isZero()) throw new ConflictError('Bakiyesi olan hesap kullanımdan kaldırılamaz; önce virmanla boşaltın', 'TREASURY_HAS_BALANCE');
        const mapped = await tx.treasuryMapping.count({ where: { hotelId, treasuryAccountId } });
        if (mapped) throw new ConflictError('Eşlemede kullanılan hesap kullanımdan kaldırılamaz; önce eşlemeyi değiştirin', 'TREASURY_MAPPED');
        const open = await tx.instrument.count({ where: { hotelId, treasuryAccountId, status: { in: ['AT_BANK', 'OUTSTANDING'] } } });
        if (open) throw new ConflictError('Tahsilde ya da ödenecek çek / senedi olan hesap kullanımdan kaldırılamaz', 'TREASURY_HAS_INSTRUMENTS');
      }
      const data = { kind: input.kind, code: input.code ?? before.code, ...treasuryData(input), isActive: input.isActive };
      const changed = await tx.treasuryAccount.updateMany({ where: { id: treasuryAccountId, hotelId, updatedAt: input.expectedUpdatedAt }, data });
      if (changed.count !== 1) throw new StaleWriteError('Hesap bu arada değişti; yenileyip tekrar deneyin');
      await recordAudit(tx, { hotelId, entity: 'TreasuryAccount', entityId: treasuryAccountId, action: 'UPDATE', before: { name: before.name, iban: before.iban, isActive: before.isActive }, after: data });
      await stage('accounting.treasury.changed', { hotelId, treasuryAccountId, change: 'UPDATED' });
    });
    return getTreasuryAccount(hotelId, treasuryAccountId);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kod ya da IBAN başka bir hesapta kayıtlı' });
  }
}

/* ─────────────── Ayar ve eşleme ─────────────── */

/** @param {string} hotelId */
export async function getSettings(hotelId) {
  const context = await hotelContext(hotelId);
  const settings = await ensureSettings(hotelId, context.today);
  const [mappings, accounts] = await Promise.all([
    prisma.treasuryMapping.findMany({ where: { hotelId }, select: { channel: true, method: true, currency: true, treasuryAccountId: true, updatedAt: true }, orderBy: [{ channel: 'asc' }, { method: 'asc' }, { currency: 'asc' }] }),
    prisma.treasuryAccount.findMany({ where: { hotelId, isActive: true }, select: { id: true, kind: true, name: true, currency: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }], take: 200 }),
  ]);
  const mappingUpdatedAt = mappings.reduce((latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest), /** @type {Date | null} */ (null));
  return {
    settings: { ...settings, paymentApprovalAmount: settings.paymentApprovalAmount ?? DEFAULT_PAYMENT_APPROVAL_AMOUNT },
    currency: context.currency,
    today: context.today,
    mappings: mappings.map(({ updatedAt, ...row }) => row),
    mappingUpdatedAt: iso(mappingUpdatedAt),
    accounts,
    channels: TREASURY_CHANNELS.map((channel) => ({ channel, methods: TREASURY_CHANNEL_METHODS[channel] })),
  };
}

/**
 * Başlangıç günü ve onay eşiği. Başlangıç günü, ondan önce tarihli hareket varsa ileri alınamaz (işlenmiş
 * kayıtlar dönemin dışında kalırdı); geri alınabilir — öncesindeki belgeler eşitlemeyle işlenebilir.
 * @param {string} hotelId @param {{ expectedUpdatedAt: Date | null, startDate: string, paymentApprovalAmount: string }} input
 */
export async function saveSettings(hotelId, input) {
  const context = await hotelContext(hotelId);
  const current = await ensureSettings(hotelId, context.today);
  if (input.expectedUpdatedAt && current.updatedAt && new Date(current.updatedAt).getTime() !== input.expectedUpdatedAt.getTime()) {
    throw new StaleWriteError('Ayar bu arada değişti; yenileyip tekrar deneyin');
  }
  if (input.startDate > context.today) throw new ValidationError('Başlangıç günü bugünden sonra olamaz');
  await writeWithEvents(async (tx, stage) => {
    if (input.startDate > current.startDate) {
      const [entry, movement] = await Promise.all([
        tx.ledgerEntry.findFirst({ where: { hotelId, date: { lt: new Date(`${input.startDate}T00:00:00.000Z`) }, sourceType: { not: 'OPENING' } }, select: { id: true } }),
        tx.treasuryMovement.findFirst({ where: { hotelId, date: { lt: new Date(`${input.startDate}T00:00:00.000Z`) }, sourceType: { not: 'OPENING' } }, select: { id: true } }),
      ]);
      if (entry || movement) throw new ConflictError('Başlangıç gününden önce işlenmiş hareket var: gün ileri alınamaz', 'START_DATE_HAS_ENTRIES');
    }
    const changed = await tx.accountingSettings.updateMany({
      where: { hotelId, ...(input.expectedUpdatedAt ? { updatedAt: input.expectedUpdatedAt } : {}) },
      data: { startDate: new Date(`${input.startDate}T00:00:00.000Z`), paymentApprovalAmount: input.paymentApprovalAmount, updatedBy: currentActor() },
    });
    if (changed.count !== 1) throw new StaleWriteError('Ayar bu arada değişti; yenileyip tekrar deneyin');
    await recordAudit(tx, {
      hotelId,
      entity: 'AccountingSettings',
      entityId: hotelId,
      action: 'UPDATE',
      before: { startDate: current.startDate, paymentApprovalAmount: current.paymentApprovalAmount },
      after: { startDate: input.startDate, paymentApprovalAmount: input.paymentApprovalAmount },
    });
    await stage('accounting.settings.changed', { hotelId });
  });
  return getSettings(hotelId);
}

/**
 * Eşleme tablosunu bütünüyle kaydeder: hesaplar etkin olmalı, para birimi satırınkiyle (boşsa otelinkiyle)
 * uyumlu olmalı — TRY kasaya EUR eşlemek dövizi kaybettirirdi.
 * @param {string} hotelId @param {{ expectedUpdatedAt: Date | null, rows: Array<{ channel: string, method: string, currency: string, treasuryAccountId: string }> }} input
 */
export async function saveMappings(hotelId, input) {
  const context = await hotelContext(hotelId);
  await ensureSettings(hotelId, context.today);
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.treasuryMapping.findMany({ where: { hotelId }, select: { channel: true, method: true, currency: true, treasuryAccountId: true, updatedAt: true } });
    const latest = existing.reduce((value, row) => (!value || row.updatedAt > value ? row.updatedAt : value), /** @type {Date | null} */ (null));
    if ((latest?.getTime() ?? null) !== (input.expectedUpdatedAt?.getTime() ?? null)) throw new StaleWriteError('Eşleme bu arada değişti; yenileyip tekrar deneyin');
    const ids = [...new Set(input.rows.map((row) => row.treasuryAccountId))];
    const accounts = await tx.treasuryAccount.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, name: true, currency: true, isActive: true } });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    input.rows.forEach((row, index) => {
      const account = byId.get(row.treasuryAccountId);
      if (!account?.isActive) throw new ValidationError('Eşlenen hesap bulunamadı ya da kullanımda değil', { fields: { [`rows.${index}.treasuryAccountId`]: 'Hesap seçin' } });
      const expected = row.currency || context.currency;
      if (account.currency !== expected) {
        throw new ValidationError(`${account.name} ${account.currency} hesabı; ${expected} tahsilatı için ${expected} hesabı seçin`, { fields: { [`rows.${index}.treasuryAccountId`]: 'Para birimi uyuşmuyor' } });
      }
    });
    await tx.treasuryMapping.deleteMany({ where: { hotelId } });
    if (input.rows.length) await tx.treasuryMapping.createMany({ data: input.rows.map((row) => ({ hotelId, ...row, method: /** @type {any} */ (row.method), updatedBy: actor })) });
    await recordAudit(tx, {
      hotelId,
      entity: 'TreasuryMapping',
      entityId: hotelId,
      action: 'UPDATE',
      before: { rows: existing.map(({ updatedAt, ...row }) => row) },
      after: { rows: input.rows },
    });
    await stage('accounting.settings.changed', { hotelId });
  });
  return getSettings(hotelId);
}

