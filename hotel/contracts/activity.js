import { z } from './locale.js';

/**
 * Aktivite akışı ve denetim kaydı (modül 10) — sözleşme.
 *
 * Üç kaynak, tek bakış:
 * - **Aktivite** (`ActivityLog`): hangi aktör hangi olayı işledi, ne kadar
 *   sürdü, sonuç (bilgi / uyarı / hata).
 * - **Olay** (`EventLog`): sistemde yayınlanan her olay; dağıtılmadıysa
 *   (`publishedAt` boş) outbox'ta bekliyor demektir.
 * - **Denetim** (`AuditLog`): kim hangi kaydı ne zaman nasıl değiştirdi.
 *
 * Üçü de aynı zincir kimliğini (`correlationId`) taşır: bir personelin
 * tıklamasıyla ya da misafirin mesajıyla başlayan bütün adımlar tek zincirde.
 */

export const ACTIVITY_LEVELS = Object.freeze(['INFO', 'WARN', 'ERROR']);

export const ACTIVITY_LEVEL_LABELS = Object.freeze({
  DEBUG: 'Ayrıntı',
  INFO: 'Bilgi',
  WARN: 'Uyarı',
  ERROR: 'Hata',
});

/** Akış süzgecindeki seviye seçenekleri: tek seviye ya da "sorunlar" (uyarı + hata). */
export const ACTIVITY_LEVEL_FILTERS = Object.freeze(['INFO', 'WARN', 'ERROR', 'PROBLEMS']);

export const ACTIVITY_LEVEL_FILTER_LABELS = Object.freeze({
  INFO: 'Bilgi',
  WARN: 'Uyarı',
  ERROR: 'Hata',
  PROBLEMS: 'Sorunlar (uyarı + hata)',
});

export const AUDIT_ACTIONS = Object.freeze(['CREATE', 'UPDATE', 'DELETE']);

export const AUDIT_ACTION_LABELS = Object.freeze({
  CREATE: 'Oluşturdu',
  UPDATE: 'Değiştirdi',
  DELETE: 'Sildi',
});

/**
 * Denetim izine yazılan kayıt türleri (servislerin `recordAudit` çağrılarındaki
 * `entity`). Listede olmayan tür de gösterilir; adı olduğu gibi yazılır.
 */
export const AUDIT_ENTITY_LABELS = Object.freeze({
  Hotel: 'Otel bilgileri',
  RoomType: 'Oda tipi',
  Room: 'Oda',
  RoomBlock: 'Oda bloğu',
  Tax: 'Vergi',
  Season: 'Sezon',
  Reservation: 'Rezervasyon',
  ReservationGroup: 'Grup rezervasyonu',
  WaitlistEntry: 'Bekleme listesi',
  Guest: 'Misafir kartı',
  Conversation: 'Konuşma',
  GuestRequest: 'Misafir isteği',
  Notification: 'Bildirim',
  NotificationTemplate: 'Bildirim şablonu',
  NotificationChannelConfig: 'Bildirim kanalı',
  MessagingChannel: 'Mesaj kanalı',
  AiSettings: 'AI asistanı ayarı',
  Approval: 'Onay',
  User: 'Kullanıcı',
  RolePermission: 'Rol izinleri',
});

export const AUDIT_ENTITIES = Object.freeze(Object.keys(AUDIT_ENTITY_LABELS));

/** Akış ve listelerin sayfa boyu. */
export const ACTIVITY_PAGE_SIZE = 50;
export const ACTIVITY_MAX_PAGE_SIZE = 200;
/** Canlı akışta tek seferde çekilen en fazla yeni satır (fazlası varsa liste baştan yüklenir). */
export const ACTIVITY_LIVE_BATCH = 100;

/**
 * Zincir kimliği: HTTP isteğinin kimliği (`x-correlation-id` kuralı) ya da
 * sunucunun ürettiği UUID.
 */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/* ─────────────── Aktör türü ─────────────── */

/**
 * Kaydı kim yazdı? `actor` alanı; kişi (e-posta), aktör (ad), kanal
 * (`kanal:whatsapp`) ya da sistem olabilir. Ekran buna göre etiketler.
 *
 * @param {string | null | undefined} actor
 * @returns {'USER' | 'CHANNEL' | 'SYSTEM' | 'ACTOR'}
 */
export function actorKind(actor) {
  if (!actor || actor === 'system' || actor === 'anonim') return 'SYSTEM';
  if (actor.includes('@')) return 'USER';
  if (actor.startsWith('kanal:')) return 'CHANNEL';
  return 'ACTOR';
}

/* ─────────────── Kişisel veri maskeleme ─────────────── */

/**
 * Olay gövdesinde kişisel veri taşıyan alanlar. Olay listesi teknik bir
 * görünüm; misafirin telefonu, e-postası, kimlik numarası tam gösterilmez
 * (KVKK: amaçla sınırlı erişim). Değişikliğin tam değeri gereken yer denetim
 * kaydıdır (ayrı izin).
 */
const SENSITIVE_KEY = /(phone|telefon|email|e_?posta|identity|kimlik|document|passport|pasaport|tckn|nationalid|card|iban|address|adres|secret|token|password|parola)/i;

/** Maskelenecek iç içe en derin seviye (daha derini tamamen gizlenir). */
const MAX_REDACT_DEPTH = 8;

/**
 * Metni maskeler: baştan ve sondan en fazla iki karakter kalır. E-posta
 * adresinde kullanıcı adı ve alan adı ayrı ayrı maskelenir.
 * @param {string} value
 */
export function maskValue(value) {
  const text = String(value);
  if (text.includes('@')) {
    const [user, domain] = text.split('@');
    return `${maskValue(user)}@${maskValue(domain)}`;
  }
  if (text.length <= 4) return '*'.repeat(text.length);
  const keep = text.length >= 8 ? 2 : 1;
  return `${text.slice(0, keep)}${'*'.repeat(text.length - keep * 2)}${text.slice(-keep)}`;
}

/**
 * Kişisel veri alanlarını maskeleyen kopya. Anahtar adı hassas görünen her
 * metin/sayı değeri maskelenir; nesne ve diziler içinde de aranır.
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function redactPayload(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_REDACT_DEPTH) return '[…]';
  if (Array.isArray(value)) return value.map((item) => redactPayload(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (SENSITIVE_KEY.test(key) && item !== null && item !== undefined && typeof item !== 'object' && typeof item !== 'boolean') {
        return [key, maskValue(item)];
      }
      return [key, redactPayload(item, depth + 1)];
    }),
  );
}

/* ─────────────── Şemalar ─────────────── */

const cursorLimit = (fallback, max) =>
  z.coerce
    .number({ error: 'Kayıt sayısı sayı olmalı' })
    .int('Kayıt sayısı tam sayı olmalı')
    .min(1, 'Kayıt sayısı en az 1 olmalı')
    .max(max, `Kayıt sayısı en fazla ${max} olabilir`)
    .default(fallback);

const cursorField = z.string().max(200, 'Geçersiz imleç').optional();
const nameField = (label) => z.string().trim().min(1).max(100, `${label} çok uzun`).optional();
const instant = (label) => z.coerce.date({ error: `${label} geçersiz` }).optional();
const correlationField = z
  .string()
  .trim()
  .regex(CORRELATION_ID_PATTERN, 'Zincir kimliği geçersiz')
  .optional();

/** Zaman aralığı: başlangıç bitişten sonra olamaz. */
const rangeRefine = (value, ctx) => {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  }
  if (value.cursor && value.ids) {
    ctx.addIssue({ code: 'custom', path: ['ids'], message: 'Sayfa ve canlı satırlar aynı istekte istenemez' });
  }
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Canlı akışın çektiği satır kimlikleri (socket haberi kimlik taşır, içerik
 * değil). Virgülle ayrılmış UUID listesi.
 */
const idListField = z
  .string()
  .max(ACTIVITY_LIVE_BATCH * 2 * 37, 'Çok fazla kimlik')
  .transform((value) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))])
  .refine((ids) => ids.length <= ACTIVITY_LIVE_BATCH * 2, { message: `En fazla ${ACTIVITY_LIVE_BATCH * 2} kimlik` })
  .refine((ids) => ids.every((id) => UUID_PATTERN.test(id)), { message: 'Geçersiz kimlik' })
  .optional();

/**
 * Aktivite akışı. `cursor`: bu kayıttan eskiler (sayfa); `ids`: canlı akışın
 * haberini aldığı yeni satırlar (süzgeçler yine uygulanır).
 */
export const activityFeedQuerySchema = z
  .object({
    actorName: nameField('Aktör adı'),
    eventName: nameField('Olay adı'),
    level: z.enum(ACTIVITY_LEVEL_FILTERS, { error: 'Geçersiz seviye' }).optional(),
    correlationId: correlationField,
    from: instant('Başlangıç'),
    to: instant('Bitiş'),
    cursor: cursorField,
    ids: idListField,
    limit: cursorLimit(ACTIVITY_PAGE_SIZE, ACTIVITY_MAX_PAGE_SIZE),
  })
  .superRefine(rangeRefine);

/** Olay listesi. `unpublished=true`: dağıtılamamış (outbox'ta bekleyen) olaylar. */
export const eventLogQuerySchema = z
  .object({
    name: nameField('Olay adı'),
    correlationId: correlationField,
    unpublished: z
      .enum(['true', 'false'], { error: 'Geçersiz seçim' })
      .transform((value) => value === 'true')
      .optional(),
    from: instant('Başlangıç'),
    to: instant('Bitiş'),
    cursor: cursorField,
    limit: cursorLimit(ACTIVITY_PAGE_SIZE, ACTIVITY_MAX_PAGE_SIZE),
  })
  .superRefine(rangeRefine);

/** Denetim kaydı. `actor`: kişinin e-postası ya da aktör adı (birebir). */
export const auditQuerySchema = z
  .object({
    actor: z.string().trim().toLowerCase().min(1).max(200, 'Kişi çok uzun').optional(),
    entity: z.string().trim().min(1).max(60, 'Kayıt türü çok uzun').optional(),
    entityId: z.string().trim().min(1).max(100, 'Kayıt kimliği çok uzun').optional(),
    action: z.enum(AUDIT_ACTIONS, { error: 'Geçersiz işlem' }).optional(),
    from: instant('Başlangıç'),
    to: instant('Bitiş'),
    cursor: cursorField,
    limit: cursorLimit(ACTIVITY_PAGE_SIZE, ACTIVITY_MAX_PAGE_SIZE),
  })
  .superRefine((value, ctx) => {
    rangeRefine(value, ctx);
    if (value.entityId && !value.entity) {
      ctx.addIssue({ code: 'custom', path: ['entity'], message: 'Kayıt kimliğiyle birlikte kayıt türü seçilmeli' });
    }
  });

export const chainParamSchema = z.object({
  correlationId: z.string().trim().regex(CORRELATION_ID_PATTERN, 'Zincir kimliği geçersiz'),
});

/** Bir kaydın (ör. rezervasyonun) bütün zincirleri. */
export const entityChainsParamSchema = z.object({
  entity: z.string().trim().min(1).max(60, 'Kayıt türü çok uzun'),
  entityId: z.string().trim().min(1).max(100, 'Kayıt kimliği çok uzun'),
});

/**
 * Denetim ekranında sık görülen alanların Türkçe adları. Listede olmayan alan
 * adıyla gösterilir (yeni modülün alanı ekranı kırmaz).
 */
export const AUDIT_FIELD_LABELS = Object.freeze({
  status: 'Durum',
  roomId: 'Oda',
  roomTypeId: 'Oda tipi',
  guestId: 'Misafir',
  checkIn: 'Giriş',
  checkOut: 'Çıkış',
  checkedInAt: 'Giriş yapıldı',
  checkedOutAt: 'Çıkış yapıldı',
  adults: 'Yetişkin',
  children: 'Çocuk',
  boardType: 'Pansiyon',
  totalPrice: 'Tutar',
  notes: 'Not',
  source: 'Kaynak',
  name: 'Ad',
  code: 'Kod',
  basePrice: 'Taban fiyat',
  rate: 'Oran',
  enabled: 'Açık',
  mode: 'Yanıtlayan',
  assignedToId: 'Atanan',
  reservationId: 'Rezervasyon',
  role: 'Rol',
  isActive: 'Aktif',
  email: 'E-posta',
  phone: 'Telefon',
  housekeepingStatus: 'Temizlik durumu',
  occupancyStatus: 'Doluluk',
  priority: 'Öncelik',
  dailyBudgetUsd: 'Günlük bütçe',
});
