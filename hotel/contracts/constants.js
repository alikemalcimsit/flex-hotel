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

/*
 * ─────────────── Oda durumu: birbirinden bağımsız üç bilgi ───────────────
 *
 * Otel yazılımlarında (Opera, Elektraweb, Protel) oda durumu tek bir liste
 * değildir. "Boş/Dolu" ile "Temiz/Kirli" farklı sorulardır: dolu bir oda kirli
 * olabilir (kalan misafirin günlük temizliği), boş bir oda temiz olabilir.
 * Tek listeye sıkıştırılırsa "dolu ama kirli" yazılamaz ve kat hizmetleri
 * odayı temizleyince misafir içerideyken oda "boş" görünür.
 *
 *   1. Doluluk      — Boş / Dolu. Yalnızca sistem değiştirir (giriş-çıkış).
 *   2. Kat hizmeti  — Kirli / Temizleniyor / Temiz / Kontrol edildi.
 *   3. Arıza kaydı  — tarihli blok: Arızalı (satıştan düşer) ya da
 *                     Hizmet dışı (satışta kalır, misafir verilmez).
 */

/** Doluluk (Prisma `RoomOccupancy` ile birebir). */
export const ROOM_OCCUPANCIES = Object.freeze(['VACANT', 'OCCUPIED']);

export const ROOM_OCCUPANCY_LABELS = Object.freeze({
  VACANT: 'Boş',
  OCCUPIED: 'Dolu',
});

/** Kat hizmeti durumu (Prisma `HousekeepingStatus` ile birebir), iş akışı sırasıyla. */
export const HOUSEKEEPING_STATUSES = Object.freeze(['DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED']);

export const HOUSEKEEPING_STATUS_LABELS = Object.freeze({
  DIRTY: 'Kirli',
  CLEANING: 'Temizleniyor',
  CLEAN: 'Temiz',
  INSPECTED: 'Kontrol edildi',
});

/** Arıza kaydı tipi (Prisma `RoomBlockType` ile birebir). */
export const ROOM_BLOCK_TYPES = Object.freeze(['OUT_OF_ORDER', 'OUT_OF_SERVICE']);

export const ROOM_BLOCK_TYPE_LABELS = Object.freeze({
  OUT_OF_ORDER: 'Arızalı',
  OUT_OF_SERVICE: 'Hizmet dışı',
});

/** Formda tipin altına yazılan açıklama: iki tip arasındaki farkı personel bilmeli. */
export const ROOM_BLOCK_TYPE_HINTS = Object.freeze({
  OUT_OF_ORDER: 'Satıştan düşer, müsaitlik azalır. Tadilat, su basması, büyük arıza.',
  OUT_OF_SERVICE: 'Satışta kalır ama misafir verilmez. Kısa süreli küçük arıza (TV, klima ayarı).',
});

/**
 * Oda listesinde "bugün"e göre arıza filtresi. `IN_SERVICE` = o gün etkin
 * bloğu olmayan oda.
 */
export const ROOM_CONDITIONS = Object.freeze(['IN_SERVICE', 'OUT_OF_ORDER', 'OUT_OF_SERVICE']);

export const ROOM_CONDITION_LABELS = Object.freeze({
  IN_SERVICE: 'Hizmette',
  OUT_OF_ORDER: 'Arızalı',
  OUT_OF_SERVICE: 'Hizmet dışı',
});

/** Blok listesinin kapsamı: sürenler + gelecektekiler, ya da bitmiş olanlar. */
export const ROOM_BLOCK_SCOPES = Object.freeze(['ACTIVE', 'PAST']);

/**
 * Rezervasyonun kendi tipine göre atanan odanın sınıfı. Fiyat karşılaştırması
 * oda tiplerinin taban fiyatıyla yapılır.
 */
export const ROOM_ASSIGNMENT_KINDS = Object.freeze(['SAME', 'UPGRADE', 'LATERAL', 'DOWNGRADE']);

export const ROOM_ASSIGNMENT_KIND_LABELS = Object.freeze({
  SAME: 'Aynı tip',
  UPGRADE: 'Üst sınıf',
  LATERAL: 'Farklı tip',
  DOWNGRADE: 'Alt sınıf',
});

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

/**
 * Envanteri tüketen rezervasyon durumları: oda planında bar çizilir, müsaitlik
 * hesabında düşülür. İptal ve gelmedi kayıtları odayı tutmaz; çıkış yapan
 * rezervasyon geçmiş geceleri doldurmuş olsa da ileriye dönük yer tutmaz —
 * bu yüzden plan ızgarasında "geçmiş" tonuyla ayrı gösterilir.
 */
export const PLAN_SEGMENT_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT']);

/** Oda planında bir seferde gösterilebilecek gün seçenekleri. */
export const PLAN_WINDOW_OPTIONS = Object.freeze([7, 14, 30]);

/** Oda planı penceresinin üst sınırı (gün). */
export const MAX_PLAN_DAYS = 45;

/** Oda planında bir sayfada gösterilen oda sayısı. */
export const PLAN_ROOMS_PAGE_SIZE = 40;

/**
 * Oda planındaki bar tipleri: rezervasyon mu, arıza kaydı mı.
 * Ekran ikisini farklı çiziyor; ikisi de aynı satırda yer kaplar.
 */
export const PLAN_SEGMENT_KINDS = Object.freeze(['RESERVATION', 'BLOCK']);

/** Oda değişikliğinin sonucu — ekran mesajı buna göre değişir. */
export const ROOM_CHANGE_MODES = Object.freeze(['ASSIGNED', 'MOVED', 'IN_HOUSE_MOVED']);

/** Müsaitlik takviminde bir seferde sorulabilecek en uzun pencere. */
export const MAX_AVAILABILITY_DAYS = 90;

/** Sayfalama sınırları — istemci "hepsini ver" diyip sunucuyu boğamasın. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 25;
