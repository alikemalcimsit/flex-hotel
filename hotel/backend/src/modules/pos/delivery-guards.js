import { DELIVERY_ACTIVE_STATUSES, DELIVERY_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { ConflictError } from '../../lib/errors.js';
import { lockDeliveryOrders } from '../../lib/locks.js';

/**
 * Restoran adisyon uçlarının (modül 39) paket sipariş adisyonundaki sınırları (modül 42) — oda servisinin
 * (`room-service-guards.js`) karşılığı.
 *
 * Paket adisyonu siparişle bire birdir: bölünmez, birleştirilmez, masaya taşınmaz. Hesap teslimde kapanır: teslimden
 * önce adisyon ekranından ödeme alınmaz, odaya yazılmaz, adisyon kapatılmaz; ön ödeme siparişle birlikte alınır ve
 * adisyonu kapatmaz (sipariş mutfakta kalır). Tur eklenebilir (müşteri bir şey daha istedi): hazır sipariş mutfağa
 * döner, yoldaki ya da bitmiş siparişe kalem eklenmez.
 */

const ORDER_SELECT = Object.freeze({ id: true, number: true, status: true, outletId: true });

/** Adisyonun paket siparişi (yoksa boş). @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} checkId */
export function deliveryOfCheck(tx, checkId) {
  return tx.deliveryOrder.findFirst({ where: { checkId }, select: ORDER_SELECT });
}

/**
 * Bölme, birleştirme, taşıma: paket adisyonunda yok.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string[]} checkIds @param {string} action
 */
export async function assertNotDelivery(tx, checkIds, action) {
  const order = await tx.deliveryOrder.findFirst({ where: { checkId: { in: checkIds } }, select: { number: true } });
  if (order) throw new ConflictError(`Paket sipariş adisyonu ${action}; sipariş ${order.number} paket servis ekranından yönetilir.`, 'DELIVERY_CHECK');
}

/**
 * Ödeme, odaya yazma, kapatma (adisyon ekranından): paket adisyonunda yalnızca teslimden sonra.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} checkId
 */
export async function assertDeliverySettlable(tx, checkId) {
  const order = await deliveryOfCheck(tx, checkId);
  if (order && order.status !== 'DELIVERED') {
    throw new ConflictError(`Paket sipariş ${order.number} henüz teslim edilmedi; hesap teslimde kapanır (kapı ödemesi paket ekranından).`, 'DELIVERY_NOT_DELIVERED');
  }
}

/**
 * Bakiye sıfırlansa da adisyon kapanmasın mı: paket siparişi hâlâ açık (önceden tamamı ödenmiş sipariş mutfakta
 * ve yolda kalır; teslimde kapanır). Adisyon kilitliyken çağrılır.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} checkId
 */
export async function deliveryHoldsCheck(tx, checkId) {
  const order = await deliveryOfCheck(tx, checkId);
  return Boolean(order && DELIVERY_ACTIVE_STATUSES.includes(order.status));
}

/**
 * Adisyona tur eklenirken (adisyon kilitliyken) paket siparişi: yolda / bitmişse eklenmez; hazırsa mutfağa geri
 * döner. Kilit sırası adisyon → sipariş.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, checkId: string }} round
 */
export async function onDeliveryRound(tx, stage, { hotelId, checkId }) {
  const seed = await deliveryOfCheck(tx, checkId);
  if (!seed) return;
  await lockDeliveryOrders(tx, hotelId, [seed.id]);
  const order = await deliveryOfCheck(tx, checkId);
  if (!['RECEIVED', 'PREPARING', 'READY'].includes(order.status)) {
    throw new ConflictError(
      `Paket sipariş ${order.number} ${DELIVERY_STATUS_LABELS[order.status].toLocaleLowerCase('tr-TR')}; kalem eklenmez — ${order.status === 'ON_THE_WAY' ? 'geri alın (hazır) ya da ' : ''}yeni paket sipariş açın.`,
      'DELIVERY_LOCKED',
    );
  }
  if (order.status !== 'READY') return;
  await tx.deliveryOrder.update({ where: { id: order.id }, data: { status: 'RECEIVED', readyAt: null } });
  await stage('pos.delivery.changed', { hotelId, orderId: order.id, outletId: order.outletId, status: 'RECEIVED', change: 'UPDATED' });
}
