import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { currentActor, getContext } from '@hotelos/core';
import {
  MAX_GUEST_ACTIVE_ORDERS,
  MAX_MENU_CATEGORIES,
  MAX_MENU_ITEMS,
  MAX_POS_OUTLETS,
  ROOM_SERVICE_GUEST_PATH,
  ROOM_SERVICE_KITCHEN_STATUSES,
  roomServiceSchedule,
} from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, rethrowPrismaError } from '../../lib/errors.js';
import { resolveJwtSecret } from '../../lib/http-security.js';
import { lockReservations, lockRoomServiceLinks, lockRoomServiceOrders } from '../../lib/locks.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { getHotelSettings } from '../settings/service.js';
import { inHouseStay, nextOrderNumber, parseDeliverAt, quoteLines, roomServiceOutlet } from './room-service.js';
import { hotelContext, iso, loadPosSettings, money, prisma } from './shared.js';

/**
 * Misafirin QR ile oda servisi siparişi (modül 41; misafir sayfası modül 53).
 *
 * ### Bağlantı
 *
 * Bağlantı konaklamaya ve odaya bağlıdır: `/misafir/oda-servisi/<kimlik>.<imza>`. İmza sunucunun JWT sırrından
 * türetilen anahtarla bağlantı kimliği + rastgele değerin HMAC'idir — veritabanı okunsa da bağlantı üretilemez.
 * Personel bağlantıyı girişte verir (oda kartı / QR çıktısı); yenilemek eskisini öldürür (konaklamada tek geçerli
 * bağlantı). **Oda değişince ya da çıkışta bağlantı kendiliğinden geçersizdir** (konaklamanın şu anki odası
 * bağlantının odası değilse misafir sipariş veremez).
 *
 * ### Misafir uçları
 *
 * Oturumsuzdur; IP başına hız sınırı route'tadır. Sipariş politikada açıksa verilir, **kabul bekler** (personel
 * panoda kabul / ret), konaklamada aynı anda en fazla `MAX_GUEST_ACTIVE_ORDERS` açık misafir siparişi olur (bağlantı
 * ele geçse de mutfak boğulmaz). Misafir kabulden önce kendi siparişini iptal edebilir. Misafirin gördüğü: oda,
 * adı (soyadı değil), menü (satış noktası kısıtıyla, fiyatlar), açık / son siparişleri.
 * Kimlik doğrulama hatasında ne olduğu söylenmez (bulunamadı).
 */

/** Misafire gösterilen son siparişler (son 24 saat; en fazla). */
const GUEST_RECENT_ORDERS = 10;
const GUEST_RECENT_HOURS = 24;
/** Bağlantının "son kullanım" damgası en fazla bu sıklıkla yazılır. */
const TOUCH_INTERVAL_MS = 5 * 60_000;
/** Bağlantının rastgele değeri (bayt). */
const NONCE_BYTES = 24;

let signingKey = null;
/** İmza anahtarı (JWT sırrından türetilir; JWT sırrı değişirse bütün bağlantılar yenilenir). */
function linkKey() {
  signingKey ??= createHmac('sha256', resolveJwtSecret({ warn: () => {} })).update('hotelos:room-service-link:v1').digest();
  return signingKey;
}

/** @param {string} linkId @param {string} nonce */
const signature = (linkId, nonce) => createHmac('sha256', linkKey()).update(`${linkId}.${nonce}`).digest('base64url');

/** @param {{ id: string, nonce: string }} link */
export const linkToken = (link) => `${link.id}.${signature(link.id, link.nonce)}`;

/* ══════════════════ Personel: bağlantı ══════════════════ */

/**
 * Konaklamanın geçerli bağlantısı (yoksa boş) ve misafir siparişinin açık olup olmadığı.
 * @param {string} hotelId @param {string} reservationId
 */
export async function getLink(hotelId, reservationId) {
  const [stay, link, settings] = await Promise.all([
    prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { id: true, status: true, roomId: true, room: { select: { number: true } } } }),
    prisma.roomServiceLink.findFirst({ where: { hotelId, reservationId, revokedAt: null }, select: { id: true, nonce: true, roomId: true, createdAt: true, createdBy: true, lastUsedAt: true } }),
    loadPosSettings(prisma, hotelId),
  ]);
  if (!stay) throw new NotFoundError('Konaklama bulunamadı');
  return {
    guestOrderingEnabled: settings.guestOrderingEnabled,
    roomNumber: stay.room?.number ?? null,
    stayActive: stay.status === 'CHECKED_IN' && Boolean(stay.roomId),
    link: link ? linkDto(link, stay) : null,
  };
}

/** @param {any} link @param {{ status: string, roomId: string | null }} stay */
function linkDto(link, stay) {
  const token = linkToken(link);
  const invalid = stay.status !== 'CHECKED_IN' ? 'Konaklama sona erdi' : stay.roomId !== link.roomId ? 'Misafir oda değiştirdi; bağlantıyı yenileyin' : null;
  return { token, path: `${ROOM_SERVICE_GUEST_PATH}/${token}`, createdAt: iso(link.createdAt), createdBy: link.createdBy, lastUsedAt: iso(link.lastUsedAt), valid: !invalid, invalidReason: invalid };
}

/**
 * Bağlantı verir / yeniler: içerideki konaklama için; varsa eskisi iptal edilir (eski QR artık çalışmaz).
 * @param {string} hotelId @param {string} reservationId
 */
export async function issueLink(hotelId, reservationId) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx) => {
      await lockReservations(tx, hotelId, [reservationId]);
      const stay = await inHouseStay(tx, hotelId, reservationId);
      const revoked = await tx.roomServiceLink.updateMany({ where: { hotelId, reservationId, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: actor } });
      const link = await tx.roomServiceLink.create({
        data: { hotelId, reservationId, roomId: stay.roomId, nonce: randomBytes(NONCE_BYTES).toString('base64url'), createdBy: actor },
        select: { id: true },
      });
      await recordAudit(tx, { hotelId, entity: 'RoomServiceLink', entityId: link.id, action: 'CREATE', after: { reservation: stay.confirmationCode, room: stay.roomNumber, replaced: revoked.count } });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bağlantı az önce yenilendi; ekranı yenileyin.' });
  }
  return getLink(hotelId, reservationId);
}

/** Bağlantıyı iptal eder (QR kaybedildi, misafir istemiyor). @param {string} hotelId @param {string} reservationId */
export async function revokeLink(hotelId, reservationId) {
  const actor = currentActor();
  await writeWithEvents(async (tx) => {
    await lockReservations(tx, hotelId, [reservationId]);
    const links = await tx.roomServiceLink.findMany({ where: { hotelId, reservationId, revokedAt: null }, select: { id: true } });
    if (!links.length) throw new NotFoundError('Geçerli bağlantı yok');
    await tx.roomServiceLink.updateMany({ where: { id: { in: links.map((link) => link.id) } }, data: { revokedAt: new Date(), revokedBy: actor } });
    for (const link of links) await recordAudit(tx, { hotelId, entity: 'RoomServiceLink', entityId: link.id, action: 'UPDATE', after: { revoked: true, by: actor } });
  });
  return getLink(hotelId, reservationId);
}

/* ══════════════════ Misafir: bağlantının çözülmesi ══════════════════ */

const LINK_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  reservationId: true,
  roomId: true,
  nonce: true,
  revokedAt: true,
  lastUsedAt: true,
  reservation: { select: { status: true, roomId: true, room: { select: { number: true } }, guest: { select: { firstName: true } } } },
});

/**
 * Belirteci doğrular: imza (sabit zamanlı karşılaştırma), bağlantı iptal edilmemiş, konaklama içeride ve hâlâ aynı
 * odada. İşlem kaydına misafir ("misafir · oda 412") yazılır — başlıktaki kimliğe güvenilmez.
 *
 * @param {any} client @param {string} token biçimi şemada denetlendi
 */
async function resolveLink(client, token) {
  const [linkId, given] = token.split('.');
  const link = await client.roomServiceLink.findFirst({ where: { id: linkId }, select: LINK_SELECT });
  const expected = link ? Buffer.from(signature(link.id, link.nonce)) : null;
  if (!link || !expected || expected.length !== Buffer.byteLength(given) || !timingSafeEqual(expected, Buffer.from(given))) throw new NotFoundError('Bağlantı bulunamadı');
  if (link.revokedAt) throw new ConflictError('Bu bağlantı artık geçerli değil; resepsiyondan yenisini isteyin.', 'LINK_EXPIRED');
  if (link.reservation.status !== 'CHECKED_IN') throw new ConflictError('Konaklamanız sona erdi; oda servisi siparişi verilemez.', 'LINK_EXPIRED');
  if (link.reservation.roomId !== link.roomId) throw new ConflictError('Odanız değişti; resepsiyondan yeni odanızın bağlantısını isteyin.', 'LINK_EXPIRED');
  const context = getContext();
  if (context) context.actor = `misafir · oda ${link.reservation.room.number}`;
  return link;
}

/** Son kullanım damgası (seyrek yazılır). @param {any} link */
async function touch(link) {
  if (link.lastUsedAt && Date.now() - link.lastUsedAt.getTime() < TOUCH_INTERVAL_MS) return;
  await prisma.roomServiceLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
}

/** Misafirin konaklamasının son siparişleri. @param {string} hotelId @param {string} reservationId */
async function guestOrders(hotelId, reservationId) {
  const rows = await prisma.roomServiceOrder.findMany({
    where: { hotelId, reservationId, createdAt: { gte: new Date(Date.now() - GUEST_RECENT_HOURS * 3_600_000) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: GUEST_RECENT_ORDERS,
    select: { id: true, number: true, status: true, source: true, deliverAt: true, dueAt: true, items: true, itemsTotal: true, rejectReason: true, createdAt: true, deliveredAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    byGuest: row.source === 'GUEST',
    deliverAt: iso(row.deliverAt),
    dueAt: iso(row.dueAt),
    // Misafire yalnızca ad, adet, not ve fiyat (istasyon / vergi iç bilgisi gitmez).
    items: (Array.isArray(row.items) ? row.items : []).map((item) => ({ name: item.name, quantity: item.quantity, note: item.note ?? null, unitPrice: item.unitPrice })),
    itemsTotal: money(row.itemsTotal),
    rejectReason: row.rejectReason,
    createdAt: iso(row.createdAt),
    deliveredAt: iso(row.deliveredAt),
  }));
}

/* ══════════════════ Misafir uçları ══════════════════ */

/**
 * Misafir sayfasının verisi: otel, oda, misafirin adı, sipariş açık mı, tepsi ücreti, teslim hedefi, oda servisi
 * menüsü (aktif, tükenmişler işaretli, satış noktası kısıtıyla) ve son siparişler.
 * @param {string} token
 */
export async function publicMenu(token) {
  const link = await resolveLink(prisma, token);
  const hotelId = link.hotelId;
  const [hotel, settings, outlets, categories, items, orders] = await Promise.all([
    getHotelSettings(hotelId),
    loadPosSettings(prisma, hotelId),
    prisma.posOutlet.findMany({ where: { hotelId, kind: 'ROOM_SERVICE', isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: MAX_POS_OUTLETS, select: { id: true, name: true } }),
    prisma.menuCategory.findMany({ where: { hotelId, isActive: true, system: false }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: MAX_MENU_CATEGORIES, select: { id: true, name: true, outletIds: true } }),
    prisma.menuItem.findMany({
      where: { hotelId, isActive: true, system: null, category: { isActive: true } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      take: MAX_MENU_ITEMS,
      select: { id: true, categoryId: true, name: true, description: true, price: true, soldOut: true },
    }),
    guestOrders(hotelId, link.reservationId),
  ]);
  await touch(link);
  return {
    hotelName: hotel.name,
    currency: hotel.currency,
    timezone: hotel.timezone,
    roomNumber: link.reservation.room.number,
    guestFirstName: link.reservation.guest?.firstName ?? null,
    orderingEnabled: settings.guestOrderingEnabled && outlets.length > 0,
    trayCharge: settings.trayCharge,
    deliveryTargetMinutes: settings.deliveryTargetMinutes,
    maxActiveOrders: MAX_GUEST_ACTIVE_ORDERS,
    outlets: outlets.map((outlet) => {
      const sold = categories.filter((category) => !category.outletIds.length || category.outletIds.includes(outlet.id));
      return {
        id: outlet.id,
        name: outlet.name,
        categories: sold
          .map((category) => ({
            id: category.id,
            name: category.name,
            items: items.filter((item) => item.categoryId === category.id).map((item) => ({ id: item.id, name: item.name, description: item.description, price: money(item.price), soldOut: item.soldOut })),
          }))
          .filter((category) => category.items.length),
      };
    }),
    orders,
  };
}

/** Misafirin siparişlerinin durumu (sayfanın sık tazelemesi; menü gelmez). @param {string} token */
export async function publicOrders(token) {
  const link = await resolveLink(prisma, token);
  return { orders: await guestOrders(link.hotelId, link.reservationId) };
}

/**
 * Misafirin siparişi: politika açık, bağlantı geçerli (kilitli), açık misafir siparişi sınırın altında; ürünler
 * denetlenir, kabul bekler (personel panoda). İstek kimliği bağlantıya göre tekildir (tekrar gönderim aynı sipariş).
 * Personelin ziline "yeni misafir siparişi" düşer.
 *
 * @param {string} token @param {any} input `publicRoomServiceOrderSchema`
 */
export async function publicCreateOrder(token, input) {
  const seed = await resolveLink(prisma, token);
  const hotelId = seed.hotelId;
  const { timezone, today } = await hotelContext(hotelId);
  const sourceKey = `guest:${seed.id}:${input.requestId}`;
  let created = null;
  try {
    created = await writeWithEvents(async (tx, stage) => {
      const existing = await tx.roomServiceOrder.findFirst({ where: { hotelId, sourceKey }, select: { id: true } });
      if (existing) return existing;
      await lockRoomServiceLinks(tx, hotelId, [seed.id]);
      const link = await resolveLink(tx, token);
      const settings = await loadPosSettings(tx, hotelId);
      if (!settings.guestOrderingEnabled) throw new ConflictError('Oda servisi siparişi şu an bu sayfadan alınmıyor; lütfen telefonla arayın.', 'GUEST_ORDERING_CLOSED');
      const active = await tx.roomServiceOrder.count({ where: { hotelId, reservationId: link.reservationId, source: 'GUEST', status: { in: ['REQUESTED', 'SCHEDULED', ...ROOM_SERVICE_KITCHEN_STATUSES] } } });
      if (active >= MAX_GUEST_ACTIVE_ORDERS) throw new ConflictError(`Aynı anda en fazla ${MAX_GUEST_ACTIVE_ORDERS} açık siparişiniz olabilir; teslim edilenler düştükçe yenisini verebilirsiniz.`, 'GUEST_ORDER_LIMIT');
      const outlet = await roomServiceOutlet(tx, hotelId, input.outletId);
      const stay = await inHouseStay(tx, hotelId, link.reservationId);
      const now = new Date();
      const deliverAt = parseDeliverAt(input.deliverAt, { timezone, now, checkOut: stay.checkOut });
      const quote = await quoteLines(tx, hotelId, outlet.id, input.lines);
      const plan = roomServiceSchedule({ now, deliverAt, prepLeadMinutes: settings.prepLeadMinutes, deliveryTargetMinutes: settings.deliveryTargetMinutes });
      const number = await nextOrderNumber(tx, hotelId, Number(today.slice(0, 4)));
      const id = randomUUID();
      await tx.roomServiceOrder.create({
        data: {
          id,
          hotelId,
          outletId: outlet.id,
          number,
          reservationId: stay.id,
          roomId: stay.roomId,
          roomNumber: stay.roomNumber,
          guestName: stay.guestName,
          source: 'GUEST',
          linkId: link.id,
          status: 'REQUESTED',
          covers: input.covers,
          note: input.note ?? null,
          deliverAt,
          dueAt: plan.dueAt,
          items: quote.items,
          itemsTotal: quote.itemsTotal,
          sourceKey,
          createdBy: currentActor(),
        },
      });
      await recordAudit(tx, { hotelId, entity: 'RoomServiceOrder', entityId: id, action: 'CREATE', after: { number, room: stay.roomNumber, source: 'GUEST', deliverAt: deliverAt?.toISOString() ?? null, items: quote.items.map((item) => `${item.quantity} × ${item.name}`) } });
      await stage('pos.room_service.changed', { hotelId, orderId: id, outletId: outlet.id, reservationId: stay.id, status: 'REQUESTED', change: 'CREATED' });
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'POS',
        severity: 'INFO',
        title: `Yeni misafir siparişi: oda ${stay.roomNumber} (${number})`,
        body: `${quote.items.length} kalem${deliverAt ? `, teslim ${input.deliverAt.replace('T', ' ')}` : ', hemen'}. Panoda kabul ya da ret bekliyor.`,
        link: '/pos/oda-servisi',
        permission: PERMISSIONS.POS_OPERATE,
        entityType: 'RoomServiceOrder',
        entityId: id,
        dedupeKey: 'room-service:guest-order',
      });
      return { id };
    });
  } catch (error) {
    // Aynı istek aynı anda iki kez geldi (çift dokunuş): kazananın siparişi.
    if (!(error?.code === 'P2002' && String(error.meta?.target ?? '').includes('sourceKey'))) rethrowPrismaError(error);
    created = await prisma.roomServiceOrder.findFirst({ where: { hotelId, sourceKey }, select: { id: true } });
  }
  await touch(seed);
  const orders = await guestOrders(hotelId, seed.reservationId);
  const winner = created ? orders.find((order) => order.id === created.id) : null;
  return { order: winner ?? null, orders };
}

/**
 * Misafir kendi siparişini kabulden önce iptal eder.
 * @param {string} token @param {string} orderId
 */
export async function publicCancelOrder(token, orderId) {
  const seed = await resolveLink(prisma, token);
  const hotelId = seed.hotelId;
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockRoomServiceOrders(tx, hotelId, [orderId])).has(orderId)) throw new NotFoundError('Sipariş bulunamadı');
    const order = await tx.roomServiceOrder.findFirst({ where: { id: orderId }, select: { id: true, outletId: true, reservationId: true, source: true, status: true, number: true } });
    if (order.reservationId !== seed.reservationId || order.source !== 'GUEST') throw new NotFoundError('Sipariş bulunamadı');
    if (order.status !== 'REQUESTED') throw new ConflictError('Sipariş kabul edildi; iptal için lütfen oda servisini arayın.', 'INVALID_TRANSITION');
    const actor = currentActor();
    await tx.roomServiceOrder.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: actor, cancelReason: 'Misafir iptal etti' } });
    await recordAudit(tx, { hotelId, entity: 'RoomServiceOrder', entityId: orderId, action: 'UPDATE', before: { status: 'REQUESTED' }, after: { status: 'CANCELLED', by: actor } });
    await stage('pos.room_service.changed', { hotelId, orderId, outletId: order.outletId, reservationId: order.reservationId, status: 'CANCELLED', change: 'CANCELLED' });
  });
  return { orders: await guestOrders(hotelId, seed.reservationId) };
}

