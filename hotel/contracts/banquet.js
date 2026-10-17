import { normalizeDecimalString } from './decimal.js';
import { dateField, expectedUpdatedAt, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';
import { guestInputSchema, moneyInputField } from './reservations.js';
import { TAX_APPLIES_TO } from './constants.js';
import { looksLikeCardNumber } from './front-desk.js';
import { PAYMENT_NOTE_MAX, PAYMENT_REFERENCE_LABELS, PAYMENT_REFERENCE_MAX, PAYMENT_REFERENCE_REQUIRED_METHODS } from './payments.js';

/**
 * Satış projeleri ve banket / etkinlik sözleşmeleri (modül 37).
 *
 * Kararlar (kullanıcı, 16 Ekim 2026):
 * - **Para:** etkinliğin kendi hesabı. Kalemler folyonun vergi motoruyla
 *   hesaplanır; depozito ve ödemeler etkinliğe tahsil edilir ve kasa ekranına
 *   (modül 17) "Etkinlik" kaynağıyla girer. Büyük ödeme, iade ve iptal onay
 *   kuyruğuyla (dört göz) — konaklama tahsilatıyla aynı kurallar.
 * - **PDF:** teklif, sözleşme ve proforma sunucuda üretilir, sürümüyle saklanır.
 * - **Opsiyon:** aynı salona aynı saatte sıralı opsiyon (1., 2. …); kesinleşen
 *   tek olur, yalnızca 1. opsiyon kesinleşebilir; opsiyon tarihi geçince düşer.
 * - **Fatura:** etkinlik gerçekleşince "faturaya hazır" olur, proforma basılır;
 *   resmi fatura numarası / e-fatura modül 16 / 49'un işi.
 *
 * Saatler otelin **duvar saatiyle** girilir ("2026-11-20T19:00", otelin saat
 * dilimi) ve sunucuda gerçek ana çevrilir. Tarihler (opsiyon, vade) gün
 * hassasiyetindedir.
 */

/* ─────────────── Salon ─────────────── */

/** Prisma `VenueLayout` ile birebir: oturma düzeni (kapasite düzene göre değişir). */
export const VENUE_LAYOUTS = Object.freeze(['THEATER', 'CLASSROOM', 'U_SHAPE', 'BOARDROOM', 'BANQUET', 'CABARET', 'COCKTAIL']);

export const VENUE_LAYOUT_LABELS = Object.freeze({
  THEATER: 'Tiyatro',
  CLASSROOM: 'Sınıf',
  U_SHAPE: 'U düzeni',
  BOARDROOM: 'Toplantı masası',
  BANQUET: 'Banket (yuvarlak masa)',
  CABARET: 'Kabare',
  COCKTAIL: 'Kokteyl (ayakta)',
});

export const VENUE_STATUSES = Object.freeze(['ACTIVE', 'PASSIVE']);
export const VENUE_STATUS_LABELS = Object.freeze({ ACTIVE: 'Satışta', PASSIVE: 'Pasif' });

/**
 * Salon kirası fiyat temeli. Öneri motoru süreye göre en uygun temeli seçer
 * (bkz. backend `suggestVenuePrice`); personel değiştirebilir.
 */
export const VENUE_PRICE_BASES = Object.freeze(['HOUR', 'HALF_DAY', 'DAY']);
export const VENUE_PRICE_BASIS_LABELS = Object.freeze({ HOUR: 'Saatlik', HALF_DAY: 'Yarım gün', DAY: 'Tam gün' });

/** Yarım günün saati (fiyat önerisinde: bu süreye kadar yarım gün fiyatı). */
export const HALF_DAY_HOURS = 4;
/** Tam günün saati (bu süreyi aşan oturum birden fazla gün sayılır). */
export const FULL_DAY_HOURS = 10;

/* ─────────────── Müşteri, etkinlik, oturum ─────────────── */

export const EVENT_CLIENT_TYPES = Object.freeze(['COMPANY', 'PERSON']);
export const EVENT_CLIENT_TYPE_LABELS = Object.freeze({ COMPANY: 'Kurumsal', PERSON: 'Bireysel' });

/** Prisma `EventType` ile birebir. */
export const EVENT_TYPES = Object.freeze(['WEDDING', 'ENGAGEMENT', 'MEETING', 'CONFERENCE', 'GALA', 'BIRTHDAY', 'COCKTAIL', 'OTHER']);

export const EVENT_TYPE_LABELS = Object.freeze({
  WEDDING: 'Düğün',
  ENGAGEMENT: 'Nişan / kına',
  MEETING: 'Toplantı',
  CONFERENCE: 'Konferans / seminer',
  GALA: 'Gala / balo',
  BIRTHDAY: 'Doğum günü',
  COCKTAIL: 'Kokteyl',
  OTHER: 'Diğer',
});

/**
 * Prisma `EventStatus` ile birebir.
 * - `INQUIRY`: talep; salon tutmaz.
 * - `TENTATIVE`: opsiyonlu; salonlar sıralı opsiyonla tutulur, opsiyon tarihi geçince düşer.
 * - `DEFINITE`: kesin; salonlar kesin (aynı saate ikinci kesin olamaz).
 * - `COMPLETED`: gerçekleşti, faturaya hazır (kesin kişi sayısıyla).
 * - `CANCELLED`: kesin etkinlik iptal edildi (iptal bedeli politikadan).
 * - `LOST`: teklif aşamasında kaybedildi.
 */
export const EVENT_STATUSES = Object.freeze(['INQUIRY', 'TENTATIVE', 'DEFINITE', 'COMPLETED', 'CANCELLED', 'LOST']);

export const EVENT_STATUS_LABELS = Object.freeze({
  INQUIRY: 'Talep',
  TENTATIVE: 'Opsiyonlu',
  DEFINITE: 'Kesin',
  COMPLETED: 'Gerçekleşti',
  CANCELLED: 'İptal',
  LOST: 'Kaybedildi',
});

/** Salonu tutan durumlar (takvimde görünür). */
export const EVENT_HOLDING_STATUSES = Object.freeze(['TENTATIVE', 'DEFINITE', 'COMPLETED']);
/** Kapanmış dosyalar: içerik değişmez. */
export const EVENT_CLOSED_STATUSES = Object.freeze(['CANCELLED', 'LOST']);

/* ─────────────── Kalemler ─────────────── */

export const EVENT_ITEM_CATEGORIES = Object.freeze(['VENUE', 'FNB', 'BEVERAGE', 'EQUIPMENT', 'SERVICE', 'OTHER']);

export const EVENT_ITEM_CATEGORY_LABELS = Object.freeze({
  VENUE: 'Salon kirası',
  FNB: 'Yiyecek',
  BEVERAGE: 'İçecek',
  EQUIPMENT: 'Ekipman',
  SERVICE: 'Hizmet (dekor, müzik…)',
  OTHER: 'Diğer',
});

/** Kalemin varsayılan vergi kategorisi (otelin vergi ayarındaki "uygulandığı kalem"); personel değiştirebilir. */
export const EVENT_ITEM_DEFAULT_TAX = Object.freeze({
  VENUE: 'OTHER',
  FNB: 'FNB',
  BEVERAGE: 'FNB',
  EQUIPMENT: 'OTHER',
  SERVICE: 'OTHER',
  OTHER: 'OTHER',
});

export const EVENT_ITEM_UNITS = Object.freeze(['PERSON', 'PIECE', 'HOUR', 'DAY', 'PACKAGE']);
export const EVENT_ITEM_UNIT_LABELS = Object.freeze({ PERSON: 'kişi', PIECE: 'adet', HOUR: 'saat', DAY: 'gün', PACKAGE: 'paket' });

/* ─────────────── Belgeler ve ödemeler ─────────────── */

export const EVENT_DOCUMENT_KINDS = Object.freeze(['OFFER', 'CONTRACT', 'PROFORMA']);
export const EVENT_DOCUMENT_KIND_LABELS = Object.freeze({ OFFER: 'Teklif', CONTRACT: 'Sözleşme', PROFORMA: 'Proforma' });

/**
 * Prisma `EventDocumentStatus` ile birebir.
 * Teklif: verildi → kabul / ret / yenisiyle geçersiz; sözleşme: verildi → imzalandı / geçersiz; proforma: verildi / geçersiz.
 */
export const EVENT_DOCUMENT_STATUSES = Object.freeze(['ISSUED', 'ACCEPTED', 'DECLINED', 'SIGNED', 'SUPERSEDED']);

export const EVENT_DOCUMENT_STATUS_LABELS = Object.freeze({
  ISSUED: 'Verildi',
  ACCEPTED: 'Kabul edildi',
  DECLINED: 'Reddedildi',
  SIGNED: 'İmzalandı',
  SUPERSEDED: 'Geçersiz (yenisi var)',
});

/** Etkinlik ödemesinde kullanılan yöntemler (acente / kupon etkinliğe uygulanmaz). */
export const EVENT_PAYMENT_METHODS = Object.freeze(['CASH', 'CARD', 'TRANSFER', 'VIRTUAL_POS']);

/** Taksit durumu (ödenen tutar vadesi eskiden yeniye dağıtılır). */
export const EVENT_INSTALLMENT_STATUSES = Object.freeze(['PAID', 'PARTIAL', 'DUE', 'OVERDUE']);
export const EVENT_INSTALLMENT_STATUS_LABELS = Object.freeze({ PAID: 'Ödendi', PARTIAL: 'Kısmen', DUE: 'Vadesi gelmedi', OVERDUE: 'Gecikti' });

/* ─────────────── Sınırlar ─────────────── */

export const MAX_VENUES = 100;
export const MAX_VENUE_CODE_LENGTH = 20;
export const MAX_VENUE_NAME_LENGTH = 120;
export const MAX_VENUE_CAPACITY = 10_000;
export const MAX_SETUP_MINUTES = 720;
export const MAX_EQUIPMENT = 500;
export const MAX_EQUIPMENT_STOCK = 10_000;
export const MAX_EVENT_NAME_LENGTH = 160;
export const MAX_EVENT_NOTES_LENGTH = 2000;
export const MAX_EVENT_PAX = 10_000;
export const MAX_EVENT_SESSIONS = 60;
export const MAX_EVENT_ITEMS = 300;
/** Tek oturumun en uzun süresi (saat; çok günlü fuar / sergi dahil). */
export const MAX_SESSION_HOURS = 72;
export const MAX_SESSION_TITLE_LENGTH = 120;
export const MAX_ITEM_DESCRIPTION_LENGTH = 200;
export const MAX_ITEM_QUANTITY = 100_000;
export const MAX_INSTALLMENTS = 12;
export const MAX_POLICY_TIERS = 10;
export const MAX_OPTION_DAYS = 60;
export const MAX_OFFER_VALIDITY_DAYS = 90;
export const MAX_CONTRACT_TERMS_LENGTH = 8000;
export const MIN_EVENT_REASON_LENGTH = 5;
export const MAX_EVENT_REASON_LENGTH = 500;
/** Takvim penceresi en fazla bu kadar gün. */
export const MAX_CALENDAR_DAYS = 31;
/** Etkinliğin en uzak ileri tarihi (gün; üç yıl). */
export const MAX_EVENT_LEAD_DAYS = 1100;

/* ─────────────── Saf kurallar ─────────────── */

const WALL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** @param {Date | string} value */
const dayText = (value) => (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10));

/** "2026-11-20T19:00" duvar saatinin dakika cinsinden "mutlak" değeri (saat dilimsiz karşılaştırma için). */
export function wallMinutes(wall) {
  if (!WALL_TIME.test(wall ?? '')) return Number.NaN;
  const [day, time] = wall.split('T');
  const [hour, minute] = time.split(':').map(Number);
  return Date.parse(`${day}T00:00:00.000Z`) / MINUTE_MS + hour * 60 + minute;
}

/**
 * Oturum süresi (dakika, duvar saatine göre). Geçersizse `NaN`.
 * @param {string} startAt "YYYY-MM-DDTHH:mm"
 * @param {string} endAt
 */
export const sessionMinutes = (startAt, endAt) => wallMinutes(endAt) - wallMinutes(startAt);

/**
 * İptal politikası kademesi: etkinliğe `daysBefore` gün kala iptalde bedel
 * yüzdesi. Kademeler **alt sınırdır** ("en az N gün kala"); uyan en büyük eşik
 * geçerli: 90 → %10, 30 → %50, 0 → %100 ise 120 gün kala %10, 45 gün kala %50,
 * 10 gün kala %100. Politika en küçük eşik olarak 0 günü içerir
 * (`policyTierIssues`); kademe yoksa bedel yoktur.
 *
 * @param {Array<{ daysBefore: number, feePct: string }>} tiers
 * @param {number} daysBefore
 * @returns {string} yüzde ("0" politika yoksa)
 */
export function cancellationFeePct(tiers, daysBefore) {
  const fitting = [...(tiers ?? [])].sort((a, b) => b.daysBefore - a.daysBefore).find((tier) => daysBefore >= tier.daysBefore);
  return fitting ? String(fitting.feePct) : '0';
}

/**
 * Kademelerin okunur aralıkları (sözleşme PDF'i ve politika ekranı aynı metni gösterir):
 * 90 / 30 / 0 → "90 gün ve daha fazla kala", "30–89 gün kala", "0–29 gün kala".
 *
 * @param {Array<{ daysBefore: number, feePct: string }>} tiers
 * @returns {Array<{ daysBefore: number, feePct: string, label: string }>} büyük eşikten küçüğe
 */
export function cancellationTierRanges(tiers) {
  const ordered = [...(tiers ?? [])].sort((a, b) => b.daysBefore - a.daysBefore);
  return ordered.map((tier, index) => {
    if (index === 0) return { ...tier, label: `${tier.daysBefore} gün ve daha fazla kala` };
    const upper = ordered[index - 1].daysBefore - 1;
    const label = upper === tier.daysBefore ? (tier.daysBefore === 0 ? 'Etkinlik günü' : `${tier.daysBefore} gün kala`) : `${tier.daysBefore}–${upper} gün kala`;
    return { ...tier, label };
  });
}

/**
 * Politika kademelerinin tutarlılığı: eşik günleri tekrarsız; etkinliğe
 * yaklaştıkça (gün azaldıkça) bedel azalamaz.
 *
 * @param {Array<{ daysBefore: number, feePct: string }>} tiers
 * @returns {Array<{ index: number, field: 'daysBefore' | 'feePct', message: string }>}
 */
export function policyTierIssues(tiers) {
  const issues = [];
  const indexed = tiers.map((tier, index) => ({ ...tier, index }));
  const seen = new Set();
  for (const tier of indexed) {
    if (seen.has(tier.daysBefore)) issues.push({ index: tier.index, field: 'daysBefore', message: 'Aynı gün iki kez yazılmış' });
    seen.add(tier.daysBefore);
  }
  const ordered = [...indexed].sort((a, b) => b.daysBefore - a.daysBefore);
  // Eşikler alt sınır: 0 günlük kademe yoksa etkinliğe en yakın iptaller hiçbir kademeye düşmez (bedelsiz kalırdı).
  const smallest = ordered.at(-1);
  if (smallest && smallest.daysBefore !== 0) {
    issues.push({ index: smallest.index, field: 'daysBefore', message: 'En küçük eşik 0 gün olmalı (etkinliğe az kala yapılan iptal de bir kademeye düşmeli)' });
  }
  for (let position = 1; position < ordered.length; position += 1) {
    if (Number(ordered[position].feePct) < Number(ordered[position - 1].feePct)) {
      issues.push({
        index: ordered[position].index,
        field: 'feePct',
        message: `Etkinliğe yaklaştıkça bedel azalamaz (${ordered[position - 1].daysBefore} gün kala %${ordered[position - 1].feePct})`,
      });
    }
  }
  return issues.sort((a, b) => a.index - b.index);
}

/** İki gün arası gün farkı ("YYYY-AA-GG"). */
export const daysBetween = (from, to) => Math.round((Date.parse(dayText(to)) - Date.parse(dayText(from))) / DAY_MS);

/* ─────────────── Şema parçaları ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

const reasonField = (label) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(MIN_EVENT_REASON_LENGTH, `${label} en az ${MIN_EVENT_REASON_LENGTH} karakter`)
    .max(MAX_EVENT_REASON_LENGTH, `${label} en fazla ${MAX_EVENT_REASON_LENGTH} karakter`);

const intField = (label, min, max) =>
  z.coerce
    .number({ error: `${label} sayı olmalı` })
    .int(`${label} tam sayı olmalı`)
    .min(min, `${label} en az ${min}`)
    .max(max, `${label} en fazla ${max.toLocaleString('tr-TR')}`);

/** Boş bırakılabilir para alanı (null = yok). Virgül kabul edilir. */
const optionalMoney = (label) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((value, ctx) => {
      if (value === null || value === undefined) return null;
      const text = String(value).trim().replace(',', '.');
      if (text === '') return null;
      if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        ctx.addIssue({ code: 'custom', message: `${label} geçersiz (en fazla 2 ondalık)` });
        return z.NEVER;
      }
      return normalizeDecimalString(text);
    });

const percentField = (label) =>
  z
    .union([z.string(), z.number()], { error: `${label} zorunlu` })
    .transform((value) => String(value).trim().replace(',', '.'))
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), { message: `${label} geçersiz (en fazla 2 ondalık)` })
    .transform(normalizeDecimalString)
    .refine((value) => Number(value) <= 100, { message: `${label} en fazla %100` });

/** Duvar saati: "YYYY-AA-GGTSS:dd" (otelin saati). */
const wallTimeField = (label) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .refine((value) => value !== '', { message: `${label} seçin`, abort: true })
    .refine((value) => isWallTime(value), { message: `${label} geçersiz (gün ve saat seçin)`, abort: true });

/** Geçerli duvar saati mi (31 Şubat, 25:00 gibi taşan değerler değil). @param {string} value */
export function isWallTime(value) {
  if (!WALL_TIME.test(value ?? '')) return false;
  const parsed = new Date(`${value}:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/* ─────────────── Salon ve ekipman ─────────────── */

const capacityRow = z.object({
  layout: z.enum(VENUE_LAYOUTS, { error: 'Düzen seçin' }),
  capacity: intField('Kapasite', 1, MAX_VENUE_CAPACITY),
});

const venueShape = {
  code: z
    .string({ error: 'Salon kodu zorunlu' })
    .trim()
    .toUpperCase()
    .min(1, 'Salon kodu zorunlu')
    .max(MAX_VENUE_CODE_LENGTH, `Salon kodu en fazla ${MAX_VENUE_CODE_LENGTH} karakter`)
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Kod yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir'),
  name: z.string({ error: 'Salon adı zorunlu' }).trim().min(2, 'Salon adı en az 2 karakter').max(MAX_VENUE_NAME_LENGTH, `Salon adı en fazla ${MAX_VENUE_NAME_LENGTH} karakter`),
  description: optionalText(500, 'Açıklama'),
  /** Bölünebilir salonun bütünü (bu salon onun bir parçası). */
  parentId: uuid('Geçersiz salon').nullish(),
  areaSqm: optionalMoney('Alan'),
  hourlyRate: optionalMoney('Saatlik fiyat'),
  halfDayRate: optionalMoney('Yarım gün fiyatı'),
  dayRate: optionalMoney('Tam gün fiyatı'),
  setupMinutes: intField('Kurulum süresi', 0, MAX_SETUP_MINUTES).default(60),
  teardownMinutes: intField('Söküm süresi', 0, MAX_SETUP_MINUTES).default(60),
  capacities: z
    .array(capacityRow, { error: 'Kapasiteler geçersiz' })
    .min(1, 'En az bir düzen için kapasite girin')
    .max(VENUE_LAYOUTS.length)
    .refine((rows) => new Set(rows.map((row) => row.layout)).size === rows.length, { message: 'Aynı düzen iki kez yazılmış' }),
};

export const createVenueSchema = z.object(venueShape);
export const updateVenueSchema = z.object({ expectedUpdatedAt, ...venueShape, status: z.enum(VENUE_STATUSES, { error: 'Geçersiz durum' }) });
export const venueParamSchema = z.object({ venueId: uuid('Geçersiz salon') });

const equipmentShape = {
  code: venueShape.code,
  name: z.string({ error: 'Ekipman adı zorunlu' }).trim().min(2, 'Ekipman adı en az 2 karakter').max(MAX_VENUE_NAME_LENGTH, `Ekipman adı en fazla ${MAX_VENUE_NAME_LENGTH} karakter`),
  unitPrice: moneyInputField,
  stockQuantity: intField('Stok', 0, MAX_EQUIPMENT_STOCK),
  isActive: z.boolean().default(true),
};
export const createEquipmentSchema = z.object(equipmentShape);
export const updateEquipmentSchema = z.object({ expectedUpdatedAt, ...equipmentShape });
export const equipmentParamSchema = z.object({ equipmentId: uuid('Geçersiz ekipman') });
export const equipmentListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  active: z.enum(['true', 'false']).optional(),
});

/* ─────────────── Müşteri ─────────────── */

const clientShape = {
  type: z.enum(EVENT_CLIENT_TYPES, { error: 'Müşteri tipini seçin' }),
  name: z.string({ error: 'Müşteri adı zorunlu' }).trim().min(2, 'Müşteri adı en az 2 karakter').max(MAX_VENUE_NAME_LENGTH, `Müşteri adı en fazla ${MAX_VENUE_NAME_LENGTH} karakter`),
  contactName: optionalText(100, 'Yetkili adı'),
  phone: guestInputSchema.shape.phone,
  email: guestInputSchema.shape.email,
  taxOffice: optionalText(100, 'Vergi dairesi'),
  taxNumber: z
    .string()
    .trim()
    .max(30, 'Vergi / T.C. kimlik no en fazla 30 karakter')
    .refine((value) => value === '' || /^[A-Za-z0-9./ -]{4,}$/.test(value), { message: 'Vergi / T.C. kimlik no geçersiz' })
    .transform((value) => value || null)
    .nullish(),
  address: optionalText(300, 'Adres'),
  notes: optionalText(1000, 'Not'),
};
export const createEventClientSchema = z.object(clientShape);
export const updateEventClientSchema = z.object({ expectedUpdatedAt, ...clientShape });
export const eventClientParamSchema = z.object({ clientId: uuid('Geçersiz müşteri') });
export const eventClientListQuerySchema = paginationQuerySchema.extend({ search: z.string().trim().max(200).optional() });

/* ─────────────── Ayarlar ─────────────── */

const tierRow = z.object({
  daysBefore: intField('Gün', 0, 730),
  feePct: percentField('Bedel'),
});

export const updateEventSettingsSchema = z
  .object({
    expectedUpdatedAt: expectedUpdatedAt.nullish(),
    optionDays: intField('Opsiyon süresi', 1, MAX_OPTION_DAYS),
    offerValidityDays: intField('Teklif geçerliliği', 1, MAX_OFFER_VALIDITY_DAYS),
    depositPct: percentField('Depozito'),
    requireSignedContract: z.boolean(),
    cancellationTiers: z.array(tierRow).max(MAX_POLICY_TIERS, `En fazla ${MAX_POLICY_TIERS} kademe`),
    contractTerms: optionalText(MAX_CONTRACT_TERMS_LENGTH, 'Sözleşme şartları'),
  })
  .superRefine((value, ctx) => {
    for (const issue of policyTierIssues(value.cancellationTiers)) {
      ctx.addIssue({ code: 'custom', path: ['cancellationTiers', issue.index, issue.field], message: issue.message });
    }
  });

/* ─────────────── Etkinlik ─────────────── */

const eventShape = {
  name: z.string({ error: 'Etkinlik adı zorunlu' }).trim().min(2, 'Etkinlik adı en az 2 karakter').max(MAX_EVENT_NAME_LENGTH, `Etkinlik adı en fazla ${MAX_EVENT_NAME_LENGTH} karakter`),
  type: z.enum(EVENT_TYPES, { error: 'Etkinlik türünü seçin' }),
  clientId: uuid('Müşteri seçin'),
  ownerEmail: z.string().trim().toLowerCase().email('Sorumlu e-postası geçersiz').max(200).nullish(),
  expectedPax: intField('Tahmini kişi', 1, MAX_EVENT_PAX),
  // Boş = garanti verilmedi (sıfır değil): boş metin sayıya çevrilmeden ayıklanır.
  guaranteedPax: z
    .union([z.literal(''), z.null(), z.coerce.number()])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value))
    .refine((value) => value === null || (Number.isInteger(value) && value >= 1 && value <= MAX_EVENT_PAX), { message: `Garanti kişi 1–${MAX_EVENT_PAX} arası tam sayı olmalı` }),
  notes: optionalText(MAX_EVENT_NOTES_LENGTH, 'Not'),
};

export const createEventSchema = z.object(eventShape);
export const updateEventSchema = z.object({ expectedUpdatedAt, ...eventShape });
export const eventParamSchema = z.object({ eventId: uuid('Geçersiz etkinlik') });
export const eventVersionSchema = z.object({ expectedUpdatedAt });

export const eventListQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().trim().max(200).optional(),
    status: z.enum(EVENT_STATUSES, { error: 'Geçersiz durum' }).optional(),
    type: z.enum(EVENT_TYPES, { error: 'Geçersiz tür' }).optional(),
    clientId: uuid('Geçersiz müşteri').optional(),
    from: dateField.optional(),
    to: dateField.optional(),
    mine: z.enum(['true', 'false']).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  });

/** Opsiyona alma / opsiyon uzatma: opsiyonun son günü (dahil). */
export const tentativeEventSchema = z.object({ expectedUpdatedAt, optionUntil: dateField });

export const confirmEventSchema = z.object({ expectedUpdatedAt });

export const completeEventSchema = z.object({ expectedUpdatedAt, actualPax: intField('Gerçekleşen kişi', 0, MAX_EVENT_PAX) });

export const cancelEventSchema = z.object({ expectedUpdatedAt, reason: reasonField('İptal gerekçesi') });
export const loseEventSchema = z.object({ expectedUpdatedAt, reason: reasonField('Kaybedilme sebebi') });
export const releaseEventSchema = z.object({ expectedUpdatedAt, reason: reasonField('Opsiyonu bırakma sebebi') });

/* ─────────────── Oturum ─────────────── */

const sessionShape = {
  title: z.string({ error: 'Oturum adı zorunlu' }).trim().min(2, 'Oturum adı en az 2 karakter').max(MAX_SESSION_TITLE_LENGTH, `Oturum adı en fazla ${MAX_SESSION_TITLE_LENGTH} karakter`),
  venueId: uuid('Salon seçin'),
  layout: z.enum(VENUE_LAYOUTS, { error: 'Düzen seçin' }),
  pax: intField('Kişi', 1, MAX_EVENT_PAX),
  startAt: wallTimeField('Başlangıç'),
  endAt: wallTimeField('Bitiş'),
  /** Boşsa salonun varsayılan kurulum / söküm süresi. */
  setupMinutes: intField('Kurulum süresi', 0, MAX_SETUP_MINUTES).nullish(),
  teardownMinutes: intField('Söküm süresi', 0, MAX_SETUP_MINUTES).nullish(),
  notes: optionalText(1000, 'Not'),
};

function refineSession(value, ctx) {
  if (!value.startAt || !value.endAt) return;
  const minutes = sessionMinutes(value.startAt, value.endAt);
  if (!(minutes > 0)) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Bitiş başlangıçtan sonra olmalı' });
  else if (minutes > MAX_SESSION_HOURS * 60) ctx.addIssue({ code: 'custom', path: ['endAt'], message: `Oturum en fazla ${MAX_SESSION_HOURS} saat sürebilir` });
}

export const createSessionSchema = z.object({ expectedUpdatedAt, ...sessionShape }).superRefine(refineSession);
export const updateSessionSchema = z.object({ expectedUpdatedAt, ...sessionShape }).superRefine(refineSession);
export const sessionParamSchema = z.object({ eventId: uuid('Geçersiz etkinlik'), sessionId: uuid('Geçersiz oturum') });

/* ─────────────── Kalemler ─────────────── */

const quantityField = z
  .union([z.string(), z.number()], { error: 'Miktar zorunlu' })
  .transform((value) => String(value).trim().replace(',', '.'))
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), { message: 'Miktar geçersiz (en fazla 2 ondalık)' })
  .transform(normalizeDecimalString)
  .refine((value) => Number(value) > 0 && Number(value) <= MAX_ITEM_QUANTITY, { message: `Miktar 0'dan büyük, en fazla ${MAX_ITEM_QUANTITY.toLocaleString('tr-TR')} olmalı` });

const itemRow = z
  .object({
    category: z.enum(EVENT_ITEM_CATEGORIES, { error: 'Kalem türünü seçin' }),
    description: z.string({ error: 'Açıklama zorunlu' }).trim().min(2, 'Açıklama en az 2 karakter').max(MAX_ITEM_DESCRIPTION_LENGTH, `Açıklama en fazla ${MAX_ITEM_DESCRIPTION_LENGTH} karakter`),
    sessionId: uuid('Geçersiz oturum').nullish(),
    equipmentId: uuid('Geçersiz ekipman').nullish(),
    /** Kişi başı kalem: miktar faturalanacak kişi sayısıdır (garanti / gerçekleşen); `quantity` yok sayılır. */
    perPerson: z.boolean().default(false),
    quantity: quantityField,
    unit: z.enum(EVENT_ITEM_UNITS, { error: 'Birim seçin' }),
    unitPrice: moneyInputField,
    discountPct: percentField('İndirim').default('0'),
    taxCategory: z.enum(TAX_APPLIES_TO, { error: 'Vergi kategorisi seçin' }),
  })
  .superRefine((value, ctx) => {
    if (value.category === 'EQUIPMENT' && !value.equipmentId) ctx.addIssue({ code: 'custom', path: ['equipmentId'], message: 'Ekipman seçin' });
    if (value.category !== 'EQUIPMENT' && value.equipmentId) ctx.addIssue({ code: 'custom', path: ['equipmentId'], message: 'Yalnızca ekipman kaleminde ekipman seçilir' });
    if (value.equipmentId && !value.sessionId) ctx.addIssue({ code: 'custom', path: ['sessionId'], message: 'Ekipman bir oturuma bağlanmalı (stok o saatlerde ayrılır)' });
    if (value.perPerson && value.unit !== 'PERSON') ctx.addIssue({ code: 'custom', path: ['unit'], message: 'Kişi başı kalemin birimi kişidir' });
    if (value.equipmentId && !Number.isInteger(Number(value.quantity))) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Ekipman adedi tam sayı olmalı' });
  });

/** Kalem tablosunun tamamı (sürümlü; ekran tabloyu bütün olarak kaydeder). */
export const saveEventItemsSchema = z.object({
  expectedUpdatedAt,
  items: z.array(itemRow, { error: 'Kalemler geçersiz' }).max(MAX_EVENT_ITEMS, `En fazla ${MAX_EVENT_ITEMS} kalem`),
});

/* ─────────────── Ödeme planı ve tahsilat ─────────────── */

const installmentRow = z.object({
  label: z.string({ error: 'Açıklama zorunlu' }).trim().min(2, 'Açıklama en az 2 karakter').max(80, 'Açıklama en fazla 80 karakter'),
  dueDate: dateField,
  amount: moneyInputField.refine((value) => Number(value) > 0, { message: 'Tutar 0\'dan büyük olmalı' }),
});

export const saveInstallmentsSchema = z.object({
  expectedUpdatedAt,
  installments: z.array(installmentRow).max(MAX_INSTALLMENTS, `En fazla ${MAX_INSTALLMENTS} taksit`),
});

/** Ödeme metinlerine kart numarası yazılmaz (PCI DSS; modül 17 ile aynı kural). */
const paymentText = (max, label, cardMessage = 'Kart numarası yazılamaz') =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .refine((value) => !looksLikeCardNumber(value), { message: cardMessage })
    .transform((value) => value || null)
    .nullish();

export const receiveEventPaymentSchema = z
  .object({
    /** Tekrar gönderime karşı istek kimliği (aynı istek iki kez tahsil edilmez). */
    requestId: uuid('Geçersiz istek'),
    kind: z.enum(['PAYMENT', 'REFUND'], { error: 'İşlem türü geçersiz' }),
    method: z.enum(EVENT_PAYMENT_METHODS, { error: 'Ödeme yöntemi seçin' }),
    amount: moneyInputField.refine((value) => Number(value) > 0, { message: 'Tutar 0\'dan büyük olmalı' }),
    reference: paymentText(PAYMENT_REFERENCE_MAX, 'Referans', 'Kart numarası yazılamaz; slip ya da provizyon numarasını yazın'),
    note: paymentText(PAYMENT_NOTE_MAX, 'Not'),
  })
  .superRefine((value, ctx) => {
    // Nakit dışında belge numarası (slip, dekont, sanal POS işlem no) zorunlu: kasa mutabakatı onunla yapılır.
    if (PAYMENT_REFERENCE_REQUIRED_METHODS.includes(value.method) && !value.reference) {
      ctx.addIssue({ code: 'custom', path: ['reference'], message: `${PAYMENT_REFERENCE_LABELS[value.method]} zorunlu` });
    }
  });

export const voidEventPaymentSchema = z.object({
  reason: reasonField('İptal gerekçesi').refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' }),
});
export const eventPaymentParamSchema = z.object({ eventId: uuid('Geçersiz etkinlik'), paymentId: uuid('Geçersiz ödeme') });
/** Yalnızca ödeme kimliği (onay ekranından etkinliğe geçiş). */
export const eventPaymentRefParamSchema = z.object({ paymentId: uuid('Geçersiz ödeme') });

/** Etkinliğin ödeme satırları (son alınan önce, imleçli). */
export const EVENT_PAYMENTS_PAGE_SIZE = 50;
export const eventPaymentListQuerySchema = z.object({
  cursor: z.string().trim().max(200, 'Geçersiz imleç').optional(),
  limit: z.coerce.number({ error: 'Sayfa boyutu sayı olmalı' }).int().min(1).max(100, 'Sayfa boyutu en fazla 100 olabilir').default(EVENT_PAYMENTS_PAGE_SIZE),
});

/* ─────────────── Belgeler ─────────────── */

export const issueEventDocumentSchema = z.object({
  expectedUpdatedAt,
  kind: z.enum(EVENT_DOCUMENT_KINDS, { error: 'Belge türü geçersiz' }),
  note: optionalText(1000, 'Belge notu'),
});

export const eventDocumentParamSchema = z.object({ eventId: uuid('Geçersiz etkinlik'), documentId: uuid('Geçersiz belge') });

/** Teklif kabul / ret, sözleşme imza (tarihli). */
export const decideEventDocumentSchema = z.object({
  decision: z.enum(['ACCEPTED', 'DECLINED', 'SIGNED'], { error: 'Geçersiz karar' }),
  /** İmza / kabul günü (yoksa bugün). */
  date: dateField.optional(),
  note: optionalText(300, 'Not'),
});

/* ─────────────── Takvim ─────────────── */

export const banquetCalendarQuerySchema = z
  .object({ from: dateField, to: dateField })
  .superRefine((value, ctx) => {
    if (value.to < value.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    else if (daysBetween(value.from, value.to) + 1 > MAX_CALENDAR_DAYS) ctx.addIssue({ code: 'custom', path: ['to'], message: `Takvim en fazla ${MAX_CALENDAR_DAYS} gün gösterir` });
  });

/** Oturum formunun "bu saatte salon uygun mu" önizlemesi. */
export const venueAvailabilityQuerySchema = z
  .object({
    venueId: uuid('Salon seçin'),
    startAt: wallTimeField('Başlangıç'),
    endAt: wallTimeField('Bitiş'),
    setupMinutes: z.coerce.number().int().min(0).max(MAX_SETUP_MINUTES).optional(),
    teardownMinutes: z.coerce.number().int().min(0).max(MAX_SETUP_MINUTES).optional(),
    excludeSessionId: uuid('Geçersiz oturum').optional(),
    /** Etkinliğin kendi oturumları çakışma sayılmaz (aynı etkinlik arka arkaya aynı salonu kullanabilir). */
    eventId: uuid('Geçersiz etkinlik').optional(),
  })
  .superRefine(refineSession);
