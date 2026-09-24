import { parseWebhook, verifySignature, verifySubscription } from '@hotelos/whatsapp-gateway';
import { AppError, NotFoundError } from '../../lib/errors.js';
import {
  claimOutgoingMessage,
  findMessageIdByExternalId,
  markMessageDelivery,
  receiveInboundMessage,
  releaseOutgoingMessage,
} from '../messaging/service.js';
import { recordChannelError, touchInbound, whatsappChannelById, whatsappCredentials } from './service.js';

/**
 * WhatsApp Cloud API (modül 8): webhook (gelen mesaj + teslim bildirimi) ve
 * giden mesaj geçidinin veritabanı tarafı.
 *
 * ### Webhook güvenliği
 *
 * Adres kanal kaydının kimliğini taşır (`/webhooks/whatsapp/:channelId`);
 * hangi otelin mesajı olduğu buradan bilinir. Her POST, Meta'nın uygulama
 * sırrıyla imzalanmış olmalı (`X-Hub-Signature-256`, ham gövde üzerinden).
 * İmzasız ya da yanlış imzalı istek hiçbir şey yazdırmaz. Gövdedeki telefon
 * numarası kimliği kanalınkiyle eşleşmeyen öğe atlanır: aynı Meta uygulamasına
 * bağlı başka bir numaranın mesajı bu otele yazılmaz.
 *
 * Meta cevap 200 değilse aynı bildirimi yeniden gönderir; mesajlar kanal
 * kimliğiyle tekilleştiği için tekrar zararsızdır.
 */

/** Tek bildirimde işlenen en fazla öğe (Meta paketleri küçük tutar; fazlası kötüye kullanım). */
const MAX_WEBHOOK_ITEMS = 200;

/**
 * Webhook doğrulaması (Meta'nın kurulumdaki GET isteği).
 * @param {string} channelId
 * @param {Record<string, unknown>} query
 * @returns {Promise<string>} geri dönülecek challenge
 */
export async function verifyWhatsAppWebhook(channelId, query) {
  const channel = await whatsappChannelById(channelId);
  if (!channel?.verifyToken) throw new NotFoundError('Kanal bulunamadı');
  const challenge = verifySubscription(query, channel.verifyToken);
  if (challenge === null) throw new AppError('Doğrulama token\'ı eşleşmedi', { statusCode: 403, code: 'WEBHOOK_VERIFY_FAILED' });
  return challenge;
}

/**
 * İmzalı webhook gövdesini işler.
 *
 * @param {string} channelId
 * @param {Buffer} rawBody
 * @param {object} body ayrıştırılmış gövde
 * @param {string | undefined} signature `X-Hub-Signature-256`
 * @returns {Promise<{ received: number, duplicates: number, reports: number, skipped: number }>}
 */
export async function handleWhatsAppWebhook(channelId, rawBody, body, signature) {
  const channel = await whatsappChannelById(channelId);
  if (!channel?.appSecret) throw new NotFoundError('Kanal bulunamadı');
  if (!verifySignature(rawBody, signature, channel.appSecret)) {
    throw new AppError('Webhook imzası geçersiz', { statusCode: 401, code: 'WEBHOOK_SIGNATURE_INVALID' });
  }

  const { messages, statuses } = parseWebhook(body);
  const own = (item) => item.phoneNumberId === channel.phoneNumberId;
  const outcome = { received: 0, duplicates: 0, reports: 0, skipped: 0 };
  outcome.skipped += messages.length + statuses.length - Math.min(messages.length + statuses.length, MAX_WEBHOOK_ITEMS);

  // Sırayla: aynı misafirin art arda mesajları yazıldığı sırada konuşmaya düşer.
  for (const message of messages.slice(0, MAX_WEBHOOK_ITEMS)) {
    if (!own(message)) {
      outcome.skipped += 1;
      continue;
    }
    const result = await receiveInboundMessage(channel.hotelId, {
      channel: 'WHATSAPP',
      externalId: message.from,
      externalMessageId: message.id,
      text: message.text,
      displayName: message.name,
      sentAt: message.sentAt ?? undefined,
    });
    if (result.duplicate) outcome.duplicates += 1;
    else outcome.received += 1;
  }

  for (const status of statuses.slice(0, Math.max(0, MAX_WEBHOOK_ITEMS - messages.length))) {
    if (!own(status)) {
      outcome.skipped += 1;
      continue;
    }
    // Gönderildi bildirimi, geçidin mesaja kanal kimliğini yazmasından önce
    // gelebilir; o bildirim atlanır, sonrakiler ("iletildi", "okundu") işlenir.
    const messageId = await findMessageIdByExternalId(channel.hotelId, status.id);
    if (!messageId) {
      outcome.skipped += 1;
      continue;
    }
    await markMessageDelivery(channel.hotelId, messageId, {
      delivery: status.delivery,
      ...(status.at ? { at: status.at } : {}),
      ...(status.failureReason ? { failureReason: status.failureReason } : {}),
    });
    outcome.reports += 1;
  }

  if (outcome.received > 0) await touchInbound(channel.hotelId, 'WHATSAPP');
  return outcome;
}

/**
 * Giden mesaj geçidinin (whatsapp-gateway) servisi.
 * @type {import('@hotelos/whatsapp-gateway').WhatsAppService}
 */
export const whatsappGatewayService = {
  async claimOutgoing(hotelId, messageId) {
    // Bilgiler önce: şifre çözülemezse (anahtar yok) mesaj sahiplenilmeden kalır.
    const credentials = await whatsappCredentials(hotelId);
    const claimed = await claimOutgoingMessage(hotelId, messageId, 'WHATSAPP');
    if (!claimed) return null;
    return {
      messageId: claimed.messageId,
      text: claimed.text,
      to: claimed.externalId,
      lastInboundAt: claimed.lastInboundAt,
      credentials,
    };
  },
  release: (hotelId, messageId) => releaseOutgoingMessage(hotelId, messageId),
  async markDelivery(hotelId, messageId, report) {
    await markMessageDelivery(hotelId, messageId, report);
  },
  recordFailure: (hotelId, error) => recordChannelError(hotelId, 'WHATSAPP', error),
};
