import { readFile } from 'node:fs/promises';
import { BOOKING_WIDGET_PATH } from '@hotelos/webchat-gateway';
import {
  publicBookingKeySchema,
  publicBookingQuoteSchema,
  publicBookingReserveSchema,
} from '@hotelos/hotel-contracts';
import { assertBookingOrigin, publicOptions, publicQuote, publicReserve, resolveBookingChannel } from './service.js';

const WIDGET_CACHE_SECONDS = 300;

/** Uç başına IP sınırı (dakikada): misafir trafiğine bol, taramaya dar. */
const LIMITS = { read: 30, write: 5 };
const limited = (max) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

/**
 * Online rezervasyon motoru (modül 32) — public uçlar. Oturumsuz; kimlik web
 * chat kanalının genel anahtarı + izinli site (Origin) + IP hız sınırı
 * (uç başına + misafir kapsamının ortak IP tavanı — app.js'te kaydedilir).
 * Yanıtlar önbelleğe alınmaz (fiyat ve müsaitlik canlıdır).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function publicBookingRoutes(app) {
  const source = await readFile(BOOKING_WIDGET_PATH, 'utf8');
  app.get('/widget.js', async (_request, reply) => {
    reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', `public, max-age=${WIDGET_CACHE_SECONDS}`)
      .header('x-content-type-options', 'nosniff');
    return source;
  });

  const params = { params: publicBookingKeySchema };
  /** Kanalı çözer ve Origin'i denetler; yanıt önbelleklenmez. */
  const open = async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const channel = await resolveBookingChannel(request.params.key);
    assertBookingOrigin(channel, request.headers.origin);
    return channel;
  };

  app.get('/:key/options', { ...limited(LIMITS.read), schema: params }, async (request, reply) => ({
    success: true,
    data: await publicOptions(await open(request, reply)),
  }));

  app.post('/:key/quote', { ...limited(LIMITS.read), schema: { ...params, body: publicBookingQuoteSchema } }, async (request, reply) => ({
    success: true,
    data: await publicQuote(await open(request, reply), request.body),
  }));

  app.post('/:key/reserve', { ...limited(LIMITS.write), schema: { ...params, body: publicBookingReserveSchema } }, async (request, reply) => ({
    success: true,
    data: await publicReserve(await open(request, reply), request.body),
  }));
}
