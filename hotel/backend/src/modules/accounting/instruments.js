import { currentActor } from '@hotelos/core';
import { INSTRUMENT_ACTION_LABELS, INSTRUMENT_DUE_SOON_DAYS, INSTRUMENT_KIND_LABELS, OPEN_INSTRUMENT_STATUSES, instrumentActions, instrumentTransition } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError } from '../../lib/errors.js';
import { lockInstruments, lockLedgerAccounts, lockTreasuryAccounts } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { addDays, assertCashCovers, dateOnly, day, ensureSettings, hotelContext, iso, money, postLedger, postTreasury, prisma } from './shared.js';

/**
 * Çek / senet portföyü (modül 47): liste (yön, durum, vade aralığı, cari), kart ve durum geçmişi, elle
 * işlemler. Alış ve veriş fişle olur (tahsilat / ödeme fişi), ciro ödeme fişiyle; burada portföydeki çekin
 * yolculuğu yürür: tahsile ver → tahsil / karşılıksız, kasadan-bankadan tahsil, iade; verilenin ödenmesi.
 *
 * Muhasebe etkisi saf kuraldan (`instrumentTransition`): tahsil kasaya / bankaya giriş, verilen çekin ödenmesi
 * bankadan çıkış; karşılıksız / iade carinin borcunu geri doğurur (ciro edilmişse ciro edilen cariye
 * borcumuz da geri doğar). Kilit sırası cari → kasa / banka → çek; durum kilit altında yeniden doğrulanır.
 */

const INSTRUMENT_SELECT = Object.freeze({
  id: true,
  kind: true,
  direction: true,
  status: true,
  number: true,
  bankName: true,
  branch: true,
  drawer: true,
  issueDate: true,
  dueDate: true,
  amount: true,
  currency: true,
  voucherId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  account: { select: { id: true, code: true, name: true } },
  endorsedTo: { select: { id: true, code: true, name: true } },
  treasury: { select: { id: true, name: true, kind: true, currency: true } },
  voucher: { select: { id: true, number: true } },
});

/** @param {any} row @param {string} today */
const instrumentView = (row, today) => ({
  id: row.id,
  kind: row.kind,
  direction: row.direction,
  status: row.status,
  number: row.number,
  bankName: row.bankName,
  branch: row.branch,
  drawer: row.drawer,
  issueDate: day(row.issueDate),
  dueDate: day(row.dueDate),
  overdue: OPEN_INSTRUMENT_STATUSES.includes(row.status) && day(row.dueDate) < today,
  dueSoon: OPEN_INSTRUMENT_STATUSES.includes(row.status) && day(row.dueDate) >= today && day(row.dueDate) <= addDays(today, INSTRUMENT_DUE_SOON_DAYS),
  amount: money(row.amount),
  currency: row.currency,
  account: row.account,
  endorsedTo: row.endorsedTo,
  treasury: row.treasury,
  voucher: row.voucher,
  actions: instrumentActions(row.direction, row.status),
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/**
 * Portföy listesi (vade sırasıyla) ve özet: açık alınan / verilen, vadesi geçmiş, bu hafta vadesi gelen.
 * @param {string} hotelId @param {any} query
 */
export async function listInstruments(hotelId, query) {
  const context = await hotelContext(hotelId);
  /** @type {any} */
  const where = { hotelId };
  if (query.direction) where.direction = query.direction;
  if (query.kind) where.kind = query.kind;
  if (query.status === 'OPEN') where.status = { in: OPEN_INSTRUMENT_STATUSES };
  else if (query.status) where.status = query.status;
  if (query.ledgerAccountId) where.ledgerAccountId = query.ledgerAccountId;
  if (query.dueFrom || query.dueTo) where.dueDate = { ...(query.dueFrom ? { gte: dateOnly(query.dueFrom) } : {}), ...(query.dueTo ? { lte: dateOnly(query.dueTo) } : {}) };
  const search = query.search?.trim();
  if (search) where.OR = [{ number: { contains: search } }, { drawer: { contains: search, mode: 'insensitive' } }, { account: { name: { contains: search, mode: 'insensitive' } } }];
  const [rows, total, summary] = await Promise.all([
    prisma.instrument.findMany({ where, select: INSTRUMENT_SELECT, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], ...toSkipTake(query) }),
    prisma.instrument.count({ where }),
    prisma.$queryRaw`
      SELECT "direction"::text AS "direction",
             count(*)::int AS "count", COALESCE(sum("amount"), 0) AS "amount",
             count(*) FILTER (WHERE "dueDate" < ${context.today}::date)::int AS "overdueCount",
             COALESCE(sum("amount") FILTER (WHERE "dueDate" < ${context.today}::date), 0) AS "overdueAmount",
             count(*) FILTER (WHERE "dueDate" BETWEEN ${context.today}::date AND ${addDays(context.today, INSTRUMENT_DUE_SOON_DAYS)}::date)::int AS "soonCount",
             COALESCE(sum("amount") FILTER (WHERE "dueDate" BETWEEN ${context.today}::date AND ${addDays(context.today, INSTRUMENT_DUE_SOON_DAYS)}::date), 0) AS "soonAmount"
      FROM "Instrument"
      WHERE "hotelId" = ${hotelId} AND "status" IN ('PORTFOLIO', 'AT_BANK', 'OUTSTANDING')
      GROUP BY "direction"`,
  ]);
  return {
    ...buildPage(rows.map((row) => instrumentView(row, context.today)), total, query),
    currency: context.currency,
    today: context.today,
    summary: /** @type {any[]} */ (summary).map((row) => ({
      direction: row.direction,
      count: row.count,
      amount: money(row.amount),
      overdue: { count: row.overdueCount, amount: money(row.overdueAmount) },
      dueSoon: { count: row.soonCount, amount: money(row.soonAmount) },
    })),
  };
}

/** @param {string} hotelId @param {string} instrumentId */
export async function getInstrument(hotelId, instrumentId) {
  const context = await hotelContext(hotelId);
  const row = await prisma.instrument.findFirst({ where: { id: instrumentId, hotelId }, select: INSTRUMENT_SELECT });
  if (!row) throw new NotFoundError('Çek / senet bulunamadı');
  const movements = await prisma.instrumentMovement.findMany({
    where: { hotelId, instrumentId },
    select: { id: true, action: true, fromStatus: true, toStatus: true, date: true, treasuryAccountId: true, ledgerAccountId: true, voucherId: true, note: true, createdBy: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  return {
    instrument: instrumentView(row, context.today),
    movements: movements.map((movement) => ({ ...movement, date: day(movement.date), createdAt: iso(movement.createdAt), label: INSTRUMENT_ACTION_LABELS[movement.action] })),
    currency: context.currency,
  };
}

/**
 * Elle işlem: durum makinesine göre geçiş, muhasebe etkisi ve geçmiş satırı tek işlemde.
 * @param {string} hotelId @param {string} instrumentId @param {{ expectedUpdatedAt: Date, action: string, date: string, treasuryAccountId?: string | null, note?: string | null }} input
 */
export async function applyInstrumentAction(hotelId, instrumentId, input) {
  const context = await hotelContext(hotelId);
  const settings = await ensureSettings(hotelId, context.today);
  if (input.date > context.today) throw new ValidationError('İşlem tarihi bugünden sonra olamaz', { fields: { date: 'Bugünden sonra olamaz' } });
  if (input.date < settings.startDate) throw new ValidationError(`İşlem tarihi muhasebe başlangıç gününden (${settings.startDate}) önce olamaz`, { fields: { date: 'Başlangıç gününden önce' } });
  const peek = await prisma.instrument.findFirst({ where: { id: instrumentId, hotelId }, select: { ledgerAccountId: true, endorsedToAccountId: true, treasuryAccountId: true, direction: true, status: true } });
  if (!peek) throw new NotFoundError('Çek / senet bulunamadı');
  if (!instrumentActions(peek.direction, peek.status).includes(input.action)) {
    throw new ConflictError(`Bu durumda "${INSTRUMENT_ACTION_LABELS[input.action]}" yapılamaz`, 'INSTRUMENT_ACTION');
  }
  const transition = instrumentTransition(peek.direction, peek.status, input.action);
  // Tahsil (bankadaki çek): tahsile verildiği banka; ödeme (verilen çek): ödeneceği banka. Diğerlerinde seçilen.
  const treasuryId =
    transition.treasury !== 0 || transition.needsTreasury
      ? (input.action === 'COLLECT' && peek.status === 'AT_BANK') || (input.action === 'PAY' && peek.treasuryAccountId)
        ? peek.treasuryAccountId
        : (input.treasuryAccountId ?? null)
      : null;
  if ((transition.treasury !== 0 || transition.needsTreasury) && !treasuryId) throw new ValidationError('Kasa / banka seçin', { fields: { treasuryAccountId: 'Zorunlu' } });
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await lockLedgerAccounts(tx, hotelId, [peek.ledgerAccountId, peek.endorsedToAccountId].filter(Boolean));
    if (treasuryId) await lockTreasuryAccounts(tx, hotelId, [treasuryId]);
    await lockInstruments(tx, hotelId, [instrumentId]);
    const row = await tx.instrument.findFirst({ where: { id: instrumentId, hotelId }, select: { ...INSTRUMENT_SELECT, ledgerAccountId: true, endorsedToAccountId: true, treasuryAccountId: true } });
    if (!row) throw new NotFoundError('Çek / senet bulunamadı');
    if (row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() || row.status !== peek.status) throw new StaleWriteError('Çek / senet bu arada değişti; yenileyip tekrar deneyin');
    if (treasuryId) {
      const treasury = await tx.treasuryAccount.findFirst({ where: { id: treasuryId, hotelId }, select: { name: true, kind: true, currency: true, isActive: true } });
      if (!treasury?.isActive) throw new ValidationError('Kasa / banka hesabı bulunamadı ya da kullanımda değil', { fields: { treasuryAccountId: 'Geçersiz' } });
      if (treasury.currency !== row.currency) throw new ValidationError(`${treasury.name} ${treasury.currency} hesabı; çek / senet ${row.currency}`, { fields: { treasuryAccountId: 'Para birimi uyuşmuyor' } });
      if (input.action === 'DEPOSIT' && treasury.kind !== 'BANK') throw new ValidationError('Tahsile yalnız banka hesabına verilir', { fields: { treasuryAccountId: 'Banka seçin' } });
      if (transition.treasury < 0) await assertCashCovers(tx, hotelId, treasuryId, money(row.amount));
    }
    const movement = await tx.instrumentMovement.create({
      data: {
        hotelId,
        instrumentId,
        action: /** @type {any} */ (input.action),
        fromStatus: row.status,
        toStatus: /** @type {any} */ (transition.status),
        date: dateOnly(input.date),
        treasuryAccountId: treasuryId,
        ledgerAccountId: transition.ledger ? row.ledgerAccountId : null,
        note: input.note ?? null,
        createdBy: actor,
      },
      select: { id: true },
    });
    const label = `${INSTRUMENT_KIND_LABELS[row.kind]} ${row.number}${row.bankName ? ` (${row.bankName})` : ''} · ${INSTRUMENT_ACTION_LABELS[input.action]}`;
    const amount = money(row.amount);
    const ledgerIds = [];
    if (transition.treasury !== 0) {
      await postTreasury(tx, {
        hotelId,
        treasuryAccountId: treasuryId,
        date: input.date,
        amount: transition.treasury > 0 ? amount : `-${amount}`,
        description: label,
        reference: row.number,
        ledgerAccountId: row.ledgerAccountId,
        sourceType: 'INSTRUMENT',
        sourceId: instrumentId,
        sourceKey: `INSTRUMENT:${instrumentId}:${movement.id}`,
        instrumentId,
      });
    }
    if (transition.ledger) {
      await postLedger(tx, {
        hotelId,
        accountId: row.ledgerAccountId,
        date: input.date,
        dueDate: transition.ledger === 'DEBIT' ? input.date : null,
        debit: transition.ledger === 'DEBIT' ? amount : '0',
        credit: transition.ledger === 'CREDIT' ? amount : '0',
        description: label,
        reference: row.number,
        sourceType: 'INSTRUMENT',
        sourceId: instrumentId,
        sourceKey: `INSTRUMENT:${instrumentId}:${movement.id}`,
        instrumentId,
      });
      ledgerIds.push(row.ledgerAccountId);
    }
    if (transition.endorseeCredit && row.endorsedToAccountId) {
      await postLedger(tx, {
        hotelId,
        accountId: row.endorsedToAccountId,
        date: input.date,
        credit: amount,
        description: `${label} — ciro edilen çek geri geldi`,
        reference: row.number,
        sourceType: 'INSTRUMENT',
        sourceId: instrumentId,
        sourceKey: `INSTRUMENT:${instrumentId}:${movement.id}:ENDORSEE`,
        instrumentId,
      });
      ledgerIds.push(row.endorsedToAccountId);
    }
    const nextTreasury = input.action === 'DEPOSIT' || input.action === 'COLLECT' || input.action === 'PAY' ? treasuryId : input.action === 'WITHDRAW' ? null : row.treasuryAccountId;
    await tx.instrument.updateMany({ where: { id: instrumentId, hotelId }, data: { status: /** @type {any} */ (transition.status), treasuryAccountId: nextTreasury } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Instrument',
      entityId: instrumentId,
      action: 'UPDATE',
      before: { status: row.status },
      after: { status: transition.status, action: input.action, date: input.date, treasuryAccountId: treasuryId, amount, note: input.note ?? null },
    });
    await stage('accounting.instrument.changed', { hotelId, instrumentId, action: input.action });
    if (ledgerIds.length || transition.treasury !== 0) {
      await stage('accounting.posted', { hotelId, source: 'INSTRUMENT', ledgerAccountIds: ledgerIds, treasuryAccountIds: transition.treasury !== 0 ? [treasuryId] : [] });
    }
  });
  return getInstrument(hotelId, instrumentId);
}

