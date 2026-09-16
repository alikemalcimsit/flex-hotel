import { eachNight, rangesOverlapHalfOpen, toDecimal, toIsoDay, toUtcDayStart } from '@hotelos/core';

/**
 * Müsaitlik ve oda atamanın saf çekirdeği — veritabanı, HTTP veya Prisma bilmez.
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
 *   boş = (tipin odaları − o gece arızalı ya da dolu olanlar) − atanmamış talep
 *
 * ### İki blok tipi, iki farklı etki
 *
 * - `OUT_OF_ORDER` (Arızalı): oda satıştan düşer, envanter azalır.
 * - `OUT_OF_SERVICE` (Hizmet dışı): oda satışta kalır (kısa süreli küçük arıza)
 *   ama o gecelerde misafire verilmez — atanabilir oda listesine girmez.
 */

/** Envanteri tüketen rezervasyon durumları. Diğerleri odayı işgal etmez. */
export const INVENTORY_CONSUMING_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN']);

/** Envanterden düşen blok tipi. */
export const INVENTORY_REMOVING_BLOCK_TYPE = 'OUT_OF_ORDER';

/**
 * @param {{ status: string }} reservation
 * @returns {boolean}
 */
export function consumesInventory(reservation) {
  return INVENTORY_CONSUMING_STATUSES.includes(reservation.status);
}

/**
 * Konaklamanın **açık dilimi** — misafirin şu anki `roomId` odasında kaldığı
 * gecelerin başlangıcı.
 *
 * İçerideki misafir oda değiştirdiyse (`roomSince`), öncesindeki geceler eski
 * odalardadır ve `RoomStaySegment` olarak ayrıca gelir. `roomSince` boşsa
 * konaklamanın tamamı `roomId` odasındadır.
 *
 * @param {{ checkIn: Date | string, roomSince?: Date | string | null }} reservation
 * @returns {Date | string}
 */
export function openSliceStart(reservation) {
  if (reservation.roomSince == null) return reservation.checkIn;
  return toUtcDayStart(reservation.roomSince) > toUtcDayStart(reservation.checkIn)
    ? reservation.roomSince
    : reservation.checkIn;
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
 * Tek geçişte hesaplar — gece başına sorgu atmaz. 90 günlük pencere ve 1000
 * odalı bir otelde bile bellekte kalır.
 *
 * Oda değiştirmiş konaklamada geceler iki kaynaktan gelir: açık dilim
 * (`roomSince`'ten itibaren `roomId`) ve kapanmış dilimler (`segments`).
 * Kapanmış dilimi olmayan erken geceler (tutarsız veri) güvenli tarafta
 * "oda bekleyen talep" sayılır: envanterden düşer ama bir odayı işgal etmez.
 *
 * @param {{
 *   rooms: Array<{ id: string, roomTypeId: string }>,
 *   reservations: Array<{ id?: string, roomId: string | null, roomTypeId: string, checkIn: Date | string, checkOut: Date | string, roomSince?: Date | string | null, status: string }>,
 *   blocks: Array<{ roomId: string, type?: string, startDate: Date | string, endDate?: Date | string | null }>,
 *   segments?: Array<{ reservationId: string, roomId: string, startDate: Date | string, endDate: Date | string }>,
 *   from: Date | string,
 *   to: Date | string,
 *   roomTypeIds?: string[],
 * }} input
 * @returns {{
 *   days: string[],
 *   byRoomType: Record<string, { total: number, days: Record<string, { total: number, occupied: number, outOfOrder: number, outOfService: number, unassigned: number, free: number }> }>,
 * }}
 */
export function buildAvailabilityCalendar({ rooms, reservations, blocks, segments = [], from, to, roomTypeIds = [] }) {
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

  // Gece başına: hangi odalar satılamaz, hangi tipte kaç atanmamış talep var.
  const unavailableRoomsByNight = days.map(() => new Set());
  const occupiedRoomsByNight = days.map(() => new Set());
  const outOfOrderRoomsByNight = days.map(() => new Set());
  const outOfServiceRoomsByNight = days.map(() => new Set());
  const unassignedByNight = days.map(() => new Map());

  const consumingIds = new Set(
    reservations.filter((reservation) => reservation.id && consumesInventory(reservation)).map((reservation) => reservation.id),
  );

  // Kapanmış dilimler: taşınan misafirin eski odasında geçirdiği geceler.
  /** @type {Map<string, Set<number>>} rezervasyon → dilimle karşılanan gece indeksleri */
  const segmentNights = new Map();
  for (const segment of segments) {
    if (!consumingIds.has(segment.reservationId)) continue;
    const covered = nightsWithinWindow({ start: segment.startDate, end: segment.endDate }, from, to);
    for (const night of covered) {
      const index = dayIndex.get(toIsoDay(night));
      if (index === undefined) continue;
      occupiedRoomsByNight[index].add(segment.roomId);
      unavailableRoomsByNight[index].add(segment.roomId);
      if (!segmentNights.has(segment.reservationId)) segmentNights.set(segment.reservationId, new Set());
      segmentNights.get(segment.reservationId).add(index);
    }
  }

  for (const reservation of reservations) {
    if (!consumesInventory(reservation)) continue;

    const openStart = toUtcDayStart(openSliceStart(reservation));
    const covered = nightsWithinWindow({ start: reservation.checkIn, end: reservation.checkOut }, from, to);
    for (const night of covered) {
      const index = dayIndex.get(toIsoDay(night));
      if (index === undefined) continue;

      if (reservation.roomId && night.getTime() >= openStart) {
        occupiedRoomsByNight[index].add(reservation.roomId);
        unavailableRoomsByNight[index].add(reservation.roomId);
        continue;
      }
      // Bu gece eski odada geçti; oda yukarıdaki dilim döngüsünde işaretlendi.
      if (reservation.id && segmentNights.get(reservation.id)?.has(index)) continue;

      const counts = unassignedByNight[index];
      counts.set(reservation.roomTypeId, (counts.get(reservation.roomTypeId) ?? 0) + 1);
    }
  }

  for (const block of blocks) {
    const removesInventory = (block.type ?? INVENTORY_REMOVING_BLOCK_TYPE) === INVENTORY_REMOVING_BLOCK_TYPE;
    const covered = nightsWithinWindow({ start: block.startDate, end: block.endDate }, from, to);
    for (const night of covered) {
      const index = dayIndex.get(toIsoDay(night));
      if (index === undefined) continue;
      if (removesInventory) {
        outOfOrderRoomsByNight[index].add(block.roomId);
        unavailableRoomsByNight[index].add(block.roomId);
      } else {
        outOfServiceRoomsByNight[index].add(block.roomId);
      }
    }
  }

  const byRoomType = {};
  for (const [roomTypeId, total] of totalByType) {
    const perDay = {};

    days.forEach((day, index) => {
      let occupied = 0;
      let outOfOrder = 0;
      let unavailable = 0;

      for (const roomId of unavailableRoomsByNight[index]) {
        if (roomTypeOfRoom.get(roomId) !== roomTypeId) continue;
        unavailable += 1;
        if (occupiedRoomsByNight[index].has(roomId)) occupied += 1;
        // Hem dolu hem arızalı bir oda tek kez düşülür ama iki sayaçta da görünür;
        // ekranda "neden satılamıyor" sorusunun cevabı için ikisi de lazım.
        if (outOfOrderRoomsByNight[index].has(roomId)) outOfOrder += 1;
      }

      let outOfService = 0;
      for (const roomId of outOfServiceRoomsByNight[index]) {
        if (roomTypeOfRoom.get(roomId) === roomTypeId) outOfService += 1;
      }

      const unassigned = unassignedByNight[index].get(roomTypeId) ?? 0;

      perDay[day] = {
        total,
        occupied,
        outOfOrder,
        // Satılabilir sayılır ama atanamaz: son odalar bunlarsa ön büro uyarılmalı.
        outOfService,
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
 * Bir değişikliğin **yeni** overbooking yaratıp yaratmadığı.
 *
 * Envanteri azaltan her işlem (oda bloklamak, silmek, tipini değiştirmek,
 * rezervasyonu başka tipe yerleştirmek) bununla denetlenir. Kural "sonuç
 * negatif olmasın" değil, "negatifi büyütmesin": zaten overbook olmuş bir
 * gecede aynı tipte odaya misafir yerleştirmek (net etkisi sıfır) engellenirse
 * personel mevcut sorunu çözemez hâle gelir.
 *
 * @param {ReturnType<typeof buildAvailabilityCalendar>} before
 * @param {ReturnType<typeof buildAvailabilityCalendar>} after
 * @param {string[]} roomTypeIds denetlenecek tipler
 * @returns {Array<{ roomTypeId: string, day: string, freeBefore: number, freeAfter: number, sellable: number, demand: number }>}
 *   `sellable`: değişiklikten sonra o gece satılabilir oda; `demand`: o geceyi tutan rezervasyon
 */
export function findNewOverbooking(before, after, roomTypeIds) {
  const violations = [];
  for (const roomTypeId of roomTypeIds) {
    const afterDays = after.byRoomType[roomTypeId]?.days ?? {};
    const beforeDays = before.byRoomType[roomTypeId]?.days ?? {};
    for (const day of after.days) {
      const next = afterDays[day];
      if (!next) continue;
      const freeBefore = beforeDays[day]?.free ?? 0;
      if (next.free < 0 && next.free < freeBefore) {
        const sellable = next.total - next.outOfOrder;
        violations.push({ roomTypeId, day, freeBefore, freeAfter: next.free, sellable, demand: sellable - next.free });
      }
    }
  }
  return violations;
}

/**
 * Verilen konaklama için atanabilecek fiziksel odalar.
 *
 * Odanın konaklamanın **her gecesinde** boş olması gerekir: çakışan
 * rezervasyonu ya da herhangi bir bloğu (arızalı veya hizmet dışı) varsa
 * listeye girmez.
 *
 * @param {{
 *   rooms: Array<{ id: string, roomTypeId: string }>,
 *   reservations: Array<{ id: string, roomId: string | null, checkIn: Date | string, checkOut: Date | string, status: string }>,
 *   blocks: Array<{ roomId: string, startDate: Date | string, endDate?: Date | string | null }>,
 *   segments?: Array<{ reservationId: string, roomId: string, startDate: Date | string, endDate: Date | string }>,
 *   roomTypeId?: string,
 *   checkIn: Date | string,
 *   checkOut: Date | string,
 *   excludeReservationId?: string,
 * }} input
 * @returns {Array<{ id: string, roomTypeId: string }>}
 */
export function freeRoomsForStay({
  rooms,
  reservations,
  blocks,
  segments = [],
  roomTypeId,
  checkIn,
  checkOut,
  excludeReservationId,
}) {
  const stay = { start: checkIn, end: checkOut };

  const takenRoomIds = new Set();
  const consumingIds = new Set();
  for (const reservation of reservations) {
    if (!consumesInventory(reservation)) continue;
    consumingIds.add(reservation.id);
    if (!reservation.roomId) continue;
    // Kaydın kendisi engel sayılmaz (oda değiştirme senaryosu).
    if (excludeReservationId && reservation.id === excludeReservationId) continue;
    // Yalnızca açık dilim: misafir bu odaya sonradan taşındıysa önceki geceler başka odadaydı.
    if (rangesOverlapHalfOpen({ start: openSliceStart(reservation), end: reservation.checkOut }, stay)) {
      takenRoomIds.add(reservation.roomId);
    }
  }

  for (const segment of segments) {
    if (excludeReservationId && segment.reservationId === excludeReservationId) continue;
    if (!consumingIds.has(segment.reservationId)) continue;
    if (rangesOverlapHalfOpen({ start: segment.startDate, end: segment.endDate }, stay)) {
      takenRoomIds.add(segment.roomId);
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

const ROOM_NUMBER_COLLATOR = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });

/**
 * Oda numaralarının doğal sırası: kat, sonra numara sayısal duyarlıkla
 * (1, 2, 10, 101, 101A).
 *
 * Metin sıralaması (1, 10, 101, 2) villa ve bungalov numaralı otellerde
 * listeyi ve oda planını karıştırır. Oda listesi, oda planı ve otomatik atama
 * aynı sırayı kullanır.
 *
 * @param {{ floor: number, number: string }} a
 * @param {{ floor: number, number: string }} b
 */
export function compareRoomsNaturally(a, b) {
  if (a.floor !== b.floor) return a.floor - b.floor;
  return ROOM_NUMBER_COLLATOR.compare(a.number, b.number);
}

/** Bugün gelen misafir için kat hizmeti tercihi: hazır oda önce. */
const HOUSEKEEPING_RANK = Object.freeze({ INSPECTED: 0, CLEAN: 1, CLEANING: 2, DIRTY: 3 });

/** Bugün gelen misafir için: boş oda, çıkışı bekleyen dolu odadan önce. */
const OCCUPANCY_RANK = Object.freeze({ VACANT: 0, OCCUPIED: 1 });

const UNKNOWN_RANK = 9;

/**
 * Aday odaları otomatik atamanın tercih sırasına dizer (girdiyi değiştirmez).
 *
 * Odanın **şu anki** hâli yalnızca misafir bugün (veya gecikmiş olarak) geliyorsa
 * önemlidir: önce kontrol edilmiş/temiz ve boş odalar, sonra temizlenmekte
 * olanlar, sonra kirliler, en son çıkışı beklenen dolu odalar. Gelecek ayki bir
 * konaklama için bugün kirli olmak anlamsızdır; orada yalnızca kat ve numara
 * sırası kullanılır. Böylece aktör, insanın seçeceği odayı seçer.
 *
 * @template {{ number: string, floor: number, occupancy?: string, housekeepingStatus?: string }} T
 * @param {T[]} candidates
 * @param {{ arrivalIsToday?: boolean }} [options]
 * @returns {T[]}
 */
export function rankRooms(candidates, { arrivalIsToday = false } = {}) {
  return [...candidates].sort((a, b) => {
    if (arrivalIsToday) {
      const occupancyDelta =
        (OCCUPANCY_RANK[a.occupancy] ?? UNKNOWN_RANK) - (OCCUPANCY_RANK[b.occupancy] ?? UNKNOWN_RANK);
      if (occupancyDelta !== 0) return occupancyDelta;
      const housekeepingDelta =
        (HOUSEKEEPING_RANK[a.housekeepingStatus] ?? UNKNOWN_RANK) -
        (HOUSEKEEPING_RANK[b.housekeepingStatus] ?? UNKNOWN_RANK);
      if (housekeepingDelta !== 0) return housekeepingDelta;
    }
    return compareRoomsNaturally(a, b);
  });
}

/**
 * Otomatik atamanın seçeceği oda.
 * @template {{ number: string, floor: number, occupancy?: string, housekeepingStatus?: string }} T
 * @param {T[]} candidates
 * @param {{ arrivalIsToday?: boolean }} [options]
 * @returns {T | null}
 */
export function pickBestRoom(candidates, options) {
  return rankRooms(candidates, options)[0] ?? null;
}

/**
 * Rezervasyonun tipine göre hedef odanın sınıfı — taban fiyat karşılaştırması.
 *
 * Eskiden kendi tipi dışındaki her oda "upgrade" etiketi alıyordu; Deluxe
 * misafirini Standart'a koymak da "upgrade" görünüyordu.
 *
 * @param {{ id: string, basePrice: string }} reservedType
 * @param {{ id: string, basePrice: string }} targetType
 * @returns {'SAME' | 'UPGRADE' | 'LATERAL' | 'DOWNGRADE'}
 */
export function assignmentKind(reservedType, targetType) {
  if (reservedType.id === targetType.id) return 'SAME';
  const comparison = toDecimal(targetType.basePrice).comparedTo(toDecimal(reservedType.basePrice));
  if (comparison > 0) return 'UPGRADE';
  if (comparison < 0) return 'DOWNGRADE';
  return 'LATERAL';
}

/**
 * Misafir sayısı odanın kapasitesine sığıyor mu?
 * @param {{ adults: number, children: number }} party
 * @param {{ capacityAdults: number, capacityChildren: number }} roomType
 * @returns {boolean}
 */
export function fitsCapacity(party, roomType) {
  return party.adults <= roomType.capacityAdults && party.children <= roomType.capacityChildren;
}

/**
 * Verilen günü kapsayan blok (bloklar aynı odada çakışamadığı için en fazla bir).
 * @template {{ startDate: Date | string, endDate?: Date | string | null }} T
 * @param {T[]} blocks
 * @param {Date | string} day
 * @returns {T | null}
 */
export function activeBlockOn(blocks, day) {
  const target = toUtcDayStart(day);
  return (
    blocks.find(
      (block) =>
        toUtcDayStart(block.startDate) <= target && (block.endDate == null || toUtcDayStart(block.endDate) > target),
    ) ?? null
  );
}

/**
 * Oda değişikliği isteği ne anlama geliyor?
 *
 * Üçü de aynı düğmeden (oda planında sürükle-bırak) gelir ama sonuçları farklı:
 *
 * - `ASSIGNED`: rezervasyonun odası yoktu, atandı.
 * - `MOVED`: misafir henüz gelmemiş; yalnızca kayıttaki oda değişir.
 * - `IN_HOUSE_MOVED`: misafir içeride. Eski oda **boş + kirli**, yeni oda
 *   **dolu** olmalı; bunu atlamak odayı iki kez satılabilir gösterir.
 *
 * @param {{ roomId: string | null, status: string }} reservation
 * @returns {'ASSIGNED' | 'MOVED' | 'IN_HOUSE_MOVED'}
 */
export function roomChangeMode(reservation) {
  if (reservation.status === 'CHECKED_IN') return 'IN_HOUSE_MOVED';
  return reservation.roomId ? 'MOVED' : 'ASSIGNED';
}

/**
 * Blok kaldırma isteği ne anlama geliyor?
 *
 * Geçmiş değiştirilmez — dün arızalı olan oda bugün "hiç arızalı olmamış"
 * gösterilirse doluluk raporu ve gece kapanışı yalan söyler:
 *
 * - `CANCEL`: blok henüz başlamadı (bugün veya ileride) → kayıt silinir.
 * - `END`: blok sürüyor → bitişi bugüne çekilir; bu geceden itibaren oda açılır.
 * - `ALREADY_ENDED`: blok zaten bitmiş → dokunulmaz.
 *
 * @param {{ startDate: Date | string, endDate?: Date | string | null }} block
 * @param {Date | string} businessDate
 * @returns {'CANCEL' | 'END' | 'ALREADY_ENDED'}
 */
export function blockRemovalMode(block, businessDate) {
  const today = toUtcDayStart(businessDate);
  if (block.endDate != null && toUtcDayStart(block.endDate) <= today) return 'ALREADY_ENDED';
  if (toUtcDayStart(block.startDate) >= today) return 'CANCEL';
  return 'END';
}
