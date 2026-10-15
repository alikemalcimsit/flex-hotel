import { normalizeDecimalString } from './decimal.js';
import { dateField, expectedUpdatedAt, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * Acente bonus / hedef primi sözleşmeleri (modül 35).
 *
 * Kararlar (kullanıcı, 15 Ekim 2026):
 * - **Üretim:** dönemin içine düşen, misafirin gerçekten kaldığı geceler (iptal ve
 *   gelmeyen sayılmaz; dönem sınırını aşan konaklama gece gece bölünür). Eldeki
 *   (gelecek) geceler ilerleme panelinde tahmin olarak görünür, hak edişe girmez.
 * - **Matrah (ciro):** folyoya işlenen **vergisiz oda geliri** (gelir raporuyla aynı
 *   tanım; komisyon düşülmez). Ciro hedefi de bu tutarla ölçülür.
 * - **Onay:** hak ediş onay kuyruğuna gider, dört göz (onaya gönderen onaylayamaz).
 *   Onaylanınca kilitlenir; muhasebe "ödendi" işaretler (cari düşümü modül 47).
 * - **Puan:** ayrı puan defteri yok; acente puanı = hedefe ulaşma yüzdesi, ulaşılan /
 *   tahmini kademe ve zamana göre durum.
 *
 * Tarihler gün hassasiyetindedir ve **iki ucu da dahildir** (1 May – 31 Eki: 31 Ekim
 * gecesi dahil). Para birimi otelin para birimidir.
 */

/* ─────────────── Ölçüt, uygulama, durumlar ─────────────── */

/** Prisma `AgencyBonusMetric` ile birebir: hedefin ve kademe eşiklerinin birimi. */
export const AGENCY_BONUS_METRICS = Object.freeze(['NIGHTS', 'REVENUE']);

export const AGENCY_BONUS_METRIC_LABELS = Object.freeze({
  NIGHTS: 'Gerçekleşen gece',
  REVENUE: 'Vergisiz oda geliri',
});

/**
 * Prisma `AgencyBonusMode` ile birebir: ulaşılan kademenin oranı neye uygulanır.
 * - `WHOLE`: dönemin bütün cirosuna (geriye dönük; kademe yükselince tamamı yeni orandan).
 * - `EXCESS`: her kademenin oranı yalnızca o kademenin dilimine (gelir vergisi dilimi gibi).
 *   Gece ölçütünde dilimin cirosu = dilimdeki gece × dönemin ortalama gece geliri.
 */
export const AGENCY_BONUS_MODES = Object.freeze(['WHOLE', 'EXCESS']);

export const AGENCY_BONUS_MODE_LABELS = Object.freeze({
  WHOLE: 'Tüm üretime (geriye dönük)',
  EXCESS: 'Yalnız aşan kısma (dilimli)',
});

export const AGENCY_BONUS_MODE_HINTS = Object.freeze({
  WHOLE: 'Ulaşılan en yüksek kademenin oranı dönemin bütün cirosuna uygulanır.',
  EXCESS: 'Her kademenin oranı yalnızca o kademeyi aşan üretime uygulanır; gece ölçütünde aşan geceler dönemin ortalama gece geliriyle tutara çevrilir.',
});

/**
 * Prisma `AgencyBonusRuleStatus` ile birebir.
 * - `DRAFT`: hazırlanıyor; ilerleme izlenmez, hak ediş çıkmaz.
 * - `ACTIVE`: yürürlükte; ilerleme izlenir, dönem bitince hak ediş hesaplanır.
 * - `CANCELLED`: iptal edildi (gerekçeli); onaylı / ödenmiş hak edişi olan kural iptal edilemez.
 */
export const AGENCY_BONUS_RULE_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'CANCELLED']);

export const AGENCY_BONUS_RULE_STATUS_LABELS = Object.freeze({
  DRAFT: 'Taslak',
  ACTIVE: 'Yürürlükte',
  CANCELLED: 'İptal',
});

/** Kuralın dönemine göre evresi (iş gününe göre; saklanmaz). */
export const AGENCY_BONUS_PHASES = Object.freeze(['UPCOMING', 'RUNNING', 'ENDED']);

export const AGENCY_BONUS_PHASE_LABELS = Object.freeze({
  UPCOMING: 'Başlamadı',
  RUNNING: 'Sürüyor',
  ENDED: 'Dönem bitti',
});

/**
 * Prisma `AgencyBonusStatus` ile birebir (hak ediş).
 * - `DRAFT`: hesaplandı; yeniden hesaplanabilir, onaya gönderilir.
 * - `PENDING_APPROVAL`: onay kuyruğunda; değiştirilemez.
 * - `APPROVED`: onaylandı (kilitli); ödenmediyse gerekçeyle yeniden açılabilir.
 * - `PAID`: ödendi olarak işaretlendi (tarih + belge no).
 */
export const AGENCY_BONUS_STATUSES = Object.freeze(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID']);

export const AGENCY_BONUS_STATUS_LABELS = Object.freeze({
  DRAFT: 'Hesaplandı',
  PENDING_APPROVAL: 'Onay bekliyor',
  APPROVED: 'Onaylandı',
  PAID: 'Ödendi',
});

/** Zamana göre ilerleme (doğrusal beklentiye kıyasla). */
export const AGENCY_BONUS_PACES = Object.freeze(['AHEAD', 'NEAR', 'BEHIND']);

export const AGENCY_BONUS_PACE_LABELS = Object.freeze({
  AHEAD: 'Hedefin önünde',
  NEAR: 'Hedefe yakın',
  BEHIND: 'Hedefin gerisinde',
});

/** Kural listesinin sıralamaları. */
export const AGENCY_BONUS_RULE_SORTS = Object.freeze(['END_DATE', 'SCORE_DESC', 'SCORE_ASC', 'AGENCY']);

export const AGENCY_BONUS_RULE_SORT_LABELS = Object.freeze({
  END_DATE: 'Dönem sonu (yakın önce)',
  SCORE_DESC: 'Hedefe ulaşma (yüksek önce)',
  SCORE_ASC: 'Hedefe ulaşma (düşük önce)',
  AGENCY: 'Acente adı',
});

/** Hak ediş satırlarının (rezervasyon dökümü) sıralamaları. */
export const AGENCY_BONUS_LINE_SORTS = Object.freeze(['REVENUE_DESC', 'NIGHTS_DESC', 'CHECK_IN']);

/* ─────────────── Sınırlar ─────────────── */

/** Bir kuraldaki en fazla kademe. */
export const MAX_BONUS_TIERS = 10;
/** Kademe prim oranı üst sınırı (yüzde). Gerçek sözleşmelerde %1–%10; üstü yazım hatası. */
export const MAX_BONUS_RATE_PCT = 50;
/** Kural döneminin en uzun hali (gün; iki yıl). */
export const MAX_BONUS_PERIOD_DAYS = 731;
/** Gece hedefi / eşiği üst sınırı. */
export const MAX_BONUS_NIGHT_TARGET = 1_000_000;
/** Ciro hedefi / eşiği üst sınırı (metin: büyük tutar). */
export const MAX_BONUS_REVENUE_TARGET = '10000000000';
/** Prim üst sınırı (tavan) ve hak ediş tutarının sınırı. */
export const MAX_BONUS_AMOUNT = '100000000';
export const MAX_BONUS_RULE_NAME_LENGTH = 120;
export const MAX_BONUS_NOTES_LENGTH = 1000;
/** Oda tipi süzgecinde en fazla oda tipi. */
export const MAX_BONUS_ROOM_TYPES = 100;
export const MIN_BONUS_REASON_LENGTH = 5;
export const MAX_BONUS_REASON_LENGTH = 300;
export const MIN_PAYMENT_REF_LENGTH = 2;
export const MAX_PAYMENT_REF_LENGTH = 60;
/**
 * Zamana göre ilerleme toleransı (yüzde): gerçekleşen, doğrusal beklentinin
 * bu kadar altına kadar "hedefe yakın", daha aşağısı "gerisinde".
 */
export const BONUS_PACE_TOLERANCE_PCT = 10;
/** Hak ediş onayı bu kadar gün kararsız kalırsa düşer (hak ediş yeniden "hesaplandı" olur). */
export const AGENCY_BONUS_APPROVAL_TTL_DAYS = 7;
/** Hak ediş dökümü Excel'e bu kadarlık parçalarla çekilir (tek yanıt şişmesin). */
export const AGENCY_BONUS_EXPORT_PART_SIZE = 10_000;
/** Excel'e aktarılan en fazla döküm satırı (büyük tur operatörünün yılı rahat sığar). */
export const AGENCY_BONUS_EXPORT_MAX_LINES = 200_000;
/** Hak ediş raporu dönemi (dönem sonuna göre süzgeç) en fazla bu kadar gün. */
export const MAX_BONUS_REPORT_DAYS = 1100;

/* ─────────────── Saf kurallar (ekran ve sunucu aynı kuralı kullanır) ─────────────── */

const DAY_MS = 86_400_000;

/** @param {Date | string} value */
const dayText = (value) => (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10));

/** "2027-06-01" → "01.06.2027" */
const dotted = (value) => {
  const [year, month, day] = dayText(value).split('-');
  return `${day}.${month}.${year}`;
};

/** İki uç dahil gün sayısı. */
export function bonusPeriodDays(startDate, endDate) {
  return Math.round((Date.parse(dayText(endDate)) - Date.parse(dayText(startDate))) / DAY_MS) + 1;
}

/**
 * Kuralın evresi: iş gününe göre başlamadı / sürüyor / dönem bitti. Dönemin son
 * gecesi iş gününden önceyse (gece kapanışı yapıldıysa) dönem bitmiştir.
 *
 * @param {{ startDate: Date | string, endDate: Date | string }} period
 * @param {string} businessDate "YYYY-AA-GG"
 * @returns {'UPCOMING' | 'RUNNING' | 'ENDED'}
 */
export function bonusPhase(period, businessDate) {
  if (dayText(period.endDate) < businessDate) return 'ENDED';
  if (dayText(period.startDate) > businessDate) return 'UPCOMING';
  return 'RUNNING';
}

/**
 * Ölçüte göre eşik metni: gece tam sayı, ciro kuruşlu tutar.
 * @param {'NIGHTS' | 'REVENUE'} metric
 * @param {string} value
 * @returns {string | null} sebep
 */
export function bonusQuantityIssue(metric, value) {
  if (metric === 'NIGHTS') {
    if (!/^\d+$/.test(value)) return 'Gece sayısı tam sayı olmalı';
    const nights = Number(value);
    if (nights < 1) return 'En az 1 gece olmalı';
    if (nights > MAX_BONUS_NIGHT_TARGET) return `En fazla ${MAX_BONUS_NIGHT_TARGET.toLocaleString('tr-TR')} gece`;
    return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return 'Tutar geçersiz (en fazla 2 ondalık)';
  if (Number(value) <= 0) return 'Tutar 0\'dan büyük olmalı';
  if (Number(value) > Number(MAX_BONUS_REVENUE_TARGET)) return 'Tutar çok yüksek; yazım hatası olabilir';
  return null;
}

/**
 * @typedef {{ threshold: string, ratePct: string }} BonusTier
 * @typedef {{ index: number, field: 'threshold' | 'ratePct', message: string }} TierIssue
 */

/**
 * Kademelerin tutarlılığı: eşikler ölçüte uygun ve **kesin artan**, oranlar
 * yukarı doğru **azalmaz** (üst kademe alttakinden düşük oran veremez).
 *
 * @param {BonusTier[]} tiers
 * @param {'NIGHTS' | 'REVENUE'} metric
 * @returns {TierIssue[]}
 */
export function bonusTierIssues(tiers, metric) {
  /** @type {TierIssue[]} */
  const issues = [];
  let previous = null;
  tiers.forEach((tier, index) => {
    const threshold = String(tier.threshold ?? '').trim();
    const quantityIssue = bonusQuantityIssue(metric, threshold);
    if (quantityIssue) {
      issues.push({ index, field: 'threshold', message: quantityIssue });
      return;
    }
    if (previous) {
      if (Number(threshold) <= Number(previous.threshold)) {
        issues.push({ index, field: 'threshold', message: `Eşik bir önceki kademeden (${previous.threshold}) büyük olmalı` });
      }
      if (Number(tier.ratePct) < Number(previous.ratePct)) {
        issues.push({ index, field: 'ratePct', message: `Oran bir önceki kademeden (%${previous.ratePct}) düşük olamaz` });
      }
    }
    previous = { threshold, ratePct: tier.ratePct };
  });
  return issues;
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

const reasonField = (label) =>
  z
    .string({ error: `${label} yazın` })
    .trim()
    .min(MIN_BONUS_REASON_LENGTH, `${label} en az ${MIN_BONUS_REASON_LENGTH} karakter`)
    .max(MAX_BONUS_REASON_LENGTH, `${label} en fazla ${MAX_BONUS_REASON_LENGTH} karakter`);

/** Sayı metni: virgül ondalık ayıracı kabul edilir, boşluk / binlik nokta yok. */
const quantityText = (label) =>
  z
    .union([z.string(), z.number()], { error: `${label} zorunlu` })
    .transform((value) => String(value).trim().replace(',', '.'))
    .refine((value) => value.length > 0, { message: `${label} zorunlu` })
    .transform((value, ctx) => {
      try {
        return normalizeDecimalString(value);
      } catch {
        ctx.addIssue({ code: 'custom', message: `${label} sayı olmalı` });
        return z.NEVER;
      }
    });

const rateField = z
  .union([z.string(), z.number()], { error: 'Oran zorunlu' })
  .transform((value) => String(value).trim().replace(',', '.'))
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), { message: 'Oran geçersiz (ör. 2 ya da 2,5; en fazla 2 ondalık)' })
  .transform(normalizeDecimalString)
  .refine((value) => Number(value) > 0, { message: 'Oran 0\'dan büyük olmalı' })
  .refine((value) => Number(value) <= MAX_BONUS_RATE_PCT, { message: `Oran en fazla %${MAX_BONUS_RATE_PCT}` });

const tierSchema = z.object({
  threshold: quantityText('Eşik'),
  ratePct: rateField,
});

/** Prim tavanı: boş = tavansız. */
const maxBonusField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim().replace(',', '.');
    if (text === '') return null;
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      ctx.addIssue({ code: 'custom', message: 'Tavan tutarı geçersiz (en fazla 2 ondalık)' });
      return z.NEVER;
    }
    const normalized = normalizeDecimalString(text);
    if (Number(normalized) <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Tavan 0\'dan büyük olmalı (tavansız için boş bırakın)' });
      return z.NEVER;
    }
    if (Number(normalized) > Number(MAX_BONUS_AMOUNT)) {
      ctx.addIssue({ code: 'custom', message: 'Tavan tutarı çok yüksek; yazım hatası olabilir' });
      return z.NEVER;
    }
    return normalized;
  });

const ruleTermsShape = {
  startDate: dateField,
  endDate: dateField,
  metric: z.enum(AGENCY_BONUS_METRICS, { error: 'Ölçüt seçin' }),
  mode: z.enum(AGENCY_BONUS_MODES, { error: 'Uygulama şeklini seçin' }),
  target: quantityText('Hedef'),
  tiers: z
    .array(tierSchema, { error: 'Kademeler geçersiz' })
    .min(1, 'En az bir kademe girin')
    .max(MAX_BONUS_TIERS, `En fazla ${MAX_BONUS_TIERS} kademe`),
  /** Boşsa bütün oda tipleri sayılır. */
  roomTypeIds: z
    .array(uuid('Geçersiz oda tipi'))
    .max(MAX_BONUS_ROOM_TYPES, `En fazla ${MAX_BONUS_ROOM_TYPES} oda tipi`)
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Aynı oda tipi iki kez seçilmiş' }),
  maxBonus: maxBonusField,
};

const ruleShape = {
  name: z
    .string({ error: 'Kural adı zorunlu' })
    .trim()
    .min(2, 'Kural adı en az 2 karakter')
    .max(MAX_BONUS_RULE_NAME_LENGTH, `Kural adı en fazla ${MAX_BONUS_RULE_NAME_LENGTH} karakter`),
  ...ruleTermsShape,
  notes: optionalText(MAX_BONUS_NOTES_LENGTH, 'Not'),
};

/**
 * Dönem, hedef ve kademelerin birlikte denetimi.
 * @param {{ startDate?: Date, endDate?: Date, metric?: 'NIGHTS' | 'REVENUE', target?: string, tiers?: BonusTier[] }} value
 * @param {import('zod').RefinementCtx} ctx
 */
function refineTerms(value, ctx) {
  if (value.startDate && value.endDate) {
    if (value.endDate < value.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Bitiş tarihi başlangıçtan önce olamaz' });
    } else if (bonusPeriodDays(value.startDate, value.endDate) > MAX_BONUS_PERIOD_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: `Dönem en fazla ${MAX_BONUS_PERIOD_DAYS} gün olabilir` });
    }
  }
  if (!value.metric) return;
  if (value.target !== undefined) {
    const issue = bonusQuantityIssue(value.metric, value.target);
    if (issue) ctx.addIssue({ code: 'custom', path: ['target'], message: `Hedef: ${issue.charAt(0).toLowerCase()}${issue.slice(1)}` });
  }
  for (const issue of bonusTierIssues(value.tiers ?? [], value.metric)) {
    ctx.addIssue({ code: 'custom', path: ['tiers', issue.index, issue.field], message: issue.message });
  }
}

/** Yeni kural (taslak açılır). */
export const createAgencyBonusRuleSchema = z
  .object({ agencyId: uuid('Acente seçin'), ...ruleShape })
  .superRefine(refineTerms);

/** Kuralı günceller (form hepsini gönderir; acente değişmez) — sürüm kontrolüyle. */
export const updateAgencyBonusRuleSchema = z.object({ expectedUpdatedAt, ...ruleShape }).superRefine(refineTerms);

/**
 * Formdaki koşullarla "şu ana kadarki üretim ve prim" önizlemesi (kaydetmeden).
 * Kural adı istenmez.
 */
export const previewAgencyBonusRuleSchema = z
  .object({ agencyId: uuid('Acente seçin'), ...ruleTermsShape })
  .superRefine(refineTerms);

export const agencyBonusVersionSchema = z.object({ expectedUpdatedAt });

export const cancelAgencyBonusRuleSchema = z.object({ expectedUpdatedAt, reason: reasonField('İptal gerekçesi') });

export const agencyBonusRuleParamSchema = z.object({ ruleId: uuid('Geçersiz kural') });
export const agencyBonusParamSchema = z.object({ bonusId: uuid('Geçersiz hak ediş') });

export const agencyBonusRuleListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  status: z.enum(AGENCY_BONUS_RULE_STATUSES, { error: 'Geçersiz durum' }).optional(),
  phase: z.enum(AGENCY_BONUS_PHASES, { error: 'Geçersiz evre' }).optional(),
  agencyId: uuid('Geçersiz acente').optional(),
  sort: z.enum(AGENCY_BONUS_RULE_SORTS, { error: 'Geçersiz sıralama' }).default('END_DATE'),
});

/** Hak ediş raporu: dönem sonu bu aralıkta olan hak edişler. */
export const agencyBonusListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(AGENCY_BONUS_STATUSES, { error: 'Geçersiz durum' }).optional(),
    agencyId: uuid('Geçersiz acente').optional(),
    from: dateField.optional(),
    to: dateField.optional(),
    search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;
    if (value.to < value.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Bitiş başlangıçtan önce olamaz' });
    } else if (bonusPeriodDays(value.from, value.to) > MAX_BONUS_REPORT_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: `Rapor dönemi en fazla ${MAX_BONUS_REPORT_DAYS} gün olabilir` });
    }
  });

export const agencyBonusLinesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200, 'Arama metni en fazla 200 karakter').optional(),
  sort: z.enum(AGENCY_BONUS_LINE_SORTS, { error: 'Geçersiz sıralama' }).default('REVENUE_DESC'),
});

/** Excel dökümünün parçası (1'den başlar). */
export const agencyBonusExportQuerySchema = z.object({
  part: z.coerce
    .number({ error: 'Parça numarası sayı olmalı' })
    .int('Parça numarası tam sayı olmalı')
    .min(1, 'Parça numarası 1\'den küçük olamaz')
    .max(Math.ceil(AGENCY_BONUS_EXPORT_MAX_LINES / AGENCY_BONUS_EXPORT_PART_SIZE), 'Parça numarası çok büyük')
    .default(1),
});

export const submitAgencyBonusSchema = z.object({
  expectedUpdatedAt,
  note: optionalText(MAX_BONUS_REASON_LENGTH, 'Not'),
});

export const markAgencyBonusPaidSchema = z.object({
  expectedUpdatedAt,
  paidAt: dateField,
  paymentRef: z
    .string({ error: 'Belge / dekont numarasını yazın' })
    .trim()
    .min(MIN_PAYMENT_REF_LENGTH, `Belge numarası en az ${MIN_PAYMENT_REF_LENGTH} karakter`)
    .max(MAX_PAYMENT_REF_LENGTH, `Belge numarası en fazla ${MAX_PAYMENT_REF_LENGTH} karakter`),
  note: optionalText(MAX_BONUS_REASON_LENGTH, 'Not'),
});

export const revertAgencyBonusPaymentSchema = z.object({ expectedUpdatedAt, reason: reasonField('Geri alma gerekçesi') });

export const reopenAgencyBonusSchema = z.object({ expectedUpdatedAt, reason: reasonField('Yeniden açma gerekçesi') });

/* ─────────────── Görünüm yardımcıları ─────────────── */

/**
 * Eşik / hedef metni: gece ölçütünde "1.200 gece", ciroda tutar (para birimiyle).
 * @param {'NIGHTS' | 'REVENUE'} metric
 * @param {string | number} value
 * @param {string} currency
 */
export function formatBonusQuantity(metric, value, currency) {
  const number = Number(value);
  if (metric === 'NIGHTS') return `${number.toLocaleString('tr-TR')} gece`;
  return `${number.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

/** Dönem metni: "01.05.2027 – 31.10.2027". */
export const formatBonusPeriod = (startDate, endDate) => `${dotted(startDate)} – ${dotted(endDate)}`;
