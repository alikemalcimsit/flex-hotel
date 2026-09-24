import { z } from './locale.js';
import { dateField, expectedUpdatedAt, paginationQuerySchema } from './fields.js';
import { MAX_PARTY_ADULTS, MAX_PARTY_CHILDREN, moneyInputField } from './reservations.js';

/**
 * Ön büro: check-in / check-out sözleşmeleri (modül 6).
 *
 * Kimlik bilgisi Kimlik Bildirim Sistemi'ne (KBS) giden bilgidir: yanlış
 * numarayla giriş yapan misafir emniyete yanlış bildirilir. Bu yüzden TC kimlik
 * numarası sağlamasıyla denetlenir, pasaport numarası biçimiyle. Kimlik
 * numarası kişisel veridir (KVKK): listelerde maskelenir, denetim izine
 * maskeli yazılır (`maskIdNumber`).
 *
 * Kart numarası hiçbir alana yazılmaz (PCI DSS): teminat referansına ya da
 * nota kart numarasına benzeyen bir dizi girilirse reddedilir.
 */

/* ─────────────── Politikalar ─────────────── */

/** Prisma `StayFeeMode` ile birebir. */
export const STAY_FEE_MODES = Object.freeze(['NONE', 'FIXED', 'PERCENT_OF_NIGHT']);

export const STAY_FEE_MODE_LABELS = Object.freeze({
  NONE: 'Ücret yok',
  FIXED: 'Sabit tutar',
  PERCENT_OF_NIGHT: 'Gecelik fiyatın yüzdesi',
});

/** Prisma `IdentityPolicy` ile birebir. */
export const IDENTITY_POLICIES = Object.freeze(['PRIMARY_GUEST', 'ALL_ADULTS']);

export const IDENTITY_POLICY_LABELS = Object.freeze({
  PRIMARY_GUEST: 'Yalnızca rezervasyon sahibi',
  ALL_ADULTS: 'Bütün yetişkinler',
});

/** Prisma `IdDocumentType` ile birebir. */
export const ID_DOCUMENT_TYPES = Object.freeze(['NATIONAL_ID', 'PASSPORT', 'OTHER']);

export const ID_DOCUMENT_TYPE_LABELS = Object.freeze({
  NATIONAL_ID: 'Kimlik kartı',
  PASSPORT: 'Pasaport',
  OTHER: 'Diğer belge',
});

/** Prisma `DepositMethod` ile birebir. */
export const DEPOSIT_METHODS = Object.freeze(['NONE', 'CASH', 'CARD_PREAUTH', 'TRANSFER']);

export const DEPOSIT_METHOD_LABELS = Object.freeze({
  NONE: 'Teminat yok',
  CASH: 'Nakit',
  CARD_PREAUTH: 'Kart provizyonu',
  TRANSFER: 'Havale / EFT',
});

/* ─────────────── Listeler ─────────────── */

/** Gelecekler: girişi beklenenler ya da bugün giriş yapmış olanlar. */
export const ARRIVAL_VIEWS = Object.freeze(['EXPECTED', 'CHECKED_IN']);

export const ARRIVAL_VIEW_LABELS = Object.freeze({ EXPECTED: 'Bekleniyor', CHECKED_IN: 'Bugün girenler' });

/** Gidecekler: çıkışı bugün (ya da geçmiş) olan içerideki misafirler ya da bugün çıkanlar. */
export const DEPARTURE_VIEWS = Object.freeze(['EXPECTED', 'CHECKED_OUT']);

export const DEPARTURE_VIEW_LABELS = Object.freeze({ EXPECTED: 'Çıkacaklar', CHECKED_OUT: 'Bugün çıkanlar' });

export const IN_HOUSE_SORTS = Object.freeze(['CHECK_OUT_ASC', 'CHECK_IN_DESC', 'ROOM_ASC']);

export const IN_HOUSE_SORT_LABELS = Object.freeze({
  CHECK_OUT_ASC: 'Çıkışı yakın olan önce',
  CHECK_IN_DESC: 'Son giren önce',
  ROOM_ASC: 'Oda numarası',
});

/* ─────────────── Sınırlar ─────────────── */

export const MAX_ID_NUMBER_LENGTH = 20;
export const MAX_PLATE_LENGTH = 15;
export const MAX_DEPOSIT_REFERENCE_LENGTH = 40;
export const MAX_STAY_REASON_LENGTH = 500;
/** Refakatçi: kişi sayısı kadar (sahibi hariç). */
export const MAX_COMPANIONS = MAX_PARTY_ADULTS + MAX_PARTY_CHILDREN - 1;
/** Doğum tarihi en fazla bu kadar yıl önce olabilir (yazım hatasını yakalamak için). */
export const MAX_GUEST_AGE_YEARS = 120;

/**
 * ISO 3166-1 alpha-2 ülke kodları (uyruk). Adları ekranda
 * `Intl.DisplayNames` ile Türkçe gösterilir; burada yalnızca kodlar.
 */
export const COUNTRY_CODES = Object.freeze(
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW ' +
    'BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI ' +
    'FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN ' +
    'IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME ' +
    'MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF ' +
    'PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV ' +
    'SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK ' +
    'YE YT ZA ZM ZW'
  ).split(' '),
);

const COUNTRY_SET = new Set(COUNTRY_CODES);

/* ─────────────── Kimlik ─────────────── */

/**
 * TC kimlik numarası sağlaması: 11 hane, ilk hane 0 değil; 10. hane
 * ((tekler toplamı × 7) − çiftler toplamı) mod 10; 11. hane ilk 10 hanenin
 * toplamı mod 10.
 * @param {string} value
 */
export function isValidTurkishIdNumber(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d{10}$/.test(text)) return false;
  const digits = [...text].map(Number);
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  if (tenth !== digits[9]) return false;
  const eleventh = digits.slice(0, 10).reduce((total, digit) => total + digit, 0) % 10;
  return eleventh === digits[10];
}

/**
 * Belge numarası saklanan biçimi: büyük harf, boşluk ve tire yok.
 * @param {string | null | undefined} value
 */
export function normalizeIdNumber(value) {
  return String(value ?? '')
    .toLocaleUpperCase('tr')
    .replace(/[\s-]/g, '')
    .replace(/İ/g, 'I');
}

/**
 * Belge numarası kurala uyuyor mu? Uymuyorsa gösterilecek sebep.
 * - Türk vatandaşının kimlik kartı: TC kimlik no (sağlamalı).
 * - Pasaport ve diğer belgeler: 5–20 harf/rakam.
 *
 * @param {{ idType: string, idNumber: string, nationality: string }} identity
 * @returns {string | null}
 */
export function identityNumberError({ idType, idNumber, nationality }) {
  const number = normalizeIdNumber(idNumber);
  if (!number) return 'Belge numarası zorunlu';
  if (idType === 'NATIONAL_ID' && nationality === 'TR') {
    return isValidTurkishIdNumber(number) ? null : 'TC kimlik numarası geçersiz (11 hane; son iki hane sağlama)';
  }
  if (!/^[A-Z0-9]{5,20}$/.test(number)) return 'Belge numarası 5–20 harf ya da rakam olmalı';
  return null;
}

/**
 * Kimlik numarasını maskeler: ilk 3 ve son 2 karakter görünür.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function maskIdNumber(value) {
  const text = normalizeIdNumber(value);
  if (!text) return null;
  if (text.length <= 5) return `${text[0]}${'•'.repeat(text.length - 1)}`;
  return `${text.slice(0, 3)}${'•'.repeat(text.length - 5)}${text.slice(-2)}`;
}

/**
 * Metinde kart numarasına benzeyen (13–19 hane, boşluk/tire ile yazılmış
 * olabilir, Luhn sağlamasını geçen) bir dizi var mı? Kart numarası
 * saklanmaz; provizyon numarası bu kadar uzun ve Luhn'lu olmaz.
 * @param {string | null | undefined} text
 */
export function looksLikeCardNumber(text) {
  const candidates = String(text ?? '').match(/\d[\d\s-]{11,}\d/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let total = 0;
    for (let index = 0; index < digits.length; index += 1) {
      let digit = Number(digits[digits.length - 1 - index]);
      if (index % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      total += digit;
    }
    return total % 10 === 0;
  });
}

/**
 * Araç plakası: büyük harf, tek boşluk ("34 ABC 123"). Yabancı plakalar da
 * kabul edilir; yalnızca harf, rakam, boşluk ve tire.
 * @param {string | null | undefined} value
 */
export function normalizePlate(value) {
  return String(value ?? '')
    .toLocaleUpperCase('tr')
    .replace(/İ/g, 'I')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ─────────────── Şema parçaları ─────────────── */

const nameField = (label) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .min(1, `${label} zorunlu`)
    .max(100, `${label} en fazla 100 karakter`);

const reasonField = (label) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(1, `${label} yazın`)
    .max(MAX_STAY_REASON_LENGTH, `${label} en fazla ${MAX_STAY_REASON_LENGTH} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' });

const nationalityField = z
  .string({ error: 'Uyruk zorunlu' })
  .trim()
  .toUpperCase()
  .refine((value) => COUNTRY_SET.has(value), { message: 'Uyruk listeden seçilmeli' });

/**
 * Doğum tarihi: geçmişte ve makul (120 yıldan eski değil). Gün hassasiyetli.
 * `today` kullanılmaz: sözleşme saatten bağımsız olmalı; "gelecek tarih"
 * denetimi yarın doğmuş biri kadar hata payıyla yeterli.
 */
const birthDateField = dateField
  .refine((value) => value.getTime() <= Date.now(), { message: 'Doğum tarihi gelecekte olamaz' })
  .refine((value) => value.getUTCFullYear() >= new Date().getUTCFullYear() - MAX_GUEST_AGE_YEARS, {
    message: 'Doğum tarihi çok eski; yazım hatası olabilir',
  });

/**
 * Belge alanları. `required` değilse hepsi boş bırakılabilir; biri doluysa
 * belge eksiksiz olmalı (yarım kimlik KBS'ye gönderilemez).
 */
const identityShape = {
  idType: z.enum(ID_DOCUMENT_TYPES, { error: 'Belge türü seçin' }).nullish(),
  idNumber: z
    .string()
    .trim()
    .max(MAX_ID_NUMBER_LENGTH + 10, 'Belge numarası çok uzun')
    .transform((value) => normalizeIdNumber(value) || null)
    .nullish(),
  nationality: nationalityField.nullish(),
  birthDate: birthDateField.nullish(),
};

/**
 * @param {{ idType?: string | null, idNumber?: string | null, nationality?: string | null }} value
 * @param {import('zod').RefinementCtx} ctx
 * @param {boolean} required
 */
function refineIdentity(value, ctx, required) {
  const any = Boolean(value.idType || value.idNumber || value.nationality);
  if (!required && !any) return;
  if (!value.idType) ctx.addIssue({ code: 'custom', path: ['idType'], message: 'Belge türü seçin' });
  if (!value.nationality) ctx.addIssue({ code: 'custom', path: ['nationality'], message: 'Uyruk seçin' });
  if (!value.idNumber) {
    ctx.addIssue({ code: 'custom', path: ['idNumber'], message: 'Belge numarası zorunlu' });
    return;
  }
  if (value.idType && value.nationality) {
    const problem = identityNumberError(/** @type {any} */ (value));
    if (problem) ctx.addIssue({ code: 'custom', path: ['idNumber'], message: problem });
  }
}

/** Rezervasyon sahibinin kimliği (girişte her zaman zorunlu). */
export const guestIdentitySchema = z.object(identityShape).superRefine((value, ctx) => refineIdentity(value, ctx, true));

/**
 * Refakatçi: yetişkinse belge zorunlu (KBS her yetişkini ister), çocukta
 * isteğe bağlı.
 */
export const companionSchema = z
  .object({
    firstName: nameField('Ad'),
    lastName: nameField('Soyad'),
    isChild: z.boolean().default(false),
    ...identityShape,
  })
  .superRefine((value, ctx) => refineIdentity(value, ctx, !value.isChild));

export const depositSchema = z
  .object({
    method: z.enum(DEPOSIT_METHODS, { error: 'Teminat türü seçin' }).default('NONE'),
    amount: moneyInputField.nullish(),
    reference: z
      .string()
      .trim()
      .max(MAX_DEPOSIT_REFERENCE_LENGTH, `Referans en fazla ${MAX_DEPOSIT_REFERENCE_LENGTH} karakter`)
      .refine((value) => !looksLikeCardNumber(value), {
        message: 'Kart numarası yazılamaz; provizyon ya da dekont numarasını yazın',
      })
      .transform((value) => value || null)
      .nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.method === 'NONE') return;
    if (!value.amount || Number(value.amount) <= 0) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Teminat tutarını yazın' });
    }
  });

/* ─────────────── Giriş / çıkış ─────────────── */

export const checkInSchema = z.object({
  expectedUpdatedAt,
  /** Oda seçilmemişse ya da personel başka oda veriyorsa (atama aynı işlemde). */
  roomId: z.string().uuid({ message: 'Geçersiz oda' }).nullish(),
  /** Oda kirli / temizleniyor: personel gördü, yine de giriş yapılıyor. */
  acceptRoomNotReady: z.boolean().default(false),
  guest: guestIdentitySchema,
  companions: z.array(companionSchema).max(MAX_COMPANIONS, `En fazla ${MAX_COMPANIONS} refakatçi`).default([]),
  vehiclePlate: z
    .string()
    .trim()
    .max(MAX_PLATE_LENGTH + 5, 'Plaka çok uzun')
    .transform((value) => normalizePlate(value) || null)
    .refine((value) => value === null || (/^[A-Z0-9 -]{2,15}$/.test(value)), {
      message: `Plaka yalnızca harf, rakam ve boşluktan oluşmalı (en fazla ${MAX_PLATE_LENGTH})`,
    })
    .nullish(),
  deposit: depositSchema.default({ method: 'NONE' }),
  waiveEarlyFee: z.boolean().default(false),
  /**
   * Personelin gördüğü erken giriş ücreti. Sunucu ücreti yeniden hesaplar;
   * farklıysa (saat geçti) yazmaz, yeni tutarı gösterir.
   */
  expectedEarlyFee: moneyInputField.nullish(),
});

export const checkOutSchema = z
  .object({
    expectedUpdatedAt,
    /** Çıkış tarihinden önce ayrılış: kalan geceler bırakılır (personel onayladı). */
    confirmEarlyDeparture: z.boolean().default(false),
    waiveLateFee: z.boolean().default(false),
    /** Personelin gördüğü geç çıkış ücreti (bkz. `expectedEarlyFee`). */
    expectedLateFee: moneyInputField.nullish(),
    /** Bakiye kapanmadan çıkış (ayrı yetki). */
    allowOpenBalance: z.boolean().default(false),
    openBalanceReason: z
      .string()
      .trim()
      .max(MAX_STAY_REASON_LENGTH, `Gerekçe en fazla ${MAX_STAY_REASON_LENGTH} karakter`)
      .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' })
      .transform((value) => value || null)
      .nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.allowOpenBalance && !value.openBalanceReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['openBalanceReason'],
        message: 'Bakiyeyle çıkışın gerekçesini yazın (ör. "şirket faturası ay sonunda ödenecek")',
      });
    }
  });

/** Yanlışlıkla yapılan giriş / çıkışı geri alma (aynı gün). */
export const revertStaySchema = z.object({
  expectedUpdatedAt,
  reason: reasonField('Geri alma sebebini'),
});

/* ─────────────── Liste sorguları ─────────────── */

const searchField = z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional();

export const arrivalsQuerySchema = paginationQuerySchema.extend({
  view: z.enum(ARRIVAL_VIEWS, { error: 'Geçersiz görünüm' }).default('EXPECTED'),
  search: searchField,
});

export const departuresQuerySchema = paginationQuerySchema.extend({
  view: z.enum(DEPARTURE_VIEWS, { error: 'Geçersiz görünüm' }).default('EXPECTED'),
  search: searchField,
});

export const inHouseQuerySchema = paginationQuerySchema.extend({
  search: searchField,
  sort: z.enum(IN_HOUSE_SORTS, { error: 'Geçersiz sıralama' }).default('CHECK_OUT_ASC'),
});

export const stayParamSchema = z.object({
  reservationId: z.string().uuid({ message: 'Geçersiz rezervasyon' }),
});

/* ─────────────── Ayarlar ─────────────── */

/**
 * Ücret politikası: "ücret yok" dışında değer pozitif; yüzde 100'ü geçemez.
 * @param {{ mode?: string, value?: string }} policy
 * @returns {string | null}
 */
export function stayFeePolicyError({ mode, value }) {
  if (!mode || mode === 'NONE') return null;
  const amount = Number(value ?? 0);
  if (!(amount > 0)) return mode === 'FIXED' ? 'Ücret tutarını yazın' : 'Yüzdeyi yazın';
  if (mode === 'PERCENT_OF_NIGHT' && amount > 100) return 'Yüzde 100\'ü geçemez';
  return null;
}
