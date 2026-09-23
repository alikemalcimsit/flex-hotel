import {
  APPROVAL_EVENTS,
  LIVE_VIEW_EVENTS,
  MESSAGING_CHANGED_EVENTS,
  NOTIFICATIONS_CHANGED_EVENTS,
  REQUESTS_CHANGED_EVENTS,
  RESERVATIONS_CHANGED_EVENTS,
  STAFF_ALERT_EVENTS,
} from '@hotelos/core';
import { eventBus } from './events.js';

/**
 * Canlı yayın köprüsü: event bus → socket.io.
 *
 * Oda planı (modül 5) açık duran bir ekran: resepsiyonist saatlerce ona bakar.
 * Sorguyu saniyede bir yenilemek (polling) hem sunucuyu hem veritabanını
 * boşuna yorar; bunun yerine bir şey **gerçekten değiştiğinde** ilgili otelin
 * odasına tek satır düşer, panel de yalnızca o zaman tazeler.
 *
 * ### Neden yükün kendisi gönderilmiyor
 *
 * Yayınlanan mesaj "şu otelde şu değişti" bilgisidir; ekranın gösterdiği veri
 * değil. Socket üzerinden tam DTO göndermek üç sorun getirirdi: (1) yetkisi
 * olmayan bir istemciye veri sızabilir — socket'te henüz kimlik doğrulama yok,
 * (2) her ekran farklı pencere/filtre görüyor, gönderilen parça çoğu istemciye
 * uymaz, (3) iki kaynak (HTTP + socket) arasında tutarsızlık doğar. İstemci
 * haberi alır, kendi sorgusunu tazeler — tek doğruluk kaynağı HTTP kalır.
 *
 * ### Kime gider
 *
 * Kanal haberi yalnızca o kanala abone panellere (`channelRoom`), zil haberi
 * yalnızca muhatabına (`userRoom` / `permissionRoom`) gider. 2500 panelli
 * otelde her değişikliği herkese göndermek hem ağı hem tarayıcıları yorardı.
 *
 * ### Bağlantı kesilirse
 *
 * Panel tarafında socket kopukken ekran "canlı değil" rozetine döner ve
 * periyodik tazelemeye geçer; yeniden bağlanınca bir kez tam tazeleme yapar.
 * Yani canlı yayın bir hızlandırıcıdır, doğruluğun şartı değil.
 */

/** Oda planı ve oda listesi kanalı. */
export const INVENTORY_CHANNEL = 'inventory.changed';

/** Gelen kutusu kanalı. */
export const MESSAGING_CHANNEL = 'messaging.changed';

/** Misafir istekleri kanalı. */
export const REQUESTS_CHANNEL = 'requests.changed';

/** Bildirim geçmişi kanalı. */
export const NOTIFICATIONS_CHANNEL = 'notifications.changed';

/**
 * Zil kanalı. Haber, uyarının kime gittiğini (`userId` / `permission`)
 * taşır; panel yalnızca kendini ilgilendirene tepki verir.
 */
export const STAFF_ALERTS_CHANNEL = 'staff.alerts';

/** Onay kuyruğu kanalı (üst bar sayacı ve onay listesi). */
export const APPROVALS_CHANNEL = 'approvals.changed';

/** Rezervasyon listesi, detayı ve bekleme listesi kanalı. */
export const RESERVATIONS_CHANNEL = 'reservations.changed';

/**
 * Kanal → o kanala haber düşüren event'ler. Ekran yalnızca ilgilendiği kanalı
 * dinler; gelen kutusu açık olmayan panel envanter haberleriyle uğraşmaz.
 */
const CHANNEL_EVENTS = Object.freeze({
  [INVENTORY_CHANNEL]: LIVE_VIEW_EVENTS,
  [MESSAGING_CHANNEL]: MESSAGING_CHANGED_EVENTS,
  [REQUESTS_CHANNEL]: REQUESTS_CHANGED_EVENTS,
  [NOTIFICATIONS_CHANNEL]: NOTIFICATIONS_CHANGED_EVENTS,
  [STAFF_ALERTS_CHANNEL]: STAFF_ALERT_EVENTS,
  [APPROVALS_CHANNEL]: APPROVAL_EVENTS,
  [RESERVATIONS_CHANNEL]: RESERVATIONS_CHANGED_EVENTS,
});

/** @param {string} hotelId */
export const hotelRoom = (hotelId) => `hotel:${hotelId}`;

/**
 * Kanal odası: yalnızca o ekranı açık tutan paneller katılır.
 *
 * @param {string} hotelId
 * @param {string} channel
 */
export const channelRoom = (hotelId, channel) => `hotel:${hotelId}:ch:${channel}`;

/**
 * @param {string} hotelId
 * @param {string} userId
 */
export const userRoom = (hotelId, userId) => `hotel:${hotelId}:user:${userId}`;

/**
 * @param {string} hotelId
 * @param {string} permission
 */
export const permissionRoom = (hotelId, permission) => `hotel:${hotelId}:perm:${permission}`;

/** İstemcinin abone olabileceği kanallar (zil kimlikten gelir, abonelikle değil). */
export const SUBSCRIBABLE_CHANNELS = Object.freeze(
  Object.keys(CHANNEL_EVENTS).filter((channel) => channel !== STAFF_ALERTS_CHANNEL),
);

/**
 * Yayılma süresi. Aynı haber 2500 panele aynı milisaniyede düşer; hepsi
 * birlikte tazelerse sunucu o an boğulur. Sunucu odadaki panel sayısına göre
 * "tazelemeni bu süreye rastgele yay" der: kalabalık odada daha geniş pencere.
 */
const SPREAD_PER_SOCKET_MS = 2;
const MAX_SPREAD_MS = 8_000;

/**
 * @param {any} io
 * @param {string} room
 */
export function spreadFor(io, room) {
  const size = io.sockets?.adapter?.rooms?.get(room)?.size ?? 0;
  return Math.min(MAX_SPREAD_MS, size * SPREAD_PER_SOCKET_MS);
}

/**
 * Haberin gideceği oda. Zil uyarısı otelin tamamına değil, yalnızca
 * muhatabına (kişi ya da izin) gider.
 *
 * @param {string} channel
 * @param {string} hotelId
 * @param {{ userId?: string | null, permission?: string | null }} payload
 */
function targetRoom(channel, hotelId, payload) {
  if (channel !== STAFF_ALERTS_CHANNEL) return channelRoom(hotelId, channel);
  if (payload.userId) return userRoom(hotelId, payload.userId);
  if (payload.permission) return permissionRoom(hotelId, payload.permission);
  return null;
}

/** @type {Array<() => void>} */
let unsubscribers = [];

/**
 * Köprüyü kurar. İdempotent: ikinci çağrıda önceki abonelik kapatılır, yoksa
 * her yeniden kurulumda aynı olay iki kez yayınlanır.
 *
 * @param {{ to: (room: string) => { emit: Function } }} io socket.io sunucusu
 * @param {{ warn?: Function }} [logger]
 * @returns {() => void} aboneliği kapatır
 */
export function registerRealtimeBridge(io, logger = console) {
  stopRealtimeBridge();

  unsubscribers = Object.entries(CHANNEL_EVENTS).map(([channel, events]) =>
    eventBus.subscribeMany(events, `socket-bridge:${channel}`, (payload, envelope) => {
      const hotelId = payload?.hotelId;
      if (!hotelId) {
        logger.warn?.({ event: envelope?.name }, 'hotelId taşımayan event yayınlanmadı');
        return;
      }
      const room = targetRoom(channel, hotelId, payload);
      if (!room) {
        logger.warn?.({ event: envelope?.name }, 'Muhatabı olmayan uyarı yayınlanmadı');
        return;
      }

      io.to(room).emit(channel, {
        event: envelope?.name ?? null,
        // Yalnızca kimlikler: içerik (misafir adı, mesaj metni) socket'e çıkmaz.
        roomId: payload.roomId ?? null,
        reservationId: payload.reservationId ?? null,
        conversationId: payload.conversationId ?? null,
        requestId: payload.requestId ?? null,
        notificationId: payload.notificationId ?? null,
        approvalId: payload.approvalId ?? null,
        waitlistId: payload.waitlistId ?? null,
        // Zil: uyarı kimliği, türü ve kime gittiği (içerik yok).
        alertId: payload.alertId ?? null,
        kind: payload.kind ?? null,
        userId: payload.userId ?? null,
        permission: payload.permission ?? null,
        // Ekran "kim yaptı" bilgisini kendi yaptığı değişikliği ayırmak için
        // kullanabilir (kendi tıklamasında ikinci bir tazeleme gereksiz).
        actor: envelope?.actor ?? null,
        at: envelope?.occurredAt ?? new Date().toISOString(),
        spreadMs: spreadFor(io, room),
      });
    }),
  );

  return stopRealtimeBridge;
}

/** Testler ve kapanış için: köprüyü söker. */
export function stopRealtimeBridge() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
}

/** Tek istekte abone olunabilecek en fazla kanal. */
const MAX_SUBSCRIBE_CHANNELS = 10;

/**
 * @param {unknown} channels
 * @returns {string[]}
 */
function validChannels(channels) {
  const list = Array.isArray(channels) ? channels.slice(0, MAX_SUBSCRIBE_CHANNELS) : [channels];
  return [...new Set(list.filter((channel) => SUBSCRIBABLE_CHANNELS.includes(channel)))];
}

/**
 * Bağlanan istemcinin bağlamı ve abonelikleri.
 *
 * - Bağlantıda otel ve (el sıkışmadaki `auth.actor`'dan) personel çözülür;
 *   personel kendi kişi odasına ve rolünün izin odalarına katılır — zil
 *   yalnızca oraya düşer.
 * - Ekran açıldıkça `subscribe`, kapandıkça `unsubscribe`: kanal haberi
 *   yalnızca o ekranı açık tutan panele gider. Olay dinleyicileri bağlamı
 *   beklemeden kurulur; bağlantı anında gelen abonelik kaybolmaz.
 * - `ready` bağlamı ve otel odasının yayılma süresini taşır; yeniden
 *   bağlanan panel tam tazelemesini buna göre yayar.
 *
 * ⚠️ GEÇİCİ: kimlik, HTTP'deki `x-actor` gibi istemcinin söylediği e-posta.
 * Modül 2 gelince el sıkışmadaki JWT'den okunacak; odalar aynı kalacak.
 * Rol değişikliği yeniden bağlanınca geçerli olur.
 *
 * @param {any} io
 * @param {{
 *   resolveHotelId: () => Promise<string>,
 *   findStaff: (hotelId: string, email: string) => Promise<{ id: string, role: string } | null>,
 *   permissionsForRole: (role: string) => readonly string[],
 *   logger?: { error?: Function },
 * }} deps
 */
export function registerSocketHandlers(io, { resolveHotelId, findStaff, permissionsForRole, logger = console }) {
  /** @param {any} socket */
  async function joinContext(socket) {
    const hotelId = await resolveHotelId();
    const actor = socket.handshake?.auth?.actor;
    const staff = typeof actor === 'string' && actor.includes('@') ? await findStaff(hotelId, actor.toLowerCase()) : null;
    const rooms = [hotelRoom(hotelId)];
    if (staff) {
      rooms.push(userRoom(hotelId, staff.id));
      for (const permission of permissionsForRole(staff.role)) rooms.push(permissionRoom(hotelId, permission));
    }
    await socket.join(rooms);
    socket.emit('ready', { hotelId, userId: staff?.id ?? null, spreadMs: spreadFor(io, hotelRoom(hotelId)) });
    return { hotelId };
  }

  io.on('connection', (socket) => {
    const ready = joinContext(socket).catch((error) => {
      logger.error?.({ err: error }, 'Socket otel bağlamına katılamadı');
      // Katılamayan istemci sessizce "canlı" sanmasın: panel bunu görünce
      // periyodik tazelemeye düşer.
      socket.emit('ready', { hotelId: null, userId: null, spreadMs: 0 });
      return null;
    });

    socket.on('subscribe', async (channels, ack) => {
      const context = await ready;
      const list = context ? validChannels(channels) : [];
      if (list.length > 0) await socket.join(list.map((channel) => channelRoom(context.hotelId, channel)));
      if (typeof ack === 'function') ack({ ok: Boolean(context), channels: list });
    });

    socket.on('unsubscribe', async (channels) => {
      const context = await ready;
      if (!context) return;
      for (const channel of validChannels(channels)) await socket.leave(channelRoom(context.hotelId, channel));
    });
  });
}
