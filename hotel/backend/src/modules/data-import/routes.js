import { dataImportParamSchema, dataImportSchema } from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { listImports, runImport } from './service.js';

/** Excel yüklemesinin gövde sınırı (2000 satır × 10 hücre). */
const IMPORT_BODY_LIMIT = 4 * 1024 * 1024;

/**
 * Excel'den toplu yükleme route'ları (modül 26), `/imports` altında: misafir listesi (`guests.manage`) ve fiyat planı
 * (`settings.manage`). Türün yetkisi serviste denetlenir.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function dataImportRoutes(app) {
  const any = { preValidation: [withHotelContext, requireAnyPermission(PERMISSIONS.GUESTS_MANAGE, PERMISSIONS.SETTINGS_MANAGE)] };
  const ok = (data) => ({ success: true, data });

  app.get('/', any, async (req) => ok(await listImports(req.hotelId, req.auth.permissions)));
  app.post('/:kind', { ...any, bodyLimit: IMPORT_BODY_LIMIT, schema: { params: dataImportParamSchema, body: dataImportSchema } }, async (req) =>
    ok(await runImport(req.hotelId, req.auth.permissions, req.params.kind, req.body)),
  );
}
