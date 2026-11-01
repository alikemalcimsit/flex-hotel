import {
  assignHousekeepingTasksSchema,
  cancelHousekeepingTaskSchema,
  completeHousekeepingTaskSchema,
  createHousekeepingTaskSchema,
  housekeepingTaskListQuerySchema,
  idParamSchema,
  inspectHousekeepingTaskSchema,
  reportHousekeepingIssueSchema,
  startHousekeepingTaskSchema,
} from '@hotelos/hotel-contracts';
import { z } from 'zod';
import { PERMISSIONS, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Kat hizmetleri route'ları (modül 14).
 *
 * İzinler üçe ayrılır: görevli kendi işini yürütür (`operate`: başlat, bitir,
 * sorun bildir), kat şefi dağıtır (`manage`: aç, ata, iptal) ve denetler
 * (`inspect`: onay / ret — dört göz kuralı serviste). Resepsiyon yalnızca
 * görür (`view`): "104 ne zaman hazır olur?" sorusunun cevabı buradadır.
 */

const dateQuerySchema = z.object({ date: housekeepingTaskListQuerySchema.shape.date });

/**
 * @param {import('fastify').FastifyInstance} app
 */
export async function housekeepingRoutes(app) {
  const view = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.HOUSEKEEPING_VIEW)] };
  const operate = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.HOUSEKEEPING_OPERATE)] };
  const manage = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.HOUSEKEEPING_MANAGE)] };
  const inspect = { preHandler: [withHotelContext, requirePermission(PERMISSIONS.HOUSEKEEPING_INSPECT)] };

  /* ── Okuma ── */

  app.get('/tasks', { ...view, schema: { querystring: housekeepingTaskListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listTasks(request.hotelId, request.query),
  }));

  app.get('/summary', { ...view, schema: { querystring: dateQuerySchema } }, async (request) => ({
    success: true,
    data: await service.taskSummary(request.hotelId, request.query),
  }));

  app.get('/floor-map', view, async (request) => ({
    success: true,
    data: await service.floorMap(request.hotelId),
  }));

  /** Atama seçicisi: kat hizmeti personeli ve açık görev yükü. */
  app.get('/staff', manage, async (request) => ({
    success: true,
    data: await service.housekeepingStaff(request.hotelId),
  }));

  /* ── Şef işlemleri ── */

  app.post('/tasks', { ...manage, schema: { body: createHousekeepingTaskSchema } }, async (request, reply) => {
    const task = await service.createTask(request.hotelId, request.body);
    reply.code(201);
    return { success: true, data: task };
  });

  app.post('/tasks/assign', { ...manage, schema: { body: assignHousekeepingTasksSchema } }, async (request) => ({
    success: true,
    data: await service.assignTasks(request.hotelId, request.body),
  }));

  app.patch(
    '/tasks/:id/cancel',
    { ...manage, schema: { params: idParamSchema, body: cancelHousekeepingTaskSchema } },
    async (request) => ({
      success: true,
      data: await service.cancelTask(request.hotelId, request.params.id, request.body),
    }),
  );

  /* ── Görevli işlemleri (mobil: Başladım / Bitti / Sorun var) ── */

  app.patch(
    '/tasks/:id/start',
    { ...operate, schema: { params: idParamSchema, body: startHousekeepingTaskSchema } },
    async (request) => ({
      success: true,
      data: await service.startTask(request.hotelId, request.params.id, request.body),
    }),
  );

  app.patch(
    '/tasks/:id/complete',
    { ...operate, schema: { params: idParamSchema, body: completeHousekeepingTaskSchema } },
    async (request) => ({
      success: true,
      data: await service.completeTask(request.hotelId, request.params.id, request.body),
    }),
  );

  app.patch(
    '/tasks/:id/issue',
    { ...operate, schema: { params: idParamSchema, body: reportHousekeepingIssueSchema } },
    async (request) => ({
      success: true,
      data: await service.reportIssue(request.hotelId, request.params.id, request.body),
    }),
  );

  /* ── Kat şefi kontrolü ── */

  app.patch(
    '/tasks/:id/inspect',
    { ...inspect, schema: { params: idParamSchema, body: inspectHousekeepingTaskSchema } },
    async (request) => ({
      success: true,
      data: await service.inspectTask(request.hotelId, request.params.id, request.body),
    }),
  );
}
