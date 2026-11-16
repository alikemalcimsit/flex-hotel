import { currentActor } from '@hotelos/core';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, rethrowPrismaError } from '../../lib/errors.js';
import { lockDeliveryOrders, lockRoomServiceOrders } from '../../lib/locks.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';

/**
 * Mutfak ekranı / KDS (modül 40).
 *
 * Veri M39'un tur modelidir (`PosOrder.status NEW → PREPARING → READY →
 * SERVED`); KDS yalnız okur ve **yalnız ileri** taşır. Salonda "hazır" denince
 * adisyonun garsonuna zil gider (aynı adisyonun turları tek uyarıda toplanır).
 *
 * Teslimli turlar — oda servisi (modül 41, `PosCheck.roomService`) ve paket
 * (modül 42, `PosCheck.delivery`) — iki yönden ilerler: kendi panoları
 * adisyonun turlarını zaten yalnız ileri taşıyor — KDS de ilerletince sipariş
 * aynı kuralla ve aynı adım damgalarıyla (`preparingAt` / `readyAt`; durum izi
 * CHECK'i ister) senkronlanır. Sipariş ancak mutfakta bekleyen başka tur
 * kalmayınca "hazır" olur. **SERVED KDS'de verilmez**: teslim kendi panosunun
 * işidir. Kilit sırası panolarla aynıdır (önce sipariş, sonra tur); iki akış
 * birbirini kilitlemez.
 *
 * 2500 oda standardı: pano sorgusu tek indeksli okumadır
 * (`[hotelId, outletId, status, sentAt]`, üst sınırlı), kalem süzgeci
 * bellekte; canlı tazeleme `kitchen.changed` kanalından (olay başına yalnız
 * kimlik).
 */

/** Panoda görünen (servis edilmemiş) tur durumları. */
const ACTIVE_STATUSES = Object.freeze(['NEW', 'PREPARING', 'READY']);

/** Pano üst sınırı: en yoğun serviste bile açık tur sayısı bunun çok altında kalır. */
const KDS_BOARD_LIMIT = 300;

/** KDS'nin ilerletme haritası — yalnız ileri. */
const FORWARD = Object.freeze({
  PREPARING: ['NEW'],
  READY: ['NEW', 'PREPARING'],
  SERVED: ['READY', 'PREPARING', 'NEW'],
});

/**
 * Teslimli siparişler: adisyondaki ilişki → sipariş tablosu, kilidi, pano olayı ve SERVED'in reddi. Durum adları
 * (RECEIVED / PREPARING / READY) ikisinde de aynı.
 */
const HANDOFFS = Object.freeze({
  roomService: Object.freeze({
    model: 'roomServiceOrder',
    entity: 'RoomServiceOrder',
    lock: lockRoomServiceOrders,
    select: { id: true, hotelId: true, outletId: true, reservationId: true, status: true },
    /** @param {any} order @param {string} status */
    event: (order, status) => ['pos.room_service.changed', { hotelId: order.hotelId, orderId: order.id, outletId: order.outletId, reservationId: order.reservationId, status, change: 'ADVANCED' }],
    servedError: 'Oda servisi turu mutfakta "hazır"da biter; teslim (yolda / teslim edildi) oda servisi panosundan işaretlenir.',
  }),
  delivery: Object.freeze({
    model: 'deliveryOrder',
    entity: 'DeliveryOrder',
    lock: lockDeliveryOrders,
    select: { id: true, hotelId: true, outletId: true, status: true },
    /** @param {any} order @param {string} status */
    event: (order, status) => ['pos.delivery.changed', { hotelId: order.hotelId, orderId: order.id, outletId: order.outletId, status, change: 'ADVANCED' }],
    servedError: 'Paket turu mutfakta "hazır"da biter; teslim (yolda / teslim edildi) paket servis panosundan işaretlenir.',
  }),
});

/**
 * Turun teslimli siparişi (oda servisi ya da paket; salonda boş).
 * @param {{ check: { roomService?: { id: string } | null, delivery?: { id: string } | null } }} order
 * @returns {{ kind: keyof typeof HANDOFFS, id: string } | null}
 */
function handoffOf(order) {
  if (order.check.roomService) return { kind: 'roomService', id: order.check.roomService.id };
  if (order.check.delivery) return { kind: 'delivery', id: order.check.delivery.id };
  return null;
}

/**
 * Mutfağa düşen kalem: istasyonu `NONE` değil (tepsi ücreti gibi sistem kalemi
 * mutfağa gitmez) ve iptal düşüldükten sonra adedi kalmış (ikram hazırlanır).
 * @param {{ quantity: number, voidedQuantity: number, station: string }} line
 */
const isKitchenLine = (line) => line.station !== 'NONE' && line.quantity - line.voidedQuantity > 0;

/**
 * Mutfak panosu: açık adisyonların servis edilmemiş turları, en eski önde.
 * Kalemlerde iptal düşülür, `NONE` istasyonu düşmez; görünür kalemi kalmayan
 * tur (tamamen iptal) gizlenir.
 *
 * @param {string} hotelId
 * @param {{ outletId?: string, station?: string }} query
 */
export async function listKitchenBoard(hotelId, query = {}) {
  const orders = await prisma.posOrder.findMany({
    where: {
      hotelId,
      status: { in: [...ACTIVE_STATUSES] },
      ...(query.outletId ? { outletId: query.outletId } : {}),
      check: { status: 'OPEN' },
    },
    orderBy: [{ sentAt: 'asc' }],
    take: KDS_BOARD_LIMIT,
    select: {
      id: true,
      checkId: true,
      outletId: true,
      seq: true,
      status: true,
      sentAt: true,
      updatedAt: true,
      check: {
        select: {
          number: true,
          covers: true,
          table: { select: { name: true } },
          roomService: { select: { id: true, roomNumber: true, deliverAt: true } },
          delivery: { select: { id: true, number: true, customerName: true } },
        },
      },
      outlet: { select: { name: true } },
      lines: {
        select: { id: true, name: true, quantity: true, voidedQuantity: true, station: true, note: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  return orders
    .map((order) => ({ order, lines: boardLines(order.lines, query.station) }))
    .filter(({ lines }) => lines.length > 0)
    .map(({ order, lines }) => boardCard(order, lines));
}

/** @param {any[]} lines @param {string | undefined} station */
function boardLines(lines, station) {
  return lines
    .filter((line) => isKitchenLine(line) && (!station || line.station === station))
    .map((line) => ({ id: line.id, name: line.name, quantity: line.quantity - line.voidedQuantity, station: line.station, note: line.note ?? null }));
}

/** @param {any} order @param {any[]} lines */
function boardCard(order, lines) {
  const roomService = order.check.roomService;
  return {
    orderId: order.id,
    checkId: order.checkId,
    outletId: order.outletId,
    outletName: order.outlet?.name ?? null,
    checkNumber: order.check.number,
    seq: order.seq,
    status: order.status,
    tableName: order.check.table?.name ?? null,
    covers: order.check.covers,
    roomService: roomService ? { id: roomService.id, roomNumber: roomService.roomNumber, deliverAt: roomService.deliverAt?.toISOString() ?? null } : null,
    delivery: order.check.delivery ?? null,
    sentAt: order.sentAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    lines,
  };
}

/**
 * Turu ilerletir (yalnız ileri). Teslimli turda (oda servisi / paket) `SERVED`
 * verilmez ve sipariş senkronlanır; salonda "hazır" garsonun ziline düşer.
 * Ekranlar `fnb.order.status_changed` ile tazelenir (POS + mutfak kanalı).
 *
 * @param {string} hotelId
 * @param {string} orderId
 * @param {{ status: 'PREPARING' | 'READY' | 'SERVED', expectedUpdatedAt: Date }} input
 */
export async function advanceKitchenOrder(hotelId, orderId, input) {
  const actor = currentActor();
  try {
    return await writeWithEvents(async (tx, stage) => {
      const order = await loadRound(tx, hotelId, orderId);
      assertForward(order, input.status);

      const roomService = order.check.roomService;
      const handoff = handoffOf(order);
      // Kilit sırası oda servisi / paket adımıyla aynı: önce sipariş, sonra tur.
      if (handoff) await HANDOFFS[handoff.kind].lock(tx, hotelId, [handoff.id]);
      await updateWithVersionCheck(tx, 'posOrder', { id: orderId, hotelId }, input.expectedUpdatedAt, { status: input.status }, 'Sipariş turu bulunamadı');
      if (handoff) await syncHandoff(tx, stage, { hotelId, checkId: order.checkId, handoff, status: input.status, actor });

      await stage('fnb.order.status_changed', {
        hotelId,
        checkId: order.checkId,
        orderId: order.id,
        outletId: order.outletId,
        seq: order.seq,
        status: input.status,
        tableName: order.check.table?.name ?? null,
        roomNumber: roomService?.roomNumber ?? null,
      });
      if (input.status === 'READY' && !handoff) await alertWaiter(tx, stage, hotelId, order);

      const updated = await tx.posOrder.findFirst({ where: { id: orderId }, select: { id: true, status: true, updatedAt: true } });
      return { orderId: updated.id, status: updated.status, updatedAt: updated.updatedAt.toISOString() };
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} orderId */
async function loadRound(tx, hotelId, orderId) {
  const order = await tx.posOrder.findFirst({
    where: { id: orderId, hotelId },
    select: {
      id: true,
      checkId: true,
      outletId: true,
      seq: true,
      status: true,
      outlet: { select: { name: true } },
      check: {
        select: {
          number: true,
          status: true,
          waiterEmail: true,
          table: { select: { name: true } },
          roomService: { select: { id: true, roomNumber: true } },
          delivery: { select: { id: true } },
        },
      },
    },
  });
  if (!order) throw new NotFoundError('Sipariş turu bulunamadı');
  return order;
}

/** @param {{ status: string, check: { status: string, roomService: object | null, delivery: object | null } }} order @param {string} next */
function assertForward(order, next) {
  if (order.check.status !== 'OPEN') throw new ConflictError('Adisyon kapanmış; mutfak durumu değiştirilemez.', 'CHECK_CLOSED');
  if (!FORWARD[next]?.includes(order.status)) {
    throw new ConflictError(order.status === 'SERVED' ? 'Tur zaten servis edildi.' : `"${order.status}" durumundan "${next}" durumuna geri dönülmez.`, 'INVALID_TRANSITION');
  }
  const handoff = handoffOf(order);
  if (handoff && next === 'SERVED') throw new ConflictError(HANDOFFS[handoff.kind].servedError, 'INVALID_TRANSITION');
}

/**
 * Teslimli siparişi (kilitliyken) yalnız ileri taşır: ilk "hazırlanıyor"
 * siparişi hazırlanıyora, son bekleyen turun "hazır"ı siparişi hazıra alır.
 * Yoldaki / teslim edilmiş siparişe dokunulmaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, checkId: string, handoff: { kind: keyof typeof HANDOFFS, id: string }, status: string, actor: string | null }} input
 */
async function syncHandoff(tx, stage, { hotelId, checkId, handoff, status, actor }) {
  const spec = HANDOFFS[handoff.kind];
  const order = await tx[spec.model].findFirst({ where: { id: handoff.id }, select: spec.select });
  const now = new Date();
  let data = null;
  if (status === 'PREPARING' && order.status === 'RECEIVED') data = { status: 'PREPARING', preparingAt: now };
  if (status === 'READY' && ['RECEIVED', 'PREPARING'].includes(order.status) && !(await hasKitchenWorkLeft(tx, checkId))) data = { status: 'READY', readyAt: now };
  if (!data) return;

  await tx[spec.model].update({ where: { id: order.id }, data });
  await recordAudit(tx, { hotelId, entity: spec.entity, entityId: order.id, action: 'UPDATE', before: { status: order.status }, after: { status: data.status, by: actor, via: 'KDS' } });
  await stage(...spec.event(order, data.status));
}

/** Adisyonda mutfakta bekleyen (yeni / hazırlanan, görünür kalemli) tur kaldı mı. */
async function hasKitchenWorkLeft(tx, checkId) {
  const rounds = await tx.posOrder.findMany({
    where: { checkId, status: { in: ['NEW', 'PREPARING'] } },
    select: { lines: { select: { quantity: true, voidedQuantity: true, station: true } } },
  });
  return rounds.some((round) => round.lines.some(isKitchenLine));
}

/**
 * "Hazır" adisyonun garsonunun ziline düşer; aynı adisyonun turları tek
 * uyarıda toplanır. Garsonun hesabı kapatılmışsa zil yok — adisyon ekranı
 * turu yine "hazır" gösterir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {string} hotelId
 * @param {Awaited<ReturnType<typeof loadRound>>} order
 */
async function alertWaiter(tx, stage, hotelId, order) {
  const waiter = await findActiveStaffByEmail(tx, hotelId, order.check.waiterEmail);
  if (!waiter) return;
  const place = order.check.table?.name ?? `Adisyon ${order.check.number}`;
  await raiseStaffAlert(tx, stage, {
    hotelId,
    kind: 'POS',
    title: `${place} · ${order.seq}. tur hazır`,
    body: `${order.outlet.name} · ${order.check.number}: mutfak hazır dedi, servise alın.`,
    link: `/pos/adisyon/${order.checkId}`,
    userId: waiter.id,
    entityType: 'PosCheck',
    entityId: order.checkId,
    dedupeKey: `kds-ready:${order.checkId}`,
  });
}
