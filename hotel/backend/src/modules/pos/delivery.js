import { randomUUID } from 'node:crypto';
import { currentActor } from '@hotelos/core';
import { DELIVERY_ACTIVE_STATUSES, DELIVERY_STATUS_LABELS, deliveryNumber, deliveryTransitionError, internationalPhone, kitchenStarted } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, ForbiddenError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockDeliveryOrders } from '../../lib/locks.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { addOrderRound, closeIfSettled, lockedCheck, pendingState } from './checks.js';
import { getDeliveryOrder } from './delivery-read.js';
import { deliverySettlement, minimumOrderError, prepaymentPlan } from './delivery-rules.js';
import { takePayment } from './payments.js';
import { quoteLines, voidCheckLines } from './room-service.js';
import { checkBalance } from './rules.js';
import { ensureSystemItem } from './setup.js';
import { computeCheckTotals, hotelContext, loadPosSettings, money, nextCheckNumber, prisma, recomputeCheckTotals, requireOpenShift } from './shared.js';

/**
 * Paket (eve teslim) siparişin akışı (modül 42) — oda servisinin (`room-service.js`) karşılığı, misafir / folyo yok.
 *
 * ### Sipariş
 *
 * Personel girer (telefon, WhatsApp, web / platform). Sipariş alınınca mutfağa düşer: girenin vardiyasında masasız
 * **adisyon** ve **sipariş turu** (politikada ücret varsa "Paket servis ücreti" kalemiyle); en az sipariş tutarı ücret
 * hariç ürün toplamına bakar. Mutfak ekranı (modül 40) turu restoranın turu gibi alır. **Ön ödeme** (kart / havale
 * referansıyla) siparişle birlikte girenin kasasına alınır; tamamı ödense de adisyon teslime kadar açık kalır.
 *
 * ### Kurye ve teslim
 *
 * Kurye açık vardiyası olan personeldir (atanınca ziline düşer). Kapıda alınacak para varsa yola çıkış kuryenin açık
 * vardiyasını ister: teslimde kapı ödemeleri (nakit / kart, bölünebilir) **kuryenin kasasına** girer ve kalanı tam
 * kapatır (açık hesap yok). Teslim tek transaction: ödemeler, adisyonun kapanması, turların "servis edildi"si.
 *
 * ### İptal
 *
 * Kalemler iptal düzeltmesiyle düşer (mutfak başladıysa zayi; şef garson) ve adisyon sıfır bakiyeyle kapanır. Ön
 * ödeme alınmışsa önce ödeme iptal edilir (adisyon ekranından).
 *
 * ### Kilit sırası
 *
 * vardiya (paylaşımlı) → adisyon → sipariş → tur. Personel işlemleri ekranın gördüğü sürümle; tekrar gönderime karşı
 * istek kimliği (`sourceKey`) vardır.
 */

const ORDER_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  outletId: true,
  number: true,
  checkId: true,
  status: true,
  customerName: true,
  address: true,
  courierEmail: true,
  assignedAt: true,
  readyAt: true,
  updatedAt: true,
});

/** Sipariş durumuna karşılık mutfak turunun durumu (yalnız ileri; mutfak ekranı da ilerletir). */
const KITCHEN_ORDER_STATUS = Object.freeze({
  PREPARING: { to: 'PREPARING', from: ['NEW'] },
  READY: { to: 'READY', from: ['NEW', 'PREPARING'] },
  ON_THE_WAY: { to: 'READY', from: ['NEW', 'PREPARING'] },
});

/* ══════════════════ Ortak parçalar ══════════════════ */

/** @param {Function} stage @param {{ hotelId: string, id: string, outletId: string }} order @param {string} status @param {string} change */
const publish = (stage, order, status, change) => stage('pos.delivery.changed', { hotelId: order.hotelId, orderId: order.id, outletId: order.outletId, status, change });

/**
 * Kilitli sipariş (sürüm verildiyse denetlenir).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} orderId
 * @param {{ expectedUpdatedAt?: Date | null }} [options]
 */
async function lockedDelivery(tx, hotelId, orderId, { expectedUpdatedAt = null } = {}) {
  if (!(await lockDeliveryOrders(tx, hotelId, [orderId])).has(orderId)) throw new NotFoundError('Paket sipariş bulunamadı');
  const order = await tx.deliveryOrder.findFirst({ where: { id: orderId }, select: ORDER_SELECT });
  if (expectedUpdatedAt && order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError('Sipariş siz bakarken değişti; ekran yenilendi, tekrar deneyin.');
  return order;
}

/** Sıradaki paket numarası (otel × yıl). @param {any} tx @param {string} hotelId @param {number} year */
async function nextDeliveryNumber(tx, hotelId, year) {
  const [row] = await tx.$queryRaw`
    INSERT INTO "PosSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, 'DELIVERY', ${year}, 1)
    ON CONFLICT ("hotelId", "kind", "year") DO UPDATE SET "last" = "PosSequence"."last" + 1
    RETURNING "last"`;
  return deliveryNumber(year, row.last);
}

/** Aktif paket servis noktası. @param {any} client @param {string} hotelId @param {string} outletId */
async function deliveryOutlet(client, hotelId, outletId) {
  const outlet = await client.posOutlet.findFirst({ where: { id: outletId, hotelId }, select: { id: true, name: true, kind: true, isActive: true } });
  if (!outlet || !outlet.isActive || outlet.kind !== 'DELIVERY') throw new ValidationError('Paket servis noktası bulunamadı ya da kapalı', { field: 'outletId' });
  return outlet;
}

/** Adisyonun kalanı (kapıda alınacak). @param {any} client @param {string} checkId */
async function checkDue(client, checkId) {
  const check = await client.posCheck.findFirst({ where: { id: checkId }, select: { grandTotal: true, paidTotal: true, roomChargeTotal: true } });
  return checkBalance({ grandTotal: money(check.grandTotal), paidTotal: money(check.paidTotal), roomChargeTotal: money(check.roomChargeTotal) });
}

/** Kapı parası kuryenin kasasına girer: açık vardiyası olmalı. @param {any} tx @param {string} hotelId @param {string} email */
async function assertCourierShift(tx, hotelId, email) {
  const shift = await tx.posShift.findFirst({ where: { hotelId, waiterEmail: email, status: 'OPEN' }, select: { id: true } });
  if (!shift) throw new ConflictError(`${email} için açık vardiya yok; kapıda alınan para kuryenin kasasına girer — kurye vardiya açsın.`, 'NO_SHIFT');
}

/**
 * Kurye: bu otelin aktif personeli; kapıda para alacaksa açık vardiyası olmalı.
 * @param {any} tx @param {string} hotelId @param {string} email @param {{ collects: boolean }} options
 */
async function requireCourier(tx, hotelId, email, { collects }) {
  const staff = await findActiveStaffByEmail(tx, hotelId, email);
  if (!staff) throw new ValidationError('Kurye bulunamadı (otelin aktif personeli olmalı)', { field: 'courierEmail' });
  if (collects) await assertCourierShift(tx, hotelId, email);
  return staff;
}

/** Kuryenin ziline: sipariş size atandı. @param {any} tx @param {Function} stage @param {any} order @param {{ id: string }} courier */
function alertCourier(tx, stage, order, courier) {
  return raiseStaffAlert(tx, stage, {
    hotelId: order.hotelId,
    kind: 'POS',
    title: `Paket ${order.number} size atandı`,
    body: `${order.customerName} · ${order.address}`,
    link: `/pos/paket/siparis/${order.id}`,
    userId: courier.id,
    entityType: 'DeliveryOrder',
    entityId: order.id,
    dedupeKey: `delivery-courier:${order.id}`,
  });
}

/* ══════════════════ Sipariş ══════════════════ */

/**
 * Siparişi mutfağa düşürür: girenin vardiyasında masasız adisyon ve tur (kalemler + paket ücreti).
 * @param {any} tx @param {Function} stage
 * @param {{ hotelId: string, today: string, outletId: string, shift: { id: string, waiterEmail: string }, settings: any, order: { id: string, number: string, customerName: string }, lines: any[] }} input
 * @returns {Promise<string>} adisyon kimliği
 */
async function fireDelivery(tx, stage, { hotelId, today, outletId, shift, settings, order, lines }) {
  const actor = currentActor();
  const number = await nextCheckNumber(tx, hotelId, Number(today.slice(0, 4)));
  const created = await tx.posCheck.create({
    data: {
      hotelId,
      outletId,
      tableId: null,
      number,
      note: `Paket ${order.number} · ${order.customerName}`.slice(0, 200),
      waiterEmail: shift.waiterEmail,
      shiftId: shift.id,
      sourceKey: `delivery:${order.id}`,
      openedBy: actor,
    },
    select: { id: true },
  });
  await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: created.id, action: 'CREATE', after: { number, outletId, delivery: order.number, waiter: shift.waiterEmail } });
  await stage('pos.check.changed', { hotelId, checkId: created.id, outletId, tableId: null, change: 'OPENED' });
  const check = await lockedCheck(tx, hotelId, created.id);
  const systemLines = [];
  if (Number(settings.deliveryFee) > 0) {
    const fee = await ensureSystemItem(tx, hotelId, 'DELIVERY_FEE', settings.deliveryFee, { lockHotel: true });
    systemLines.push({ menuItemId: fee.id, name: fee.name, unitPrice: settings.deliveryFee, quantity: 1, taxCategory: fee.taxCategory, station: 'NONE' });
  }
  await addOrderRound(tx, stage, { hotelId, check, lines, sourceKey: `delivery:${order.id}`, systemLines });
  return created.id;
}

/**
 * Personelin girdiği paket sipariş: girenin açık vardiyasında mutfağa düşer; ön ödemeler girenin kasasına. İstek
 * kimliği tekrar gelirse aynı sipariş.
 *
 * @param {string} hotelId
 * @param {any} input `createDeliveryOrderSchema`
 */
export async function createDeliveryOrder(hotelId, input) {
  const actor = currentActor();
  const { hotel, today } = await hotelContext(hotelId);
  const phone = internationalPhone(input.phone, hotel.phoneCountryCode);
  if (!phone) throw new ValidationError('Telefon geçersiz', { field: 'phone' });
  const sourceKey = `ps:${input.requestId}`;
  let orderId;
  try {
    orderId = await writeWithEvents(async (tx, stage) => {
      const existing = await tx.deliveryOrder.findFirst({ where: { hotelId, sourceKey }, select: { id: true } });
      if (existing) return existing.id;
      const shift = await requireOpenShift(tx, hotelId, actor);
      const [outlet, settings] = await Promise.all([deliveryOutlet(tx, hotelId, input.outletId), loadPosSettings(tx, hotelId)]);
      const quote = await quoteLines(tx, hotelId, outlet.id, input.lines);
      const tooSmall = minimumOrderError(quote.itemsTotal, settings.deliveryMinOrder);
      if (tooSmall) throw new ValidationError(tooSmall, { field: 'lines' });

      const id = randomUUID();
      const number = await nextDeliveryNumber(tx, hotelId, Number(today.slice(0, 4)));
      const checkId = await fireDelivery(tx, stage, { hotelId, today, outletId: outlet.id, shift, settings, order: { id, number, customerName: input.customerName }, lines: input.lines });
      const check = await lockedCheck(tx, hotelId, checkId);
      const plan = prepaymentPlan({ grandTotal: money(check.grandTotal), prepayments: input.prepayments, doorMethod: input.doorMethod, changeFor: input.changeFor });
      if (plan.error) throw new ValidationError(plan.error, { field: plan.field });

      const now = new Date();
      // Sipariş ön ödemeden önce yazılır: tamamı ödense de adisyon teslime kadar açık kalsın (`deliveryHoldsCheck`).
      const row = await tx.deliveryOrder.create({
        data: {
          id,
          hotelId,
          outletId: outlet.id,
          number,
          checkId,
          source: input.source,
          customerName: input.customerName,
          phone,
          address: input.address,
          addressNote: input.addressNote,
          note: input.note,
          doorMethod: input.doorMethod,
          changeFor: input.changeFor,
          dueAt: new Date(now.getTime() + settings.deliveryOrderMinutes * 60_000),
          sourceKey,
          createdBy: actor,
        },
        select: { id: true, hotelId: true, outletId: true },
      });
      for (const [index, payment] of input.prepayments.entries()) {
        await takePayment(tx, stage, { hotelId, hotel, today, shift, check, input: payment, sourceKey: `${sourceKey}:pre:${index}` });
      }
      await recordAudit(tx, {
        hotelId,
        entity: 'DeliveryOrder',
        entityId: id,
        action: 'CREATE',
        after: { number, customer: input.customerName, source: input.source, items: quote.items.map((item) => `${item.quantity} × ${item.name}`).slice(0, 30), prepaid: plan.prepaid, door: input.doorMethod },
      });
      await publish(stage, row, 'RECEIVED', 'CREATED');
      return id;
    });
  } catch (error) {
    // Aynı istek aynı anda iki kez geldi: kazananın siparişi.
    const winner = error?.code === 'P2002' && String(error.meta?.target ?? '').includes('sourceKey') ? await prisma.deliveryOrder.findFirst({ where: { hotelId, sourceKey }, select: { id: true } }) : null;
    if (!winner) rethrowPrismaError(error, { uniqueMessage: 'Bu sipariş az önce kaydedildi; ekranı yenileyin.' });
    orderId = winner.id;
  }
  return getDeliveryOrder(hotelId, orderId);
}

/* ══════════════════ Mutfak / servis adımı ve kurye ══════════════════ */

/**
 * Hazırlanıyor / hazır / yolda (kurye seçilir; yoksa atanmış kurye) ve yoldan hazıra geri (kurye atanmış kalır).
 * @param {string} hotelId @param {string} orderId @param {any} input `advanceDeliveryOrderSchema`
 */
export async function advanceDeliveryOrder(hotelId, orderId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const order = await lockedDelivery(tx, hotelId, orderId, { expectedUpdatedAt: input.expectedUpdatedAt });
    const blocked = deliveryTransitionError(order.status, input.status);
    if (blocked) throw new ConflictError(blocked, 'INVALID_TRANSITION');
    const now = new Date();
    const data = /** @type {Record<string, any>} */ ({ status: input.status });
    if (input.status === 'PREPARING') data.preparingAt = now;
    if (input.status === 'READY') Object.assign(data, order.status === 'ON_THE_WAY' ? { dispatchedAt: null, readyAt: order.readyAt ?? now } : { readyAt: now });
    let newCourier = null;
    if (input.status === 'ON_THE_WAY') {
      const email = input.courierEmail ?? order.courierEmail;
      if (!email) throw new ValidationError('Kuryeyi seçin', { field: 'courierEmail' });
      const courier = await requireCourier(tx, hotelId, email, { collects: Number(await checkDue(tx, order.checkId)) > 0 });
      const changed = email !== order.courierEmail;
      Object.assign(data, { dispatchedAt: now, courierEmail: email, assignedAt: changed ? now : order.assignedAt });
      if (changed && email !== actor) newCourier = courier;
    }
    await tx.deliveryOrder.update({ where: { id: orderId }, data });
    const kitchen = KITCHEN_ORDER_STATUS[input.status];
    if (kitchen && order.status !== 'ON_THE_WAY') {
      await tx.posOrder.updateMany({ where: { checkId: order.checkId, status: { in: kitchen.from } }, data: { status: kitchen.to } });
    }
    if (newCourier) await alertCourier(tx, stage, order, newCourier);
    await recordAudit(tx, { hotelId, entity: 'DeliveryOrder', entityId: orderId, action: 'UPDATE', before: { status: order.status }, after: { status: input.status, courier: data.courierEmail ?? order.courierEmail, by: actor } });
    await publish(stage, order, input.status, 'ADVANCED');
    await stage('pos.check.changed', { hotelId, checkId: order.checkId, outletId: order.outletId, tableId: null, change: 'UPDATED' });
  });
  return getDeliveryOrder(hotelId, orderId);
}

/**
 * Kurye ata / değiştir (yola çıkmadan): kuryenin ziline düşer. Yoldaki siparişin kuryesi değişmez (önce hazıra geri).
 * @param {string} hotelId @param {string} orderId @param {any} input `assignDeliveryCourierSchema`
 */
export async function assignDeliveryCourier(hotelId, orderId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const order = await lockedDelivery(tx, hotelId, orderId, { expectedUpdatedAt: input.expectedUpdatedAt });
    if (!['RECEIVED', 'PREPARING', 'READY'].includes(order.status)) {
      const hint = order.status === 'ON_THE_WAY' ? ' (yoldaki siparişte önce hazıra geri alın)' : '';
      throw new ConflictError(`Sipariş ${DELIVERY_STATUS_LABELS[order.status].toLocaleLowerCase('tr-TR')}; kurye değiştirilemez${hint}.`, 'INVALID_TRANSITION');
    }
    const courier = await requireCourier(tx, hotelId, input.courierEmail, { collects: false });
    if (input.courierEmail === order.courierEmail) return;
    await tx.deliveryOrder.update({ where: { id: orderId }, data: { courierEmail: input.courierEmail, assignedAt: new Date() } });
    if (input.courierEmail !== actor) await alertCourier(tx, stage, order, courier);
    await recordAudit(tx, { hotelId, entity: 'DeliveryOrder', entityId: orderId, action: 'UPDATE', before: { courier: order.courierEmail }, after: { courier: input.courierEmail, by: actor } });
    await publish(stage, order, order.status, 'ASSIGNED');
  });
  return getDeliveryOrder(hotelId, orderId);
}

/* ══════════════════ Teslim ══════════════════ */

/**
 * Teslim: kapı ödemeleri kuryenin vardiyasına (kalanı tam kapatır), adisyonun kapanması, turların "servis edildi"si
 * — tek transaction. Kapıda büyük ödeme onaya giderse adisyon onayla kapanır. Teslim edilmiş siparişe tekrar teslim
 * (çift dokunuş) aynı sonucu döner.
 *
 * @param {string} hotelId @param {string} orderId @param {any} input `deliverDeliveryOrderSchema`
 */
export async function deliverDeliveryOrder(hotelId, orderId, input) {
  const actor = currentActor();
  const { hotel, today } = await hotelContext(hotelId);
  const paymentKey = (index) => `psd:${input.requestId}:${index}`;
  try {
    await writeWithEvents(async (tx, stage) => {
      const seed = await tx.deliveryOrder.findFirst({ where: { id: orderId, hotelId }, select: { checkId: true, status: true, courierEmail: true } });
      if (!seed) throw new NotFoundError('Paket sipariş bulunamadı');
      if (seed.status === 'DELIVERED') return;
      const courierEmail = seed.courierEmail ?? actor;
      if (input.payments.length) await assertCourierShift(tx, hotelId, courierEmail);
      const shift = input.payments.length ? await requireOpenShift(tx, hotelId, courierEmail) : null;
      const check = await lockedCheck(tx, hotelId, seed.checkId, { open: false });
      const order = await lockedDelivery(tx, hotelId, orderId, { expectedUpdatedAt: input.expectedUpdatedAt });
      if (!DELIVERY_ACTIVE_STATUSES.includes(order.status)) throw new ConflictError(`Sipariş ${DELIVERY_STATUS_LABELS[order.status].toLocaleLowerCase('tr-TR')}; teslim edilemez.`, 'INVALID_TRANSITION');
      if ((order.courierEmail ?? actor) !== courierEmail) throw new StaleWriteError();
      if (check.status !== 'OPEN') throw new ConflictError('Siparişin adisyonu kapanmış; adisyon ekranından bakın.', 'CHECK_CLOSED');

      const pending = await pendingState(tx, check.id);
      if (pending.adjustments) throw new ConflictError('Onay bekleyen ikram / iptal / indirim var; karar gelmeden teslimde hesap kapanmaz.', 'PENDING_ADJUSTMENT');
      if (pending.payments || pending.voids) throw new ConflictError('Onay bekleyen ödeme var; karar bekleniyor.', 'PENDING_APPROVAL');
      // Toplamlar kalemlerden (vergi ayarı değiştiyse güncellenir).
      const totals = await computeCheckTotals(tx, hotelId, check.id);
      const grandTotal = totals.grandTotal === money(check.grandTotal) ? money(check.grandTotal) : (await recomputeCheckTotals(tx, hotelId, check.id)).grandTotal;
      const balance = checkBalance({ grandTotal, paidTotal: money(check.paidTotal), roomChargeTotal: money(check.roomChargeTotal) });
      const plan = deliverySettlement({ balance, payments: input.payments });
      if (plan.error) throw new ValidationError(plan.error, { field: plan.field });

      const now = new Date();
      // Önce teslim: sipariş bitince adisyon kapanabilir (`deliveryHoldsCheck`).
      await tx.deliveryOrder.update({ where: { id: orderId }, data: { status: 'DELIVERED', deliveredAt: now, deliveredBy: actor, courierEmail, assignedAt: order.assignedAt ?? now } });
      for (const [index, payment] of input.payments.entries()) {
        await takePayment(tx, stage, { hotelId, hotel, today, shift, check, input: payment, sourceKey: paymentKey(index) });
      }
      if (!input.payments.length) await closeIfSettled(tx, stage, { hotelId, checkId: check.id, today });
      await tx.posOrder.updateMany({ where: { checkId: check.id, status: { not: 'SERVED' } }, data: { status: 'SERVED' } });
      await recordAudit(tx, { hotelId, entity: 'DeliveryOrder', entityId: orderId, action: 'UPDATE', before: { status: order.status }, after: { status: 'DELIVERED', doorPaid: plan.paid, courier: courierEmail, by: actor } });
      await publish(stage, order, 'DELIVERED', 'DELIVERED');
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu teslim az önce kaydedildi; ekranı yenileyin.' });
  }
  return getDeliveryOrder(hotelId, orderId);
}

/* ══════════════════ İptal ══════════════════ */

/**
 * İptal (gerekçeli, teslimden önce): kalemler iptal edilir (mutfak başladıysa zayi; şef garson) ve adisyon sıfır
 * bakiyeyle kapanır. Ön ödeme alınmışsa önce ödeme iptal edilmeli.
 *
 * @param {string} hotelId @param {string} orderId @param {any} input `cancelDeliveryOrderSchema`
 * @param {{ canSupervise: boolean }} access
 */
export async function cancelDeliveryOrder(hotelId, orderId, input, { canSupervise }) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const seed = await tx.deliveryOrder.findFirst({ where: { id: orderId, hotelId }, select: { checkId: true } });
    if (!seed) throw new NotFoundError('Paket sipariş bulunamadı');
    const check = await lockedCheck(tx, hotelId, seed.checkId, { open: false });
    const order = await lockedDelivery(tx, hotelId, orderId, { expectedUpdatedAt: input.expectedUpdatedAt });
    if (!DELIVERY_ACTIVE_STATUSES.includes(order.status)) throw new ConflictError(`Sipariş ${DELIVERY_STATUS_LABELS[order.status].toLocaleLowerCase('tr-TR')}; iptal edilemez.`, 'INVALID_TRANSITION');
    if (check.status !== 'OPEN') throw new ConflictError('Siparişin adisyonu kapanmış; adisyon ekranından bakın.', 'CHECK_CLOSED');
    const started = kitchenStarted(order.status);
    if (started && !canSupervise) throw new ForbiddenError('Mutfakta hazırlanan siparişi yalnızca şef garson iptal eder (kalemler zayi).');
    // Önce iptal: sipariş bitince adisyon sıfır bakiyeyle kapanabilir (`deliveryHoldsCheck`).
    await tx.deliveryOrder.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: actor, cancelReason: input.reason } });
    const voided = await voidCheckLines(tx, stage, { hotelId, check, today, reason: `Paket iptali: ${input.reason}`, waste: started && input.waste });
    await recordAudit(tx, { hotelId, entity: 'DeliveryOrder', entityId: orderId, action: 'UPDATE', before: { status: order.status }, after: { status: 'CANCELLED', reason: input.reason, waste: started && input.waste, voided, by: actor } });
    await publish(stage, order, 'CANCELLED', 'CANCELLED');
  });
  return getDeliveryOrder(hotelId, orderId);
}
