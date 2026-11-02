import { ConflictError } from '../../lib/errors.js';

/**
 * Folyonun yeniden açılması (modül 15 / 17): yetkilinin "yeniden aç"ı, çıkışın / girişin / iptalin geri alınması.
 *
 * - Faturası kesilmiş (ya da iptali onay bekleyen) folyo açılmaz: fatura ile folyo ayrışırdı (açılan folyoya
 *   yazılan kalem faturada olmaz, geri alınan ücret faturada kalırdı). Önce fatura iptal edilir.
 * - Taslak silinir: folyo değişecek; yeniden kapanınca taslak yeniden açılır (folyo aktörü).
 *
 * Folyo kilidi altında, yeniden açan işlemin içinde çağrılır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<unknown>} stage
 * @param {{ hotelId: string, folioIds: string[] }} input
 */
export async function releaseFolioInvoices(tx, stage, { hotelId, folioIds }) {
  if (folioIds.length === 0) return;
  const invoices = await tx.invoice.findMany({ where: { hotelId, folioId: { in: folioIds }, status: { not: 'CANCELLED' } }, select: { id: true, status: true, number: true, folioId: true } });
  const issued = invoices.filter((invoice) => invoice.status !== 'DRAFT');
  if (issued.length) {
    throw new ConflictError(`Folyonun faturası kesilmiş (${issued.map((invoice) => invoice.number).join(', ')}): yeniden açmak için önce faturayı iptal edin`, 'FOLIO_INVOICED');
  }
  for (const draft of invoices) {
    await tx.invoice.delete({ where: { id: draft.id } });
    await stage('invoice.changed', { hotelId, invoiceId: draft.id, change: 'DELETED', folioId: draft.folioId, eventId: null });
  }
}
