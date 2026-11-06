import { z } from './locale.js';
import { expectedUpdatedAt, isoDayField, paginationQuerySchema } from './fields.js';
import { companionSchema, guestIdentitySchema, MAX_COMPANIONS, normalizePlate } from './front-desk.js';
import { GUEST_REQUEST_CATEGORIES } from './constants.js';

/**
 * Temassız uygulamalar (modül 53): misafir portalı, online check-in, QR menü.
 *
 * Misafir rezervasyonuna bağlı imzalı bir bağlantıyla (`/misafir/p/<belirteç>`) girer; oturum açmaz. Portal girişten
 * önce online check-in'i, konaklamada folyoyu, istekleri ve oda servisini (41'in oda bağlantısıyla), çıkıştan sonra
 * bir süre daha folyoyu gösterir. Online check-in personelin girişini **hızlandırır, yerine geçmez**: misafir gelince
 * belge yine görülür; giriş modül 6'nın kuralıyla, online check-in'in verisi dolu olarak yapılır.
 */

/* ─────────────── Yollar ve diller ─────────────── */

/** Misafir portalının adresi (belirteç eklenir). Misafir uygulaması `/misafir/` altında yayınlanır. */
export const GUEST_PORTAL_PATH = '/misafir/p';

export const GUEST_PORTAL_LANGUAGES = Object.freeze(['tr', 'en', 'de', 'ru']);
export const GUEST_PORTAL_LANGUAGE_LABELS = Object.freeze({ tr: 'Türkçe', en: 'English', de: 'Deutsch', ru: 'Русский' });

const GERMAN_SPEAKING = new Set(['DE', 'AT', 'CH', 'LI', 'LU']);
const RUSSIAN_SPEAKING = new Set(['RU', 'BY', 'KZ', 'KG', 'UZ', 'TJ', 'TM', 'AM']);
const TURKISH_SPEAKING = new Set(['TR', 'AZ']);

/**
 * Portalın ilk açılış dili misafirin uyruğundan; misafir üstten değiştirir (tarayıcısı hatırlar).
 * @param {string | null | undefined} nationality ISO ülke kodu
 * @returns {'tr' | 'en' | 'de' | 'ru'}
 */
export function guestPortalLanguageFor(nationality) {
  const code = String(nationality ?? '').trim().toUpperCase();
  if (!code || TURKISH_SPEAKING.has(code)) return 'tr';
  if (GERMAN_SPEAKING.has(code)) return 'de';
  if (RUSSIAN_SPEAKING.has(code)) return 'ru';
  return 'en';
}

/* ─────────────── Online check-in ─────────────── */

/**
 * - `SUBMITTED`: misafir gönderdi, personel bakmadı (ya da misafir onaydan sonra değiştirdi).
 * - `APPROVED`: personel bilgileri ve belgeyi gördü; misafir gelince tek tıkla giriş.
 * - `REJECTED`: personel düzeltme istedi (sebep misafire görünür); misafir düzeltip yeniden gönderir.
 * - `COMPLETED`: giriş yapıldı (modül 6). Artık değişmez.
 */
export const ONLINE_CHECKIN_STATUSES = Object.freeze(['SUBMITTED', 'APPROVED', 'REJECTED', 'COMPLETED']);
export const ONLINE_CHECKIN_STATUS_LABELS = Object.freeze({
  SUBMITTED: 'İnceleme bekliyor',
  APPROVED: 'Onaylandı',
  REJECTED: 'Düzeltme istendi',
  COMPLETED: 'Giriş yapıldı',
});
export const ONLINE_CHECKIN_STATUS_TONES = Object.freeze({ SUBMITTED: 'warning', APPROVED: 'info', REJECTED: 'danger', COMPLETED: 'success' });

/** Misafirin teminat / ödeme tercihi (kart bilgisi alınmaz; kartla ön ödeme sanal POS'la, modül 50). */
export const ONLINE_CHECKIN_PAYMENT_PREFERENCES = Object.freeze(['CARD_AT_DESK', 'CASH_AT_DESK', 'PREPAID', 'COMPANY']);
export const ONLINE_CHECKIN_PAYMENT_PREFERENCE_LABELS = Object.freeze({
  CARD_AT_DESK: 'Girişte kartla',
  CASH_AT_DESK: 'Girişte nakit',
  PREPAID: 'Önceden ödendi',
  COMPANY: 'Şirket / acente öder',
});

/** Belge fotoğrafı: tarayıcı küçültür (EXIF / konum bu sırada düşer); sunucu türü dosyanın imzasından doğrular. */
export const ONLINE_CHECKIN_PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/webp']);
export const ONLINE_CHECKIN_PHOTO_MAX_EDGE = 1600;
export const ONLINE_CHECKIN_PHOTO_MAX_BYTES = 1_500_000;
export const ONLINE_CHECKIN_THUMB_MAX_EDGE = 320;
export const ONLINE_CHECKIN_THUMB_MAX_BYTES = 60_000;
/** Kişi başına belge fotoğrafı (ön + arka yüz). */
export const ONLINE_CHECKIN_MAX_PHOTOS_PER_PERSON = 2;
/** Bir rezervasyona yüklenebilecek fotoğraf (yeniden çekimler dahil; bağlantı ele geçse de disk dolmasın). */
export const ONLINE_CHECKIN_MAX_UPLOADS = 40;
/** İmza: tuvalden PNG. */
export const ONLINE_CHECKIN_SIGNATURE_MAX_BYTES = 200_000;
/** İstek gövdesinin sınırı (base64 + JSON payı). */
export const ONLINE_CHECKIN_PHOTO_BODY_LIMIT = Math.ceil(((ONLINE_CHECKIN_PHOTO_MAX_BYTES + ONLINE_CHECKIN_THUMB_MAX_BYTES) * 4) / 3) + 16_384;
export const ONLINE_CHECKIN_SUBMIT_BODY_LIMIT = Math.ceil((ONLINE_CHECKIN_SIGNATURE_MAX_BYTES * 4) / 3) + 64_000;

/** Portal çıkıştan sonra bu kadar gün daha açılır (folyo, fatura). */
export const GUEST_PORTAL_AFTER_CHECKOUT_DAYS = 14;
/** Yüklenip gönderime bağlanmayan fotoğraf bu kadar saat sonra silinir. */
export const ONLINE_CHECKIN_ORPHAN_PHOTO_HOURS = 48;

export const GUEST_PORTAL_SETTING_LIMITS = Object.freeze({
  inviteDaysBefore: { min: 0, max: 14 },
  checkinOpenDays: { min: 1, max: 30 },
  documentRetentionDays: { min: 0, max: 90 },
});

export const GUEST_PORTAL_DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  /** Girişten kaç gün önce davet gönderilir (0: otomatik davet yok, yalnız elle). */
  inviteDaysBefore: 3,
  /** Online check-in girişten kaç gün önce açılır. */
  checkinOpenDays: 7,
  /** Belge fotoğrafları çıkıştan (gelmeyen / iptal için giriş gününden) kaç gün sonra silinir (KVKK). */
  documentRetentionDays: 7,
});

/** Otelin portalda yazdığı metinler (dil başına). */
export const GUEST_PORTAL_TEXT_KEYS = Object.freeze(['welcome', 'houseRules', 'privacyNotice']);
export const GUEST_PORTAL_TEXT_LABELS = Object.freeze({ welcome: 'Karşılama', houseRules: 'Konaklama kuralları', privacyNotice: 'KVKK aydınlatma metni' });
export const GUEST_PORTAL_TEXT_MAX = Object.freeze({ welcome: 600, houseRules: 6000, privacyNotice: 8000 });

/**
 * Varsayılan metinler: otel ayarlardan kendi metnini yazana kadar. KVKK metni genel bir çerçevedir; otelin veri
 * sorumlusu bilgileriyle (unvan, adres, başvuru yolu) hukukçusuna gözden geçirtmesi gerekir — ayar ekranı söyler.
 */
export const GUEST_PORTAL_DEFAULT_TEXTS = Object.freeze({
  tr: Object.freeze({
    welcome: 'Konaklamanıza hazırlanıyoruz. Online check-in ile girişte beklemeden odanıza geçin.',
    houseRules:
      'Giriş saati {checkInTime}, çıkış saati {checkOutTime}. Konaklama süresince odada sigara içilmez. Odadaki eksik ya da hasar çıkışta folyoya yansıtılır. Yasal zorunluluk gereği her yetişkin misafirin kimlik bilgisi girişte kayıt altına alınır. Ziyaretçiler resepsiyona bildirilmelidir.',
    privacyNotice:
      '6698 sayılı Kişisel Verilerin Korunması Kanunu uyarınca kimlik bilgileriniz ve belge fotoğrafınız; konaklama sözleşmesinin kurulması, 1774 sayılı Kimlik Bildirme Kanunu kapsamındaki yasal bildirim yükümlülüğü ve girişte kimliğinizin doğrulanması amacıyla işlenir. Belge fotoğrafları bu amaç sona erince, en geç çıkışınızdan sonra ayarlarda belirtilen süre içinde silinir. Verileriniz yetkili kamu kurumları dışında üçüncü kişilerle paylaşılmaz. Kanunun 11. maddesindeki haklarınız için otelimize başvurabilirsiniz.',
  }),
  en: Object.freeze({
    welcome: 'We are getting ready for your stay. Check in online and go straight to your room on arrival.',
    houseRules:
      'Check-in is from {checkInTime} and check-out is until {checkOutTime}. Smoking is not permitted in the rooms. Missing items or damage are charged to your bill at check-out. By law, the identity of every adult guest is recorded at check-in. Visitors must be announced at the front desk.',
    privacyNotice:
      'Under the Turkish Personal Data Protection Law No. 6698, your identity details and document photo are processed to perform the accommodation contract, to meet the statutory guest registration duty (Law No. 1774) and to verify your identity at check-in. Document photos are deleted once this purpose is fulfilled, at the latest within the period set by the hotel after your check-out. Your data is not shared with third parties other than the authorities. You may contact the hotel to exercise your rights under Article 11 of the Law.',
  }),
  de: Object.freeze({
    welcome: 'Wir bereiten Ihren Aufenthalt vor. Checken Sie online ein und gehen Sie bei der Ankunft direkt auf Ihr Zimmer.',
    houseRules:
      'Check-in ab {checkInTime} Uhr, Check-out bis {checkOutTime} Uhr. In den Zimmern ist das Rauchen nicht gestattet. Fehlende Gegenstände oder Schäden werden beim Check-out berechnet. Gesetzlich wird die Identität jedes erwachsenen Gastes beim Check-in erfasst. Besucher sind an der Rezeption anzumelden.',
    privacyNotice:
      'Gemäß dem türkischen Datenschutzgesetz Nr. 6698 werden Ihre Ausweisdaten und das Foto Ihres Dokuments zur Erfüllung des Beherbergungsvertrags, zur gesetzlichen Meldepflicht (Gesetz Nr. 1774) und zur Prüfung Ihrer Identität beim Check-in verarbeitet. Dokumentfotos werden gelöscht, sobald dieser Zweck erfüllt ist, spätestens innerhalb der vom Hotel festgelegten Frist nach Ihrer Abreise. Ihre Daten werden außer an Behörden nicht an Dritte weitergegeben. Zur Ausübung Ihrer Rechte nach Artikel 11 des Gesetzes wenden Sie sich bitte an das Hotel.',
  }),
  ru: Object.freeze({
    welcome: 'Мы готовимся к вашему приезду. Пройдите онлайн-регистрацию и сразу отправляйтесь в номер.',
    houseRules:
      'Заселение с {checkInTime}, выезд до {checkOutTime}. Курение в номерах запрещено. Недостающие вещи и повреждения включаются в счёт при выезде. По закону данные удостоверения личности каждого взрослого гостя регистрируются при заселении. О посетителях необходимо сообщать на ресепшн.',
    privacyNotice:
      'В соответствии с Законом Турции о защите персональных данных № 6698 ваши паспортные данные и фотография документа обрабатываются для исполнения договора проживания, выполнения обязанности по регистрации гостей (Закон № 1774) и проверки вашей личности при заселении. Фотографии документов удаляются после достижения этой цели, не позднее срока, установленного отелем после вашего выезда. Ваши данные не передаются третьим лицам, кроме государственных органов. Для реализации прав по статье 11 Закона обратитесь в отель.',
  }),
});

/**
 * Metin: otelin o dilde yazdığı → otelin İngilizcesi → o dilin varsayılanı. `{checkInTime}` / `{checkOutTime}` otelin
 * saatleriyle doldurulur (varsayılan metin otelin saatini söylesin). Otel kendi metnini yazınca diğer dillerini de
 * doldurmalı; ayar ekranı eksik dili gösterir.
 *
 * @param {any} texts ayardaki `{ tr: { welcome, … }, … }` @param {string} language @param {string} key
 * @param {{ checkInTime?: string, checkOutTime?: string }} [hotel]
 */
export function guestPortalText(texts, language, key, hotel = {}) {
  const own = (lang) => {
    const value = texts?.[lang]?.[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };
  const text = own(language) ?? own('en') ?? GUEST_PORTAL_DEFAULT_TEXTS[language]?.[key] ?? GUEST_PORTAL_DEFAULT_TEXTS.en[key] ?? '';
  return text.replaceAll('{checkInTime}', hotel.checkInTime ?? '14:00').replaceAll('{checkOutTime}', hotel.checkOutTime ?? '12:00');
}

/**
 * Online check-in açık mı? Misafirin göreceği sebep kodu (portal kendi dilinde yazar).
 *
 * @param {{ status: string, checkIn: string, checkOut: string }} reservation gün metinleri
 * @param {{ today: string, openDays: number, submission?: { status: string } | null, enabled: boolean }} context
 * @returns {{ open: boolean, reason: null | 'DISABLED' | 'NOT_YET' | 'CLOSED' | 'CANCELLED' | 'CHECKED_IN' | 'COMPLETED', opensOn: string | null }}
 */
export function onlineCheckinWindow(reservation, { today, openDays, submission = null, enabled }) {
  const opensOn = shiftDay(reservation.checkIn, -openDays);
  if (!enabled) return { open: false, reason: 'DISABLED', opensOn: null };
  if (submission?.status === 'COMPLETED' || reservation.status === 'CHECKED_IN' || reservation.status === 'CHECKED_OUT') {
    return { open: false, reason: reservation.status === 'CHECKED_IN' || submission?.status === 'COMPLETED' ? 'COMPLETED' : 'CLOSED', opensOn };
  }
  if (!['PENDING', 'CONFIRMED'].includes(reservation.status)) return { open: false, reason: 'CANCELLED', opensOn };
  if (reservation.checkOut <= today) return { open: false, reason: 'CLOSED', opensOn };
  if (today < opensOn) return { open: false, reason: 'NOT_YET', opensOn };
  return { open: true, reason: null, opensOn };
}

/**
 * Portal bu rezervasyon için açılır mı (bağlantı geçerli olsa da)? İptal / gelmedi kapalı; çıkıştan sonra
 * `GUEST_PORTAL_AFTER_CHECKOUT_DAYS` gün açık.
 * @param {{ status: string, checkOut: string }} reservation @param {string} today
 */
export function guestPortalOpen(reservation, today) {
  if (['CANCELLED', 'NO_SHOW'].includes(reservation.status)) return false;
  return today <= shiftDay(reservation.checkOut, GUEST_PORTAL_AFTER_CHECKOUT_DAYS);
}

/** @param {string} day "YYYY-AA-GG" @param {number} days */
function shiftDay(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Yetişkin sayısı kadar kişinin (rezervasyon sahibi + refakatçiler) belgesi istenir; çocukta isteğe bağlı.
 * @param {{ primary: { documentIds: string[] }, companions: Array<{ person: { isChild: boolean }, documentIds: string[] }> }} input
 * @returns {Array<{ person: number, problem: 'PHOTO_REQUIRED' | 'TOO_MANY_PHOTOS' }>}
 */
export function onlineCheckinPhotoProblems(input) {
  const people = [{ child: false, ids: input.primary.documentIds }, ...input.companions.map((row) => ({ child: row.person.isChild, ids: row.documentIds }))];
  const problems = [];
  people.forEach((person, index) => {
    if (person.ids.length > ONLINE_CHECKIN_MAX_PHOTOS_PER_PERSON) problems.push({ person: index, problem: 'TOO_MANY_PHOTOS' });
    else if (!person.child && person.ids.length === 0) problems.push({ person: index, problem: 'PHOTO_REQUIRED' });
  });
  return problems;
}

/**
 * Personelin giriş penceresinin (modül 6) ön dolumu: online check-in'in kişileri ve plakası.
 * @param {{ guest: any, companions: any[], vehiclePlate: string | null }} submission
 */
export function onlineCheckinToCheckInValues(submission) {
  const identity = (row) => ({ idType: row.idType ?? null, idNumber: row.idNumber ?? null, nationality: row.nationality ?? null, birthDate: row.birthDate ?? null });
  return {
    guest: identity(submission.guest ?? {}),
    companions: (submission.companions ?? []).map((row) => ({ firstName: row.firstName, lastName: row.lastName, isChild: Boolean(row.isChild), ...identity(row) })),
    vehiclePlate: submission.vehiclePlate ?? null,
  };
}

/* ─────────────── Şemalar: misafir ─────────────── */

const uuid = (message) => z.string().uuid({ message });
/** `<bağlantı kimliği>.<imza>` (imza base64url, 43 karakter). */
export const guestPortalTokenSchema = z.object({
  token: z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/, 'Bağlantı geçersiz'),
});
export const guestPortalDocumentParamSchema = guestPortalTokenSchema.extend({ documentId: uuid('Geçersiz belge') });

const base64Field = (label, maxBytes) =>
  z
    .string({ error: `${label} zorunlu` })
    .min(1, `${label} zorunlu`)
    .max(Math.ceil((maxBytes * 4) / 3) + 4, `${label} çok büyük`);

/** Belge fotoğrafı yükleme (kişi başına ayrı istek; gönderimde kimlikleriyle bağlanır). */
export const onlineCheckinPhotoSchema = z.object({
  contentType: z.enum(ONLINE_CHECKIN_PHOTO_TYPES, { error: 'Fotoğraf JPEG ya da WebP olmalı' }),
  image: base64Field('Fotoğraf', ONLINE_CHECKIN_PHOTO_MAX_BYTES),
  thumbnail: base64Field('Önizleme', ONLINE_CHECKIN_THUMB_MAX_BYTES),
});

const documentIdsField = z.array(uuid('Geçersiz belge')).max(ONLINE_CHECKIN_MAX_PHOTOS_PER_PERSON, `Kişi başına en fazla ${ONLINE_CHECKIN_MAX_PHOTOS_PER_PERSON} fotoğraf`).default([]);

const arrivalTimeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Saat SS:DD biçiminde olmalı')
  .nullish()
  .transform((value) => value || null);

export const onlineCheckinSubmitSchema = z
  .object({
    primary: z.object({ identity: guestIdentitySchema, documentIds: documentIdsField }),
    companions: z.array(z.object({ person: companionSchema, documentIds: documentIdsField })).max(MAX_COMPANIONS, `En fazla ${MAX_COMPANIONS} refakatçi`).default([]),
    vehiclePlate: z
      .string()
      .trim()
      .max(20, 'Plaka çok uzun')
      .transform((value) => normalizePlate(value) || null)
      .refine((value) => value === null || /^[A-Z0-9 -]{2,15}$/.test(value), { message: 'Plaka yalnızca harf, rakam ve boşluktan oluşmalı' })
      .nullish(),
    arrivalTime: arrivalTimeField,
    paymentPreference: z.enum(ONLINE_CHECKIN_PAYMENT_PREFERENCES, { error: 'Ödeme tercihi seçin' }),
    note: z.string().trim().max(500, 'Not en fazla 500 karakter').nullish().transform((value) => value || null),
    consents: z.object({
      privacy: z.literal(true, { error: 'Aydınlatma metni onaylanmalı' }),
      rules: z.literal(true, { error: 'Konaklama kuralları onaylanmalı' }),
      documentPhotos: z.literal(true, { error: 'Belge fotoğrafı için açık rıza gerekli' }),
      marketing: z.boolean().default(false),
    }),
    signature: z.object({ contentType: z.literal('image/png'), image: base64Field('İmza', ONLINE_CHECKIN_SIGNATURE_MAX_BYTES) }),
    language: z.enum(GUEST_PORTAL_LANGUAGES).default('tr'),
  })
  .superRefine((value, ctx) => {
    for (const { person, problem } of onlineCheckinPhotoProblems(value)) {
      const path = person === 0 ? ['primary', 'documentIds'] : ['companions', person - 1, 'documentIds'];
      ctx.addIssue({ code: 'custom', path, message: problem === 'PHOTO_REQUIRED' ? 'Belge fotoğrafı zorunlu' : 'Fazla fotoğraf' });
    }
    const all = [value.primary.documentIds, ...value.companions.map((row) => row.documentIds)].flat();
    if (new Set(all).size !== all.length) ctx.addIssue({ code: 'custom', path: ['companions'], message: 'Aynı fotoğraf iki kişiye bağlanamaz' });
  });

/** Misafirin portaldan isteği (konaklamada). Kategoriler resepsiyonun istek kategorileri. */
export const guestPortalRequestSchema = z.object({
  category: z.enum(GUEST_REQUEST_CATEGORIES, { error: 'Kategori seçin' }),
  description: z.string({ error: 'İsteğinizi yazın' }).trim().min(3, 'İsteğinizi yazın').max(1000, 'En fazla 1000 karakter'),
});

/* ─────────────── Şemalar: personel ─────────────── */

export const onlineCheckinListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(ONLINE_CHECKIN_STATUSES).optional(),
  /** Giriş günü aralığı. */
  from: isoDayField.optional(),
  to: isoDayField.optional(),
  search: z.string().trim().max(100).optional(),
});
export const onlineCheckinParamSchema = z.object({ onlineCheckinId: uuid('Geçersiz kayıt') });
export const onlineCheckinDocumentStaffParamSchema = onlineCheckinParamSchema.extend({ documentId: uuid('Geçersiz belge') });
export const onlineCheckinApproveSchema = z.object({ expectedUpdatedAt });
export const onlineCheckinRejectSchema = z.object({
  expectedUpdatedAt,
  reason: z.string({ error: 'Misafire gidecek sebebi yazın' }).trim().min(3, 'Misafire gidecek sebebi yazın').max(500, 'En fazla 500 karakter'),
});
export const guestPortalReservationParamSchema = z.object({ reservationId: uuid('Geçersiz rezervasyon') });

const textBlock = z.object(
  Object.fromEntries(GUEST_PORTAL_TEXT_KEYS.map((key) => [key, z.string().trim().max(GUEST_PORTAL_TEXT_MAX[key], `En fazla ${GUEST_PORTAL_TEXT_MAX[key]} karakter`).default('')])),
);
const limitField = (key, label) =>
  z.coerce
    .number({ error: `${label} sayı olmalı` })
    .int(`${label} tam sayı olmalı`)
    .min(GUEST_PORTAL_SETTING_LIMITS[key].min, `${label} en az ${GUEST_PORTAL_SETTING_LIMITS[key].min}`)
    .max(GUEST_PORTAL_SETTING_LIMITS[key].max, `${label} en fazla ${GUEST_PORTAL_SETTING_LIMITS[key].max}`);

export const guestPortalSettingsSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAt.nullish(),
  enabled: z.boolean(),
  inviteDaysBefore: limitField('inviteDaysBefore', 'Davet günü'),
  checkinOpenDays: limitField('checkinOpenDays', 'Açılış günü'),
  documentRetentionDays: limitField('documentRetentionDays', 'Saklama süresi'),
  /** Davet bağlantısının tabanı: panelin herkese açık adresi. Boşsa otomatik davet gitmez. */
  publicBaseUrl: z
    .string()
    .trim()
    .max(200, 'Adres en fazla 200 karakter')
    .transform((value) => value.replace(/\/+$/, ''))
    .refine((value) => value === '' || /^https:\/\/[^\s/]+$/.test(value) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(value), {
      message: 'Adres "https://alan-adi" biçiminde olmalı (yol olmadan)',
    })
    .transform((value) => value || null)
    .nullish(),
  texts: z.object(Object.fromEntries(GUEST_PORTAL_LANGUAGES.map((language) => [language, textBlock.default({})]))),
});
