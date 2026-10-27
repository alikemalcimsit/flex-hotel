import { randomUUID } from 'node:crypto';
import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import { PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, TAX_APPLIES_TO_LABELS, paymentVoidError } from '@hotelos/hotel-contracts';
import { prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockPosShifts, lockReservations } from '../../lib/locks.js';
import { MATCH_NOTHING, matchGuestIds, matchRoomIdsByNumber, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { needsLargePaymentApproval } from '../payments/rules.js';
import { guestFullName } from '../reservations/guests.js';
import { alertRequester, closeIfSettled, getCheck, lockedCheck, pendingState } from './checks.js';
import { assertRoomServiceSettlable } from './room-service-guards.js';
import { checkBalance, roomChargeItems } from './rules.js';
import { computeCheckTotals, dateOnly, day, hotelContext, iso, money, prisma, recomputeCheckPayments, recomputeCheckTotals, requireOpenShift } from './shared.js';

/**
 * Adisyonun ödemesi (modül 39): nakit / kart, hatalı girişin iptali ve **odaya yaz**.
 *
 * - Adisyonun kendi ödemesi vardır (`PosPayment`); kasada **"Restoran"** kaynağıyla görünür
 *   ve parayı alan garsonun **vardiya kasasına** girer (vardiya kapanışında sayılır).
 * - **Ödeme silinmez.** Hatalı giriş dört göz onaylı iptal kaydıyla (asıl satırın tersi,
 *   asıl satırın vardiyasına) düzeltilir; vardiya kapandıysa (kasa sayıldı) iptal edilmez.
 * - **Eşik:** otelin büyük ödeme eşiğine eşit / üstü tahsilat onaya gider; onaylanınca
 *   adisyona ve kasaya girer.
 * - **Odaya yaz:** içerideki misafirin folyosuna `fnb.order.charged` olayı; folyo aktörü
 *   işler (olay iki kez gelse de tek yazılır). Folyo kalemleri vergi kategorisi başınadır ve
 *   folyonun vergi motoruyla toplamı odaya yazılan tutara birebir eşittir (`roomChargeItems`).
 * - İstek kimliği satırın anahtarıdır; aynı istek ikinci kez tahsil / yazılmaz.
 * - Kilit sırası: vardiya → adisyon → rezervasyon. Ödeme toplamı aynı transaction'da
 *   satırlardan yeniden yazılır; bakiye sıfırlanınca adisyon kapanır.
 */

export const POS_PAYMENT_APPROVAL_TYPE = 'POS_PAYMENT';

/** "Odaya yaz" araması en fazla bu kadar konaklama döner (oda / soyadı yazılınca birkaç tane olur). */
const IN_HOUSE_RESULT_LIMIT = 20;

export const POS_PAYMENT_SELECT = Object.freeze({
  id: true,
  checkId: true,
  shiftId: true,
  kind: true,
  status: true,
  method: true,
  amount: true,
  currency: true,
  businessDate: true,
  reference: true,
  receivedBy: true,
  receivedAt: true,
  postedAt: true,
  approvalId: true,
  declinedAt: true,
  reversalOfId: true,
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  voidApprovalId: true,
  voidRequestedAt: true,
  voidRequestedBy: true,
});

/** Kasada adisyon ödemesinin dosyası (numara, satış noktası, masa). */
export const POS_REF_SELECT = Object.freeze({ id: true, number: true, status: true, outlet: { select: { name: true } }, table: { select: { name: true } } });

/** @param {any} check */
export const posCheckRef = (check) => ({ id: check.id, number: check.number, status: check.status, outletName: check.outlet?.name ?? null, tableName: check.table?.name ?? null });

const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Kullanıcıya yazılan tutar: "1.250,00 TRY". @param {string} amount @param {string} currency */
const priced = (amount, currency) => `${trMoney.format(Number(money(amount)))} ${currency}`;
/** @param {string} amount */
const unsigned = (amount) => toMoneyString(toDecimal(amount).abs());

/** @param {any} row */
export function toPosPaymentDto(row) {
  return {
    id: row.id,
    checkId: row.checkId,
    shiftId: row.shiftId,
    kind: row.kind,
    status: row.status,
    method: row.method,
    amount: money(row.amount),
    currency: row.currency,
    businessDate: day(row.businessDate),
    reference: row.reference,
    note: null,
    receivedBy: row.receivedBy,
    receivedAt: iso(row.receivedAt),
    postedAt: iso(row.postedAt),
    approvalId: row.approvalId,
    declinedAt: iso(row.declinedAt),
    reversalOfId: row.reversalOfId,
    voided: Boolean(row.voidedAt),
    voidedAt: iso(row.voidedAt),
    voidedBy: row.voidedBy,
    voidReason: row.voidReason,
    voidApprovalId: row.voidApprovalId,
    voidPending: Boolean(row.voidRequestedAt),
    voidRequestedBy: row.voidRequestedBy,
  };
}

/** @param {any} row */
const paymentAudit = (row) => ({
  kind: row.kind,
  status: row.status,
  method: row.method,
  amount: money(row.amount),
  currency: row.currency,
  businessDate: day(row.businessDate),
  reference: row.reference,
  approvalId: row.approvalId,
  shiftId: row.shiftId,
});

/** @param {any} check */
const checkLabel = (check) => `${check.number} · ${check.outlet.name}${check.table ? ` · masa ${check.table.name}` : ''}`;

/* ══════════════════ Tahsilat ══════════════════ */

/**
 * Nakit / kart tahsilatı (parayı alanın açık vardiyasına). Tutar kalan bakiyeyi (onay
 * bekleyen tahsilat düşülmüş) aşamaz — para üstü ekranda hesaplanır, kasaya alınan tutar
 * yazılır. Onay bekleyen düzeltme varken ödeme alınmaz (toplam değişebilir). Eşik üstü
 * onaya gider. Bakiye sıfırlanınca adisyon kapanır.
 *
 * @param {string} hotelId
 * @param {string} checkId
 * @param {{ requestId: string, method: 'CASH' | 'CARD', amount: string, reference?: string | null }} input
 * @returns {Promise<{ check: any, payment: ReturnType<typeof toPosPaymentDto>, created: boolean }>}
 */
export async function receivePayment(hotelId, checkId, input) {
  const { hotel, today } = await hotelContext(hotelId);
  const actor = currentActor();
  const sourceKey = `pos:${input.requestId}`;
  let outcome;
  try {
    outcome = await writeWithEvents(async (tx, stage) => {
      const replay = async () => {
        const existing = await tx.posPayment.findFirst({ where: { hotelId, sourceKey }, select: { id: true, checkId: true } });
        if (existing && existing.checkId !== checkId) throw new ConflictError('Bu istek başka bir adisyonun ödemesinde kullanıldı; ekranı yenileyin.', 'DUPLICATE_REQUEST');
        return existing ? { paymentId: existing.id, created: false } : null;
      };
      const early = await replay();
      if (early) return early;
      const shift = await requireOpenShift(tx, hotelId, actor);
      const check = await lockedCheck(tx, hotelId, checkId);
      const again = await replay();
      if (again) return again;
      await assertRoomServiceSettlable(tx, checkId);
      const { paymentId } = await takePayment(tx, stage, { hotelId, hotel, today, shift, check, input, sourceKey });
      return { paymentId, created: true };
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu ödeme az önce kaydedildi; ekranı yenileyin.' });
  }
  const [check, payment] = await Promise.all([getCheck(hotelId, checkId), readPayment(hotelId, outcome.paymentId)]);
  return { check, payment, created: outcome.created };
}

/**
 * Tahsilatı yazar (vardiya paylaşımlı, adisyon özel kilitliyken; restoranın ödemesi ve oda servisinin kapı ödemesi):
 * kalan bakiye **güncel** toplamlardan okunur (aynı transaction'da önceki ödeme düşülmüş), onay bekleyen düzeltme
 * varken alınmaz, eşik üstü onaya gider; işlenen ödeme toplamı yeniden yazar ve bakiye sıfırsa adisyonu kapatır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, hotel: any, today: string, shift: { id: string }, check: any, input: { method: 'CASH' | 'CARD', amount: string, reference?: string | null }, sourceKey: string }} context
 * @returns {Promise<{ paymentId: string, pending: boolean }>}
 */
export async function takePayment(tx, stage, { hotelId, hotel, today, shift, check, input, sourceKey }) {
  const actor = currentActor();
  const checkId = check.id;
  const [pending, current] = await Promise.all([
    pendingState(tx, checkId),
    tx.posCheck.findFirst({ where: { id: checkId }, select: { grandTotal: true, paidTotal: true, roomChargeTotal: true } }),
  ]);
  if (pending.adjustments) throw new ConflictError('Onay bekleyen düzeltme (ikram / iptal / indirim) var; karar gelmeden ödeme alınmaz.', 'PENDING_ADJUSTMENT');
  const balance = toDecimal(checkBalance({ grandTotal: money(current.grandTotal), paidTotal: money(current.paidTotal), roomChargeTotal: money(current.roomChargeTotal) })).minus(
    toDecimal(pending.pendingPaid),
  );
  if (!balance.greaterThan(0)) throw new ConflictError(pending.payments ? 'Kalan tutar onay bekleyen ödemeyle karşılanıyor.' : 'Adisyonun ödenecek bakiyesi yok.', 'NO_BALANCE');
  if (toDecimal(input.amount).greaterThan(balance)) {
    throw new ValidationError(`En fazla ${priced(toMoneyString(balance), hotel.currency)} alınır (kalan); para üstünü ekranda verin.`, { field: 'amount', limit: toMoneyString(balance) });
  }

  const approval = needsLargePaymentApproval(input.amount, String(hotel.largePaymentThreshold ?? 0));
  const paymentId = randomUUID();
  let approvalId = null;
  if (approval) {
    ({ approvalId } = await requestApproval(tx, stage, {
      hotelId,
      type: POS_PAYMENT_APPROVAL_TYPE,
      summary: `Büyük restoran ödemesi: ${checkLabel(check)} — ${priced(input.amount, hotel.currency)} ${PAYMENT_METHOD_LABELS[input.method]}`.slice(0, 200),
      reason: `Tutar büyük ödeme eşiğine (${priced(money(hotel.largePaymentThreshold), hotel.currency)}) eşit ya da üstünde`,
      amount: toMoneyString(input.amount),
      currency: hotel.currency,
      data: {
        Adisyon: checkLabel(check),
        Yöntem: PAYMENT_METHOD_LABELS[input.method],
        Tutar: priced(input.amount, hotel.currency),
        ...(input.reference ? { Referans: input.reference } : {}),
        'Adisyon toplamı': priced(money(current.grandTotal), hotel.currency),
        'Şu an alınan': priced(money(current.paidTotal), hotel.currency),
        Garson: check.waiterEmail,
        Alan: actor,
      },
      entityType: 'PosPayment',
      entityId: paymentId,
      requestedBy: actor,
    }));
  }

  const now = new Date();
  const created = await tx.posPayment.create({
    data: {
      id: paymentId,
      hotelId,
      checkId,
      shiftId: shift.id,
      kind: 'PAYMENT',
      status: approval ? 'PENDING' : 'POSTED',
      method: input.method,
      amount: toMoneyString(input.amount),
      currency: hotel.currency,
      businessDate: dateOnly(today),
      reference: input.reference ?? null,
      sourceKey,
      receivedBy: actor,
      receivedAt: now,
      postedAt: approval ? null : now,
      approvalId,
    },
    select: POS_PAYMENT_SELECT,
  });
  await recordAudit(tx, { hotelId, entity: 'PosPayment', entityId: paymentId, action: 'CREATE', after: { check: check.number, ...paymentAudit(created) } });
  await stage('pos.payment.changed', { hotelId, checkId, paymentId, change: approval ? 'PENDING' : 'RECEIVED' });
  if (!approval) {
    await recomputeCheckPayments(tx, checkId);
    await closeIfSettled(tx, stage, { hotelId, checkId, today });
  }
  await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'UPDATED' });
  return { paymentId, pending: Boolean(approval) };
}

/** @param {string} hotelId @param {string} paymentId */
async function readPayment(hotelId, paymentId) {
  const row = await prisma.posPayment.findFirst({ where: { id: paymentId, hotelId }, select: POS_PAYMENT_SELECT });
  if (!row) throw new NotFoundError('Ödeme bulunamadı');
  return toPosPaymentDto(row);
}

/**
 * Ödemenin adisyonu (onay ekranının "aç" bağlantısı ödeme kimliğiyle gelir).
 * @param {string} hotelId @param {string} paymentId
 */
export async function findPaymentCheck(hotelId, paymentId) {
  const row = await prisma.posPayment.findFirst({ where: { id: paymentId, hotelId }, select: { checkId: true } });
  if (!row) throw new NotFoundError('Ödeme bulunamadı');
  return { checkId: row.checkId };
}

/* ══════════════════ Hatalı giriş iptali ══════════════════ */

/**
 * Hatalı girişin iptali (yanlış tutar, yanlış yöntem): dört göz onaya gider; onaylanınca asıl
 * satırın tersi asıl satırın vardiyasına yazılır. Adisyon açık olmalı (kapanmışsa şef garson
 * önce yeniden açar) ve ödemenin vardiyası açık olmalı (kasa sayıldıysa düzeltme kasa farkıdır).
 *
 * @param {string} hotelId
 * @param {string} checkId
 * @param {string} paymentId
 * @param {{ reason: string }} input
 */
export async function requestPaymentVoid(hotelId, checkId, paymentId, { reason }) {
  const actor = currentActor();
  const { hotel } = await hotelContext(hotelId);
  try {
    await writeWithEvents(async (tx, stage) => {
      const seed = await tx.posPayment.findFirst({ where: { id: paymentId, checkId, hotelId }, select: { shiftId: true } });
      if (!seed) throw new NotFoundError('Ödeme bulunamadı');
      await lockPosShifts(tx, hotelId, [seed.shiftId], { shared: true });
      const check = await lockedCheck(tx, hotelId, checkId);
      const payment = await tx.posPayment.findFirst({ where: { id: paymentId }, select: { ...POS_PAYMENT_SELECT, shift: { select: { status: true, waiterEmail: true } } } });
      const blocked = paymentVoidError({ ...payment, voidPending: Boolean(payment.voidRequestedAt) });
      if (blocked) throw new ConflictError(blocked, 'PAYMENT_RULE');
      if (payment.shift.status !== 'OPEN') throw new ConflictError('Ödemenin alındığı vardiya kapandı (kasa sayıldı); iptal edilemez, fark kasa düzeltmesidir.', 'SHIFT_CLOSED');
      const what = `${PAYMENT_KIND_LABELS[payment.kind]} ${priced(unsigned(money(payment.amount)), payment.currency)} ${PAYMENT_METHOD_LABELS[payment.method]}`;
      const { approvalId } = await requestApproval(tx, stage, {
        hotelId,
        type: POS_PAYMENT_APPROVAL_TYPE,
        summary: `Restoran ödemesi iptali: ${checkLabel(check)} — ${what}`.slice(0, 200),
        reason,
        amount: unsigned(money(payment.amount)),
        currency: payment.currency ?? hotel.currency,
        data: {
          Adisyon: checkLabel(check),
          Satır: what,
          ...(payment.reference ? { Referans: payment.reference } : {}),
          Alan: payment.receivedBy,
          'Alındığı an': payment.receivedAt.toISOString(),
          'Vardiya sahibi': payment.shift.waiterEmail,
          İsteyen: actor,
        },
        entityType: 'PosPayment',
        entityId: payment.id,
        requestedBy: actor,
      });
      await tx.posPayment.update({ where: { id: payment.id }, data: { voidApprovalId: approvalId, voidRequestedAt: new Date(), voidRequestedBy: actor, voidReason: reason } });
      await recordAudit(tx, { hotelId, entity: 'PosPayment', entityId: payment.id, action: 'UPDATE', before: { voidPending: false }, after: { voidPending: true, approvalId, reason } });
      await stage('pos.payment.changed', { hotelId, checkId, paymentId, change: 'VOID_REQUESTED' });
      await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'UPDATED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getCheck(hotelId, checkId);
}

/* ══════════════════ Odaya yaz ══════════════════ */

/**
 * "Odaya yaz" için içerideki konaklamalar: oda numarası (birebir) ya da misafir adı /
 * soyadı. Yalnızca odası olan, içerideki konaklamalar; en fazla 20.
 *
 * @param {string} hotelId
 * @param {{ search: string }} query
 */
export async function inHouseStays(hotelId, { search }) {
  const tokens = searchTokens(search);
  const and = [];
  for (const token of tokens) {
    const [roomIds, guestIds] = await Promise.all([matchRoomIdsByNumber(prisma, hotelId, token), token.length >= 2 ? matchGuestIds(prisma, hotelId, token) : []]);
    const or = [...(roomIds.length ? [{ roomId: { in: roomIds } }] : []), ...(guestIds.length ? [{ guestId: { in: guestIds } }] : [])];
    and.push(or.length ? { OR: or } : MATCH_NOTHING);
  }
  const rows = await prisma.reservation.findMany({
    where: { hotelId, status: 'CHECKED_IN', roomId: { not: null }, AND: and },
    orderBy: [{ checkIn: 'desc' }, { id: 'desc' }],
    take: IN_HOUSE_RESULT_LIMIT,
    select: {
      id: true,
      confirmationCode: true,
      checkIn: true,
      checkOut: true,
      adults: true,
      children: true,
      room: { select: { number: true } },
      guest: { select: { firstName: true, lastName: true } },
    },
  });
  return {
    stays: rows.map((row) => ({
      id: row.id,
      confirmationCode: row.confirmationCode,
      roomNumber: row.room.number,
      guestName: guestFullName(row.guest),
      checkIn: day(row.checkIn),
      checkOut: day(row.checkOut),
      guests: row.adults + row.children,
    })),
  };
}

/**
 * Adisyonu (ya da bir kısmını) içerideki misafirin folyosuna yazar. Satış noktası odaya
 * yazmaya açık olmalı, konaklama içeride ve odalı olmalı. Folyo kalemleri vergi kategorisi
 * başına (folyo toplamı tutara birebir); tutar vergi yuvarlaması yüzünden birebir
 * yazılamıyorsa en yakın iki tutar önerilir.
 *
 * @param {string} hotelId
 * @param {string} checkId
 * @param {{ requestId: string, reservationId: string, amount: string }} input
 */
export async function chargeToRoom(hotelId, checkId, input) {
  const { hotel, today } = await hotelContext(hotelId);
  const sourceKey = `room:${input.requestId}`;
  try {
    await writeWithEvents(async (tx, stage) => {
      const replay = async () => {
        const existing = await tx.posRoomCharge.findFirst({ where: { hotelId, sourceKey }, select: { checkId: true } });
        if (existing && existing.checkId !== checkId) throw new ConflictError('Bu istek başka bir adisyonda kullanıldı; ekranı yenileyin.', 'DUPLICATE_REQUEST');
        return Boolean(existing);
      };
      if (await replay()) return;
      const check = await lockedCheck(tx, hotelId, checkId);
      if (await replay()) return;
      await assertRoomServiceSettlable(tx, checkId);
      await postRoomCharge(tx, stage, { hotelId, hotel, today, check, reservationId: input.reservationId, amount: input.amount, sourceKey });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu işlem az önce kaydedildi; ekranı yenileyin.' });
  }
  return getCheck(hotelId, checkId);
}

/**
 * Tutarı içerideki misafirin folyosuna yazar (adisyon kilitliyken; restoranın "odaya yaz"ı ve oda servisi
 * teslimde kalanın yazılması): satış noktası odaya yazmaya açık, onay bekleyen iş yok, konaklama içeride ve odalı.
 * Toplamlar kalemlerden yeniden hesaplanır; folyo kalemleri vergi kategorisi başına ve toplamı tutara birebir
 * (yazılamayan tutara en yakın iki öneri). Rezervasyon adisyondan sonra kilitlenir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, hotel: any, today: string, check: any, reservationId: string, amount: string, sourceKey: string, label?: string, field?: string }} context
 *   `label`: folyoda kalemin adı (verilmezse satış noktası ve masa); `field`: hata alanı (ekranın girdisi)
 */
export async function postRoomCharge(tx, stage, { hotelId, hotel, today, check, reservationId, amount, sourceKey, label = null, field = 'amount' }) {
  const actor = currentActor();
  const checkId = check.id;
  if (!check.outlet.allowRoomCharge) throw new ConflictError(`${check.outlet.name} odaya yazmaya kapalı; ödemeyi nakit / kartla alın.`, 'ROOM_CHARGE_DISABLED');
  const pending = await pendingState(tx, checkId);
  if (pending.adjustments || pending.payments || pending.voids) throw new ConflictError('Onay bekleyen düzeltme ya da ödeme var; karar gelmeden odaya yazılmaz.', 'PENDING_APPROVAL');

  await lockReservations(tx, hotelId, [reservationId]);
  const stay = await tx.reservation.findFirst({
    where: { id: reservationId, hotelId },
    select: { id: true, status: true, confirmationCode: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } },
  });
  if (!stay) throw new ValidationError('Konaklama bulunamadı', { field: 'reservationId' });
  if (stay.status !== 'CHECKED_IN' || !stay.room) throw new ValidationError('Misafir içeride değil (giriş yapılmamış ya da çıkış yapmış); odaya yazılamaz.', { field: field === 'amount' ? 'reservationId' : field });

  // Toplamlar kalemlerden yeniden hesaplanır (vergi ayarı bu arada değiştiyse adisyon güncellenir); ödeme toplamı güncel satırdan.
  const current = await tx.posCheck.findFirst({ where: { id: checkId }, select: { grandTotal: true, paidTotal: true, roomChargeTotal: true } });
  let totals = await computeCheckTotals(tx, hotelId, checkId);
  let grandTotal = money(current.grandTotal);
  if (totals.grandTotal !== grandTotal) {
    totals = { ...(await recomputeCheckTotals(tx, hotelId, checkId)), appliedTaxes: totals.appliedTaxes };
    grandTotal = totals.grandTotal;
  }
  const balance = toDecimal(checkBalance({ grandTotal, paidTotal: money(current.paidTotal), roomChargeTotal: money(current.roomChargeTotal) }));
  if (!balance.greaterThan(0)) throw new ConflictError('Adisyonun ödenecek bakiyesi yok.', 'NO_BALANCE');
  if (toDecimal(amount).greaterThan(balance)) {
    throw new ValidationError(`En fazla ${priced(toMoneyString(balance), hotel.currency)} yazılır (kalan).`, { field, limit: toMoneyString(balance) });
  }
  const plan = roomChargeItems({ categories: totals.categories, amount: toMoneyString(amount), taxes: totals.appliedTaxes });
  if (plan.error) {
    const options = plan.nearest.map((value) => priced(value, hotel.currency)).join(' ya da ');
    throw new ValidationError(options ? `${plan.error}; ${options} yazın.` : plan.error, { field, nearest: plan.nearest });
  }

  const place = label ?? `${check.outlet.name}${check.table ? ` masa ${check.table.name}` : ''}`;
  const event = await stage('fnb.order.charged', {
    hotelId,
    reservationId: stay.id,
    roomId: null,
    reference: check.number,
    items: plan.items.map((item) => ({
      description: (plan.items.length > 1 ? `${place} · ${TAX_APPLIES_TO_LABELS[item.taxCategory] ?? item.taxCategory}` : place).slice(0, 200),
      unitPrice: item.gross,
      quantity: 1,
      taxCategory: item.taxCategory,
    })),
  });
  const guestName = guestFullName(stay.guest);
  const charge = await tx.posRoomCharge.create({
    data: {
      hotelId,
      checkId,
      reservationId: stay.id,
      roomNumber: stay.room.number,
      guestName,
      amount: toMoneyString(amount),
      eventId: event.id,
      sourceKey,
      chargedBy: actor,
      businessDate: dateOnly(today),
    },
    select: { id: true },
  });
  await recordAudit(tx, {
    hotelId,
    entity: 'PosRoomCharge',
    entityId: charge.id,
    action: 'CREATE',
    after: { check: check.number, room: stay.room.number, guest: guestName, reservation: stay.confirmationCode, amount: toMoneyString(amount), items: plan.items, eventId: event.id },
  });
  await recomputeCheckPayments(tx, checkId);
  await closeIfSettled(tx, stage, { hotelId, checkId, today });
  await stage('pos.check.changed', { hotelId, checkId, outletId: check.outletId, tableId: check.tableId, change: 'UPDATED' });
  return { chargeId: charge.id, eventId: event.id };
}

/* ══════════════════ Onay sonucu ══════════════════ */

/**
 * Onay kuyruğunun sonucu (servis dinleyicisi): iptal onayı mı (`voidApprovalId`), bekleyen
 * tahsilat mı (`approvalId` + `PENDING`), satıra bakılarak anlaşılır. Aynı haber iki kez gelse
 * de bir kez uygulanır. İsteyenin ziline sonuç düşer.
 *
 * @param {{ hotelId: string, approvalId: string, type: string }} payload
 * @param {{ name: string }} envelope
 * @returns {Promise<{ handled: boolean, applied?: boolean }>}
 */
export async function applyPaymentDecision(payload, envelope) {
  if (payload.type !== POS_PAYMENT_APPROVAL_TYPE) return { handled: false };
  const hotelId = payload.hotelId;
  const approval = await prismaUnfiltered.approval.findFirst({
    where: { id: payload.approvalId, hotelId },
    select: { id: true, type: true, entityId: true, requestedBy: true, decidedBy: true, note: true, summary: true },
  });
  if (!approval?.entityId) return { handled: false };
  const seed = await prisma.posPayment.findFirst({ where: { id: approval.entityId, hotelId }, select: { checkId: true, shiftId: true } });
  if (!seed) return { handled: false };
  const granted = envelope.name === 'approval.granted';
  const outcomeName = envelope.name === 'approval.denied' ? 'DENIED' : 'EXPIRED';
  const { today } = await hotelContext(hotelId);

  const outcome = await writeWithEvents(async (tx, stage) => {
    await lockPosShifts(tx, hotelId, [seed.shiftId], { shared: true });
    const check = await lockedCheck(tx, hotelId, seed.checkId, { open: false });
    const payment = await tx.posPayment.findFirst({ where: { id: approval.entityId }, select: { ...POS_PAYMENT_SELECT, shift: { select: { status: true } } } });
    const input = { hotelId, approval, payment, check, granted, outcomeName, today };
    if (payment.voidApprovalId === approval.id && payment.voidRequestedAt) return applyVoid(tx, stage, input);
    if (payment.approvalId === approval.id && payment.status === 'PENDING') return applyPending(tx, stage, input);
    return { stale: true };
  });
  if (!outcome.stale) await alertRequester(hotelId, approval, granted ? (outcome.applied ? 'GRANTED' : 'FAILED') : envelope.name, seed.checkId, outcome.failure ?? null);
  return { handled: true, applied: Boolean(outcome.applied) };
}

/**
 * Bekleyen tahsilat kararı (vardiya + adisyon kilitli). Onaylansa da adisyon kapanmış,
 * vardiya kapanmış ya da tutar artık bakiyeyi aşıyorsa işlenmez (reddedilmiş sayılır).
 * @param {any} tx @param {Function} stage @param {any} input
 */
async function applyPending(tx, stage, { hotelId, approval, payment, check, granted, outcomeName, today }) {
  let failure = null;
  if (granted) {
    const balance = toDecimal(checkBalance({ grandTotal: money(check.grandTotal), paidTotal: money(check.paidTotal), roomChargeTotal: money(check.roomChargeTotal) }));
    if (check.status !== 'OPEN') failure = 'Adisyon bu arada kapandı; ödeme işlenmedi.';
    else if (payment.shift.status !== 'OPEN') failure = 'Parayı alanın vardiyası kapandı; ödeme işlenmedi.';
    else if (toDecimal(money(payment.amount)).greaterThan(balance)) failure = `Adisyonun kalanı (${money(balance)}) bu tutarın altına düştü; ödeme işlenmedi.`;
  }
  if (granted && !failure) {
    const now = new Date();
    const updated = await tx.posPayment.update({ where: { id: payment.id }, data: { status: 'POSTED', postedAt: now, businessDate: dateOnly(today) }, select: POS_PAYMENT_SELECT });
    await recomputeCheckPayments(tx, check.id);
    await recordAudit(tx, { hotelId, entity: 'PosPayment', entityId: payment.id, action: 'UPDATE', before: { status: 'PENDING' }, after: { ...paymentAudit(updated), decidedBy: approval.decidedBy } });
    await stage('pos.payment.changed', { hotelId, checkId: check.id, paymentId: payment.id, change: 'POSTED' });
    await closeIfSettled(tx, stage, { hotelId, checkId: check.id, today });
    await stage('pos.check.changed', { hotelId, checkId: check.id, outletId: check.outletId, tableId: check.tableId, change: 'UPDATED' });
    return { applied: true };
  }
  await tx.posPayment.update({ where: { id: payment.id }, data: { status: 'DECLINED', declinedAt: new Date() } });
  await recordAudit(tx, {
    hotelId,
    entity: 'PosPayment',
    entityId: payment.id,
    action: 'UPDATE',
    before: { status: 'PENDING' },
    after: { status: 'DECLINED', outcome: granted ? failure : outcomeName, approvalId: approval.id },
  });
  await stage('pos.payment.changed', { hotelId, checkId: check.id, paymentId: payment.id, change: 'DECLINED' });
  await stage('pos.check.changed', { hotelId, checkId: check.id, outletId: check.outletId, tableId: check.tableId, change: 'UPDATED' });
  return { applied: false, failure };
}

/**
 * İptal kararı (vardiya + adisyon kilitli): onaylandıysa ters satır asıl satırın vardiyasına
 * ve alanına yazılır (para onun çekmecesindeydi). Vardiya kapandıysa ya da adisyon
 * kapandıysa iptal uygulanmaz.
 * @param {any} tx @param {Function} stage @param {any} input
 */
async function applyVoid(tx, stage, { hotelId, approval, payment, check, granted, outcomeName, today }) {
  let failure = null;
  if (granted) {
    if (payment.status !== 'POSTED' || payment.voidedAt) failure = 'Ödeme işlenmiş değil ya da zaten iptal edilmiş.';
    else if (payment.shift.status !== 'OPEN') failure = 'Ödemenin vardiyası kapandı (kasa sayıldı); iptal uygulanmadı.';
    else if (check.status !== 'OPEN') failure = 'Adisyon bu arada kapandı; iptal uygulanmadı.';
  }
  if (granted && !failure) {
    const now = new Date();
    const voidedBy = approval.decidedBy ?? currentActor();
    const reason = payment.voidReason ?? 'Onaylı iptal';
    const reversal = await tx.posPayment.create({
      data: {
        hotelId,
        checkId: check.id,
        shiftId: payment.shiftId,
        kind: 'REVERSAL',
        status: 'POSTED',
        method: payment.method,
        amount: toMoneyString(toDecimal(money(payment.amount)).negated()),
        currency: payment.currency,
        businessDate: dateOnly(today),
        reference: payment.reference,
        sourceKey: `pos-void:${payment.id}`,
        receivedBy: payment.receivedBy,
        receivedAt: now,
        postedAt: now,
        approvalId: approval.id,
        reversalOfId: payment.id,
      },
      select: { id: true },
    });
    await tx.posPayment.update({ where: { id: payment.id }, data: { voidedAt: now, voidedBy, voidReason: reason, voidRequestedAt: null, voidRequestedBy: null } });
    await recomputeCheckPayments(tx, check.id);
    await recordAudit(tx, {
      hotelId,
      entity: 'PosPayment',
      entityId: payment.id,
      action: 'UPDATE',
      before: { voided: false },
      after: { voided: true, reversalId: reversal.id, approvalId: approval.id, reason, voidedBy },
    });
    await stage('pos.payment.changed', { hotelId, checkId: check.id, paymentId: payment.id, change: 'VOIDED' });
    await stage('pos.check.changed', { hotelId, checkId: check.id, outletId: check.outletId, tableId: check.tableId, change: 'UPDATED' });
    return { applied: true };
  }
  await tx.posPayment.update({ where: { id: payment.id }, data: { voidRequestedAt: null, voidRequestedBy: null, voidReason: null } });
  await recordAudit(tx, {
    hotelId,
    entity: 'PosPayment',
    entityId: payment.id,
    action: 'UPDATE',
    before: { voidPending: true },
    after: { voidPending: false, outcome: granted ? failure : outcomeName, approvalId: approval.id },
  });
  await stage('pos.payment.changed', { hotelId, checkId: check.id, paymentId: payment.id, change: 'VOID_DECLINED' });
  await stage('pos.check.changed', { hotelId, checkId: check.id, outletId: check.outletId, tableId: check.tableId, change: 'UPDATED' });
  // Bekleyen iptal kalktı: bakiye sıfırsa adisyon kapanabilir.
  await closeIfSettled(tx, stage, { hotelId, checkId: check.id, today });
  return { applied: false, failure };
}
