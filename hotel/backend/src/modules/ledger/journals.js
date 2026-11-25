import { currentActor } from '@hotelos/core';
import { JOURNAL_SOURCE_LABELS, MAX_JOURNAL_BACKDATE_DAYS } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { addDays } from '../accounting/shared.js';
import { assertPostableAccounts, dateOnly, day, ensureChart, iso, ledgerContext, money, prisma, writeJournal } from './shared.js';

/**
 * Yevmiye fişleri (modül 48): liste, fiş, elle fiş, iptal (ters kayıt). Otomatik fişler motorda (`journalize.js`).
 */

const ENTRY_SELECT = Object.freeze({
  id: true,
  number: true,
  type: true,
  status: true,
  date: true,
  description: true,
  reference: true,
  source: true,
  sourceId: true,
  total: true,
  lineCount: true,
  reversalOfId: true,
  reversal: { select: { id: true, number: true } },
  reversalOf: { select: { id: true, number: true } },
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {any} row */
const entryView = (row) => ({
  id: row.id,
  number: row.number,
  type: row.type,
  status: row.status,
  date: day(row.date),
  description: row.description,
  reference: row.reference,
  source: row.source,
  sourceLabel: JOURNAL_SOURCE_LABELS[row.source] ?? row.source,
  sourceId: row.sourceId,
  total: money(row.total),
  lineCount: row.lineCount,
  reversalOfId: row.reversalOfId,
  reversal: row.reversal ?? null,
  reversalOf: row.reversalOf ?? null,
  voidedAt: iso(row.voidedAt),
  voidedBy: row.voidedBy,
  voidReason: row.voidReason,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/** Kaynak belgenin ekranı (bilinen yollar; bilinmeyende yalnız etiket). @param {string} source @param {string | null} sourceId */
function sourceLinkOf(source, sourceId) {
  if (!sourceId) return null;
  const label = JOURNAL_SOURCE_LABELS[source] ?? source;
  switch (source) {
    case 'VOUCHER':
    case 'OPENING':
      return { type: source, id: sourceId, label, to: `/muhasebe/fisler/${sourceId}` };
    case 'GOODS_RECEIPT':
      return { type: source, id: sourceId, label, to: `/satin-alma/mal-kabul/${sourceId}` };
    case 'INSTRUMENT':
      return { type: source, id: sourceId, label, to: '/muhasebe/cek-senet' };
    case 'REVERSAL':
      return { type: source, id: sourceId, label, to: `/genel-muhasebe/yevmiye/${sourceId}` };
    default:
      return { type: source, id: sourceId, label, to: null };
  }
}

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, from?: string, to?: string, type?: string, status?: string, source?: string, accountId?: string, search?: string }} query
 */
export async function listJournals(hotelId, query) {
  await ensureChart(hotelId);
  const where = {
    hotelId,
    ...(query.from || query.to ? { date: { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) } } : {}),
    ...(query.type ? { type: /** @type {any} */ (query.type) } : {}),
    ...(query.status ? { status: /** @type {any} */ (query.status) } : {}),
    ...(query.source ? { source: /** @type {any} */ (query.source) } : {}),
    ...(query.accountId ? { lines: { some: { accountId: query.accountId } } } : {}),
    ...(query.search
      ? { OR: [{ number: { contains: query.search, mode: 'insensitive' } }, { description: { contains: query.search, mode: 'insensitive' } }, { reference: { contains: query.search, mode: 'insensitive' } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.journalEntry.findMany({ where, select: ENTRY_SELECT, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query) }),
    prisma.journalEntry.count({ where }),
  ]);
  return buildPage(rows.map(entryView), total, query);
}

/** @param {string} hotelId @param {string} journalId */
export async function getJournal(hotelId, journalId) {
  const row = await prisma.journalEntry.findFirst({
    where: { id: journalId, hotelId },
    select: {
      ...ENTRY_SELECT,
      lines: {
        select: {
          id: true,
          sortOrder: true,
          accountId: true,
          debit: true,
          credit: true,
          description: true,
          account: { select: { code: true, name: true } },
          ledgerAccount: { select: { id: true, name: true } },
          treasuryAccount: { select: { id: true, name: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  if (!row) throw new NotFoundError('Fiş bulunamadı');
  const [ledgerEntries, treasuryMovements, context] = await Promise.all([
    prisma.ledgerEntry.count({ where: { hotelId, journalEntryId: journalId } }),
    prisma.treasuryMovement.count({ where: { hotelId, journalEntryId: journalId } }),
    ledgerContext(hotelId),
  ]);
  return {
    entry: entryView(row),
    lines: row.lines.map((line) => ({
      id: line.id,
      sortOrder: line.sortOrder,
      accountId: line.accountId,
      account: line.account,
      debit: money(line.debit),
      credit: money(line.credit),
      description: line.description,
      ledgerAccount: line.ledgerAccount,
      treasuryAccount: line.treasuryAccount,
    })),
    sourceLink: sourceLinkOf(row.source, row.sourceId),
    linked: { ledgerEntries, treasuryMovements },
    currency: context.currency,
    lockedThrough: context.lockedThrough,
  };
}

/** Fiş günü: bugünden sonra, başlangıçtan önce, kilitli dönemde ve çok eskiye olamaz. */
function assertJournalDate(date, context, label = 'Fiş tarihi') {
  if (date > context.today) throw new ValidationError(`${label} bugünden sonra olamaz`, { fields: { date: 'Bugünden sonra olamaz' } });
  if (date < context.startDate) throw new ValidationError(`${label} muhasebe başlangıç gününden (${context.startDate}) önce olamaz`, { fields: { date: 'Başlangıç gününden önce' } });
  if (context.lockedThrough && date <= context.lockedThrough) throw new ValidationError(`Dönem ${context.lockedThrough} gününe kadar kilitli`, { fields: { date: 'Kilitli dönem' } });
  if (date < addDays(context.today, -MAX_JOURNAL_BACKDATE_DAYS)) throw new ValidationError(`${label} en fazla ${MAX_JOURNAL_BACKDATE_DAYS} gün geriye girilir`, { fields: { date: 'Çok eski' } });
}

/**
 * Elle fiş. Aynı istek kimliği ikinci fiş açmaz.
 * @param {string} hotelId @param {{ requestId: string, date: string, description: string, reference: string | null, lines: Array<any> }} input
 */
export async function createManualJournal(hotelId, input) {
  await ensureChart(hotelId);
  const context = await ledgerContext(hotelId);
  assertJournalDate(input.date, context);
  const existing = await prisma.journalEntry.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } });
  if (existing) return { created: false, ...(await getJournal(hotelId, existing.id)) };
  await assertPostableAccounts(prisma, hotelId, input.lines.map((line) => line.accountId));
  const ledgerIds = [...new Set(input.lines.map((line) => line.ledgerAccountId).filter(Boolean))];
  if (ledgerIds.length) {
    const known = await prisma.ledgerAccount.count({ where: { hotelId, id: { in: ledgerIds } } });
    if (known !== ledgerIds.length) throw new NotFoundError('Cari bulunamadı');
  }
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      const entry = await writeJournal(tx, {
        hotelId,
        type: 'MANUAL',
        source: 'MANUAL',
        date: input.date,
        description: input.description,
        reference: input.reference,
        requestId: input.requestId,
        lines: input.lines.map((line) => ({ accountId: line.accountId, debit: line.debit ?? '0', credit: line.credit ?? '0', description: line.description, ledgerAccountId: line.ledgerAccountId })),
      });
      await recordAudit(tx, { hotelId, entity: 'JournalEntry', entityId: entry.id, action: 'CREATE', after: { number: entry.number, date: input.date, total: entry.total, lines: input.lines.length } });
      await stage('ledger.changed', { hotelId, change: 'JOURNAL', journalIds: [entry.id] });
      return entry.id;
    });
    return { created: true, ...(await getJournal(hotelId, id)) };
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'P2002') {
      const raced = await prisma.journalEntry.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } });
      if (raced) return { created: false, ...(await getJournal(hotelId, raced.id)) };
    }
    throw error;
  }
}

/**
 * Fiş iptali: asıl fiş VOIDED olur, ters kayıt fişi yazılır (borç ↔ alacak). Ters kayıt fişi ve zaten iptal edilmiş
 * fiş iptal edilemez; kilitli dönemdeki fiş iptal edilemez. Otomatik fişin kaynak kayıtları fişli kalır (yeniden
 * fişlenmez) — düzeltme elle fişle.
 * @param {string} hotelId @param {string} journalId @param {{ expectedUpdatedAt: Date, reason: string, date?: string }} input
 */
export async function voidJournal(hotelId, journalId, input) {
  const context = await ledgerContext(hotelId);
  const entry = await prisma.journalEntry.findFirst({
    where: { id: journalId, hotelId },
    select: { ...ENTRY_SELECT, lines: { select: { accountId: true, debit: true, credit: true, description: true, ledgerAccountId: true, treasuryAccountId: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!entry) throw new NotFoundError('Fiş bulunamadı');
  if (entry.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError('Fiş bu arada değişti; yenileyip tekrar deneyin');
  if (entry.status !== 'POSTED') throw new ConflictError('Fiş zaten iptal edilmiş', 'JOURNAL_ALREADY_VOIDED');
  if (entry.reversalOfId) throw new ConflictError('Ters kayıt fişi iptal edilemez; gerekirse yeni bir elle fiş girin', 'JOURNAL_IS_REVERSAL');
  const entryDate = /** @type {string} */ (day(entry.date));
  if (context.lockedThrough && entryDate <= context.lockedThrough) throw new ConflictError(`Fiş kilitli dönemde (${context.lockedThrough} gününe kadar); kilidi açmadan iptal edilemez`, 'JOURNAL_PERIOD_LOCKED');
  const date = input.date ?? context.today;
  assertJournalDate(date, context, 'Ters kayıt tarihi');
  if (date < entryDate) throw new ValidationError('Ters kayıt fişin gününden önce olamaz', { fields: { date: 'Fiş gününden önce' } });
  const actor = currentActor();
  const reversalId = await writeWithEvents(async (tx, stage) => {
    const reversal = await writeJournal(tx, {
      hotelId,
      type: entry.type,
      source: 'REVERSAL',
      sourceId: entry.id,
      sourceKey: `REVERSAL:${entry.id}`,
      date,
      description: `İptal: ${entry.number} ${entry.description} — ${input.reason}`,
      reference: entry.reference,
      reversalOfId: entry.id,
      lines: entry.lines.map((line) => ({ accountId: line.accountId, debit: money(line.credit), credit: money(line.debit), description: line.description, ledgerAccountId: line.ledgerAccountId, treasuryAccountId: line.treasuryAccountId })),
    });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedBy: actor, voidReason: input.reason } });
    await recordAudit(tx, { hotelId, entity: 'JournalEntry', entityId: entry.id, action: 'UPDATE', before: { status: 'POSTED' }, after: { status: 'VOIDED', reason: input.reason, reversal: reversal.number } });
    await stage('ledger.changed', { hotelId, change: 'JOURNAL', journalIds: [entry.id, reversal.id] });
    return reversal.id;
  });
  const [original, reversal] = await Promise.all([getJournal(hotelId, entry.id), getJournal(hotelId, reversalId)]);
  return { entry: original.entry, lines: original.lines, reversal: reversal.entry };
}
