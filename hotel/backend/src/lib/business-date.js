import { addDays, calendarDateInTimeZone, toIsoDay } from '@hotelos/core';
import { prisma } from '../db.js';
import { cache } from './cache.js';
import { getHotelSettings } from '../modules/settings/service.js';

/** Son kapanmış gün nadiren değişir (günde bir); sıcak okuma cache'i. */
const HOT_READ_TTL_MS = 60_000;
const lastClosedKey = (hotelId) => `business-date:${hotelId}:last-closed`;

/**
 * Otelin kapatılmış son iş günü (UTC gün başı) ya da `null` (hiç kapanış yok).
 * Cache'li; `closeDay` kapanışta `invalidateBusinessDate` ile tazeler.
 *
 * @param {string} hotelId
 * @returns {Promise<Date | null>}
 */
async function getLastClosedDay(hotelId) {
  const iso = await cache.getOrSet(
    lastClosedKey(hotelId),
    async () => {
      const row = await prisma.nightAudit.findFirst({
        where: { hotelId, status: 'CLOSED' },
        orderBy: { date: 'desc' },
        select: { date: true },
      });
      return row ? toIsoDay(row.date) : null;
    },
    HOT_READ_TTL_MS,
  );
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null;
}

/**
 * Otelin iş günü ("bugün").
 *
 * İş günü takvimden değil "kapatılmamış son gün"den okunur: kapatılmış son
 * günün ertesi. Gece kapanışı (modül 18) yapılmadıysa — sabah 02:00 olsa da —
 * otel hâlâ dünkü gündedir; iş günü ancak görevli günü kapatınca ilerler.
 * Hiç kapanış yapılmamış otelde (ya da modül 18 öncesi veri) takvim günüdür;
 * bu yüzden ilk kapanışa kadar eski davranış korunur.
 *
 * "Bugün"e ihtiyaç duyan her yer buradan okur, `new Date()` ile kendi
 * hesaplamaz.
 *
 * @param {string} hotelId
 * @param {Date} [now] test ve yeniden oynatma için
 * @returns {Promise<Date>} UTC gün başı
 */
export async function getBusinessDate(hotelId, now = new Date()) {
  const lastClosed = await getLastClosedDay(hotelId);
  if (lastClosed) return addDays(lastClosed, 1);
  const { timezone } = await getHotelSettings(hotelId);
  return calendarDateInTimeZone(timezone, now);
}

/**
 * Kapanış sonrası iş gününü tazeler (bir sonraki `getBusinessDate` ilerlesin).
 * @param {string} hotelId
 */
export function invalidateBusinessDate(hotelId) {
  cache.invalidatePrefix(`business-date:${hotelId}:`);
}
