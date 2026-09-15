import { INVENTORY_CHANGED_EVENTS } from '@hotelos/core';
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

/** Panelin dinlediği tek kanal adı. */
export const INVENTORY_CHANNEL = 'inventory.changed';

/**
 * Yayınlanan event'ler: envanteri/odayı etkileyen her şey + oda durumu.
 * Katalogdaki `INVENTORY_CHANGED_EVENTS` zaten "canlı ekranlar bunları dinler"
 * diye tanımlı; oda durumu (kirli/temiz, boş/dolu) ona ek.
 */
const BROADCAST_EVENTS = Object.freeze([...new Set([...INVENTORY_CHANGED_EVENTS, 'room.status.changed'])]);

/** @param {string} hotelId */
export const hotelRoom = (hotelId) => `hotel:${hotelId}`;

/** @type {(() => void) | null} */
let unsubscribe = null;

/**
 * Köprüyü kurar. İdempotent: ikinci çağrıda önceki abonelik kapatılır, yoksa
 * her yeniden kurulumda aynı olay iki kez yayınlanır.
 *
 * @param {{ to: (room: string) => { emit: Function } }} io socket.io sunucusu
 * @param {{ warn?: Function }} [logger]
 * @returns {() => void} aboneliği kapatır
 */
export function registerRealtimeBridge(io, logger = console) {
  unsubscribe?.();

  unsubscribe = eventBus.subscribeMany(BROADCAST_EVENTS, 'socket-bridge', (payload, envelope) => {
    const hotelId = payload?.hotelId;
    if (!hotelId) {
      logger.warn?.({ event: envelope?.name }, 'hotelId taşımayan event yayınlanmadı');
      return;
    }

    io.to(hotelRoom(hotelId)).emit(INVENTORY_CHANNEL, {
      event: envelope?.name ?? null,
      roomId: payload.roomId ?? null,
      reservationId: payload.reservationId ?? null,
      // Ekran "kim yaptı" bilgisini kendi yaptığı değişikliği ayırmak için
      // kullanabilir (kendi tıklamasında ikinci bir tazeleme gereksiz).
      actor: envelope?.actor ?? null,
      at: envelope?.occurredAt ?? new Date().toISOString(),
    });
  });

  return unsubscribe;
}

/** Testler ve kapanış için: köprüyü söker. */
export function stopRealtimeBridge() {
  unsubscribe?.();
  unsubscribe = null;
}
