import { LIVE_VIEW_EVENTS, MESSAGING_CHANGED_EVENTS, REQUESTS_CHANGED_EVENTS } from '@hotelos/core';
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

/**
 * Kanal → o kanala haber düşüren event'ler. Ekran yalnızca ilgilendiği kanalı
 * dinler; gelen kutusu açık olmayan panel envanter haberleriyle uğraşmaz.
 */
const CHANNEL_EVENTS = Object.freeze({
  [INVENTORY_CHANNEL]: LIVE_VIEW_EVENTS,
  [MESSAGING_CHANNEL]: MESSAGING_CHANGED_EVENTS,
  [REQUESTS_CHANNEL]: REQUESTS_CHANGED_EVENTS,
});

/** @param {string} hotelId */
export const hotelRoom = (hotelId) => `hotel:${hotelId}`;

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

      io.to(hotelRoom(hotelId)).emit(channel, {
        event: envelope?.name ?? null,
        // Yalnızca kimlikler: içerik (misafir adı, mesaj metni) socket'e çıkmaz.
        roomId: payload.roomId ?? null,
        reservationId: payload.reservationId ?? null,
        conversationId: payload.conversationId ?? null,
        requestId: payload.requestId ?? null,
        // Ekran "kim yaptı" bilgisini kendi yaptığı değişikliği ayırmak için
        // kullanabilir (kendi tıklamasında ikinci bir tazeleme gereksiz).
        actor: envelope?.actor ?? null,
        at: envelope?.occurredAt ?? new Date().toISOString(),
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
