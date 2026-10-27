import { TIME_PATTERN, expectedUpdatedAt, isoDayField, paginationQuerySchema } from './fields.js';
import { looksLikeCardNumber } from './front-desk.js';
import { z } from './locale.js';
import { PAYMENT_REFERENCE_LABELS, PAYMENT_REFERENCE_MAX } from './payments.js';
import { MAX_COVERS, MAX_POS_LINE_QUANTITY, MAX_POS_REASON_LENGTH, MAX_POS_REPORT_DAYS, MIN_POS_REASON_LENGTH, POS_PAYMENT_METHODS } from './pos.js';
import { moneyInputField } from './reservations.js';

/**
 * Oda servisi (modül 41) sözleşmesi.
 *
 * - **Satış noktası türü** `ROOM_SERVICE`: masasızdır, odaya yazmaya açıktır; siparişleri teslim panosundadır.
 * - **Sipariş** üç kaynaktan gelir: personel (telefon), misafirin QR bağlantısı (kabul bekler) ve misafir isteği
 *   (modül 7, "siparişe çevir"; sipariş teslim edilince istek tamamlanır).
 * - **Zaman:** hemen ya da ileri saatli (kahvaltı kartı). İleri saatli sipariş teslimden hazırlık payı kadar önce
 *   mutfağa düşer; teslim hedefi istenen an ya da mutfağa düşüş + hedef süredir.
 * - **Akış:** mutfakta → hazırlanıyor → hazır → yolda → teslim. Teslimde kapıda nakit / kart alınabilir; kalan
 *   odaya yazılır (`fnb.order.charged` → folyo). Teslimden sonra tepsi toplanana kadar takipte kalır.
 * - **Saat** formda otelin duvar saatidir ("2026-10-26T07:30"); sunucu otelin saat dilimiyle çevirir (tarayıcının
 *   saat dilimi yanlışsa kahvaltı bir saat kaymasın).
 */

/* ─────────────── Sabitler ─────────────── */

/** Prisma `RoomServiceSource` ile birebir. */
export const ROOM_SERVICE_SOURCES = Object.freeze(['STAFF', 'GUEST', 'REQUEST']);
export const ROOM_SERVICE_SOURCE_LABELS = Object.freeze({ STAFF: 'Personel', GUEST: 'Misafir (QR)', REQUEST: 'Misafir isteği' });

/** Prisma `RoomServiceStatus` ile birebir. */
export const ROOM_SERVICE_STATUSES = Object.freeze(['REQUESTED', 'SCHEDULED', 'RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED', 'REJECTED']);
export const ROOM_SERVICE_STATUS_LABELS = Object.freeze({
  REQUESTED: 'Onay bekliyor',
  SCHEDULED: 'Planlandı',
  RECEIVED: 'Mutfakta',
  PREPARING: 'Hazırlanıyor',
  READY: 'Hazır',
  ON_THE_WAY: 'Yolda',
  DELIVERED: 'Teslim edildi',
  CANCELLED: 'İptal',
  REJECTED: 'Reddedildi',
});
/** Mutfağa düşmüş, teslim edilmemiş (adisyonu açık) durumlar. */
export const ROOM_SERVICE_KITCHEN_STATUSES = Object.freeze(['RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY']);
/** Bitmemiş bütün durumlar (pano, misafirin açık siparişleri, konaklama bitince uyarı). */
export const ROOM_SERVICE_ACTIVE_STATUSES = Object.freeze(['REQUESTED', 'SCHEDULED', ...ROOM_SERVICE_KITCHEN_STATUSES]);
export const ROOM_SERVICE_FINAL_STATUSES = Object.freeze(['DELIVERED', 'CANCELLED', 'REJECTED']);

/** Geçmiş süzgeci: durum grupları. */
export const ROOM_SERVICE_LIST_STATES = Object.freeze(['ACTIVE', 'DELIVERED', 'CANCELLED']);
export const ROOM_SERVICE_LIST_STATE_LABELS = Object.freeze({ ACTIVE: 'Açık', DELIVERED: 'Teslim edildi', CANCELLED: 'İptal / ret' });

/** Bir siparişte en fazla kalem (oda servisi tepsisi; restoranın tur sınırından küçük). */
export const MAX_ROOM_SERVICE_LINES = 30;
/** Misafirin QR siparişinde en fazla kalem. */
export const MAX_GUEST_ORDER_LINES = 15;
/** Bir konaklamanın aynı anda en fazla açık misafir (QR) siparişi: bağlantı ele geçse de mutfak boğulmaz. */
export const MAX_GUEST_ACTIVE_ORDERS = 3;
/** İleri saatli sipariş en fazla bu kadar gün sonrasına verilir. */
export const MAX_ROOM_SERVICE_SCHEDULE_DAYS = 3;
/** İstenen teslim en az bu kadar dakika sonra olur (daha yakını "hemen"dir). */
export const MIN_ROOM_SERVICE_LEAD_MINUTES = 10;
/** Misafir (QR) siparişi bu kadar dakika kabul edilmezse şef garsona uyarı. */
export const GUEST_ORDER_ALERT_MINUTES = 5;
/**
 * Kabul edilmeyen misafir siparişi teslim hedefini bu kadar dakika aşınca kendiliğinden reddedilir: misafir "onay
 * bekliyor"da günlerce kalmaz, sayfasında net cevap görür (sebep: zamanında kabul edilemedi; oda servisini arayın).
 */
export const GUEST_ORDER_EXPIRY_MINUTES = 30;
/** Süre aşımıyla reddedilen misafir siparişinin misafire görünen sebebi. */
export const GUEST_ORDER_EXPIRED_REASON = 'Zamanında kabul edilemedi; lütfen oda servisini arayın.';
/** Hazırlık listesinde teslim saatlerinin gruplandığı aralık (dakika). */
export const PREP_SLOT_MINUTES = 15;
/** Hazırlık listesinde bir günde en fazla sipariş (kahvaltı kartı yoğunluğu; aşarsa liste kesildiği söylenir). */
export const MAX_PREP_LIST_ORDERS = 1500;
/** Panoda bir sütunda en fazla kart (sayısı ayrıca döner). */
export const MAX_BOARD_COLUMN = 200;
/** Toplanacak tepsi listesinde en fazla satır (sayısı ayrıca döner). */
export const MAX_TRAY_LIST = 300;
/**
 * Tepsi takibinin penceresi (saat): kat hizmetleri odayı her gün temizler; teslimden bu kadar sonra işaretlenmemiş tepsi
 * oda temizliğiyle toplanmış sayılır — liste, sayaç ve uyarı yalnızca bu penceredekilere bakar (liste sonsuza büyümez).
 * Rapordaki "toplanmamış" sayısı tarihsel kalır. Politikadaki tepsi uyarısı bu pencerenin içinde olmalı (en fazla 24 saat).
 */
export const TRAY_TRACKING_HOURS = 24;
/** Tek seferde "toplandı" işaretlenen en fazla tepsi. */
export const MAX_TRAY_BATCH = 50;
/** Teslimde en fazla kapı ödemesi (nakit + kart bölünmüş). */
export const MAX_DOOR_PAYMENTS = 4;
export const MAX_ROOM_SERVICE_NOTE_LENGTH = 300;
/** Misafir sipariş sayfasının yolu (modül 53; QR bu adrese gider). */
export const ROOM_SERVICE_GUEST_PATH = '/misafir/oda-servisi';
/** QR belirteci: bağlantı kimliği + imza (base64url, 43 karakter). */
export const ROOM_SERVICE_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;

const MINUTE_MS = 60_000;

/* ─────────────── Kurallar (saf; sunucu ve ekran aynı kuralı kullanır) ─────────────── */

/**
 * Elle geçişler: mutfak adımları atlanabilir (hazırlanmadan "hazır", hazırdan beklemeden "yolda"); yoldaki sipariş
 * misafir odada yoksa "hazır"a geri alınır. Kabul, ret, mutfağa gönderme, teslim ve iptal kendi uçlarındadır.
 */
const MANUAL_TRANSITIONS = Object.freeze({
  RECEIVED: Object.freeze(['PREPARING', 'READY', 'ON_THE_WAY']),
  PREPARING: Object.freeze(['READY', 'ON_THE_WAY']),
  READY: Object.freeze(['ON_THE_WAY']),
  ON_THE_WAY: Object.freeze(['READY']),
});

/**
 * Durum ilerletme kuralı. @param {string} from @param {string} to
 * @returns {string | null} izin yoksa sebebi
 */
export function roomServiceTransitionError(from, to) {
  if (!ROOM_SERVICE_STATUSES.includes(to)) return 'Geçersiz durum';
  if (from === to) return `Sipariş zaten "${ROOM_SERVICE_STATUS_LABELS[to]}"`;
  if (ROOM_SERVICE_FINAL_STATUSES.includes(from)) return `Sipariş ${ROOM_SERVICE_STATUS_LABELS[from].toLocaleLowerCase('tr-TR')}; değiştirilemez`;
  if (from === 'REQUESTED') return 'Misafir siparişi önce kabul edilmeli';
  if (from === 'SCHEDULED') return 'Planlı sipariş önce mutfağa gönderilmeli';
  if (!(MANUAL_TRANSITIONS[from] ?? []).includes(to)) return `"${ROOM_SERVICE_STATUS_LABELS[from]}" → "${ROOM_SERVICE_STATUS_LABELS[to]}" geçişi yapılamaz`;
  return null;
}

/**
 * Mutfağın başladığı (iptalde kalemlerin zayi sayıldığı ve şef garson yetkisinin gerektiği) durumlar.
 * @param {string} status
 */
export const kitchenStarted = (status) => ['PREPARING', 'READY', 'ON_THE_WAY'].includes(status);

/**
 * Siparişin zamanlaması: hemen (mutfağa şimdi düşer; hedef = şimdi + hedef süre) ya da ileri saatli (teslimden
 * hazırlık payı kadar önce düşer; o an geçmişse hemen düşer; hedef = istenen an).
 *
 * @param {{ now: Date, deliverAt: Date | null, prepLeadMinutes: number, deliveryTargetMinutes: number }} input
 * @returns {{ status: 'SCHEDULED' | 'RECEIVED', releaseAt: Date | null, dueAt: Date }}
 */
export function roomServiceSchedule({ now, deliverAt, prepLeadMinutes, deliveryTargetMinutes }) {
  if (!deliverAt) return { status: 'RECEIVED', releaseAt: null, dueAt: new Date(now.getTime() + deliveryTargetMinutes * MINUTE_MS) };
  const releaseAt = new Date(deliverAt.getTime() - prepLeadMinutes * MINUTE_MS);
  if (releaseAt.getTime() <= now.getTime()) return { status: 'RECEIVED', releaseAt: null, dueAt: new Date(deliverAt) };
  return { status: 'SCHEDULED', releaseAt, dueAt: new Date(deliverAt) };
}

/**
 * İstenen teslim anının kuralı: en az `MIN_ROOM_SERVICE_LEAD_MINUTES` sonra, en fazla
 * `MAX_ROOM_SERVICE_SCHEDULE_DAYS` gün içinde.
 * @param {Date} deliverAt @param {Date} now
 * @returns {string | null}
 */
export function deliverAtError(deliverAt, now) {
  if (deliverAt.getTime() < now.getTime() + MIN_ROOM_SERVICE_LEAD_MINUTES * MINUTE_MS) return `Teslim saati en az ${MIN_ROOM_SERVICE_LEAD_MINUTES} dakika sonrası olmalı (daha yakını için "hemen" seçin)`;
  if (deliverAt.getTime() > now.getTime() + MAX_ROOM_SERVICE_SCHEDULE_DAYS * 24 * 60 * MINUTE_MS) return `Teslim saati en fazla ${MAX_ROOM_SERVICE_SCHEDULE_DAYS} gün sonrası olabilir`;
  return null;
}

/**
 * Teslim edilmiş siparişin süreleri (dakika, yuvarlanmış): mutfakta geçen (düşüş → hazır), bekleme (hazır → yola
 * çıkış), yol (yola çıkış → teslim), toplam (düşüş → teslim) ve zamanında mı (teslim ≤ hedef). Atlanan adımın
 * süresi boştur.
 *
 * @param {{ receivedAt: Date | null, readyAt: Date | null, dispatchedAt: Date | null, deliveredAt: Date | null, dueAt: Date }} order
 */
export function roomServiceDurations(order) {
  const minutes = (from, to) => (from && to ? Math.max(0, Math.round((to.getTime() - from.getTime()) / MINUTE_MS)) : null);
  return {
    kitchen: minutes(order.receivedAt, order.readyAt),
    waiting: minutes(order.readyAt, order.dispatchedAt),
    transit: minutes(order.dispatchedAt, order.deliveredAt),
    total: minutes(order.receivedAt, order.deliveredAt),
    onTime: order.deliveredAt ? order.deliveredAt.getTime() <= order.dueAt.getTime() : null,
  };
}

/**
 * Tepsi hâlâ takipte mi: teslim edilmiş, tepsi bırakılmış, işaretlenmemiş ve takip penceresinin içinde.
 * @param {{ deliveredAt: Date | null, trayExpected: boolean, trayCollectedAt: Date | null }} order @param {Date} now
 */
export function trayPending(order, now) {
  if (!order.deliveredAt || !order.trayExpected || order.trayCollectedAt) return false;
  return now.getTime() - order.deliveredAt.getTime() < TRAY_TRACKING_HOURS * 60 * MINUTE_MS;
}

/** Takip penceresinin başı: bundan önce teslim edilenin tepsisi takipte değil. @param {Date} now */
export const trayTrackingSince = (now) => new Date(now.getTime() - TRAY_TRACKING_HOURS * 60 * MINUTE_MS);

/**
 * Takipteki tepsi uyarı süresini aştı mı (teslimden `alertMinutes` sonra).
 * @param {{ deliveredAt: Date | null, trayExpected: boolean, trayCollectedAt: Date | null }} order @param {Date} now @param {number} alertMinutes
 */
export function trayOverdue(order, now, alertMinutes) {
  return trayPending(order, now) && now.getTime() - order.deliveredAt.getTime() >= alertMinutes * MINUTE_MS;
}

/* ─────────────── Şema parçaları ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' })
    .transform((value) => value || null)
    .nullish();

const intField = (label, min, max) =>
  z.coerce
    .number({ error: `${label} sayı olmalı` })
    .int(`${label} tam sayı olmalı`)
    .min(min, `${label} en az ${min}`)
    .max(max, `${label} en fazla ${max.toLocaleString('tr-TR')}`);

const reasonField = (label) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(MIN_POS_REASON_LENGTH, `${label} en az ${MIN_POS_REASON_LENGTH} karakter`)
    .max(MAX_POS_REASON_LENGTH, `${label} en fazla ${MAX_POS_REASON_LENGTH} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' });

/**
 * Otelin duvar saati "2026-10-26T07:30" (saat dilimsiz; sunucu otelin diliminde yorumlar). Takvimde olmayan gün
 * ve saat reddedilir.
 */
export const wallTimeField = z
  .string({ error: 'Teslim saatini seçin' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Teslim saati geçersiz')
  .refine((value) => isoDayField.safeParse(value.slice(0, 10)).success && TIME_PATTERN.test(value.slice(11)), { message: 'Teslim saati geçersiz' });

const line = (maxQuantity) =>
  z.object({
    menuItemId: uuid('Ürün seçin'),
    quantity: intField('Adet', 1, maxQuantity),
    note: optionalText(200, 'Not'),
  });

const lines = (max) =>
  z
    .array(line(MAX_POS_LINE_QUANTITY), { error: 'Kalemler geçersiz' })
    .min(1, 'En az bir ürün seçin')
    .max(max, `Bir siparişte en fazla ${max} kalem`)
    .superRefine((value, ctx) => {
      // Aynı ürün aynı notla iki satır olmasın (ekran adedi artırır); farklı notla ayrı satır olabilir ("az pişmiş").
      const seen = new Set();
      value.forEach((entry, index) => {
        const key = `${entry.menuItemId}|${entry.note ?? ''}`;
        if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index, 'menuItemId'], message: 'Aynı ürün iki kez; adedi artırın' });
        seen.add(key);
      });
    });

/* ─────────────── Personel uçları ─────────────── */

/** Personelin girdiği sipariş (telefon, kat) ya da misafir isteğinden çevrilen. */
export const createRoomServiceOrderSchema = z.object({
  /** Çift dokunuşta ikinci sipariş açılmasın. */
  requestId: uuid('Geçersiz istek'),
  outletId: uuid('Oda servisi noktasını seçin'),
  reservationId: uuid('Oda / misafir seçin'),
  lines: lines(MAX_ROOM_SERVICE_LINES),
  note: optionalText(MAX_ROOM_SERVICE_NOTE_LENGTH, 'Not'),
  covers: intField('Kişi', 1, MAX_COVERS).default(1),
  /** Boş = hemen. */
  deliverAt: wallTimeField.nullish(),
  trayExpected: z.boolean().default(true),
  /** Misafir isteğinden (modül 7) çevriliyorsa. */
  guestRequestId: uuid('Geçersiz istek kaydı').nullish(),
});

export const roomServiceParamSchema = z.object({ orderId: uuid('Geçersiz sipariş') });
export const roomServiceVersionSchema = z.object({ expectedUpdatedAt });

/** Misafir siparişini kabul: kalemler misafirle konuşularak değiştirilebilir (verilmezse olduğu gibi). */
export const acceptRoomServiceOrderSchema = z.object({
  expectedUpdatedAt,
  lines: lines(MAX_ROOM_SERVICE_LINES).optional(),
});
export const rejectRoomServiceOrderSchema = z.object({ expectedUpdatedAt, reason: reasonField('Ret sebebi') });

/** Mutfak / servis adımı (hazırlanıyor, hazır, yolda; yoldan hazıra geri). */
export const advanceRoomServiceOrderSchema = z.object({
  expectedUpdatedAt,
  status: z.enum(['PREPARING', 'READY', 'ON_THE_WAY'], { error: 'Geçersiz adım' }),
  /** "Yolda": götüren (boşsa işlemi yapan). */
  runnerEmail: z.string().trim().toLowerCase().email('Götüreni seçin').nullish(),
});

const referenceField = z
  .string()
  .trim()
  .max(PAYMENT_REFERENCE_MAX, `Referans en fazla ${PAYMENT_REFERENCE_MAX} karakter`)
  .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz; slip ya da provizyon numarasını yazın' })
  .transform((value) => value || null)
  .nullish();

const doorPayment = z
  .object({
    method: z.enum(POS_PAYMENT_METHODS, { error: 'Ödeme yöntemi seçin' }),
    amount: moneyInputField.refine((value) => Number(value) > 0, { message: "Tutar 0'dan büyük olmalı" }),
    reference: referenceField,
  })
  .superRefine((value, ctx) => {
    if (value.method === 'CARD' && !value.reference) ctx.addIssue({ code: 'custom', path: ['reference'], message: `${PAYMENT_REFERENCE_LABELS.CARD} zorunlu` });
  });

/**
 * Teslim: kapıda alınan ödemeler (nakit / kart, bölünebilir) ve kalanın odaya yazılması. Kalan varsa ve odaya
 * yazılmayacaksa teslim yapılmaz (oda servisinde açık hesap kalmaz).
 */
export const deliverRoomServiceOrderSchema = z.object({
  requestId: uuid('Geçersiz istek'),
  expectedUpdatedAt,
  payments: z.array(doorPayment, { error: 'Ödemeler geçersiz' }).max(MAX_DOOR_PAYMENTS, `En fazla ${MAX_DOOR_PAYMENTS} ödeme`).default([]),
  chargeRemainder: z.boolean().default(true),
});

/** İptal: mutfak başladıysa kalemler zayi sayılır (`waste`; şef garson). */
export const cancelRoomServiceOrderSchema = z.object({
  expectedUpdatedAt,
  reason: reasonField('İptal sebebi'),
  waste: z.boolean().default(true),
});

export const collectTraysSchema = z.object({
  orderIds: z
    .array(uuid('Geçersiz sipariş'), { error: 'Sipariş seçin' })
    .min(1, 'En az bir tepsi seçin')
    .max(MAX_TRAY_BATCH, `Tek seferde en fazla ${MAX_TRAY_BATCH} tepsi`)
    .transform((ids) => [...new Set(ids)]),
});

export const roomServiceBoardQuerySchema = z.object({ outletId: uuid('Geçersiz satış noktası').optional() });

/** Geçmiş: durum grubu, kaynak, satış noktası, sipariş günü aralığı (otelin günü), arama (no, oda, misafir). */
export const roomServiceListQuerySchema = paginationQuerySchema
  .extend({
    state: z.enum(ROOM_SERVICE_LIST_STATES, { error: 'Geçersiz durum' }).optional(),
    source: z.enum(ROOM_SERVICE_SOURCES, { error: 'Geçersiz kaynak' }).optional(),
    outletId: uuid('Geçersiz satış noktası').optional(),
    reservationId: uuid('Geçersiz konaklama').optional(),
    from: isoDayField.optional(),
    to: isoDayField.optional(),
    search: z.string().trim().max(60, 'Arama en fazla 60 karakter').optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  });

/** Hazırlık listesi: teslim günü (otelin günü; verilmezse bugün) ve satış noktası. */
export const roomServicePrepQuerySchema = z.object({ date: isoDayField.optional(), outletId: uuid('Geçersiz satış noktası').optional() });

/** Oda servisi raporu: sipariş günü aralığı (iki uç dahil, en fazla 31 gün; verilmezse bugün). */
export const roomServiceReportQuerySchema = z
  .object({ from: isoDayField.optional(), to: isoDayField.optional(), outletId: uuid('Geçersiz satış noktası').optional() })
  .superRefine((value, ctx) => {
    if (!value.from !== !value.to) {
      ctx.addIssue({ code: 'custom', path: [value.from ? 'to' : 'from'], message: 'Başlangıç ve bitişi birlikte seçin' });
      return;
    }
    if (!value.from) return;
    const days = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    else if (days > MAX_POS_REPORT_DAYS) ctx.addIssue({ code: 'custom', path: ['to'], message: `Bir raporda en fazla ${MAX_POS_REPORT_DAYS} gün seçilir` });
  });

/** Konaklamanın QR bağlantısı (oku / oluştur-yenile / iptal). */
export const roomServiceLinkParamSchema = z.object({ reservationId: uuid('Geçersiz konaklama') });

/* ─────────────── Misafir (QR) uçları — sayfası modül 53 ─────────────── */

export const publicRoomServiceTokenSchema = z.object({ token: z.string().regex(ROOM_SERVICE_TOKEN_PATTERN, 'Bağlantı geçersiz') });
export const publicRoomServiceOrderParamSchema = z.object({
  token: z.string().regex(ROOM_SERVICE_TOKEN_PATTERN, 'Bağlantı geçersiz'),
  orderId: uuid('Geçersiz sipariş'),
});

/** Misafirin QR siparişi: personel kabul edince mutfağa düşer. */
export const publicRoomServiceOrderSchema = z.object({
  requestId: uuid('Geçersiz istek'),
  outletId: uuid('Geçersiz satış noktası'),
  lines: lines(MAX_GUEST_ORDER_LINES),
  note: optionalText(MAX_ROOM_SERVICE_NOTE_LENGTH, 'Not'),
  covers: intField('Kişi', 1, 20).default(1),
  deliverAt: wallTimeField.nullish(),
});
