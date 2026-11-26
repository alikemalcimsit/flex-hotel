import { z } from './locale.js';
import { EMAIL_PATTERN, expectedUpdatedAt } from './fields.js';
import { PERMISSIONS, ROLES } from './permissions.js';
import { reportRangeError } from './reports.js';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './users.js';

/**
 * Zincir konsolu sözleşmeleri (modül 63).
 *
 * ### Kavramlar
 *
 * - **Zincir** (`HotelGroup`): birden çok otel. Bir otel en fazla bir zincirdedir (`Hotel.groupId`).
 * - **Ana otel**: kullanıcının kaydının bağlı olduğu otel (`User.hotelId` + `User.role`). Giriş her zaman ana otele açılır.
 * - **Otel erişimi** (`UserHotel`): kullanıcıya ana oteli dışında bir otelde, o otele özgü bir rolle verilen erişim.
 *   Üst bardaki otel seçici bu erişimler arasında geçirir; geçişte yeni oturum (token) o otelin kimliği ve rolüyle açılır.
 *   Erişim kişiyi o otelin personel listesine (atama seçicileri, bordro) eklemez; kimlik, izin, zil ve onaylar o otelde
 *   geçerlidir.
 * - **Zincir görünümü** (pano, rapor): yalnız kişinin erişimi olan VE oradaki rolü `chain.view` izni taşıyan oteller.
 *   Başka bir otelin rakamı, o otelde yetkisi olmayana hiçbir yoldan görünmez.
 *
 * Bu dosya tarayıcıda da çalışır (düğme gizleme ve form doğrulaması aynı kuralı kullanır).
 */

/* ─────────────── Sınırlar ─────────────── */

/** Bir zincirdeki en fazla otel (pano ve rapor her oteli ayrı hesaplar; sınır yükü öngörülebilir tutar). */
export const CHAIN_MAX_HOTELS = 200;
/** Pano / rapor hesaplanırken aynı anda hesaplanan otel sayısı (veritabanı bağlantı havuzunu tek istek tüketmesin). */
export const CHAIN_COMPUTE_CONCURRENCY = 4;
/** Otel seçicide ve listelerde bir sayfa. */
export const CHAIN_PAGE_DEFAULT = 50;
export const CHAIN_PAGE_MAX = 100;
/** Kişi başına en fazla otel erişimi (zincir sınırıyla aynı). */
export const CHAIN_MAX_MEMBERSHIPS_PER_USER = CHAIN_MAX_HOTELS;

/* ─────────────── Kopyalanan ayarlar (yeni otel sihirbazı) ─────────────── */

/**
 * Yeni otele kaynak otelden kopyalanabilen ayar grupları (modül 1 + rol matrisi). Odalar, misafirler, rezervasyon ve
 * para hareketleri, yasal kimlikler (fatura, KBS) ve dış sistem şifreleri (kanal yöneticisi, entegratör) **kopyalanmaz**:
 * her otelin kendine ait olmak zorunda.
 */
export const HOTEL_COPY_GROUPS = Object.freeze(['GENERAL', 'ROOM_TYPES', 'TAXES', 'SEASONS', 'ROLE_MATRIX']);

export const HOTEL_COPY_GROUP_LABELS = Object.freeze({
  GENERAL: 'Genel parametreler',
  ROOM_TYPES: 'Oda tipleri',
  TAXES: 'Vergiler',
  SEASONS: 'Sezonlar',
  ROLE_MATRIX: 'Rol ve izin matrisi',
});

export const HOTEL_COPY_GROUP_HINTS = Object.freeze({
  GENERAL: 'Giriş / çıkış saati, pansiyon, iptal ve overbooking politikası, erken giriş / geç çıkış ücreti, kimlik kuralı, büyük ödeme eşiği, eşikler',
  ROOM_TYPES: 'Kod, ad, kapasite, taban fiyat ve açıklama (odalar kopyalanmaz: her otelin kendi oda numaraları var)',
  TAXES: 'KDV ve konaklama vergisi gibi oranlar, fiyata dahil olup olmadığı',
  SEASONS: 'Ad, tarih aralığı ve fiyat çarpanı',
  ROLE_MATRIX: 'Hangi rolün hangi izne sahip olduğu (kullanıcılar kopyalanmaz)',
});

/* ─────────────── Erişim kuralları (saf) ─────────────── */

/**
 * Kullanıcının bir oteldeki rolü: ana otelse kaydın rolü, değilse o otele verilmiş erişimin rolü; ikisi de yoksa `null`.
 *
 * @param {{ hotelId: string, role: string }} user ana otel ve rolü
 * @param {Array<{ hotelId: string, role: string }>} memberships ana otel dışındaki erişimler
 * @param {string} hotelId
 * @returns {string | null}
 */
export function roleInHotel(user, memberships, hotelId) {
  if (user.hotelId === hotelId) return user.role;
  return memberships.find((membership) => membership.hotelId === hotelId)?.role ?? null;
}

/**
 * Bir kişinin bir oteldeki erişimini verme / değiştirme / kaldırma kuralı. Engel varsa sebebi döner.
 *
 * - Yapan kişi hedef otelde kullanıcı yönetme iznine sahip olmalı (erişimini başka yoldan "yükseltemez").
 * - Yönetici (ADMIN) rolünü yalnız o otelde zaten yönetici olan verir; yöneticinin erişimine de yalnız yönetici dokunur.
 * - Kişi kendi erişimini değiştiremez (kendine rol yükseltmek ya da son yetkisini kazara kaldırmak olmasın).
 * - Ana otel erişimle verilmez: oradaki rol kullanıcı kaydındadır (kullanıcılar ekranı).
 *
 * @param {{
 *   actorId: string,
 *   actorRole: string | null,            hedef oteldeki rolü (yoksa null)
 *   actorPermissions: readonly string[], hedef oteldeki izinleri
 *   targetUserId: string,
 *   targetHomeHotelId: string,
 *   hotelId: string,
 *   currentRole: string | null,          kişinin o oteldeki mevcut erişim rolü (yoksa null)
 *   nextRole: string | null,             verilecek rol (kaldırmada null)
 * }} input
 * @returns {string | null}
 */
export function membershipChangeError({ actorId, actorRole, actorPermissions, targetUserId, targetHomeHotelId, hotelId, currentRole, nextRole }) {
  if (targetUserId === actorId) return 'Kendi otel erişiminizi değiştiremezsiniz; başka bir yöneticiden isteyin';
  if (targetHomeHotelId === hotelId) return 'Bu otel kişinin ana oteli: oradaki rolü kullanıcılar ekranından değişir';
  if (!actorRole || !actorPermissions.includes(PERMISSIONS.USERS_MANAGE)) {
    return 'Bu otelde kullanıcı yönetme yetkiniz yok';
  }
  if ((nextRole === 'ADMIN' || currentRole === 'ADMIN') && actorRole !== 'ADMIN') {
    return 'Yönetici erişimini yalnız o otelin yöneticisi verir ya da kaldırır';
  }
  return null;
}

/**
 * Otel bir zincire eklenebilir / zincirden çıkarılabilir mi? Kişi o otelde yönetici olmalı (otelin rakamları zincire
 * açılır), zincirde de `chain.manage` taşımalı.
 *
 * @param {{ roleInHotel: string | null, canManageChain: boolean }} input
 * @returns {string | null}
 */
export function hotelAttachError({ roleInHotel: role, canManageChain }) {
  if (!canManageChain) return 'Zinciri yönetme yetkiniz yok';
  if (role !== 'ADMIN') return 'Oteli zincire yalnız o otelin yöneticisi ekler ya da çıkarır';
  return null;
}

/* ─────────────── Şemalar ─────────────── */

const uuid = (message) => z.string({ error: message }).uuid({ message });

/** Otel kodu: büyük harf, rakam ve tire; girişte ve adreslerde görünür. */
export const HOTEL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/;

const nameField = (label, max = 200) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .min(1, `${label} zorunlu`)
    .max(max, `${label} en fazla ${max} karakter`);

const optionalText = (label, max) => z.string().trim().max(max, `${label} en fazla ${max} karakter`).optional().nullable();

/**
 * Otel geçişi: hedef otel + açık oturumun yenileme token'ı (geçişte iptal edilir, yenisi hedef otel için verilir;
 * aynı token'la iki otelde paralel oturum kalmaz).
 */
export const switchHotelSchema = z.object({
  hotelId: uuid('Geçersiz otel'),
  refreshToken: z.string({ error: 'Oturum anahtarı zorunlu' }).min(1, 'Oturum anahtarı zorunlu').max(500),
});

export const myHotelsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(CHAIN_PAGE_MAX).default(CHAIN_PAGE_DEFAULT),
});

export const chainGroupCreateSchema = z.object({ name: nameField('Zincir adı', 120) });

export const chainGroupUpdateSchema = z.object({ name: nameField('Zincir adı', 120), expectedUpdatedAt });

export const chainHotelParamSchema = z.object({ hotelId: uuid('Geçersiz otel') });

export const chainHotelListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(CHAIN_PAGE_MAX).default(CHAIN_PAGE_DEFAULT),
});

/** Yeni otel sihirbazı: kimlik + kaynak otel + kopyalanacak gruplar. */
export const chainHotelCreateSchema = z.object({
  name: nameField('Otel adı'),
  code: z
    .string({ error: 'Otel kodu zorunlu' })
    .trim()
    .toUpperCase()
    .regex(HOTEL_CODE_PATTERN, 'Otel kodu 2-20 karakter: büyük harf, rakam ve tire (ör. ANK-01)'),
  timezone: nameField('Saat dilimi', 100),
  currency: z
    .string({ error: 'Para birimi zorunlu' })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Para birimi 3 harfli ISO kodu olmalı (TRY, EUR, USD)'),
  address: optionalText('Adres', 500),
  phone: optionalText('Telefon', 40),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === '' || EMAIL_PATTERN.test(value), { message: 'Geçerli bir e-posta girin' })
    .optional()
    .nullable(),
  sourceHotelId: uuid('Kaynak otel seçin'),
  copy: z
    .array(z.enum(HOTEL_COPY_GROUPS, { error: 'Geçersiz ayar grubu' }))
    .max(HOTEL_COPY_GROUPS.length)
    .default([...HOTEL_COPY_GROUPS])
    .transform((list) => [...new Set(list)]),
});

export const chainReportQuerySchema = z
  .object({
    from: z.string({ error: 'Başlangıç tarihi zorunlu' }).trim(),
    to: z.string({ error: 'Bitiş tarihi zorunlu' }).trim(),
  })
  .superRefine((value, ctx) => {
    const error = reportRangeError(value.from, value.to);
    if (error) ctx.addIssue({ code: 'custom', path: [error.field], message: error.message });
  });

export const chainUserListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  hotelId: uuid('Geçersiz otel').optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(CHAIN_PAGE_MAX).default(CHAIN_PAGE_DEFAULT),
});

export const chainUserParamSchema = z.object({ userId: uuid('Geçersiz kullanıcı') });

export const chainMembershipParamSchema = z.object({ userId: uuid('Geçersiz kullanıcı'), hotelId: uuid('Geçersiz otel') });

/** Erişim ver / rolünü değiştir. */
export const chainMembershipSchema = z.object({ role: z.enum(ROLES, { error: 'Geçersiz rol' }) });

/** Zincirden yeni kullanıcı: ana oteli seçilir (orada kullanıcı yönetme yetkisi gerekir). */
export const chainUserCreateSchema = z.object({
  homeHotelId: uuid('Ana otel seçin'),
  email: z
    .string({ error: 'E-posta zorunlu' })
    .trim()
    .toLowerCase()
    .min(1, 'E-posta zorunlu')
    .max(200, 'E-posta en fazla 200 karakter')
    .refine((value) => EMAIL_PATTERN.test(value), { message: 'Geçerli bir e-posta girin' }),
  name: nameField('Ad'),
  role: z.enum(ROLES, { error: 'Geçersiz rol' }),
  password: z
    .string({ error: 'Şifre zorunlu' })
    .min(MIN_PASSWORD_LENGTH, `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı`)
    .max(MAX_PASSWORD_LENGTH, `Şifre en fazla ${MAX_PASSWORD_LENGTH} karakter`),
});
