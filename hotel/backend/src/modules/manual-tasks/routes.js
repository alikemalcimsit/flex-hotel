import {
  cancelManualTaskSchema,
  completeManualTaskSchema,
  manualTaskListQuerySchema,
  manualTaskParamSchema,
} from '@hotelos/hotel-contracts';
import { requireAuth } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as service from './service.js';

/**
 * Manuel görev route'ları (modül 12).
 *
 * Tek bir izin yok: görev, işin modülüne yetkili personele görünür (oda
 * atama → oda işlemleri, cevapsız mesaj → mesaj yazma; bkz.
 * `manualTaskScope`). Route yalnızca oturumu ister; kapsamı ve görev
 * başına yetkiyi servis, oturumun etkin izinleriyle denetler (403).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function manualTaskRoutes(app) {
  const signedIn = { preHandler: [withHotelContext, requireAuth] };
  const permissions = (request) => request.auth.permissions;

  app.get('/', { ...signedIn, schema: { querystring: manualTaskListQuerySchema } }, async (request) => ({
    success: true,
    data: await service.listManualTasks(request.hotelId, permissions(request), request.query),
  }));

  app.get('/summary', signedIn, async (request) => ({
    success: true,
    data: await service.getManualTaskSummary(request.hotelId, permissions(request)),
  }));

  app.get('/:taskId', { ...signedIn, schema: { params: manualTaskParamSchema } }, async (request) => ({
    success: true,
    data: await service.getManualTask(request.hotelId, permissions(request), request.params.taskId),
  }));

  app.post('/:taskId/claim', { ...signedIn, schema: { params: manualTaskParamSchema } }, async (request) => ({
    success: true,
    data: await service.claimManualTask(request.hotelId, permissions(request), request.params.taskId),
  }));

  app.post('/:taskId/release', { ...signedIn, schema: { params: manualTaskParamSchema } }, async (request) => ({
    success: true,
    data: await service.releaseManualTask(request.hotelId, permissions(request), request.params.taskId),
  }));

  app.post(
    '/:taskId/complete',
    { ...signedIn, schema: { params: manualTaskParamSchema, body: completeManualTaskSchema } },
    async (request) => ({
      success: true,
      data: await service.completeManualTask(request.hotelId, permissions(request), request.params.taskId, request.body ?? {}),
    }),
  );

  app.post(
    '/:taskId/cancel',
    { ...signedIn, schema: { params: manualTaskParamSchema, body: cancelManualTaskSchema } },
    async (request) => ({
      success: true,
      data: await service.cancelManualTask(request.hotelId, permissions(request), request.params.taskId, request.body),
    }),
  );
}
