/**
 * Enum karşılıkları ve etiketler.
 *
 * Tek kaynak olmaları önemli: Prisma şemasındaki `BoardType` ile ekrandaki
 * açılır listenin ayrışması, kullanıcının kaydedemediği bir form demektir.
 */

/** Vergilerin uygulanabileceği kalem tipleri (Prisma `FolioItemType` alt kümesi). */
export const TAX_APPLIES_TO = Object.freeze(['ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'SPA', 'OTHER']);

export const TAX_APPLIES_TO_LABELS = Object.freeze({
  ROOM: 'Oda',
  FNB: 'Restoran',
  MINIBAR: 'Minibar',
  LAUNDRY: 'Çamaşırhane',
  SPA: 'SPA',
  OTHER: 'Diğer',
});

/** Pansiyon tipleri (Prisma `BoardType` ile birebir). */
export const BOARD_TYPES = Object.freeze(['RO', 'BB', 'HB', 'FB', 'AI', 'UAI']);

export const BOARD_TYPE_LABELS = Object.freeze({
  RO: 'RO — Sadece oda',
  BB: 'BB — Oda + kahvaltı',
  HB: 'HB — Yarım pansiyon',
  FB: 'FB — Tam pansiyon',
  AI: 'AI — Her şey dahil',
  UAI: 'UAI — Ultra her şey dahil',
});

/** Oda durumları (Prisma `RoomStatus` ile birebir). */
export const ROOM_STATUSES = Object.freeze([
  'AVAILABLE',
  'OCCUPIED',
  'DIRTY',
  'CLEANING',
  'BLOCKED',
  'MAINTENANCE',
]);

export const ROOM_STATUS_LABELS = Object.freeze({
  AVAILABLE: 'Boş',
  OCCUPIED: 'Dolu',
  DIRTY: 'Kirli',
  CLEANING: 'Temizlikte',
  BLOCKED: 'Bloke',
  MAINTENANCE: 'Bakımda',
});

/**
 * Personelin elle atayabileceği durumlar.
 *
 * `OCCUPIED` listede yok: bir oda ancak misafir giriş yapınca dolu olur
 * (modül 6). Elle "dolu" yapılabilseydi folyosu olmayan hayalet konaklamalar
 * doğardı. `BLOCKED` ve `MAINTENANCE` de yok — onlar tarih aralığı gerektirir,
 * blok API'sinden geçer.
 */
export const MANUAL_ROOM_STATUSES = Object.freeze(['AVAILABLE', 'DIRTY', 'CLEANING']);

/** Rezervasyon durumları (Prisma `ReservationStatus` ile birebir). */
export const RESERVATION_STATUSES = Object.freeze([
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
]);

export const RESERVATION_STATUS_LABELS = Object.freeze({
  PENDING: 'Bekliyor',
  CONFIRMED: 'Onaylı',
  CHECKED_IN: 'Giriş yaptı',
  CHECKED_OUT: 'Çıkış yaptı',
  CANCELLED: 'İptal',
  NO_SHOW: 'Gelmedi',
});

/** Müsaitlik takviminde bir seferde sorulabilecek en uzun pencere. */
export const MAX_AVAILABILITY_DAYS = 90;

/** Sayfalama sınırları — istemci "hepsini ver" diyip sunucuyu boğamasın. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 25;
