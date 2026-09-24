import { BaseWorker, defineActor } from '@hotelos/actor-kit';
import { WhatsAppSendError, sendText } from './client.js';
import { windowOpen } from './protocol.js';

/**
 * WhatsApp kanal aktörü (giden taraf).
 *
 * Personel ya da AI misafire yazınca `guest.message.reply` yayınlanır; bu
 * aktör WhatsApp konuşmasına ait olanları Cloud API ile gönderir ve sonucu
 * mesaja yazar. Gelen mesajlar ve teslim bildirimleri webhook'tan gelir
 * (backend route'u; imza doğrulaması protocol.js'te).
 *
 * Çift gönderim yok: mesaj göndermeden önce **sahiplenilir** (`claimOutgoing`);
 * aynı mesaj hem olayla hem "bekleyenleri gönder" işiyle gelse de bir kez gider.
 */

export const whatsappGatewayManifest = defineActor({
  name: 'whatsapp-gateway',
  title: 'WhatsApp geçidi',
  packageName: '@hotelos/whatsapp-gateway',
  type: 'worker',
  description:
    'Misafire yazılan cevapları WhatsApp Cloud API ile gönderir, teslim durumunu mesaja işler. ' +
    '24 saat penceresi kapalıysa göndermez, sebebini yazar. Kapalıyken mesajlar "gönderim bekliyor" kalır.',
  subscribes: ['guest.message.reply'],
  publishes: ['guest.message.delivery'],
  retry: { attempts: 3, backoffMs: 2000 },
  fallbackModule: 'Misafir mesajları',
  // Dış API çağrısı personelin "gönder" isteğini bekletmesin. Sıra taşarsa
  // mesaj "gönderim bekliyor" kalır; bekleyenleri gönderen iş onu alır.
  background: { maxConcurrent: 8, maxQueued: 2000, onOverflow: 'skip' },
});

/**
 * @typedef {{
 *   claimOutgoing: (hotelId: string, messageId: string) => Promise<null | {
 *     messageId: string, text: string, to: string, lastInboundAt: Date | string | null,
 *     credentials: null | { phoneNumberId: string, accessToken: string, graphVersion?: string },
 *   }>,
 *   release: (hotelId: string, messageId: string) => Promise<void>,
 *   markDelivery: (hotelId: string, messageId: string, report: { delivery: string, externalMessageId?: string, failureReason?: string }) => Promise<void>,
 *   recordFailure: (hotelId: string, error: string) => Promise<void>,
 * }} WhatsAppService
 */

/**
 * Tek mesajı gönderir (olay işleyicisi ve bekleyenleri gönderme işi ortak kullanır).
 *
 * @param {WhatsAppService} service
 * @param {{ fetchImpl?: typeof fetch, now?: () => number }} options
 * @param {string} hotelId
 * @param {string} messageId
 * @returns {Promise<{ status: 'SENT' | 'FAILED' | 'SKIPPED' | 'WAITING', detail?: string }>}
 */
export async function deliverWhatsAppMessage(service, options, hotelId, messageId) {
  const outgoing = await service.claimOutgoing(hotelId, messageId);
  if (!outgoing) return { status: 'SKIPPED', detail: 'Mesaj gönderilmiş ya da başka bir iş gönderiyor' };
  if (!outgoing.credentials) {
    // Kanal kapalı ya da ayarı eksik: mesaj bekler, kanal açılınca gider.
    await service.release(hotelId, messageId);
    return { status: 'WAITING', detail: 'WhatsApp bağlantısı kapalı; mesaj bekliyor' };
  }
  const now = (options.now ?? Date.now)();
  if (!windowOpen(outgoing.lastInboundAt, now)) {
    const reason = 'WhatsApp 24 saat penceresi kapalı: misafir son 24 saatte yazmadı; yalnızca onaylı şablonla yazılabilir';
    await service.markDelivery(hotelId, messageId, { delivery: 'FAILED', failureReason: reason });
    return { status: 'FAILED', detail: reason };
  }

  try {
    const { externalMessageId } = await sendText({
      ...outgoing.credentials,
      to: outgoing.to,
      text: outgoing.text,
      fetchImpl: options.fetchImpl,
    });
    await service.markDelivery(hotelId, messageId, { delivery: 'SENT', externalMessageId });
    return { status: 'SENT' };
  } catch (error) {
    if (!(error instanceof WhatsAppSendError)) throw error;
    if (error.retryable) {
      // Sahiplik bırakılır: tekrar denemede (ya da bekleyenler işinde) yeniden gönderilir.
      await service.release(hotelId, messageId);
      throw error;
    }
    await service.markDelivery(hotelId, messageId, { delivery: 'FAILED', failureReason: error.message });
    if (error.code === 'AUTH') await service.recordFailure(hotelId, error.message);
    return { status: 'FAILED', detail: error.message };
  }
}

class WhatsAppGateway extends BaseWorker {
  /**
   * @param {WhatsAppService} service
   * @param {object} deps `BaseWorker` bağımlılıkları; isteğe bağlı `fetchImpl`, `now`
   */
  constructor(service, deps) {
    super(
      whatsappGatewayManifest,
      {
        'guest.message.reply': async (payload) => {
          const outcome = await deliverWhatsAppMessage(service, { fetchImpl: deps.fetchImpl, now: deps.now }, payload.hotelId, payload.messageId);
          return { message: `WhatsApp: ${outcome.status}${outcome.detail ? ` — ${outcome.detail}` : ''}`, meta: { status: outcome.status } };
        },
      },
      deps,
    );
  }

  accepts(_eventName, payload) {
    return payload.channel === 'WHATSAPP';
  }

  describeFallback(eventName) {
    if (eventName === 'guest.message.reply') return 'WhatsApp mesajı gönderilemedi; misafire başka yoldan ulaşın';
    return super.describeFallback(eventName);
  }
}

/**
 * @param {WhatsAppService} service
 * @param {object} deps
 */
export function createWhatsAppGateway(service, deps) {
  return new WhatsAppGateway(service, deps);
}

export { DEFAULT_GRAPH_VERSION, WhatsAppSendError, sendText } from './client.js';
export * from './protocol.js';
