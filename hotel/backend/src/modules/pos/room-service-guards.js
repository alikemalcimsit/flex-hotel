import { toDecimal, toMoneyString } from '@hotelos/core';
import { ROOM_SERVICE_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { ConflictError } from '../../lib/errors.js';
import { lockRoomServiceOrders } from '../../lib/locks.js';

/**
 * Restoran adisyon uçlarının (modül 39) oda servisi adisyonundaki sınırları (modül 41).
 *
 * Oda servisi adisyonu siparişle bire birdir: bölünmez, birleştirilmez, masaya taşınmaz. Hesabı teslimde kapanır
 * ("teslim edilince folyoya yazılır"): teslimden önce adisyon ekranından ödeme alınmaz, odaya yazılmaz, adisyon
 * kapatılmaz. Teslimden sonra (onay bekleyen kapı ödemesi, şef garsonun yeniden açması) restoranın kuralları geçer.
 * Adisyona tur eklemek (misafir telefonla bir şey daha istedi) mümkündür; hazır sipariş mutfağa geri döner, yoldaki
 * ya da teslim edilmiş siparişe kalem eklenmez.
 */

const ORDER_SELECT = Object.freeze({ id: true, number: true, status: true, outletId: true, reservationId: true, roomNumber: true, deliverAt: true, items: true, itemsTotal: true });

/**
 * Adisyonun oda servisi siparişi (yoksa boş).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} checkId
 */
export function roomServiceOfCheck(tx, checkId) {
  return tx.roomServiceOrder.findFirst({ where: { checkId }, select: ORDER_SELECT });
}

/**
 * Bölme, birleştirme, taşıma: oda servisi adisyonunda yok.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string[]} checkIds @param {string} action
 */
export async function assertNotRoomService(tx, checkIds, action) {
  const order = await tx.roomServiceOrder.findFirst({ where: { checkId: { in: checkIds } }, select: { number: true } });
  if (order) throw new ConflictError(`Oda servisi adisyonu ${action}; sipariş ${order.number} oda servisi ekranından yönetilir.`, 'ROOM_SERVICE_CHECK');
}

/**
 * Ödeme, odaya yazma, kapatma: oda servisi adisyonunda yalnızca teslimden sonra (teslim hesabı kapatır).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} checkId
 */
export async function assertRoomServiceSettlable(tx, checkId) {
  const order = await roomServiceOfCheck(tx, checkId);
  if (order && order.status !== 'DELIVERED') {
    throw new ConflictError(`Oda servisi siparişi ${order.number} henüz teslim edilmedi; hesap teslimde kapanır (kapıda ödeme ya da odaya yaz).`, 'ROOM_SERVICE_NOT_DELIVERED');
  }
}

/**
 * Adisyona tur eklenirken (adisyon kilitliyken) oda servisi siparişi: yolda / teslim edilmişse eklenmez; hazırsa
 * mutfağa geri döner; siparişin kalem kopyası (hazırlık listesi, pano) yeni turla tamamlanır. Kilit sırası
 * adisyon → sipariş.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, checkId: string, items: Array<{ menuItemId: string, name: string, unitPrice: string, quantity: number, note: string | null, station: string, taxCategory: string }> }} round
 * @returns {Promise<{ roomNumber: string, deliverAt: string | null } | null>} oda servisi turuysa mutfak olayına giden bilgi
 */
export async function onRoomServiceRound(tx, stage, { hotelId, checkId, items }) {
  const seed = await roomServiceOfCheck(tx, checkId);
  if (!seed) return null;
  await lockRoomServiceOrders(tx, hotelId, [seed.id]);
  const order = await roomServiceOfCheck(tx, checkId);
  if (order.status === 'ON_THE_WAY' || order.status === 'DELIVERED' || order.status === 'CANCELLED') {
    throw new ConflictError(
      `Sipariş ${order.number} ${ROOM_SERVICE_STATUS_LABELS[order.status].toLocaleLowerCase('tr-TR')}; kalem eklenmez — ${order.status === 'ON_THE_WAY' ? 'geri alın (hazır) ya da ' : ''}yeni oda servisi siparişi açın.`,
      'ROOM_SERVICE_LOCKED',
    );
  }
  const added = items.reduce((sum, item) => sum.plus(toDecimal(item.unitPrice).times(item.quantity)), toDecimal(0));
  const back = order.status === 'READY';
  await tx.roomServiceOrder.update({
    where: { id: order.id },
    data: {
      items: [...(Array.isArray(order.items) ? order.items : []), ...items],
      itemsTotal: toMoneyString(toDecimal(String(order.itemsTotal)).plus(added)),
      ...(back ? { status: 'RECEIVED', readyAt: null } : {}),
    },
  });
  await stage('pos.room_service.changed', { hotelId, orderId: order.id, outletId: order.outletId, reservationId: order.reservationId, status: back ? 'RECEIVED' : order.status, change: 'UPDATED' });
  return { roomNumber: order.roomNumber, deliverAt: order.deliverAt ? order.deliverAt.toISOString() : null };
}
