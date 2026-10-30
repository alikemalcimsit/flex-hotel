import { randomUUID } from 'node:crypto';
import { currentActor, runWithContext, toDecimal, toMoneyString } from '@hotelos/core';
import {
  ACCOUNTING_PAYMENT_APPROVAL_DAYS,
  APPROVAL_TYPE_LABELS,
  INSTRUMENT_KIND_LABELS,
  MAX_INSTRUMENT_TERM_DAYS,
  MAX_VOUCHER_BACKDATE_DAYS,
  VOUCHER_LINE_KIND_LABELS,
  VOUCHER_PREFIXES,
  VOUCHER_TYPE_LABELS,
  needsPaymentApproval,
  voucherEffect,
} from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockAccountingVouchers, lockInstruments, lockLedgerAccounts, lockTreasuryAccounts } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { addDays, assertCashCovers, dateOnly, day, ensureSettings, hotelContext, iso, money, nextVoucherNumber, postLedger, postTreasury, priced, prisma, reverseRecords } from './shared.js';

/**
 * Muhasebe fişleri (modül 47).
 *
 * - **Tahsilat:** cari alacaklanır (borcu düşer); para kasaya / bankaya girer ya da alınan çek / senet portföye.
 * - **Ödeme:** cari borçlanır (bizim borcumuz düşer); para kasadan / bankadan çıkar, verilen çek / senet
 *   "ödenecek" olur ya da portföydeki çek ciro edilir. Toplam onay eşiğine eşit / üstündeyse fiş dört göz
 *   onayına gider; onaylanınca (karar verenin adıyla) işlenir, reddedilirse / süresi dolarsa hiç işlenmez.
 * - **Virman:** kasa / banka arası (aynı para birimi). **Giriş / çıkış:** carisiz (masraf, banka faizi…).
 * - **Açılış bakiyesi:** başlangıç gününden bir gün önce tarihli; hesap başına bir tane (iptal edilirse yenisi).
 *
 * Kasa eksiye düşmez (elle fiş ve iptalde); banka düşebilir. Fiş iptali yalnız işlenmiş fişte, gerekçeyle ve
 * fiş tarihli ters kayıtla yapılır; fişin açtığı çek / senet ilk durumunda olmalı (tahsil edilmiş çekin
 * fişi iptal edilemez). Kilit sırası: fiş → cari → kasa / banka → çek / senet.
 */

const VOUCHER_SELECT = Object.freeze({
  id: true,
  number: true,
  type: true,
  status: true,
  date: true,
  ledgerAccountId: true,
  treasuryAccountId: true,
  targetTreasuryAccountId: true,
  amount: true,
  openingSide: true,
  dueDate: true,
  description: true,
  reference: true,
  approvalId: true,
  createdBy: true,
  createdAt: true,
  postedAt: true,
  approvedBy: true,
  declinedAt: true,
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  ledgerAccount: { select: { id: true, code: true, name: true } },
  treasuryAccount: { select: { id: true, code: true, name: true, kind: true, currency: true } },
  targetTreasury: { select: { id: true, code: true, name: true, kind: true, currency: true } },
});

const LINE_SELECT = Object.freeze({
  id: true,
  sortOrder: true,
  kind: true,
  amount: true,
  treasuryAccountId: true,
  instrumentId: true,
  instrumentKind: true,
  number: true,
  bankName: true,
  branch: true,
  drawer: true,
  dueDate: true,
  treasury: { select: { id: true, name: true, kind: true, currency: true } },
  instrument: { select: { id: true, kind: true, number: true, bankName: true, dueDate: true, status: true, amount: true } },
});

/** @param {any} row */
const voucherView = (row) => ({
  id: row.id,
  number: row.number,
  type: row.type,
  status: row.status,
  date: day(row.date),
  ledgerAccount: row.ledgerAccount,
  treasuryAccount: row.treasuryAccount,
  targetTreasury: row.targetTreasury,
  amount: money(row.amount),
  openingSide: row.openingSide,
  dueDate: day(row.dueDate),
  description: row.description,
  reference: row.reference,
  approvalId: row.approvalId,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  postedAt: iso(row.postedAt),
  approvedBy: row.approvedBy,
  declinedAt: iso(row.declinedAt),
  voidedAt: iso(row.voidedAt),
  voidedBy: row.voidedBy,
  voidReason: row.voidReason,
});

/** @param {any} line */
const lineView = (line) => ({
  id: line.id,
  sortOrder: line.sortOrder,
  kind: line.kind,
  amount: money(line.amount),
  treasury: line.treasury,
  instrument: line.instrument ? { ...line.instrument, amount: money(line.instrument.amount), dueDate: day(line.instrument.dueDate) } : null,
  instrumentKind: line.instrumentKind,
  number: line.number,
  bankName: line.bankName,
  branch: line.branch,
  drawer: line.drawer,
  dueDate: day(line.dueDate),
});

/* ─────────────── Okuma ─────────────── */

/** @param {string} hotelId @param {any} query */
export async function listVouchers(hotelId, query) {
  const context = await hotelContext(hotelId);
  /** @type {any} */
  const where = { hotelId };
  if (query.type) where.type = query.type;
  if (query.status) where.status = query.status;
  if (query.ledgerAccountId) where.ledgerAccountId = query.ledgerAccountId;
  if (query.treasuryAccountId) where.OR = [{ treasuryAccountId: query.treasuryAccountId }, { targetTreasuryAccountId: query.treasuryAccountId }, { lines: { some: { treasuryAccountId: query.treasuryAccountId } } }];
  if (query.from || query.to) where.date = { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) };
  const search = query.search?.trim();
  if (search) {
    const text = { OR: [{ number: { startsWith: search.toUpperCase() } }, { description: { contains: search, mode: 'insensitive' } }, { reference: { startsWith: search } }] };
    where.AND = [text];
  }
  const [rows, total] = await Promise.all([
    prisma.accountingVoucher.findMany({ where, select: VOUCHER_SELECT, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query) }),
    prisma.accountingVoucher.count({ where }),
  ]);
  return { ...buildPage(rows.map(voucherView), total, query), currency: context.currency };
}

/** @param {string} hotelId @param {string} voucherId */
export async function getVoucher(hotelId, voucherId) {
  const context = await hotelContext(hotelId);
  const row = await prisma.accountingVoucher.findFirst({ where: { id: voucherId, hotelId }, select: { ...VOUCHER_SELECT, lines: { select: LINE_SELECT, orderBy: { sortOrder: 'asc' } } } });
  if (!row) throw new NotFoundError('Fiş bulunamadı');
  const [entries, movements, approval] = await Promise.all([
    prisma.ledgerEntry.findMany({ where: { hotelId, voucherId }, select: { id: true, date: true, debit: true, credit: true, description: true, reversalOfId: true, account: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }),
    prisma.treasuryMovement.findMany({ where: { hotelId, voucherId }, select: { id: true, date: true, amount: true, description: true, reversalOfId: true, account: { select: { id: true, name: true, currency: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }),
    row.approvalId ? prisma.approval.findFirst({ where: { id: row.approvalId, hotelId }, select: { id: true, status: true, decidedBy: true, decidedAt: true, note: true, expiresAt: true } }) : null,
  ]);
  return {
    voucher: voucherView(row),
    lines: row.lines.map(lineView),
    entries: entries.map((entry) => ({ id: entry.id, date: day(entry.date), debit: money(entry.debit), credit: money(entry.credit), description: entry.description, reversalOfId: entry.reversalOfId, account: entry.account })),
    movements: movements.map((movement) => ({ id: movement.id, date: day(movement.date), amount: money(movement.amount), description: movement.description, reversalOfId: movement.reversalOfId, account: movement.account })),
    approval: approval ? { ...approval, decidedAt: iso(approval.decidedAt), expiresAt: iso(approval.expiresAt) } : null,
    currency: context.currency,
  };
}

/* ─────────────── Doğrulama ─────────────── */

/**
 * Fişin işlenebilirliği (oluşturmada ve onay anında aynı denetim): cari ve hesaplar etkin, para birimleri
 * uyumlu, kasa yeterli, ciro edilecek çekler portföyde ve başka fişe bağlı değil, yeni çek numaraları tekil.
 * Kilitleri çağıran almış olmalı. İşlenemiyorsa sebep metni döner.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ hotelId: string, currency: string, voucher: any, lines: any[], voucherId?: string | null, checkCash?: boolean }} input
 *   checkCash: onaya giden fişte kasa yeterliliği onay anında bakılır
 * @returns {Promise<string | null>}
 */
async function voucherProblem(tx, { hotelId, currency, voucher, lines, voucherId = null, checkCash = true }) {
  if (voucher.ledgerAccountId) {
    const account = await tx.ledgerAccount.findFirst({ where: { id: voucher.ledgerAccountId, hotelId }, select: { isActive: true, name: true } });
    if (!account) return 'Cari bulunamadı';
    if (!account.isActive) return `${account.name} carisi kullanımda değil`;
  }
  const treasuryIds = [voucher.treasuryAccountId, voucher.targetTreasuryAccountId, ...lines.map((line) => line.treasuryAccountId)].filter(Boolean);
  const accounts = await tx.treasuryAccount.findMany({ where: { hotelId, id: { in: treasuryIds } }, select: { id: true, name: true, kind: true, currency: true, isActive: true, balance: true } });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  for (const id of treasuryIds) {
    const account = byId.get(id);
    if (!account) return 'Kasa / banka hesabı bulunamadı';
    if (!account.isActive) return `${account.name} kullanımda değil`;
  }
  if (voucher.type === 'TRANSFER' && byId.get(voucher.treasuryAccountId)?.currency !== byId.get(voucher.targetTreasuryAccountId)?.currency) {
    return 'Farklı para birimli hesaplar arasında virman yapılmaz (döviz bozdurma kasa çıkışı + girişiyle)';
  }
  if (voucher.ledgerAccountId) {
    for (const line of lines.filter((candidate) => candidate.kind === 'TREASURY')) {
      const account = byId.get(line.treasuryAccountId);
      if (account.currency !== currency) return `${account.name} ${account.currency} hesabı: cari fişi ${currency} hesapla yapılır`;
    }
    for (const line of lines.filter((candidate) => candidate.kind === 'CHEQUE_OUT' && candidate.instrumentKind === 'CHEQUE')) {
      if (byId.get(line.treasuryAccountId)?.kind !== 'BANK') return 'Verilen çekin ödeneceği hesap banka olmalı';
    }
  }
  // Kasadan çıkış: hesap başına toplam (aynı kasadan iki satır).
  /** @type {Map<string, import('decimal.js').Decimal>} */
  const outflows = new Map();
  const addOut = (id, amount) => outflows.set(id, (outflows.get(id) ?? toDecimal(0)).plus(toDecimal(amount)));
  if (voucher.type === 'PAYMENT') lines.filter((line) => line.kind === 'TREASURY').forEach((line) => addOut(line.treasuryAccountId, line.amount));
  if (voucher.type === 'TRANSFER' || voucher.type === 'TREASURY_OUT') addOut(voucher.treasuryAccountId, voucher.amount);
  for (const [id, outflow] of checkCash ? outflows : []) {
    const account = byId.get(id);
    if (account.kind === 'CASH' && toDecimal(String(account.balance)).minus(outflow).isNegative()) {
      return `${account.name} kasasında yeterli bakiye yok (bakiye ${priced(account.balance, account.currency)}, çıkış ${priced(toMoneyString(outflow), account.currency)})`;
    }
  }
  const endorsed = lines.filter((line) => line.kind === 'ENDORSE');
  if (endorsed.length) {
    const instruments = await tx.instrument.findMany({ where: { hotelId, id: { in: endorsed.map((line) => line.instrumentId) } }, select: { id: true, number: true, direction: true, status: true, amount: true, ledgerAccountId: true } });
    for (const line of endorsed) {
      const instrument = instruments.find((candidate) => candidate.id === line.instrumentId);
      if (!instrument || instrument.direction !== 'RECEIVED') return 'Ciro edilecek çek / senet bulunamadı';
      if (instrument.status !== 'PORTFOLIO') return `${instrument.number} no'lu çek / senet portföyde değil`;
      if (!toDecimal(String(instrument.amount)).equals(toDecimal(line.amount))) return `${instrument.number} no'lu çek / senet tutarıyla ciro edilir (${money(instrument.amount)})`;
      if (instrument.ledgerAccountId === voucher.ledgerAccountId) return `${instrument.number} no'lu çek / senet aldığı cariye ciro edilemez (iade işlemi kullanılır)`;
      const pending = await tx.accountingVoucherLine.findFirst({
        where: { hotelId, instrumentId: instrument.id, kind: 'ENDORSE', voucher: { status: 'PENDING_APPROVAL' }, ...(voucherId ? { voucherId: { not: voucherId } } : {}) },
        select: { voucher: { select: { number: true } } },
      });
      if (pending) return `${instrument.number} no'lu çek / senet onay bekleyen ${pending.voucher.number} fişinde ciro ediliyor`;
    }
  }
  for (const line of lines.filter((candidate) => candidate.kind === 'CHEQUE_IN' || candidate.kind === 'CHEQUE_OUT')) {
    const duplicate = await tx.instrument.findFirst({
      where: { hotelId, direction: line.kind === 'CHEQUE_IN' ? 'RECEIVED' : 'ISSUED', kind: line.instrumentKind, number: line.number, bankName: line.bankName ?? null, status: { not: 'CANCELLED' } },
      select: { id: true },
    });
    if (duplicate) return `${INSTRUMENT_KIND_LABELS[line.instrumentKind]} ${line.number}${line.bankName ? ` (${line.bankName})` : ''} zaten kayıtlı`;
  }
  return null;
}

/** Fiş günü: başlangıç gününden önce, bugünden sonra ve çok eskiye olamaz. @param {string} date @param {{ today: string, startDate: string }} context */
function assertVoucherDate(date, { today, startDate }) {
  if (date > today) throw new ValidationError('Fiş tarihi bugünden sonra olamaz', { fields: { date: 'Bugünden sonra olamaz' } });
  if (date < startDate) throw new ValidationError(`Fiş tarihi muhasebe başlangıç gününden (${startDate}) önce olamaz`, { fields: { date: 'Başlangıç gününden önce' } });
  if (date < addDays(today, -MAX_VOUCHER_BACKDATE_DAYS)) throw new ValidationError(`Fiş en fazla ${MAX_VOUCHER_BACKDATE_DAYS} gün geriye girilir`, { fields: { date: 'Çok eski' } });
}

/* ─────────────── İşleme ─────────────── */

/**
 * Fişin kayıtlarını yazar (kilitler alınmış, `voucherProblem` geçmiş olmalı) ve fişi işlenmiş yapar.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage
 * @param {{ hotelId: string, voucher: any, lines: any[], actor: string }} input
 */
async function postVoucher(tx, stage, { hotelId, voucher, lines, actor }) {
  const date = day(voucher.date);
  const text = `${VOUCHER_TYPE_LABELS[voucher.type]} ${voucher.number} · ${voucher.description}`;
  const ledgerIds = new Set();
  const treasuryIds = new Set();
  const effect = voucherEffect(voucher.type, voucher.type === 'COLLECTION' || voucher.type === 'PAYMENT' ? lines.map((line) => ({ kind: line.kind, amount: money(line.amount) })) : [{ kind: 'TREASURY', amount: money(voucher.amount) }]);
  if (voucher.ledgerAccountId) {
    await postLedger(tx, {
      hotelId,
      accountId: voucher.ledgerAccountId,
      date,
      debit: effect.ledgerSide === 'DEBIT' ? effect.total : '0',
      credit: effect.ledgerSide === 'CREDIT' ? effect.total : '0',
      description: text,
      reference: voucher.reference,
      sourceType: 'VOUCHER',
      sourceId: voucher.id,
      sourceKey: `VOUCHER:${voucher.id}`,
      voucherId: voucher.id,
      createdBy: actor,
    });
    ledgerIds.add(voucher.ledgerAccountId);
  }
  for (const line of lines) {
    const amount = money(line.amount);
    if (line.kind === 'TREASURY') {
      await postTreasury(tx, {
        hotelId,
        treasuryAccountId: line.treasuryAccountId,
        date,
        amount: effect.treasurySign < 0 ? `-${amount}` : amount,
        description: text,
        reference: voucher.reference,
        ledgerAccountId: voucher.ledgerAccountId,
        sourceType: 'VOUCHER',
        sourceId: voucher.id,
        sourceKey: `VOUCHER:${voucher.id}:${line.sortOrder}`,
        voucherId: voucher.id,
        createdBy: actor,
      });
      treasuryIds.add(line.treasuryAccountId);
    } else if (line.kind === 'CHEQUE_IN' || line.kind === 'CHEQUE_OUT') {
      const received = line.kind === 'CHEQUE_IN';
      const instrument = await tx.instrument.create({
        data: {
          hotelId,
          kind: line.instrumentKind,
          direction: received ? 'RECEIVED' : 'ISSUED',
          status: received ? 'PORTFOLIO' : 'OUTSTANDING',
          number: line.number,
          bankName: line.bankName ?? null,
          branch: line.branch ?? null,
          drawer: line.drawer ?? null,
          issueDate: dateOnly(date),
          dueDate: line.dueDate,
          amount,
          currency: voucher.currency,
          ledgerAccountId: voucher.ledgerAccountId,
          treasuryAccountId: received ? null : (line.treasuryAccountId ?? null),
          voucherId: voucher.id,
          createdBy: actor,
        },
        select: { id: true },
      });
      await tx.instrumentMovement.create({
        data: { hotelId, instrumentId: instrument.id, action: received ? 'RECEIVE' : 'ISSUE', fromStatus: null, toStatus: received ? 'PORTFOLIO' : 'OUTSTANDING', date: dateOnly(date), ledgerAccountId: voucher.ledgerAccountId, voucherId: voucher.id, createdBy: actor },
      });
      await tx.accountingVoucherLine.update({ where: { id: line.id }, data: { instrumentId: instrument.id } });
      await stage('accounting.instrument.changed', { hotelId, instrumentId: instrument.id, action: received ? 'RECEIVE' : 'ISSUE' });
    } else if (line.kind === 'ENDORSE') {
      const changed = await tx.instrument.updateMany({ where: { id: line.instrumentId, hotelId, status: 'PORTFOLIO' }, data: { status: 'ENDORSED', endorsedToAccountId: voucher.ledgerAccountId } });
      if (changed.count !== 1) throw new ConflictError('Ciro edilecek çek / senet portföyde değil', 'INSTRUMENT_STATUS');
      await tx.instrumentMovement.create({
        data: { hotelId, instrumentId: line.instrumentId, action: 'ENDORSE', fromStatus: 'PORTFOLIO', toStatus: 'ENDORSED', date: dateOnly(date), ledgerAccountId: voucher.ledgerAccountId, voucherId: voucher.id, createdBy: actor },
      });
      await stage('accounting.instrument.changed', { hotelId, instrumentId: line.instrumentId, action: 'ENDORSE' });
    }
  }
  if (voucher.type === 'TRANSFER' || voucher.type === 'TREASURY_IN' || voucher.type === 'TREASURY_OUT') {
    const amount = money(voucher.amount);
    await postTreasury(tx, {
      hotelId,
      treasuryAccountId: voucher.treasuryAccountId,
      date,
      amount: voucher.type === 'TREASURY_IN' ? amount : `-${amount}`,
      description: voucher.type === 'TRANSFER' ? `${text} → ${voucher.targetName}` : text,
      reference: voucher.reference,
      sourceType: 'VOUCHER',
      sourceId: voucher.id,
      sourceKey: `VOUCHER:${voucher.id}:MAIN`,
      voucherId: voucher.id,
      createdBy: actor,
    });
    treasuryIds.add(voucher.treasuryAccountId);
    if (voucher.type === 'TRANSFER') {
      await postTreasury(tx, {
        hotelId,
        treasuryAccountId: voucher.targetTreasuryAccountId,
        date,
        amount,
        description: `${text} ← ${voucher.sourceName}`,
        reference: voucher.reference,
        sourceType: 'VOUCHER',
        sourceId: voucher.id,
        sourceKey: `VOUCHER:${voucher.id}:TARGET`,
        voucherId: voucher.id,
        createdBy: actor,
      });
      treasuryIds.add(voucher.targetTreasuryAccountId);
    }
  }
  await stage('accounting.posted', { hotelId, source: 'VOUCHER', ledgerAccountIds: [...ledgerIds], treasuryAccountIds: [...treasuryIds] });
}

/**
 * Fiş gir: tahsilat, ödeme, virman, kasa / banka giriş-çıkışı. Aynı istek kimliği ikinci fiş açmaz.
 * @param {string} hotelId @param {any} input
 */
export async function createVoucher(hotelId, input) {
  const context = await hotelContext(hotelId);
  const settings = await ensureSettings(hotelId, context.today);
  assertVoucherDate(input.date, { today: context.today, startDate: settings.startDate });
  const existing = await prisma.accountingVoucher.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } });
  if (existing) return { ...(await getVoucher(hotelId, existing.id)), created: false };
  for (const line of input.lines) {
    if ((line.kind === 'CHEQUE_IN' || line.kind === 'CHEQUE_OUT') && line.dueDate) {
      if (line.dueDate > addDays(input.date, MAX_INSTRUMENT_TERM_DAYS)) throw new ValidationError('Çek / senet vadesi çok ileri', { fields: { lines: 'Vade en fazla 3 yıl sonra' } });
      if (line.kind === 'CHEQUE_OUT' && line.dueDate < input.date) throw new ValidationError('Verilen çek / senedin vadesi fiş gününden önce olamaz', { fields: { lines: 'Vade fiş gününden önce' } });
    }
  }
  const lines = input.lines.map((line, index) => ({ ...line, sortOrder: index + 1, treasuryAccountId: line.kind === 'CHEQUE_IN' || line.kind === 'ENDORSE' ? null : (line.treasuryAccountId ?? null) }));
  const effect = voucherEffect(input.type, input.type === 'COLLECTION' || input.type === 'PAYMENT' ? lines : [{ kind: 'TREASURY', amount: input.amount }]);
  const approval = input.type === 'PAYMENT' && needsPaymentApproval(effect.total, settings.paymentApprovalAmount);
  const actor = currentActor();
  try {
    const voucherId = await writeWithEvents(async (tx, stage) => {
      const number = await nextVoucherNumber(tx, hotelId, VOUCHER_PREFIXES[input.type], input.date);
      const header = {
        type: input.type,
        ledgerAccountId: input.type === 'COLLECTION' || input.type === 'PAYMENT' ? input.ledgerAccountId : null,
        treasuryAccountId: input.type === 'COLLECTION' || input.type === 'PAYMENT' ? null : input.treasuryAccountId,
        targetTreasuryAccountId: input.type === 'TRANSFER' ? input.targetTreasuryAccountId : null,
        amount: effect.total,
      };
      if (header.ledgerAccountId) await lockLedgerAccounts(tx, hotelId, [header.ledgerAccountId]);
      await lockTreasuryAccounts(tx, hotelId, [header.treasuryAccountId, header.targetTreasuryAccountId, ...lines.map((line) => line.treasuryAccountId)].filter(Boolean));
      await lockInstruments(tx, hotelId, lines.filter((line) => line.kind === 'ENDORSE').map((line) => line.instrumentId));
      const problem = await voucherProblem(tx, { hotelId, currency: context.currency, voucher: header, lines, checkCash: !approval });
      if (problem) throw new ConflictError(problem, 'VOUCHER_NOT_POSTABLE');
      // Onaya giden fiş onay isteğiyle birlikte doğar (kısıt: onay bekleyen fişin onay isteği olmalı).
      const id = randomUUID();
      const approvalId = approval ? await openApproval(tx, stage, { hotelId, id, number, header, lines, input, total: effect.total, threshold: settings.paymentApprovalAmount, currency: context.currency, actor }) : null;
      const created = await tx.accountingVoucher.create({
        data: {
          id,
          hotelId,
          number,
          ...header,
          approvalId,
          status: approval ? 'PENDING_APPROVAL' : 'POSTED',
          date: dateOnly(input.date),
          description: input.description,
          reference: input.reference ?? null,
          requestId: input.requestId,
          createdBy: actor,
          postedAt: approval ? null : new Date(),
          lines: {
            create: lines.map((line) => ({
              hotelId,
              sortOrder: line.sortOrder,
              kind: line.kind,
              amount: line.amount,
              treasuryAccountId: line.treasuryAccountId,
              instrumentId: line.kind === 'ENDORSE' ? line.instrumentId : null,
              instrumentKind: line.kind === 'CHEQUE_IN' || line.kind === 'CHEQUE_OUT' ? line.instrumentKind : null,
              number: line.number ?? null,
              bankName: line.bankName ?? null,
              branch: line.branch ?? null,
              drawer: line.drawer ?? null,
              dueDate: line.dueDate ? dateOnly(line.dueDate) : null,
            })),
          },
        },
        select: { id: true, lines: { select: { id: true, sortOrder: true, kind: true, amount: true, treasuryAccountId: true, instrumentId: true, instrumentKind: true, number: true, bankName: true, branch: true, drawer: true, dueDate: true } } },
      });
      if (approval) {
        await stage('accounting.voucher.changed', { hotelId, voucherId: created.id, change: 'PENDING' });
      } else {
        const names = await voucherNames(tx, hotelId, header);
        await postVoucher(tx, stage, { hotelId, voucher: { ...header, ...names, id: created.id, number, date: dateOnly(input.date), description: input.description, reference: input.reference ?? null, currency: context.currency }, lines: created.lines, actor });
        await stage('accounting.voucher.changed', { hotelId, voucherId: created.id, change: 'POSTED' });
      }
      await recordAudit(tx, {
        hotelId,
        entity: 'AccountingVoucher',
        entityId: created.id,
        action: 'CREATE',
        after: { number, type: input.type, status: approval ? 'PENDING_APPROVAL' : 'POSTED', date: input.date, amount: effect.total, ledgerAccountId: header.ledgerAccountId, lines: lines.length },
      });
      return created.id;
    });
    return { ...(await getVoucher(hotelId, voucherId)), created: true };
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 'P2002') {
      const raced = await prisma.accountingVoucher.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } });
      if (raced) return { ...(await getVoucher(hotelId, raced.id)), created: false };
    }
    rethrowPrismaError(error, { uniqueMessage: 'Bu çek / senet numarası zaten kayıtlı' });
  }
}

/**
 * Eşik üstü ödeme fişinin onay isteği (fiş kaydından önce; fiş kimliği önceden üretilir). Onaylayan cariyi,
 * bakiyesini ve satırları görür.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage @param {any} input
 */
async function openApproval(tx, stage, { hotelId, id, number, header, lines, input, total, threshold, currency, actor }) {
  const account = await tx.ledgerAccount.findFirst({ where: { id: header.ledgerAccountId, hotelId }, select: { name: true, balance: true } });
  const { approvalId } = await requestApproval(tx, stage, {
    hotelId,
    type: 'ACCOUNTING_PAYMENT',
    summary: `Ödeme fişi ${number}: ${account?.name ?? ''} — ${priced(total, currency)}`.slice(0, 200),
    reason: `Ödeme tutarı onay eşiğine (${priced(threshold, currency)}) eşit ya da üstünde`,
    amount: total,
    currency,
    data: {
      Cari: account?.name ?? '—',
      'Cari bakiyesi': priced(account?.balance ?? 0, currency),
      Tarih: input.date,
      Açıklama: input.description,
      Satırlar: lines.map((line) => `${VOUCHER_LINE_KIND_LABELS[line.kind]} ${priced(line.amount, currency)}`).join(' · ').slice(0, 500),
      ...(input.reference ? { 'Belge no': input.reference } : {}),
      İsteyen: actor,
    },
    entityType: 'AccountingVoucher',
    entityId: id,
    requestedBy: actor,
    expiresInMs: ACCOUNTING_PAYMENT_APPROVAL_DAYS * 86_400_000,
  });
  return approvalId;
}

/** Virman metinleri için hesap adları. @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {any} header */
async function voucherNames(tx, hotelId, header) {
  if (header.type !== 'TRANSFER') return {};
  const accounts = await tx.treasuryAccount.findMany({ where: { hotelId, id: { in: [header.treasuryAccountId, header.targetTreasuryAccountId] } }, select: { id: true, name: true } });
  return { sourceName: accounts.find((account) => account.id === header.treasuryAccountId)?.name, targetName: accounts.find((account) => account.id === header.targetTreasuryAccountId)?.name };
}

/**
 * Açılış bakiyesi (başlangıç gününden bir gün önce): cariye borç / alacak, kasa / bankaya giriş. Hesap başına
 * bir tane; düzeltmek için iptal edilip yeniden girilir.
 * @param {string} hotelId @param {any} input
 */
export async function createOpening(hotelId, input) {
  const context = await hotelContext(hotelId);
  const settings = await ensureSettings(hotelId, context.today);
  const date = addDays(settings.startDate, -1);
  const existing = await prisma.accountingVoucher.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } });
  if (existing) return { ...(await getVoucher(hotelId, existing.id)), created: false };
  if (input.treasuryAccountId && input.side !== 'DEBIT') throw new ValidationError('Kasa / banka açılışı giriş olarak yazılır (eksi bakiye için başlangıç gününde çıkış fişi)', { fields: { side: 'Yalnız borç (giriş)' } });
  const actor = currentActor();
  try {
    const voucherId = await writeWithEvents(async (tx, stage) => {
      if (input.ledgerAccountId) await lockLedgerAccounts(tx, hotelId, [input.ledgerAccountId]);
      if (input.treasuryAccountId) await lockTreasuryAccounts(tx, hotelId, [input.treasuryAccountId]);
      const target = input.ledgerAccountId
        ? await tx.ledgerAccount.findFirst({ where: { id: input.ledgerAccountId, hotelId }, select: { id: true, name: true, isActive: true } })
        : await tx.treasuryAccount.findFirst({ where: { id: input.treasuryAccountId, hotelId }, select: { id: true, name: true, isActive: true } });
      if (!target) throw new NotFoundError(input.ledgerAccountId ? 'Cari bulunamadı' : 'Kasa / banka hesabı bulunamadı');
      const opened = await tx.accountingVoucher.findFirst({
        where: { hotelId, type: 'OPENING', status: { not: 'VOIDED' }, ...(input.ledgerAccountId ? { ledgerAccountId: input.ledgerAccountId } : { treasuryAccountId: input.treasuryAccountId }) },
        select: { number: true },
      });
      if (opened) throw new ConflictError(`${target.name} için açılış bakiyesi zaten girilmiş (${opened.number}); düzeltmek için önce iptal edin`, 'OPENING_EXISTS');
      const number = await nextVoucherNumber(tx, hotelId, VOUCHER_PREFIXES.OPENING, date);
      const description = input.description ?? `${target.name} açılış bakiyesi`;
      const created = await tx.accountingVoucher.create({
        data: {
          hotelId,
          number,
          type: 'OPENING',
          status: 'POSTED',
          date: dateOnly(date),
          ledgerAccountId: input.ledgerAccountId ?? null,
          treasuryAccountId: input.treasuryAccountId ?? null,
          amount: input.amount,
          openingSide: input.ledgerAccountId ? input.side : null,
          dueDate: input.ledgerAccountId && input.dueDate ? dateOnly(input.dueDate) : null,
          description,
          requestId: input.requestId,
          createdBy: actor,
          postedAt: new Date(),
        },
        select: { id: true },
      });
      if (input.ledgerAccountId) {
        await postLedger(tx, {
          hotelId,
          accountId: input.ledgerAccountId,
          date,
          dueDate: input.side === 'DEBIT' ? (input.dueDate ?? date) : null,
          debit: input.side === 'DEBIT' ? input.amount : '0',
          credit: input.side === 'CREDIT' ? input.amount : '0',
          description: `Açılış bakiyesi ${number} · ${description}`,
          sourceType: 'OPENING',
          sourceId: created.id,
          sourceKey: `VOUCHER:${created.id}`,
          voucherId: created.id,
          createdBy: actor,
        });
      } else {
        await postTreasury(tx, {
          hotelId,
          treasuryAccountId: input.treasuryAccountId,
          date,
          amount: input.amount,
          description: `Açılış bakiyesi ${number} · ${description}`,
          sourceType: 'OPENING',
          sourceId: created.id,
          sourceKey: `VOUCHER:${created.id}:MAIN`,
          voucherId: created.id,
          createdBy: actor,
        });
      }
      await recordAudit(tx, { hotelId, entity: 'AccountingVoucher', entityId: created.id, action: 'CREATE', after: { number, type: 'OPENING', date, amount: input.amount, side: input.side, target: target.name } });
      await stage('accounting.posted', { hotelId, source: 'OPENING', ledgerAccountIds: input.ledgerAccountId ? [input.ledgerAccountId] : [], treasuryAccountIds: input.treasuryAccountId ? [input.treasuryAccountId] : [] });
      await stage('accounting.voucher.changed', { hotelId, voucherId: created.id, change: 'POSTED' });
      return created.id;
    });
    return { ...(await getVoucher(hotelId, voucherId)), created: true };
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu hesabın açılış bakiyesi zaten girilmiş' });
  }
}

/**
 * Fiş iptali (işlenmiş fiş): fiş tarihli ters kayıtlar; fişin açtığı çek / senet iptal, ciro geri alınır.
 * Kasaya giriş yazmış fişin iptali kasayı eksiye düşüremez.
 * @param {string} hotelId @param {string} voucherId @param {{ reason: string }} input
 */
export async function voidVoucher(hotelId, voucherId, { reason }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockAccountingVouchers(tx, hotelId, [voucherId])).has(voucherId)) throw new NotFoundError('Fiş bulunamadı');
    const voucher = await tx.accountingVoucher.findFirst({ where: { id: voucherId, hotelId }, select: { ...VOUCHER_SELECT, lines: { select: LINE_SELECT } } });
    if (!voucher) throw new NotFoundError('Fiş bulunamadı');
    if (voucher.status !== 'POSTED') throw new ConflictError('Yalnız işlenmiş fiş iptal edilir (onay bekleyen fiş onay kuyruğundan reddedilir)', 'VOUCHER_STATUS');
    const [entries, movements] = await Promise.all([
      tx.ledgerEntry.findMany({ where: { hotelId, voucherId, reversalOfId: null }, select: { id: true, accountId: true } }),
      tx.treasuryMovement.findMany({ where: { hotelId, voucherId, reversalOfId: null }, select: { id: true, treasuryAccountId: true, amount: true } }),
    ]);
    await lockLedgerAccounts(tx, hotelId, entries.map((entry) => entry.accountId));
    await lockTreasuryAccounts(tx, hotelId, movements.map((movement) => movement.treasuryAccountId));
    const created = await tx.instrument.findMany({ where: { hotelId, voucherId }, select: { id: true, number: true, direction: true, status: true } });
    const endorsed = voucher.lines.filter((line) => line.kind === 'ENDORSE').map((line) => line.instrumentId);
    await lockInstruments(tx, hotelId, [...created.map((row) => row.id), ...endorsed]);
    for (const instrument of created) {
      const initial = instrument.direction === 'RECEIVED' ? 'PORTFOLIO' : 'OUTSTANDING';
      const current = await tx.instrument.findFirst({ where: { id: instrument.id, hotelId }, select: { status: true } });
      if (current?.status !== initial) throw new ConflictError(`${instrument.number} no'lu çek / senet işlem görmüş (${current?.status}); fiş iptal edilemez`, 'INSTRUMENT_PROGRESSED');
    }
    for (const instrumentId of endorsed) {
      const current = await tx.instrument.findFirst({ where: { id: instrumentId, hotelId }, select: { status: true, number: true, endorsedToAccountId: true } });
      if (current?.status !== 'ENDORSED' || current.endorsedToAccountId !== voucher.ledgerAccountId) {
        throw new ConflictError(`${current?.number ?? ''} no'lu çek / senet ciro sonrası işlem görmüş; fiş iptal edilemez`, 'INSTRUMENT_PROGRESSED');
      }
    }
    // Girişin iptali kasadan çıkış demek: kasa hesap başına yetmeli.
    /** @type {Map<string, import('decimal.js').Decimal>} */
    const outflows = new Map();
    for (const movement of movements) {
      const amount = toDecimal(String(movement.amount));
      if (amount.greaterThan(0)) outflows.set(movement.treasuryAccountId, (outflows.get(movement.treasuryAccountId) ?? toDecimal(0)).plus(amount));
    }
    for (const [id, outflow] of outflows) await assertCashCovers(tx, hotelId, id, toMoneyString(outflow));
    const date = day(voucher.date);
    const reversed = await reverseRecords(tx, hotelId, { ledgerEntryIds: entries.map((entry) => entry.id), treasuryMovementIds: movements.map((movement) => movement.id), date, note: `${voucher.number} iptali` });
    for (const instrument of created) {
      await tx.instrument.update({ where: { id: instrument.id }, data: { status: 'CANCELLED' } });
      await tx.instrumentMovement.create({ data: { hotelId, instrumentId: instrument.id, action: 'CANCEL', fromStatus: instrument.status, toStatus: 'CANCELLED', date: dateOnly(date), voucherId, note: reason, createdBy: actor } });
      await stage('accounting.instrument.changed', { hotelId, instrumentId: instrument.id, action: 'CANCEL' });
    }
    for (const instrumentId of endorsed) {
      await tx.instrument.update({ where: { id: instrumentId }, data: { status: 'PORTFOLIO', endorsedToAccountId: null } });
      await tx.instrumentMovement.create({ data: { hotelId, instrumentId, action: 'CANCEL', fromStatus: 'ENDORSED', toStatus: 'PORTFOLIO', date: dateOnly(date), voucherId, note: `Ciro iptal edildi: ${reason}`, createdBy: actor } });
      await stage('accounting.instrument.changed', { hotelId, instrumentId, action: 'CANCEL' });
    }
    await tx.accountingVoucher.update({ where: { id: voucherId }, data: { status: 'VOIDED', voidedAt: new Date(), voidedBy: actor, voidReason: reason } });
    await recordAudit(tx, { hotelId, entity: 'AccountingVoucher', entityId: voucherId, action: 'UPDATE', before: { status: 'POSTED' }, after: { status: 'VOIDED', reason, number: voucher.number, reversed: reversed.ledger + reversed.treasury } });
    await stage('accounting.posted', { hotelId, source: 'VOID', ledgerAccountIds: reversed.ledgerAccountIds, treasuryAccountIds: reversed.treasuryAccountIds });
    await stage('accounting.voucher.changed', { hotelId, voucherId, change: 'VOIDED' });
  });
  return getVoucher(hotelId, voucherId);
}

/* ─────────────── Onay kararı ─────────────── */

/**
 * Onay kuyruğunun kararı (dinleyiciden): onaylandıysa fiş karar verenin adıyla işlenir — işlenemiyorsa (kasa
 * yetmiyor, çek bu arada kullanıldı) reddedilmiş sayılır ve sebebi isteyene gider; reddedildi / süresi
 * dolduysa hiç işlenmez. Aynı haber iki kez gelse de bir kez uygulanır.
 *
 * @param {{ hotelId: string, approvalId: string, type: string }} payload @param {{ name: string }} envelope
 */
export async function applyVoucherDecision(payload, envelope) {
  if (payload.type !== 'ACCOUNTING_PAYMENT') return { handled: false };
  const hotelId = payload.hotelId;
  const approval = await prismaUnfiltered.approval.findFirst({
    where: { id: payload.approvalId, hotelId },
    select: { id: true, type: true, entityId: true, requestedBy: true, decidedBy: true, note: true, summary: true },
  });
  if (!approval?.entityId) return { handled: false };
  const context = await hotelContext(hotelId);
  const granted = envelope.name === 'approval.granted';
  const outcome = await writeWithEvents(async (tx, stage) => {
    if (!(await lockAccountingVouchers(tx, hotelId, [approval.entityId])).has(approval.entityId)) return { stale: true };
    const voucher = await tx.accountingVoucher.findFirst({ where: { id: approval.entityId, hotelId }, select: { ...VOUCHER_SELECT, lines: { select: LINE_SELECT, orderBy: { sortOrder: 'asc' } } } });
    if (!voucher || voucher.status !== 'PENDING_APPROVAL' || voucher.approvalId !== approval.id) return { stale: true };
    let problem = granted ? null : envelope.name === 'approval.denied' ? `Reddedildi: ${approval.note ?? '—'}` : 'Onayın süresi doldu';
    if (granted) {
      await lockLedgerAccounts(tx, hotelId, [voucher.ledgerAccountId]);
      await lockTreasuryAccounts(tx, hotelId, voucher.lines.map((line) => line.treasuryAccountId).filter(Boolean));
      await lockInstruments(tx, hotelId, voucher.lines.filter((line) => line.kind === 'ENDORSE').map((line) => line.instrumentId));
      const lines = voucher.lines.map((line) => ({ ...line, amount: money(line.amount), dueDate: day(line.dueDate) }));
      problem = await voucherProblem(tx, { hotelId, currency: context.currency, voucher, lines, voucherId: voucher.id });
      if (!problem) {
        await postVoucher(tx, stage, { hotelId, voucher: { ...voucher, currency: context.currency }, lines: voucher.lines, actor: approval.decidedBy ?? 'system' });
        await tx.accountingVoucher.update({ where: { id: voucher.id }, data: { status: 'POSTED', postedAt: new Date(), approvedBy: approval.decidedBy } });
        await recordAudit(tx, { hotelId, entity: 'AccountingVoucher', entityId: voucher.id, action: 'UPDATE', before: { status: 'PENDING_APPROVAL' }, after: { status: 'POSTED', approvedBy: approval.decidedBy, approvalId: approval.id } });
        await stage('accounting.voucher.changed', { hotelId, voucherId: voucher.id, change: 'APPROVED' });
        return { applied: true };
      }
    }
    await tx.accountingVoucher.update({ where: { id: voucher.id }, data: { status: 'DECLINED', declinedAt: new Date() } });
    await recordAudit(tx, { hotelId, entity: 'AccountingVoucher', entityId: voucher.id, action: 'UPDATE', before: { status: 'PENDING_APPROVAL' }, after: { status: 'DECLINED', reason: problem, approvalId: approval.id } });
    await stage('accounting.voucher.changed', { hotelId, voucherId: voucher.id, change: 'DECLINED' });
    return { applied: false, problem };
  });
  if (!outcome.stale) await alertRequester(hotelId, approval, envelope.name, approval.entityId, outcome.applied ? null : outcome.problem);
  return { handled: true, applied: Boolean(outcome.applied) };
}

/** @param {string} hotelId @param {any} approval @param {string} outcome @param {string} voucherId @param {string | null} problem */
async function alertRequester(hotelId, approval, outcome, voucherId, problem) {
  const staff = approval.requestedBy?.includes('@') ? await findActiveStaffByEmail(prismaUnfiltered, hotelId, approval.requestedBy.toLowerCase()) : null;
  const label = APPROVAL_TYPE_LABELS[approval.type] ?? 'Onay';
  const applied = outcome === 'approval.granted' && !problem;
  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'APPROVAL_DECIDED',
      severity: applied ? 'INFO' : 'WARNING',
      title: `${label} ${applied ? 'onaylandı ve işlendi' : outcome === 'approval.granted' ? 'onaylandı ama işlenemedi' : outcome === 'approval.denied' ? 'reddedildi' : 'süresi doldu'}: ${approval.summary}`.slice(0, 200),
      body: applied ? 'Ödeme cariye ve kasaya / bankaya işlendi.' : `${problem ?? ''} Fiş işlenmedi; gerekirse yeniden girin.`.trim(),
      link: `/muhasebe/fisler/${voucherId}`,
      userId: staff?.id ?? null,
      permission: staff ? null : PERMISSIONS.ACCOUNTING_MANAGE,
      entityType: 'Approval',
      entityId: approval.id,
      dedupeKey: `approval-decided:${approval.id}`,
    }),
  );
}

/**
 * Dinleyici girişi: kararı veren kişinin bağlamında çalıştırır.
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload @param {{ id: string, name: string, correlationId?: string }} envelope
 */
export function onAccountingApprovalDecision(payload, envelope) {
  if (payload?.type !== 'ACCOUNTING_PAYMENT') return Promise.resolve({ handled: false });
  return runWithContext({ correlationId: envelope.correlationId, causationId: envelope.id, actor: payload.decidedBy ?? 'system' }, () => applyVoucherDecision(payload, envelope));
}
