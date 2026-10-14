import { timingSafeEqual } from 'node:crypto';
import { CHANNEX_WEBHOOK_SECRET_HEADER } from '@hotelos/channel-sync-worker';
import { enterContext } from '@hotelos/core';
import {
  addChannelStopSaleSchema,
  channelBookingParamSchema,
  channelBookingQuerySchema,
  channelListQuerySchema,
  channelLogQuerySchema,
  channelManagerParamSchema,
  channelStatusSchema,
  channelStopSaleParamSchema,
  channelVersionSchema,
  channexWebhookSchema,
  createChannelSchema,
  resolveChannelBookingSchema,
  saveChannelMappingsSchema,
  updateChannelSchema,
} from '@hotelos/hotel-contracts';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { NotFoundError, UnauthorizedError } from '../../lib/errors.js';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { openSecret } from '../../lib/secret-box.js';
import { withHotelContext } from '../../lib/tenant.js';
import { pollChannexBookings } from './bookings.js';
import { exportIcalCalendar } from './ical.js';
import * as service from './service.js';

/**
 * Kanal yönetimi route'ları (modül 33).
 *
 * - Görmek (kanallar, senkron logu, kanal rezervasyonları): `channel_manager.view` (müdür).
 * - Kanal bağlamak / düzenlemek / senkrona almak, eşleştirme, stop-sale, elle senkron,
 *   webhook, "doğrulandı" kapatması: `channel_manager.manage` (müdür).
 *
 * Liste uçları sayfalıdır. Channex API anahtarı ve webhook sırrı hiçbir cevapta dönmez.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function channelManagerRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.CHANNEL_MANAGER_VIEW);
  const manage = guard(PERMISSIONS.CHANNEL_MANAGER_MANAGE);
  const ok = (data) => ({ success: true, data });
  const logParams = channelManagerParamSchema.extend({ logId: z.string().uuid('Geçersiz log kaydı') });

  app.get('/', { ...view, schema: { querystring: channelListQuerySchema } }, async (request) =>
    ok(await service.listChannels(request.hotelId, request.query)),
  );

  app.post('/', { ...manage, schema: { body: createChannelSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await service.createChannel(request.hotelId, request.body))),
  );

  app.get('/:channelId', { ...view, schema: { params: channelManagerParamSchema } }, async (request) =>
    ok(await service.getChannel(request.hotelId, request.params.channelId)),
  );

  app.patch('/:channelId', { ...manage, schema: { params: channelManagerParamSchema, body: updateChannelSchema } }, async (request) =>
    ok(await service.updateChannel(request.hotelId, request.params.channelId, request.body)),
  );

  app.post('/:channelId/status', { ...manage, schema: { params: channelManagerParamSchema, body: channelStatusSchema } }, async (request) =>
    ok(await service.setChannelStatus(request.hotelId, request.params.channelId, request.body)),
  );

  app.post('/:channelId/delete', { ...manage, schema: { params: channelManagerParamSchema, body: channelVersionSchema } }, async (request) => {
    await service.deleteChannel(request.hotelId, request.params.channelId, request.body);
    return ok({ deleted: true });
  });

  /* ── Eşleştirme ── */

  app.get('/:channelId/external-options', { ...manage, schema: { params: channelManagerParamSchema } }, async (request) =>
    ok(await service.getExternalOptions(request.hotelId, request.params.channelId)),
  );

  app.put('/:channelId/mappings', { ...manage, schema: { params: channelManagerParamSchema, body: saveChannelMappingsSchema } }, async (request) =>
    ok(await service.saveChannelMappings(request.hotelId, request.params.channelId, request.body)),
  );

  /* ── Stop-sale ── */

  app.post('/:channelId/stop-sales', { ...manage, schema: { params: channelManagerParamSchema, body: addChannelStopSaleSchema } }, async (request) =>
    ok(await service.addChannelStopSale(request.hotelId, request.params.channelId, request.body)),
  );

  app.delete('/:channelId/stop-sales/:stopSaleId', { ...manage, schema: { params: channelStopSaleParamSchema } }, async (request) =>
    ok(await service.removeChannelStopSale(request.hotelId, request.params.channelId, request.params.stopSaleId)),
  );

  /* ── Senkron ── */

  app.post('/:channelId/sync', { ...manage, schema: { params: channelManagerParamSchema } }, async (request, reply) =>
    reply.status(202).send(ok(await service.requestManualSync(request.hotelId, request.params.channelId))),
  );

  app.post('/:channelId/webhook', { ...manage, schema: { params: channelManagerParamSchema, body: channexWebhookSchema } }, async (request) =>
    ok(await service.setupChannexWebhook(request.hotelId, request.params.channelId, request.body)),
  );

  app.get('/:channelId/logs', { ...view, schema: { params: channelManagerParamSchema, querystring: channelLogQuerySchema } }, async (request) =>
    ok(await service.listChannelLogs(request.hotelId, request.params.channelId, request.query)),
  );

  app.get('/:channelId/logs/:logId', { ...view, schema: { params: logParams } }, async (request) =>
    ok(await service.getChannelLog(request.hotelId, request.params.channelId, request.params.logId)),
  );

  /* ── Kanal rezervasyonları ── */

  app.get('/:channelId/bookings', { ...view, schema: { params: channelManagerParamSchema, querystring: channelBookingQuerySchema } }, async (request) =>
    ok(await service.listChannelBookings(request.hotelId, request.params.channelId, request.query)),
  );

  app.post(
    '/:channelId/bookings/:bookingId/resolve',
    { ...manage, schema: { params: channelBookingParamSchema, body: resolveChannelBookingSchema } },
    async (request) => {
      await service.resolveChannelBooking(request.hotelId, request.params.channelId, request.params.bookingId, request.body);
      return ok({ resolved: true });
    },
  );
}

/**
 * @param {string} expected
 * @param {unknown} given
 */
function sameSecret(expected, given) {
  if (typeof given !== 'string' || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Channex webhook'u (oturum yok; kimlik kanalın sırrı, başlıkta). Gövdeye
 * güvenilmez: bildirim yalnızca "akışı şimdi oku" demektir, rezervasyon akıştan
 * okunur ve teyit edilir. Cevap hemen döner (Channex yavaş cevaba yeniden dener).
 *
 * Genel hız sınırı kapalı: toplu rezervasyonda Channex aynı birkaç IP'den art arda
 * bildirim gönderir; aynı kanalın akışı zaten aynı anda bir kez okunur.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function channexWebhookRoutes(app) {
  app.post(
    '/:channelId',
    { config: { rateLimit: false }, schema: { params: channelManagerParamSchema } },
    async (request) => {
      enterContext({ correlationId: String(request.id), actor: 'kanal:channex' });
      const { channelId } = request.params;
      const channel = await prisma.channel.findFirst({
        where: { id: channelId, type: 'CHANNEX' },
        select: { status: true, webhookSecret: true },
      });
      if (!channel?.webhookSecret) throw new NotFoundError('Kanal bulunamadı');
      if (!sameSecret(openSecret(channel.webhookSecret), request.headers[CHANNEX_WEBHOOK_SECRET_HEADER])) {
        throw new UnauthorizedError('Webhook sırrı geçersiz');
      }
      if (channel.status === 'ACTIVE') {
        // Arka planda: Channex'in bildirimi akış okumasını beklemesin.
        setImmediate(() => {
          pollChannexBookings(channelId, { trigger: 'WEBHOOK' }).catch((error) => request.log.warn({ err: error, channelId }, 'Webhook sonrası akış okunamadı'));
        });
      }
      return { success: true, data: { accepted: channel.status === 'ACTIVE' } };
    },
  );
}

/** Kanalın okuduğu takvim belirteci: base64url, dosya adı ".ics" ile. */
const icalFileSchema = z.object({
  file: z.string().regex(/^[A-Za-z0-9_-]{20,64}\.ics$/, 'Geçersiz takvim adresi'),
});

/**
 * iCal dışa aktarma (oturum yok; kimlik adresteki gizli belirteç). Kanal
 * (Airbnb, Booking.com) birkaç saatte bir okur.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function icalExportRoutes(app) {
  app.get('/:file', { schema: { params: icalFileSchema } }, async (request, reply) => {
    const text = await exportIcalCalendar(request.params.file.replace(/\.ics$/, ''));
    reply
      .type('text/calendar; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff');
    return text;
  });
}
