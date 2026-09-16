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

/** Oda bekleyen şeridinde listelenebilecek durumlar (oda verilebilenler). */
export const PLAN_ASSIGNABLE_STATUSES = Object.freeze(['PENDING', 'CONFIRMED']);

/** Oda değişikliği sebebinin en uzun hâli (ekran ve sunucu aynı sınırı kullanır). */
export const MAX_MOVE_REASON_LENGTH = 200;

/** Oda planında bir seferde gösterilebilecek gün seçenekleri. */
export const PLAN_WINDOW_OPTIONS = Object.freeze([7, 14, 30]);

/** Oda planı penceresinin üst sınırı (gün). */
export const MAX_PLAN_DAYS = 45;

/** Oda planında bir sayfada gösterilen oda sayısı. */
export const PLAN_ROOMS_PAGE_SIZE = 40;

/**
 * Oda değişikliğinin sonucu — ekran mesajı buna göre değişir.
 * `UNCHANGED`: kayıt zaten o odadaydı, yazma yapılmadı.
 */
export const ROOM_CHANGE_MODES = Object.freeze(['ASSIGNED', 'MOVED', 'IN_HOUSE_MOVED', 'UNCHANGED']);

/** Müsaitlik takviminde bir seferde sorulabilecek en uzun pencere. */
export const MAX_AVAILABILITY_DAYS = 90;

/** Sayfalama sınırları — istemci "hepsini ver" diyip sunucuyu boğamasın. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 25;

/*
 * ─────────────── Misafir mesajları (modül 7) ───────────────
 */

/** Konuşma durumu (Prisma `ConversationStatus`). */
export const CONVERSATION_STATUSES = Object.freeze(['OPEN', 'CLOSED']);

export const CONVERSATION_STATUS_LABELS = Object.freeze({
  OPEN: 'Açık',
  CLOSED: 'Kapalı',
});

/**
 * Konuşmaya kim cevap veriyor (Prisma `ConversationMode`). `MANUAL` = "manuele
 * alındı": AI asistanı bu konuşmaya karışmaz.
 */
export const CONVERSATION_MODES = Object.freeze(['AI', 'MANUAL']);

export const CONVERSATION_MODE_LABELS = Object.freeze({
  AI: 'AI asistanı',
  MANUAL: 'Personel',
});

/** Konuşma açılabilen kanallar (Prisma `NotificationChannel` alt kümesi). */
export const CONVERSATION_CHANNELS = Object.freeze(['WHATSAPP', 'WEBCHAT', 'SMS', 'EMAIL']);

export const CONVERSATION_CHANNEL_LABELS = Object.freeze({
  WHATSAPP: 'WhatsApp',
  WEBCHAT: 'Web chat',
  SMS: 'SMS',
  EMAIL: 'E-posta',
});

/** Mesajın yazarı (Prisma `MessageAuthor`). */
export const MESSAGE_AUTHORS = Object.freeze(['GUEST', 'STAFF', 'AI', 'SYSTEM']);

export const MESSAGE_AUTHOR_LABELS = Object.freeze({
  GUEST: 'Misafir',
  STAFF: 'Personel',
  AI: 'AI asistanı',
  SYSTEM: 'Sistem',
});

/** Mesajın kanal yolculuğu (Prisma `MessageDelivery`). */
export const MESSAGE_DELIVERIES = Object.freeze(['RECEIVED', 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED']);

export const MESSAGE_DELIVERY_LABELS = Object.freeze({
  RECEIVED: 'Alındı',
  PENDING: 'Gönderim bekliyor',
  SENT: 'Gönderildi',
  DELIVERED: 'İletildi',
  READ: 'Okundu',
  FAILED: 'Gönderilemedi',
});

/** Kanalın bildirebileceği teslim durumları (modül 8 → `markMessageDelivery`). */
export const CHANNEL_REPORTED_DELIVERIES = Object.freeze(['SENT', 'DELIVERED', 'READ', 'FAILED']);

/**
 * Gelen kutusu görünümleri. `WAITING`: misafir yazmış, henüz kimse cevap
 * vermemiş; en acil iş listesi budur.
 */
export const INBOX_VIEWS = Object.freeze(['OPEN', 'WAITING', 'MINE', 'UNASSIGNED', 'CLOSED', 'ALL']);

export const INBOX_VIEW_LABELS = Object.freeze({
  OPEN: 'Açık',
  WAITING: 'Cevap bekleyen',
  MINE: 'Bana atanan',
  UNASSIGNED: 'Atanmamış',
  CLOSED: 'Kapalı',
  ALL: 'Tümü',
});

/** Bir mesajın en uzun hâli — WhatsApp sınırının (4096) biraz altı. */
export const MAX_MESSAGE_LENGTH = 4000;

/** Konuşma geçmişinde bir seferde yüklenen mesaj. */
export const MESSAGE_PAGE_SIZE = 30;

/** Gelen kutusunda bir seferde yüklenen konuşma. */
export const INBOX_PAGE_SIZE = 30;

/** Liste özetinde gösterilen son mesaj uzunluğu. */
export const MESSAGE_PREVIEW_LENGTH = 160;

/**
 * Misafir bu kadar dakikadır cevap bekliyorsa konuşma kırmızıya döner.
 * Otelcilikte mesajlaşma kanallarında beklenen ilk cevap süresi dakikalarla ölçülür.
 */
export const REPLY_WAIT_WARNING_MINUTES = 10;

/*
 * ─────────────── Misafir istekleri (modül 7) ───────────────
 */

export const GUEST_REQUEST_CATEGORIES = Object.freeze([
  'HOUSEKEEPING',
  'AMENITY',
  'MAINTENANCE',
  'ROOM_SERVICE',
  'WAKE_UP',
  'TRANSPORT',
  'INFORMATION',
  'COMPLAINT',
  'OTHER',
]);

export const GUEST_REQUEST_CATEGORY_LABELS = Object.freeze({
  HOUSEKEEPING: 'Temizlik',
  AMENITY: 'Havlu / malzeme',
  MAINTENANCE: 'Arıza',
  ROOM_SERVICE: 'Oda servisi',
  WAKE_UP: 'Uyandırma',
  TRANSPORT: 'Transfer / taksi',
  INFORMATION: 'Bilgi',
  COMPLAINT: 'Şikâyet',
  OTHER: 'Diğer',
});

/**
 * Kategoriye göre varsayılan öncelik: şikâyet ve arıza misafiri bekletmez,
 * bilgi talebi bekleyebilir. Personel her zaman değiştirebilir.
 */
export const GUEST_REQUEST_DEFAULT_PRIORITY = Object.freeze({
  HOUSEKEEPING: 'NORMAL',
  AMENITY: 'NORMAL',
  MAINTENANCE: 'HIGH',
  ROOM_SERVICE: 'HIGH',
  WAKE_UP: 'HIGH',
  TRANSPORT: 'NORMAL',
  INFORMATION: 'LOW',
  COMPLAINT: 'URGENT',
  OTHER: 'NORMAL',
});

export const GUEST_REQUEST_PRIORITIES = Object.freeze(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const GUEST_REQUEST_PRIORITY_LABELS = Object.freeze({
  LOW: 'Düşük',
  NORMAL: 'Normal',
  HIGH: 'Yüksek',
  URGENT: 'Acil',
});

/** Önceliğe göre hizmet süresi hedefi (dakika). */
export const GUEST_REQUEST_SLA_MINUTES = Object.freeze({
  LOW: 240,
  NORMAL: 60,
  HIGH: 30,
  URGENT: 15,
});

export const GUEST_REQUEST_STATUSES = Object.freeze(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']);

export const GUEST_REQUEST_STATUS_LABELS = Object.freeze({
  OPEN: 'Bekliyor',
  IN_PROGRESS: 'İlgileniliyor',
  DONE: 'Tamamlandı',
  CANCELLED: 'İptal',
});

/** Hâlâ iş bekleyen durumlar. */
export const GUEST_REQUEST_ACTIVE_STATUSES = Object.freeze(['OPEN', 'IN_PROGRESS']);

export const GUEST_REQUEST_SOURCES = Object.freeze(['CONVERSATION', 'PHONE', 'FRONT_DESK', 'STAFF', 'AI']);

export const GUEST_REQUEST_SOURCE_LABELS = Object.freeze({
  CONVERSATION: 'Mesaj',
  PHONE: 'Telefon',
  FRONT_DESK: 'Resepsiyon',
  STAFF: 'Personel',
  AI: 'AI asistanı',
});

/** Personelin elle açabileceği kaynaklar (AI ve mesaj kaynağı sistem tarafından yazılır). */
export const GUEST_REQUEST_MANUAL_SOURCES = Object.freeze(['PHONE', 'FRONT_DESK', 'STAFF']);

/** İstek listesi görünümleri. */
export const GUEST_REQUEST_VIEWS = Object.freeze(['ACTIVE', 'OVERDUE', 'MINE', 'DONE', 'CANCELLED', 'ALL']);

export const GUEST_REQUEST_VIEW_LABELS = Object.freeze({
  ACTIVE: 'Açık',
  OVERDUE: 'Gecikmiş',
  MINE: 'Bana atanan',
  DONE: 'Tamamlanan',
  CANCELLED: 'İptal edilen',
  ALL: 'Tümü',
});

/** Otel kurulurken varsayılan telefon ülke kodu (Türkiye). */
export const DEFAULT_PHONE_COUNTRY_CODE = '90';

/** İstek metinlerinin üst sınırları (form alanları ve sözleşme aynı değeri kullanır). */
export const MAX_REQUEST_TITLE_LENGTH = 120;
export const MAX_REQUEST_DESCRIPTION_LENGTH = 1000;
export const MAX_REQUEST_NOTE_LENGTH = 500;

/** Kalan süresi bu kadar dakikanın altına inen açık istek "süresi yaklaşıyor" sayılır. */
export const GUEST_REQUEST_DUE_SOON_MINUTES = 15;

/** Uyandırma gibi zamanlı isteklerin en fazla ne kadar ileriye kurulabileceği (gün). */
export const MAX_REQUEST_SCHEDULE_DAYS = 30;
