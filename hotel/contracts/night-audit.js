import { decimalField, paginationQuerySchema } from './fields.js';
import { PAYMENT_METHODS } from './folios.js';
import { z } from './locale.js';

/**
 * Gün kapanış (night audit) sözleşmeleri (modül 18).
 *
 * Gün kapanışı bir sihirbazdır: gelmeyenler → oda ücretleri → kasa sayımı →
 * fark → kapat. Kapanış tek çağrıyla (`close`) işler: önizleme ekranları veriyi
 * yazmaz; "Kapat" düğmesi gelmeyenleri düşer, oda ücretlerini basar, günlük
 * özeti yazar, kasayı kaydeder ve iş gününü ilerletir.
 */

/** Kasa sayımında bir yöntem için sayılan tutar. Beklenen sistemden hesaplanır. */
export const shiftCountSchema = z.object({
  method: z.enum(PAYMENT_METHODS, { error: 'Ödeme yöntemi seçin' }),
  counted: decimalField({ scale: 2, min: 0, max: 100_000_000, label: 'Sayılan tutar' }),
});

/** Günü kapat: kasa sayımı (yöntem bazında), devir notu ve gelmeyen ücretinden vazgeçme. */
export const closeDaySchema = z.object({
  counts: z.array(shiftCountSchema).max(PAYMENT_METHODS.length).default([]),
  note: z.string().trim().max(2000).optional(),
  /** Gelmeyen misafirlerin ücretini uygulama (personelin tercihi). */
  waiveNoShowFees: z.boolean().default(false),
});

/** Kapanış geçmişi listesi (sayfalı). */
export const nightAuditHistoryQuerySchema = paginationQuerySchema;
