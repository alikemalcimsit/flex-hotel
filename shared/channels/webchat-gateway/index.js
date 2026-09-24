import { BaseWorker, defineActor } from '@hotelos/actor-kit';

/**
 * Web chat kanal aktörü (giden taraf).
 *
 * Misafirin balondan yazdığı mesaj socket ile gelir (backend `/webchat`
 * ad alanı) ve `receiveInboundMessage` ile kaydedilir. Personel ya da AI
 * cevap yazınca `guest.message.reply` yayınlanır; bu aktör web chat
 * konuşmasına ait olanı misafirin oturumuna iletir ve "gönderildi" yazar.
 * Misafir çevrimdışıysa mesaj kaybolmaz: balon yeniden bağlanınca geçmişi
 * alır, gördüğü mesajları "okundu" bildirir.
 */

export const webchatGatewayManifest = defineActor({
  name: 'webchat-gateway',
  type: 'worker',
  description:
    'Misafire yazılan cevapları web sitesindeki sohbet balonuna iletir ve "gönderildi" olarak işaretler. ' +
    'Misafir çevrimdışıysa balon açılınca geçmişle birlikte alır.',
  subscribes: ['guest.message.reply'],
  publishes: ['guest.message.delivery'],
  retry: { attempts: 3, backoffMs: 500 },
  fallbackModule: 'Misafir mesajları',
  // Sıra taşarsa mesaj "gönderim bekliyor" kalır; balon yeniden bağlanınca
  // geçmişle alır, bekleyenleri gönderen iş de işaretler.
  background: { maxConcurrent: 16, maxQueued: 5000, onOverflow: 'skip' },
});

/**
 * @typedef {{
 *   claimOutgoing: (hotelId: string, messageId: string) => Promise<null | { messageId: string, to: string, message: object }>,
 *   release: (hotelId: string, messageId: string) => Promise<void>,
 *   markDelivery: (hotelId: string, messageId: string, report: { delivery: string }) => Promise<void>,
 * }} WebchatService
 * @typedef {{ deliver: (hotelId: string, sessionId: string, message: object) => Promise<number> }} WebchatTransport
 */

/**
 * Tek mesajı misafirin oturumuna iletir (olay işleyicisi ve bekleyenleri
 * gönderme işi ortak kullanır). Misafir çevrimdışıysa da "gönderildi" olur:
 * balon açılınca geçmişle alır.
 *
 * @param {WebchatService} service
 * @param {WebchatTransport} transport
 * @param {string} hotelId
 * @param {string} messageId
 * @returns {Promise<{ status: 'SENT' | 'SKIPPED', sockets?: number }>}
 */
export async function deliverWebchatMessage(service, transport, hotelId, messageId) {
  const outgoing = await service.claimOutgoing(hotelId, messageId);
  if (!outgoing) return { status: 'SKIPPED' };
  let sockets;
  try {
    sockets = await transport.deliver(hotelId, outgoing.to, outgoing.message);
  } catch (error) {
    await service.release(hotelId, messageId);
    throw error;
  }
  await service.markDelivery(hotelId, messageId, { delivery: 'SENT' });
  return { status: 'SENT', sockets };
}

class WebchatGateway extends BaseWorker {
  /**
   * @param {WebchatService} service
   * @param {WebchatTransport} transport
   * @param {object} deps
   */
  constructor(service, transport, deps) {
    super(
      webchatGatewayManifest,
      {
        'guest.message.reply': async (payload) => {
          const outcome = await deliverWebchatMessage(service, transport, payload.hotelId, payload.messageId);
          if (outcome.status === 'SKIPPED') return { message: 'Mesaj gönderilmiş ya da başka bir iş gönderiyor' };
          return {
            message: outcome.sockets > 0 ? 'Mesaj misafirin balonuna iletildi' : 'Misafir çevrimdışı; balon açılınca görecek',
            meta: { sockets: outcome.sockets },
          };
        },
      },
      deps,
    );
  }

  accepts(_eventName, payload) {
    return payload.channel === 'WEBCHAT';
  }

  describeFallback(eventName) {
    if (eventName === 'guest.message.reply') return 'Web chat mesajı iletilemedi; misafir sayfayı yenileyince görecek';
    return super.describeFallback(eventName);
  }
}

/**
 * @param {WebchatService} service
 * @param {WebchatTransport} transport
 * @param {object} deps
 */
export function createWebchatGateway(service, transport, deps) {
  return new WebchatGateway(service, transport, deps);
}

/** Balonun ve sunucunun paylaştığı olay adları. */
export const WEBCHAT_EVENTS = Object.freeze({
  /** Sunucu → balon: oturum (token), ayar, geçmiş, yeni mesaj, yazıyor. */
  SESSION: 'session',
  CONFIG: 'config',
  HISTORY: 'history',
  MESSAGE: 'message',
  TYPING: 'typing',
  ACK: 'ack',
  ERROR: 'chat-error',
  /** Balon → sunucu: mesaj gönder, gördüm. */
  SEND: 'send',
  SEEN: 'seen',
});

export { SESSION_TTL_MS, createSessionToken, verifySessionToken } from './session.js';
export { createRateLimiter } from './rate-limit.js';

/** Balon betiğinin dosya yolu (backend bunu `/webchat/widget.js` olarak sunar). */
export const WIDGET_PATH = new URL('./widget/widget.js', import.meta.url);
