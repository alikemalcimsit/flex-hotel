import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { enterContext } from '@hotelos/core';
import { checkDb, disconnectDb } from './db.js';
import { cache } from './lib/cache.js';
import { registerActors, setActorLogger } from './lib/actors.js';
import { registerCoreSubscribers, setEventLogger } from './lib/events.js';
import { roomsRoutes } from './modules/rooms/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-degistir';

/** Bir istemcinin dakikada atabileceği istek sayısı. */
const DEFAULT_RATE_LIMIT_MAX = 300;

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
    genReqId: (request) => request.headers['x-correlation-id'] ?? randomUUID(),
  });

  setEventLogger(app.log);
  setActorLogger(app.log);
  registerCoreSubscribers();
  registerActors();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: true, exposedHeaders: ['x-correlation-id'] });
  await app.register(jwt, { secret: JWT_SECRET });

  // Tek bir istemcinin sunucuyu boğmasını engeller. Ayarlar ekranı düşük
  // hacimli; sınır cömert ama sınırsız değil.
  await app.register(rateLimit, {
    max: maxRequests,
    timeWindow: '1 minute',
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
    const claimedActor = request.headers['x-actor'];
    enterContext({
      correlationId,
      actor: typeof claimedActor === 'string' && claimedActor ? claimedActor : 'anonim',
    });
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
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ success: false, error: 'Bulunamadı', code: 'NOT_FOUND' });
  });

  app.get('/health', async () => {
    const db = await checkDb();
    return { success: true, data: { status: 'ok', db, cache: cache.stats() } };
  });

  await app.register(settingsRoutes, { prefix: '/settings' });
  await app.register(roomsRoutes, { prefix: '/rooms' });

  app.addHook('onClose', async () => {
    await disconnectDb();
  });

  return app;
}
