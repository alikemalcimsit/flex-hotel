import { decimalField, expectedUpdatedAt, paginationQuerySchema } from './fields.js';
import { z } from './locale.js';

/**
 * Sadakat programı sözleşmeleri (modül 56).
 *
 * Kararlar:
 * - **Kazanma folyo kapanınca:** konaklamanın misafiri (rezervasyon sahibi) uygun harcamadan (folyo kalemleri, vergi kalemleri
 *   hariç, indirimler düşülmüş) `floor(harcama / spendPerPoint × seviye çarpanı)` puan kazanır. Acente / voucher ile kapanan folyo
 *   ayara göre kazanmaz; spa kasasında ödenen tamamlanmış randevu ayara göre kazanır. Folyo yeniden açılınca kazanılan geri alınır,
 *   yeniden kapanınca fark kazanılır (hedef − yazılmış).
 * - **Harcama konaklamanın açık folyosunda indirimdir:** puan × puan değeri tutarında `DISCOUNT` kalemi (seçilen gelir türünden).
 *   En az `minRedeemPoints`, folyo harcamasının en çok `maxRedeemPct`'i. Kalem iptal edilirse puan iade edilir. Muhasebede indirim
 *   kalemi olduğundan 611'e (satış iskontosu) kendiliğinden gider.
 * - **Seviye** son 12 ayda kazanılan puana göre (düşebilir); çarpanı kazanmaya uygulanır, avantaj metni ön büroya ve portala görünür.
 * - **Süre:** kazanılan puanın kullanılmayan kısmı `expiryMonths` ay sonra düşer (0 = süresiz). Harcama en eski puandan (FIFO).
 */

/* ─────────────── Sabitler ─────────────── */

export const LOYALTY_TRANSACTION_KINDS = Object.freeze(['EARN', 'EARN_REVERSAL', 'REDEEM', 'REDEEM_REVERSAL', 'EXPIRE', 'ADJUST']);
export const LOYALTY_TRANSACTION_KIND_LABELS = Object.freeze({
  EARN: 'Kazanıldı',
  EARN_REVERSAL: 'Kazanma geri alındı',
  REDEEM: 'Harcandı',
  REDEEM_REVERSAL: 'Harcama iade edildi',
  EXPIRE: 'Süresi doldu',
  ADJUST: 'Elle düzeltme',
});
export const LOYALTY_ACCOUNT_STATUSES = Object.freeze(['ACTIVE', 'CLOSED']);
export const LOYALTY_ACCOUNT_STATUS_LABELS = Object.freeze({ ACTIVE: 'Etkin', CLOSED: 'Kapalı' });
export const LOYALTY_NUMBER_PREFIX = 'SDK';
/** Seviye penceresi (ay): son bu kadar ayda kazanılan puan. */
export const LOYALTY_TIER_WINDOW_MONTHS = 12;
export const MAX_LOYALTY_TIERS = 6;
export const MAX_LOYALTY_POINTS = 10_000_000;
/** Puanın süresi dolmadan bu kadar gün önce misafir kartında uyarı. */
export const LOYALTY_EXPIRY_WARN_DAYS = 30;

/** Varsayılan seviyeler: yeni otelde ayar ekranı bununla açılır. */
export const DEFAULT_LOYALTY_TIERS = Object.freeze([
  Object.freeze({ code: 'CLASSIC', name: 'Klasik', minPoints: 0, multiplier: '1', perks: '' }),
  Object.freeze({ code: 'SILVER', name: 'Gümüş', minPoints: 1000, multiplier: '1.25', perks: 'Geç çıkış (müsaitliğe göre 14:00)' }),
  Object.freeze({ code: 'GOLD', name: 'Altın', minPoints: 3000, multiplier: '1.5', perks: 'Oda yükseltme (müsaitliğe göre), geç çıkış 16:00, hoş geldin ikramı' }),
]);

/* ─────────────── Saf kurallar ─────────────── */

/** @param {unknown} value */
const toNumber = (value) => Number(String(value ?? 0));

/**
 * Seviyeleri eşiğe göre sıralar; en düşük seviyenin eşiği 0 olmalı (yoksa ilk seviye 0'a çekilir).
 * @param {Array<{ code: string, name: string, minPoints: number, multiplier: string | number, perks?: string }>} tiers
 */
export function normalizeTiers(tiers) {
  const sorted = [...(tiers ?? [])].sort((a, b) => a.minPoints - b.minPoints);
  if (sorted.length === 0) return [{ code: 'MEMBER', name: 'Üye', minPoints: 0, multiplier: '1', perks: '' }];
  return sorted.map((tier, index) => ({ ...tier, minPoints: index === 0 ? 0 : tier.minPoints, multiplier: String(tier.multiplier), perks: tier.perks ?? '' }));
}

/**
 * Seviye: eşiği geçilen en yüksek seviye, bir sonraki ve kalan puan.
 * @param {Array<{ code: string, name: string, minPoints: number, multiplier: string, perks: string }>} tiers normalizeTiers çıktısı
 * @param {number} qualifyingPoints
 */
export function tierFor(tiers, qualifyingPoints) {
  const list = normalizeTiers(tiers);
  let current = list[0];
  for (const tier of list) if (qualifyingPoints >= tier.minPoints) current = tier;
  const next = list.find((tier) => tier.minPoints > qualifyingPoints) ?? null;
  return { current, next, toNext: next ? next.minPoints - qualifyingPoints : 0 };
}

/**
 * Kazanılan puan: `floor(harcama / spendPerPoint × çarpan)`; kuruş taşması olmasın diye kuruşla hesaplanır.
 * @param {{ spend: string | number, spendPerPoint: string | number, multiplier?: string | number }} input
 */
export function pointsForSpend({ spend, spendPerPoint, multiplier = 1 }) {
  const spendCents = Math.round(toNumber(spend) * 100);
  const unitCents = Math.round(toNumber(spendPerPoint) * 100);
  if (spendCents <= 0 || unitCents <= 0) return 0;
  const multiplierThousandths = Math.round(toNumber(multiplier) * 1000);
  return Math.floor((spendCents * multiplierThousandths) / (unitCents * 1000));
}

/** Puanın para karşılığı (kuruşa yuvarlı, metin). @param {number} points @param {string | number} pointValue */
export function pointsValue(points, pointValue) {
  const cents = Math.round(points * toNumber(pointValue) * 100);
  return (cents / 100).toFixed(2);
}

/**
 * Bir folyoda en çok harcanabilecek puan: bakiye, folyo harcamasının yüzdesi ve puan değeri sınırları.
 * @param {{ balance: number, chargesTotal: string | number, maxRedeemPct: number, pointValue: string | number }} input
 */
export function maxRedeemablePoints({ balance, chargesTotal, maxRedeemPct, pointValue }) {
  const capCents = Math.floor(Math.round(toNumber(chargesTotal) * 100) * (maxRedeemPct / 100));
  const valueCents = Math.round(toNumber(pointValue) * 100);
  if (valueCents <= 0 || capCents <= 0) return 0;
  return Math.max(0, Math.min(balance, Math.floor(capCents / valueCents)));
}

/**
 * FIFO harcama: lotlardan (en eskisi önce, süresi yakın olan önce) `points` kadar düşer.
 * @param {Array<{ id: string, remaining: number }>} lots sıralı
 * @param {number} points
 * @returns {{ consumed: Array<{ lotId: string, points: number }>, shortfall: number }}
 */
export function consumeLots(lots, points) {
  let left = points;
  const consumed = [];
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(lot.remaining, left);
    if (take <= 0) continue;
    consumed.push({ lotId: lot.id, points: take });
    left -= take;
  }
  return { consumed, shortfall: left };
}

/* ─────────────── Şemalar ─────────────── */

const tierSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,20}$/, 'Kod 2–20 karakter: büyük harf, rakam, _'),
  name: z.string().trim().min(2, 'Seviye adı en az 2 karakter').max(40),
  minPoints: z.coerce.number().int().min(0, 'Eşik eksi olamaz').max(MAX_LOYALTY_POINTS),
  multiplier: decimalField({ scale: 2, min: 1, max: 5, label: 'Çarpan' }),
  perks: z.string().trim().max(300, 'Avantaj metni en fazla 300 karakter').default(''),
});

export const loyaltySettingsSchema = z
  .object({
    expectedUpdatedAt: z.union([expectedUpdatedAt, z.null()]).default(null),
    isEnabled: z.boolean(),
    programName: z.string().trim().min(2, 'Program adı en az 2 karakter').max(60),
    spendPerPoint: decimalField({ scale: 2, min: 0.01, max: 100_000, label: '1 puan için harcama' }),
    pointValue: decimalField({ scale: 4, min: 0.0001, max: 10_000, label: 'Puan değeri' }),
    minRedeemPoints: z.coerce.number().int().min(1, 'En az 1').max(MAX_LOYALTY_POINTS),
    maxRedeemPct: z.coerce.number().int().min(1, 'En az %1').max(100, 'En çok %100'),
    expiryMonths: z.coerce.number().int().min(0).max(120, 'En çok 120 ay'),
    autoEnroll: z.boolean(),
    excludeLedgerPaid: z.boolean(),
    earnOnSpa: z.boolean(),
    tiers: z.array(tierSchema).min(1, 'En az bir seviye').max(MAX_LOYALTY_TIERS, `En çok ${MAX_LOYALTY_TIERS} seviye`),
  })
  .superRefine((value, ctx) => {
    const codes = value.tiers.map((tier) => tier.code);
    if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'Seviye kodları tekil olmalı' });
    const thresholds = value.tiers.map((tier) => tier.minPoints);
    if (new Set(thresholds).size !== thresholds.length) ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'İki seviyenin eşiği aynı olamaz' });
    if (!thresholds.includes(0)) ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'Bir seviyenin eşiği 0 olmalı (başlangıç seviyesi)' });
  });

export const loyaltyAccountListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(80).optional(),
  tier: z.string().trim().max(20).optional(),
  status: z.enum(LOYALTY_ACCOUNT_STATUSES).optional(),
  sort: z.enum(['balance', 'name', 'recent']).default('recent'),
});
export const loyaltyAccountParamSchema = z.object({ accountId: z.string().uuid({ message: 'Geçersiz hesap' }) });
export const loyaltyGuestParamSchema = z.object({ guestId: z.string().uuid({ message: 'Geçersiz misafir' }) });
export const loyaltyReservationParamSchema = z.object({ reservationId: z.string().uuid({ message: 'Geçersiz rezervasyon' }) });
export const loyaltyTransactionListQuerySchema = paginationQuerySchema;

export const loyaltyEnrollSchema = z.object({ consent: z.literal(true, { error: 'Misafirin açık rızası işaretlenmeli' }) });

export const loyaltyAdjustSchema = z.object({
  points: z.coerce
    .number({ error: 'Puan sayı olmalı' })
    .int('Puan tamsayı olmalı')
    .min(-MAX_LOYALTY_POINTS)
    .max(MAX_LOYALTY_POINTS)
    .refine((value) => value !== 0, 'Puan sıfır olamaz'),
  reason: z.string().trim().min(3, 'Gerekçe yazın').max(300),
});

/** Puan kullan: konaklamanın açık folyosuna indirim (gelir türü seçilir). */
export const loyaltyRedeemSchema = z.object({
  requestId: z.string().uuid({ message: 'Geçersiz istek' }),
  points: z.coerce.number({ error: 'Puan sayı olmalı' }).int('Puan tamsayı olmalı').min(1, 'En az 1 puan').max(MAX_LOYALTY_POINTS),
  category: z.enum(['ROOM', 'FNB', 'MINIBAR', 'LAUNDRY', 'SPA', 'OTHER'], { error: 'Gelir türü seçin' }).default('ROOM'),
  folioId: z.string().uuid().optional(),
});
