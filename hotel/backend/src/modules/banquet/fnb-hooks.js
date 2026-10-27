import { utcToZonedWallTime } from '@hotelos/hotel-contracts';
import { kitchenAlert } from './fnb-shared.js';

/**
 * Banket dosyasındaki değişikliklerin F&B'ye yansıması (modül 43). `events.js`'in işlemleri,
 * etkinlik kilidi altında ve kendi transaction'larında çağırır.
 *
 * | Olay                         | Ne olur |
 * |------------------------------|---------|
 * | Oturumun saati değişti       | Menülerin servis anı aynı farkla kayar, oturumun dışına taşan oturum sınırına çekilir; kesin menü kaydıysa mutfağa haber |
 * | Faturalanacak kişi değişti   | Etkinliğin kişisini izleyen kesin menüler varsa mutfağa haber (porsiyon / malzeme yeniden hesaplandı) |
 * | Kesin etkinlik iptal edildi  | Açık satın alma talebi varsa talep açabilenlere haber (45'te siparişe dönmeden iptal edilsin) |
 */

/**
 * Oturumun menüleri: kayan oturumla kayar.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, event: { id: string, code: string, name: string }, before: { startAt: Date }, after: { id: string, title: string, startAt: Date, endAt: Date }, timezone: string }} input
 */
export async function shiftSessionMenus(tx, stage, { hotelId, event, before, after, timezone }) {
  const menus = await tx.eventMenu.findMany({ where: { sessionId: after.id }, select: { id: true, name: true, serveAt: true, finalizedAt: true } });
  if (menus.length === 0) return;
  const delta = after.startAt.getTime() - before.startAt.getTime();
  const moved = [];
  for (const menu of menus) {
    const shifted = Math.min(Math.max(menu.serveAt.getTime() + delta, after.startAt.getTime()), after.endAt.getTime());
    if (shifted === menu.serveAt.getTime()) continue;
    await tx.eventMenu.update({ where: { id: menu.id }, data: { serveAt: new Date(shifted) } });
    if (menu.finalizedAt) moved.push(`${menu.name}: ${utcToZonedWallTime(menu.serveAt, timezone).replace('T', ' ')} → ${utcToZonedWallTime(new Date(shifted), timezone).replace('T', ' ')}`);
  }
  if (moved.length) {
    await kitchenAlert(tx, stage, {
      hotelId,
      event,
      title: `Kesin menünün servis saati değişti: ${event.code} ${event.name}`,
      body: `"${after.title}" oturumu kaydı. ${moved.join(' · ')}. Üretim planı yeni saatle.`,
      dedupeKey: `banquet-menu-time:${event.id}`,
    });
  }
}

/**
 * Faturalanacak kişi değişti: etkinliğin kişisini izleyen (sabit kişisi olmayan) kesin menüler.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, event: { id: string, code: string, name: string }, beforePax: number, afterPax: number }} input
 */
export async function alertPaxChange(tx, stage, { hotelId, event, beforePax, afterPax }) {
  if (beforePax === afterPax) return;
  const following = await tx.eventMenu.count({ where: { eventId: event.id, guests: null, finalizedAt: { not: null } } });
  if (following === 0) return;
  await kitchenAlert(tx, stage, {
    hotelId,
    event,
    title: `Kişi sayısı değişti: ${event.code} ${event.name} (${beforePax} → ${afterPax})`,
    body: `${following} kesin menü etkinliğin kişisini izliyor; porsiyon ve malzeme ihtiyacı yeniden hesaplandı. Satın alma eksiğini kontrol edin.`,
    dedupeKey: `banquet-menu-pax:${event.id}`,
  });
}

/**
 * İptal edilen etkinliğin açık satın alma talepleri.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, event: { id: string, code: string, name: string } }} input
 */
export async function alertCancelledRequests(tx, stage, { hotelId, event }) {
  const requests = await tx.purchaseRequest.findMany({
    where: { hotelId, status: { not: 'CANCELLED' }, lines: { some: { eventId: event.id } } },
    orderBy: { createdAt: 'asc' },
    take: 10,
    select: { number: true },
  });
  if (requests.length === 0) return;
  await kitchenAlert(tx, stage, {
    hotelId,
    event,
    title: `İptal edilen etkinliğin açık satın alma talebi var: ${event.code}`,
    body: `${event.name} iptal edildi. Açık talepler: ${requests.map((row) => row.number).join(', ')}. Gerekmiyorsa talebi iptal edin (başka etkinliğe yarayacak satırlar ayrıca talep edilir).`,
    dedupeKey: `banquet-menu-cancelled:${event.id}`,
  });
}
