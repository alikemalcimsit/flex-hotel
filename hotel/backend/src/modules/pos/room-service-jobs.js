import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { runWithContext } from '@hotelos/core';
import {
  GUEST_ORDER_ALERT_MINUTES,
  GUEST_ORDER_EXPIRED_REASON,
  GUEST_ORDER_EXPIRY_MINUTES,
  ROOM_SERVICE_KITCHEN_STATUSES,
  ROOM_SERVICE_STATUS_LABELS,
  TRAY_TRACKING_HOURS,
  trayTrackingSince,
  utcToZonedWallTime,
} from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { lockPosShifts } from '../../lib/locks.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { SQL_NOW } from '../../lib/sql-time.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { linesOf, lockedOrder, releaseLocked } from './room-service.js';
import { pickReleaseShift } from './room-service-rules.js';
import { hotelContext, loadPosSettings, prisma } from './shared.js';

/**
 * Oda servisinin dakikalık işi (modül 41, yalnızca sunucu sürecinde). Açık siparişi ya da toplanmamış tepsisi olan
 * oteller sırayla; bir otelin (ya da bir siparişin) hatası diğerlerini durdurmaz.
 *
 * | Ne                              | Ne yapar |
 * |---------------------------------|----------|
 * | Zamanı gelen planlı sipariş     | Mutfağa düşer: siparişi girenin, yoksa oda servisi noktasının en erken açılmış vardiyasına. Vardiya yoksa ya da ürün tükendiyse bir kez uyarı (panoda "mutfağa gönder") |
 * | Konaklaması biten sipariş       | Mutfağa düşmemiş (kabul bekleyen / planlı) olan iptal edilir; mutfaktaki için şef garsona uyarı |
 * | Kabul bekleyen misafir siparişi | `GUEST_ORDER_ALERT_MINUTES` dakika: şef garsona uyarı; teslim hedefini `GUEST_ORDER_EXPIRY_MINUTES` aşınca reddedilir (misafir net cevap görür) |
 * | Geciken sipariş                 | Teslim hedefi geçti: şef garsona uyarı |
 * | Toplanmayan tepsi               | Teslimden politikadaki süre kadar sonra (takip penceresinde): oda servisine uyarı |
 *
 * Her sipariş her uyarıyı **bir kez** alır (siparişteki `…AlertedAt`; ham SQL — sürüm damgası ilerlemez, ekrandaki
 * personelin işlemi "kayıt değişti"ye düşmez). Aynı türden uyarılar zilde tek satırda toplanır (`dedupeKey` türe göre;
 * yeni sipariş satırı yeniden okunmamış yapar).
 */

export const ROOM_SERVICE_SWEEP_INTERVAL_MS = 60_000;
const SYSTEM_ACTOR = 'system';
const MINUTE_MS = 60_000;
/** Bir turda bir otelde bir işte en fazla bu kadar sipariş (fazlası sonraki tura). */
const BATCH = 200;

/** Uyarı damgası sütunları (ham SQL'e yalnızca bu adlar girer). */
const ALERT_COLUMNS = Object.freeze({ late: 'lateAlertedAt', tray: 'trayAlertedAt', wait: 'waitAlertedAt', stay: 'stayAlertedAt' });

/**
 * Siparişi işaretleyip uyarıyı yazar (işaret yoksa; aynı transaction'da — iki süreç aynı uyarıyı iki kez yazmaz).
 * @param {string} hotelId @param {string} orderId @param {keyof typeof ALERT_COLUMNS} kind
 * @param {{ title: string, body: string, link: string, severity: 'INFO' | 'WARNING', permission: string }} alert
 */
async function alertOnce(hotelId, orderId, kind, alert) {
  return writeWithEvents(async (tx, stage) => {
    const marked = await tx.$executeRaw`
      UPDATE "RoomServiceOrder" SET ${Prisma.raw(`"${ALERT_COLUMNS[kind]}"`)} = ${SQL_NOW}
      WHERE "id" = ${orderId} AND "hotelId" = ${hotelId} AND ${Prisma.raw(`"${ALERT_COLUMNS[kind]}"`)} IS NULL`;
    if (!marked) return false;
    await raiseStaffAlert(tx, stage, { hotelId, kind: 'POS', entityType: 'RoomServiceOrder', entityId: orderId, dedupeKey: `room-service:${kind}`, ...alert });
    return true;
  });
}

/** Saat "07:30" (otelin saati). @param {Date} value @param {string} timezone */
const clock = (value, timezone) => utcToZonedWallTime(value, timezone).slice(11, 16);

/**
 * Kabul edilmemiş, teslim hedefini aşmış misafir siparişini reddeder (sipariş kilitliyken; hâlâ kabul bekliyorsa). Sebep
 * misafirin sayfasında görünür; oda servisine tek satırda toplanan bilgi düşer.
 * @param {string} hotelId @param {string} orderId
 */
async function expireGuestOrder(hotelId, orderId) {
  return writeWithEvents(async (tx, stage) => {
    const order = await lockedOrder(tx, hotelId, orderId);
    if (order.status !== 'REQUESTED') return null;
    await tx.roomServiceOrder.update({ where: { id: orderId }, data: { status: 'REJECTED', rejectedAt: new Date(), rejectedBy: SYSTEM_ACTOR, rejectReason: GUEST_ORDER_EXPIRED_REASON } });
    await recordAudit(tx, { hotelId, entity: 'RoomServiceOrder', entityId: orderId, action: 'UPDATE', before: { status: 'REQUESTED' }, after: { status: 'REJECTED', reason: GUEST_ORDER_EXPIRED_REASON } });
    await stage('pos.room_service.changed', { hotelId, orderId, outletId: order.outletId, reservationId: order.reservationId, status: 'REJECTED', change: 'REJECTED' });
    await raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'POS',
      severity: 'WARNING',
      title: `Misafir siparişi kabul edilmediği için düştü: oda ${order.roomNumber} · ${order.number}`,
      body: `Teslim hedefinden ${GUEST_ORDER_EXPIRY_MINUTES} dakika sonra hâlâ kabul bekliyordu; misafire "oda servisini arayın" denildi.`,
      link: `/pos/oda-servisi/siparis/${orderId}`,
      permission: PERMISSIONS.POS_SUPERVISE,
      entityType: 'RoomServiceOrder',
      entityId: orderId,
      dedupeKey: 'room-service:guest-expired',
    });
    return order.number;
  });
}

/**
 * Konaklaması bitmiş, mutfağa düşmemiş siparişi iptal eder (sipariş kilitliyken; durum değişmediyse).
 * @param {string} hotelId @param {string} orderId
 */
async function cancelForEndedStay(hotelId, orderId) {
  return writeWithEvents(async (tx, stage) => {
    const order = await lockedOrder(tx, hotelId, orderId);
    if (!['REQUESTED', 'SCHEDULED'].includes(order.status)) return null;
    const reason = 'Konaklama sona erdi (otomatik iptal)';
    await tx.roomServiceOrder.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: SYSTEM_ACTOR, cancelReason: reason } });
    await recordAudit(tx, { hotelId, entity: 'RoomServiceOrder', entityId: orderId, action: 'UPDATE', before: { status: order.status }, after: { status: 'CANCELLED', reason } });
    await stage('pos.room_service.changed', { hotelId, orderId, outletId: order.outletId, reservationId: order.reservationId, status: 'CANCELLED', change: 'CANCELLED' });
    await raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'POS',
      severity: 'INFO',
      title: `Konaklama bittiği için iptal: oda ${order.roomNumber} · ${order.number}`,
      body: `${ROOM_SERVICE_STATUS_LABELS[order.status]} sipariş misafir çıkış yaptığı için iptal edildi (mutfağa düşmemişti).`,
      link: `/pos/oda-servisi/siparis/${orderId}`,
      permission: PERMISSIONS.POS_OPERATE,
      entityType: 'RoomServiceOrder',
      entityId: orderId,
      dedupeKey: 'room-service:stay-cancelled',
    });
    return order.number;
  });
}

/**
 * Bir otelin turu.
 * @param {string} hotelId
 * @param {{ now?: Date }} [options]
 */
export async function sweepRoomService(hotelId, { now = new Date() } = {}) {
  const result = { released: 0, releaseFailed: 0, cancelled: 0, staleStays: 0, expired: 0, waiting: 0, late: 0, trays: 0 };
  const [{ timezone, today }, settings] = await Promise.all([hotelContext(hotelId), loadPosSettings(prisma, hotelId)]);
  const stayStatus = { reservation: { select: { status: true } } };
  const base = { id: true, number: true, roomNumber: true, status: true, outletId: true, createdBy: true, dueAt: true, deliverAt: true, ...stayStatus };
  const [due, ended, expired, waiting, late, trays] = await Promise.all([
    prisma.roomServiceOrder.findMany({ where: { hotelId, status: 'SCHEDULED', releaseAt: { lte: now } }, orderBy: [{ releaseAt: 'asc' }, { id: 'asc' }], take: BATCH, select: { ...base, waitAlertedAt: true } }),
    prisma.roomServiceOrder.findMany({
      where: { hotelId, status: { in: ['REQUESTED', 'SCHEDULED', ...ROOM_SERVICE_KITCHEN_STATUSES] }, reservation: { status: { not: 'CHECKED_IN' } } },
      take: BATCH,
      select: { ...base, stayAlertedAt: true },
    }),
    prisma.roomServiceOrder.findMany({ where: { hotelId, status: 'REQUESTED', dueAt: { lt: new Date(now.getTime() - GUEST_ORDER_EXPIRY_MINUTES * MINUTE_MS) } }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: BATCH, select: base }),
    prisma.roomServiceOrder.findMany({
      where: { hotelId, status: 'REQUESTED', createdAt: { lte: new Date(now.getTime() - GUEST_ORDER_ALERT_MINUTES * MINUTE_MS) }, waitAlertedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
      select: { ...base, createdAt: true },
    }),
    prisma.roomServiceOrder.findMany({ where: { hotelId, status: { in: [...ROOM_SERVICE_KITCHEN_STATUSES] }, dueAt: { lt: now }, lateAlertedAt: null }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: BATCH, select: base }),
    prisma.roomServiceOrder.findMany({
      where: { hotelId, status: 'DELIVERED', trayExpected: true, trayCollectedAt: null, trayAlertedAt: null, deliveredAt: { gte: trayTrackingSince(now), lte: new Date(now.getTime() - settings.trayAlertMinutes * MINUTE_MS) } },
      orderBy: [{ deliveredAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
      select: { id: true, number: true, roomNumber: true, deliveredAt: true },
    }),
  ]);

  // Konaklaması biten: mutfağa düşmemiş olan iptal, mutfaktaki için uyarı.
  const endedIds = new Set();
  for (const order of ended) {
    endedIds.add(order.id);
    if (['REQUESTED', 'SCHEDULED'].includes(order.status)) {
      if (await cancelForEndedStay(hotelId, order.id)) result.cancelled += 1;
    } else if (!order.stayAlertedAt) {
      const sent = await alertOnce(hotelId, order.id, 'stay', {
        severity: 'WARNING',
        permission: PERMISSIONS.POS_SUPERVISE,
        title: `Misafir çıktı, sipariş açık: oda ${order.roomNumber} · ${order.number}`,
        body: `${ROOM_SERVICE_STATUS_LABELS[order.status]} sipariş teslim edilmedi; konaklama kapandığı için odaya yazılamaz. Kapıda tahsil edin ya da iptal edin.`,
        link: `/pos/oda-servisi/siparis/${order.id}`,
      });
      if (sent) result.staleStays += 1;
    }
  }

  // Zamanı gelen planlı siparişler.
  if (due.length) {
    const shifts = await prisma.posShift.findMany({ where: { hotelId, status: 'OPEN' }, orderBy: [{ openedAt: 'asc' }, { id: 'asc' }], take: 500, select: { id: true, waiterEmail: true, outletId: true, openedAt: true } });
    for (const order of due) {
      if (endedIds.has(order.id)) continue;
      const shift = pickReleaseShift(shifts, { createdBy: order.createdBy, outletId: order.outletId });
      let failure = shift ? null : 'Oda servisinde açık vardiya yok.';
      if (shift) {
        try {
          const released = await writeWithEvents(async (tx, stage) => {
            await lockPosShifts(tx, hotelId, [shift.id], { shared: true });
            const open = await tx.posShift.findFirst({ where: { id: shift.id }, select: { status: true } });
            if (open.status !== 'OPEN') throw new Error(`${shift.waiterEmail} vardiyası kapandı.`);
            const current = await lockedOrder(tx, hotelId, order.id);
            // Personel bu arada gönderdi ya da iptal etti.
            if (current.status !== 'SCHEDULED') return false;
            await releaseLocked(tx, stage, { hotelId, today, order: current, shift, lines: linesOf(current.items) });
            return true;
          });
          if (released) result.released += 1;
        } catch (error) {
          failure = error?.message ?? 'Bilinmeyen hata';
        }
      }
      if (failure && !order.waitAlertedAt) {
        const sent = await alertOnce(hotelId, order.id, 'wait', {
          severity: 'WARNING',
          permission: PERMISSIONS.POS_SUPERVISE,
          title: `Planlı sipariş mutfağa düşmedi: oda ${order.roomNumber} · ${order.number}`,
          body: `Teslim ${clock(order.deliverAt, timezone)}. ${failure} Panodan "Mutfağa gönder" deyin (gerekirse kalemleri değiştirerek).`.slice(0, 1000),
          link: `/pos/oda-servisi/siparis/${order.id}`,
        });
        if (sent) result.releaseFailed += 1;
      }
    }
  }

  // Kabul edilmeyip teslim hedefini aşan misafir siparişleri düşer (uyarıdan önce: düşen için ayrıca "bekliyor" yazılmaz).
  const expiredIds = new Set();
  for (const order of expired) {
    if (endedIds.has(order.id)) continue;
    if (await expireGuestOrder(hotelId, order.id)) {
      expiredIds.add(order.id);
      result.expired += 1;
    }
  }

  for (const order of waiting) {
    if (endedIds.has(order.id) || expiredIds.has(order.id)) continue;
    const sent = await alertOnce(hotelId, order.id, 'wait', {
      severity: 'WARNING',
      permission: PERMISSIONS.POS_SUPERVISE,
      title: `Misafir siparişi ${GUEST_ORDER_ALERT_MINUTES} dakikadır bekliyor: oda ${order.roomNumber} · ${order.number}`,
      body: `QR ile verilen sipariş ${clock(order.createdAt, timezone)} geldi; kabul ya da ret bekliyor.`,
      link: '/pos/oda-servisi',
    });
    if (sent) result.waiting += 1;
  }

  for (const order of late) {
    if (endedIds.has(order.id)) continue;
    const sent = await alertOnce(hotelId, order.id, 'late', {
      severity: 'WARNING',
      permission: PERMISSIONS.POS_SUPERVISE,
      title: `Oda servisi gecikti: oda ${order.roomNumber} · ${order.number}`,
      body: `Teslim hedefi ${clock(order.dueAt, timezone)}; durum: ${ROOM_SERVICE_STATUS_LABELS[order.status]}.`,
      link: '/pos/oda-servisi',
    });
    if (sent) result.late += 1;
  }

  for (const order of trays) {
    const sent = await alertOnce(hotelId, order.id, 'tray', {
      severity: 'INFO',
      permission: PERMISSIONS.POS_OPERATE,
      title: `Tepsi toplanmadı: oda ${order.roomNumber} · ${order.number}`,
      body: `${clock(order.deliveredAt, timezone)} teslim edildi (${Math.round((now.getTime() - order.deliveredAt.getTime()) / MINUTE_MS)} dakika önce).`,
      link: '/oda-servisi/tepsiler',
    });
    if (sent) result.trays += 1;
  }
  return result;
}

/**
 * Bir tur: açık siparişi ya da toplanmamış tepsisi olan oteller (durum index'leriyle).
 * @param {{ info: Function, warn: Function }} logger
 */
export async function runRoomServiceSweep(logger) {
  const hotels = await prisma.$queryRaw`
    SELECT h."id" AS "hotelId" FROM "Hotel" h
    WHERE EXISTS (SELECT 1 FROM "RoomServiceOrder" o WHERE o."hotelId" = h."id"
                    AND o."status" IN ('REQUESTED', 'SCHEDULED', 'RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY'))
       OR EXISTS (SELECT 1 FROM "RoomServiceOrder" o WHERE o."hotelId" = h."id"
                    AND o."status" = 'DELIVERED' AND o."trayExpected" AND o."trayCollectedAt" IS NULL
                    AND o."deliveredAt" >= ${SQL_NOW} - (${TRAY_TRACKING_HOURS} * INTERVAL '1 hour'))
    ORDER BY h."id"`;
  for (const { hotelId } of /** @type {Array<{ hotelId: string }>} */ (hotels)) {
    try {
      await runWithContext({ correlationId: randomUUID(), actor: SYSTEM_ACTOR }, async () => {
        const result = await sweepRoomService(hotelId);
        if (Object.values(result).some(Boolean)) logger.info({ hotelId, ...result }, 'Oda servisi turu');
      });
    } catch (error) {
      logger.warn({ err: error, hotelId }, 'Oda servisi turu bu otelde tamamlanamadı');
    }
  }
  return hotels.length;
}
