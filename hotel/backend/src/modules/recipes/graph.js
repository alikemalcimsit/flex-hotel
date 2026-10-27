import { toDecimal, toMoneyString } from '@hotelos/core';
import { MAX_RECIPE_DEPTH } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';

/**
 * Reçete grafiğinin yüklenmesi ve ortak biçimler (modül 43).
 *
 * Grafik **seviye seviye** yüklenir: kök reçeteler, sonra onların ara reçeteleri… (derinlik
 * en fazla `MAX_RECIPE_DEPTH`; seviye başına reçete ve satır sorgusu, N+1 yok), ardından satırlardaki
 * malzemeler tek sorguda. Sorgular düz SQL'dir (ondalıklar metin): ölçümde 2.800 reçetelik grafiği
 * Prisma'nın iç içe sonuç kurulumu ~0,6 sn'de, düz sorgu onda birinde yükledi. Kural fonksiyonları
 * (`rules.js`) bu haritalarla çalışır.
 */

export { prisma };

/** @param {any} row reçete satırı (düz SQL) @param {any[]} lines */
const recipeNode = (row, lines) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  kind: row.kind,
  station: row.station,
  yieldQuantity: row.yieldQuantity,
  yieldUnit: row.yieldUnit,
  leadMinutes: row.leadMinutes,
  isActive: row.isActive,
  lines,
});

/**
 * Bir seviyenin reçeteleri ve satırları (iki sorgu, paralel; satırlar otelin reçetelerine bağlı).
 * @param {any} client @param {string} hotelId @param {string[]} ids
 */
async function loadLevel(client, hotelId, ids) {
  const [rows, lines] = await Promise.all([
    client.$queryRaw`
      SELECT "id", "code", "name", "kind"::text AS "kind", "station"::text AS "station", "yieldQuantity"::text AS "yieldQuantity",
             "yieldUnit"::text AS "yieldUnit", "leadMinutes", "isActive"
      FROM "Recipe" WHERE "hotelId" = ${hotelId} AND "id" = ANY(${ids}::text[])`,
    client.$queryRaw`
      SELECT l."recipeId", l."stockItemId", l."subRecipeId", l."quantity"::text AS "quantity", l."unit"::text AS "unit",
             l."wastePct"::text AS "wastePct", l."note"
      FROM "RecipeLine" l JOIN "Recipe" r ON r."id" = l."recipeId"
      WHERE r."hotelId" = ${hotelId} AND l."recipeId" = ANY(${ids}::text[])
      ORDER BY l."recipeId", l."sortOrder"`,
  ]);
  /** @type {Map<string, any[]>} */
  const byRecipe = new Map();
  for (const { recipeId, ...line } of lines) {
    if (!byRecipe.has(recipeId)) byRecipe.set(recipeId, []);
    byRecipe.get(recipeId).push(line);
  }
  return rows.map((row) => recipeNode(row, byRecipe.get(row.id) ?? []));
}

/** @param {any} row */
export const stockNode = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  group: row.group,
  unit: row.unit,
  unitCost: String(row.unitCost),
  allergens: row.allergens ?? [],
  isActive: row.isActive,
});

/**
 * Köklerden başlayarak reçeteleri ve kullandıkları malzemeleri yükler.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {Iterable<string>} rootIds
 * @param {{ stockItemIds?: Iterable<string>, stopAt?: string | null }} [extra] grafikte olmasa da yüklenecek
 *   malzemeler (önizleme); `stopAt`: altı açılmayan reçete (kaydedilen reçetenin kendisi — döngü denetimi onu
 *   ara reçetelerin altında arar, eski satırlarıyla dolaşmaz)
 * @returns {Promise<{ recipes: Map<string, any>, stockItems: Map<string, any> }>}
 */
export async function loadRecipeGraph(client, hotelId, rootIds, extra = {}) {
  /** @type {Map<string, any>} */
  const recipes = new Map();
  let frontier = [...new Set([...rootIds].filter(Boolean))];
  // Kök + en fazla MAX_RECIPE_DEPTH alt seviye; fazlası bozuk veri (döngü) demektir, yükleme durur.
  for (let level = 0; frontier.length > 0 && level <= MAX_RECIPE_DEPTH; level += 1) {
    const rows = await loadLevel(client, hotelId, frontier);
    for (const row of rows) recipes.set(row.id, row);
    frontier = [
      ...new Set(
        rows
          .filter((row) => row.id !== extra.stopAt)
          .flatMap((row) => row.lines.map((line) => line.subRecipeId))
          .filter((id) => id && !recipes.has(id)),
      ),
    ];
  }
  if (frontier.length > 0) throw new RangeError(`Reçete grafiği ${MAX_RECIPE_DEPTH} seviyeden derin (döngü olabilir)`);

  const stockIds = new Set(extra.stockItemIds ?? []);
  for (const recipe of recipes.values()) for (const line of recipe.lines) if (line.stockItemId) stockIds.add(line.stockItemId);
  const stockRows = stockIds.size
    ? await client.$queryRaw`
        SELECT "id", "code", "name", "group"::text AS "group", "unit"::text AS "unit", "unitCost"::text AS "unitCost", "allergens", "isActive"
        FROM "StockItem" WHERE "hotelId" = ${hotelId} AND "id" = ANY(${[...stockIds]}::text[])`
    : [];
  return { recipes, stockItems: new Map(stockRows.map((row) => [row.id, stockNode(row)])) };
}

/**
 * Reçeteyi ara reçete olarak kullananların (yukarı doğru) haritası: reçete → onu kullananlar.
 * Seviye başına tek sorgu; derinlik sınırıyla durur.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} recipeId
 */
export async function loadParents(tx, hotelId, recipeId) {
  /** @type {Map<string, Set<string>>} */
  const parents = new Map();
  let frontier = [recipeId];
  const seen = new Set(frontier);
  for (let level = 0; frontier.length > 0 && level <= MAX_RECIPE_DEPTH; level += 1) {
    const rows = await tx.recipeLine.findMany({ where: { hotelId, subRecipeId: { in: frontier } }, select: { recipeId: true, subRecipeId: true } });
    const next = [];
    for (const row of rows) {
      if (!parents.has(row.subRecipeId)) parents.set(row.subRecipeId, new Set());
      parents.get(row.subRecipeId).add(row.recipeId);
      if (!seen.has(row.recipeId)) {
        seen.add(row.recipeId);
        next.push(row.recipeId);
      }
    }
    frontier = next;
  }
  return parents;
}

/** Ad tekilliği denetlenen tablolar (ham SQL'e yalnızca bu sabitler girer). */
const NAMED_TABLES = Object.freeze(['StockItem', 'Recipe', 'BanquetMenu']);

/**
 * Ad otel içinde harf duyarsız alınmış mı? `lower(ad) = lower($)` — Prisma'nın "insensitive
 * equals"ı ILIKE'tır ve `%` / `_` joker olur ("%" adlı kayıt her adı "alınmış" gösterirdi).
 * Son savunma veritabanındaki `lower("name")` tekil index'idir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {'StockItem' | 'Recipe' | 'BanquetMenu'} table
 * @param {string} hotelId
 * @param {string} name
 * @param {string | null} [exceptId]
 */
export async function nameTaken(client, table, hotelId, name, exceptId = null) {
  if (!NAMED_TABLES.includes(table)) throw new Error(`Bilinmeyen tablo: ${table}`);
  const rows = await client.$queryRawUnsafe(
    `SELECT id FROM "${table}" WHERE "hotelId" = $1 AND lower("name") = lower($2) AND ($3::text IS NULL OR id <> $3) LIMIT 1`,
    hotelId,
    name,
    exceptId,
  );
  return rows.length > 0;
}

/** Miktar metni (sondaki sıfırlar atılmış): "1.2500" → "1.25". @param {any} value */
export const quantityText = (value) => toDecimal(String(value ?? 0)).toString();
/** Birim maliyet metni (4 ondalık). @param {any} value */
export const unitCostText = (value) => toDecimal(String(value ?? 0)).toFixed(4);
/** Para metni (2 ondalık, yarım yukarı). @param {any} value */
export const moneyText = (value) => toMoneyString(toDecimal(value ?? 0));
/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
