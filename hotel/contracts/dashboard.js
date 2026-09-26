import { dateField } from './fields.js';
import { z } from './locale.js';

/**
 * Günlük durum ekranı sözleşmeleri (modül 13).
 *
 * Müdür sabah tek ekrana bakıp günü anlar: doluluk, gelecek / gidecek, oda
 * durumu, bu gecenin oda geliri ve ADR, bekleyen işler. Tanımlar oda planının
 * gün özetiyle aynıdır (iki ekranın sayısı ayrışmasın):
 *
 * - **Satılan oda:** o geceyi tüketen konaklama (bekleyen, onaylı, içeride;
 *   geçmiş gecelerde çıkış yapmış olanlar da).
 * - **Satılabilir oda:** toplam oda − arızalı. Hizmet dışı oda satışta
 *   sayılır, paydadan düşmez.
 * - **Doluluk %:** satılan / satılabilir.
 * - **ADR:** oda geliri / fiyatı olan satılan gece.
 */

/** Haftalık serinin gün sayısı. */
export const DASHBOARD_WEEK_DAYS = 7;

/** Haftalık seride iş gününden en fazla bu kadar geriye / ileriye gidilir. */
export const DASHBOARD_WEEK_MAX_OFFSET_DAYS = 366;

/** Günlük durumdaki açık arıza listesi (fazlası oda listesinde). */
export const DASHBOARD_FAULT_LIST_LIMIT = 10;

/** Doluluk eşikleri: ekranda renk (yüksek doluluk iyi, çok düşük dikkat). */
export const OCCUPANCY_LOW_PCT = 40;

/**
 * Haftalık seri: `from` verilmezse bugünden başlar. Pencere iş gününden en
 * fazla `DASHBOARD_WEEK_MAX_OFFSET_DAYS` uzakta olabilir (sunucu denetler;
 * iş günü otelin saat dilimine bağlı).
 */
export const dashboardWeekQuerySchema = z.object({
  from: dateField.optional(),
});
