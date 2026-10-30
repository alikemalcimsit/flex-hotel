import { Prisma } from '@prisma/client';
import { toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import { LEDGER_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, TREASURY_CHANNEL_LABELS, resolveTreasuryMapping } from '@hotelos/hotel-contracts';
import { getBusinessDate } from '../../lib/business-date.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { lockLedgerAccounts, lockTreasuryAccounts } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { amountDue } from '../banquet/rules.js';
import { addDays, dateOnly, day, dotted, ensurePartnerAccount, ensureSettings, hotelContext, money, postLedger, postTreasury, prisma } from './shared.js';

/**
 * Otomatik kayıtlar (modül 47): ödeme, etkinlik, restoran, mal kabul, prim ve etkinlik bedeli olaylarından
 * cari ve kasa / banka hareketi. Her fonksiyon **kaynak belgeden** okur (olayın yükünden değil) ve
 * **idempotenttir**: aynı belge için ikinci çağrı bir şey yazmaz (kaynak anahtarı tekil). Muhasebe aktörü
 * olaylarda, "eksik kayıtları eşitle" ekranı dönem taramasında aynı fonksiyonları çağırır.
 *
 * Kurallar:
 * - Başlangıç gününden (dahil) önceki belge işlenmez (açılış bakiyesiyle gelir). İptal kaydı, asıl satır
 *   işlenmişse işlenir; asıl satır başlangıçtan önceyse ikisi de işlenmez.
 * - Kasa / bankaya giden yöntem eşlemeden hesabını bulur; eşleme yoksa ya da hesabın para birimi tutmuyorsa
 *   iş anlamlı hatayla durur (aktör kapalıysa manuel görev; eşleme düzeltilip eşitleme çalıştırılır).
 * - "Acente / cari" ve voucher: folyoya giren tutar (otel para birimi) seçilen cariye borç yazılır, vadesi
 *   carinin vadesiyle. Etkinlik ve prim **fark kaydıyla** eşitlenir: yazılmış toplam hedeften farklıysa fark yazılır.
 */

/** İş kuralı hatası (yeniden denemekle düzelmez): aktör beklemeden manuel göreve düşürür. */
class PostingError extends AppError {
  constructor(message, code = 'ACCOUNTING_POSTING') {
    super(message, { statusCode: 409, code });
  }
}

/**
 * Okuma belleği: otel bağlamı (iş günü, para birimi, başlangıç günü) ve kanal × yöntem × para birimi → kasa / banka
 * çözümü. Olay akışında her belge taze bellekle başlar; dönem eşitlemesi tek belleği bütün belgelerde paylaşır
 * (belge başına tekrar sorgu yok — eşitleme süre sınırlı olduğundan bayatlık en fazla o kadar).
 *
 * @typedef {{ context: Promise<{ today: string, currency: string, timezone: string, startDate: string }> | null, treasury: Map<string, Promise<{ id: string, name: string, currency: string, isActive: boolean }>> }} PostingMemo
 */

/** @returns {PostingMemo} */
const newMemo = () => ({ context: null, treasury: new Map() });

/** @param {string} hotelId @param {PostingMemo} memo */
function accountingContext(hotelId, memo) {
  memo.context ??= (async () => {
    const context = await hotelContext(hotelId);
    const settings = await ensureSettings(hotelId, context.today);
    return { today: context.today, currency: context.currency, timezone: context.timezone, startDate: settings.startDate };
  })();
  return memo.context;
}

/** @param {string} hotelId @param {Date} at */
const businessDayOf = async (hotelId, at) => toIsoDay(await getBusinessDate(hotelId, at));

/** Konaklamanın kısa adı: "101 · Ayşe Demir". @param {any} reservation */
const stayLabel = (reservation) => [reservation?.room?.number, reservation?.guest ? `${reservation.guest.firstName} ${reservation.guest.lastName}` : null].filter(Boolean).join(' · ');

/**
 * Kanal × yöntem × para birimi → kasa / banka hesabı (etkin); sonuç (hata dahil) bellekte tutulur.
 * @param {string} hotelId @param {string} channel @param {string} method @param {string} currency @param {PostingMemo} memo
 */
function mappedTreasury(hotelId, channel, method, currency, memo) {
  const key = `${channel}|${method}|${currency}`;
  let account = memo.treasury.get(key);
  if (!account) {
    account = resolveTreasury(hotelId, channel, method, currency);
    memo.treasury.set(key, account);
  }
  return account;
}

/** @param {string} hotelId @param {string} channel @param {string} method @param {string} currency */
async function resolveTreasury(hotelId, channel, method, currency) {
  const mappings = await prisma.treasuryMapping.findMany({ where: { hotelId, channel }, select: { channel: true, method: true, currency: true, treasuryAccountId: true } });
  const accountId = resolveTreasuryMapping(mappings, { channel, method, currency });
  if (!accountId) {
    throw new PostingError(`${TREASURY_CHANNEL_LABELS[channel]} · ${PAYMENT_METHOD_LABELS[method] ?? method} · ${currency} için kasa / banka eşlemesi yok: Muhasebe → Ayarlar → Eşleme`, 'TREASURY_MAPPING_MISSING');
  }
  const account = await prisma.treasuryAccount.findFirst({ where: { id: accountId, hotelId }, select: { id: true, name: true, currency: true, isActive: true } });
  if (!account?.isActive) throw new PostingError(`Eşlenen hesap (${account?.name ?? 'silinmiş'}) kullanımda değil: eşlemeyi güncelleyin`, 'TREASURY_INACTIVE');
  return account;
}

/**
 * Tahsilatın hesaba gireceği tutar: hesap ödemenin para birimindeyse ödemenin tutarı; otelin para
 * birimindeyse (döviz nakit TRY kasaya) çevrilmiş tutar ve kaynak döviz bilgisi.
 *
 * @param {{ currency: string, name: string }} account
 * @param {{ amount: string, currency: string, converted: string, rate: string | null }} payment converted: otel para birimindeki karşılık
 * @param {string} hotelCurrency
 */
function treasuryAmount(account, payment, hotelCurrency) {
  if (account.currency === payment.currency) return { amount: payment.amount, originalAmount: null, originalCurrency: null, exchangeRate: null };
  if (account.currency === hotelCurrency && payment.rate) {
    return { amount: payment.converted, originalAmount: payment.amount, originalCurrency: payment.currency, exchangeRate: payment.rate };
  }
  throw new PostingError(`${account.name} ${account.currency} hesabı; ${payment.currency} tahsilat için ${payment.currency} hesabı eşleyin`, 'TREASURY_CURRENCY');
}

/** İki kaynak anahtarından biri yazılmış mı (asıl satırın işlenip işlenmediği). @param {string} hotelId @param {string} sourceKey */
async function isPosted(hotelId, sourceKey) {
  const [entry, movement] = await Promise.all([
    prisma.ledgerEntry.findFirst({ where: { hotelId, sourceKey }, select: { id: true } }),
    prisma.treasuryMovement.findFirst({ where: { hotelId, sourceKey }, select: { id: true } }),
  ]);
  return Boolean(entry || movement);
}

/* ═══════════════ Folyo ödemesi (modül 17) ═══════════════ */

const FOLIO_PAYMENT_SELECT = Object.freeze({
  id: true,
  kind: true,
  status: true,
  method: true,
  amount: true,
  currency: true,
  exchangeRate: true,
  folioAmount: true,
  businessDate: true,
  reference: true,
  ledgerAccountId: true,
  reversalOfId: true,
  folio: { select: { currency: true } },
  reservation: { select: { agencyId: true, confirmationCode: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } } },
  reversal: { select: { id: true } },
});

/**
 * Folyo ödemesini (ve iptal kaydını) işler: kasaya / bankaya ya da seçilen cariye.
 * @param {string} hotelId @param {string} paymentId tahsilat, iade ya da iptal satırı @param {PostingMemo} [memo]
 */
export async function syncFolioPayment(hotelId, paymentId, memo = newMemo()) {
  const context = await accountingContext(hotelId, memo);
  const row = await prisma.payment.findFirst({ where: { id: paymentId, hotelId }, select: FOLIO_PAYMENT_SELECT });
  if (!row) throw new NotFoundError('Ödeme bulunamadı');
  const original = row.reversalOfId ? await prisma.payment.findFirst({ where: { id: row.reversalOfId, hotelId }, select: FOLIO_PAYMENT_SELECT }) : row;
  if (!original) throw new NotFoundError('Asıl ödeme bulunamadı');
  const reversal = original.reversal ? await prisma.payment.findFirst({ where: { id: original.reversal.id, hotelId }, select: FOLIO_PAYMENT_SELECT }) : null;
  const results = [await postFolioPaymentRow(context, hotelId, original, null, memo)];
  if (reversal) results.push(await postFolioPaymentRow(context, hotelId, reversal, original, memo));
  return summarize(results);
}

/** @param {any} context @param {string} hotelId @param {any} row @param {any | null} original iptal satırıysa asıl satır @param {PostingMemo} memo */
async function postFolioPaymentRow(context, hotelId, row, original, memo) {
  const toLedger = LEDGER_PAYMENT_METHODS.includes(row.method);
  // "Acente / cari" ve voucher tahsilat değil: folyonun borcu cariye aktarılır.
  const label = toLedger
    ? row.kind === 'REVERSAL' ? 'Cari aktarımı iptali' : row.kind === 'REFUND' ? 'Cari aktarımından iade' : 'Folyo cariye aktarıldı'
    : row.kind === 'REVERSAL' ? 'Folyo ödeme iptali' : row.kind === 'REFUND' ? 'Folyo iadesi' : 'Folyo tahsilatı';
  if (row.status !== 'POSTED') return { skipped: `${label}: işlenmemiş (onay bekliyor / reddedildi)` };
  const date = day(row.businessDate);
  if (date < context.startDate) return { skipped: `${label}: başlangıç gününden önce (${date})` };
  if (original && !(await isPosted(hotelId, `PAYMENT:${original.id}`))) return { skipped: `${label}: asıl ödeme muhasebeye işlenmemiş` };
  const sourceKey = `PAYMENT:${row.id}`;
  const stay = stayLabel(row.reservation);
  const method = PAYMENT_METHOD_LABELS[row.method] ?? row.method;
  const description = `${label} · ${stay || row.reservation?.confirmationCode || ''} · ${method}`.replace(/ · ·/g, ' ·');

  if (toLedger) {
    const amount = toDecimal(String(row.folioAmount));
    return writeWithEvents(async (tx, stage) => {
      const ledgerAccountId = original?.ledgerAccountId ?? row.ledgerAccountId;
      const agencyId = (original ?? row).reservation?.agencyId;
      const account = ledgerAccountId
        ? await tx.ledgerAccount.findFirst({ where: { id: ledgerAccountId, hotelId }, select: { id: true, name: true, paymentTermDays: true } })
        : agencyId
          ? await ensurePartnerAccount(tx, hotelId, { agencyId })
          : null;
      if (!account) throw new PostingError(`${description}: cari hesap seçilmemiş ve rezervasyonun acentesi yok`, 'LEDGER_ACCOUNT_MISSING');
      await lockLedgerAccounts(tx, hotelId, [account.id]);
      const posted = await postLedger(tx, {
        hotelId,
        accountId: account.id,
        date,
        dueDate: amount.greaterThan(0) ? addDays(date, account.paymentTermDays) : null,
        debit: amount.greaterThan(0) ? toMoneyString(amount) : '0',
        credit: amount.greaterThan(0) ? '0' : toMoneyString(amount.negated()),
        description,
        reference: row.reference,
        sourceType: 'FOLIO_TRANSFER',
        sourceId: row.id,
        sourceKey,
      });
      if (posted.created) await stage('accounting.posted', { hotelId, source: 'FOLIO_TRANSFER', ledgerAccountIds: [account.id], treasuryAccountIds: [] });
      return { posted: posted.created, message: posted.created ? `${description} → ${account.name} carisine ${money(amount.abs())} ${context.currency}` : null };
    });
  }

  const currency = row.currency;
  const account = await mappedTreasury(hotelId, 'FRONT_DESK', row.method, currency, memo);
  const amounts = treasuryAmount(account, { amount: money(row.amount), currency, converted: money(row.folioAmount), rate: row.exchangeRate === null ? null : String(row.exchangeRate) }, row.folio?.currency ?? context.currency);
  return writeWithEvents(async (tx, stage) => {
    await lockTreasuryAccounts(tx, hotelId, [account.id]);
    const posted = await postTreasury(tx, { hotelId, treasuryAccountId: account.id, date, ...amounts, description, reference: row.reference, sourceType: 'FOLIO_PAYMENT', sourceId: row.id, sourceKey });
    if (posted.created) await stage('accounting.posted', { hotelId, source: 'FOLIO_PAYMENT', ledgerAccountIds: [], treasuryAccountIds: [account.id] });
    return { posted: posted.created, message: posted.created ? `${description} → ${account.name} (${amounts.amount} ${account.currency})` : null };
  });
}

/* ═══════════════ Etkinlik ödemesi (modül 37) ═══════════════ */

const EVENT_PAYMENT_SELECT = Object.freeze({
  id: true,
  kind: true,
  status: true,
  method: true,
  amount: true,
  currency: true,
  businessDate: true,
  reference: true,
  reversalOfId: true,
  event: { select: { id: true, code: true, name: true, clientId: true } },
  reversal: { select: { id: true } },
});

/**
 * Etkinlik tahsilatı: kasaya / bankaya girer, etkinlik müşterisinin carisinden düşer (iade tersi).
 * @param {string} hotelId @param {string} paymentId @param {PostingMemo} [memo]
 */
export async function syncEventPayment(hotelId, paymentId, memo = newMemo()) {
  const context = await accountingContext(hotelId, memo);
  const row = await prisma.eventPayment.findFirst({ where: { id: paymentId, hotelId }, select: EVENT_PAYMENT_SELECT });
  if (!row) throw new NotFoundError('Etkinlik ödemesi bulunamadı');
  const original = row.reversalOfId ? await prisma.eventPayment.findFirst({ where: { id: row.reversalOfId, hotelId }, select: EVENT_PAYMENT_SELECT }) : row;
  if (!original) throw new NotFoundError('Asıl ödeme bulunamadı');
  const reversal = original.reversal ? await prisma.eventPayment.findFirst({ where: { id: original.reversal.id, hotelId }, select: EVENT_PAYMENT_SELECT }) : null;
  const results = [await postEventPaymentRow(context, hotelId, original, null, memo)];
  if (reversal) results.push(await postEventPaymentRow(context, hotelId, reversal, original, memo));
  return summarize(results);
}

/** @param {any} context @param {string} hotelId @param {any} row @param {any | null} original @param {PostingMemo} memo */
async function postEventPaymentRow(context, hotelId, row, original, memo) {
  const label = row.kind === 'REVERSAL' ? 'Etkinlik ödeme iptali' : row.kind === 'REFUND' ? 'Etkinlik iadesi' : 'Etkinlik tahsilatı';
  if (row.status !== 'POSTED') return { skipped: `${label}: işlenmemiş (onay bekliyor / reddedildi)` };
  const date = day(row.businessDate);
  if (date < context.startDate) return { skipped: `${label}: başlangıç gününden önce (${date})` };
  if (original && !(await isPosted(hotelId, `EVENT_PAYMENT:${original.id}`))) return { skipped: `${label}: asıl ödeme muhasebeye işlenmemiş` };
  if (LEDGER_PAYMENT_METHODS.includes(row.method)) return { skipped: `${label}: cari yöntemi (kasa ve cari etkisi yok)` };
  const description = `${label} · ${row.event.code} ${row.event.name} · ${PAYMENT_METHOD_LABELS[row.method] ?? row.method}`;
  const sourceKey = `EVENT_PAYMENT:${row.id}`;
  const amount = toDecimal(String(row.amount));
  const treasury = await mappedTreasury(hotelId, 'BANQUET', row.method, row.currency, memo);
  const amounts = treasuryAmount(treasury, { amount: money(row.amount), currency: row.currency, converted: money(row.amount), rate: null }, context.currency);
  return writeWithEvents(async (tx, stage) => {
    const account = await ensurePartnerAccount(tx, hotelId, { eventClientId: row.event.clientId });
    await lockLedgerAccounts(tx, hotelId, [account.id]);
    await lockTreasuryAccounts(tx, hotelId, [treasury.id]);
    const ledger = await postLedger(tx, {
      hotelId,
      accountId: account.id,
      date,
      debit: amount.greaterThan(0) ? '0' : toMoneyString(amount.negated()),
      credit: amount.greaterThan(0) ? toMoneyString(amount) : '0',
      description,
      reference: row.reference,
      sourceType: 'EVENT_PAYMENT',
      sourceId: row.id,
      sourceKey,
    });
    const movement = await postTreasury(tx, {
      hotelId,
      treasuryAccountId: treasury.id,
      date,
      ...amounts,
      description,
      reference: row.reference,
      ledgerAccountId: account.id,
      sourceType: 'EVENT_PAYMENT',
      sourceId: row.id,
      sourceKey,
    });
    const created = ledger.created || movement.created;
    if (created) await stage('accounting.posted', { hotelId, source: 'EVENT_PAYMENT', ledgerAccountIds: [account.id], treasuryAccountIds: [treasury.id] });
    return { posted: created, message: created ? `${description} → ${treasury.name}, ${account.name} carisi` : null };
  });
}

/* ═══════════════ Restoran / oda servisi ödemesi (modül 39 / 41) ═══════════════ */

const POS_PAYMENT_SELECT = Object.freeze({
  id: true,
  kind: true,
  status: true,
  method: true,
  amount: true,
  currency: true,
  businessDate: true,
  reference: true,
  reversalOfId: true,
  check: { select: { number: true, outlet: { select: { name: true } } } },
  reversal: { select: { id: true } },
});

/** @param {string} hotelId @param {string} paymentId @param {PostingMemo} [memo] */
export async function syncPosPayment(hotelId, paymentId, memo = newMemo()) {
  const context = await accountingContext(hotelId, memo);
  const row = await prisma.posPayment.findFirst({ where: { id: paymentId, hotelId }, select: POS_PAYMENT_SELECT });
  if (!row) throw new NotFoundError('Restoran ödemesi bulunamadı');
  const original = row.reversalOfId ? await prisma.posPayment.findFirst({ where: { id: row.reversalOfId, hotelId }, select: POS_PAYMENT_SELECT }) : row;
  if (!original) throw new NotFoundError('Asıl ödeme bulunamadı');
  const reversal = original.reversal ? await prisma.posPayment.findFirst({ where: { id: original.reversal.id, hotelId }, select: POS_PAYMENT_SELECT }) : null;
  const results = [await postPosPaymentRow(context, hotelId, original, null, memo)];
  if (reversal) results.push(await postPosPaymentRow(context, hotelId, reversal, original, memo));
  return summarize(results);
}

/** @param {any} context @param {string} hotelId @param {any} row @param {any | null} original @param {PostingMemo} memo */
async function postPosPaymentRow(context, hotelId, row, original, memo) {
  const label = row.kind === 'REVERSAL' ? 'Restoran ödeme iptali' : 'Restoran tahsilatı';
  if (row.status !== 'POSTED') return { skipped: `${label}: işlenmemiş (onay bekliyor / reddedildi)` };
  const date = day(row.businessDate);
  if (date < context.startDate) return { skipped: `${label}: başlangıç gününden önce (${date})` };
  if (original && !(await isPosted(hotelId, `POS_PAYMENT:${original.id}`))) return { skipped: `${label}: asıl ödeme muhasebeye işlenmemiş` };
  const description = `${label} · ${row.check.outlet.name} ${row.check.number} · ${PAYMENT_METHOD_LABELS[row.method] ?? row.method}`;
  const treasury = await mappedTreasury(hotelId, 'POS', row.method, row.currency, memo);
  const amounts = treasuryAmount(treasury, { amount: money(row.amount), currency: row.currency, converted: money(row.amount), rate: null }, context.currency);
  return writeWithEvents(async (tx, stage) => {
    await lockTreasuryAccounts(tx, hotelId, [treasury.id]);
    const posted = await postTreasury(tx, { hotelId, treasuryAccountId: treasury.id, date, ...amounts, description, reference: row.reference, sourceType: 'POS_PAYMENT', sourceId: row.id, sourceKey: `POS_PAYMENT:${row.id}` });
    if (posted.created) await stage('accounting.posted', { hotelId, source: 'POS_PAYMENT', ledgerAccountIds: [], treasuryAccountIds: [treasury.id] });
    return { posted: posted.created, message: posted.created ? `${description} → ${treasury.name}` : null };
  });
}

/* ═══════════════ Mal kabul (modül 45) ═══════════════ */

/**
 * Mal kabul: tedarikçi carisine KDV dahil tutar alacak (bizim borcumuz), vade = kabul günü + siparişin vadesi.
 * @param {string} hotelId @param {string} receiptId @param {PostingMemo} [memo]
 */
export async function syncGoodsReceipt(hotelId, receiptId, memo = newMemo()) {
  const context = await accountingContext(hotelId, memo);
  const receipt = await prisma.goodsReceipt.findFirst({
    where: { id: receiptId, hotelId },
    select: { id: true, number: true, supplierId: true, waybillNumber: true, receivedOn: true, grandTotal: true, order: { select: { number: true, paymentTermDays: true } } },
  });
  if (!receipt) throw new NotFoundError('Mal kabul bulunamadı');
  const date = day(receipt.receivedOn);
  if (date < context.startDate) return { skipped: `Mal kabul ${receipt.number}: başlangıç gününden önce (${date})` };
  const description = `Mal kabul ${receipt.number} · sipariş ${receipt.order.number} · irsaliye ${receipt.waybillNumber}`;
  return writeWithEvents(async (tx, stage) => {
    const account = await ensurePartnerAccount(tx, hotelId, { supplierId: receipt.supplierId });
    await lockLedgerAccounts(tx, hotelId, [account.id]);
    const posted = await postLedger(tx, {
      hotelId,
      accountId: account.id,
      date,
      dueDate: addDays(date, receipt.order.paymentTermDays),
      credit: money(receipt.grandTotal),
      description,
      reference: receipt.waybillNumber,
      sourceType: 'GOODS_RECEIPT',
      sourceId: receipt.id,
      sourceKey: `GOODS_RECEIPT:${receipt.id}`,
    });
    if (posted.created) await stage('accounting.posted', { hotelId, source: 'GOODS_RECEIPT', ledgerAccountIds: [account.id], treasuryAccountIds: [] });
    return { posted: posted.created, message: posted.created ? `${description} → ${account.name} carisine ${money(receipt.grandTotal)} ${context.currency} borç (vade ${addDays(date, receipt.order.paymentTermDays)})` : 'Zaten işlenmiş' };
  });
}

/* ═══════════════ Fark kaydıyla eşitlenen kaynaklar ═══════════════ */

/**
 * Kaynağın cari etkisini hedefe eşitler: yazılmış (borç − alacak) toplamı hedeften farklıysa fark yazılır
 * (anahtar "<önek>:<kaynak>:<sıra>"). Kaynak başka cariye taşınmışsa eski cariye ters fark yazılır.
 * Cariler kimlik sırasıyla kilitlenir; eşzamanlı iki eşitleme farkı iki kez yazamaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ hotelId: string, sourceType: 'EVENT_CHARGE' | 'AGENCY_BONUS', sourceId: string, keyPrefix: string, accountId: string, target: string,
 *   date: string, dueDate: string | null, description: string, reference?: string | null }} input target: borç − alacak hedefi
 */
async function reconcileSource(tx, input) {
  const { hotelId, sourceType, sourceId } = input;
  const touched = await tx.ledgerEntry.findMany({ where: { hotelId, sourceType, sourceId }, select: { accountId: true }, distinct: ['accountId'] });
  const accountIds = [...new Set([input.accountId, ...touched.map((row) => row.accountId)])];
  await lockLedgerAccounts(tx, hotelId, accountIds);
  const sums = await tx.ledgerEntry.groupBy({ by: ['accountId'], where: { hotelId, sourceType, sourceId }, _sum: { debit: true, credit: true }, _count: { _all: true } });
  let sequence = sums.reduce((count, row) => count + row._count._all, 0);
  const posted = [];
  for (const accountId of accountIds) {
    const row = sums.find((sum) => sum.accountId === accountId);
    const current = row ? toDecimal(String(row._sum.debit ?? 0)).minus(toDecimal(String(row._sum.credit ?? 0))) : toDecimal(0);
    const target = accountId === input.accountId ? toDecimal(input.target) : toDecimal(0);
    const diff = target.minus(current);
    if (diff.isZero()) continue;
    sequence += 1;
    await postLedger(tx, {
      hotelId,
      accountId,
      date: input.date,
      dueDate: diff.greaterThan(0) ? input.dueDate : null,
      debit: diff.greaterThan(0) ? toMoneyString(diff) : '0',
      credit: diff.greaterThan(0) ? '0' : toMoneyString(diff.negated()),
      description: current.isZero() ? input.description : `${input.description} (düzeltme)`,
      reference: input.reference ?? null,
      sourceType,
      sourceId,
      sourceKey: `${input.keyPrefix}:${sourceId}:${sequence}`,
    });
    posted.push({ accountId, amount: toMoneyString(diff) });
  }
  return posted;
}

/**
 * Etkinlik bedeli: gerçekleşince toplam, iptalde iptal bedeli müşteri carisine borç; açık / kaybedilmiş
 * etkinlikte sıfır (yazılmışsa ters fark). Gerçekleşme / iptal günü başlangıçtan önceyse işlenmez.
 * @param {string} hotelId @param {string} eventId @param {PostingMemo} [memo]
 */
export async function syncEventCharge(hotelId, eventId, memo = newMemo()) {
  const context = await accountingContext(hotelId, memo);
  const event = await prisma.event.findFirst({
    where: { id: eventId, hotelId },
    select: { id: true, code: true, name: true, clientId: true, status: true, grandTotal: true, cancellationFee: true, completedAt: true, cancelledAt: true },
  });
  if (!event) throw new NotFoundError('Etkinlik bulunamadı');
  const closedAt = event.status === 'COMPLETED' ? event.completedAt : event.status === 'CANCELLED' ? event.cancelledAt : null;
  const due = closedAt ? amountDue({ status: event.status, grandTotal: String(event.grandTotal), cancellationFee: event.cancellationFee === null ? null : String(event.cancellationFee) }) : '0.00';
  const date = closedAt ? await businessDayOf(hotelId, closedAt) : context.today;
  const anyPosted = await prisma.ledgerEntry.findFirst({ where: { hotelId, sourceType: 'EVENT_CHARGE', sourceId: eventId }, select: { id: true } });
  if (!anyPosted && toDecimal(due).isZero()) return { skipped: `Etkinlik ${event.code}: borçlandırılacak tutar yok (${event.status})` };
  if (!anyPosted && date < context.startDate) return { skipped: `Etkinlik ${event.code}: başlangıç gününden önce kapandı (${date})` };
  const label = event.status === 'CANCELLED' ? 'Etkinlik iptal bedeli' : 'Etkinlik bedeli';
  return writeWithEvents(async (tx, stage) => {
    const account = await ensurePartnerAccount(tx, hotelId, { eventClientId: event.clientId });
    const posted = await reconcileSource(tx, {
      hotelId,
      sourceType: 'EVENT_CHARGE',
      sourceId: event.id,
      keyPrefix: 'EVENT',
      accountId: account.id,
      target: due,
      date: date < context.startDate ? context.today : date,
      dueDate: addDays(date < context.startDate ? context.today : date, account.paymentTermDays),
      description: `${label} · ${event.code} ${event.name}`,
      reference: event.code,
    });
    if (posted.length) await stage('accounting.posted', { hotelId, source: 'EVENT_CHARGE', ledgerAccountIds: posted.map((row) => row.accountId), treasuryAccountIds: [] });
    return { posted: posted.length > 0, message: posted.length ? `${label} ${event.code}: ${posted.map((row) => row.amount).join(', ')} ${context.currency} → ${account.name}` : null };
  });
}

/**
 * Acente primi: onaylanmış / ödenmiş hak ediş acente carisine alacak (biz borçluyuz ya da alacağımızdan
 * düşer); yeniden açılınca ters fark. Onay günü başlangıçtan önceyse işlenmez.
 * @param {string} hotelId @param {string} bonusId @param {PostingMemo} [memo]
 */
export async function syncAgencyBonus(hotelId, bonusId, memo = newMemo()) {
  const context = await accountingContext(hotelId, memo);
  const bonus = await prisma.agencyBonus.findFirst({
    where: { id: bonusId, hotelId },
    select: { id: true, agencyId: true, status: true, amount: true, approvedAt: true, periodStart: true, periodEnd: true, rule: { select: { name: true } } },
  });
  if (!bonus) throw new NotFoundError('Hak ediş bulunamadı');
  const earned = bonus.status === 'APPROVED' || bonus.status === 'PAID';
  const target = earned ? toMoneyString(toDecimal(String(bonus.amount)).negated()) : '0.00';
  const date = earned && bonus.approvedAt ? await businessDayOf(hotelId, bonus.approvedAt) : context.today;
  const anyPosted = await prisma.ledgerEntry.findFirst({ where: { hotelId, sourceType: 'AGENCY_BONUS', sourceId: bonusId }, select: { id: true } });
  if (!anyPosted && !earned) return { skipped: 'Hak ediş onaylı değil' };
  if (!anyPosted && toDecimal(target).isZero()) return { skipped: 'Prim tutarı sıfır' };
  if (!anyPosted && date < context.startDate) return { skipped: `Hak ediş başlangıç gününden önce onaylandı (${date})` };
  const period = `${dotted(day(bonus.periodStart))} – ${dotted(day(bonus.periodEnd))}`;
  return writeWithEvents(async (tx, stage) => {
    const account = await ensurePartnerAccount(tx, hotelId, { agencyId: bonus.agencyId });
    const posted = await reconcileSource(tx, {
      hotelId,
      sourceType: 'AGENCY_BONUS',
      sourceId: bonus.id,
      keyPrefix: 'AGENCY_BONUS',
      accountId: account.id,
      target,
      date: date < context.startDate ? context.today : date,
      dueDate: null,
      description: `Acente prim hak edişi · ${bonus.rule?.name ?? ''} · ${period}`,
    });
    if (posted.length) await stage('accounting.posted', { hotelId, source: 'AGENCY_BONUS', ledgerAccountIds: posted.map((row) => row.accountId), treasuryAccountIds: [] });
    return { posted: posted.length > 0, message: posted.length ? `Prim hak edişi → ${account.name}: ${posted.map((row) => row.amount).join(', ')} ${context.currency}` : null };
  });
}

/* ═══════════════ Dönem eşitlemesi ═══════════════ */

/** En fazla bu kadar ayrı hata döner (aynı kaynak + ileti tek satırda sayılır; geri kalanı yalnız sayılır). */
const SYNC_ERROR_DETAIL = 25;
/** Tek eşitlemede bir kaynaktan en fazla bu kadar belge okunur (bellek sınırı; kalan sonraki çalıştırmada). */
const SYNC_BATCH = 2000;
/** Tek eşitlemenin süre sınırı: aşılınca kalan belgeler sayılıp bırakılır (istek uzamaz; yeniden çalıştırınca sürer). */
const SYNC_TIME_BUDGET_MS = 20_000;

/**
 * Dönemde muhasebeye işlenmemiş belgeleri bulur (zaman damgalı kaynaklarda bir gün geniş pencere; kesin gün
 * denetimini belge fonksiyonu otelin iş gününe göre yapar) ve işler (aktör kapalıyken / hata sonrası): mal
 * kabuller, onaylı primler, kapanmış etkinlikler, etkinlik / folyo / restoran ödemeleri — önce az sayıda olan ve
 * cariyi etkileyenler, en sona en kalabalık restoran ödemeleri. Kaynak anahtarı olmayanlar anti-join ile seçilir;
 * her belge kendi işleminde, bağlam ve kasa eşlemesi bütün belgelerde tek okunur. Hata belgeyi atlar, sayılır ve
 * iletisine göre gruplanır (eksik eşleme yüzlerce belgede aynı satır). Süre sınırına ya da okuma sınırına takılan
 * belgeler `remaining`de kesin sayıyla döner. Taramalar sıralı: yönetici işi bağlantı havuzunu doldurmaz.
 *
 * @param {string} hotelId @param {{ from: string, to: string }} period @param {{ budgetMs?: number }} [options]
 */
export async function syncPeriod(hotelId, { from, to }, { budgetMs = SYNC_TIME_BUDGET_MS } = {}) {
  const deadline = Date.now() + budgetMs;
  const memo = newMemo();
  const context = await accountingContext(hotelId, memo);
  const start = from < context.startDate ? context.startDate : from;
  const report = { from: start, to, posted: 0, skipped: 0, failed: 0, remaining: 0, errors: /** @type {Array<{ source: string, id: string, message: string, count: number }>} */ ([]) };
  if (start > to) return report;
  const after = sqlTimestamp(dateOnly(addDays(start, -1)));
  const before = sqlTimestamp(dateOnly(addDays(to, 2)));
  const sources = [
    {
      name: 'GOODS_RECEIPT',
      sync: syncGoodsReceipt,
      scan: Prisma.sql`
        FROM "GoodsReceipt" s
        WHERE s."hotelId" = ${hotelId} AND s."receivedOn" BETWEEN ${start}::date AND ${to}::date
          AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" e WHERE e."hotelId" = ${hotelId} AND e."sourceKey" = 'GOODS_RECEIPT:' || s."id")`,
      order: Prisma.sql`s."receivedOn", s."createdAt"`,
    },
    {
      name: 'AGENCY_BONUS',
      sync: syncAgencyBonus,
      scan: Prisma.sql`
        FROM "AgencyBonus" s
        WHERE s."hotelId" = ${hotelId} AND s."status" IN ('APPROVED', 'PAID') AND s."approvedAt" IS NOT NULL AND s."approvedAt" >= ${after} AND s."approvedAt" < ${before}
          AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" e WHERE e."hotelId" = ${hotelId} AND e."sourceType" = 'AGENCY_BONUS' AND e."sourceId" = s."id")`,
      order: Prisma.sql`s."approvedAt"`,
    },
    {
      name: 'EVENT_CHARGE',
      sync: syncEventCharge,
      scan: Prisma.sql`
        FROM "Event" s
        WHERE s."hotelId" = ${hotelId}
          AND ((s."status" = 'COMPLETED' AND s."completedAt" >= ${after} AND s."completedAt" < ${before})
            OR (s."status" = 'CANCELLED' AND s."cancellationFee" > 0 AND s."cancelledAt" >= ${after} AND s."cancelledAt" < ${before}))
          AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" e WHERE e."hotelId" = ${hotelId} AND e."sourceType" = 'EVENT_CHARGE' AND e."sourceId" = s."id")`,
      order: Prisma.sql`s."id"`,
    },
    {
      name: 'EVENT_PAYMENT',
      sync: syncEventPayment,
      scan: Prisma.sql`
        FROM "EventPayment" s
        WHERE s."hotelId" = ${hotelId} AND s."status" = 'POSTED' AND s."businessDate" BETWEEN ${start}::date AND ${to}::date
          AND s."method" NOT IN ('AGENCY', 'VOUCHER')
          AND NOT EXISTS (SELECT 1 FROM "TreasuryMovement" m WHERE m."hotelId" = ${hotelId} AND m."sourceKey" = 'EVENT_PAYMENT:' || s."id")`,
      order: Prisma.sql`s."businessDate", s."receivedAt"`,
    },
    {
      name: 'FOLIO_PAYMENT',
      sync: syncFolioPayment,
      scan: Prisma.sql`
        FROM "Payment" s
        WHERE s."hotelId" = ${hotelId} AND s."deletedAt" IS NULL AND s."status" = 'POSTED' AND s."businessDate" BETWEEN ${start}::date AND ${to}::date
          AND NOT EXISTS (SELECT 1 FROM "TreasuryMovement" m WHERE m."hotelId" = ${hotelId} AND m."sourceKey" = 'PAYMENT:' || s."id")
          AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" e WHERE e."hotelId" = ${hotelId} AND e."sourceKey" = 'PAYMENT:' || s."id")`,
      order: Prisma.sql`s."businessDate", s."receivedAt"`,
    },
    {
      name: 'POS_PAYMENT',
      sync: syncPosPayment,
      scan: Prisma.sql`
        FROM "PosPayment" s
        WHERE s."hotelId" = ${hotelId} AND s."status" = 'POSTED' AND s."businessDate" BETWEEN ${start}::date AND ${to}::date
          AND NOT EXISTS (SELECT 1 FROM "TreasuryMovement" m WHERE m."hotelId" = ${hotelId} AND m."sourceKey" = 'POS_PAYMENT:' || s."id")`,
      order: Prisma.sql`s."businessDate", s."receivedAt"`,
    },
  ];
  for (const source of sources) {
    const rows = /** @type {Array<{ id: string }>} */ (await prisma.$queryRaw`SELECT s."id" ${source.scan} ORDER BY ${source.order} LIMIT ${SYNC_BATCH + 1}`);
    // Okuma sınırını aşan kaynakta kalan, sayımla kesinleşir (yalnız o durumda; anti-join index üstünden).
    const total =
      rows.length <= SYNC_BATCH ? rows.length : /** @type {Array<{ count: number }>} */ (await prisma.$queryRaw`SELECT count(*)::int AS "count" ${source.scan}`)[0].count;
    let attempted = 0;
    for (const { id } of rows.slice(0, SYNC_BATCH)) {
      if (Date.now() >= deadline) break;
      attempted += 1;
      try {
        const result = await source.sync(hotelId, id, memo);
        if (result.posted) report.posted += 1;
        else report.skipped += 1;
      } catch (error) {
        report.failed += 1;
        const message = /** @type {Error} */ (error).message;
        const known = report.errors.find((row) => row.source === source.name && row.message === message);
        if (known) known.count += 1;
        else if (report.errors.length < SYNC_ERROR_DETAIL) report.errors.push({ source: source.name, id, message, count: 1 });
      }
    }
    report.remaining += total - attempted;
  }
  return report;
}

/** Satır sonuçlarını tek sonuçta toplar (aktör iletisi). @param {Array<{ posted?: boolean, skipped?: string, message?: string | null }>} results */
function summarize(results) {
  const messages = results.map((result) => result.message ?? result.skipped).filter(Boolean);
  return { posted: results.some((result) => result.posted), skipped: results.every((result) => !result.posted) ? messages.join('; ') || 'Zaten işlenmiş' : undefined, message: messages.join('; ') || null };
}

