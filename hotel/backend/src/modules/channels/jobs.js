import { deliverWebchatMessage } from '@hotelos/webchat-gateway';
import { deliverWhatsAppMessage } from '@hotelos/whatsapp-gateway';
import { isActorEnabled } from '../../lib/actors.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { pendingOutgoingMessages } from '../messaging/service.js';
import { whatsappGatewayService } from './whatsapp.js';
import { webchatGatewayService, webchatTransport } from './webchat.js';

/**
 * Mesaj kanallarının zamanlanmış işi (modül 8, yalnızca sunucu sürecinde).
 *
 * Cevap normalde yazıldığı anda gönderilir (`guest.message.reply` → geçit).
 * Bu iş geride kalanları toplar:
 * - kanal kapalıyken yazılmış ve kanal açılınca bekleyen cevaplar,
 * - geçici hatadan (Meta 5xx, hız sınırı) sonra yeniden denenecekler,
 * - geçidin sırası dolduğu için atlanmış olanlar,
 * - süreç gönderirken kapandıysa sahipliği süresi dolmuş olanlar.
 *
 * Mesaj önce sahiplenildiği için olay yolu ile bu iş aynı mesajı iki kez
 * göndermez. Geçit yönetim panelinden kapatıldıysa o otelin mesajı gönderilmez.
 */

const PENDING_INTERVAL_MS = 60_000;
/** Olay yolu önce denesin: bundan yeni mesaja dokunulmaz. */
const PENDING_MIN_AGE_MS = 60_000;
/** Tur başına kanal başına en fazla mesaj. */
const PENDING_BATCH = 200;

const GATEWAYS = Object.freeze({
  WHATSAPP: {
    actorName: 'whatsapp-gateway',
    send: (hotelId, messageId) => deliverWhatsAppMessage(whatsappGatewayService, {}, hotelId, messageId),
  },
  WEBCHAT: {
    actorName: 'webchat-gateway',
    send: (hotelId, messageId) => deliverWebchatMessage(webchatGatewayService, webchatTransport, hotelId, messageId),
  },
});

/**
 * Bir tur: her kanalın bekleyen mesajları sırayla (en eski önce).
 * @param {{ warn: Function }} logger
 * @returns {Promise<Record<string, Record<string, number>>>} kanal → sonuç → adet
 */
export async function sendPendingMessages(logger) {
  const summary = {};
  for (const [channel, gateway] of Object.entries(GATEWAYS)) {
    const counts = {};
    const rows = await pendingOutgoingMessages(channel, { olderThanMs: PENDING_MIN_AGE_MS, limit: PENDING_BATCH });
    // Aktör açık mı: otel başına bir kez (satır başına sorgu değil).
    const enabled = new Map();
    for (const row of rows) {
      if (!enabled.has(row.hotelId)) enabled.set(row.hotelId, await isActorEnabled(row.hotelId, gateway.actorName));
      if (!enabled.get(row.hotelId)) {
        counts.DISABLED = (counts.DISABLED ?? 0) + 1;
        continue;
      }
      try {
        const outcome = await gateway.send(row.hotelId, row.id);
        counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
      } catch (error) {
        // Geçici hata: sahiplik bırakıldı, sonraki turda yeniden denenir.
        counts.RETRY = (counts.RETRY ?? 0) + 1;
        logger.warn({ err: error, channel, messageId: row.id }, 'Bekleyen mesaj gönderilemedi; yeniden denenecek');
      }
    }
    summary[channel] = counts;
  }
  return summary;
}

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startChannelJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'pending-messages',
      intervalMs: PENDING_INTERVAL_MS,
      run: async () => {
        const summary = await sendPendingMessages(logger);
        if (Object.values(summary).some((counts) => Object.keys(counts).length > 0)) {
          logger.info({ summary }, 'Bekleyen mesajlar işlendi');
        }
      },
    },
  ]);
}
