import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { enterContext } from '@hotelos/core';
import { checkDb, disconnectDb } from './db.js';
import { asBusyError } from './lib/errors.js';
import { cache } from './lib/cache.js';
import { registerActors, setActorLogger } from './lib/actors.js';
import { registerCoreSubscribers, setEventLogger } from './lib/events.js';
import {
  actorFrom,
  allowedOrigins,
  CORS_ALLOWED_HEADERS,
  CORS_METHODS,
  correlationIdFrom,
  originChecker,
  rateLimitKey,
  resolveJwtSecret,
  resolveTrustProxy,
} from './lib/http-security.js';
import { approvalRoutes } from './modules/approvals/routes.js';
import { approvalCacheStats } from './modules/approvals/service.js';
import { registerApprovalSubscribers, setApprovalSubscriberLogger } from './modules/approvals/subscribers.js';
import { guestRequestRoutes } from './modules/guest-requests/routes.js';
import { reservationRoutes } from './modules/reservations/routes.js';
import { reservationCacheStats } from './modules/reservations/service.js';
import { registerReservationSubscribers, setReservationSubscriberLogger } from './modules/reservations/subscribers.js';
import { requestCacheStats } from './modules/guest-requests/service.js';
import { messagingRoutes } from './modules/messaging/routes.js';
import { messagingCacheStats } from './modules/messaging/service.js';
import { notificationRoutes, staffAlertRoutes } from './modules/notifications/routes.js';
import { registerNotificationSubscribers } from './modules/notifications/subscribers.js';
import { planRoutes } from './modules/plan/routes.js';
import { planCacheStats } from './modules/plan/service.js';
import { roomsRoutes } from './modules/rooms/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';

/**
 * Bir personelin (IP + kullanıcı) dakikada atabileceği istek sayısı. Canlı
 * ekranlar (gelen kutusu, istekler, oda planı) yoğun otelde değişiklik
 * başına birkaç sorgu atar; sınır cömert ama sınırsız değil.
 */
const DEFAULT_RATE_LIMIT_MAX = 600;

/**
 * Hız sınırının bellekte tuttuğu en fazla sayaç (IP + personel başına bir).
 * Eklentinin varsayılanı 5000: 2500 personel birden fazla cihazdan girince
 * sayaçlar erken atılıyor, sınır fiilen işlemez hâle geliyordu.
 */
const RATE_LIMIT_TRACKED_KEYS = 20_000;

/**
 * Sağlık ucunun veritabanı kontrolü bu süre paylaşılır: açık her panel
 * ucu sorar; her soruda havuzdan bağlantı alıp `SELECT 1` çalıştırmak 2500
 * panelde saniyede yüzlerce gereksiz sorgu demek.
 */
const HEALTH_DB_CHECK_TTL_MS = 5_000;

/** @type {{ at: number, result: Promise<'ok' | 'error'> | null }} */
let lastDbCheck = { at: 0, result: null };

function sharedDbCheck() {
  const now = Date.now();
  if (!lastDbCheck.result || now - lastDbCheck.at >= HEALTH_DB_CHECK_TTL_MS) {
    lastDbCheck = { at: now, result: checkDb() };
  }
  return lastDbCheck.result;
}

/**
 * Zod doğrulama hatasını kullanıcıya gösterilebilir tek satıra çevirir.
 * @param {{ validation?: Array<{ instancePath?: string, params?: { issue?: { path?: (string|number)[], message?: string } }, message?: string }> }} error
 * @returns {{ message: string, fields: Record<string, string> }}
 */
function formatValidationError(error) {
  const fields = {};
  for (const item of error.validation ?? []) {
    const issue = item.params?.issue;
    const path = (issue?.path ?? []).join('.') || (item.instancePath ?? '').replace(/^\//, '') || '_';
    if (!fields[path]) fields[path] = issue?.message ?? item.message ?? 'Geçersiz değer';
  }
  const first = Object.entries(fields)[0];
  return {
    message: first ? `${first[1]}${first[0] !== '_' ? ` (${first[0]})` : ''}` : 'Gönderilen veri geçersiz',
    fields,
  };
}

/**
 * Fastify uygulamasını kurar (dinlemeye başlamaz).
 *
 * `server.js`'den ayrı durmasının sebebi test edilebilirlik: testler bu
 * fonksiyonu çağırıp `app.inject()` ile gerçek port açmadan istek atabiliyor.
 *
 * @param {{ logger?: boolean | object, rateLimitMax?: number }} [options]
 * @returns {import('fastify').FastifyInstance}
 */
export async function buildApp({ logger = true, rateLimitMax } = {}) {
  const maxRequests = rateLimitMax ?? Number(process.env.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX);

  const app = Fastify({
    logger,
    genReqId: (request) => correlationIdFrom(request.headers['x-correlation-id']),
    trustProxy: resolveTrustProxy(),
  });

  setEventLogger(app.log);
  setActorLogger(app.log);
  registerCoreSubscribers();
  registerActors();
  registerNotificationSubscribers();
  setApprovalSubscriberLogger(app.log);
  registerApprovalSubscribers();
  setReservationSubscriberLogger(app.log);
  registerReservationSubscribers();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const origins = allowedOrigins();
  // socket.io aynı listeyi kullansın diye (bkz. server.js).
  app.decorate('allowedOrigins', origins);

  await app.register(cors, {
    origin: originChecker(origins),
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: ['x-correlation-id'],
  });
  await app.register(jwt, { secret: resolveJwtSecret(app.log) });

  // Tek bir istemcinin sunucuyu boğmasını engeller. Sayaç kişi başınadır
  // (bkz. `rateLimitKey`): aynı otel ağındaki paneller birbirinin kotasını yemez.
  await app.register(rateLimit, {
    max: maxRequests,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKey,
    cache: RATE_LIMIT_TRACKED_KEYS,
    // Eklenti bu nesneyi hata olarak error handler'a devrediyor; `statusCode`
    // ve `message` olmazsa handler onu 500 sanıyor. Zarfı tek yerde (error
    // handler'da) kurmak için sadece bu üç alanı veriyoruz.
    errorResponseBuilder: () => ({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Çok fazla istek gönderdiniz. Lütfen biraz bekleyip tekrar deneyin.',
    }),
  });

  /**
   * Her isteğe bir correlationId bağlanır ve async bağlam kurulur.
   *
   * Bundan sonra servis katmanındaki audit kaydı ve yayınlanan event'ler bu
   * kimliği kendiliğinden taşır — kimsenin elle geçirmesi gerekmez. Modül 10'un
   * "zinciri tek tıkla gör" ekranı bunun üstüne kurulacak.
   *
   * ⚠️ `actor` şu an istemcinin gönderdiği başlıktan geliyor ve doğrulanmıyor
   * (modül 2 / RBAC bekleniyor). Gerçek giriş gelince JWT'den okunacak.
   */
  app.addHook('onRequest', async (request, reply) => {
    const correlationId = String(request.id);
    enterContext({ correlationId, actor: actorFrom(request.headers['x-actor']) });
    reply.header('x-correlation-id', correlationId);
  });

  /**
   * Tüm hatalar aynı zarfla döner: `{ success, error, code, fields? }`.
   * `code` frontend'in dallanması içindir — mesaj metnine göre dallanmak kırılgan.
   */
  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      const { message, fields } = formatValidationError(error);
      request.log.info({ fields }, 'Doğrulama hatası');
      return reply.status(400).send({ success: false, error: message, code: 'VALIDATION', fields });
    }

    // Havuz dolu / transaction zaman aşımı: "beklenmeyen hata" değil, "yoğun".
    const busy = asBusyError(error);
    if (busy) {
      request.log.warn({ err: error }, 'Veritabanı yoğun; istek 503 ile döndü');
      reply.header('retry-after', String(busy.retryAfterSeconds));
      return reply.status(503).send({ success: false, error: busy.message, code: busy.code });
    }

    const status = error.statusCode ?? 500;

    if (status >= 500) {
      // İç hata detayı (SQL, dosya yolu, stack) istemciye sızmaz; log'da tam hali durur.
      request.log.error({ err: error }, 'Beklenmeyen sunucu hatası');
      return reply.status(status).send({
        success: false,
        error: 'Sunucuda beklenmeyen bir hata oluştu',
        code: 'INTERNAL',
      });
    }

    request.log.info({ code: error.code, msg: error.message }, 'İş kuralı hatası');
    return reply.status(status).send({
      success: false,
      error: error.message ?? 'İstek işlenemedi',
      code: error.code ?? 'ERROR',
      ...(error.details ? { details: error.details } : {}),
      ...(error.fields ? { fields: error.fields } : {}),
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ success: false, error: 'Bulunamadı', code: 'NOT_FOUND' });
  });

  app.get('/health', async () => {
    const db = await sharedDbCheck();
    return {
      success: true,
      data: {
        status: 'ok',
        db,
        cache: cache.stats(),
        planCache: planCacheStats(),
        messagingCache: messagingCacheStats(),
        requestCache: requestCacheStats(),
        approvalCache: approvalCacheStats(),
        reservationCache: reservationCacheStats(),
      },
    };
  });

  await app.register(settingsRoutes, { prefix: '/settings' });
  await app.register(roomsRoutes, { prefix: '/rooms' });
  await app.register(reservationRoutes, { prefix: '/reservations' });
  await app.register(planRoutes, { prefix: '/plan' });
  await app.register(messagingRoutes, { prefix: '/messaging' });
  await app.register(guestRequestRoutes, { prefix: '/guest-requests' });
  await app.register(notificationRoutes, { prefix: '/notifications' });
  await app.register(staffAlertRoutes, { prefix: '/staff-alerts' });
  await app.register(approvalRoutes, { prefix: '/approvals' });

  app.addHook('onClose', async () => {
    await disconnectDb();
  });

  return app;
}
