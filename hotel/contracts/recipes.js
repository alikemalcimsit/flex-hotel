import { decimalField, expectedUpdatedAt, paginationQuerySchema, queryBoolean } from './fields.js';
import { z } from './locale.js';
import { POS_STATIONS } from './pos.js';

/**
 * Reçete ve malzeme kartı sözleşmeleri (modül 38'in reçete kısmı — modül 43'te kuruldu).
 *
 * Kararlar (kullanıcı, 27 Ekim 2026):
 * - Banket F&B planlaması (43) reçeteden malzeme hesaplar; 38'in reçetesi ve 44'ün stok
 *   kartı henüz yokken **reçete + yalın malzeme kartı** burada kurulur (modül 39'un menü
 *   emsali). Malzeme kartı = 44'ün `StockItem`'ı: kod, ad, grup, stok birimi, güncel birim
 *   maliyet (KDV hariç), alerjenler. Depo, hareket ve hareketli ortalama maliyet 44'te bunun
 *   üstüne eklenir (birim maliyeti 44 günceller).
 * - Reçete: yemek (porsiyon verir) ya da ara ürün (sos, fond, hamur — kg / L / adet verir).
 *   Satırı bir malzeme ya da başka bir reçete (ara reçete); net miktar + fire yüzdesi
 *   (brüt = net / (1 − fire)). İç içe en fazla `MAX_RECIPE_DEPTH` seviye, döngü yasak.
 * - "Servisten önce" süresi (`leadMinutes`): mutfak üretim planı bununla geriye sayar;
 *   ara ürün, onu kullanan reçetenin başlangıcından bu kadar önce hazır olmalı.
 *
 * Birim aileleri: kütle (kg / g), hacim (L / ml), adet, porsiyon. Aynı ailede çevrilir;
 * aileler arası çevrim yok (adetin gramı malzemeye göre değişir).
 */

/* ─────────────── Birimler ─────────────── */

/** Prisma `KitchenUnit` ile birebir. Porsiyon yalnızca yemek reçetesinin verimidir. */
export const KITCHEN_UNITS = Object.freeze(['KG', 'G', 'L', 'ML', 'PIECE', 'PORTION']);
/** Malzeme kartının (stok) birimleri: porsiyon değil. */
export const STOCK_UNITS = Object.freeze(['KG', 'G', 'L', 'ML', 'PIECE']);
export const KITCHEN_UNIT_LABELS = Object.freeze({ KG: 'kg', G: 'g', L: 'L', ML: 'ml', PIECE: 'adet', PORTION: 'porsiyon' });

/** Birim ailesi ve aile tabanına çarpanı (kg = 1000 g, L = 1000 ml). */
const UNIT_FAMILY = Object.freeze({ KG: 'MASS', G: 'MASS', L: 'VOLUME', ML: 'VOLUME', PIECE: 'COUNT', PORTION: 'PORTION' });
export const KITCHEN_UNIT_FACTORS = Object.freeze({ KG: 1000, G: 1, L: 1000, ML: 1, PIECE: 1, PORTION: 1 });

/** @param {string} unit */
export const unitFamily = (unit) => UNIT_FAMILY[unit] ?? null;

/** Aynı ailede mi (birbirine çevrilebilir mi)? @param {string} a @param {string} b */
export const unitsCompatible = (a, b) => Boolean(unitFamily(a)) && unitFamily(a) === unitFamily(b);

/** Bir birimle aynı ailedeki birimler (satır birimi seçicisi). @param {string} unit */
export const compatibleUnits = (unit) => KITCHEN_UNITS.filter((candidate) => unitsCompatible(candidate, unit));

/* ─────────────── Malzeme kartı ─────────────── */

/** Prisma `StockItemGroup` ile birebir: satın alma listesi bu gruplarla bölünür (kasap, manav…). */
export const STOCK_ITEM_GROUPS = Object.freeze(['MEAT', 'POULTRY', 'SEAFOOD', 'DAIRY', 'PRODUCE', 'DRY_GOODS', 'PANTRY', 'BAKERY', 'BEVERAGE', 'FROZEN', 'OTHER']);
export const STOCK_ITEM_GROUP_LABELS = Object.freeze({
  MEAT: 'Kırmızı et',
  POULTRY: 'Beyaz et',
  SEAFOOD: 'Deniz ürünleri',
  DAIRY: 'Süt ürünleri ve yumurta',
  PRODUCE: 'Sebze ve meyve',
  DRY_GOODS: 'Kuru gıda ve bakliyat',
  PANTRY: 'Yağ, sos ve baharat',
  BAKERY: 'Unlu mamul',
  BEVERAGE: 'İçecek',
  FROZEN: 'Donuk',
  OTHER: 'Diğer',
});

/**
 * Alerjenler (Türk Gıda Kodeksi etiketleme yönetmeliği, Ek-1; AB 1169/2011 ile aynı 14 grup).
 * Malzemede işaretlenir; yemeğin alerjenleri satırlarından (ara reçeteler dahil) toplanır.
 */
export const ALLERGENS = Object.freeze(['GLUTEN', 'CRUSTACEANS', 'EGGS', 'FISH', 'PEANUTS', 'SOY', 'MILK', 'NUTS', 'CELERY', 'MUSTARD', 'SESAME', 'SULPHITES', 'LUPIN', 'MOLLUSCS']);
export const ALLERGEN_LABELS = Object.freeze({
  GLUTEN: 'Gluten',
  CRUSTACEANS: 'Kabuklular',
  EGGS: 'Yumurta',
  FISH: 'Balık',
  PEANUTS: 'Yer fıstığı',
  SOY: 'Soya',
  MILK: 'Süt (laktoz)',
  NUTS: 'Sert kabuklu meyve',
  CELERY: 'Kereviz',
  MUSTARD: 'Hardal',
  SESAME: 'Susam',
  SULPHITES: 'Sülfit',
  LUPIN: 'Acı bakla',
  MOLLUSCS: 'Yumuşakçalar',
});

/** Alerjenleri sabit sırayla (ekranda ve belgede hep aynı sıra). @param {Iterable<string>} values */
export const sortAllergens = (values) => {
  const set = new Set(values);
  return ALLERGENS.filter((allergen) => set.has(allergen));
};

/* ─────────────── Reçete ─────────────── */

/** Prisma `RecipeKind` ile birebir. */
export const RECIPE_KINDS = Object.freeze(['DISH', 'PREP']);
export const RECIPE_KIND_LABELS = Object.freeze({ DISH: 'Yemek', PREP: 'Ara ürün' });
export const RECIPE_KIND_HINTS = Object.freeze({
  DISH: 'Porsiyon verir; menüye ve banket menüsüne girer.',
  PREP: 'Sos, fond, hamur gibi: kg / L / adet verir, başka reçetede kullanılır.',
});

/** Ara ürünün verim birimleri (porsiyon yemeğindir). */
export const PREP_YIELD_UNITS = Object.freeze(['KG', 'L', 'PIECE']);

/* ─────────────── Sınırlar ─────────────── */

export const MAX_STOCK_CODE_LENGTH = 20;
export const MAX_STOCK_NAME_LENGTH = 120;
/** Birim maliyet üst sınırı (stok birimi başına; yazım hatasını yakalar). */
export const MAX_UNIT_COST = 1_000_000;
export const UNIT_COST_SCALE = 4;
export const MAX_RECIPE_NAME_LENGTH = 120;
export const MAX_RECIPE_CODE_LENGTH = 20;
export const MAX_RECIPE_LINES = 60;
/** İç içe reçete derinliği: yemek → ara ürün → ara ürün → ara ürün. */
export const MAX_RECIPE_DEPTH = 4;
/** Servisten / kullanımdan önce hazırlık süresi üst sınırı (marine: bir gün önceden; en fazla 3 gün). */
export const MAX_RECIPE_LEAD_MINUTES = 4320;
export const MAX_RECIPE_YIELD = 100_000;
export const QUANTITY_SCALE = 4;
export const MAX_RECIPE_LINE_QUANTITY = 100_000;
/** Fire üst sınırı (%): ayıklama kaybı %90'ı aşan satır yazım hatasıdır. */
export const MAX_WASTE_PCT = 90;
export const MAX_RECIPE_METHOD_LENGTH = 4000;
export const MAX_RECIPE_NOTE_LENGTH = 200;
/** Seçici (yemek / ara ürün / malzeme arama) en fazla bu kadar sonuç döner. */
export const MAX_PICKER_RESULTS = 30;

/* ─────────────── Saf kurallar ─────────────── */

/**
 * Satırın birimi kaynağına uyuyor mu? Malzeme → malzemenin stok birimiyle aynı aile; ara
 * reçete → reçetenin verim birimiyle aynı aile (yemek alt reçetesi porsiyonla).
 *
 * @param {string} lineUnit
 * @param {string} sourceUnit malzemenin stok birimi ya da reçetenin verim birimi
 */
export const lineUnitError = (lineUnit, sourceUnit) =>
  unitsCompatible(lineUnit, sourceUnit) ? null : `Birim uyuşmuyor: ${KITCHEN_UNIT_LABELS[lineUnit] ?? lineUnit} → ${KITCHEN_UNIT_LABELS[sourceUnit] ?? sourceUnit} çevrilemez`;

/**
 * Reçete türü ile verim birimi uyumu: yemek porsiyon verir, ara ürün kg / L / adet.
 * @param {string} kind @param {string} yieldUnit
 */
export function yieldUnitError(kind, yieldUnit) {
  if (kind === 'DISH') return yieldUnit === 'PORTION' ? null : 'Yemek porsiyon verir';
  return PREP_YIELD_UNITS.includes(yieldUnit) ? null : 'Ara ürün kg, L ya da adet verir';
}

/** Dakika → "1 gün 2 sa 30 dk" (üretim planı ve reçete ekranı). @param {number} minutes */
export function leadText(minutes) {
  if (!minutes) return 'servisle birlikte';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return [days ? `${days} gün` : null, hours ? `${hours} sa` : null, rest ? `${rest} dk` : null].filter(Boolean).join(' ');
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

const intField = (label, min, max) =>
  z.coerce
    .number({ error: `${label} sayı olmalı` })
    .int(`${label} tam sayı olmalı`)
    .min(min, `${label} en az ${min}`)
    .max(max, `${label} en fazla ${max.toLocaleString('tr-TR')}`);

/** Virgüllü ondalık kabul eden sayı alanı (metin olarak taşınır). */
const decimalInput = (options) => z.preprocess((value) => (typeof value === 'string' ? value.trim().replace(',', '.') : value), decimalField(options));

const codeField = (label, max) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .max(max, `${label} en fazla ${max} karakter`)
    .regex(/^([A-Z0-9][A-Z0-9._-]*)?$/, `${label} yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir`)
    .transform((value) => value || null)
    .nullish();

const nameField = (label, max) => z.string({ error: `${label} zorunlu` }).trim().min(2, `${label} en az 2 karakter`).max(max, `${label} en fazla ${max} karakter`);

const allergenList = z
  .array(z.enum(ALLERGENS, { error: 'Geçersiz alerjen' }), { error: 'Alerjenler geçersiz' })
  .max(ALLERGENS.length)
  .default([])
  .transform((values) => sortAllergens(values));

const stockItemShape = {
  code: codeField('Kod', MAX_STOCK_CODE_LENGTH),
  name: nameField('Malzeme adı', MAX_STOCK_NAME_LENGTH),
  group: z.enum(STOCK_ITEM_GROUPS, { error: 'Grup seçin' }),
  unit: z.enum(STOCK_UNITS, { error: 'Stok birimi seçin' }),
  /** Stok birimi başına, KDV hariç (44 gelince hareketli ortalama maliyet burayı günceller). */
  unitCost: decimalInput({ scale: UNIT_COST_SCALE, min: 0, max: MAX_UNIT_COST, label: 'Birim maliyet' }),
  allergens: allergenList,
};

export const createStockItemSchema = z.object(stockItemShape);
export const updateStockItemSchema = z.object({ expectedUpdatedAt, ...stockItemShape, isActive: z.boolean() });
export const stockItemParamSchema = z.object({ stockItemId: uuid('Geçersiz malzeme') });
export const stockItemListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  group: z.enum(STOCK_ITEM_GROUPS, { error: 'Geçersiz grup' }).optional(),
  active: queryBoolean.optional(),
});

const recipeLineRow = z
  .object({
    stockItemId: uuid('Geçersiz malzeme').nullish(),
    subRecipeId: uuid('Geçersiz reçete').nullish(),
    /** Net (kullanılan) miktar, satırın biriminde. */
    quantity: decimalInput({ scale: QUANTITY_SCALE, min: 0.0001, max: MAX_RECIPE_LINE_QUANTITY, label: 'Miktar' }),
    unit: z.enum(KITCHEN_UNITS, { error: 'Birim seçin' }),
    /** Fire (ayıklama / pişirme kaybı) yüzdesi: brüt = net / (1 − fire). */
    wastePct: decimalInput({ scale: 2, min: 0, max: MAX_WASTE_PCT, label: 'Fire' }).default('0'),
    note: optionalText(MAX_RECIPE_NOTE_LENGTH, 'Not'),
  })
  .superRefine((value, ctx) => {
    const sources = [value.stockItemId, value.subRecipeId].filter(Boolean).length;
    if (sources !== 1) ctx.addIssue({ code: 'custom', path: ['stockItemId'], message: 'Malzeme ya da ara reçete seçin' });
  });

const recipeShape = {
  code: codeField('Kod', MAX_RECIPE_CODE_LENGTH),
  name: nameField('Reçete adı', MAX_RECIPE_NAME_LENGTH),
  kind: z.enum(RECIPE_KINDS, { error: 'Reçete türünü seçin' }),
  station: z.enum(POS_STATIONS, { error: 'İstasyon seçin' }).default('HOT'),
  /** Restoran menüsündeki ürün (maliyet / kâr marjı için; bir ürünün tek reçetesi olur). */
  menuItemId: uuid('Geçersiz menü ürünü').nullish(),
  yieldQuantity: decimalInput({ scale: 3, min: 0.001, max: MAX_RECIPE_YIELD, label: 'Verim' }),
  yieldUnit: z.enum(KITCHEN_UNITS, { error: 'Verim birimi seçin' }),
  leadMinutes: intField('Hazırlık süresi', 0, MAX_RECIPE_LEAD_MINUTES).default(0),
  method: optionalText(MAX_RECIPE_METHOD_LENGTH, 'Yapılış'),
  lines: z
    .array(recipeLineRow, { error: 'Satırlar geçersiz' })
    .min(1, 'En az bir malzeme satırı girin')
    .max(MAX_RECIPE_LINES, `En fazla ${MAX_RECIPE_LINES} satır`),
};

/** @param {{ kind?: string, yieldUnit?: string, menuItemId?: string | null }} value @param {import('zod').RefinementCtx} ctx */
function refineRecipe(value, ctx) {
  if (value.kind && value.yieldUnit) {
    const error = yieldUnitError(value.kind, value.yieldUnit);
    if (error) ctx.addIssue({ code: 'custom', path: ['yieldUnit'], message: error });
  }
  if (value.kind === 'PREP' && value.menuItemId) ctx.addIssue({ code: 'custom', path: ['menuItemId'], message: 'Menü ürünü yalnızca yemek reçetesine bağlanır' });
}

export const createRecipeSchema = z.object(recipeShape).superRefine(refineRecipe);
export const updateRecipeSchema = z.object({ expectedUpdatedAt, ...recipeShape, isActive: z.boolean() }).superRefine(refineRecipe);
/** Kaydetmeden maliyet önizlemesi (satırlar ve verim; düzenlenen reçete döngü denetimi için). */
export const recipePreviewSchema = z
  .object({
    recipeId: uuid('Geçersiz reçete').nullish(),
    kind: recipeShape.kind,
    yieldQuantity: recipeShape.yieldQuantity,
    yieldUnit: recipeShape.yieldUnit,
    lines: z.array(recipeLineRow, { error: 'Satırlar geçersiz' }).max(MAX_RECIPE_LINES, `En fazla ${MAX_RECIPE_LINES} satır`),
  })
  .superRefine(refineRecipe);
export const recipeParamSchema = z.object({ recipeId: uuid('Geçersiz reçete') });
export const recipeListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  kind: z.enum(RECIPE_KINDS, { error: 'Geçersiz tür' }).optional(),
  station: z.enum(POS_STATIONS, { error: 'Geçersiz istasyon' }).optional(),
  active: queryBoolean.optional(),
  /** Yalnızca restoran menüsüne bağlı reçeteler (maliyet / kâr marjı tablosu). */
  linked: queryBoolean.optional(),
});
/** Seçici araması: reçete (yemek / ara ürün) ya da menü ürünü. */
export const recipePickerQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  kind: z.enum(RECIPE_KINDS, { error: 'Geçersiz tür' }).optional(),
  /** Seçilemeyecek reçete (düzenlenen reçetenin kendisi). */
  exclude: uuid('Geçersiz reçete').optional(),
});
export const menuItemPickerQuerySchema = z.object({ search: z.string().trim().max(200).optional(), recipeId: uuid('Geçersiz reçete').optional() });
