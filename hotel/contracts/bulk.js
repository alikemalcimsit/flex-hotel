import { z } from './locale.js';
import { expectedUpdatedAt, listQuerySchema } from './fields.js';

/**
 * Toplu işlemler: tek tek işlemin aynı servisini sırayla çağırır, her kayıt kendi kuralından geçer (kilit, durum,
 * sürüm, onay gerektiren durum). Biri başarısız olursa diğerleri durmaz; sonuç başarılı ve başarısızları sebebiyle
 * ayrı ayrı döner. Onay / gerekçe isteyen durumlar (açık bakiye, geç çıkış ücreti, erken ayrılış) toplu yapılmaz:
 * o kayıt atlanır, tek tek yapılır.
 */

/** Tek istekte en fazla kayıt (sırayla işlenir; uzun istekleri önler). */
export const MAX_BULK_ITEMS = 100;
export const MAX_BULK_CHECK_OUTS = 50;

const bulkItem = z.object({ id: z.string().uuid({ message: 'Geçersiz kayıt' }), expectedUpdatedAt });

/** Oda atama listesi: girişi bugün ya da sonra olanlar / girişi geçmiş ama gelmemiş olanlar. */
export const ASSIGNMENT_VIEWS = Object.freeze(['UPCOMING', 'LATE']);
export const ASSIGNMENT_VIEW_LABELS = Object.freeze({ UPCOMING: 'Oda bekleyenler', LATE: 'Gelişi geçmiş' });
export const pendingAssignmentsQuerySchema = listQuerySchema.extend({ view: z.enum(ASSIGNMENT_VIEWS).default('UPCOMING') });

export const autoAssignBatchSchema = z.object({
  reservationIds: z.array(z.string().uuid({ message: 'Geçersiz kayıt' })).min(1, 'Rezervasyon seçin').max(MAX_BULK_ITEMS, `Tek seferde en fazla ${MAX_BULK_ITEMS} rezervasyon`),
});

export const noShowBatchSchema = z.object({
  items: z.array(bulkItem).min(1, 'Rezervasyon seçin').max(MAX_BULK_ITEMS, `Tek seferde en fazla ${MAX_BULK_ITEMS} rezervasyon`),
  waiveFee: z.boolean().default(false),
});

export const checkOutBatchSchema = z.object({
  items: z.array(bulkItem).min(1, 'Konaklama seçin').max(MAX_BULK_CHECK_OUTS, `Tek seferde en fazla ${MAX_BULK_CHECK_OUTS} çıkış`),
});
