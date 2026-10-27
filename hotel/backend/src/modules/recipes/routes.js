import {
  createRecipeSchema,
  createStockItemSchema,
  menuItemPickerQuerySchema,
  recipeListQuerySchema,
  recipeParamSchema,
  recipePickerQuerySchema,
  recipePreviewSchema,
  stockItemListQuerySchema,
  stockItemParamSchema,
  updateRecipeSchema,
  updateStockItemSchema,
} from '@hotelos/hotel-contracts';
import { PERMISSIONS, requireAnyPermission, requirePermission } from '../../lib/permissions.js';
import { withHotelContext } from '../../lib/tenant.js';
import * as recipes from './recipes.js';
import * as stockItems from './stock-items.js';

/**
 * Reçete ve malzeme kartı route'ları (modül 38'in reçete kısmı — modül 43), `/recipes` altında.
 *
 * - Görmek (reçeteler, malzemeler, maliyet ve kâr marjı): `recipes.view` (müdür, F&B, muhasebe).
 * - Reçete / malzeme yazmak, maliyet önizlemesi, menü ürünü seçici: `recipes.manage`.
 * - Reçete seçici banket menüsünü kuranlara da açık (`banquet.manage` / `banquet.setup`):
 *   yemek adı, istasyon, alerjen döner; maliyet yalnızca `recipes.view` olana.
 *
 * Listeler sayfalı; seçiciler `MAX_PICKER_RESULTS` ile sınırlı.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export async function recipeRoutes(app) {
  const guard = (permission) => ({ preHandler: [withHotelContext, requirePermission(permission)] });
  const view = guard(PERMISSIONS.RECIPES_VIEW);
  const manage = guard(PERMISSIONS.RECIPES_MANAGE);
  const pick = { preHandler: [withHotelContext, requireAnyPermission(PERMISSIONS.RECIPES_VIEW, PERMISSIONS.BANQUET_MANAGE, PERMISSIONS.BANQUET_SETUP)] };
  const canSeeCost = (request) => Boolean(request.auth?.permissions?.includes(PERMISSIONS.RECIPES_VIEW));
  const ok = (data) => ({ success: true, data });

  /* ── Malzeme kartları ── */

  app.get('/stock-items', { ...view, schema: { querystring: stockItemListQuerySchema } }, async (request) =>
    ok(await stockItems.listStockItems(request.hotelId, request.query)),
  );

  app.get('/stock-items/:stockItemId', { ...view, schema: { params: stockItemParamSchema } }, async (request) =>
    ok(await stockItems.getStockItem(request.hotelId, request.params.stockItemId)),
  );

  app.post('/stock-items', { ...manage, schema: { body: createStockItemSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await stockItems.createStockItem(request.hotelId, request.body))),
  );

  app.put('/stock-items/:stockItemId', { ...manage, schema: { params: stockItemParamSchema, body: updateStockItemSchema } }, async (request) =>
    ok(await stockItems.updateStockItem(request.hotelId, request.params.stockItemId, request.body)),
  );

  /* ── Reçeteler ── */

  app.get('/', { ...view, schema: { querystring: recipeListQuerySchema } }, async (request) => ok(await recipes.listRecipes(request.hotelId, request.query)));

  app.get('/picker', { ...pick, schema: { querystring: recipePickerQuerySchema } }, async (request) =>
    ok(await recipes.pickRecipes(request.hotelId, request.query, { withCost: canSeeCost(request) })),
  );

  app.get('/menu-items', { ...manage, schema: { querystring: menuItemPickerQuerySchema } }, async (request) =>
    ok(await recipes.pickMenuItems(request.hotelId, request.query)),
  );

  app.post('/preview', { ...manage, schema: { body: recipePreviewSchema } }, async (request) => ok(await recipes.previewRecipe(request.hotelId, request.body)));

  app.get('/:recipeId', { ...view, schema: { params: recipeParamSchema } }, async (request) => ok(await recipes.getRecipe(request.hotelId, request.params.recipeId)));

  app.post('/', { ...manage, schema: { body: createRecipeSchema } }, async (request, reply) =>
    reply.status(201).send(ok(await recipes.createRecipe(request.hotelId, request.body))),
  );

  app.put('/:recipeId', { ...manage, schema: { params: recipeParamSchema, body: updateRecipeSchema } }, async (request) =>
    ok(await recipes.updateRecipe(request.hotelId, request.params.recipeId, request.body)),
  );
}
