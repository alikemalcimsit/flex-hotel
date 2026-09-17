import { DAY_MS, eachNight, rangesOverlapHalfOpen, toDecimal, toIsoDay, toUtcDayStart } from '@hotelos/core';

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

/** Takvimde oda-gece durumu (bit alanı). */
const OCCUPIED = 1;
const UNAVAILABLE = 2;
const OUT_OF_ORDER = 4;
const OUT_OF_SERVICE = 8;

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
 * Müsaitlik takvimi: oda tipi × gece kırılımında boş oda sayısı.
 *
 * Tek geçişte hesaplar — gece başına sorgu atmaz. Oda × gece durumu tam
 * sayı indeksli bir tabloda tutulur (90 gece × 1500 oda = 135 bin bayt);
 * gece başına küme ya da tarih metni üretilmez. 30 bin rezervasyonluk 90
 * günlük pencere onlarca milisaniyede hesaplanır (eski sürüm yüzlerce).
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
  const windowStart = toUtcDayStart(from);
  const windowEnd = toUtcDayStart(to);
  const nightCount = Math.max(0, Math.round((windowEnd - windowStart) / DAY_MS));
  const days = Array.from({ length: nightCount }, (_, index) => toIsoDay(windowStart + index * DAY_MS));

  /** @type {Map<string, number>} tip → toplam oda */
  const totalByType = new Map();
  // Henüz odası olmayan tipler de takvimde 0 olarak görünmeli; aksi halde
  // müsaitlik ızgarasında satır kaybolur ve "neden yok" sorusu doğar.
  for (const roomTypeId of roomTypeIds) totalByType.set(roomTypeId, 0);
  for (const room of rooms) {
    totalByType.set(room.roomTypeId, (totalByType.get(room.roomTypeId) ?? 0) + 1);
  }
  const types = [...totalByType.keys()];
  const typeIndex = new Map(types.map((roomTypeId, index) => [roomTypeId, index]));

  // Oda ve gece tam sayı indeksleriyle tutulur: 90 gece × 1500 oda bellekte
  // 135 bin baytlık bir tablodur; gece başına küme ve tarih metni üretilmez.
  const roomIndex = new Map();
  const roomTypeOf = new Int32Array(rooms.length);
  rooms.forEach((room, index) => {
    if (roomIndex.has(room.id)) return;
    roomIndex.set(room.id, index);
    roomTypeOf[index] = typeIndex.get(room.roomTypeId);
  });
  const state = new Uint8Array(nightCount * rooms.length);
  const unassigned = new Int32Array(nightCount * types.length);

  /** @param {Date | string} start @param {Date | string | null | undefined} end */
  const nightRange = (start, end) => {
    const first = Math.max(toUtcDayStart(start), windowStart);
    // Süresiz blokta üst sınır pencerenin sonudur.
    const last = end == null ? windowEnd : Math.min(toUtcDayStart(end), windowEnd);
    return [Math.round((first - windowStart) / DAY_MS), Math.round((last - windowStart) / DAY_MS)];
  };
  /** @param {string} roomId @param {number} night @param {number} flags */
  const mark = (roomId, night, flags) => {
    const room = roomIndex.get(roomId);
    if (room !== undefined) state[night * rooms.length + room] |= flags;
  };

  const consumingIds = new Set(
    reservations.filter((reservation) => reservation.id && consumesInventory(reservation)).map((reservation) => reservation.id),
  );

  // Kapanmış dilimler: taşınan misafirin eski odasında geçirdiği geceler.
  /** @type {Map<string, Set<number>>} rezervasyon → dilimle karşılanan gece indeksleri */
  const segmentNights = new Map();
  for (const segment of segments) {
    if (!consumingIds.has(segment.reservationId)) continue;
    const [first, last] = nightRange(segment.startDate, segment.endDate);
    for (let night = first; night < last; night += 1) {
      mark(segment.roomId, night, OCCUPIED | UNAVAILABLE);
      if (!segmentNights.has(segment.reservationId)) segmentNights.set(segment.reservationId, new Set());
      segmentNights.get(segment.reservationId).add(night);
    }
  }

  for (const reservation of reservations) {
    if (!consumesInventory(reservation)) continue;

    const openStart = toUtcDayStart(openSliceStart(reservation));
    const covered = segmentNights.get(reservation.id);
    const type = typeIndex.get(reservation.roomTypeId);
    const [first, last] = nightRange(reservation.checkIn, reservation.checkOut);
    for (let night = first; night < last; night += 1) {
      if (reservation.roomId && windowStart + night * DAY_MS >= openStart) {
        mark(reservation.roomId, night, OCCUPIED | UNAVAILABLE);
        continue;
      }
      // Bu gece eski odada geçti; oda yukarıdaki dilim döngüsünde işaretlendi.
      if (reservation.id && covered?.has(night)) continue;
      if (type !== undefined) unassigned[night * types.length + type] += 1;
    }
  }

  for (const block of blocks) {
    const removesInventory = (block.type ?? INVENTORY_REMOVING_BLOCK_TYPE) === INVENTORY_REMOVING_BLOCK_TYPE;
    const flags = removesInventory ? OUT_OF_ORDER | UNAVAILABLE : OUT_OF_SERVICE;
    const [first, last] = nightRange(block.startDate, block.endDate);
    for (let night = first; night < last; night += 1) mark(block.roomId, night, flags);
  }

  // Gece başına tip sayaçları tek geçişte.
  const counters = new Int32Array(types.length * 4);
  const byType = types.map(() => ({}));
  for (let night = 0; night < nightCount; night += 1) {
    counters.fill(0);
    const offset = night * rooms.length;
    for (let room = 0; room < rooms.length; room += 1) {
      const flags = state[offset + room];
      if (flags === 0) continue;
      const base = roomTypeOf[room] * 4;
      if (flags & UNAVAILABLE) {
        counters[base] += 1;
        // Hem dolu hem arızalı bir oda tek kez düşülür ama iki sayaçta da görünür;
        // ekranda "neden satılamıyor" sorusunun cevabı için ikisi de lazım.
        if (flags & OCCUPIED) counters[base + 1] += 1;
        if (flags & OUT_OF_ORDER) counters[base + 2] += 1;
      }
      if (flags & OUT_OF_SERVICE) counters[base + 3] += 1;
    }
    const day = days[night];
    types.forEach((roomTypeId, type) => {
      const total = totalByType.get(roomTypeId);
      const waiting = unassigned[night * types.length + type];
      byType[type][day] = {
        total,
        occupied: counters[type * 4 + 1],
        outOfOrder: counters[type * 4 + 2],
        // Satılabilir sayılır ama atanamaz: son odalar bunlarsa ön büro uyarılmalı.
        outOfService: counters[type * 4 + 3],
        unassigned: waiting,
        // Negatif kalabilir: overbooking'i gizlemek yerine görünür kılıyoruz.
        free: total - counters[type * 4] - waiting,
      };
    });
  }

  const byRoomType = {};
  types.forEach((roomTypeId, type) => {
    byRoomType[roomTypeId] = { total: totalByType.get(roomTypeId), days: byType[type] };
  });
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
