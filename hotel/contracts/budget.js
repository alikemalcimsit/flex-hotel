import { decimalField, expectedUpdatedAt } from './fields.js';
import { z } from './locale.js';

/**
 * Bütçe yönetimi sözleşmeleri (modül 27).
 *
 * Kararlar (kullanıcı, 5 Ekim 2026):
 * - **Kapsam:** gelir kalemleri ve doluluk / ADR hedefleri — gerçekleşen
 *   sistemden (folyoya işlenen gelir, gelir raporunun tanımları); gider
 *   kalemleri otelin tanımladığı kalemler — gerçekleşeni ay ay elle girilir
 *   (satın alma — modül 45 — ve ön muhasebe — modül 47 — gelince otomatiğe döner).
 *   Ayrıca tahsilat (ödeme) gerçekleşeni nakit takibi için.
 * - **Onay:** taslak → onaylı (kilitli). Değişiklik için revize taslağı açılır;
 *   revize onaylanınca önceki onaylı sürüm "eski sürüm" olarak saklanır.
 *   Sapma raporu yılın onaylı bütçesine göre (yoksa taslağa göre, işaretli).
 * - **Excel:** otele göre hazırlanmış şablon indirilir, doldurulup yüklenir.
 * - **AI yorumu:** sapma raporunda istenir; ajan kapalıysa / anahtar yoksa
 *   rapor yine tam çalışır.
 *
 * Tutarlar otelin para biriminde, vergiler hariç (gelir raporuyla aynı).
 */

/** Bütçe sürümünün durumu. */
export const BUDGET_STATUSES = Object.freeze(['DRAFT', 'APPROVED', 'SUPERSEDED']);

export const BUDGET_STATUS_LABELS = Object.freeze({
  DRAFT: 'Taslak',
  APPROVED: 'Onaylı',
  SUPERSEDED: 'Eski sürüm',
});

/** Kalem türü: gelir, hedef (oran / ortalama), gider, nakit. */
export const BUDGET_ITEM_KINDS = Object.freeze(['REVENUE', 'KPI', 'EXPENSE', 'CASH']);

export const BUDGET_ITEM_KIND_LABELS = Object.freeze({
  REVENUE: 'Gelirler',
  KPI: 'Hedefler',
  EXPENSE: 'Giderler',
  CASH: 'Nakit',
});

/** Kalemin birimi: para, yüzde. */
export const BUDGET_UNITS = Object.freeze(['MONEY', 'PCT']);

/**
 * Sistem kalemleri: gerçekleşeni sistemden hesaplanır, her bütçede vardır.
 * Sıra ekrandaki sıradır. Gelir sınıfları gelir raporununkiyle aynı
 * (oda / ek ücret / iptal); diğerleri folyo kaleminin türünden.
 */
export const BUDGET_SYSTEM_ITEMS = Object.freeze([
  { code: 'ROOM_REVENUE', kind: 'REVENUE', unit: 'MONEY', label: 'Oda geliri' },
  { code: 'FNB_REVENUE', kind: 'REVENUE', unit: 'MONEY', label: 'Yiyecek & içecek geliri' },
  { code: 'MINIBAR_REVENUE', kind: 'REVENUE', unit: 'MONEY', label: 'Minibar geliri' },
  { code: 'LAUNDRY_REVENUE', kind: 'REVENUE', unit: 'MONEY', label: 'Çamaşırhane geliri' },
  { code: 'FEE_REVENUE', kind: 'REVENUE', unit: 'MONEY', label: 'Erken giriş / geç çıkış ücreti' },
  { code: 'CANCELLATION_REVENUE', kind: 'REVENUE', unit: 'MONEY', label: 'İptal / gelmeme geliri' },
  { code: 'OTHER_REVENUE', kind: 'REVENUE', unit: 'MONEY', label: 'Diğer gelir' },
  { code: 'OCCUPANCY', kind: 'KPI', unit: 'PCT', label: 'Doluluk' },
  { code: 'ADR', kind: 'KPI', unit: 'MONEY', label: 'ADR (ortalama oda fiyatı)' },
  { code: 'COLLECTIONS', kind: 'CASH', unit: 'MONEY', label: 'Tahsilat' },
]);

export const BUDGET_SYSTEM_CODES = Object.freeze(BUDGET_SYSTEM_ITEMS.map((item) => item.code));

/**
 * İlk bütçede önerilen gider kalemleri (USALI'nin dağıtılmamış giderleri ve
 * departman maliyetleri; otel adını değiştirir, siler, ekler).
 */
export const BUDGET_DEFAULT_EXPENSES = Object.freeze([
  'Personel',
  'Yiyecek & içecek maliyeti',
  'Oda giderleri (sarf, çamaşır, temizlik)',
  'Enerji (elektrik, su, gaz)',
  'Bakım & onarım',
  'Satış & pazarlama (komisyonlar dahil)',
  'Genel yönetim',
]);

/** Bir otelin en fazla gider kalemi (ekran ve Excel şablonu taşınabilir kalsın). */
export const BUDGET_MAX_EXPENSE_ITEMS = 40;
export const BUDGET_EXPENSE_LABEL_MAX = 80;
/** Bütçe yılı sınırları (yazım hatasını yakalar). */
export const BUDGET_MIN_YEAR = 2000;
export const BUDGET_MAX_YEARS_AHEAD = 5;
/** Ay sayısı. */
export const BUDGET_MONTHS = 12;
/** Tutar üst sınırı (Decimal(14,2)). */
export const BUDGET_MAX_AMOUNT = 999_999_999_999.99;
/** Revize gerekçesi uzunluğu. */
export const BUDGET_REASON_MIN = 5;
export const BUDGET_REASON_MAX = 500;

/** Sapma raporu kapsamı: tek ay ya da yılbaşından seçilen aya kadar. */
export const BUDGET_SCOPES = Object.freeze(['MONTH', 'YTD']);

export const BUDGET_SCOPE_LABELS = Object.freeze({ MONTH: 'Ay', YTD: 'Yılbaşından bu yana' });

export const BUDGET_MONTH_LABELS = Object.freeze([
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
]);

/** AI yorumunun durumu. */
export const BUDGET_COMMENTARY_STATUSES = Object.freeze(['PENDING', 'READY', 'FAILED']);

/* ─────────────── Kurallar ─────────────── */

/**
 * Sapmanın iyi mi kötü mü olduğu: gelir ve hedefte fazlası iyi, giderde
 * fazlası kötü. Tahsilat gelir gibi.
 * @param {'REVENUE' | 'KPI' | 'EXPENSE' | 'CASH'} kind
 * @param {number} difference gerçek − plan
 * @returns {'GOOD' | 'BAD' | 'NEUTRAL'}
 */
export function varianceTone(kind, difference) {
  if (!Number.isFinite(difference) || difference === 0) return 'NEUTRAL';
  const favorable = kind === 'EXPENSE' ? difference < 0 : difference > 0;
  return favorable ? 'GOOD' : 'BAD';
}

/**
 * Bir yılın girilebilir olup olmadığı.
 * @param {number} year
 * @param {number} currentYear otelin iş gününün yılı
 * @returns {string | null} hata mesajı
 */
export function budgetYearError(year, currentYear) {
  if (!Number.isInteger(year) || year < BUDGET_MIN_YEAR) return `Yıl ${BUDGET_MIN_YEAR} ya da sonrası olmalı`;
  if (year > currentYear + BUDGET_MAX_YEARS_AHEAD) return `En fazla ${BUDGET_MAX_YEARS_AHEAD} yıl sonrası için bütçe girilir`;
  return null;
}

/* ─────────────── Şemalar ─────────────── */

const yearField = z.coerce
  .number({ error: 'Yıl sayı olmalı' })
  .int('Yıl tam sayı olmalı')
  .min(BUDGET_MIN_YEAR, `Yıl ${BUDGET_MIN_YEAR} ya da sonrası olmalı`)
  .max(9999, 'Geçersiz yıl');

const monthField = z.coerce.number({ error: 'Ay sayı olmalı' }).int('Ay tam sayı olmalı').min(1, 'Ay 1–12 arası').max(BUDGET_MONTHS, 'Ay 1–12 arası');

const amount = (label) => decimalField({ scale: 2, min: 0, max: BUDGET_MAX_AMOUNT, label });
const percent = (label) => decimalField({ scale: 1, min: 0, max: 100, label });

/** Bir ayın değeri: boş = planlanmadı. */
const cell = (label) => z.union([z.null(), z.literal('').transform(() => null), amount(label)]);
const pctCell = (label) => z.union([z.null(), z.literal('').transform(() => null), percent(label)]);

export const budgetYearParamSchema = z.object({ year: yearField });

export const budgetIdParamSchema = z.object({ id: z.string().uuid({ message: 'Geçersiz bütçe' }) });

export const budgetExpenseItemParamSchema = z.object({ itemId: z.string().uuid({ message: 'Geçersiz kalem' }) });

/** Yılın ilk bütçesini taslak açar. */
export const createBudgetSchema = z.object({ year: yearField });

/** Onaylı bütçenin revize taslağını açar (gerekçe zorunlu: neden değişti, denetimde kalır). */
export const reviseBudgetSchema = z.object({
  reason: z
    .string({ error: 'Revize gerekçesi zorunlu' })
    .trim()
    .min(BUDGET_REASON_MIN, `Gerekçe en az ${BUDGET_REASON_MIN} karakter`)
    .max(BUDGET_REASON_MAX, `Gerekçe en fazla ${BUDGET_REASON_MAX} karakter`),
});

/**
 * Taslağın satırlarını kaydeder (ızgaranın tamamı ya da Excel'den yüklenen
 * tablo). Kalem kodu sistem kalemi ya da otelin gider kaleminin kimliği; her
 * satır 12 ay (boş = planlanmadı). Doluluk yüzde (bir ondalık), diğerleri para.
 */
export const saveBudgetLinesSchema = z.object({
  expectedUpdatedAt,
  lines: z
    .array(
      z.object({
        item: z.string().trim().min(1, 'Kalem zorunlu').max(64, 'Geçersiz kalem'),
        months: z.array(z.unknown()).length(BUDGET_MONTHS, `Her kalem için ${BUDGET_MONTHS} ay olmalı`),
      }),
    )
    .max(BUDGET_SYSTEM_ITEMS.length + BUDGET_MAX_EXPENSE_ITEMS, 'Çok fazla kalem'),
}).transform((value, ctx) => {
  // Hücreler kalemin birimine göre ayrıştırılır (doluluk yüzde, diğerleri para); hata ay adıyla.
  const seen = new Set();
  const lines = value.lines.map((line, index) => {
    if (seen.has(line.item)) ctx.addIssue({ code: 'custom', path: ['lines', index, 'item'], message: 'Aynı kalem iki kez' });
    seen.add(line.item);
    const field = line.item === 'OCCUPANCY' ? pctCell('Doluluk') : cell('Tutar');
    const months = line.months.map((month, monthIndex) => {
      const parsed = field.safeParse(month);
      if (parsed.success) return parsed.data;
      ctx.addIssue({ code: 'custom', path: ['lines', index, 'months', monthIndex], message: `${BUDGET_MONTH_LABELS[monthIndex]}: ${parsed.error.issues[0].message}` });
      return null;
    });
    return { item: line.item, months };
  });
  return { expectedUpdatedAt: value.expectedUpdatedAt, lines };
});

/** Onay ya da revize gibi sürüm değiştiren işlemler. */
export const budgetVersionActionSchema = z.object({ expectedUpdatedAt });

const expenseLabel = z
  .string({ error: 'Kalem adı zorunlu' })
  .trim()
  .min(2, 'Kalem adı en az 2 karakter')
  .max(BUDGET_EXPENSE_LABEL_MAX, `Kalem adı en fazla ${BUDGET_EXPENSE_LABEL_MAX} karakter`);

export const budgetExpenseItemSchema = z.object({ label: expenseLabel });

export const updateBudgetExpenseItemSchema = z.object({ expectedUpdatedAt, label: expenseLabel });

/** Giderin gerçekleşeni (ay ay elle; boş = girilmedi). */
export const saveExpenseActualsSchema = z.object({
  year: yearField,
  entries: z
    .array(
      z.object({
        itemId: z.string().uuid({ message: 'Geçersiz kalem' }),
        month: monthField,
        amount: cell('Gerçekleşen'),
        /** Hücrenin okunan sürümü (yeni hücrede boş). */
        expectedUpdatedAt: expectedUpdatedAt.nullable().optional(),
      }),
    )
    .min(1, 'Kaydedilecek değer yok')
    .max(BUDGET_MAX_EXPENSE_ITEMS * BUDGET_MONTHS, 'Çok fazla değer'),
});

/** Sapma raporu. */
export const budgetVarianceQuerySchema = z.object({
  year: yearField,
  month: monthField,
  scope: z.enum(BUDGET_SCOPES, { error: 'Geçersiz kapsam' }).default('MONTH'),
});

/** AI yorumu isteği (aynı dönem için bekleyen istek varsa yenisi açılmaz). */
export const budgetCommentaryRequestSchema = budgetVarianceQuerySchema;
