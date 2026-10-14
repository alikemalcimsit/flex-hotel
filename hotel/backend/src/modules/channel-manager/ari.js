import { calendarDateInTimeZone, toIsoDay } from '@hotelos/core';
import { addIsoDays, channelAvailability, channelRate, encodeRestriction, windowDays } from '@hotelos/channel-sync-worker';
import { prisma } from '../../db.js';
import { buildAvailabilityCalendar } from '../rooms/rules.js';
import { loadInventorySnapshot } from '../rooms/service.js';
import { priceStay } from '../reservations/rules.js';
import { getActiveRoomTypes, getActiveSeasons } from '../settings/service.js';

/**
 * Kanala gidecek müsaitlik, fiyat ve stop-sale değerlerinin hesabı (modül 33).
 *
 * Kaynaklar sistemin kendi hesaplarıdır — kanal için ayrı bir sayım yoktur:
 * - **Müsaitlik:** oda planının ve rezervasyon açmanın kullandığı takvim
 *   (`buildAvailabilityCalendar`): tipin odaları − arızalı / dolu − oda bekleyen talep.
 * - **Fiyat:** rezervasyon fiyatının liste hesabı (taban × sezon, `priceStay`)
 *   + kanalın fiyat farkı. Promosyon kanala gitmez.
 * - **Stop-sale:** kanalın kendi kapatmaları (oda tipine ya da hepsine).
 *
 * Gün "otelin takvim günü"dür (saat dilimi otelin): kanal geçmiş günü kabul etmez.
 */

/** @param {{ timezone: string }} hotel */
export function channelToday(hotel) {
  return toIsoDay(calendarDateInTimeZone(hotel.timezone));
}

/**
 * @typedef {{
 *   id: string,
 *   roomTypeId: string,
 *   externalRoomTypeId: string | null,
 *   rates: Array<{ externalRatePlanId: string, boardType: string }>,
 * }} RoomMapping
 */

/**
 * Pencerede (from dahil, to hariç) eşleşen oda tiplerinin gün gün değerleri.
 *
 * @param {{
 *   hotelId: string,
 *   channel: { id: string, priceMarkupPercent: string | number | { toString(): string } },
 *   rooms: RoomMapping[],
 *   window: { from: string, to: string },
 * }} input
 * @returns {Promise<{
 *   days: string[],
 *   byRoomType: Map<string, { free: Record<string, number>, rate: Record<string, string>, stop: Record<string, boolean> }>,
 * }>}
 */
export async function computeRoomTypeValues({ hotelId, channel, rooms, window }) {
  const days = windowDays(window.from, window.to);
  const roomTypeIds = [...new Set(rooms.map((room) => room.roomTypeId))];
  const from = new Date(`${window.from}T00:00:00.000Z`);
  const to = new Date(`${window.to}T00:00:00.000Z`);

  const [snapshot, roomTypes, seasons, stopSales] = await Promise.all([
    loadInventorySnapshot(prisma, hotelId, from, to, { roomTypeIds }),
    getActiveRoomTypes(hotelId),
    getActiveSeasons(hotelId),
    prisma.channelStopSale.findMany({
      where: { channelId: channel.id, hotelId, startDate: { lt: to }, endDate: { gte: from } },
      select: { roomTypeIds: true, startDate: true, endDate: true },
    }),
  ]);
  const calendar = buildAvailabilityCalendar({ ...snapshot, from, to, roomTypeIds });
  const typeById = new Map(roomTypes.map((type) => [type.id, type]));
  const markup = String(channel.priceMarkupPercent ?? '0');

  const byRoomType = new Map();
  for (const roomTypeId of roomTypeIds) {
    const type = typeById.get(roomTypeId);
    const calendarDays = calendar.byRoomType[roomTypeId]?.days ?? {};
    // Silinmiş tip satılamaz: müsaitlik 0, fiyat yok (kanal en son fiyatı tutar; stop-sale açık).
    const prices = type ? priceStay({ basePrice: type.basePrice, seasons, checkIn: from, checkOut: to }).nights : [];
    const priceByDay = new Map(prices.map((night) => [night.date, night.amount]));
    const free = {};
    const rate = {};
    const stop = {};
    for (const day of days) {
      free[day] = type ? channelAvailability(calendarDays[day]?.free ?? 0) : 0;
      rate[day] = channelRate(priceByDay.get(day) ?? '0', markup);
      stop[day] = !type;
    }
    for (const sale of stopSales) {
      if (sale.roomTypeIds.length > 0 && !sale.roomTypeIds.includes(roomTypeId)) continue;
      const start = toIsoDay(sale.startDate);
      const end = toIsoDay(sale.endDate);
      for (const day of days) if (day >= start && day <= end) stop[day] = true;
    }
    byRoomType.set(roomTypeId, { free, rate, stop });
  }
  return { days, byRoomType };
}

/**
 * Channex hedefleri: oda tipine müsaitlik, fiyat planına fiyat + stop-sale.
 *
 * @param {Awaited<ReturnType<typeof computeRoomTypeValues>>} values
 * @param {RoomMapping[]} rooms
 * @returns {{ availability: Map<string, Record<string, number>>, restrictions: Map<string, Record<string, string>> }}
 */
export function channexTargets(values, rooms) {
  const availability = new Map();
  const restrictions = new Map();
  for (const room of rooms) {
    const typeValues = values.byRoomType.get(room.roomTypeId);
    if (!typeValues || !room.externalRoomTypeId) continue;
    availability.set(room.externalRoomTypeId, typeValues.free);
    for (const rate of room.rates) {
      const desired = {};
      for (const day of values.days) desired[day] = encodeRestriction({ rate: typeValues.rate[day], stopSell: typeValues.stop[day] });
      restrictions.set(rate.externalRatePlanId, desired);
    }
  }
  return { availability, restrictions };
}

/**
 * iCal dışa aktarma: kanalın satamayacağı (kapalı) günler — boş oda yok ya da stop-sale.
 *
 * @param {Awaited<ReturnType<typeof computeRoomTypeValues>>} values
 * @param {string} roomTypeId
 * @returns {string[]}
 */
export function closedDays(values, roomTypeId) {
  const typeValues = values.byRoomType.get(roomTypeId);
  if (!typeValues) return values.days;
  return values.days.filter((day) => typeValues.free[day] <= 0 || typeValues.stop[day]);
}

/**
 * Kanalın gönderim penceresi: bugünden (dahil) ufkun sonuna (hariç).
 * @param {string} today
 * @param {number} horizonDays
 */
export function horizonWindow(today, horizonDays) {
  return { from: today, to: addIsoDays(today, horizonDays) };
}
