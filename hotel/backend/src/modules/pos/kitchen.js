import { currentActor } from '@hotelos/core';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, rethrowPrismaError } from '../../lib/errors.js';
import { lockRoomServiceOrders } from '../../lib/locks.js';
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
 * Oda servisi turu (modül 41, `PosCheck.roomService`) iki yönden ilerler: oda
 * servisi panosu adisyonun turlarını zaten yalnız ileri taşıyor — KDS de
 * ilerletince `RoomServiceOrder` aynı kuralla ve aynı adım damgalarıyla
 * (`preparingAt` / `readyAt`; durum izi CHECK'i ister) senkronlanır. Sipariş
 * ancak mutfakta bekleyen başka tur kalmayınca "hazır" olur. **SERVED KDS'de
 * verilmez**: teslim ("yolda / teslim edildi") oda servisi panosunun işidir.
 * Kilit sırası oda servisiyle aynıdır (önce sipariş, sonra tur); iki akış
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
    sentAt: order.sentAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    lines,
  };
}

/**
 * Turu ilerletir (yalnız ileri). Oda servisi turunda `SERVED` verilmez ve
 * `RoomServiceOrder` senkronlanır; salonda "hazır" garsonun ziline düşer.
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
      // Kilit sırası oda servisi adımıyla aynı: önce sipariş, sonra tur.
      if (roomService) await lockRoomServiceOrders(tx, hotelId, [roomService.id]);
      await updateWithVersionCheck(tx, 'posOrder', { id: orderId, hotelId }, input.expectedUpdatedAt, { status: input.status }, 'Sipariş turu bulunamadı');
      if (roomService) await syncRoomService(tx, stage, { hotelId, checkId: order.checkId, roomServiceId: roomService.id, status: input.status, actor });

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
      if (input.status === 'READY' && !roomService) await alertWaiter(tx, stage, hotelId, order);

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
        },
      },
    },
  });
  if (!order) throw new NotFoundError('Sipariş turu bulunamadı');
  return order;
}

/** @param {{ status: string, check: { status: string, roomService: object | null } }} order @param {string} next */
function assertForward(order, next) {
  if (order.check.status !== 'OPEN') throw new ConflictError('Adisyon kapanmış; mutfak durumu değiştirilemez.', 'CHECK_CLOSED');
  if (!FORWARD[next]?.includes(order.status)) {
    throw new ConflictError(order.status === 'SERVED' ? 'Tur zaten servis edildi.' : `"${order.status}" durumundan "${next}" durumuna geri dönülmez.`, 'INVALID_TRANSITION');
  }
  if (order.check.roomService && next === 'SERVED') {
    throw new ConflictError('Oda servisi turu mutfakta "hazır"da biter; teslim (yolda / teslim edildi) oda servisi panosundan işaretlenir.', 'INVALID_TRANSITION');
  }
}

/**
 * Oda servisi siparişini (kilitliyken) yalnız ileri taşır: ilk "hazırlanıyor"
 * siparişi hazırlanıyora, son bekleyen turun "hazır"ı siparişi hazıra alır.
 * Yoldaki / teslim edilmiş siparişe dokunulmaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, checkId: string, roomServiceId: string, status: string, actor: string | null }} input
 */
async function syncRoomService(tx, stage, { hotelId, checkId, roomServiceId, status, actor }) {
  const order = await tx.roomServiceOrder.findFirst({
    where: { id: roomServiceId },
    select: { id: true, hotelId: true, outletId: true, reservationId: true, status: true },
  });
  const now = new Date();
  let data = null;
  if (status === 'PREPARING' && order.status === 'RECEIVED') data = { status: 'PREPARING', preparingAt: now };
  if (status === 'READY' && ['RECEIVED', 'PREPARING'].includes(order.status) && !(await hasKitchenWorkLeft(tx, checkId))) data = { status: 'READY', readyAt: now };
  if (!data) return;

  await tx.roomServiceOrder.update({ where: { id: order.id }, data });
  await recordAudit(tx, { hotelId, entity: 'RoomServiceOrder', entityId: order.id, action: 'UPDATE', before: { status: order.status }, after: { status: data.status, by: actor, via: 'KDS' } });
  await stage('pos.room_service.changed', { hotelId, orderId: order.id, outletId: order.outletId, reservationId: order.reservationId, status: data.status, change: 'ADVANCED' });
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
