import { expectedUpdatedAt, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * KBS — Emniyet / Jandarma kimlik bildirimi sözleşmeleri (modül 58).
 *
 * Kararlar:
 * - **Bildirim girişin kaydından gider:** girişte belgesi girilen her kişi (rezervasyon sahibi ve refakatçiler) için bir "giriş
 *   bildirimi"; çıkışta, odası değişince ve giriş / çıkış geri alınınca karşılığı. Online check-in'in kendisi bildirilmez (53).
 * - **Sağlayıcı arayüzü:** gerçek KBS (Emniyet) ve JKBS (Jandarma) tesis yetkisi ve servis dokümanıyla bağlanır; o güne kadar
 *   yalnız **Test ortamı** seçilebilir (dışarı göndermez, kabul / ret / ulaşılamaz davranışı ayardan). Hazır olmayan sağlayıcı
 *   açık ayarda seçilemez — canlıda sessizce bildirilmeyen misafir olmasın.
 * - **Zorunlu alanlar** ayardan: cinsiyet, doğum tarihi, anne / baba adı, doğum yeri. TC vatandaşı TC kimlikle bildirilirken ek alan
 *   istenmez (`citizenIdOnly`; nüfus kaydından gelir). KBS açıkken giriş eksik alanla yapılamaz.
 * - **Gönderim kuyruğu:** geçici hata artan aralıkla yeniden denenir (`KBS_RETRY_DELAYS_MS`), hak bitince ya da kalıcı hatada
 *   "gönderilemedi" ve zil; personel kartı düzeltip tekrar gönderir ya da KBS ekranından elle bildirip işaretler.
 */

export const KBS_PROVIDERS = Object.freeze(['TEST', 'EGM', 'JANDARMA']);
export const KBS_PROVIDER_LABELS = Object.freeze({
  TEST: 'Test ortamı (dışarı göndermez)',
  EGM: 'Emniyet Genel Müdürlüğü KBS',
  JANDARMA: 'Jandarma JKBS',
});
/** Bağlantısı yazılmış sağlayıcılar. Gerçek servis dokümanı ve tesis yetkisi gelince adaptörüyle birlikte açılır. */
export const KBS_PROVIDER_READY = Object.freeze({ TEST: true, EGM: false, JANDARMA: false });

export const KBS_KINDS = Object.freeze(['CHECK_IN', 'CHECK_OUT', 'ROOM_CHANGE']);
export const KBS_KIND_LABELS = Object.freeze({ CHECK_IN: 'Giriş', CHECK_OUT: 'Çıkış', ROOM_CHANGE: 'Oda değişikliği' });

export const KBS_STATES = Object.freeze(['PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'MANUAL']);
export const KBS_STATE_LABELS = Object.freeze({
  PENDING: 'Sırada',
  SENDING: 'Gönderiliyor',
  SENT: 'Bildirildi',
  FAILED: 'Gönderilemedi',
  CANCELLED: 'İptal (gerek kalmadı)',
  MANUAL: 'Elle bildirildi',
});
/** Bildirimi "tamamlanmış" sayılan durumlar (bağımlı bildirim bunları bekler). */
export const KBS_DONE_STATES = Object.freeze(['SENT', 'MANUAL']);

export const KBS_TEST_BEHAVIORS = Object.freeze(['ACCEPT', 'REJECT', 'UNAVAILABLE']);
export const KBS_TEST_BEHAVIOR_LABELS = Object.freeze({
  ACCEPT: 'Kabul eder',
  REJECT: 'Reddeder (kalıcı hata)',
  UNAVAILABLE: 'Ulaşılamaz (geçici hata, yeniden denenir)',
});

/** Geçici hatada yeniden deneme aralıkları: 1, 5, 15, 60, 180, 360 dakika; sonra "gönderilemedi". */
export const KBS_RETRY_DELAYS_MS = Object.freeze([60_000, 300_000, 900_000, 3_600_000, 10_800_000, 21_600_000]);
/** Giriş bildirimi bu kadar süredir bildirilmediyse gecikme zili. */
export const KBS_LATE_AFTER_MS = 2 * 3_600_000;
export const MAX_KBS_NOTE_LENGTH = 300;

/** Ek alanların etiketleri (eksik alan mesajı ve ekran). */
export const KBS_FIELD_LABELS = Object.freeze({
  idType: 'Belge türü',
  idNumber: 'Belge numarası',
  nationality: 'Uyruk',
  gender: 'Cinsiyet',
  birthDate: 'Doğum tarihi',
  fatherName: 'Baba adı',
  motherName: 'Anne adı',
  birthPlace: 'Doğum yeri',
});

/**
 * Geçici hatadan sonraki deneme zamanı; hak bittiyse null.
 * @param {number} attempts bu denemeyle birlikte yapılan deneme sayısı (1'den başlar) @param {Date} now
 * @returns {Date | null}
 */
export function kbsRetryAt(attempts, now) {
  const delay = KBS_RETRY_DELAYS_MS[attempts - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

/**
 * TC vatandaşı TC kimlikle mi bildiriliyor (ek alanlar nüfus kaydından gelir)?
 * @param {{ idType?: string | null, nationality?: string | null }} person
 */
export const isCitizenById = (person) => person.idType === 'NATIONAL_ID' && person.nationality === 'TR';

/**
 * KBS'nin bu kişi için istediği ama eksik olan alanlar (ayara göre). Belge (tür, numara, uyruk) her zaman zorunlu.
 * @param {{ idType?: string | null, idNumber?: string | null, nationality?: string | null, gender?: string | null, birthDate?: unknown,
 *   fatherName?: string | null, motherName?: string | null, birthPlace?: string | null }} person
 * @param {{ requireGender: boolean, requireBirthDate: boolean, requireParentNames: boolean, requireBirthPlace: boolean, citizenIdOnly: boolean }} settings
 * @returns {string[]} alan adları (`KBS_FIELD_LABELS` anahtarları)
 */
export function kbsMissingFields(person, settings) {
  const missing = ['idType', 'idNumber', 'nationality'].filter((field) => !person[field]);
  if (missing.length > 0) return missing;
  if (settings.citizenIdOnly && isCitizenById(person)) return [];
  return kbsExtraFields(settings).filter((field) => !person[field]);
}

/** Eksik alanları okunur metne çevirir. @param {string[]} fields */
export const kbsMissingText = (fields) => fields.map((field) => KBS_FIELD_LABELS[field] ?? field).join(', ');

/**
 * Ayarın istediği ek alanlar (belgenin üç alanı dışında). TC vatandaşı TC kimlikle bildiriliyorsa `citizenIdOnly` iken istenmez.
 * @param {{ requireGender: boolean, requireBirthDate: boolean, requireParentNames: boolean, requireBirthPlace: boolean }} settings
 * @returns {string[]}
 */
export function kbsExtraFields(settings) {
  return [
    ...(settings.requireGender ? ['gender'] : []),
    ...(settings.requireBirthDate ? ['birthDate'] : []),
    ...(settings.requireParentNames ? ['fatherName', 'motherName'] : []),
    ...(settings.requireBirthPlace ? ['birthPlace'] : []),
  ];
}

/* ─────────────── Şemalar ─────────────── */

const optionalCode = (label, max) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

/**
 * Ayar: parola yalnız yazılır — `password` gönderilmezse / null ise kayıtlı olan kalır, `clearPassword` siler.
 * Açık ayarda sağlayıcı hazır olmalı, tesis kodu ve kullanıcı dolu olmalı.
 */
export const kbsSettingsSchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAt.nullable(),
    isEnabled: z.boolean(),
    provider: z.enum(KBS_PROVIDERS, { error: 'Sağlayıcı seçin' }),
    facilityCode: optionalCode('Tesis kodu', 40),
    username: optionalCode('Kullanıcı adı', 80),
    password: z.string().max(200, 'Parola çok uzun').nullish(),
    clearPassword: z.boolean().default(false),
    sendCheckOut: z.boolean().default(true),
    sendRoomChange: z.boolean().default(true),
    requireGender: z.boolean().default(true),
    requireBirthDate: z.boolean().default(true),
    requireParentNames: z.boolean().default(false),
    requireBirthPlace: z.boolean().default(false),
    citizenIdOnly: z.boolean().default(true),
    testBehavior: z.enum(KBS_TEST_BEHAVIORS).default('ACCEPT'),
  })
  .superRefine((value, ctx) => {
    if (!value.isEnabled) return;
    if (!KBS_PROVIDER_READY[value.provider]) {
      ctx.addIssue({ code: 'custom', path: ['provider'], message: `${KBS_PROVIDER_LABELS[value.provider]} bağlantısı henüz kurulmadı (tesis yetkisi ve servis dokümanı gerekiyor); şimdilik Test ortamını seçin` });
    }
    if (!value.facilityCode) ctx.addIssue({ code: 'custom', path: ['facilityCode'], message: 'Tesis kodunu yazın' });
    if (!value.username) ctx.addIssue({ code: 'custom', path: ['username'], message: 'Kullanıcı adını yazın' });
  });

export const kbsNotificationListQuerySchema = paginationQuerySchema.extend({
  state: z.enum(KBS_STATES).optional(),
  /** "Açık" = sırada, gönderiliyor ya da gönderilemedi. */
  open: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  kind: z.enum(KBS_KINDS).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG').optional(),
  search: z.string().trim().max(100).optional(),
  reservationId: z.string().uuid().optional(),
});

export const kbsNotificationParamsSchema = z.object({ notificationId: z.string().uuid({ message: 'Geçersiz bildirim' }) });
export const kbsReservationParamsSchema = z.object({ reservationId: z.string().uuid({ message: 'Geçersiz rezervasyon' }) });

export const kbsManualSchema = z.object({
  note: z.string({ error: 'Not yazın' }).trim().min(3, 'Nasıl bildirildiğini yazın (ör. KBS ekranından elle girildi)').max(MAX_KBS_NOTE_LENGTH, `En fazla ${MAX_KBS_NOTE_LENGTH} karakter`),
});
