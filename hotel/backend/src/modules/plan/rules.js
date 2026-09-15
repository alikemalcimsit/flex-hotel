import { addDays, eachNight, nightCount, toIsoDay, toUtcDayStart } from '@hotelos/core';
import { consumesInventory, INVENTORY_REMOVING_BLOCK_TYPE } from '../rooms/rules.js';

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
 * çizer, kullanıcı barın devam ettiğini bilir. Kırpmayı unutmak, ızgarada
 * negatif başlangıç indeksine ve kaymış satırlara yol açar.
 */

/** Plan ızgarasında bir rezervasyon barının en az kaç sütun kapladığı. */
const MIN_SEGMENT_SPAN = 1;

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
 * Aynı satırda hem rezervasyon hem arıza barı olabilir (arıza kaydı ileri
 * tarihli, rezervasyon bugünkü olabilir); ikisi de aynı sütun sistemine oturur.
 * Çakışan rezervasyon zaten veritabanı kısıtıyla imkânsız, ama arıza kaydı ile
 * geçmiş bir konaklama üst üste gelebilir — ekran bunu üst üste değil, arıza
 * barını ince bir şerit olarak çizerek gösterir.
 *
 * @param {{
 *   rooms: Array<{ id: string }>,
 *   reservations: Array<{ id: string, roomId: string | null, checkIn: Date | string, checkOut: Date | string, status: string }>,
 *   blocks: Array<{ id: string, roomId: string, type?: string, startDate: Date | string, endDate?: Date | string | null }>,
 *   from: Date | string,
 *   days: number,
 * }} input
 * @returns {Map<string, { reservations: object[], blocks: object[] }>} oda kimliği → barlar
 */
export function buildRoomSegments({ rooms, reservations, blocks, from, days }) {
  const window = { from, days };
  /** @type {Map<string, { reservations: object[], blocks: object[] }>} */
  const byRoom = new Map(rooms.map((room) => [room.id, { reservations: [], blocks: [] }]));

  for (const reservation of reservations) {
    if (!reservation.roomId) continue;
    const row = byRoom.get(reservation.roomId);
    if (!row) continue;
    const placement = placeInWindow({ start: reservation.checkIn, end: reservation.checkOut }, window);
    if (!placement) continue;
    row.reservations.push({ ...reservation, ...placement });
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
 * Izgaranın başlığındaki günlük özet — **otelin tamamından**, sayfadan değil.
 *
 * Ön büro şefi ızgaraya bakarken "yarın kaç giriş var, kaç oda boş kalıyor"
 * sorusunun cevabını ister. Sayfalanmış satırlardan hesaplamak, 3. sayfaya
 * geçince doluluğun değişmesi demekti.
 *
 * Tanımlar (otelcilik karşılıkları):
 * - `arrivals`: o gün giriş yapacak konaklama (oda atanmış ya da atanmamış).
 * - `departures`: o sabah çıkacak konaklama — o geceyi **doldurmaz**.
 * - `stayovers`: o gece kalan ama o gün girmeyen konaklama.
 * - `sellable`: toplam oda − arızalı (hizmet dışı odalar satışta sayılır).
 * - `occupancyPct`: (dolu + oda bekleyen) / satılabilir — oda bekleyen
 *   rezervasyon da envanteri tükettiği için paya dahildir.
 *
 * @param {{
 *   totalRooms: number,
 *   reservations: Array<{ roomId: string | null, checkIn: Date | string, checkOut: Date | string, status: string }>,
 *   blocks: Array<{ roomId: string, type?: string, startDate: Date | string, endDate?: Date | string | null }>,
 *   from: Date | string,
 *   days: number,
 * }} input
 * @returns {Array<{ date: string, arrivals: number, departures: number, stayovers: number, occupied: number, unassigned: number, outOfOrder: number, outOfService: number, sellable: number, free: number, occupancyPct: number }>}
 */
export function summarizeDays({ totalRooms, reservations, blocks, from, days }) {
  const dayList = planDays(from, days);
  const index = new Map(dayList.map((day, position) => [day, position]));
  const zeros = () => dayList.map(() => 0);

  const arrivals = zeros();
  const departures = zeros();
  const occupied = zeros();
  const unassigned = zeros();
  const nightsCovered = dayList.map(() => new Set());
  const outOfOrder = dayList.map(() => new Set());
  const outOfService = dayList.map(() => new Set());

  for (const reservation of reservations) {
    if (!consumesInventory(reservation)) continue;

    const arrival = index.get(toIsoDay(reservation.checkIn));
    if (arrival !== undefined) arrivals[arrival] += 1;
    const departure = index.get(toIsoDay(reservation.checkOut));
    if (departure !== undefined) departures[departure] += 1;

    const placement = placeInWindow({ start: reservation.checkIn, end: reservation.checkOut }, { from, days });
    if (!placement) continue;
    for (let offset = 0; offset < placement.span; offset += 1) {
      const position = placement.startIndex + offset;
      if (reservation.roomId) {
        occupied[position] += 1;
        nightsCovered[position].add(reservation.roomId);
      } else {
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
    const sold = occupied[position] + unassigned[position];
    // Arızalı oda hem dolu hem arızalı olabilir (misafir içerideyken arıza
    // açıldı); tek oda iki kez düşülmesin diye küme birleşimi kullanılıyor.
    const unavailable = new Set([...nightsCovered[position], ...outOfOrder[position]]).size;

    return {
      date,
      arrivals: arrivals[position],
      departures: departures[position],
      stayovers: Math.max(0, occupied[position] + unassigned[position] - arrivals[position]),
      occupied: occupied[position],
      unassigned: unassigned[position],
      outOfOrder: outOfOrderCount,
      outOfService: outOfService[position].size,
      sellable,
      free: totalRooms - unavailable - unassigned[position],
      occupancyPct: sellable === 0 ? 0 : Math.round((sold / sellable) * 100),
    };
  });
}
