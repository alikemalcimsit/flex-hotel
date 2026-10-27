import { randomUUID } from 'node:crypto';
import { runWithContext } from '@hotelos/core';
import { PERMISSIONS } from '../../lib/permissions.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { ROOM_SERVICE_SWEEP_INTERVAL_MS, runRoomServiceSweep } from './room-service-jobs.js';
import { iso, prisma } from './shared.js';

/**
 * Restoran POS'un zamanlanmış işi (modül 39, yalnızca sunucu sürecinde). Her tur, açık
 * vardiyası olan oteller sırayla; bir otelin hatası diğerlerini durdurmaz.
 *
 * | Ne                        | Ne yapar |
 * |---------------------------|----------|
 * | Uzun açık vardiya         | 16 saati geçen vardiya: şef garsona "kasayı sayıp kapatın" (bir kez) |
 * | Unutulmuş adisyon         | 8 saati geçen açık adisyon: şef garsona (bir kez) — gün sonunda masada adisyon kalmasın |
 *
 * Uyarılar `dedupeKey` ile **bir kez** yazılır (var olan anahtar atlanır).
 */

export const SYSTEM_ACTOR = 'system';
const SWEEP_INTERVAL_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;
/** Bu kadar saattir açık vardiya uyarı alır (iki vardiya boyu). */
const STALE_SHIFT_HOURS = 16;
/** Bu kadar saattir açık adisyon uyarı alır. */
const STALE_CHECK_HOURS = 8;
/** Bir turda bir otelde en fazla bu kadar kayıt (fazlası sonraki tura). */
const BATCH = 200;

/**
 * Anahtarı yoksa uyarı yazar.
 * @param {string} hotelId
 * @param {{ title: string, body: string, link: string, entityType: string, entityId: string, dedupeKey: string }} input
 */
async function alertOnce(hotelId, input) {
  const exists = await prisma.staffAlert.findFirst({ where: { hotelId, dedupeKey: input.dedupeKey }, select: { id: true } });
  if (exists) return false;
  await writeWithEvents((tx, stage) => raiseStaffAlert(tx, stage, { hotelId, kind: 'POS', severity: 'WARNING', permission: PERMISSIONS.POS_SUPERVISE, ...input }));
  return true;
}

/**
 * Bir otelin turu.
 * @param {string} hotelId
 * @param {{ now?: Date }} [options]
 */
export async function sweepHotel(hotelId, { now = new Date() } = {}) {
  const result = { staleShifts: 0, staleChecks: 0 };
  const [shifts, checks] = await Promise.all([
    prisma.posShift.findMany({
      where: { hotelId, status: 'OPEN', openedAt: { lt: new Date(now.getTime() - STALE_SHIFT_HOURS * HOUR_MS) } },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
      select: { id: true, waiterEmail: true, openedAt: true },
    }),
    prisma.posCheck.findMany({
      where: { hotelId, status: 'OPEN', openedAt: { lt: new Date(now.getTime() - STALE_CHECK_HOURS * HOUR_MS) } },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
      select: { id: true, number: true, waiterEmail: true, openedAt: true, outlet: { select: { name: true } }, table: { select: { name: true } } },
    }),
  ]);
  for (const shift of shifts) {
    const sent = await alertOnce(hotelId, {
      title: `Vardiya ${STALE_SHIFT_HOURS} saattir açık: ${shift.waiterEmail}`,
      body: `${iso(shift.openedAt)} açılan vardiya kapatılmadı. Açık adisyonları devredip kasayı sayarak kapatın.`,
      link: `/pos/vardiyalar/${shift.id}`,
      entityType: 'PosShift',
      entityId: shift.id,
      dedupeKey: `pos-stale-shift:${shift.id}`,
    });
    if (sent) result.staleShifts += 1;
  }
  for (const check of checks) {
    const sent = await alertOnce(hotelId, {
      title: `Unutulmuş adisyon: ${check.number} · ${check.outlet.name}${check.table ? ` masa ${check.table.name}` : ''}`,
      body: `${check.waiterEmail} garsonun ${iso(check.openedAt)} açtığı adisyon ${STALE_CHECK_HOURS} saattir açık. Ödemesini alın, boşsa iptal edin.`,
      link: `/pos/adisyon/${check.id}`,
      entityType: 'PosCheck',
      entityId: check.id,
      dedupeKey: `pos-stale-check:${check.id}`,
    });
    if (sent) result.staleChecks += 1;
  }
  return result;
}

/**
 * Bir tur: açık vardiyası olan oteller (vardiyalar küçük bir kümedir; durum index'iyle).
 * @param {{ info: Function, warn: Function }} logger
 */
export async function runPosSweep(logger) {
  const hotels = await prisma.$queryRaw`
    SELECT h."id" AS "hotelId" FROM "Hotel" h
    WHERE EXISTS (SELECT 1 FROM "PosShift" s WHERE s."hotelId" = h."id" AND s."status" = 'OPEN')
    ORDER BY h."id"`;
  for (const { hotelId } of /** @type {Array<{ hotelId: string }>} */ (hotels)) {
    try {
      await runWithContext({ correlationId: randomUUID(), actor: SYSTEM_ACTOR }, async () => {
        const result = await sweepHotel(hotelId);
        if (Object.values(result).some(Boolean)) logger.info({ hotelId, ...result }, 'Restoran POS turu');
      });
    } catch (error) {
      logger.warn({ err: error, hotelId }, 'Restoran POS turu bu otelde tamamlanamadı');
    }
  }
  return hotels.length;
}

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startPosJobs(logger) {
  return startRecurringJobs(logger, [
    { name: 'pos-sweep', intervalMs: SWEEP_INTERVAL_MS, run: () => runPosSweep(logger) },
    // Oda servisi (modül 41): planlı siparişin mutfağa düşmesi dakika hassasiyetinde.
    { name: 'room-service-sweep', intervalMs: ROOM_SERVICE_SWEEP_INTERVAL_MS, run: () => runRoomServiceSweep(logger) },
  ]);
}
