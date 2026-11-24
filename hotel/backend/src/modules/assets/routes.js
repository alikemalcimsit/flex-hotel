import {
  assetAreaSchema,
  assetCategorySchema,
  assetCodeParamSchema,
  assetCountListQuerySchema,
  assetLabelQuerySchema,
  assetListFlagsSchema,
  assetListQuerySchema,
  assetWarrantyQuerySchema,
  assignAssetSchema,
  cancelAssetCountSchema,
  closeAssetCountSchema,
  createAssetCountSchema,
  createAssetSchema,
  depreciationYearQuerySchema,
  depreciationYearSchema,
  disposeAssetSchema,
  idParamSchema,
  importAssetsSchema,
  returnAssetSchema,
  scanAssetCountSchema,
  transferAssetSchema,
  updateAssetAreaSchema,
  updateAssetCategorySchema,
  updateAssetSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import { assetLabels, findAssetByCode, getAsset, listAssets } from './assets-read.js';
import { assignAsset, createAsset, disposeAsset, returnAsset, transferAsset, updateAsset } from './assets.js';
import { cancelCount, closeCount, createCount, getCount, listCounts, scanCount } from './counts.js';
import { createArea, createCategory, getAssetOptions, listAreas, listCategories, updateArea, updateCategory } from './definitions.js';
import { getDepreciationTable, postDepreciation, reverseDepreciation } from './depreciation.js';
import { importAssets } from './import.js';
import { listWarranty } from './warranty.js';

/** Excel yüklemesinin gövde sınırı (1000 satır × 16 hücre). */
const IMPORT_BODY_LIMIT = 4 * 1024 * 1024;

/**
 * Demirbaş ve amortisman route'ları (modül 46), `/assets` altında.
 *
 * - Görmek (liste, kart, amortisman tablosu, garanti, tanımlar): `assets.view`.
 * - Sayım ekranı ve okutma: `assets.count` (form seçenekleri `assets.view` ya da `assets.count`).
 * - Kart aç / düzelt / taşı / zimmet, Excel, etiket, sayım aç / kapat, tanımlar: `assets.manage`.
 * - Yıl amortismanını kaydet / geri al, elden çıkar: `assets.finance`.
 *
 * Sabit yollar (`/categories`, `/counts`…) `/:id`'den önce tanımlıdır.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function assetRoutes(app) {
  const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.ASSETS_VIEW);
  const count = guard(PERMISSIONS.ASSETS_COUNT);
  const manage = guard(PERMISSIONS.ASSETS_MANAGE);
  const finance = guard(PERMISSIONS.ASSETS_FINANCE);
  const ok = (data) => ({ success: true, data });
  const created = (reply, data) => {
    reply.code(201);
    return ok(data);
  };

  /* ── Tanımlar ── */
  app.get('/categories', { ...view, schema: { querystring: assetListFlagsSchema } }, async (req) => ok(await listCategories(req.hotelId, req.query)));
  app.post('/categories', { ...manage, schema: { body: assetCategorySchema } }, async (req, reply) => created(reply, await createCategory(req.hotelId, req.body)));
  app.patch('/categories/:id', { ...manage, schema: { params: idParamSchema, body: updateAssetCategorySchema } }, async (req) => ok(await updateCategory(req.hotelId, req.params.id, req.body)));
  app.get('/areas', { ...view, schema: { querystring: assetListFlagsSchema } }, async (req) => ok(await listAreas(req.hotelId, req.query)));
  app.post('/areas', { ...manage, schema: { body: assetAreaSchema } }, async (req, reply) => created(reply, await createArea(req.hotelId, req.body)));
  app.patch('/areas/:id', { ...manage, schema: { params: idParamSchema, body: updateAssetAreaSchema } }, async (req) => ok(await updateArea(req.hotelId, req.params.id, req.body)));
  // Sayım ekranının "şu an buradayım" listesi de buradan: yalnız sayım yetkisi olan da okur.
  const viewOrCount = { preValidation: [withHotelContext, requireAnyPermission(PERMISSIONS.ASSETS_VIEW, PERMISSIONS.ASSETS_COUNT)] };
  app.get('/options', viewOrCount, async (req) => ok(await getAssetOptions(req.hotelId)));

  /* ── Sayım ── */
  app.get('/counts', { ...count, schema: { querystring: assetCountListQuerySchema } }, async (req) => ok(await listCounts(req.hotelId, req.query)));
  app.post('/counts', { ...manage, schema: { body: createAssetCountSchema } }, async (req, reply) => created(reply, await createCount(req.hotelId, req.body)));
  app.get('/counts/:id', { ...count, schema: { params: idParamSchema } }, async (req) => ok(await getCount(req.hotelId, req.params.id)));
  app.post('/counts/:id/scan', { ...count, schema: { params: idParamSchema, body: scanAssetCountSchema } }, async (req) => ok(await scanCount(req.hotelId, req.params.id, req.body)));
  app.post('/counts/:id/close', { ...manage, schema: { params: idParamSchema, body: closeAssetCountSchema } }, async (req) => ok(await closeCount(req.hotelId, req.params.id, req.body)));
  app.post('/counts/:id/cancel', { ...manage, schema: { params: idParamSchema, body: cancelAssetCountSchema } }, async (req) => ok(await cancelCount(req.hotelId, req.params.id, req.body)));

  /* ── Amortisman ve garanti ── */
  app.get('/depreciation', { ...view, schema: { querystring: depreciationYearQuerySchema } }, async (req) => ok(await getDepreciationTable(req.hotelId, req.query.year)));
  app.post('/depreciation/post', { ...finance, schema: { body: depreciationYearSchema } }, async (req) => ok(await postDepreciation(req.hotelId, req.body)));
  app.post('/depreciation/reverse', { ...finance, schema: { body: depreciationYearSchema } }, async (req) => ok(await reverseDepreciation(req.hotelId, req.body)));
  app.get('/warranty', { ...view, schema: { querystring: assetWarrantyQuerySchema } }, async (req) => ok(await listWarranty(req.hotelId, req.query)));

  /* ── Kartlar ── */
  app.get('/', { ...view, schema: { querystring: assetListQuerySchema } }, async (req) => ok(await listAssets(req.hotelId, req.query)));
  app.post('/', { ...manage, schema: { body: createAssetSchema } }, async (req, reply) => created(reply, await createAsset(req.hotelId, req.body)));
  app.post('/import', { ...manage, bodyLimit: IMPORT_BODY_LIMIT, schema: { body: importAssetsSchema } }, async (req) => ok(await importAssets(req.hotelId, req.body)));
  app.get('/labels', { ...manage, schema: { querystring: assetLabelQuerySchema } }, async (req) => ok(await assetLabels(req.hotelId, req.query.ids)));
  app.get('/by-code/:code', { ...view, schema: { params: assetCodeParamSchema } }, async (req) => ok(await findAssetByCode(req.hotelId, req.params.code)));
  app.get('/:id', { ...view, schema: { params: idParamSchema } }, async (req) => ok(await getAsset(req.hotelId, req.params.id)));
  app.patch('/:id', { ...manage, schema: { params: idParamSchema, body: updateAssetSchema } }, async (req) => ok(await updateAsset(req.hotelId, req.params.id, req.body)));
  app.post('/:id/transfer', { ...manage, schema: { params: idParamSchema, body: transferAssetSchema } }, async (req) => ok(await transferAsset(req.hotelId, req.params.id, req.body)));
  app.post('/:id/assign', { ...manage, schema: { params: idParamSchema, body: assignAssetSchema } }, async (req) => ok(await assignAsset(req.hotelId, req.params.id, req.body)));
  app.post('/:id/return', { ...manage, schema: { params: idParamSchema, body: returnAssetSchema } }, async (req) => ok(await returnAsset(req.hotelId, req.params.id, req.body)));
  app.post('/:id/dispose', { ...finance, schema: { params: idParamSchema, body: disposeAssetSchema } }, async (req) => ok(await disposeAsset(req.hotelId, req.params.id, req.body)));
}
