import { BOARD_TYPES } from './constants.js';
import { decimalField, expectedUpdatedAt, dateField, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';
import { MAX_RESERVATION_TOTAL, guestInputSchema, moneyInputField } from './reservations.js';

/**
 * Acente ve kontrat sözleşmeleri (modül 29).
 *
 * Kararlar (kullanıcı, 5 Ekim 2026):
 * - **Fiyat birimi:** oda başı gecelik; oda tipi × pansiyon × dönem. Kişi başı
 *   ek, tek kişi farkı ve çocuk indirimi modül 28'in konusu.
 * - **Fiyatı olmayan gece:** acente rezervasyonunda kontratta fiyatı olmayan
 *   (tip, pansiyon ya da tarih kontrat dışı) ya da stop-sale'deki gece
 *   reddedilir. İstisna için yetkili personel fiyatı elle girer (gerekçeli);
 *   stop-sale elle fiyatla da aşılmaz.
 * - **Aktif kontrat:** fiyatları denetim iziyle değişebilir; yalnızca yeni
 *   açılan rezervasyonları etkiler (açılmış rezervasyonun gece fiyatı açıldığı
 *   gün neyse o kalır).
 * - **Sonradan acente:** bekleyen ve onaylı rezervasyona acente atanabilir /
 *   değiştirilebilir (geceler yeniden fiyatlanır); içerideki misafirde değişmez.
 *
 * Kontrat para birimi otelin para birimidir (çoklu para: modül 60). Tarihler
 * gün hassasiyetindedir ve **iki ucu da dahildir** (kontrat 1 Haz – 30 Eyl:
 * 30 Eylül gecesi dahil).
 */

/* ─────────────── Durumlar ─────────────── */

/** Prisma `AgencyStatus` ile birebir. Pasif acentede yeni rezervasyon açılmaz. */
export const AGENCY_STATUSES = Object.freeze(['ACTIVE', 'PASSIVE']);

export const AGENCY_STATUS_LABELS = Object.freeze({
  ACTIVE: 'Aktif',
  PASSIVE: 'Pasif',
});

/**
 * Prisma `ContractStatus` ile birebir.
 * - `DRAFT`: hazırlanıyor, satışa kapalı.
 * - `ACTIVE`: satışta; acentenin aynı günü kapsayan tek aktif kontratı olur.
 * - `ENDED`: elle sonlandırıldı (geri açılmaz); açılmış rezervasyonlar etkilenmez.
 */
export const CONTRACT_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'ENDED']);

export const CONTRACT_STATUS_LABELS = Object.freeze({
  DRAFT: 'Taslak',
  ACTIVE: 'Satışta',
  ENDED: 'Sonlandırıldı',
});

/**
 * Acente satışının reddedilme sebepleri: hata `code`'u ve önizlemedeki
 * `issue.code` aynı değerlerdir.
 * - `AGENCY_NOT_FOUND` / `AGENCY_PASSIVE`: acente yok ya da pasif.
 * - `AGENCY_NO_CONTRACT`: bu gecede acentenin satıştaki kontratı yok.
 * - `AGENCY_NO_RATE`: kontrat var ama bu oda tipi + pansiyon için fiyat yok.
 * - `AGENCY_STOP_SALE`: kontratın stop-sale'inde.
 */
export const AGENCY_SALE_ISSUES = Object.freeze([
  'AGENCY_NOT_FOUND',
  'AGENCY_PASSIVE',
  'AGENCY_NO_CONTRACT',
  'AGENCY_NO_RATE',
  'AGENCY_STOP_SALE',
]);

export const AGENCY_SALE_ISSUE_LABELS = Object.freeze({
  AGENCY_NOT_FOUND: 'Acente bulunamadı',
  AGENCY_PASSIVE: 'Acente pasif',
  AGENCY_NO_CONTRACT: 'Kontrat yok',
  AGENCY_NO_RATE: 'Kontratta fiyat yok',
  AGENCY_STOP_SALE: 'Stop-sale',
});

/* ─────────────── Sınırlar ─────────────── */

export const MAX_AGENCY_CODE_LENGTH = 20;
export const MAX_AGENCY_NAME_LENGTH = 120;
export const MAX_AGENCY_CONTACT_LENGTH = 100;
export const MAX_AGENCY_ADDRESS_LENGTH = 300;
export const MAX_AGENCY_TAX_OFFICE_LENGTH = 100;
export const MAX_AGENCY_TAX_NUMBER_LENGTH = 30;
export const MAX_AGENCY_NOTES_LENGTH = 1000;
/** Komisyon yüzdesi üst sınırı. */
export const MAX_COMMISSION_PCT = 100;
/** Vade (çıkıştan sonra ödeme günü) üst sınırı. */
export const MAX_PAYMENT_TERM_DAYS = 365;

export const MAX_CONTRACT_NAME_LENGTH = 120;
export const MAX_CONTRACT_NOTES_LENGTH = 1000;
/** Tek kontratın en uzun dönemi (gün; yaklaşık üç yıl). */
export const MAX_CONTRACT_DAYS = 1100;
/** Bir kontrattaki en fazla fiyat satırı (oda tipi × pansiyon × dönem). */
export const MAX_CONTRACT_RATES = 2000;
/** Bir kontrattaki en fazla stop-sale kaydı. */
export const MAX_CONTRACT_STOP_SALES = 500;
export const MAX_STOP_SALE_REASON_LENGTH = 200;
export const MAX_CONTRACT_END_REASON_LENGTH = 300;
export const MIN_CONTRACT_END_REASON_LENGTH = 5;
/** Rezervasyon formundaki acente seçicisinde bir aramada gösterilen en fazla acente. */
export const AGENCY_OPTIONS_LIMIT = 20;
/** Cari özeti dönemi en fazla bu kadar gün. */
export const MAX_AGENCY_SUMMARY_DAYS = 1100;

/* ─────────────── Saf kurallar (ekran ve sunucu aynı kuralı kullanır) ─────────────── */

/** @param {Date | string} value */
export const dayText = (value) => (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10));

/** "2027-06-01" → "01.06.2027" */
const dotted = (value) => {
  const [year, month, day] = dayText(value).split('-');
  return `${day}.${month}.${year}`;
};

/**
 * @typedef {{ roomTypeId: string, boardType: string, startDate: Date | string, endDate: Date | string }} RateRange
 * @typedef {{ index: number, field: string, message: string }} RateIssue
 */

/**
 * Fiyat satırlarının tutarlılığı: her satır kontrat döneminin içinde, aynı
 * oda tipi + pansiyon için dönemler çakışmaz. Sunucu kaydederken bu kurala ek
 * olarak veritabanı kısıtı (çakışma yasağı) son savunmadır.
 *
 * @param {RateRange[]} rates
 * @param {{ startDate: Date | string, endDate: Date | string } | null} [period] kontrat dönemi (bilinmiyorsa dönem denetlenmez)
 * @returns {RateIssue[]}
 */
export function contractRateIssues(rates, period = null) {
  /** @type {RateIssue[]} */
  const issues = [];
  const periodStart = period ? dayText(period.startDate) : null;
  const periodEnd = period ? dayText(period.endDate) : null;

  rates.forEach((rate, index) => {
    const start = dayText(rate.startDate);
    const end = dayText(rate.endDate);
    if (end < start) {
      issues.push({ index, field: 'endDate', message: 'Bitiş tarihi başlangıçtan önce olamaz' });
      return;
    }
    if (periodStart && start < periodStart) {
      issues.push({ index, field: 'startDate', message: `Fiyat dönemi kontrat başlangıcından (${dotted(periodStart)}) önce olamaz` });
    }
    if (periodEnd && end > periodEnd) {
      issues.push({ index, field: 'endDate', message: `Fiyat dönemi kontrat bitişinden (${dotted(periodEnd)}) sonra olamaz` });
    }
  });

  /** @type {Map<string, Array<{ index: number, start: string, end: string }>>} */
  const groups = new Map();
  rates.forEach((rate, index) => {
    const start = dayText(rate.startDate);
    const end = dayText(rate.endDate);
    if (end < start) return;
    const key = `${rate.roomTypeId}|${rate.boardType}`;
    const list = groups.get(key) ?? [];
    list.push({ index, start, end });
    groups.set(key, list);
  });
  for (const list of groups.values()) {
    list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.index - b.index));
    let reach = null;
    for (const entry of list) {
      if (reach && entry.start <= reach.end) {
        issues.push({
          index: entry.index,
          field: 'startDate',
          message: `Aynı oda tipi ve pansiyon için ${dotted(reach.start)} – ${dotted(reach.end)} dönemiyle çakışıyor`,
        });
      }
      if (!reach || entry.end > reach.end) reach = entry;
    }
  }
  return issues.sort((a, b) => a.index - b.index);
}

/**
 * Stop-sale kaydı kontrat döneminin içinde mi?
 * @param {{ startDate: Date | string, endDate: Date | string }} stopSale
 * @param {{ startDate: Date | string, endDate: Date | string }} period
 * @returns {string | null} sebep
 */
export function stopSalePeriodError(stopSale, period) {
  const start = dayText(stopSale.startDate);
  const end = dayText(stopSale.endDate);
  if (end < start) return 'Bitiş tarihi başlangıçtan önce olamaz';
  if (start < dayText(period.startDate) || end > dayText(period.endDate)) {
    return `Stop-sale kontrat dönemi içinde olmalı (${dotted(period.startDate)} – ${dotted(period.endDate)})`;
  }
  return null;
}

/** İki uç dahil gün sayısı. */
export function inclusiveDays(startDate, endDate) {
  return Math.round((Date.parse(dayText(endDate)) - Date.parse(dayText(startDate))) / 86_400_000) + 1;
}

/**
 * Vade tarihi: çıkış günü + vade günü.
 * @param {Date | string} checkOut
 * @param {number} termDays
 * @returns {string} "YYYY-MM-DD"
 */
export function paymentDueDay(checkOut, termDays) {
  const date = new Date(`${dayText(checkOut)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(termDays || 0));
  return date.toISOString().slice(0, 10);
}

/* ─────────────── Şema parçaları ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

/** Acente kodu: harf, rakam, nokta, tire, alt çizgi; büyük harfe çevrilir. */
const codeField = z
  .string({ error: 'Acente kodu zorunlu' })
  .trim()
  .toUpperCase()
  .min(2, 'Acente kodu en az 2 karakter')
  .max(MAX_AGENCY_CODE_LENGTH, `Acente kodu en fazla ${MAX_AGENCY_CODE_LENGTH} karakter`)
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Kod yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir');

/**
 * Vergi numarası: yurt dışı acentelerde harf de olabileceği için serbest
 * ama sınırlı karakter kümesi.
 */
const taxNumberField = z
  .string()
  .trim()
  .max(MAX_AGENCY_TAX_NUMBER_LENGTH, `Vergi numarası en fazla ${MAX_AGENCY_TAX_NUMBER_LENGTH} karakter`)
  .refine((value) => value === '' || /^[A-Za-z0-9./ -]{4,}$/.test(value), { message: 'Vergi numarası geçersiz (en az 4 harf / rakam)' })
  .transform((value) => value || null)
  .nullish();

const agencyShape = {
  code: codeField,
  name: z
    .string({ error: 'Firma adı zorunlu' })
    .trim()
    .min(2, 'Firma adı en az 2 karakter')
    .max(MAX_AGENCY_NAME_LENGTH, `Firma adı en fazla ${MAX_AGENCY_NAME_LENGTH} karakter`),
  contactName: optionalText(MAX_AGENCY_CONTACT_LENGTH, 'Yetkili adı'),
  phone: guestInputSchema.shape.phone,
  email: guestInputSchema.shape.email,
  address: optionalText(MAX_AGENCY_ADDRESS_LENGTH, 'Adres'),
  taxOffice: optionalText(MAX_AGENCY_TAX_OFFICE_LENGTH, 'Vergi dairesi'),
  taxNumber: taxNumberField,
  commissionPct: decimalField({ scale: 2, min: 0, max: MAX_COMMISSION_PCT, label: 'Komisyon' }).default('0'),
  paymentTermDays: z.coerce
    .number({ error: 'Vade gün sayısı sayı olmalı' })
    .int('Vade tam gün olmalı')
    .min(0, 'Vade negatif olamaz')
    .max(MAX_PAYMENT_TERM_DAYS, `Vade en fazla ${MAX_PAYMENT_TERM_DAYS} gün`)
    .default(0),
  notes: optionalText(MAX_AGENCY_NOTES_LENGTH, 'Not'),
};

/** Yeni acente. */
export const createAgencySchema = z.object(agencyShape);

/** Acente kartını günceller (form hepsini gönderir) — sürüm kontrolüyle. */
export const updateAgencySchema = z.object({ expectedUpdatedAt, ...agencyShape });

/** Aktif ↔ pasif. */
export const agencyStatusSchema = z.object({
  expectedUpdatedAt,
  status: z.enum(AGENCY_STATUSES, { error: 'Geçersiz durum' }),
});

export const agencyParamSchema = z.object({ agencyId: uuid('Geçersiz acente') });
export const contractParamSchema = z.object({ contractId: uuid('Geçersiz kontrat') });
export const stopSaleParamSchema = z.object({
  contractId: uuid('Geçersiz kontrat'),
  stopSaleId: uuid('Geçersiz stop-sale kaydı'),
});

/** Acente seçicisi (rezervasyon formu): ada / koda göre ara ya da seçili acenteyi kimliğiyle getir. */
export const agencyOptionsQuerySchema = z.object({
  q: z.string().trim().max(100, 'Arama metni en fazla 100 karakter').optional(),
  id: uuid('Geçersiz acente').optional(),
});

/** Acentenin rezervasyonları (cari ekranı): girişi bu aralıkta, durum ve arama süzgeçleriyle. */
export const agencyReservationsQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'], { error: 'Geçersiz durum' }).optional(),
    from: dateField.optional(),
    to: dateField.optional(),
    search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    }
  });

export const agencyListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  status: z.enum(AGENCY_STATUSES, { error: 'Geçersiz durum' }).optional(),
});

/** Cari özeti dönemi: girişi bu aralıkta olan rezervasyonlar (iki uç dahil). */
export const agencySummaryQuerySchema = z
  .object({
    from: dateField.optional(),
    to: dateField.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;
    if (value.to < value.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    } else if (inclusiveDays(value.from, value.to) > MAX_AGENCY_SUMMARY_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: `Dönem en fazla ${MAX_AGENCY_SUMMARY_DAYS} gün olabilir` });
    }
  });

/* ─────────────── Kontrat ─────────────── */

/** Dönem denetimi: bitiş ≥ başlangıç, en fazla `MAX_CONTRACT_DAYS` gün. */
function refinePeriod(value, ctx) {
  if (!value.startDate || !value.endDate) return;
  if (value.endDate < value.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Bitiş tarihi başlangıçtan önce olamaz' });
  } else if (inclusiveDays(value.startDate, value.endDate) > MAX_CONTRACT_DAYS) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: `Kontrat dönemi en fazla ${MAX_CONTRACT_DAYS} gün olabilir` });
  }
}

const contractShape = {
  name: z
    .string({ error: 'Kontrat adı zorunlu' })
    .trim()
    .min(2, 'Kontrat adı en az 2 karakter')
    .max(MAX_CONTRACT_NAME_LENGTH, `Kontrat adı en fazla ${MAX_CONTRACT_NAME_LENGTH} karakter`),
  startDate: dateField,
  endDate: dateField,
  notes: optionalText(MAX_CONTRACT_NOTES_LENGTH, 'Not'),
};

export const createContractSchema = z.object(contractShape).superRefine(refinePeriod);

export const updateContractSchema = z.object({ expectedUpdatedAt, ...contractShape }).superRefine(refinePeriod);

export const contractVersionSchema = z.object({ expectedUpdatedAt });

export const endContractSchema = z.object({
  expectedUpdatedAt,
  reason: z
    .string({ error: 'Sonlandırma sebebini yazın' })
    .trim()
    .min(MIN_CONTRACT_END_REASON_LENGTH, `Sebep en az ${MIN_CONTRACT_END_REASON_LENGTH} karakter`)
    .max(MAX_CONTRACT_END_REASON_LENGTH, `Sebep en fazla ${MAX_CONTRACT_END_REASON_LENGTH} karakter`),
});

const rateRowSchema = z
  .object({
    roomTypeId: uuid('Oda tipi seçin'),
    boardType: z.enum(BOARD_TYPES, { error: 'Geçersiz pansiyon tipi' }),
    startDate: dateField,
    endDate: dateField,
    price: moneyInputField.refine((value) => Number(value) > 0, { message: 'Fiyat 0\'dan büyük olmalı' }),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Bitiş tarihi başlangıçtan önce olamaz' });
    }
  });

/**
 * Kontratın bütün fiyat satırları (tümünü değiştirir; ekran tabloyu bir
 * bütün olarak kaydeder). Çakışma ve dönem denetimi kontratı bilen sunucuda;
 * burada yalnızca satırların kendi içinde tutarlılığı ve çakışma.
 */
export const saveContractRatesSchema = z
  .object({
    expectedUpdatedAt,
    rates: z.array(rateRowSchema, { error: 'Fiyat satırları geçersiz' }).max(MAX_CONTRACT_RATES, `En fazla ${MAX_CONTRACT_RATES} fiyat satırı`),
  })
  .superRefine((value, ctx) => {
    for (const issue of contractRateIssues(value.rates)) {
      ctx.addIssue({ code: 'custom', path: ['rates', issue.index, issue.field], message: issue.message });
    }
  });

export const addStopSaleSchema = z
  .object({
    /** Boşsa kontratın bütün oda tipleri. */
    roomTypeId: uuid('Geçersiz oda tipi').nullish(),
    startDate: dateField,
    endDate: dateField,
    reason: optionalText(MAX_STOP_SALE_REASON_LENGTH, 'Sebep'),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Bitiş tarihi başlangıçtan önce olamaz' });
    }
  });

/* ─────────────── Sınır yardımcısı: kontrat tutarı üst sınırı ─────────────── */

/** Kontrat fiyatı üst sınırı (rezervasyon toplamıyla aynı). */
export const MAX_CONTRACT_RATE_PRICE = MAX_RESERVATION_TOTAL;
