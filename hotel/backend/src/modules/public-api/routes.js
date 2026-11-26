import { IDEMPOTENCY_KEY_PATTERN, PUBLIC_API_ROUTES, buildPublicApiDocument } from '@hotelos/hotel-contracts';
import { AppError } from '../../lib/errors.js';
import { assertScope, authenticateApiRequest } from './auth.js';
import * as service from './service.js';

/**
 * Açık API (modül 61), `/v1` altında. Uçlar sözleşmedeki tablodan kaydedilir (`PUBLIC_API_ROUTES`): şema ve kapsam
 * tek yerde, doküman (`/v1/openapi.json`) aynı tablodan üretilir. Tabloda olup işleyicisi olmayan (ya da tersi) uç
 * varsa uygulama açılmaz.
 *
 * Sıra: anahtar (`onRequest`, 401) → uygulamanın dakikalık sınırı (429) → kapsam (`preValidation`, 403) → şema (400)
 * → işleyici. Genel panel hız sınırı bu uçlarda kapalıdır (anahtar başına değil uygulama başına sayılır; panelin
 * kişi + IP anahtarı burada anlamsız).
 *
 * Hata gövdesinden `details` atılır: iç ayrıntı (ör. eşleşen başka misafir kartları, kısıt adı) dışarıya çıkmaz;
 * `error`, `code`, `fields` kalır.
 */

/** Dokümandaki sunucu adresi (nginx `/api` önekiyle dışarıdan görünen kök). */
const PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL ?? process.env.VITE_API_URL ?? 'http://localhost:3000';
const OPENAPI_PATH = '/v1/openapi.json';

/** @type {Record<string, (request: any, reply: any) => Promise<unknown>>} */
const HANDLERS = {
  getHotel: (request) => service.getPublicHotel(request.apiCaller.hotelId),
  listRoomTypes: (request) => service.listPublicRoomTypes(request.apiCaller.hotelId),
  getAvailability: (request) => service.getPublicAvailability(request.apiCaller.hotelId, request.query),
  listReservations: (request) => service.listPublicReservations(request.apiCaller, request.query),
  getReservation: (request) => service.getPublicReservation(request.apiCaller, request.params.id),
  createReservation: async (request, reply) => {
    const { created, reservation } = await service.createPublicReservation(request.apiCaller, request.body, request.idempotencyKey);
    reply.status(created ? 201 : 200);
    return reservation;
  },
  updateReservation: (request) => service.updatePublicReservation(request.apiCaller, request.params.id, request.body),
  cancelReservation: (request) => service.cancelPublicReservation(request.apiCaller, request.params.id, request.body),
  listGuests: (request) => service.listPublicGuests(request.apiCaller, request.query),
  getGuest: (request) => service.getPublicGuest(request.apiCaller, request.params.id),
};

/** Tablo ile işleyiciler birebir mi (açılışta). */
export function assertPublicApiHandlers(routes = PUBLIC_API_ROUTES, handlers = HANDLERS) {
  const ids = new Set(routes.map((route) => route.id));
  const missing = [...ids].filter((id) => !handlers[id]);
  const extra = Object.keys(handlers).filter((id) => !ids.has(id));
  if (missing.length || extra.length) throw new Error(`Açık API tablosu ile işleyiciler uyuşmuyor (eksik: ${missing.join(', ') || '-'}; fazla: ${extra.join(', ') || '-'})`);
}

/** @param {import('fastify').FastifyInstance} app */
export async function publicApiRoutes(app) {
  assertPublicApiHandlers();
  let document = null;

  // Dışarıya iç ayrıntı gitmez; zarfı genel işleyici kurar (hata ona devredilir).
  app.setErrorHandler((error, _request, _reply) => {
    if (error && typeof error === 'object' && 'details' in error) error.details = undefined;
    throw error;
  });

  const limitByClient = app.createRateLimit({
    max: (request) => request.apiCaller.rateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: (request) => `apiclient|${request.apiCaller.clientId}`,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (request.routeOptions.url === OPENAPI_PATH) return;
    request.apiCaller = await authenticateApiRequest(request);
    request.hotelId = request.apiCaller.hotelId;
    const limit = await limitByClient(request);
    reply.header('x-ratelimit-limit', String(limit.max));
    reply.header('x-ratelimit-remaining', String(limit.remaining));
    reply.header('x-ratelimit-reset', String(limit.ttlInSeconds));
    if (limit.isExceeded) {
      reply.header('retry-after', String(limit.ttlInSeconds));
      throw new AppError(`Uygulamanın dakikalık istek sınırı (${limit.max}) aşıldı; ${limit.ttlInSeconds} sn sonra tekrar deneyin.`, { statusCode: 429, code: 'RATE_LIMITED' });
    }
  });

  // Doküman herkese açık (anahtarsız): entegrasyonu kuracak geliştirici önce okur. IP başına sınırlı.
  app.get(OPENAPI_PATH, { config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: (request) => `openapi|${request.ip}` } } }, async (_request, reply) => {
    document ??= buildPublicApiDocument({ serverUrl: PUBLIC_API_BASE_URL });
    reply.header('cache-control', 'public, max-age=300');
    return document;
  });

  for (const route of PUBLIC_API_ROUTES) {
    const preValidation = [
      async (request) => assertScope(request.apiCaller, route.scope),
      ...(route.idempotent
        ? [
            async (request) => {
              const key = request.headers['idempotency-key'];
              if (typeof key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
                throw new AppError('Idempotency-Key başlığı gerekli (8–100 karakter, harf / rakam / . _ : -; UUID önerilir)', { statusCode: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
              }
              request.idempotencyKey = key;
            },
          ]
        : []),
    ];
    app.route({
      method: route.method,
      url: route.path,
      config: { rateLimit: false },
      preValidation,
      schema: {
        ...(route.params ? { params: route.params } : {}),
        ...(route.query ? { querystring: route.query } : {}),
        ...(route.body ? { body: route.body } : {}),
      },
      handler: HANDLERS[route.id],
    });
  }
}
