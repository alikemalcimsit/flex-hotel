import { z } from './locale.js';

/**
 * Onay kuyruğu sözleşmeleri (modül 11).
 *
 * Bir iş "personel karar versin" diye kuyruğa düşer: para iadesi, büyük ödeme,
 * toplu fiyat değişimi. İsteyen bir aktör (ör. iade aktörü) ya da bir servis
 * olabilir. Onaylanınca aktör kaldığı yerden devam eder; reddedilince ya da
 * süresi dolunca iş yapılmaz ve bir daha ele alınmaz.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/* ─────────────── Türler ve durumlar ─────────────── */

/**
 * Onay türleri. Yeni bir modül onaya iş götürecekse türünü buraya ekler;
 * ekran türe göre süzer ve etiketler. `OTHER` serbest.
 */
export const APPROVAL_TYPES = Object.freeze(['REFUND', 'LARGE_PAYMENT', 'BULK_PRICE_CHANGE', 'OTHER']);

export const APPROVAL_TYPE_LABELS = Object.freeze({
  REFUND: 'Para iadesi',
  LARGE_PAYMENT: 'Büyük ödeme',
  BULK_PRICE_CHANGE: 'Toplu fiyat değişimi',
  OTHER: 'Diğer',
});

/** Prisma `ApprovalStatus` ile birebir. */
export const APPROVAL_STATUSES = Object.freeze(['PENDING', 'GRANTED', 'DENIED', 'EXPIRED']);

export const APPROVAL_STATUS_LABELS = Object.freeze({
  PENDING: 'Bekliyor',
  GRANTED: 'Onaylandı',
  DENIED: 'Reddedildi',
  EXPIRED: 'Süresi doldu',
});

/** Karara bağlanmış durumlar (geçmiş sekmesi). */
export const APPROVAL_DECIDED_STATUSES = Object.freeze(['GRANTED', 'DENIED', 'EXPIRED']);

/** Liste görünümleri: bekleyenler (eskiden yeniye) ve geçmiş (yeni karar önce). */
export const APPROVAL_VIEWS = Object.freeze(['PENDING', 'HISTORY']);

export const APPROVAL_VIEW_LABELS = Object.freeze({
  PENDING: 'Bekleyen',
  HISTORY: 'Geçmiş',
});

/* ─────────────── Süreler ve sınırlar ─────────────── */

/**
 * İsteyen süre vermezse onay bu kadar sonra düşer. Bir gün bekleyip
 * kimsenin bakmadığı onay, unutulmuş demektir; süresiz bekleyen kuyruk
 * birikir. İsteyen açıkça `expiresInMs: null` derse süresiz olur.
 */
export const APPROVAL_DEFAULT_TTL_MS = DAY_MS;

/** İsteyenin verebileceği en uzun süre. */
export const APPROVAL_MAX_TTL_MS = 30 * DAY_MS;

/** Bu kadar süresi kalan onay listede ve özette "süresi yaklaşıyor" sayılır. */
export const APPROVAL_EXPIRING_SOON_MS = HOUR_MS;

/** Listede bir seferde gelen kayıt. */
export const APPROVAL_PAGE_SIZE = 20;

export const MAX_APPROVAL_SUMMARY_LENGTH = 200;
export const MAX_APPROVAL_REASON_LENGTH = 1000;
export const MAX_APPROVAL_NOTE_LENGTH = 500;

/* ─────────────── Saf kurallar ─────────────── */

/**
 * Onayın zamanlaması. Süresiz onayda `minutesLeft` `null`.
 *
 * @param {{ status: string, expiresAt?: string | Date | null }} approval
 * @param {number | Date} now
 * @returns {{ active: boolean, expired: boolean, minutesLeft: number | null, expiringSoon: boolean }}
 */
export function approvalTiming(approval, now) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const active = approval.status === 'PENDING';
  const expiresMs = approval.expiresAt ? new Date(approval.expiresAt).getTime() : null;
  if (!active || expiresMs === null) {
    return { active, expired: approval.status === 'EXPIRED', minutesLeft: null, expiringSoon: false };
  }
  const remaining = expiresMs - nowMs;
  return {
    active,
    // Tarayıcı henüz düşürmemiş olsa da süresi geçmiş onaya karar verilmez.
    expired: remaining <= 0,
    minutesLeft: Math.max(0, Math.ceil(remaining / MINUTE_MS)),
    expiringSoon: remaining > 0 && remaining <= APPROVAL_EXPIRING_SOON_MS,
  };
}

/**
 * Bu onaya karar verilebilir mi? Verilemezse kullanıcıya gösterilecek sebep.
 *
 * @param {{ status: string, expiresAt?: string | Date | null }} approval
 * @param {number | Date} now
 * @returns {string | null}
 */
export function approvalDecisionError(approval, now) {
  if (approval.status !== 'PENDING') {
    return `Bu onay zaten karara bağlanmış (${APPROVAL_STATUS_LABELS[approval.status] ?? approval.status})`;
  }
  if (approvalTiming(approval, now).expired) return 'Bu onayın süresi dolmuş; iş yapılmayacak';
  return null;
}

/* ─────────────── Şemalar ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const cursorLimit = (fallback, max) =>
  z.coerce
    .number({ error: 'Kayıt sayısı sayı olmalı' })
    .int('Kayıt sayısı tam sayı olmalı')
    .min(1, 'Kayıt sayısı en az 1 olmalı')
    .max(max, `Kayıt sayısı en fazla ${max} olabilir`)
    .default(fallback);

export const approvalListQuerySchema = z.object({
  view: z.enum(APPROVAL_VIEWS, { error: 'Geçersiz görünüm' }).default('PENDING'),
  /** Yalnızca geçmişte anlamlı; bekleyen görünümünde yok sayılır. */
  status: z.enum(APPROVAL_DECIDED_STATUSES, { error: 'Geçersiz durum' }).optional(),
  type: z.enum(APPROVAL_TYPES, { error: 'Geçersiz onay türü' }).optional(),
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  cursor: z.string().max(200, 'Geçersiz imleç').optional(),
  limit: cursorLimit(APPROVAL_PAGE_SIZE, 50),
});

export const approvalParamSchema = z.object({
  approvalId: uuid('Geçersiz onay'),
});

const note = z.string().trim().max(MAX_APPROVAL_NOTE_LENGTH, `Not en fazla ${MAX_APPROVAL_NOTE_LENGTH} karakter`);

/** Onaylarken not isteğe bağlı. */
export const grantApprovalSchema = z.object({
  note: note.optional(),
});

/** Reddederken gerekçe zorunlu: isteyen (ve denetim izi) nedenini görmeli. */
export const denyApprovalSchema = z.object({
  note: note.min(1, 'Ret gerekçesini yazın'),
});

/**
 * Onay isteğinin gövdesi (sunucu içi: aktör ya da servis). HTTP'den onay
 * açılmaz; yine de tek yerde doğrulanır ki bozuk istek kuyruğa girmesin.
 */
export const approvalRequestSchema = z.object({
  type: z.enum(APPROVAL_TYPES, { error: 'Geçersiz onay türü' }),
  summary: z
    .string()
    .trim()
    .min(1, 'Onay özeti boş olamaz')
    .max(MAX_APPROVAL_SUMMARY_LENGTH, `Özet en fazla ${MAX_APPROVAL_SUMMARY_LENGTH} karakter`),
  reason: z.string().trim().max(MAX_APPROVAL_REASON_LENGTH).nullish(),
  data: z.record(z.string(), z.unknown()).default({}),
  amount: z
    .union([z.string(), z.number()])
    .transform((value) => String(value))
    .refine((value) => /^-?\d+(\.\d{1,2})?$/.test(value), { message: 'Tutar geçersiz' })
    .nullish(),
  currency: z.string().trim().length(3, 'Para birimi 3 harf olmalı').toUpperCase().nullish(),
  actorName: z.string().trim().min(1).nullish(),
  action: z.string().trim().min(1).nullish(),
  entityType: z.string().trim().min(1).nullish(),
  entityId: z.string().trim().min(1).nullish(),
  /** `undefined`: varsayılan süre; `null`: süresiz. */
  expiresInMs: z.number().int().min(MINUTE_MS, 'Süre en az 1 dakika').max(APPROVAL_MAX_TTL_MS).nullish(),
});
