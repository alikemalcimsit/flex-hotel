import { eachNight, rangesOverlapHalfOpen, toIsoDay, toUtcDayStart } from '@hotelos/core';

/**
 * Müsaitlik hesabının saf çekirdeği — veritabanı, HTTP veya Prisma bilmez.
 *
 * Bu dosya yanlış çalışırsa sistem çökmez: ya oda iki kez satılır ya da boş
 * duran oda satılamaz. İkisi de para kaybıdır ve haftalarca fark edilmez.
 * `rules.test.js` sınır günlerini tek tek doğrular.
 *
 * ### Neden oda seviyesinde sayıyoruz
 *
 * Naif yöntem "toplam oda − rezervasyon sayısı − blok sayısı" der ve iki
 * yerde yanılır:
 *
 * 1. Bir odaya atanmış rezervasyon hem "o odayı" hem "tipin envanterini"
 *    tüketir; blokla birlikte sayılırsa aynı oda iki kez düşülür.
 * 2. Henüz oda atanmamış rezervasyon (`roomId = null`) hiçbir fiziksel odayı
 *    işgal etmez ama envanterden bir yer tutar.
 *
 * Bu yüzden gece gece şunu hesaplıyoruz:
 *   boş = (tipin odaları − o gece bloklu ya da dolu olanlar) − atanmamış talep
 */

/** Envanteri tüketen rezervasyon durumları. Diğerleri odayı işgal etmez. */
export const INVENTORY_CONSUMING_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN']);

/**
 * @param {{ status: string }} reservation
 * @returns {boolean}
 */
export function consumesInventory(reservation) {
  return INVENTORY_CONSUMING_STATUSES.includes(reservation.status);
}

/**
 * Konaklama/blok, pencereyle kesişen gecelerini verir.
 * @param {{ start: Date | string, end?: Date | string | null }} range
 * @param {Date | string} windowFrom
 * @param {Date | string} windowTo
 * @returns {Date[]}
 */
function nightsWithinWindow(range, windowFrom, windowTo) {
  const windowStart = toUtcDayStart(windowFrom);
  const windowEnd = toUtcDayStart(windowTo);
  const start = Math.max(toUtcDayStart(range.start), windowStart);
  // Süresiz blokta üst sınır pencerenin sonudur.
  const end = range.end == null ? windowEnd : Math.min(toUtcDayStart(range.end), windowEnd);
  if (end <= start) return [];
  return eachNight(new Date(start), new Date(end));
}

/**
 * Müsaitlik takvimi: oda tipi × gece kırılımında boş oda sayısı.
 *
 * Tek geçişte hesaplar — gece başına sorgu atmaz. 30 günlük pencere ve 400
 * odalı bir otelde bile bellekte kalır.
 *
 * @param {{
 *   rooms: Array<{ id: string, roomTypeId: string }>,
 *   reservations: Array<{ roomId: string | null, roomTypeId: string, checkIn: Date | string, checkOut: Date | string, status: string }>,
 *   blocks: Array<{ roomId: string, startDate: Date | string, endDate?: Date | string | null }>,
 *   from: Date | string,
 *   to: Date | string,
 *   roomTypeIds?: string[],
 * }} input
 * @returns {{
 *   days: string[],
 *   byRoomType: Record<string, { total: number, days: Record<string, { total: number, occupied: number, blocked: number, unassigned: number, free: number }> }>,
 * }}
 */
export function buildAvailabilityCalendar({ rooms, reservations, blocks, from, to, roomTypeIds = [] }) {
  const nights = eachNight(from, to);
  const days = nights.map(toIsoDay);
  const dayIndex = new Map(days.map((day, index) => [day, index]));

  const roomTypeOfRoom = new Map(rooms.map((room) => [room.id, room.roomTypeId]));

  /** @type {Map<string, number>} tip → toplam oda */
  const totalByType = new Map();
  // Henüz odası olmayan tipler de takvimde 0 olarak görünmeli; aksi halde
  // müsaitlik ızgarasında satır kaybolur ve "neden yok" sorusu doğar.
  for (const roomTypeId of roomTypeIds) totalByType.set(roomTypeId, 0);
  for (const room of rooms) {
    totalByType.set(room.roomTypeId, (totalByType.get(room.roomTypeId) ?? 0) + 1);
  }

  // Gece başına: hangi odalar kullanılamaz, hangi tipte kaç atanmamış talep var.
  const unavailableRoomsByNight = days.map(() => new Set());
  const occupiedRoomsByNight = days.map(() => new Set());
  const blockedRoomsByNight = days.map(() => new Set());
  const unassignedByNight = days.map(() => new Map());

  for (const reservation of reservations) {
    if (!consumesInventory(reservation)) continue;

    const covered = nightsWithinWindow({ start: reservation.checkIn, end: reservation.checkOut }, from, to);
    for (const night of covered) {
      const index = dayIndex.get(toIsoDay(night));
      if (index === undefined) continue;

      if (reservation.roomId) {
        occupiedRoomsByNight[index].add(reservation.roomId);
        unavailableRoomsByNight[index].add(reservation.roomId);
      } else {
        const counts = unassignedByNight[index];
        counts.set(reservation.roomTypeId, (counts.get(reservation.roomTypeId) ?? 0) + 1);
      }
    }
  }

  for (const block of blocks) {
    const covered = nightsWithinWindow({ start: block.startDate, end: block.endDate }, from, to);
    for (const night of covered) {
      const index = dayIndex.get(toIsoDay(night));
      if (index === undefined) continue;
      blockedRoomsByNight[index].add(block.roomId);
      unavailableRoomsByNight[index].add(block.roomId);
    }
  }

  const byRoomType = {};
  for (const [roomTypeId, total] of totalByType) {
    const perDay = {};

    days.forEach((day, index) => {
      let occupied = 0;
      let blocked = 0;
      let unavailable = 0;

      for (const roomId of unavailableRoomsByNight[index]) {
        if (roomTypeOfRoom.get(roomId) !== roomTypeId) continue;
        unavailable += 1;
        if (occupiedRoomsByNight[index].has(roomId)) occupied += 1;
        // Hem dolu hem bloklu bir oda tek kez düşülür ama iki sayaçta da görünür;
        // ekranda "neden satılamıyor" sorusunun cevabı için ikisi de lazım.
        if (blockedRoomsByNight[index].has(roomId)) blocked += 1;
      }

      const unassigned = unassignedByNight[index].get(roomTypeId) ?? 0;

      perDay[day] = {
        total,
        occupied,
        blocked,
        unassigned,
        // Negatif kalabilir: overbooking'i gizlemek yerine görünür kılıyoruz.
        free: total - unavailable - unassigned,
      };
    });

    byRoomType[roomTypeId] = { total, days: perDay };
  }

  return { days, byRoomType };
}

/**
 * Bir konaklama için satılabilir oda sayısı.
 *
 * Gecelerin **en düşüğü** alınır: 3 gecelik konaklama, üç gecenin hepsinde oda
 * bulunmasını gerektirir. Ortalama almak "yer var" deyip check-in gününde
 * misafiri kapıda bırakır.
 *
 * @param {ReturnType<typeof buildAvailabilityCalendar>} calendar
 * @param {string} roomTypeId
 * @param {Date | string} checkIn
 * @param {Date | string} checkOut
 * @returns {number}
 */
export function availabilityForStay(calendar, roomTypeId, checkIn, checkOut) {
  const entry = calendar.byRoomType[roomTypeId];
  if (!entry) return 0;

  const nights = eachNight(checkIn, checkOut).map(toIsoDay);
  if (nights.length === 0) return 0;

  let minimum = Number.POSITIVE_INFINITY;
  for (const night of nights) {
    const day = entry.days[night];
    // Pencerede olmayan bir gece sorulduysa cevap veremeyiz; güvenli taraf 0.
    if (!day) return 0;
    minimum = Math.min(minimum, day.free);
  }
  return minimum;
}

/**
 * Verilen konaklama için atanabilecek fiziksel odalar.
 *
 * Atama ekranı ve otomatik atama aktörü bunu kullanır: odanın konaklamanın
 * **her gecesinde** boş olması gerekir; bir gece bile çakışan rezervasyonu
 * veya bloğu varsa listeye girmez.
 *
 * @param {{
 *   rooms: Array<{ id: string, roomTypeId: string, status: string }>,
 *   reservations: Array<{ id: string, roomId: string | null, checkIn: Date | string, checkOut: Date | string, status: string }>,
 *   blocks: Array<{ roomId: string, startDate: Date | string, endDate?: Date | string | null }>,
 *   roomTypeId?: string,
 *   checkIn: Date | string,
 *   checkOut: Date | string,
 *   excludeReservationId?: string,
 * }} input
 * @returns {Array<{ id: string, roomTypeId: string, status: string }>}
 */
export function freeRoomsForStay({
  rooms,
  reservations,
  blocks,
  roomTypeId,
  checkIn,
  checkOut,
  excludeReservationId,
}) {
  const stay = { start: checkIn, end: checkOut };

  const takenRoomIds = new Set();
  for (const reservation of reservations) {
    if (!reservation.roomId) continue;
    if (!consumesInventory(reservation)) continue;
    // Kaydın kendisi engel sayılmaz (oda değiştirme senaryosu).
    if (excludeReservationId && reservation.id === excludeReservationId) continue;
    if (rangesOverlapHalfOpen({ start: reservation.checkIn, end: reservation.checkOut }, stay)) {
      takenRoomIds.add(reservation.roomId);
    }
  }

  for (const block of blocks) {
    if (rangesOverlapHalfOpen({ start: block.startDate, end: block.endDate }, stay)) {
      takenRoomIds.add(block.roomId);
    }
  }

  return rooms.filter(
    (room) => (!roomTypeId || room.roomTypeId === roomTypeId) && !takenRoomIds.has(room.id),
  );
}

/**
 * Otomatik atama için oda seçer.
 *
 * Tercih sırası bilinçli: önce temiz ve hazır odalar, sonra kirli olanlar
 * (temizlenip verilebilir), en sonda kat/numara sırası. Böylece aktör, insanın
 * seçeceği odayı seçer — "neden 305'i verdi" sorusunun cevabı bellidir.
 *
 * @param {Array<{ id: string, number: string, floor: number, status: string }>} candidates
 * @returns {{ id: string, number: string, floor: number, status: string } | null}
 */
export function pickBestRoom(candidates) {
  if (candidates.length === 0) return null;

  const statusRank = { AVAILABLE: 0, CLEANING: 1, DIRTY: 2 };

  return [...candidates].sort((a, b) => {
    const rankA = statusRank[a.status] ?? 9;
    const rankB = statusRank[b.status] ?? 9;
    if (rankA !== rankB) return rankA - rankB;
    if (a.floor !== b.floor) return a.floor - b.floor;
    return a.number.localeCompare(b.number, 'tr', { numeric: true });
  })[0];
}
