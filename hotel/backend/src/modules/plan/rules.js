import { addDays, DAY_MS, eachNight, nightCount, toIsoDay, toUtcDayStart } from '@hotelos/core';
import { consumesInventory, INVENTORY_REMOVING_BLOCK_TYPE, openSliceStart } from '../rooms/rules.js';

/**
 * Oda planının (rack chart) saf çekirdeği — veritabanı, HTTP veya Prisma bilmez.
 *
 * Ekranda gördüğünüz her bar buradan çıkar: hangi sütunda başlar, kaç sütun
 * sürer, penceredan taşıyor mu. Bu hesap yanlış olursa personel ızgarada "boş"
 * gördüğü odaya misafir koyar — müsaitlik motoru doğru olsa bile.
 *
 * ### Neden gece sayıyoruz, gün değil
 *
 * Izgaranın her sütunu bir **gece**dir. 15-18 rezervasyonu 15, 16, 17
 * sütunlarını doldurur; 18 sütunu boştur çünkü o sabah oda boşalır ve aynı gün
 * tekrar satılabilir. Çıkış gününü de boyamak, ızgarada bir günlük sahte doluluk
 * ve "neden bu odayı satamıyorum" sorusudur.
 *
 * ### Pencere dışına taşan barlar
 *
 * Bir konaklama pencereden önce başlamış ya da sonra bitiyor olabilir. Bar
 * kırpılır ama `continuesBefore` / `continuesAfter` ile işaretlenir: ekran ok
 * çizer, kullanıcı barın devam ettiğini bilir.
 *
 * ### Oda değiştirmiş konaklama
 *
 * İçerideki misafir taşındıysa konaklama **iki (ya da daha fazla) bar** olur:
 * eski odada kapanmış dilim (`RoomStaySegment`), yeni odada açık dilim
 * (`roomSince`'ten itibaren). İkisi de aynı rezervasyonu gösterir; ekran
 * birbirine okla bağlar.
 */

/** Plan ızgarasında bir barın en az kaç sütun kapladığı. */
const MIN_SEGMENT_SPAN = 1;

/** Çıkış yapmış konaklama yalnızca geçmiş gecelerde yer tutar (bkz. `countsNight`). */
const CHECKED_OUT = 'CHECKED_OUT';

/** Girişi yapılmış sayılan durumlar (özetteki "yapıldı" sayısı). */
const ARRIVED_STATUSES = new Set(['CHECKED_IN', CHECKED_OUT]);

/**
 * Pencere günleri (gece başlangıçları), ISO gün metni olarak.
 * @param {Date | string} from
 * @param {number} days
 * @returns {string[]}
 */
export function planDays(from, days) {
  const start = new Date(toUtcDayStart(from));
  return eachNight(start, addDays(start, days)).map(toIsoDay);
}

/**
 * Bir aralığın pencere içindeki yerleşimi.
 *
 * @param {{ start: Date | string, end?: Date | string | null }} range `end` boşsa süresiz
 * @param {{ from: Date | string, days: number }} window
 * @returns {{ startIndex: number, span: number, continuesBefore: boolean, continuesAfter: boolean } | null}
 *   Pencereyle kesişmiyorsa `null`
 */
export function placeInWindow(range, { from, days }) {
  const windowStart = toUtcDayStart(from);
  const windowEnd = toUtcDayStart(addDays(windowStart, days));

  const rawStart = toUtcDayStart(range.start);
  // Süresiz blok pencerenin sonuna kadar sürer.
  const rawEnd = range.end == null ? windowEnd : toUtcDayStart(range.end);
  if (rawEnd <= rawStart) return null;

  const start = Math.max(rawStart, windowStart);
  const end = Math.min(rawEnd, windowEnd);
  if (end <= start) return null;

  return {
    startIndex: nightCount(new Date(windowStart), new Date(start)),
    span: Math.max(MIN_SEGMENT_SPAN, nightCount(new Date(start), new Date(end))),
    continuesBefore: rawStart < windowStart,
    continuesAfter: range.end == null || rawEnd > windowEnd,
  };
}

/**
 * Odaların satırlarını ve satırlardaki barları kurar.
 *
 * - Rezervasyonun **açık dilimi** kendi odasının satırına düşer
 *   (`movedIn`: misafir bu odaya sonradan taşındı).
 * - **Kapanmış dilimler** eski odaların satırına düşer (`movedOut`: misafir
 *   buradan başka odaya taşındı). Dilimin rezervasyon bilgisi `segment.reservation`
 *   içinde gelir.
 * - Arıza kayıtları ayrı listededir; ekran onları rezervasyonların altında çizer.
 *
 * Aynı rezervasyon birden çok satırda görünebildiği için her barın kendi
 * anahtarı (`key`) var.
 *
 * @param {{
 *   rooms: Array<{ id: string }>,
 *   reservations: Array<{ id: string, roomId: string | null, checkIn: Date | string, checkOut: Date | string, roomSince?: Date | string | null, status: string }>,
 *   blocks: Array<{ id: string, roomId: string, type?: string, startDate: Date | string, endDate?: Date | string | null }>,
 *   segments?: Array<{ id: string, roomId: string, startDate: Date | string, endDate: Date | string, reason?: string | null, reservation: object }>,
 *   from: Date | string,
 *   days: number,
 * }} input
 * @returns {Map<string, { reservations: object[], blocks: object[] }>} oda kimliği → barlar
 */
export function buildRoomSegments({ rooms, reservations, blocks, segments = [], from, days }) {
  const window = { from, days };
  /** @type {Map<string, { reservations: object[], blocks: object[] }>} */
  const byRoom = new Map(rooms.map((room) => [room.id, { reservations: [], blocks: [] }]));

  for (const reservation of reservations) {
    if (!reservation.roomId) continue;
    const row = byRoom.get(reservation.roomId);
    if (!row) continue;
    const openStart = openSliceStart(reservation);
    const placement = placeInWindow({ start: openStart, end: reservation.checkOut }, window);
    if (!placement) continue;
    row.reservations.push({
      ...reservation,
      ...placement,
      key: `${reservation.id}:open`,
      segmentId: null,
      sliceFrom: openStart,
      sliceTo: reservation.checkOut,
      movedIn: toUtcDayStart(openStart) > toUtcDayStart(reservation.checkIn),
      movedOut: false,
    });
  }

  for (const segment of segments) {
    const row = byRoom.get(segment.roomId);
    if (!row || !segment.reservation) continue;
    const placement = placeInWindow({ start: segment.startDate, end: segment.endDate }, window);
    if (!placement) continue;
    row.reservations.push({
      ...segment.reservation,
      ...placement,
      key: `${segment.reservation.id}:${segment.id}`,
      segmentId: segment.id,
      sliceFrom: segment.startDate,
      sliceTo: segment.endDate,
      segmentReason: segment.reason ?? null,
      movedIn: toUtcDayStart(segment.startDate) > toUtcDayStart(segment.reservation.checkIn),
      movedOut: true,
    });
  }

  for (const block of blocks) {
    const row = byRoom.get(block.roomId);
    if (!row) continue;
    const placement = placeInWindow({ start: block.startDate, end: block.endDate }, window);
    if (!placement) continue;
    row.blocks.push({ ...block, ...placement });
  }

  // Sütun sırası: ekran barları soldan sağa çiziyor, sıralamayı orada tekrar
  // yapmak zorunda kalmasın.
  for (const row of byRoom.values()) {
    row.reservations.sort((a, b) => a.startIndex - b.startIndex);
    row.blocks.sort((a, b) => a.startIndex - b.startIndex);
  }

  return byRoom;
}

/**
 * Bir konaklama verilen gecede odayı/satışı tüketiyor mu?
 *
 * Bekleyen, onaylı ve içerideki konaklama her gecesinde tüketir. Çıkış yapmış
 * konaklama yalnızca **geçmiş** gecelerde (misafir gerçekten kaldı) sayılır:
 * erken çıkışta rezervasyonun çıkış tarihi güncellenmemiş olabilir ve ileriki
 * geceleri dolu göstermek yanlış olur.
 *
 * @param {{ status: string }} reservation
 * @param {number} nightTime gece başlangıcı (ms)
 * @param {number} businessTime iş günü başlangıcı (ms)
 */
function countsNight(reservation, nightTime, businessTime) {
  if (consumesInventory(reservation)) return true;
  return reservation.status === CHECKED_OUT && nightTime < businessTime;
}

/**
 * Izgaranın başlığındaki günlük özet — **otelin tamamından**, sayfadan değil.
 *
 * Tanımlar (otelcilik karşılıkları):
 * - `arrivals` / `arrivalsDone`: o gün giriş yapacak konaklama / girişi yapılmış olanlar.
 * - `departures` / `departuresDone`: o sabah çıkacak konaklama / çıkışı yapılmış olanlar.
 *   Çıkış yapmış konaklamalar da sayılır: öğlen "8 çıkıştan 5'i yapıldı" okunmalı,
 *   sayı gün içinde azalmamalı.
 * - `stayovers`: o gece kalan ama o gün girmeyen konaklama.
 * - `sold`: o geceyi tüketen konaklama (dolu + oda bekleyen). Geçmiş gecelerde
 *   çıkış yapmış konaklamalar da dahil — dünün doluluğu sonradan düşmez.
 * - `sellable`: toplam oda − arızalı (hizmet dışı odalar satışta sayılır).
 * - `occupancyPct`: sold / sellable.
 *
 * @param {{
 *   totalRooms: number,
 *   reservations: Array<{ id: string, roomId: string | null, checkIn: Date | string, checkOut: Date | string, roomSince?: Date | string | null, status: string }>,
 *   blocks: Array<{ roomId: string, type?: string, startDate: Date | string, endDate?: Date | string | null }>,
 *   segments?: Array<{ reservationId: string, roomId: string, startDate: Date | string, endDate: Date | string }>,
 *   from: Date | string,
 *   days: number,
 *   businessDate: Date | string,
 * }} input
 */
export function summarizeDays({ totalRooms, reservations, blocks, segments = [], from, days, businessDate }) {
  const dayList = planDays(from, days);
  const index = new Map(dayList.map((day, position) => [day, position]));
  const windowStart = toUtcDayStart(from);
  const businessTime = toUtcDayStart(businessDate);
  const zeros = () => dayList.map(() => 0);
  const sets = () => dayList.map(() => new Set());

  const arrivals = zeros();
  const arrivalsDone = zeros();
  const departures = zeros();
  const departuresDone = zeros();
  const sold = zeros();
  const unassigned = zeros();
  const roomsTaken = sets();
  const outOfOrder = sets();
  const outOfService = sets();

  const nightTime = (position) => windowStart + position * DAY_MS;
  const byId = new Map(reservations.map((reservation) => [reservation.id, reservation]));

  // Kapanmış dilimler: taşınan misafirin eski odası o gece doluydu.
  /** @type {Map<string, Set<number>>} */
  const segmentNights = new Map();
  for (const segment of segments) {
    const parent = byId.get(segment.reservationId);
    if (!parent) continue;
    const placement = placeInWindow({ start: segment.startDate, end: segment.endDate }, { from, days });
    if (!placement) continue;
    for (let offset = 0; offset < placement.span; offset += 1) {
      const position = placement.startIndex + offset;
      if (!countsNight(parent, nightTime(position), businessTime)) continue;
      roomsTaken[position].add(segment.roomId);
      if (!segmentNights.has(parent.id)) segmentNights.set(parent.id, new Set());
      segmentNights.get(parent.id).add(position);
    }
  }

  for (const reservation of reservations) {
    const counted = consumesInventory(reservation) || reservation.status === CHECKED_OUT;
    if (!counted) continue;

    const arrival = index.get(toIsoDay(reservation.checkIn));
    if (arrival !== undefined) {
      arrivals[arrival] += 1;
      if (ARRIVED_STATUSES.has(reservation.status)) arrivalsDone[arrival] += 1;
    }
    const departure = index.get(toIsoDay(reservation.checkOut));
    if (departure !== undefined) {
      departures[departure] += 1;
      if (reservation.status === CHECKED_OUT) departuresDone[departure] += 1;
    }

    const placement = placeInWindow({ start: reservation.checkIn, end: reservation.checkOut }, { from, days });
    if (!placement) continue;
    const openStart = toUtcDayStart(openSliceStart(reservation));

    for (let offset = 0; offset < placement.span; offset += 1) {
      const position = placement.startIndex + offset;
      const time = nightTime(position);
      if (!countsNight(reservation, time, businessTime)) continue;

      sold[position] += 1;
      if (reservation.roomId && time >= openStart) {
        roomsTaken[position].add(reservation.roomId);
      } else if (!segmentNights.get(reservation.id)?.has(position)) {
        unassigned[position] += 1;
      }
    }
  }

  for (const block of blocks) {
    const placement = placeInWindow({ start: block.startDate, end: block.endDate }, { from, days });
    if (!placement) continue;
    const bucket = (block.type ?? INVENTORY_REMOVING_BLOCK_TYPE) === INVENTORY_REMOVING_BLOCK_TYPE ? outOfOrder : outOfService;
    for (let offset = 0; offset < placement.span; offset += 1) {
      bucket[placement.startIndex + offset].add(block.roomId);
    }
  }

  return dayList.map((date, position) => {
    const outOfOrderCount = outOfOrder[position].size;
    const sellable = Math.max(0, totalRooms - outOfOrderCount);
    // Arızalı oda aynı gece dolu da olabilir (misafir içerideyken arıza açıldı);
    // tek oda iki kez düşülmesin diye küme birleşimi.
    const unavailable = new Set([...roomsTaken[position], ...outOfOrder[position]]).size;

    return {
      date,
      arrivals: arrivals[position],
      arrivalsDone: arrivalsDone[position],
      departures: departures[position],
      departuresDone: departuresDone[position],
      stayovers: Math.max(0, sold[position] - arrivals[position]),
      sold: sold[position],
      occupied: sold[position] - unassigned[position],
      unassigned: unassigned[position],
      outOfOrder: outOfOrderCount,
      outOfService: outOfService[position].size,
      sellable,
      free: Math.max(0, totalRooms - unavailable - unassigned[position]),
      occupancyPct: sellable === 0 ? 0 : Math.round((sold[position] / sellable) * 100),
    };
  });
}
