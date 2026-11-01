import { HOUSEKEEPING_CLEANING_TYPES } from '@hotelos/hotel-contracts';

/**
 * Kat hizmetleri (modül 14) — saf kurallar. Veritabanı bilmez; servis veriyi
 * toplar, karar buradan çıkar. Böylece sabah görev üretimi ve kat haritası
 * veritabanısız test edilir.
 */

/**
 * Sabah STAYOVER planı: hangi odalara konaklama temizliği görevi açılacak?
 *
 * Kural: içeride misafiri olan (`CHECKED_IN`) ve **bugün çıkmayacak** her oda
 * konaklama temizliği alır. Bugün çıkacak oda almaz — çıkışta zaten çıkış
 * temizliği açılacak; ikisini birden açmak görevliyi aynı odaya iki kez
 * gönderir. O gün için görevi (hangi durumda olursa olsun — şef iptal
 * ettiyse kararına saygı) ya da hâlâ açık bir temizlik görevi olan oda da
 * atlanır: üretim her 10 dakikada bir koştuğu için aynı görevi iki kez
 * açmamak üretimin kendisinin işidir, veritabanı kısıtı son emniyettir.
 *
 * @param {{
 *   businessDate: Date,
 *   stays: Array<{ roomId: string | null, checkOut: Date }>,
 *   skipRoomIds: Iterable<string>,
 * }} input
 * @returns {string[]} görev açılacak oda id'leri (tekrarsız)
 */
export function buildStayoverPlan({ businessDate, stays, skipRoomIds }) {
  const skip = new Set(skipRoomIds);
  const rooms = new Set();
  for (const stay of stays) {
    if (!stay.roomId || skip.has(stay.roomId)) continue;
    if (stay.checkOut.getTime() <= businessDate.getTime()) continue;
    rooms.add(stay.roomId);
  }
  return [...rooms];
}

/**
 * Oda durum haritası: odalar kat kat gruplanır, her kutuya açık görevi ve
 * bugünkü giriş / çıkış işaretleri iliştirilir.
 *
 * Giriş bekleyen odanın kutusu öne çıkar: temizliğin zamanında bitmesi o
 * odanın akşam satılabilmesi demek (oda atama temiz odayı öne alıyor).
 *
 * @param {Array<{ id: string, number: string, floor: number, occupancy: string, housekeepingStatus: string }>} rooms
 * @param {Map<string, object>} openTaskByRoom oda id → açık görev özeti
 * @param {Set<string>} arrivalRoomIds bugün girişi olan odalar
 * @param {Set<string>} departureRoomIds bugün çıkışı olan odalar
 * @param {Set<string>} blockedRoomIds bugün arızalı / hizmet dışı odalar
 * @returns {Array<{ floor: number, rooms: object[] }>} kat numarasına göre artan
 */
export function buildFloorMap(rooms, openTaskByRoom, arrivalRoomIds, departureRoomIds, blockedRoomIds) {
  const floors = new Map();
  for (const room of rooms) {
    const entry = {
      id: room.id,
      number: room.number,
      floor: room.floor,
      occupancy: room.occupancy,
      housekeepingStatus: room.housekeepingStatus,
      openTask: openTaskByRoom.get(room.id) ?? null,
      arrivalToday: arrivalRoomIds.has(room.id),
      departureToday: departureRoomIds.has(room.id),
      blocked: blockedRoomIds.has(room.id),
    };
    const list = floors.get(room.floor) ?? [];
    floors.set(room.floor, [...list, entry]);
  }

  return [...floors.entries()]
    .sort(([a], [b]) => a - b)
    .map(([floor, floorRooms]) => ({
      floor,
      rooms: [...floorRooms].sort((a, b) => a.number.localeCompare(b.number, 'tr', { numeric: true })),
    }));
}

/**
 * Görev odanın kat hizmeti durumunu sürer mi? Misafir isteği görevi (havlu)
 * odayı "Temizleniyor" yapmaz.
 *
 * @param {string} type
 */
export function isCleaningTask(type) {
  return HOUSEKEEPING_CLEANING_TYPES.includes(type);
}

/**
 * Günlük özet sayaçları. Liste sorgusunun grup sonuçları tek nesneye iner;
 * ekran kartları (bekleyen / temizlenen / kontrol bekleyen / biten) bunu okur.
 *
 * @param {Array<{ status: string, _count: number | { _all: number } }>} groups
 * @param {{ awaitingInspection?: number, issues?: number }} [extras]
 */
export function summarizeTasks(groups, extras = {}) {
  const counts = { PENDING: 0, IN_PROGRESS: 0, DONE: 0, CANCELLED: 0 };
  for (const group of groups) {
    const count = typeof group._count === 'number' ? group._count : (group._count?._all ?? 0);
    if (group.status in counts) counts[group.status] = count;
  }
  return {
    pending: counts.PENDING,
    inProgress: counts.IN_PROGRESS,
    done: counts.DONE,
    cancelled: counts.CANCELLED,
    open: counts.PENDING + counts.IN_PROGRESS,
    awaitingInspection: extras.awaitingInspection ?? 0,
    issues: extras.issues ?? 0,
  };
}
