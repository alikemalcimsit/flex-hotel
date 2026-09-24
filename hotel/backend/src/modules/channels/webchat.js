import { createHmac, randomUUID } from 'node:crypto';
import { runWithContext } from '@hotelos/core';
import { normalizeOrigin, webchatMessageSchema } from '@hotelos/hotel-contracts';
import { createRateLimiter, createSessionToken, verifySessionToken, WEBCHAT_EVENTS } from '@hotelos/webchat-gateway';
import {
  claimOutgoingMessage,
  conversationTranscript,
  markChannelMessagesRead,
  markMessageDelivery,
  receiveInboundMessage,
  releaseOutgoingMessage,
} from '../messaging/service.js';
import { touchInbound, webchatChannelByKey } from './service.js';

/**
 * Web chat balonunun sunucu tarafı (modül 8): socket.io `/webchat` ad alanı.
 *
 * ### Kimlik
 *
 * Misafirin hesabı yok. Balon ilk bağlantıda imzalı bir oturum token'ı alır
 * (tarayıcıda saklar); konuşma bu oturumun kimliğine bağlıdır. Token sunucu
 * sırrıyla imzalı olduğundan başkasının oturumunu tahmin edip konuşmasını
 * okumak mümkün değil. Token her bağlantıda yenilenir (30 gün kayar süre).
 *
 * ### Kötüye kullanım
 *
 * Uç herkese açık (otelin web sitesi). Korumalar:
 * - Balonun genel anahtarı kanal kaydını bulur; kanal kapalıysa bağlantı yok.
 * - Bağlantının geldiği site (Origin) otelin izin verdiği adreslerden biri
 *   olmalı: başka bir site balonu gömüp otelin AI bütçesini harcayamaz.
 *   (Tarayıcı dışı istemci Origin'i taklit edebilir; asıl sınır aşağıdaki.)
 * - Hız sınırı: IP başına bağlantı; oturum ve IP başına mesaj.
 * - Metin sözleşmeyle sınırlı (2000 karakter), HTML olarak yorumlanmaz
 *   (balon `textContent` kullanır).
 */

/** Balon açılınca gönderilen geçmiş. */
export const WEBCHAT_HISTORY_LIMIT = 50;
/** Tek "gördüm" bildirimindeki en fazla mesaj. */
const MAX_SEEN_IDS = 100;

/** IP başına bağlantı: 20 anlık, dakikada 20. */
const CONNECT_LIMIT = Object.freeze({ capacity: 20, refillPerSecond: 20 / 60 });
/** Oturum başına mesaj: 8 anlık, dakikada 8 (bir insanın yazma hızı). */
const SESSION_MESSAGE_LIMIT = Object.freeze({ capacity: 8, refillPerSecond: 8 / 60 });
/** IP başına mesaj (aynı IP'den çok oturum açıp sınırı aşmasın): 30 anlık, dakikada 30. */
const IP_MESSAGE_LIMIT = Object.freeze({ capacity: 30, refillPerSecond: 30 / 60 });
/** Oturum başına "gördüm": 30 anlık, saniyede 1. */
const SEEN_LIMIT = Object.freeze({ capacity: 30, refillPerSecond: 1 });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {string} hotelId @param {string} sessionId */
const roomOf = (hotelId, sessionId) => `webchat:${hotelId}:${sessionId}`;

/**
 * Oturum token'ının imza anahtarı: sunucunun JWT sırrından türetilir (ayrı
 * bir ortam değişkeni gerekmez; JWT sırrı değişirse oturumlar da yenilenir).
 * @param {string} jwtSecret
 */
export function webchatSessionSecret(jwtSecret) {
  return createHmac('sha256', jwtSecret).update('hotelos:webchat-session:v1').digest();
}

/**
 * Bağlantı reddi: balon `error.data.code`'a bakar.
 * @param {string} code
 * @param {string} message
 */
function refusal(code, message) {
  const error = new Error(message);
  error.data = { code };
  return error;
}

/** Balonun kendi oturumuna yazan hata bilgisi (dil balonda seçilir). */
const ACK_CODES = Object.freeze({ INVALID: 'INVALID', RATE_LIMITED: 'RATE_LIMITED', FAILED: 'FAILED' });

/**
 * `/webchat` ad alanını kurar ve web chat geçidinin taşıyıcısını döndürür.
 *
 * @param {import('socket.io').Server} io
 * @param {{ secret: Buffer, clientIp: (request: import('node:http').IncomingMessage) => string, logger: { info: Function, warn: Function, error: Function } }} options
 * @returns {{ deliver: (hotelId: string, sessionId: string, message: object) => Promise<number> }}
 */
export function registerWebchatNamespace(io, { secret, clientIp, logger }) {
  const namespace = io.of('/webchat');
  const connectLimiter = createRateLimiter(CONNECT_LIMIT);
  const sessionLimiter = createRateLimiter(SESSION_MESSAGE_LIMIT);
  const ipLimiter = createRateLimiter(IP_MESSAGE_LIMIT);
  const seenLimiter = createRateLimiter(SEEN_LIMIT);

  namespace.use(async (socket, next) => {
    try {
      const ip = clientIp(socket.request);
      if (!connectLimiter.take(ip)) return next(refusal('RATE_LIMITED', 'Çok fazla bağlantı denemesi'));
      const { key, token } = socket.handshake.auth ?? {};
      const channel = await webchatChannelByKey(key);
      if (!channel?.enabled) return next(refusal('CHAT_DISABLED', 'Sohbet kapalı'));
      const origin = normalizeOrigin(String(socket.handshake.headers.origin ?? ''));
      if (!origin || !(channel.settings?.allowedOrigins ?? []).includes(origin)) {
        return next(refusal('CHAT_DISABLED', 'Bu site için sohbet açık değil'));
      }
      const verified = verifySessionToken(token, secret, { hotelId: channel.hotelId });
      const session = createSessionToken({ hotelId: channel.hotelId, ...(verified ? { sessionId: verified.sessionId } : {}) }, secret);
      socket.data.webchat = {
        hotelId: channel.hotelId,
        sessionId: session.sessionId,
        token: session.token,
        ip,
        config: {
          title: channel.settings?.title ?? '',
          greeting: channel.settings?.greeting ?? null,
          accentColor: channel.settings?.accentColor ?? null,
        },
      };
      return next();
    } catch (error) {
      logger.error({ err: error }, 'Web chat bağlantısı kurulamadı');
      return next(refusal('UNAVAILABLE', 'Sohbet şu anda kullanılamıyor'));
    }
  });

  namespace.on('connection', (socket) => {
    const { hotelId, sessionId, token, config } = socket.data.webchat;
    const room = roomOf(hotelId, sessionId);
    socket.join(room);
    socket.emit(WEBCHAT_EVENTS.SESSION, { token });
    socket.emit(WEBCHAT_EVENTS.CONFIG, config);
    conversationTranscript(hotelId, 'WEBCHAT', sessionId, { limit: WEBCHAT_HISTORY_LIMIT })
      .then((messages) => socket.emit(WEBCHAT_EVENTS.HISTORY, { messages }))
      .catch((error) => logger.error({ err: error }, 'Web chat geçmişi yüklenemedi'));

    socket.on(WEBCHAT_EVENTS.SEND, (body) => {
      onSend(socket, room, body).catch((error) => logger.error({ err: error }, 'Web chat mesajı işlenemedi'));
    });
    socket.on(WEBCHAT_EVENTS.SEEN, (body) => {
      onSeen(socket, body).catch((error) => logger.error({ err: error }, 'Web chat "gördüm" işlenemedi'));
    });
  });

  /**
   * @param {import('socket.io').Socket} socket
   * @param {string} room
   * @param {unknown} body
   */
  async function onSend(socket, room, body) {
    const { hotelId, sessionId, ip } = socket.data.webchat;
    const clientMessageId = typeof body?.clientMessageId === 'string' ? body.clientMessageId.slice(0, 64) : null;
    const parsed = webchatMessageSchema.safeParse(body);
    if (!parsed.success) {
      socket.emit(WEBCHAT_EVENTS.ACK, { clientMessageId, code: ACK_CODES.INVALID, error: parsed.error.issues[0]?.message ?? 'Mesaj geçersiz' });
      return;
    }
    if (!sessionLimiter.take(sessionId) || !ipLimiter.take(ip)) {
      socket.emit(WEBCHAT_EVENTS.ACK, { clientMessageId, code: ACK_CODES.RATE_LIMITED, error: 'Çok hızlı yazıyorsunuz' });
      return;
    }
    let result;
    try {
      result = await runWithContext({ correlationId: randomUUID(), actor: 'kanal:webchat' }, () =>
        receiveInboundMessage(hotelId, {
          channel: 'WEBCHAT',
          externalId: sessionId,
          externalMessageId: parsed.data.clientMessageId,
          text: parsed.data.text,
          displayName: parsed.data.name ?? null,
        }),
      );
    } catch (error) {
      logger.error({ err: error }, 'Web chat mesajı kaydedilemedi');
      socket.emit(WEBCHAT_EVENTS.ACK, { clientMessageId, code: ACK_CODES.FAILED, error: 'Mesaj kaydedilemedi' });
      return;
    }
    socket.emit(WEBCHAT_EVENTS.ACK, { clientMessageId, id: result.message.id });
    if (result.duplicate) return;
    // Aynı oturumun diğer sekmeleri de görsün.
    socket.to(room).emit(WEBCHAT_EVENTS.MESSAGE, { id: result.message.id, author: 'GUEST', text: result.message.text, at: result.message.createdAt });
    if (result.mode === 'AI') namespace.to(room).emit(WEBCHAT_EVENTS.TYPING, { on: true });
    touchInbound(hotelId, 'WEBCHAT').catch((error) => logger.warn({ err: error }, 'Web chat son mesaj zamanı yazılamadı'));
  }

  /**
   * @param {import('socket.io').Socket} socket
   * @param {unknown} body
   */
  async function onSeen(socket, body) {
    const { hotelId, sessionId } = socket.data.webchat;
    if (!seenLimiter.take(sessionId)) return;
    const ids = Array.isArray(body?.messageIds)
      ? body.messageIds.filter((id) => typeof id === 'string' && UUID_PATTERN.test(id)).slice(0, MAX_SEEN_IDS)
      : [];
    if (ids.length === 0) return;
    await runWithContext({ correlationId: randomUUID(), actor: 'kanal:webchat' }, () =>
      markChannelMessagesRead(hotelId, 'WEBCHAT', sessionId, ids),
    );
  }

  return {
    async deliver(hotelId, sessionId, message) {
      const room = roomOf(hotelId, sessionId);
      const sockets = await namespace.in(room).fetchSockets();
      namespace.to(room).emit(WEBCHAT_EVENTS.TYPING, { on: false });
      namespace.to(room).emit(WEBCHAT_EVENTS.MESSAGE, message);
      return sockets.length;
    },
  };
}

/**
 * Web chat geçidinin taşıyıcısı sonradan takılır: socket sunucusu yalnızca
 * `server.js`'de var; testler ve betikler onsuz çalışır (mesaj "gönderildi"
 * işaretlenir, misafir balonu açınca geçmişte görür).
 */
let transport = null;

/** @param {{ deliver: Function } | null} next */
export function setWebchatTransport(next) {
  transport = next;
}

/**
 * Web chat geçidinin (webchat-gateway) servisi ve taşıyıcısı.
 */
export const webchatGatewayService = {
  async claimOutgoing(hotelId, messageId) {
    const claimed = await claimOutgoingMessage(hotelId, messageId, 'WEBCHAT');
    if (!claimed) return null;
    return {
      messageId: claimed.messageId,
      to: claimed.externalId,
      message: { id: claimed.messageId, author: claimed.author, text: claimed.text, at: claimed.createdAt.toISOString() },
    };
  },
  release: (hotelId, messageId) => releaseOutgoingMessage(hotelId, messageId),
  async markDelivery(hotelId, messageId, report) {
    await markMessageDelivery(hotelId, messageId, report);
  },
};

export const webchatTransport = {
  /** @returns {Promise<number>} mesajı alan açık balon sayısı */
  deliver: (hotelId, sessionId, message) => (transport ? transport.deliver(hotelId, sessionId, message) : Promise.resolve(0)),
};
