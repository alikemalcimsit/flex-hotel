import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * WhatsApp Cloud API protokolü (saf; test edilir).
 *
 * - Webhook doğrulaması: Meta, POST gövdesini uygulama sırrıyla HMAC-SHA256
 *   imzalar (`X-Hub-Signature-256: sha256=<hex>`). İmza **ham** gövde
 *   üzerinden hesaplanır; JSON'u ayrıştırıp yeniden yazmak imzayı bozar.
 * - Webhook kurulumu: Meta GET ile `hub.mode=subscribe`, `hub.verify_token`,
 *   `hub.challenge` gönderir; token tutarsa challenge aynen döner.
 * - 24 saat kuralı: misafir son 24 saatte yazmadıysa serbest metin
 *   gönderilemez (yalnızca onaylı şablon). Gönderimden önce denetlenir.
 */

/** Serbest metin penceresi. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Tek mesajın üst sınırı (Cloud API metin gövdesi). */
export const MAX_TEXT_LENGTH = 4096;

/**
 * @param {Buffer | string} rawBody
 * @param {string | undefined} header `X-Hub-Signature-256`
 * @param {string} appSecret
 */
export function verifySignature(rawBody, header, appSecret) {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  let given;
  try {
    given = Buffer.from(header.slice('sha256='.length), 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Webhook kurulum isteği.
 * @param {{ 'hub.mode'?: string, 'hub.verify_token'?: string, 'hub.challenge'?: string }} query
 * @param {string | null} verifyToken
 * @returns {string | null} dönülecek challenge ya da reddedilecekse null
 */
export function verifySubscription(query, verifyToken) {
  if (!verifyToken || query['hub.mode'] !== 'subscribe') return null;
  const given = Buffer.from(String(query['hub.verify_token'] ?? ''));
  const expected = Buffer.from(verifyToken);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return String(query['hub.challenge'] ?? '');
}

/** Metin dışı mesajların gelen kutusundaki karşılığı (personel bilsin, AI boşa uğraşmasın). */
const MEDIA_LABELS = Object.freeze({
  image: '[Görsel gönderildi]',
  audio: '[Ses kaydı gönderildi]',
  video: '[Video gönderildi]',
  document: '[Belge gönderildi]',
  sticker: '[Çıkartma gönderildi]',
  location: '[Konum paylaşıldı]',
  contacts: '[Kişi kartı paylaşıldı]',
});

/** @param {any} message */
function textOf(message) {
  switch (message.type) {
    case 'text':
      return message.text?.body ?? '';
    case 'button':
      return message.button?.text ?? '';
    case 'interactive':
      return message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? '[Etkileşimli cevap]';
    case 'location': {
      const location = message.location ?? {};
      const place = [location.name, location.address].filter(Boolean).join(', ');
      return place ? `[Konum: ${place}]` : MEDIA_LABELS.location;
    }
    default:
      return MEDIA_LABELS[message.type] ?? `[Desteklenmeyen mesaj türü: ${message.type ?? 'bilinmiyor'}]`;
  }
}

const STATUS_MAP = Object.freeze({ sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' });

/** @param {string | number | undefined} seconds */
const fromUnix = (seconds) => {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
};

/**
 * Webhook gövdesi → gelen mesajlar ve teslim durumları.
 *
 * @param {any} body
 * @returns {{
 *   messages: Array<{ phoneNumberId: string, from: string, id: string, sentAt: Date | null, type: string, text: string, name: string | null }>,
 *   statuses: Array<{ phoneNumberId: string, id: string, delivery: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED', at: Date | null, recipient: string | null, failureReason: string | null }>,
 * }}
 */
export function parseWebhook(body) {
  const messages = [];
  const statuses = [];
  if (body?.object !== 'whatsapp_business_account') return { messages, statuses };
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value ?? {};
      const phoneNumberId = String(value.metadata?.phone_number_id ?? '');
      const names = new Map((value.contacts ?? []).map((contact) => [String(contact.wa_id), contact.profile?.name ?? null]));
      for (const message of value.messages ?? []) {
        if (!message?.id || !message?.from) continue;
        const text = textOf(message).trim().slice(0, MAX_TEXT_LENGTH) || '[Boş mesaj]';
        messages.push({
          phoneNumberId,
          from: String(message.from),
          id: String(message.id),
          sentAt: fromUnix(message.timestamp),
          type: String(message.type ?? 'unknown'),
          text,
          name: names.get(String(message.from)) ?? null,
        });
      }
      for (const status of value.statuses ?? []) {
        const delivery = STATUS_MAP[status?.status];
        if (!status?.id || !delivery) continue;
        const error = status.errors?.[0];
        statuses.push({
          phoneNumberId,
          id: String(status.id),
          delivery,
          at: fromUnix(status.timestamp),
          recipient: status.recipient_id ? String(status.recipient_id) : null,
          failureReason: delivery === 'FAILED' ? describeMetaError(error) : null,
        });
      }
    }
  }
  return { messages, statuses };
}

/**
 * Serbest metin gönderilebilir mi (misafir son 24 saatte yazdı mı)?
 * @param {Date | string | null} lastInboundAt
 * @param {number} now epoch ms
 */
export function windowOpen(lastInboundAt, now) {
  if (!lastInboundAt) return false;
  return now - new Date(lastInboundAt).getTime() < CUSTOMER_SERVICE_WINDOW_MS;
}

/**
 * Gönderim gövdesi.
 * @param {string} to misafirin WhatsApp kimliği (ülke koduyla rakamlar)
 * @param {string} text
 */
export function buildTextMessage(to, text) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: text.slice(0, MAX_TEXT_LENGTH) },
  };
}

/**
 * Meta hata kodlarının okunur hâli.
 * @param {{ code?: number, title?: string, message?: string, error_data?: { details?: string } } | undefined} error
 */
export function describeMetaError(error) {
  if (!error) return 'WhatsApp mesajı teslim edemedi';
  switch (Number(error.code)) {
    case 131047:
      return 'WhatsApp 24 saat penceresi kapalı: misafir son 24 saatte yazmadı; yalnızca onaylı şablonla yazılabilir';
    case 131026:
      return 'Mesaj teslim edilemedi (numara WhatsApp kullanmıyor ya da uygulaması güncel değil)';
    case 131051:
      return 'Desteklenmeyen mesaj türü';
    case 190:
      return 'WhatsApp erişim token\'ı geçersiz ya da süresi dolmuş';
    default:
      return [error.title ?? error.message, error.error_data?.details].filter(Boolean).join(' — ') || `WhatsApp hatası (${error.code})`;
  }
}

/** Hız sınırı ve geçici hatalar: biraz sonra tekrar denenir. */
const RETRYABLE_META_CODES = new Set([1, 2, 4, 17, 80007, 130429, 131000, 131016, 133004]);
/** Anahtar ve yetki hataları: tekrar denemek düzeltmez. */
const AUTH_META_CODES = new Set([10, 190, 200]);

/**
 * Gönderim hatasının sınıfı.
 * @param {number} status HTTP durumu
 * @param {{ code?: number } | undefined} error Meta hata gövdesi
 * @returns {{ retryable: boolean, code: string }}
 */
export function classifySendError(status, error) {
  const metaCode = Number(error?.code);
  if (metaCode === 131047) return { retryable: false, code: 'WINDOW_CLOSED' };
  if (AUTH_META_CODES.has(metaCode) || status === 401 || status === 403) return { retryable: false, code: 'AUTH' };
  if (RETRYABLE_META_CODES.has(metaCode) || status === 429 || status >= 500) return { retryable: true, code: 'TEMPORARY' };
  return { retryable: false, code: 'REJECTED' };
}
