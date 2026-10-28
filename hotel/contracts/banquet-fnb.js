import { MAX_EVENT_PAX, isWallTime, wallMinutes } from './banquet.js';
import { TAX_APPLIES_TO } from './constants.js';
import { normalizeDecimalString } from './decimal.js';
import { decimalField, expectedUpdatedAt, isoDayField, paginationQuerySchema, queryBoolean } from './fields.js';
import { z } from './locale.js';
import { POS_STATIONS } from './pos.js';
import { moneyInputField } from './reservations.js';

/**
 * Banket F&B planlaması sözleşmeleri (modül 43): set menü kataloğu, etkinlik menüsü,
 * malzeme ihtiyacı ve mutfak üretim planı.
 *
 * Kararlar (kullanıcı, 27 Ekim 2026):
 * - **Katalog + etkinlikte uyarlama:** set menüler tanımlarda (kurslar, yemekler, kişi başı
 *   fiyat). Etkinliğin yemekli oturumuna menü seçilince kopyası alınır; yemek değişimi, kişi
 *   sayısı, fiyat etkinlikte uyarlanır, katalog sonradan değişse de etkinlik bozulmaz.
 * - Etkinlik menüsü dosyanın kişi başı **fiyat kalemini** üretir (37'deki serbest kalem
 *   yerine): teklif / sözleşme / proforma bu kalemle ve menünün içeriğiyle basılır.
 * - **Kurs türü:** "hepsi" (her yemek herkese — meze tabağı, büfe) ya da "seçmeli" (her misafir
 *   birini alır: sabit sayılar + "kalan" — 12 vejetaryen, 85 balık, kalanı et).
 * - **Hazırlanacak porsiyon** = servis edilen kişi × kişi başı porsiyon × (1 + fazla hazırlık
 *   payı), yukarı yuvarlanır. Kişi: menüde sabit yazılmadıysa etkinliğin faturalanacak kişisi
 *   (garanti, yoksa tahmin).
 * - Malzeme ihtiyacı ve satın alma talebi yalnızca **kesin** etkinlikten; opsiyonlu olanlar
 *   "olası" olarak ayrı gösterilir. Menü mutfağa **kesinleştirilir**; kesin menü değişmez,
 *   gerekçeyle yeniden açılır (mutfağa haber gider).
 *
 * Tam sayı aritmetiği: porsiyon ve kişi hesapları binde bir / yüzde bir hassasiyetli tam
 * sayılarla yapılır (kayan nokta "105,00000001 → 106 porsiyon" hatası yapmasın).
 */

/* ─────────────── Sabitler ─────────────── */

/** Prisma `MenuCourseMode` ile birebir. */
export const MENU_COURSE_MODES = Object.freeze(['ALL', 'CHOICE']);
export const MENU_COURSE_MODE_LABELS = Object.freeze({ ALL: 'Hepsi servis edilir', CHOICE: 'Misafir seçer' });
export const MENU_COURSE_MODE_HINTS = Object.freeze({
  ALL: 'Her yemek her misafire (meze tabağı, büfe, tatlı).',
  CHOICE: 'Her misafir birini alır: sabit sayılar ve bir "kalan" yemek (ör. 12 vejetaryen, kalanı et).',
});

/** İhtiyaç ve satın alma talebi bu durumdaki etkinliklerden; opsiyonlular "olası". */
export const FNB_PLANNED_STATUSES = Object.freeze(['DEFINITE']);
export const FNB_POSSIBLE_STATUSES = Object.freeze(['TENTATIVE']);

export const MAX_EVENT_MENUS = 20;
export const MAX_MENU_COURSES = 12;
export const MAX_COURSE_DISHES = 15;
export const MAX_MENU_DISHES = 60;
export const MAX_PORTIONS_PER_GUEST = 10;
export const MAX_MENU_NAME_LENGTH = 120;
export const MAX_MENU_DESCRIPTION_LENGTH = 1000;
export const MAX_MENU_NOTES_LENGTH = 1000;
export const MAX_COURSE_NAME_LENGTH = 60;
export const MAX_DISH_LABEL_LENGTH = 160;
export const MAX_MENU_REASON_LENGTH = 500;
export const MIN_MENU_REASON_LENGTH = 5;
/** Malzeme ihtiyacı penceresi (servis günü) en fazla bu kadar gün. */
export const MAX_NEEDS_DAYS = 31;
/** Üretim planı penceresi (hazırlık günü) en fazla bu kadar gün. */
export const MAX_PRODUCTION_DAYS = 7;
/** Bir ihtiyaç hesabına giren en fazla menü (aşılırsa aralık daraltılır; ~100 etkinlik/gün). */
export const MAX_NEEDS_MENUS = 3000;
/** Üretim planında en fazla görev (aşılırsa aralık / istasyon daraltılır). */
export const MAX_PRODUCTION_TASKS = 4000;

/* ─────────────── Tam sayı yardımcıları ─────────────── */

/** "1.250" → 1250 (binde bir). @param {string | number} value */
const milli = (value) => Math.round(Number(value) * 1000);
/** "5.00" → 500 (yüzde bir puan). @param {string | number} value */
const basisPoints = (value) => Math.round(Number(value ?? 0) * 100);

/** Tam sayılarla tavan bölme (n ≥ 0, d > 0; ikisi de 2^53 altında). @param {number} n @param {number} d */
function ceilDiv(n, d) {
  let q = Math.floor(n / d);
  while (q * d > n) q -= 1;
  while ((q + 1) * d <= n) q += 1;
  return q * d === n ? q : q + 1;
}

/* ─────────────── Saf kurallar ─────────────── */

/**
 * Menünün kişisi: menüde sabit yazıldıysa o, yoksa etkinliğin faturalanacak kişisi.
 * @param {number | null | undefined} fixedGuests @param {number} billablePax
 */
export const menuGuests = (fixedGuests, billablePax) => (fixedGuests === null || fixedGuests === undefined ? billablePax : fixedGuests);

/**
 * Mutfağın hazırlayacağı kişi: kişi × (1 + pay), yukarı yuvarlanır.
 * @param {number} guests @param {string | number} overproductionPct
 */
export const productionGuests = (guests, overproductionPct) => ceilDiv(guests * (10_000 + basisPoints(overproductionPct)), 10_000);

/**
 * Bir yemeğin hazırlanacak porsiyonu: servis edilen kişi × kişi başı porsiyon × (1 + pay), yukarı.
 * @param {number} servedGuests @param {string | number} portionsPerGuest @param {string | number} overproductionPct
 */
export const productionPortions = (servedGuests, portionsPerGuest, overproductionPct) =>
  servedGuests <= 0 ? 0 : ceilDiv(servedGuests * milli(portionsPerGuest) * (10_000 + basisPoints(overproductionPct)), 10_000_000);

/**
 * Kursun yemeklerine düşen kişi. "Hepsi": her yemek bütün kişiye. "Seçmeli": sabit sayılar
 * ve en fazla bir "kalan" (sayısı boş) yemek; sabitlerin toplamı kişiyi aşarsa kalan 0 olur ve
 * sorun bildirilir; kalan yoksa toplam kişiye eşit olmalı.
 *
 * @param {'ALL' | 'CHOICE'} mode
 * @param {Array<{ guestCount?: number | null }>} dishes
 * @param {number} guests
 * @returns {{ counts: number[], issue: string | null }}
 */
export function courseGuests(mode, dishes, guests) {
  if (mode !== 'CHOICE') return { counts: dishes.map(() => guests), issue: null };
  const fixed = dishes.reduce((total, dish) => total + (dish.guestCount ?? 0), 0);
  const remainderIndex = dishes.findIndex((dish) => dish.guestCount === null || dish.guestCount === undefined);
  const counts = dishes.map((dish, index) => (index === remainderIndex ? Math.max(0, guests - fixed) : dish.guestCount ?? 0));
  if (remainderIndex >= 0) {
    return { counts, issue: fixed > guests ? `Sabit sayılar (${fixed}) kişiyi (${guests}) aşıyor; "kalan" yemeğe kimse düşmüyor` : null };
  }
  return { counts, issue: fixed === guests ? null : `Seçmeli sayıların toplamı (${fixed}) kişiyle (${guests}) tutmuyor` };
}

/**
 * Servis saati oturumun içinde mi? (Duvar saatleri, aynı dilim.)
 * @param {string} serveLocal @param {{ startLocal: string, endLocal: string }} session
 */
export function serveTimeError(serveLocal, session) {
  const serve = wallMinutes(serveLocal);
  if (Number.isNaN(serve)) return 'Servis saati geçersiz';
  if (serve < wallMinutes(session.startLocal) || serve > wallMinutes(session.endLocal)) return 'Servis saati oturumun başlangıç–bitişi içinde olmalı';
  return null;
}

/**
 * Menünün mutfağa kesinleştirilmesi gereken son gün (etkinliğin ilk günü − N gün); N = 0 → yok.
 * @param {string | null} firstDay "YYYY-AA-GG" @param {number} finalizeDays
 */
export function menuFinalizeDueDay(firstDay, finalizeDays) {
  if (!firstDay || !finalizeDays) return null;
  return new Date(Date.parse(`${firstDay}T00:00:00.000Z`) - finalizeDays * 86_400_000).toISOString().slice(0, 10);
}

/* ─────────────── Şemalar ─────────────── */

const uuid = (message) => z.string().uuid({ message });

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} en fazla ${max} karakter`)
    .transform((value) => value || null)
    .nullish();

const nameField = (label, max) => z.string({ error: `${label} zorunlu` }).trim().min(2, `${label} en az 2 karakter`).max(max, `${label} en fazla ${max} karakter`);

const guestCountField = (label) =>
  z
    .union([z.literal(''), z.null(), z.coerce.number()])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value))
    .refine((value) => value === null || (Number.isInteger(value) && value >= 1 && value <= MAX_EVENT_PAX), { message: `${label} 1–${MAX_EVENT_PAX.toLocaleString('tr-TR')} arası tam sayı olmalı` });

const percentField = (label) =>
  z
    .union([z.string(), z.number()], { error: `${label} zorunlu` })
    .transform((value) => String(value).trim().replace(',', '.'))
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), { message: `${label} geçersiz (en fazla 2 ondalık)` })
    .transform(normalizeDecimalString)
    .refine((value) => Number(value) <= 100, { message: `${label} en fazla %100` });

const portionsField = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().replace(',', '.') : value),
  decimalField({ scale: 3, min: 0.001, max: MAX_PORTIONS_PER_GUEST, label: 'Kişi başı porsiyon' }),
);

const wallTimeField = (label) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .refine((value) => value !== '', { message: `${label} seçin`, abort: true })
    .refine((value) => isWallTime(value), { message: `${label} geçersiz (gün ve saat seçin)`, abort: true });

/**
 * @param {{ withCounts: boolean }} options katalogda seçmeli kursun sayısı yok (etkinlikte girilir)
 */
function courseRow({ withCounts }) {
  const dish = z.object({
    recipeId: uuid('Yemek seçin'),
    /** Menüde görünen ad (boşsa reçetenin adı): "Fırında kuzu incik, beğendi eşliğinde". */
    label: optionalText(MAX_DISH_LABEL_LENGTH, 'Menüdeki ad'),
    portionsPerGuest: portionsField.default('1'),
    guestCount: withCounts ? guestCountField('Kişi') : z.null().optional().transform(() => null),
  });
  return z
    .object({
      name: nameField('Kurs adı', MAX_COURSE_NAME_LENGTH),
      mode: z.enum(MENU_COURSE_MODES, { error: 'Kurs türünü seçin' }),
      dishes: z.array(dish, { error: 'Yemekler geçersiz' }).min(1, 'Kursa en az bir yemek ekleyin').max(MAX_COURSE_DISHES, `Bir kursta en fazla ${MAX_COURSE_DISHES} yemek`),
    })
    .superRefine((value, ctx) => {
      const seen = new Set();
      value.dishes.forEach((entry, index) => {
        if (seen.has(entry.recipeId)) ctx.addIssue({ code: 'custom', path: ['dishes', index, 'recipeId'], message: 'Aynı yemek kursta iki kez' });
        seen.add(entry.recipeId);
        if (value.mode === 'ALL' && entry.guestCount !== null) ctx.addIssue({ code: 'custom', path: ['dishes', index, 'guestCount'], message: '"Hepsi" kursunda kişi yazılmaz' });
      });
      if (value.mode === 'CHOICE') {
        if (value.dishes.length < 2) ctx.addIssue({ code: 'custom', path: ['dishes'], message: 'Seçmeli kursta en az iki yemek olur' });
        const remainders = value.dishes.filter((entry) => entry.guestCount === null).length;
        if (withCounts && remainders > 1) ctx.addIssue({ code: 'custom', path: ['dishes'], message: 'Seçmeli kursta yalnızca bir yemek "kalan" olur; diğerlerine kişi yazın' });
      }
    });
}

const coursesField = (withCounts) =>
  z
    .array(courseRow({ withCounts }), { error: 'Kurslar geçersiz' })
    .min(1, 'En az bir kurs ekleyin')
    .max(MAX_MENU_COURSES, `En fazla ${MAX_MENU_COURSES} kurs`)
    .refine((courses) => courses.reduce((total, course) => total + course.dishes.length, 0) <= MAX_MENU_DISHES, { message: `Menüde en fazla ${MAX_MENU_DISHES} yemek` });

const priceShape = {
  /** Kişi başı fiyat, vergi dahil (etkinlik kalemleri gibi). */
  pricePerPerson: moneyInputField,
  taxCategory: z.enum(TAX_APPLIES_TO, { error: 'Vergi kategorisi seçin' }).default('FNB'),
};

/* ── Set menü kataloğu ── */

const banquetMenuShape = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(20, 'Kod en fazla 20 karakter')
    .regex(/^([A-Z0-9][A-Z0-9._-]*)?$/, 'Kod yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir')
    .transform((value) => value || null)
    .nullish(),
  name: nameField('Menü adı', MAX_MENU_NAME_LENGTH),
  description: optionalText(MAX_MENU_DESCRIPTION_LENGTH, 'Açıklama'),
  ...priceShape,
  /** En az kişi şartı (altında uyarı; satış bilinçli istisna yapabilir). */
  minGuests: guestCountField('En az kişi'),
  courses: coursesField(false),
};

export const createBanquetMenuSchema = z.object(banquetMenuShape);
export const updateBanquetMenuSchema = z.object({ expectedUpdatedAt, ...banquetMenuShape, isActive: z.boolean() });
export const banquetMenuParamSchema = z.object({ menuId: uuid('Geçersiz menü') });
export const banquetMenuListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  active: queryBoolean.optional(),
});

/* ── Etkinlik menüsü ── */

const eventMenuShape = {
  sessionId: uuid('Oturum seçin'),
  /** Katalogdan kopyalandıysa kaynağı (iz için; sonradan değişen katalog etkinliği bozmaz). */
  sourceMenuId: uuid('Geçersiz menü').nullish(),
  name: nameField('Menü adı', MAX_MENU_NAME_LENGTH),
  /** Servis anı (otelin duvar saati), oturumun içinde: kahve arası 10:30, öğle 12:30… */
  serveAt: wallTimeField('Servis saati'),
  /** Boş = etkinliğin faturalanacak kişisi (garanti, yoksa tahmin); dolu = bu öğünün kendi kişisi. */
  guests: guestCountField('Kişi'),
  ...priceShape,
  discountPct: percentField('İndirim').default('0'),
  /** Mutfak notu: özel diyetler, servis şekli. */
  notes: optionalText(MAX_MENU_NOTES_LENGTH, 'Mutfak notu'),
  courses: coursesField(true),
};

export const saveEventMenuSchema = z.object({ expectedUpdatedAt, ...eventMenuShape });
export const eventMenuParamSchema = z.object({ eventId: uuid('Geçersiz etkinlik'), menuId: uuid('Geçersiz menü') });
export const eventMenuVersionSchema = z.object({ expectedUpdatedAt });
export const reopenEventMenuSchema = z.object({
  expectedUpdatedAt,
  reason: z
    .string({ error: 'Gerekçe yazın' })
    .trim()
    .min(MIN_MENU_REASON_LENGTH, `Gerekçe en az ${MIN_MENU_REASON_LENGTH} karakter`)
    .max(MAX_MENU_REASON_LENGTH, `Gerekçe en fazla ${MAX_MENU_REASON_LENGTH} karakter`),
});

/* ── İhtiyaç ve üretim planı ── */

const rangeShape = { from: isoDayField, to: isoDayField, includeTentative: queryBoolean.default(false) };

/** Gün aralığı denetimi (bitiş ≥ başlangıç, en fazla N gün, iki uç dahil). @param {number} maxDays */
const refineRange = (maxDays) => (value, ctx) => {
  const days = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000;
  if (days < 0) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
  else if (days >= maxDays) ctx.addIssue({ code: 'custom', path: ['to'], message: `Aralık en fazla ${maxDays} gün` });
};

/** Malzeme ihtiyacı: servis günü aralığı; `stockItemId` verilirse o malzemenin etkinlik dökümü de gelir. */
export const fnbNeedsQuerySchema = z.object({ ...rangeShape, stockItemId: uuid('Geçersiz malzeme').optional() }).superRefine(refineRange(MAX_NEEDS_DAYS));
/** Üretim planı: hazırlık (başlama) günü aralığı. */
export const productionPlanQuerySchema = z
  .object({ ...rangeShape, station: z.enum(POS_STATIONS, { error: 'Geçersiz istasyon' }).optional() })
  .superRefine(refineRange(MAX_PRODUCTION_DAYS));
