import { readFile } from 'node:fs/promises';
import { enterContext } from '@hotelos/core';
import { rotateWebchatKeySchema, webchatChannelSchema, whatsappChannelSchema } from '@hotelos/hotel-contracts';
import { WIDGET_PATH } from '@hotelos/webchat-gateway';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { getMessagingChannels, rotateWebchatKey, saveWebchatChannel, saveWhatsAppChannel } from './service.js';
import { handleWhatsAppWebhook, verifyWhatsAppWebhook } from './whatsapp.js';

/**
 * Mesaj kanalı ayarları (modül 8): WhatsApp Cloud API bağlantısı ve web chat
 * balonu. Sırlar yazılır ama hiç okunmaz.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function messagingChannelRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.SETTINGS_VIEW)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.SETTINGS_MANAGE)] };

  app.get('/', view, async (request) => ({
    success: true,
    data: await getMessagingChannels(request.hotelId),
  }));

  app.put('/whatsapp', { ...manage, schema: { body: whatsappChannelSchema } }, async (request) => ({
    success: true,
    data: await saveWhatsAppChannel(request.hotelId, request.body),
  }));

  app.put('/webchat', { ...manage, schema: { body: webchatChannelSchema } }, async (request) => ({
    success: true,
    data: await saveWebchatChannel(request.hotelId, request.body),
  }));

  app.post('/webchat/rotate-key', { ...manage, schema: { body: rotateWebchatKeySchema } }, async (request) => ({
    success: true,
    data: await rotateWebchatKey(request.hotelId, request.body),
  }));
}

/** Meta'nın gönderdiği en büyük gövde (bildirim paketleri küçük; fazlası reddedilir). */
const WEBHOOK_BODY_LIMIT = 1024 * 1024;

const channelParamsSchema = z.object({ channelId: z.string().uuid('Geçersiz kanal') });

/**
 * WhatsApp webhook'u (modül 8). Oturum yok; kimlik Meta'nın imzası.
 *
 * Genel hız sınırı kapalı: Meta yoğun anda aynı birkaç IP'den saniyede çok
 * sayıda bildirim gönderir, sınıra takılan bildirim geri döner ve gecikir.
 * İmzasız istek bir HMAC hesabı ve önbellekli kanal okumasıyla reddedilir.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function webhookRoutes(app) {
  // İmza ham gövde üzerinden: gövde bu kapsamda ayrıştırılırken ham hâli de saklanır.
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT }, (request, body, done) => {
    request.rawBody = body;
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch {
      done(new AppError('Gövde geçerli JSON değil', { statusCode: 400, code: 'INVALID_JSON' }));
    }
  });

  const webhook = { config: { rateLimit: false }, schema: { params: channelParamsSchema } };

  app.get('/whatsapp/:channelId', webhook, async (request, reply) => {
    const challenge = await verifyWhatsAppWebhook(request.params.channelId, request.query ?? {});
    reply.type('text/plain');
    return challenge;
  });

  app.post('/whatsapp/:channelId', webhook, async (request) => {
    enterContext({ correlationId: String(request.id), actor: 'kanal:whatsapp' });
    const outcome = await handleWhatsAppWebhook(
      request.params.channelId,
      request.rawBody ?? Buffer.alloc(0),
      request.body ?? {},
      request.headers['x-hub-signature-256'],
    );
    return { success: true, data: outcome };
  });
}

/** Balon betiği tarayıcıda kısa süre önbelleklenir (güncelleme birkaç dakikada yayılır). */
const WIDGET_CACHE_SECONDS = 300;

/**
 * Web chat balonunun betiği (otelin sitesi `<script src=".../webchat/widget.js">` ile yükler).
 * @param {import('fastify').FastifyInstance} app
 */
export async function webchatWidgetRoutes(app) {
  const source = await readFile(WIDGET_PATH, 'utf8');
  app.get('/widget.js', async (_request, reply) => {
    reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', `public, max-age=${WIDGET_CACHE_SECONDS}`)
      .header('x-content-type-options', 'nosniff');
    return source;
  });
}
