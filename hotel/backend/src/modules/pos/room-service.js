import { randomUUID } from 'node:crypto';
import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import {
  ROOM_SERVICE_ACTIVE_STATUSES,
  ROOM_SERVICE_KITCHEN_STATUSES,
  ROOM_SERVICE_STATUS_LABELS,
  deliverAtError,
  kitchenStarted,
  roomServiceSchedule,
  roomServiceTransitionError,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, ForbiddenError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockGuestRequests, lockReservations, lockRoomServiceOrders } from '../../lib/locks.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { applyRequestStatus } from '../guest-requests/service.js';
import { needsLargePaymentApproval } from '../payments/rules.js';
import { guestFullName } from '../reservations/guests.js';
import { addOrderRound, closeIfSettled, lockedCheck, pendingState } from './checks.js';
import { postRoomCharge, takePayment } from './payments.js';
import { getOrder } from './room-service-read.js';
import { doorSettlement, menuLineErrors, quoteItems, roomServiceNumber } from './room-service-rules.js';
import { adjustmentValue, checkBalance, lineFreeQuantity } from './rules.js';
import { ensureTrayItem } from './setup.js';
import { computeCheckTotals, day, hotelContext, loadPosSettings, money, nextCheckNumber, prisma, recomputeCheckTotals, requireOpenShift } from './shared.js';

/**
 * Oda servisi siparişinin akışı (modül 41).
 *
 * ### Mutfağa düşüş
 *
 * Sipariş mutfağa düştüğünde (personelin "hemen" siparişi, misafir siparişinin kabulü, planlı siparişin zamanı)
 * oda servisi noktasında bir **adisyon** açılır ve **sipariş turu** yazılır: kalemler ürünün o anki adı / fiyatıyla,
 * politikada tepsi ücreti varsa "Oda servisi ücreti" kalemiyle. Mutfak ekranı (modül 40) turu restoranın turu gibi
 * alır (`fnb.order.placed`; oda numarası ve istenen teslim anıyla). Adisyon işlemi yapanın vardiyasına açılır;
 * zamanlanmış düşüşte siparişi girenin, yoksa oda servisi noktasında en erken açılmış vardiyaya (`pickReleaseShift`).
 *
 * ### Teslim
 *
 * Teslim tek transaction'dır: kapıda alınan ödemeler (götürenin vardiya kasasına), kalanın odaya yazılması
 * (`fnb.order.charged` → folyo), adisyonun kapanması, turların "servis edildi"si ve misafir isteğinin tamamlanması.
 * Hesap teslimden önce adisyon ekranından kapatılamaz (`room-service-guards.js`).
 *
 * ### İptal
 *
 * Mutfağa düşmemiş sipariş (planlı) adisyonsuz iptal edilir. Mutfağa düşmüşse kalemler iptal düzeltmesiyle düşer
 * (mutfak başladıysa zayi; şef garson) ve adisyon sıfır bakiyeyle kapanır — stok zayiyi `fnb.order.paid`'den okur.
 *
 * ### Kilit sırası
 *
 * vardiya (paylaşımlı) → adisyon → sipariş → rezervasyon → misafir isteği. Personel işlemleri ekranın gördüğü
 * sürümle yapılır; tekrar gönderime karşı istek kimliği (`sourceKey`) vardır.
 */

const ORDER_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  outletId: true,
  number: true,
  checkId: true,
  reservationId: true,
  roomId: true,
  roomNumber: true,
  guestName: true,
  source: true,
  guestRequestId: true,
  status: true,
  covers: true,
  note: true,
  deliverAt: true,
  releaseAt: true,
  dueAt: true,
  items: true,
  itemsTotal: true,
  trayExpected: true,
  createdBy: true,
  runnerEmail: true,
  readyAt: true,
  updatedAt: true,
  outlet: { select: { id: true, name: true, isActive: true, kind: true } },
});

/* ══════════════════ Ortak parçalar ══════════════════ */

/**
 * Kilitli sipariş (sürüm verildiyse denetlenir).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} orderId
 * @param {{ expectedUpdatedAt?: Date | null }} [options]
 */
export async function lockedOrder(tx, hotelId, orderId, { expectedUpdatedAt = null } = {}) {
  if (!(await lockRoomServiceOrders(tx, hotelId, [orderId])).has(orderId)) throw new NotFoundError('Oda servisi siparişi bulunamadı');
  const order = await tx.roomServiceOrder.findFirst({ where: { id: orderId }, select: ORDER_SELECT });
  if (expectedUpdatedAt && order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError('Sipariş siz bakarken değişti; ekran yenilendi, tekrar deneyin.');
  return order;
}

/** Sıradaki sipariş numarası (otel × yıl; geri alınan transaction numara tüketmez). */
export async function nextOrderNumber(tx, hotelId, year) {
  const [row] = await tx.$queryRaw`
    INSERT INTO "PosSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, 'ROOM_SERVICE', ${year}, 1)
    ON CONFLICT ("hotelId", "kind", "year") DO UPDATE SET "last" = "PosSequence"."last" + 1
    RETURNING "last"`;
  return roomServiceNumber(year, row.last);
}

/** Aktif oda servisi noktası. @param {any} client @param {string} hotelId @param {string} outletId */
export async function roomServiceOutlet(client, hotelId, outletId) {
  const outlet = await client.posOutlet.findFirst({ where: { id: outletId, hotelId }, select: { id: true, name: true, kind: true, isActive: true } });
  if (!outlet || !outlet.isActive || outlet.kind !== 'ROOM_SERVICE') throw new ValidationError('Oda servisi noktası bulunamadı ya da kapalı', { field: 'outletId' });
  return outlet;
}

/**
 * İçerideki, odalı konaklama (kilitli olmalı ya da yalnızca okunuyor).
 * @param {any} client @param {string} hotelId @param {string} reservationId @param {string} [field]
 */
export async function inHouseStay(client, hotelId, reservationId, field = 'reservationId') {
  const stay = await client.reservation.findFirst({
    where: { id: reservationId, hotelId },
    select: { id: true, status: true, roomId: true, checkOut: true, confirmationCode: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } },
  });
  if (!stay) throw new ValidationError('Konaklama bulunamadı', { field });
  if (stay.status !== 'CHECKED_IN' || !stay.roomId) throw new ValidationError('Misafir içeride değil (giriş yapılmamış ya da çıkış yapmış)', { field });
  return { id: stay.id, roomId: stay.roomId, roomNumber: stay.room.number, guestName: guestFullName(stay.guest), checkOut: day(stay.checkOut), confirmationCode: stay.confirmationCode };
}

/**
 * Formun duvar saatini (otelin saati) ana çevirir ve kuralı uygular; konaklamanın çıkış gününden sonrası olmaz.
 * @param {string | null | undefined} text @param {{ timezone: string, now: Date, checkOut?: string }} context @param {string} [field]
 */
export function parseDeliverAt(text, { timezone, now, checkOut }, field = 'deliverAt') {
  if (!text) return null;
  const at = zonedWallTimeToUtc(text, timezone);
  if (!at) throw new ValidationError('Teslim saati geçersiz', { field });
  const error = deliverAtError(at, now);
  if (error) throw new ValidationError(error, { field });
  if (checkOut && utcToZonedWallTime(at, timezone).slice(0, 10) > checkOut) throw new ValidationError(`Misafir ${checkOut} günü çıkıyor; teslim konaklama içinde olmalı`, { field });
  return at;
}

/**
 * Ürünleri denetler ve kopyasını çıkarır.
 * @param {any} tx @param {string} hotelId @param {string} outletId @param {Array<{ menuItemId: string, quantity: number, note?: string | null }>} lines
 */
export async function quoteLines(tx, hotelId, outletId, lines) {
  const menu = await tx.menuItem.findMany({
    where: { hotelId, id: { in: [...new Set(lines.map((line) => line.menuItemId))] } },
    select: { id: true, name: true, price: true, taxCategory: true, station: true, isActive: true, soldOut: true, system: true, category: { select: { isActive: true, outletIds: true } } },
  });
  const byId = new Map(menu.map((item) => [item.id, item]));
  const fields = menuLineErrors(lines, byId, outletId);
  if (Object.keys(fields).length) throw new ValidationError(Object.values(fields)[0], { fields });
  return quoteItems(lines, byId);
}

/** Kopyadaki kalemler sipariş satırına. @param {any} items */
export const linesOf = (items) => (Array.isArray(items) ? items : []).map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity, note: item.note ?? null }));

/** @param {Function} stage @param {any} order @param {string} status @param {string} change */
const publish = (stage, order, status, change) =>
  stage('pos.room_service.changed', { hotelId: order.hotelId, orderId: order.id, outletId: order.outletId, reservationId: order.reservationId, status, change });

/**
 * Siparişi mutfağa düşürür (sipariş kilitliyken ya da yeni yazılırken): vardiyada masasız adisyon, sipariş turu
 * (kalemler + tepsi ücreti). Adisyonun istek anahtarı siparişin kimliğidir: aynı sipariş iki kez düşmez.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, today: string, order: { id: string, outletId: string, number: string, covers: number, note: string | null, roomNumber: string, deliverAt: Date | null }, shift: { id: string, waiterEmail: string }, lines: any[], settings: any }} input
 * @returns {Promise<{ checkId: string, items: any[], itemsTotal: string }>}
 */
export async function fireOrder(tx, stage, { hotelId, today, order, shift, lines, settings }) {
  const actor = currentActor();
  const number = await nextCheckNumber(tx, hotelId, Number(today.slice(0, 4)));
  const created = await tx.posCheck.create({
    data: {
      hotelId,
      outletId: order.outletId,
      tableId: null,
      number,
      covers: order.covers,
      note: `Oda ${order.roomNumber} · ${order.number}${order.note ? ` · ${order.note}` : ''}`.slice(0, 200),
      waiterEmail: shift.waiterEmail,
      shiftId: shift.id,
      sourceKey: `room-service:${order.id}`,
      openedBy: actor,
    },
    select: { id: true },
  });
  await recordAudit(tx, { hotelId, entity: 'PosCheck', entityId: created.id, action: 'CREATE', after: { number, outletId: order.outletId, roomService: order.number, room: order.roomNumber, waiter: shift.waiterEmail } });
  await stage('pos.check.changed', { hotelId, checkId: created.id, outletId: order.outletId, tableId: null, change: 'OPENED' });
  const check = await lockedCheck(tx, hotelId, created.id);
  const systemLines = [];
  if (toDecimal(settings.trayCharge).greaterThan(0)) {
    const tray = await ensureTrayItem(tx, hotelId, settings.trayCharge, { lockHotel: true });
    systemLines.push({ menuItemId: tray.id, name: tray.name, unitPrice: settings.trayCharge, quantity: 1, taxCategory: tray.taxCategory, station: 'NONE' });
  }
  const round = await addOrderRound(tx, stage, {
    hotelId,
    check,
    lines,
    sourceKey: `room-service:${order.id}`,
    systemLines,
    roomService: { roomNumber: order.roomNumber, deliverAt: order.deliverAt ? order.deliverAt.toISOString() : null },
  });
  const itemsTotal = round.items.reduce((sum, item) => sum.plus(toDecimal(item.unitPrice).times(item.quantity)), toDecimal(0));
  return { checkId: created.id, items: round.items, itemsTotal: toMoneyString(itemsTotal) };
}

/**
 * Misafir isteğini siparişe bağlar (istek kilitliyken): oda servisi isteği, açık, aynı konaklamanın; bitmemiş başka
 * siparişi yok (teslim edilmiş siparişten sonra yeniden açılan istek yeniden çevrilir). Açıksa "işlemde"ye alınır.
 * @param {any} tx @param {Function} stage @param {string} hotelId @param {string} requestId @param {{ id: string, roomId: string }} stay
 */
async function linkGuestRequest(tx, stage, hotelId, requestId, stay) {
  if (!(await lockGuestRequests(tx, hotelId, [requestId])).has(requestId)) throw new ValidationError('Misafir isteği bulunamadı', { field: 'guestRequestId' });
  const request = await tx.guestRequest.findFirst({ where: { id: requestId, hotelId }, select: { id: true, category: true, status: true, reservationId: true, roomId: true } });
  if (request.category !== 'ROOM_SERVICE') throw new ValidationError('Yalnızca oda servisi isteği siparişe çevrilir', { field: 'guestRequestId' });
  if (!['OPEN', 'IN_PROGRESS'].includes(request.status)) throw new ConflictError('İstek kapanmış; siparişe çevrilmez.', 'REQUEST_CLOSED');
  if ((request.reservationId && request.reservationId !== stay.id) || (!request.reservationId && request.roomId && request.roomId !== stay.roomId)) {
    throw new ValidationError('İstek başka bir konaklamanın / odanın', { field: 'reservationId' });
  }
  const active = await tx.roomServiceOrder.findFirst({ where: { guestRequestId: requestId, status: { in: [...ROOM_SERVICE_ACTIVE_STATUSES] } }, select: { number: true } });
  if (active) throw new ConflictError(`İstek zaten siparişe çevrildi: ${active.number}`, 'REQUEST_LINKED');
  if (request.status === 'OPEN') await applyRequestStatus(tx, stage, hotelId, requestId, { status: 'IN_PROGRESS' });
}

/**
 * Bağlı misafir isteğini siparişin sonucuna göre günceller: teslimde tamamlanır, iptalde yeniden açılır (misafir
 * hâlâ bekliyor olabilir; personel kapatır). İstek bu arada elle kapatıldıysa dokunulmaz.
 * @param {any} tx @param {Function} stage @param {string} hotelId @param {string | null} requestId @param {'DONE' | 'OPEN'} status @param {string} note
 */
async function settleGuestRequest(tx, stage, hotelId, requestId, status, note) {
  if (!requestId) return;
  const request = await tx.guestRequest.findFirst({ where: { id: requestId, hotelId }, select: { status: true } });
  if (!request || !['OPEN', 'IN_PROGRESS'].includes(request.status) || request.status === status) return;
  await applyRequestStatus(tx, stage, hotelId, requestId, { status, note });
}

/* ══════════════════ Personelin siparişi ══════════════════ */

/**
 * Personelin girdiği sipariş (telefon, kat) ya da misafir isteğinden çevrilen: hemen ise girenin açık vardiyasında
 * mutfağa düşer; ileri saatli ise planlanır (vardiya gerekmez). İstek kimliği tekrar gelirse aynı sipariş.
 *
 * @param {string} hotelId
 * @param {any} input `createRoomServiceOrderSchema`
 */
export async function createOrder(hotelId, input) {
  const actor = currentActor();
  const { timezone, today } = await hotelContext(hotelId);
  const sourceKey = `rs:${input.requestId}`;
  let orderId;
  try {
    orderId = await writeWithEvents(async (tx, stage) => {
      const existing = await tx.roomServiceOrder.findFirst({ where: { hotelId, sourceKey }, select: { id: true } });
      if (existing) return existing.id;
      const now = new Date();
      const [outlet, settings] = await Promise.all([roomServiceOutlet(tx, hotelId, input.outletId), loadPosSettings(tx, hotelId)]);
      // Konaklamanın çıkışı okunmadan önce biçim / aralık; çıkış gününe göre sonra.
      const deliverAt = parseDeliverAt(input.deliverAt, { timezone, now });
      const plan = roomServiceSchedule({ now, deliverAt, prepLeadMinutes: settings.prepLeadMinutes, deliveryTargetMinutes: settings.deliveryTargetMinutes });
      const shift = plan.status === 'RECEIVED' ? await requireOpenShift(tx, hotelId, actor) : null;
      await lockReservations(tx, hotelId, [input.reservationId]);
      const stay = await inHouseStay(tx, hotelId, input.reservationId);
      parseDeliverAt(input.deliverAt, { timezone, now, checkOut: stay.checkOut });
      if (input.guestRequestId) await linkGuestRequest(tx, stage, hotelId, input.guestRequestId, stay);
      const quote = await quoteLines(tx, hotelId, outlet.id, input.lines);
      const id = randomUUID();
      const number = await nextOrderNumber(tx, hotelId, Number(today.slice(0, 4)));
      const base = { id, outletId: outlet.id, number, covers: input.covers, note: input.note ?? null, roomNumber: stay.roomNumber, deliverAt };
      const fired = shift ? await fireOrder(tx, stage, { hotelId, today, order: base, shift, lines: input.lines, settings }) : null;
      const row = await tx.roomServiceOrder.create({
        data: {
          ...base,
          hotelId,
          checkId: fired?.checkId ?? null,
          reservationId: stay.id,
          roomId: stay.roomId,
          guestName: stay.guestName,
          source: input.guestRequestId ? 'REQUEST' : 'STAFF',
          guestRequestId: input.guestRequestId ?? null,
          status: plan.status,
          releaseAt: plan.releaseAt,
          dueAt: plan.dueAt,
          items: fired?.items ?? quote.items,
          itemsTotal: fired?.itemsTotal ?? quote.itemsTotal,
          trayExpected: input.trayExpected,
          sourceKey,
          createdBy: actor,
          receivedAt: fired ? now : null,
        },
        select: { id: true, hotelId: true, outletId: true, reservationId: true },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'RoomServiceOrder',
        entityId: id,
        action: 'CREATE',
        after: { number, room: stay.roomNumber, status: plan.status, deliverAt: deliverAt?.toISOString() ?? null, items: quote.items.map((item) => `${item.quantity} × ${item.name}`).slice(0, 30), request: input.guestRequestId ?? null },
      });
      await publish(stage, row, plan.status, 'CREATED');
      return id;
    });
  } catch (error) {
    // Aynı istek aynı anda iki kez geldi: kazananın siparişi.
    const winner = error?.code === 'P2002' && String(error.meta?.target ?? '').includes('sourceKey') ? await prisma.roomServiceOrder.findFirst({ where: { hotelId, sourceKey }, select: { id: true } }) : null;
    if (!winner) rethrowPrismaError(error, { uniqueMessage: 'Bu istek az önce siparişe çevrildi; ekranı yenileyin.' });
    orderId = winner.id;
  }
  return getOrder(hotelId, orderId);
}

/* ══════════════════ Misafir siparişi: kabul / ret ══════════════════ */

/**
 * Misafirin (QR) siparişini kabul: kalemler misafirle konuşularak değiştirilebilir. İstenen an yakınsa (ya da
 * hemen ise) kabul edenin vardiyasında mutfağa düşer; uzaksa planlanır. Teslim hedefi siparişin geldiği andan
 * sayılır (misafirin beklediği süre kabulü beklemeyi de içerir).
 *
 * @param {string} hotelId @param {string} orderId @param {any} input `acceptRoomServiceOrderSchema`
 */
export async function acceptOrder(hotelId, orderId, input) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const seed = await tx.roomServiceOrder.findFirst({ where: { id: orderId, hotelId }, select: { deliverAt: true } });
    if (!seed) throw new NotFoundError('Oda servisi siparişi bulunamadı');
    const now = new Date();
    const settings = await loadPosSettings(tx, hotelId);
    const plan = roomServiceSchedule({ now, deliverAt: seed.deliverAt, prepLeadMinutes: settings.prepLeadMinutes, deliveryTargetMinutes: settings.deliveryTargetMinutes });
    const shift = plan.status === 'RECEIVED' ? await requireOpenShift(tx, hotelId, actor) : null;
    const order = await lockedOrder(tx, hotelId, orderId, { expectedUpdatedAt: input.expectedUpdatedAt });
    if (order.status !== 'REQUESTED') throw new ConflictError(`Sipariş ${ROOM_SERVICE_STATUS_LABELS[order.status].toLocaleLowerCase('tr-TR')}; kabul edilemez.`, 'INVALID_TRANSITION');
    if (!order.outlet.isActive) throw new ConflictError(`${order.outlet.name} kapalı; siparişi reddedin.`, 'OUTLET_CLOSED');
    await lockReservations(tx, hotelId, [order.reservationId]);
    const stay = await inHouseStay(tx, hotelId, order.reservationId);
    const lines = input.lines ?? linesOf(order.items);
    const quote = await quoteLines(tx, hotelId, order.outletId, lines);
    const fired = shift ? await fireOrder(tx, stage, { hotelId, today, order: { ...order, roomNumber: stay.roomNumber }, shift, lines, settings }) : null;
    await tx.roomServiceOrder.update({
      where: { id: orderId },
      data: {
        status: plan.status,
        roomId: stay.roomId,
        roomNumber: stay.roomNumber,
        // "Kabul bekliyor" uyarısı düştüyse sıfırlanır: planlı sipariş düşemezse yeniden uyarı alabilsin.
        waitAlertedAt: null,
        acceptedAt: now,
        acceptedBy: actor,
        releaseAt: plan.releaseAt,
        checkId: fired?.checkId ?? null,
        receivedAt: fired ? now : null,
        items: fired?.items ?? quote.items,
        itemsTotal: fired?.itemsTotal ?? quote.itemsTotal,
      },
    });
    await recordAudit(tx, { hotelId, entity: 'RoomServiceOrder', entityId: orderId, action: 'UPDATE', before: { status: 'REQUESTED' }, after: { status: plan.status, changedLines: Boolean(input.lines), by: actor } });
    await publish(stage, order, plan.status, 'ACCEPTED');
  });
  return getOrder(hotelId, orderId);
}

/** Misafir siparişini ret (gerekçe misafire görünür). @param {string} hotelId @param {string} orderId @param {any} input */
export async function rejectOrder(hotelId, orderId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const order = await lockedOrder(tx, hotelId, orderId, { expectedUpdatedAt: input.expectedUpdatedAt });
    if (order.status !== 'REQUESTED') throw new ConflictError(`Sipariş ${ROOM_SERVICE_STATUS_LABELS[order.status].toLocaleLowerCase('tr-TR')}; reddedilemez.`, 'INVALID_TRANSITION');
    await tx.roomServiceOrder.update({ where: { id: orderId }, data: { status: 'REJECTED', rejectedAt: new Date(), rejectedBy: actor, rejectReason: input.reason } });
    await recordAudit(tx, { hotelId, entity: 'RoomServiceOrder', entityId: orderId, action: 'UPDATE', before: { status: 'REQUESTED' }, after: { status: 'REJECTED', reason: input.reason, by: actor } });
    await publish(stage, order, 'REJECTED', 'REJECTED');
  });
  return getOrder(hotelId, orderId);
}

/* ══════════════════ Planlı sipariş: mutfağa gönderme ══════════════════ */

/**
 * Planlı siparişi şimdi mutfağa gönderir (personel; işlemi yapanın vardiyası). Ürün tükendiyse kalemler
 * değiştirilerek gönderilir.
 * @param {string} hotelId @param {string} orderId @param {any} input `acceptRoomServiceOrderSchema`
 */
export async function releaseOrder(hotelId, orderId, input) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const shift = await requireOpenShift(tx, hotelId, actor);
    const order = await lockedOrder(tx, hotelId, orderId, { expectedUpdatedAt: input.expectedUpdatedAt });
    if (order.status !== 'SCHEDULED') throw new ConflictError(`Sipariş ${ROOM_SERVICE_STATUS_LABELS[order.status].toLocaleLowerCase('tr-TR')}; mutfağa gönderilemez.`, 'INVALID_TRANSITION');
    await releaseLocked(tx, stage, { hotelId, today, order, shift, lines: input.lines ?? linesOf(order.items) });
  });
  return getOrder(hotelId, orderId);
}

/**
 * Kilitli planlı siparişi mutfağa düşürür (personel ya da zamanlayıcı).
 * @param {any} tx @param {Function} stage @param {{ hotelId: string, today: string, order: any, shift: { id: string, waiterEmail: string }, lines: any[] }} input
 */
export async function releaseLocked(tx, stage, { hotelId, today, order, shift, lines }) {
  if (!order.outlet.isActive) throw new ConflictError(`${order.outlet.name} kapalı; siparişi iptal edin.`, 'OUTLET_CLOSED');
  await lockReservations(tx, hotelId, [order.reservationId]);
  const stay = await inHouseStay(tx, hotelId, order.reservationId);
  const settings = await loadPosSettings(tx, hotelId);
  const fired = await fireOrder(tx, stage, { hotelId, today, order: { ...order, roomNumber: stay.roomNumber }, shift, lines, settings });
  const now = new Date();
  await tx.roomServiceOrder.update({
    where: { id: order.id },
    data: { status: 'RECEIVED', receivedAt: now, checkId: fired.checkId, items: fired.items, itemsTotal: fired.itemsTotal, roomId: stay.roomId, roomNumber: stay.roomNumber, waitAlertedAt: null },
  });
  await recordAudit(tx, { hotelId, entity: 'RoomServiceOrder', entityId: order.id, action: 'UPDATE', before: { status: 'SCHEDULED' }, after: { status: 'RECEIVED', waiter: shift.waiterEmail, by: currentActor() } });
  await publish(stage, order, 'RECEIVED', 'RELEASED');
}

/* ══════════════════ Mutfak / servis adımı ══════════════════ */

/** Sipariş durumuna karşılık mutfak turunun durumu (yalnızca ileri; modül 40 ekranı da ilerletir). */
const KITCHEN_ORDER_STATUS = Object.freeze({ PREPARING: { to: 'PREPARING', from: ['NEW'] }, READY: { to: 'READY', from: ['NEW', 'PREPARING'] }, ON_THE_WAY: { to: 'READY', from: ['NEW', 'PREPARING'] } });

/**
 * Hazırlanıyor / hazır / yolda (götüren seçilir; yoksa işlemi yapan) ve yoldan hazıra geri.
 * @param {string} hotelId @param {string} orderId @param {any} input `advanceRoomServiceOrderSchema`
 */
export async function advanceOrder(hotelId, orderId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const order = await lockedOrder(tx, hotelId, orderId, { expectedUpdatedAt: input.expectedUpdatedAt });
    const blocked = roomServiceTransitionError(order.status, input.status);
    if (blocked) throw new ConflictError(blocked, 'INVALID_TRANSITION');
    const now = new Date();
    const data = /** @type {Record<string, any>} */ ({ status: input.status });
    if (input.status === 'PREPARING') data.preparingAt = now;
    if (input.status === 'READY') {
      if (order.status === 'ON_THE_WAY') Object.assign(data, { dispatchedAt: null, runnerEmail: null, readyAt: order.readyAt ?? now });
      else data.readyAt = now;
    }
    if (input.status === 'ON_THE_WAY') {
      const runner = input.runnerEmail ?? actor;
      if (runner !== actor && !(await findActiveStaffByEmail(tx, hotelId, runner))) throw new ValidationError('Götüren personel bulunamadı', { field: 'runnerEmail' });
      Object.assign(data, { dispatchedAt: now, runnerEmail: runner });
    }
    await tx.roomServiceOrder.update({ where: { id: orderId }, data });
    const kitchen = KITCHEN_ORDER_STATUS[input.status];
    if (kitchen && order.checkId && order.status !== 'ON_THE_WAY') {
      await tx.posOrder.updateMany({ where: { checkId: order.checkId, status: { in: kitchen.from } }, data: { status: kitchen.to } });
    }
    await recordAudit(tx, { hotelId, entity: 'RoomServiceOrder', entityId: orderId, action: 'UPDATE', before: { status: order.status }, after: { status: input.status, runner: data.runnerEmail ?? null, by: actor } });
    await publish(stage, order, input.status, 'ADVANCED');
    if (order.checkId) await stage('pos.check.changed', { hotelId, checkId: order.checkId, outletId: order.outletId, tableId: null, change: 'UPDATED' });
  });
  return getOrder(hotelId, orderId);
}

/* ══════════════════ Teslim ══════════════════ */

/**
 * Teslim: kapıda alınan ödemeler (götürenin vardiyasına), kalanın odaya yazılması, adisyonun kapanması, turların
 * "servis edildi"si, misafir isteğinin tamamlanması — tek transaction. Kapıda büyük ödeme (onaya giden) varsa kalan
 * odaya yazılmaz (onay bekleyen ödeme varken folyoya yazılmaz); tamamı kapıda alınmalı.
 *
 * @param {string} hotelId @param {string} orderId @param {any} input `deliverRoomServiceOrderSchema`
 */
export async function deliverOrder(hotelId, orderId, input) {
  const actor = currentActor();
  const { hotel, today } = await hotelContext(hotelId);
  const paymentKey = (index) => `rsd:${input.requestId}:${index}`;
  const roomKey = `rsd:${input.requestId}`;
  try {
    await writeWithEvents(async (tx, stage) => {
      const replayed = async () => {
        const [payment, charge] = await Promise.all([
          tx.posPayment.findFirst({ where: { hotelId, sourceKey: paymentKey(0) }, select: { checkId: true } }),
          tx.posRoomCharge.findFirst({ where: { hotelId, sourceKey: roomKey }, select: { checkId: true } }),
        ]);
        return Boolean(payment || charge);
      };
      if (await replayed()) return;
      const seed = await tx.roomServiceOrder.findFirst({ where: { id: orderId, hotelId }, select: { checkId: true } });
      if (!seed) throw new NotFoundError('Oda servisi siparişi bulunamadı');
      if (!seed.checkId) throw new ConflictError('Sipariş mutfağa düşmedi; teslim edilemez.', 'INVALID_TRANSITION');
      const shift = input.payments.length ? await requireOpenShift(tx, hotelId, actor) : null;
      // Kapanmış adisyon da kilitlenir: aynı anda iki teslimde kaybeden "adisyon kapanmış" değil, siparişin durumunu görür.
      const check = await lockedCheck(tx, hotelId, seed.checkId, { open: false });
      const order = await lockedOrder(tx, hotelId, orderId, { expectedUpdatedAt: input.expectedUpdatedAt });
      if (await replayed()) return;
      if (!ROOM_SERVICE_KITCHEN_STATUSES.includes(order.status)) throw new ConflictError(`Sipariş ${ROOM_SERVICE_STATUS_LABELS[order.status].toLocaleLowerCase('tr-TR')}; teslim edilemez.`, 'INVALID_TRANSITION');
      if (order.checkId !== check.id) throw new StaleWriteError();
      if (check.status !== 'OPEN') throw new ConflictError('Siparişin adisyonu kapanmış; adisyon ekranından bakın.', 'CHECK_CLOSED');

      const pending = await pendingState(tx, check.id);
      if (pending.adjustments) throw new ConflictError('Onay bekleyen ikram / iptal / indirim var; karar gelmeden teslimde hesap kapanmaz.', 'PENDING_ADJUSTMENT');
      if (pending.payments || pending.voids) throw new ConflictError('Onay bekleyen ödeme var; karar bekleniyor.', 'PENDING_APPROVAL');
      // Toplamlar kalemlerden (vergi ayarı değiştiyse güncellenir).
      const totals = await computeCheckTotals(tx, hotelId, check.id);
      const grandTotal = totals.grandTotal === money(check.grandTotal) ? money(check.grandTotal) : (await recomputeCheckTotals(tx, hotelId, check.id)).grandTotal;
      const balance = checkBalance({ grandTotal, paidTotal: money(check.paidTotal), roomChargeTotal: money(check.roomChargeTotal) });
      const plan = doorSettlement({ balance, payments: input.payments, chargeRemainder: input.chargeRemainder });
      if (plan.error) throw new ValidationError(plan.error, { field: plan.field });
      const threshold = String(hotel.largePaymentThreshold ?? 0);
      if (toDecimal(plan.remainder).greaterThan(0) && input.payments.some((payment) => needsLargePaymentApproval(payment.amount, threshold))) {
        throw new ValidationError('Kapıdaki ödeme büyük ödeme onayına gidiyor; onay beklerken kalan odaya yazılmaz. Tamamını kapıda alın ya da tamamını odaya yazın.', { field: 'payments' });
      }

      for (const [index, payment] of input.payments.entries()) {
        await takePayment(tx, stage, { hotelId, hotel, today, shift, check, input: payment, sourceKey: paymentKey(index) });
      }
      if (toDecimal(plan.remainder).greaterThan(0)) {
        await postRoomCharge(tx, stage, { hotelId, hotel, today, check, reservationId: order.reservationId, amount: plan.remainder, sourceKey: roomKey, label: `${order.outlet.name} · ${order.number}`, field: 'chargeRemainder' });
      } else {
        // Ödemesiz teslim (tamamı ikram) ya da kapıda tamamı: bakiye sıfırsa kapanır (kapanmadıysa onay bekliyor).
        await closeIfSettled(tx, stage, { hotelId, checkId: check.id, today });
      }

      const now = new Date();
      await tx.posOrder.updateMany({ where: { checkId: check.id, status: { not: 'SERVED' } }, data: { status: 'SERVED' } });
      await tx.roomServiceOrder.update({ where: { id: orderId }, data: { status: 'DELIVERED', deliveredAt: now, deliveredBy: actor, runnerEmail: order.runnerEmail ?? actor } });
      await settleGuestRequest(tx, stage, hotelId, order.guestRequestId, 'DONE', `Oda servisi ${order.number} teslim edildi`);
      await recordAudit(tx, {
        hotelId,
        entity: 'RoomServiceOrder',
        entityId: orderId,
        action: 'UPDATE',
        before: { status: order.status },
        after: { status: 'DELIVERED', doorPaid: plan.paid, roomCharged: plan.remainder, by: actor },
      });
      await publish(stage, order, 'DELIVERED', 'DELIVERED');
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu teslim az önce kaydedildi; ekranı yenileyin.' });
  }
  return getOrder(hotelId, orderId);
}

/* ══════════════════ İptal ══════════════════ */

/**
 * İptal (gerekçeli): planlı sipariş adisyonsuz düşer; mutfağa düşmüş siparişin kalemleri iptal edilir (mutfak
 * başladıysa zayi; bu durumda şef garson yetkisi gerekir) ve adisyon sıfır bakiyeyle kapanır. Misafir siparişi
 * kabulden önce iptal edilmez, reddedilir. Bağlı misafir isteği yeniden açılır.
 *
 * @param {string} hotelId @param {string} orderId @param {any} input `cancelRoomServiceOrderSchema`
 * @param {{ canSupervise: boolean }} access
 */
export async function cancelOrder(hotelId, orderId, input, { canSupervise }) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const seed = await tx.roomServiceOrder.findFirst({ where: { id: orderId, hotelId }, select: { checkId: true } });
    if (!seed) throw new NotFoundError('Oda servisi siparişi bulunamadı');
    const check = seed.checkId ? await lockedCheck(tx, hotelId, seed.checkId, { open: false }) : null;
    const order = await lockedOrder(tx, hotelId, orderId, { expectedUpdatedAt: input.expectedUpdatedAt });
    if (order.checkId !== (check?.id ?? null)) throw new StaleWriteError();
    if (order.status === 'REQUESTED') throw new ConflictError('Misafir siparişi kabulden önce reddedilir.', 'INVALID_TRANSITION');
    if (!['SCHEDULED', ...ROOM_SERVICE_KITCHEN_STATUSES].includes(order.status)) throw new ConflictError(`Sipariş ${ROOM_SERVICE_STATUS_LABELS[order.status].toLocaleLowerCase('tr-TR')}; iptal edilemez.`, 'INVALID_TRANSITION');
    if (check && check.status !== 'OPEN') throw new ConflictError('Siparişin adisyonu kapanmış; adisyon ekranından bakın.', 'CHECK_CLOSED');
    const started = kitchenStarted(order.status);
    if (started && !canSupervise) throw new ForbiddenError('Mutfakta hazırlanan siparişi yalnızca şef garson iptal eder (kalemler zayi).');
    let voided = [];
    if (check) voided = await voidCheckLines(tx, stage, { hotelId, check, today, reason: `Oda servisi iptali: ${input.reason}`, waste: started && input.waste });
    await tx.roomServiceOrder.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: actor, cancelReason: input.reason } });
    await settleGuestRequest(tx, stage, hotelId, order.guestRequestId, 'OPEN', null);
    await recordAudit(tx, {
      hotelId,
      entity: 'RoomServiceOrder',
      entityId: orderId,
      action: 'UPDATE',
      before: { status: order.status },
      after: { status: 'CANCELLED', reason: input.reason, waste: started && input.waste, voided, by: actor },
    });
    await publish(stage, order, 'CANCELLED', 'CANCELLED');
  });
  return getOrder(hotelId, orderId);
}

/**
 * Adisyonun bütün serbest kalemlerini iptal eder (uygulanmış iptal düzeltmesiyle; tepsi ücreti zayi sayılmaz) ve
 * sıfır bakiyeli adisyonu kapatır. Ödemesi / odaya yazılanı varsa yapılmaz.
 * @param {any} tx @param {Function} stage @param {{ hotelId: string, check: any, today: string, reason: string, waste: boolean }} input
 * @returns {Promise<string[]>} iptal edilenler ("2 × Omlet")
 */
async function voidCheckLines(tx, stage, { hotelId, check, today, reason, waste }) {
  const [pending, settled, lines] = await Promise.all([
    pendingState(tx, check.id),
    Promise.all([tx.posPayment.count({ where: { checkId: check.id, status: { in: ['POSTED', 'PENDING'] }, voidedAt: null } }), tx.posRoomCharge.count({ where: { checkId: check.id } })]),
    tx.posOrderLine.findMany({ where: { checkId: check.id }, select: { id: true, name: true, station: true, unitPrice: true, quantity: true, voidedQuantity: true, compedQuantity: true } }),
  ]);
  if (pending.adjustments) throw new ConflictError('Onay bekleyen düzeltme var; karar gelmeden iptal edilmez.', 'PENDING_ADJUSTMENT');
  if (settled[0] || settled[1]) throw new ConflictError('Siparişten ödeme alınmış ya da odaya yazılmış; önce ödemeyi iptal edin.', 'CHECK_HAS_PAYMENTS');
  const actor = currentActor();
  const done = [];
  for (const line of lines) {
    const free = lineFreeQuantity(line);
    if (free <= 0) continue;
    const value = adjustmentValue({ kind: 'VOID', unitPrice: money(line.unitPrice), quantity: free });
    await tx.posAdjustment.create({
      data: { hotelId, checkId: check.id, kind: 'VOID', lineId: line.id, quantity: free, waste: waste && line.station !== 'NONE', value, reason: reason.slice(0, 300), status: 'APPLIED', requestedBy: actor },
    });
    await tx.posOrderLine.update({ where: { id: line.id }, data: { voidedQuantity: { increment: free } } });
    done.push(`${free} × ${line.name}`);
  }
  await recomputeCheckTotals(tx, hotelId, check.id);
  await closeIfSettled(tx, stage, { hotelId, checkId: check.id, today });
  await stage('pos.check.changed', { hotelId, checkId: check.id, outletId: check.outletId, tableId: null, change: 'ADJUSTED' });
  return done;
}

/* ══════════════════ Tepsi ══════════════════ */

/**
 * Tepsiler toplandı (kat görevlisi ya da oda servisi; toplu): teslim edilmiş, tepsi bırakılmış, toplanmamışlar
 * işaretlenir; zaten toplanmış ya da tepsisiz olan atlanır (iki kişi aynı anda işaretlese de sonuç aynı).
 *
 * @param {string} hotelId @param {{ orderIds: string[] }} input
 * @returns {Promise<{ collected: number, skipped: number }>}
 */
export async function collectTrays(hotelId, { orderIds }) {
  const actor = currentActor();
  return writeWithEvents(async (tx, stage) => {
    await lockRoomServiceOrders(tx, hotelId, orderIds);
    const rows = await tx.roomServiceOrder.findMany({
      where: { hotelId, id: { in: orderIds }, status: 'DELIVERED', trayExpected: true, trayCollectedAt: null },
      select: { id: true, hotelId: true, outletId: true, reservationId: true, number: true },
    });
    if (rows.length) {
      const now = new Date();
      await tx.roomServiceOrder.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { trayCollectedAt: now, trayCollectedBy: actor } });
      for (const row of rows) {
        await recordAudit(tx, { hotelId, entity: 'RoomServiceOrder', entityId: row.id, action: 'UPDATE', after: { trayCollected: true, by: actor } });
        await publish(stage, row, 'DELIVERED', 'TRAY_COLLECTED');
      }
    }
    return { collected: rows.length, skipped: orderIds.length - rows.length };
  });
}

