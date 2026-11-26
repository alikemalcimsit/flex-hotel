import { z } from './locale.js';
import { BOARD_TYPES, MAX_STAY_NIGHTS } from './constants.js';
import { EMAIL_PATTERN, expectedUpdatedAt, isoDayField } from './fields.js';
import { couponCodeField } from './promotions.js';
import { MAX_CANCEL_REASON_LENGTH, MAX_PARTY_ADULTS, MAX_PARTY_CHILDREN, MAX_RESERVATION_NOTES_LENGTH } from './reservations.js';

/**
 * Açık API ve webhook sözleşmeleri (modül 61).
 *
 * ### Kavramlar
 *
 * - **Uygulama** (`ApiClient`): otele bağlanan dış sistem (CRM, kurumsal seyahat aracı, acente yazılımı). Hız sınırı,
 *   API'den açılan rezervasyonun durumu ve kapanma uygulamadadır; anahtarlar ve webhook abonelikleri ona bağlıdır.
 * - **Anahtar** (`ApiKey`): `fhk_<önek>_<sır>`. Kapsamları (scope) ayrı ayrı açılır; yalnız özeti saklanır.
 * - **Webhook aboneliği**: seçilen olaylar uygulamanın HTTPS adresine imzalı gider; başarısızsa artan beklemeyle
 *   yeniden denenir.
 *
 * Gövdeler **incedir**: kimlikler, durum, tarih, tutar; misafirin adı / iletişimi / kimliği gitmez. Ayrıntıyı isteyen
 * API'den çeker (anahtarının kapsamı varsa). Yanlış adrese giden olay kişisel veri sızdırmaz (KVKK).
 *
 * Bu dosya tarayıcıda da çalışır (panel formları): `node:crypto` / `node:net` isteyen imza ve adres çözümü sunucuda
 * (`backend/src/lib/webhook-signature.js`, `lib/ssrf.js`).
 */

/* ─────────────── Genel ─────────────── */

/** Açık API'nin yol sürümü (`/v1`). Gövde biçimi değişirse yeni sürüm açılır, eskisi bir süre yaşar. */
export const PUBLIC_API_VERSION = 'v1';
/** Webhook zarfının sürümü (`apiVersion`): alıcı biçimi bununla tanır. */
export const WEBHOOK_API_VERSION = '2026-11-26';

/* ─────────────── Kapsamlar ─────────────── */

export const API_SCOPES = Object.freeze(['availability:read', 'reservations:read', 'reservations:write', 'guests:read']);

export const API_SCOPE_LABELS = Object.freeze({
  'availability:read': 'Müsaitlik ve fiyat',
  'reservations:read': 'Rezervasyonları okuma',
  'reservations:write': 'Rezervasyon açma / değiştirme / iptal',
  'guests:read': 'Misafir kartlarını okuma (ad, iletişim)',
});

export const API_SCOPE_HINTS = Object.freeze({
  'availability:read': 'Oda tipleri, tarih aralığında boş oda sayısı ve fiyat.',
  'reservations:read': 'Rezervasyon listesi ve ayrıntısı; misafirin yalnız adı. Değişenleri çekmek (senkron) için.',
  'reservations:write':
    'Paneldeki kurallarla (fiyat motoru, müsaitlik, iptal cezası) rezervasyon açar; yalnız bu uygulamanın açtıklarını değiştirir / iptal eder.',
  'guests:read': 'Misafirin adı, e-postası, telefonu, uyruğu. Kimlik belgesi bilgisi API ile hiç verilmez.',
});

/** Bir kapsam başka kapsamları gerektirir: açtığı rezervasyonu okuyamayan, fiyatını göremeyen yazma anlamsız. */
export const API_SCOPE_REQUIRES = Object.freeze({
  'reservations:write': Object.freeze(['reservations:read', 'availability:read']),
});

/**
 * Seçilen kapsamların eksik gereksinimleri.
 * @param {readonly string[]} scopes
 * @returns {string[]}
 */
export function missingScopeRequirements(scopes) {
  const set = new Set(scopes);
  const missing = new Set();
  for (const scope of scopes) for (const need of API_SCOPE_REQUIRES[scope] ?? []) if (!set.has(need)) missing.add(need);
  return [...missing];
}

/* ─────────────── Uygulama ve anahtar ─────────────── */

export const API_CLIENT_STATUSES = Object.freeze(['ACTIVE', 'DISABLED']);
export const API_CLIENT_STATUS_LABELS = Object.freeze({ ACTIVE: 'Açık', DISABLED: 'Kapalı' });

/** API'den açılan rezervasyonun durumu (uygulama ayarı). */
export const API_BOOKING_STATUSES = Object.freeze(['PENDING', 'CONFIRMED']);
export const API_BOOKING_STATUS_LABELS = Object.freeze({
  PENDING: 'Opsiyonlu — resepsiyon kesinleştirir',
  CONFIRMED: 'Kesin — doğrudan onaylı açılır',
});

/** Uygulamanın dakikalık istek sınırı (bütün anahtarlarının toplamı). */
export const API_RATE_LIMIT_MIN = 10;
export const API_RATE_LIMIT_MAX = 3000;
export const API_RATE_LIMIT_DEFAULT = 120;
/** Anahtarsız / geçersiz anahtarlı istekte IP başına dakikalık sınır (anahtar tahmini denemesi). */
export const API_UNAUTHENTICATED_LIMIT = 60;

export const MAX_API_CLIENTS = 50;
export const MAX_ACTIVE_API_KEYS_PER_CLIENT = 10;
export const MAX_WEBHOOKS_PER_CLIENT = 10;
export const MAX_API_CLIENT_NAME_LENGTH = 80;
export const MAX_API_CLIENT_DESCRIPTION_LENGTH = 500;
export const MAX_API_KEY_NAME_LENGTH = 80;

/** Anahtar süresi seçenekleri (gün); boş = süresiz. */
export const API_KEY_EXPIRY_DAYS = Object.freeze([30, 90, 180, 365]);

/** Anahtar biçimi: `fhk_` + 12 karakter önek (base32 küçük harf) + `_` + 43 karakter sır (32 bayt base64url). */
export const API_KEY_PREFIX_LENGTH = 12;
export const API_KEY_SECRET_LENGTH = 43;
const API_KEY_PATTERN = /^fhk_([a-z2-7]{12})_([A-Za-z0-9_-]{43})$/;

/**
 * Anahtar metnini parçalar (biçim yanlışsa `null`; veritabanına hiç gidilmez).
 * @param {unknown} token
 * @returns {{ prefix: string, secret: string } | null}
 */
export function parseApiKey(token) {
  if (typeof token !== 'string') return null;
  const match = API_KEY_PATTERN.exec(token.trim());
  return match ? { prefix: match[1], secret: match[2] } : null;
}

/** Ekranda anahtarın tanınır hâli (sır yok). @param {string} prefix */
export const maskApiKey = (prefix) => `fhk_${prefix}_…`;

/* ─────────────── Webhook olayları ─────────────── */

/**
 * Dışarıya açılan olaylar. Ad, iç olay adından bağımsız ve kalıcıdır (iç ad değişse de alıcı kırılmaz).
 * `source`: iç olay(lar); `pick`: gövdeye giren alanlar (iç gövdeden, kişisel veri olmadan).
 */
const day = (value) => (typeof value === 'string' ? value.slice(0, 10) : value instanceof Date ? value.toISOString().slice(0, 10) : null);
const stay = (payload) => ({ reservationId: payload.reservationId, roomTypeId: payload.roomTypeId, checkIn: day(payload.checkIn), checkOut: day(payload.checkOut) });

const WEBHOOK_EVENT_DEFINITIONS = Object.freeze([
  {
    type: 'reservation.created',
    group: 'reservations',
    label: 'Rezervasyon açıldı',
    source: 'reservation.created',
    pick: (p) => ({ ...stay(p), roomId: p.roomId ?? null, groupId: p.groupId ?? null, source: p.source ?? null, agencyId: p.agencyId ?? null }),
  },
  {
    type: 'reservation.updated',
    group: 'reservations',
    label: 'Rezervasyon değişti (tarih, oda tipi, kişi, fiyat…)',
    source: 'reservation.updated',
    pick: (p) => ({ ...stay(p), changedFields: Array.isArray(p.changedFields) ? p.changedFields : [] }),
  },
  { type: 'reservation.confirmed', group: 'reservations', label: 'Opsiyonlu rezervasyon kesinleşti', source: 'reservation.confirmed', pick: (p) => ({ reservationId: p.reservationId }) },
  { type: 'reservation.cancelled', group: 'reservations', label: 'Rezervasyon iptal edildi', source: 'reservation.cancelled', pick: stay },
  { type: 'reservation.no_show', group: 'reservations', label: 'Misafir gelmedi', source: 'reservation.no_show', pick: stay },
  { type: 'reservation.reinstated', group: 'reservations', label: 'İptal / gelmedi geri alındı', source: 'reservation.reinstated', pick: stay },
  {
    type: 'stay.checked_in',
    group: 'stays',
    label: 'Giriş yapıldı (check-in)',
    source: 'guest.checked_in',
    pick: (p) => ({ ...stay(p), roomId: p.roomId, guestId: p.guestId }),
  },
  {
    type: 'stay.checked_out',
    group: 'stays',
    label: 'Çıkış yapıldı (check-out)',
    source: 'guest.checked_out',
    pick: (p) => ({ ...stay(p), roomId: p.roomId, guestId: p.guestId, earlyDeparture: Boolean(p.earlyDeparture) }),
  },
  { type: 'stay.check_in_reverted', group: 'stays', label: 'Giriş geri alındı', source: 'guest.check_in_reverted', pick: (p) => ({ ...stay(p), roomId: p.roomId }) },
  { type: 'stay.check_out_reverted', group: 'stays', label: 'Çıkış geri alındı', source: 'guest.check_out_reverted', pick: (p) => ({ ...stay(p), roomId: p.roomId }) },
  { type: 'guest.updated', group: 'guests', label: 'Misafir kartı değişti', source: 'guest.card.updated', pick: (p) => ({ guestId: p.guestId }) },
  { type: 'guest.merged', group: 'guests', label: 'İki misafir kartı birleştirildi', source: 'guest.card.merged', pick: (p) => ({ sourceGuestId: p.sourceId, targetGuestId: p.targetId }) },
  {
    type: 'payment.received',
    group: 'payments',
    label: 'Ödeme alındı',
    source: 'payment.received',
    pick: (p) => ({ paymentId: p.paymentId, folioId: p.folioId, reservationId: p.reservationId, amount: p.amount, currency: p.currency, method: p.method }),
  },
  {
    type: 'payment.refunded',
    group: 'payments',
    label: 'İade yapıldı',
    source: 'payment.refunded',
    pick: (p) => ({ paymentId: p.paymentId, folioId: p.folioId, reservationId: p.reservationId, amount: p.amount, currency: p.currency, method: p.method }),
  },
  {
    type: 'invoice.issued',
    group: 'invoices',
    label: 'Fatura kesildi',
    source: 'invoice.issued',
    pick: (p) => ({
      invoiceId: p.invoiceId,
      number: p.number,
      documentType: p.documentType,
      folioId: p.folioId ?? null,
      total: p.total,
      taxTotal: p.taxTotal,
      currency: p.currency,
      issuedOn: day(p.issuedOn),
    }),
  },
  { type: 'invoice.cancelled', group: 'invoices', label: 'Fatura iptal edildi', source: 'invoice.cancelled', pick: (p) => ({ invoiceId: p.invoiceId, number: p.number, folioId: p.folioId ?? null }) },
  {
    type: 'room.status_changed',
    group: 'rooms',
    label: 'Oda durumu değişti (boş / dolu, temiz / kirli)',
    source: 'room.status.changed',
    pick: (p) => ({ roomId: p.roomId, roomNumber: p.roomNumber, field: p.field, from: p.from, to: p.to }),
  },
]);

export const WEBHOOK_EVENTS = Object.freeze(WEBHOOK_EVENT_DEFINITIONS.map((event) => event.type));
export const WEBHOOK_EVENT_LABELS = Object.freeze(Object.fromEntries(WEBHOOK_EVENT_DEFINITIONS.map((event) => [event.type, event.label])));

export const WEBHOOK_EVENT_GROUPS = Object.freeze(
  [
    { key: 'reservations', label: 'Rezervasyon' },
    { key: 'stays', label: 'Konaklama (giriş / çıkış)' },
    { key: 'guests', label: 'Misafir' },
    { key: 'payments', label: 'Ödeme' },
    { key: 'invoices', label: 'Fatura' },
    { key: 'rooms', label: 'Oda' },
  ].map((group) => Object.freeze({ ...group, events: Object.freeze(WEBHOOK_EVENT_DEFINITIONS.filter((event) => event.group === group.key).map((event) => event.type)) })),
);

/** Elle gönderilen deneme olayı (abonelik ekranındaki "Deneme gönder"); abonelikte seçilmez, her zaman gider. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

/** Dinlenen iç olaylar (sunucunun abone olduğu liste). */
export const WEBHOOK_SOURCE_EVENTS = Object.freeze([...new Set(WEBHOOK_EVENT_DEFINITIONS.map((event) => event.source))]);

const DEFINITIONS_BY_SOURCE = new Map(WEBHOOK_EVENT_DEFINITIONS.map((event) => [event.source, event]));

/**
 * İç olayı dışarıya giden olaya çevirir (gövde ince; tanınmayan olay `null`).
 * @param {string} sourceName iç olay adı
 * @param {Record<string, unknown>} payload iç gövde
 * @returns {{ type: string, data: Record<string, unknown> } | null}
 */
export function toWebhookEvent(sourceName, payload) {
  const definition = DEFINITIONS_BY_SOURCE.get(sourceName);
  if (!definition || !payload) return null;
  return { type: definition.type, data: definition.pick(payload) };
}

/**
 * Alıcıya giden gövde. `id` olayın kimliğidir: aynı olay yeniden gelirse (tekrar deneme, elle yeniden gönderim) aynıdır —
 * alıcı tekrar işlememek için buna bakar.
 * @param {{ eventId: string, type: string, occurredAt: Date | string, hotelId: string, data: Record<string, unknown> }} event
 */
export function buildWebhookEnvelope({ eventId, type, occurredAt, hotelId, data }) {
  return {
    id: eventId,
    type,
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: occurredAt instanceof Date ? occurredAt.toISOString() : String(occurredAt),
    hotelId,
    data,
  };
}

/* ─────────────── Webhook teslimatı ─────────────── */

export const WEBHOOK_STATUSES = Object.freeze(['ACTIVE', 'PAUSED', 'DISABLED']);
export const WEBHOOK_STATUS_LABELS = Object.freeze({
  ACTIVE: 'Açık',
  PAUSED: 'Duraklatıldı',
  DISABLED: 'Hatalar yüzünden kapandı',
});

export const WEBHOOK_DELIVERY_STATUSES = Object.freeze(['PENDING', 'SENDING', 'RETRYING', 'SUCCEEDED', 'FAILED']);
export const WEBHOOK_DELIVERY_STATUS_LABELS = Object.freeze({
  PENDING: 'Sırada',
  SENDING: 'Gönderiliyor',
  RETRYING: 'Yeniden denenecek',
  SUCCEEDED: 'Teslim edildi',
  FAILED: 'Teslim edilemedi',
});

/**
 * Başarısız denemeden sonra bekleme (dakika): 1 dk, 5 dk, 30 dk, 2 sa, 6 sa, 12 sa, 24 sa. Toplam ~45 saatte 8 deneme;
 * gece kapanan / bakımdaki bir alıcı ertesi gün de olayı alır.
 */
export const WEBHOOK_RETRY_DELAYS_MINUTES = Object.freeze([1, 5, 30, 120, 360, 720, 1440]);
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MINUTES.length + 1;
/** Alıcının `Retry-After`'ı bundan uzun beklenmez. */
export const WEBHOOK_MAX_RETRY_AFTER_MINUTES = 1440;
/** Bir denemenin süresi (bağlantı + cevap). */
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Abonelik kendiliğinden kapanır: en az bu kadar art arda başarısız deneme **ve** bu kadar saattir hiç başarı yok. */
export const WEBHOOK_DISABLE_AFTER_FAILURES = 20;
export const WEBHOOK_DISABLE_AFTER_HOURS = 72;
/** Sır yenilenince eski sır bu kadar saat ikinci imza olarak gönderilir (alıcı yeni sırrı yerleştirene kadar). */
export const WEBHOOK_SECRET_GRACE_HOURS = 24;
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;
export const MAX_WEBHOOK_URL_LENGTH = 500;
/** Teslimat kaydında saklanan cevap gövdesi (karakter). */
export const WEBHOOK_RESPONSE_EXCERPT_LENGTH = 1000;

/**
 * Bir sonraki denemeye kadar bekleme. `attempts`: yapılmış deneme sayısı (bu başarısız deneme dahil). Hak bittiyse `null`.
 * Alıcı `Retry-After` verdiyse (429 / 503) çizelgeden uzunsa ona uyulur (üst sınırlı).
 *
 * @param {number} attempts
 * @param {{ retryAfterSeconds?: number | null, jitter?: number }} [options] `jitter` 0..1 (aynı anda düşen alıcılar aynı
 *   saniyede yeniden yüklenmesin; test için sabitlenebilir)
 * @returns {number | null} milisaniye
 */
export function webhookRetryDelayMs(attempts, { retryAfterSeconds = null, jitter = 0 } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts >= WEBHOOK_MAX_ATTEMPTS) return null;
  const base = WEBHOOK_RETRY_DELAYS_MINUTES[attempts - 1] * 60_000;
  const spread = Math.round(base * 0.1 * Math.min(Math.max(jitter, 0), 1));
  const scheduled = base + spread;
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.max(scheduled, Math.min(retryAfterSeconds * 1000, WEBHOOK_MAX_RETRY_AFTER_MINUTES * 60_000));
  }
  return scheduled;
}

/**
 * Abonelik kendiliğinden kapanmalı mı? Tek bir kötü saat (alıcının bakımı) kapatmaz: hem sayı hem süre şartı.
 * @param {{ consecutiveFailures: number, failingSince: Date | null, now: Date }} state
 */
export function shouldDisableWebhook({ consecutiveFailures, failingSince, now }) {
  if (consecutiveFailures < WEBHOOK_DISABLE_AFTER_FAILURES || !failingSince) return false;
  return now.getTime() - failingSince.getTime() >= WEBHOOK_DISABLE_AFTER_HOURS * 3_600_000;
}

/** Adres yazımında yasak ana bilgisayar adları (iç ağ). IP sınıflandırması sunucuda, adres çözülürken de yapılır. */
const BLOCKED_HOST_SUFFIXES = Object.freeze(['localhost', '.localhost', '.local', '.internal', '.lan', '.home.arpa']);

/**
 * IPv4 metni mi; öyleyse özel / ayrılmış aralıkta mı (form ön denetimi; asıl denetim sunucuda çözülen adreste).
 * @param {string} host
 * @returns {boolean | null} IPv4 değilse `null`
 */
function privateIpv4Literal(host) {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;
  const [a, b] = parts.map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/**
 * Webhook adresi kabul edilir mi? Kabulse `null`, değilse kullanıcıya gösterilecek sebep.
 *
 * - Yalnız `https` (veri yolda şifreli; imza sırrı da yolda görünmesin).
 * - Adreste kullanıcı adı / parola olmaz (log'larda açık görünürdü).
 * - İç ağ adı ya da özel IP olmaz. Sunucu gönderim anında adı çözüp çıkan IP'yi de denetler (DNS ile iç ağa
 *   yönlendirme), yönlendirmeyi (3xx) takip etmez.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function webhookUrlProblem(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'Adres zorunlu';
  if (value.length > MAX_WEBHOOK_URL_LENGTH) return `Adres en fazla ${MAX_WEBHOOK_URL_LENGTH} karakter`;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return 'Adres geçersiz (ör. https://ornek.com/webhook)';
  }
  if (url.protocol !== 'https:') return 'Adres https ile başlamalı (veri şifreli gitmeli)';
  if (url.username || url.password) return 'Adreste kullanıcı adı / parola olamaz';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return 'Adres geçersiz';
  if (host.startsWith('[')) {
    const inner = host.slice(1, -1);
    if (inner === '::1' || inner === '::' || /^f[cd]/.test(inner) || /^fe[89ab]/.test(inner) || inner.startsWith('::ffff:')) return 'İç ağ adresine webhook gönderilemez';
    return null;
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix.replace(/^\./, '') || host.endsWith(suffix))) return 'İç ağ adresine webhook gönderilemez';
  const privateLiteral = privateIpv4Literal(host);
  if (privateLiteral === true) return 'İç ağ adresine webhook gönderilemez';
  if (privateLiteral === null && !host.includes('.')) return 'Adres tam alan adı olmalı (ör. api.ornek.com)';
  return null;
}

/* ─────────────── Panel şemaları ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

const clientName = z
  .string({ error: 'Uygulama adı zorunlu' })
  .trim()
  .min(2, 'Uygulama adı en az 2 karakter')
  .max(MAX_API_CLIENT_NAME_LENGTH, `Uygulama adı en fazla ${MAX_API_CLIENT_NAME_LENGTH} karakter`);

const contactEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200, 'E-posta en fazla 200 karakter')
  .refine((value) => value === '' || EMAIL_PATTERN.test(value), { message: 'E-posta geçersiz' })
  .transform((value) => value || null)
  .nullish();

const rateLimit = z.coerce
  .number({ error: 'Hız sınırı sayı olmalı' })
  .int('Hız sınırı tam sayı olmalı')
  .min(API_RATE_LIMIT_MIN, `Hız sınırı en az dakikada ${API_RATE_LIMIT_MIN}`)
  .max(API_RATE_LIMIT_MAX, `Hız sınırı en fazla dakikada ${API_RATE_LIMIT_MAX}`);

export const apiClientCreateSchema = z.object({
  name: clientName,
  description: optionalText(MAX_API_CLIENT_DESCRIPTION_LENGTH, 'Açıklama'),
  contactEmail,
  rateLimitPerMinute: rateLimit.default(API_RATE_LIMIT_DEFAULT),
  bookingStatus: z.enum(API_BOOKING_STATUSES, { error: 'Geçersiz rezervasyon durumu' }).default('PENDING'),
});

export const apiClientUpdateSchema = z.object({
  expectedUpdatedAt,
  name: clientName.optional(),
  description: optionalText(MAX_API_CLIENT_DESCRIPTION_LENGTH, 'Açıklama'),
  contactEmail,
  rateLimitPerMinute: rateLimit.optional(),
  bookingStatus: z.enum(API_BOOKING_STATUSES, { error: 'Geçersiz rezervasyon durumu' }).optional(),
  status: z.enum(API_CLIENT_STATUSES, { error: 'Geçersiz durum' }).optional(),
});

export const apiClientParamSchema = z.object({ clientId: uuid('Geçersiz uygulama') });
export const apiKeyParamSchema = z.object({ clientId: uuid('Geçersiz uygulama'), keyId: uuid('Geçersiz anahtar') });
export const webhookParamSchema = z.object({ clientId: uuid('Geçersiz uygulama'), subscriptionId: uuid('Geçersiz abonelik') });
export const webhookDeliveryParamSchema = z.object({ deliveryId: uuid('Geçersiz teslimat') });

export const apiKeyCreateSchema = z
  .object({
    name: z
      .string({ error: 'Anahtar adı zorunlu' })
      .trim()
      .min(1, 'Anahtar adı zorunlu')
      .max(MAX_API_KEY_NAME_LENGTH, `Anahtar adı en fazla ${MAX_API_KEY_NAME_LENGTH} karakter`),
    scopes: z
      .array(z.enum(API_SCOPES, { error: 'Geçersiz kapsam' }), { error: 'Kapsam seçin' })
      .min(1, 'En az bir kapsam seçin')
      .max(API_SCOPES.length)
      .transform((scopes) => API_SCOPES.filter((scope) => scopes.includes(scope))),
    /** Gün; boş = süresiz. */
    expiresInDays: z
      .union([z.literal(null), z.coerce.number().int()], { error: 'Geçersiz süre' })
      .refine((value) => value === null || API_KEY_EXPIRY_DAYS.includes(value), { message: 'Geçersiz süre' })
      .default(null),
  })
  .superRefine((value, ctx) => {
    const missing = missingScopeRequirements(value.scopes);
    if (missing.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['scopes'], message: `Rezervasyon yazma için şunlar da gerekli: ${missing.map((scope) => API_SCOPE_LABELS[scope]).join(', ')}` });
    }
  });

const webhookUrlField = z
  .string({ error: 'Adres zorunlu' })
  .trim()
  .superRefine((value, ctx) => {
    const problem = webhookUrlProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

const webhookEventsField = z
  .array(z.enum(WEBHOOK_EVENTS, { error: 'Geçersiz olay' }), { error: 'Olay seçin' })
  .min(1, 'En az bir olay seçin')
  .max(WEBHOOK_EVENTS.length)
  .transform((events) => WEBHOOK_EVENTS.filter((event) => events.includes(event)));

export const webhookCreateSchema = z.object({ url: webhookUrlField, events: webhookEventsField });

export const webhookUpdateSchema = z.object({
  expectedUpdatedAt,
  url: webhookUrlField.optional(),
  events: webhookEventsField.optional(),
  /** Duraklat / yeniden aç. Kendiliğinden kapanmış abonelik de buradan açılır (sayaç sıfırlanır). */
  status: z.enum(['ACTIVE', 'PAUSED'], { error: 'Geçersiz durum' }).optional(),
});

export const webhookVersionSchema = z.object({ expectedUpdatedAt });

export const MAX_WEBHOOK_DELIVERY_PAGE = 100;

export const webhookDeliveryListQuerySchema = z.object({
  clientId: uuid('Geçersiz uygulama').optional(),
  subscriptionId: uuid('Geçersiz abonelik').optional(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES, { error: 'Geçersiz durum' }).optional(),
  eventType: z.enum([...WEBHOOK_EVENTS, WEBHOOK_TEST_EVENT], { error: 'Geçersiz olay' }).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_WEBHOOK_DELIVERY_PAGE).default(50),
});

/* ─────────────── Açık API (v1) şemaları ─────────────── */

/** Liste sınırı. */
export const PUBLIC_API_DEFAULT_LIMIT = 50;
export const PUBLIC_API_MAX_LIMIT = 200;

/** `Idempotency-Key`: istemcinin ürettiği tekil değer (UUID önerilir). Aynı anahtarla ikinci istek ilk sonucu döner. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;

const limitField = z.coerce
  .number({ error: 'limit sayı olmalı' })
  .int('limit tam sayı olmalı')
  .min(1, 'limit en az 1')
  .max(PUBLIC_API_MAX_LIMIT, `limit en fazla ${PUBLIC_API_MAX_LIMIT}`)
  .default(PUBLIC_API_DEFAULT_LIMIT);

const cursorField = z.string().max(200, 'cursor geçersiz').optional().describe('Önceki sayfanın `nextCursor` değeri');

const dateTimeField = z
  .string()
  .max(40)
  .refine((value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)), { message: 'Zaman ISO 8601 olmalı (ör. 2026-11-26T09:00:00Z)' });

const adults = z.coerce.number({ error: 'adults sayı olmalı' }).int().min(1, 'En az 1 yetişkin').max(MAX_PARTY_ADULTS, `En fazla ${MAX_PARTY_ADULTS} yetişkin`);
const children = z.coerce.number({ error: 'children sayı olmalı' }).int().min(0, 'Çocuk sayısı negatif olamaz').max(MAX_PARTY_CHILDREN, `En fazla ${MAX_PARTY_CHILDREN} çocuk`);
const boardType = z.enum(BOARD_TYPES, { error: 'Geçersiz pansiyon tipi' });

/** Gün aralığı denetimi (gün metinleri karşılaştırılabilir). */
function refineDayRange(value, ctx) {
  if (!value.checkIn || !value.checkOut) return;
  if (value.checkOut <= value.checkIn) {
    ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Çıkış girişten sonra olmalı' });
    return;
  }
  const nights = (Date.parse(value.checkOut) - Date.parse(value.checkIn)) / 86_400_000;
  if (nights > MAX_STAY_NIGHTS) ctx.addIssue({ code: 'custom', path: ['checkOut'], message: `Konaklama en fazla ${MAX_STAY_NIGHTS} gece` });
}

export const publicAvailabilityQuerySchema = z
  .object({
    checkIn: isoDayField.describe('Giriş günü (YYYY-MM-DD)'),
    checkOut: isoDayField.describe('Çıkış günü (YYYY-MM-DD)'),
    adults: adults.default(2),
    children: children.default(0),
    boardType: boardType.optional().describe('Pansiyon; boşsa otelin varsayılanı'),
  })
  .superRefine(refineDayRange);

const RESERVATION_PUBLIC_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW']);

export const publicReservationListQuerySchema = z
  .object({
    updatedSince: dateTimeField.optional().describe('Bu andan sonra değişenler (senkron); sıralama değişiklik zamanına göre artan'),
    status: z.enum(RESERVATION_PUBLIC_STATUSES, { error: 'Geçersiz durum' }).optional(),
    checkInFrom: isoDayField.optional().describe('Girişi bu gün ve sonrası'),
    checkInTo: isoDayField.optional().describe('Girişi bu gün ve öncesi'),
    confirmationCode: z.string().trim().min(3).max(40).optional(),
    limit: limitField,
    cursor: cursorField,
  })
  .superRefine((value, ctx) => {
    if (value.checkInFrom && value.checkInTo && value.checkInTo < value.checkInFrom) ctx.addIssue({ code: 'custom', path: ['checkInTo'], message: 'Bitiş başlangıçtan önce olamaz' });
  });

export const publicGuestListQuerySchema = z.object({
  updatedSince: dateTimeField.optional().describe('Bu andan sonra değişenler (senkron)'),
  email: z.string().trim().toLowerCase().max(200).optional(),
  limit: limitField,
  cursor: cursorField,
});

export const publicIdParamSchema = z.object({ id: uuid('Geçersiz kimlik') });

const publicGuestInput = z
  .object({
    firstName: z.string({ error: 'Ad zorunlu' }).trim().min(1, 'Ad zorunlu').max(100, 'Ad en fazla 100 karakter'),
    lastName: z.string({ error: 'Soyad zorunlu' }).trim().min(1, 'Soyad zorunlu').max(100, 'Soyad en fazla 100 karakter'),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(200)
      .refine((value) => EMAIL_PATTERN.test(value), { message: 'E-posta geçersiz' })
      .nullish(),
    phone: z
      .string()
      .trim()
      .max(40)
      .refine((value) => /^\+?[\d\s()-]{7,}$/.test(value) && value.replace(/\D/g, '').length >= 7, { message: 'Telefon geçersiz' })
      .nullish(),
    nationality: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Uyruk iki harfli ülke kodu (TR, DE)')
      .nullish(),
  })
  .refine((value) => value.email || value.phone, { path: ['email'], message: 'Misafire ulaşmak için e-posta ya da telefon verin' });

export const publicReservationCreateSchema = z
  .object({
    guestId: uuid('Geçersiz misafir').nullish().describe('Var olan misafir kartı (ya da `guest`)'),
    guest: publicGuestInput.nullish().describe('Yeni misafir (aynı e-posta / telefonla kart varsa ona bağlanır)'),
    roomTypeId: uuid('Oda tipi seçin'),
    checkIn: isoDayField,
    checkOut: isoDayField,
    adults,
    children: children.default(0),
    boardType: boardType.optional(),
    couponCode: couponCodeField.nullish(),
    notes: optionalText(MAX_RESERVATION_NOTES_LENGTH, 'Not'),
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.guestId) === Boolean(value.guest)) ctx.addIssue({ code: 'custom', path: ['guestId'], message: '`guestId` ya da `guest` verin (biri)' });
  })
  .superRefine(refineDayRange);

export const publicReservationUpdateSchema = z
  .object({
    expectedUpdatedAt: dateTimeField.describe('Okuduğunuz rezervasyonun `updatedAt` değeri (araya giren değişiklik varsa 409)'),
    checkIn: isoDayField.optional(),
    checkOut: isoDayField.optional(),
    roomTypeId: uuid('Geçersiz oda tipi').optional(),
    adults: adults.optional(),
    children: children.optional(),
    boardType: boardType.optional(),
    notes: optionalText(MAX_RESERVATION_NOTES_LENGTH, 'Not'),
  })
  .superRefine((value, ctx) => {
    const changes = ['checkIn', 'checkOut', 'roomTypeId', 'adults', 'children', 'boardType', 'notes'].filter((key) => value[key] !== undefined);
    if (changes.length === 0) ctx.addIssue({ code: 'custom', path: ['checkIn'], message: 'Değişecek en az bir alan verin' });
  })
  .superRefine(refineDayRange);

export const publicReservationCancelSchema = z.object({
  expectedUpdatedAt: dateTimeField.describe('Okuduğunuz rezervasyonun `updatedAt` değeri'),
  reason: z
    .string({ error: 'İptal sebebi zorunlu' })
    .trim()
    .min(1, 'İptal sebebi zorunlu')
    .max(MAX_CANCEL_REASON_LENGTH, `Sebep en fazla ${MAX_CANCEL_REASON_LENGTH} karakter`),
});

/* ─────────────── Açık API cevap şemaları (doküman + sözleşme testi) ─────────────── */

const money = z.string().describe('Tutar metni ("1234.50")');

export const publicHotelSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  currency: z.string().length(3),
  timezone: z.string(),
  checkInTime: z.string(),
  checkOutTime: z.string(),
  defaultBoardType: boardType,
  boardTypes: z.array(boardType),
});

export const publicRoomTypeSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  capacityAdults: z.number().int(),
  capacityChildren: z.number().int(),
});

export const publicAvailabilitySchema = z.object({
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number().int(),
  currency: z.string().length(3),
  boardType: boardType,
  roomTypes: z.array(
    z.object({
      roomTypeId: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      available: z.number().int().describe('Bütün geceler boyunca boş oda (en az olan gece)'),
      fits: z.boolean().describe('Kişi sayısı oda tipine sığıyor mu'),
      total: money.nullable().describe('Konaklama toplamı (vergi dahil liste fiyatı, varsa promosyonla); sığmıyorsa null'),
    }),
  ),
});

export const publicReservationSchema = z.object({
  id: z.string().uuid(),
  confirmationCode: z.string(),
  status: z.enum(RESERVATION_PUBLIC_STATUSES),
  source: z.string(),
  roomTypeId: z.string().uuid(),
  roomId: z.string().uuid().nullable(),
  roomNumber: z.string().nullable(),
  checkIn: z.string(),
  checkOut: z.string(),
  adults: z.number().int(),
  children: z.number().int(),
  boardType: boardType,
  totalPrice: money,
  currency: z.string().length(3),
  cancellationFee: money.nullable(),
  guest: z.object({ id: z.string().uuid(), firstName: z.string(), lastName: z.string() }),
  notes: z.string().nullable(),
  /** Bu uygulama mı açtı (yalnız onlar değiştirilebilir / iptal edilebilir). */
  ownedByClient: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const publicGuestSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  nationality: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const publicErrorSchema = z.object({
  success: z.literal(false),
  error: z.string().describe('Kullanıcıya gösterilebilir açıklama (Türkçe)'),
  code: z.string().describe('Dallanma için sabit kod (ör. NO_AVAILABILITY, STALE_VERSION, RATE_LIMITED)'),
  fields: z.record(z.string(), z.string()).optional(),
});

/**
 * @template {import('zod').ZodTypeAny} T
 * @param {T} item
 */
export const publicPageSchema = (item) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable().describe('Sonraki sayfa; null ise son sayfa') });
