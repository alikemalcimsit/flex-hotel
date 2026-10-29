import { currentActor, toDecimal } from '@hotelos/core';
import { FNB_PLANNED_STATUSES, KITCHEN_UNIT_LABELS, MAX_NEEDS_MENUS, MAX_REQUEST_LINES, PURCHASE_REQUEST_PREFIX, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockEvents, lockPurchaseRequests } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText, matchStockItemIds, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { computeMenus, loadPlanMenus, needEntries, requestedQuantities } from '../banquet/fnb-read.js';
import { aggregateNeeds } from '../banquet/fnb-rules.js';
import { hotelContext, loadEventSettings, prisma } from '../banquet/shared.js';
import { iso, moneyText, quantityText, unitCostText } from '../recipes/graph.js';
import { allocateRequest } from '../recipes/rules.js';
import { stockSuggestion } from './rules.js';

/**
 * Satın alma talebi (modül 43'te kuruldu, 45'te tamamlandı).
 *
 * Kaynaklar: banket ihtiyacı (43), elle talep ve minimum stok önerisi (45). Talep satırları teklif
 * turunda malzeme başına birleşir; talebin durumu satırlarından türer (açık → teklif / siparişte →
 * siparişe döndü). Yalnız açık talep iptal edilir.
 *
 * ### Banket ihtiyacından talep
 *
 * Ekran malzeme başına bir satır gönderir (miktar + gördüğü eksik). Sunucu:
 * 1. Kapsamdaki etkinlikleri (tek etkinlik ya da servis günü aralığına menüsü düşen kesin
 *    etkinlikler) **kimlik sırasıyla kilitler** — menü / kişi / kalem değiştiren işlemler ve
 *    aynı eksiği talep eden ikinci kişi sıraya girer.
 * 2. Kilit altında eksiği yeniden hesaplar; ekranın gördüğüyle tutmazsa talep açılmaz
 *    (`NEEDS_CHANGED`): iki kişi aynı eksiği iki kez talep edemez.
 * 3. Miktarı etkinliklerin eksiğine ihtiyaç gününe göre dağıtır (fazlası en erken ihtiyaca);
 *    satır = malzeme × etkinlik, birim maliyet talep anının kopyası.
 *
 * ### Minimum stok önerisi
 *
 * Minimum seviyesi tanımlı malzemede öneri = minimum − (eldeki + yoldaki siparişler + henüz siparişe
 * dönmemiş elle / stok talepleri). Banket talepleri etkinlik tüketimi içindir, öneriden düşülmez;
 * banket siparişleri ise yoldaki mal sayılır (eksik kapanırsa öneri yeniden çıkar).
 */

/** Tam sayı birimler (adet, gram, mililitre): talep miktarı küsuratlı olamaz. */
const WHOLE_UNITS = Object.freeze(['PIECE', 'G', 'ML']);

const LIST_SELECT = Object.freeze({
  id: true,
  number: true,
  status: true,
  source: true,
  neededBy: true,
  note: true,
  requestedBy: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {Date} value */
const dayText = (value) => value.toISOString().slice(0, 10);
/** @param {string} text */
const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);

/** @param {any} row @param {{ lines: number, items: number, events: number, estimatedTotal: string } | undefined} stats */
const toListDto = (row, stats) => ({
  id: row.id,
  number: row.number,
  status: row.status,
  source: row.source,
  neededBy: dayText(row.neededBy),
  note: row.note,
  requestedBy: row.requestedBy,
  createdAt: iso(row.createdAt),
  cancelledAt: iso(row.cancelledAt),
  cancelledBy: row.cancelledBy,
  cancelReason: row.cancelReason,
  updatedAt: iso(row.updatedAt),
  lines: stats?.lines ?? 0,
  items: stats?.items ?? 0,
  events: stats?.events ?? 0,
  estimatedTotal: moneyText(stats?.estimatedTotal ?? 0),
});

/**
 * Sıradaki talep numarası (otel × tür × yıl): tek ifadede artırılır.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {number} year
 */
async function nextRequestNumber(tx, hotelId, year) {
  const [row] = await tx.$queryRaw`
    INSERT INTO "PurchaseSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, ${PURCHASE_REQUEST_PREFIX}, ${year}, 1)
    ON CONFLICT ("hotelId", "kind", "year") DO UPDATE SET "last" = "PurchaseSequence"."last" + 1
    RETURNING "last"`;
  return `${PURCHASE_REQUEST_PREFIX}-${year}-${String(row.last).padStart(4, '0')}`;
}

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, status?: string, search?: string, eventId?: string, from?: string, to?: string }} query
 */
export async function listRequests(hotelId, query) {
  /** @type {Record<string, any>} */
  const where = { hotelId };
  if (query.status) where.status = query.status;
  if (query.source) where.source = query.source;
  if (query.eventId) where.lines = { some: { eventId: query.eventId } };
  if (query.from || query.to) where.neededBy = { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) };
  // Malzeme önce kendi trigram index'iyle bulunur, talep kimlikle süzülür (talep başına satır taranmaz).
  const tokens = searchTokens(query.search);
  if (tokens.length) {
    const items = await Promise.all(tokens.map((token) => matchStockItemIds(prisma, hotelId, token)));
    where.AND = tokens.map((token, index) => ({ OR: [{ number: containsText(token) }, ...(items[index].length ? [{ lines: { some: { stockItemId: { in: items[index] } } } }] : [])] }));
  }
  const [rows, total] = await Promise.all([
    prisma.purchaseRequest.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query), select: LIST_SELECT }),
    prisma.purchaseRequest.count({ where }),
  ]);
  const ids = rows.map((row) => row.id);
  const stats = ids.length
    ? await prisma.$queryRaw`
        SELECT "requestId", COUNT(*)::int AS "lines", COUNT(DISTINCT "stockItemId")::int AS "items", COUNT(DISTINCT "eventId")::int AS "events",
               SUM("quantity" * "estimatedUnitCost")::text AS "estimatedTotal"
        FROM "PurchaseRequestLine" WHERE "requestId" = ANY(${ids}::text[]) GROUP BY "requestId"`
    : [];
  const byId = new Map(stats.map((row) => [row.requestId, row]));
  return buildPage(
    rows.map((row) => toListDto(row, byId.get(row.id))),
    total,
    query,
  );
}

/**
 * Talep ekranı: satırlar malzeme başına toplanır, altında etkinlik dökümü.
 * @param {string} hotelId @param {string} requestId
 */
export async function getRequest(hotelId, requestId) {
  const row = await prisma.purchaseRequest.findFirst({
    where: { id: requestId, hotelId },
    select: {
      ...LIST_SELECT,
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          stockItemId: true,
          quantity: true,
          unit: true,
          neededBy: true,
          estimatedUnitCost: true,
          eventId: true,
          stockItem: { select: { code: true, name: true, group: true } },
          event: { select: { code: true, name: true, status: true } },
          roundLine: { select: { round: { select: { id: true, number: true, status: true } }, orderLine: { select: { order: { select: { id: true, number: true, status: true } } } } } },
        },
      },
    },
  });
  if (!row) throw new NotFoundError('Talep bulunamadı');
  /** @type {Map<string, any>} */
  const items = new Map();
  let total = toDecimal(0);
  for (const line of row.lines) {
    const quantity = toDecimal(String(line.quantity));
    const cost = quantity.times(toDecimal(String(line.estimatedUnitCost)));
    total = total.plus(cost);
    let item = items.get(line.stockItemId);
    if (!item) {
      item = { stockItemId: line.stockItemId, code: line.stockItem.code, name: line.stockItem.name, group: line.stockItem.group, unit: line.unit, unitCost: unitCostText(line.estimatedUnitCost), quantity: toDecimal(0), cost: toDecimal(0), neededBy: dayText(line.neededBy), events: [], rounds: new Map(), orders: new Map() };
      items.set(line.stockItemId, item);
    }
    // Zincir: satırın teklif turu ve (varsa) siparişi.
    const round = line.roundLine?.round;
    if (round) item.rounds.set(round.id, round);
    const order = line.roundLine?.orderLine?.order;
    if (order) item.orders.set(order.id, order);
    item.quantity = item.quantity.plus(quantity);
    item.cost = item.cost.plus(cost);
    if (dayText(line.neededBy) < item.neededBy) item.neededBy = dayText(line.neededBy);
    item.events.push({ eventId: line.eventId, code: line.event?.code ?? null, name: line.event?.name ?? null, status: line.event?.status ?? null, quantity: quantityText(line.quantity), neededBy: dayText(line.neededBy) });
  }
  return {
    ...toListDto(row, { lines: row.lines.length, items: items.size, events: new Set(row.lines.map((line) => line.eventId).filter(Boolean)).size, estimatedTotal: total.toString() }),
    items: [...items.values()].map((item) => ({ ...item, quantity: item.quantity.toString(), cost: moneyText(item.cost), rounds: [...item.rounds.values()], orders: [...item.orders.values()] })),
  };
}

/**
 * Elle talep ya da minimum stok önerisinden talep: malzeme, miktar (stok biriminde), ihtiyaç günü.
 * @param {string} hotelId
 * @param {{ source: 'MANUAL' | 'STOCK', neededBy: string, note?: string | null, lines: Array<{ stockItemId: string, quantity: string, neededBy?: string | null }> }} input
 */
export async function createRequest(hotelId, input) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  /** @type {Record<string, string>} */
  const dayFields = {};
  if (input.neededBy < today) dayFields.neededBy = 'İhtiyaç günü bugünden önce olamaz';
  input.lines.forEach((line, index) => {
    if (line.neededBy && line.neededBy < today) dayFields[`lines.${index}.neededBy`] = 'İhtiyaç günü bugünden önce olamaz';
  });
  if (Object.keys(dayFields).length) throw new ValidationError(`Talepte düzeltilmesi gereken alanlar var: ${Object.values(dayFields)[0]}`, { fields: dayFields });
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      const stockItems = await tx.stockItem.findMany({
        where: { hotelId, id: { in: input.lines.map((line) => line.stockItemId) } },
        select: { id: true, name: true, unit: true, unitCost: true, isActive: true },
      });
      const byId = new Map(stockItems.map((item) => [item.id, item]));
      /** @type {Record<string, string>} */
      const fields = {};
      input.lines.forEach((line, index) => {
        const item = byId.get(line.stockItemId);
        if (!item) fields[`lines.${index}.stockItemId`] = 'Malzeme bulunamadı';
        else if (!item.isActive) fields[`lines.${index}.stockItemId`] = `${item.name} pasif`;
        else if (WHOLE_UNITS.includes(item.unit) && !toDecimal(line.quantity).isInteger()) fields[`lines.${index}.quantity`] = `${item.name}: ${KITCHEN_UNIT_LABELS[item.unit]} tam sayı olmalı`;
      });
      const messages = Object.values(fields);
      if (messages.length) throw new ValidationError(`Talepte düzeltilmesi gereken satırlar var: ${messages[0]}${messages.length > 1 ? ` (+${messages.length - 1})` : ''}`, { fields });

      const lines = input.lines.map((line) => ({ ...line, neededBy: line.neededBy ?? input.neededBy, item: byId.get(line.stockItemId) }));
      const neededBy = lines.reduce((min, line) => (line.neededBy < min ? line.neededBy : min), lines[0].neededBy);
      const number = await nextRequestNumber(tx, hotelId, Number(today.slice(0, 4)));
      const request = await tx.purchaseRequest.create({
        data: { hotelId, number, status: 'OPEN', source: input.source, neededBy: dateOnly(neededBy), note: input.note ?? null, requestedBy: actor },
        select: { id: true },
      });
      await tx.purchaseRequestLine.createMany({
        data: lines.map((line, index) => ({
          hotelId,
          requestId: request.id,
          stockItemId: line.item.id,
          quantity: line.quantity,
          unit: line.item.unit,
          neededBy: dateOnly(line.neededBy),
          eventId: null,
          estimatedUnitCost: line.item.unitCost,
          sortOrder: index,
        })),
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'PurchaseRequest',
        entityId: request.id,
        action: 'CREATE',
        after: { number, source: input.source, neededBy, lines: lines.slice(0, 40).map((line) => `${line.item.name} ${quantityText(line.quantity)}`) },
      });
      await stage('purchase.request.changed', { hotelId, requestId: request.id, change: 'CREATED', source: input.source });
      return request.id;
    });
    return getRequest(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Minimum seviyenin altına düşen (yoldaki ve talep edilen düşüldükten sonra) malzemeler; en kritik önce
 * (eldeki ÷ minimum küçükten büyüğe).
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, group?: string, search?: string }} query
 */
export async function listSuggestions(hotelId, query) {
  const filters = [Prisma.sql`s."hotelId" = ${hotelId}`, Prisma.sql`s."isActive"`, Prisma.sql`s."minLevel" IS NOT NULL`];
  if (query.group) filters.push(Prisma.sql`s."group"::text = ${query.group}`);
  const tokens = searchTokens(query.search);
  if (tokens.length) {
    const lists = await Promise.all(tokens.map((token) => matchStockItemIds(prisma, hotelId, token)));
    const ids = lists[0].filter((id) => lists.every((list) => list.includes(id)));
    if (ids.length === 0) return buildPage([], 0, query);
    filters.push(Prisma.sql`s."id" = ANY(${ids}::text[])`);
  }
  // Malzeme başına bir kez toplanır: yoldaki = açık siparişlerin kalanı (açık sipariş durum index'inden),
  // talep edilen = siparişe dönmemiş elle / stok talepleri (önce talep süzülür; banket satırları taranmaz).
  const gaps = Prisma.sql`
    WITH "tracked" AS MATERIALIZED (
      SELECT s."id", s."code", s."name", s."group"::text AS "group", s."unit"::text AS "unit", s."onHand", s."minLevel", s."unitCost"
      FROM "StockItem" s WHERE ${Prisma.join(filters, ' AND ')}
    ), "ordered" AS (
      SELECT ol."stockItemId", SUM(GREATEST(ol."quantity" - ol."receivedQuantity", 0)) AS "quantity"
      FROM "PurchaseOrder" o JOIN "PurchaseOrderLine" ol ON ol."orderId" = o."id"
      WHERE o."hotelId" = ${hotelId} AND o."status"::text IN ('PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED') AND ol."stockItemId" IN (SELECT "id" FROM "tracked")
      GROUP BY ol."stockItemId"
    ), "requested" AS (
      SELECT rl."stockItemId", SUM(rl."quantity") AS "quantity"
      FROM "PurchaseRequest" r JOIN "PurchaseRequestLine" rl ON rl."requestId" = r."id"
      LEFT JOIN "PurchaseRoundLine" pl ON pl."id" = rl."roundLineId"
      WHERE r."hotelId" = ${hotelId} AND r."status"::text IN ('OPEN', 'IN_PROGRESS') AND r."source"::text IN ('MANUAL', 'STOCK')
        AND pl."orderLineId" IS NULL AND rl."stockItemId" IN (SELECT "id" FROM "tracked")
      GROUP BY rl."stockItemId"
    )
    SELECT t.*, COALESCE(o."quantity", 0) AS "onOrder", COALESCE(q."quantity", 0) AS "requested"
    FROM "tracked" t LEFT JOIN "ordered" o ON o."stockItemId" = t."id" LEFT JOIN "requested" q ON q."stockItemId" = t."id"
    WHERE t."minLevel" - t."onHand" - COALESCE(o."quantity", 0) - COALESCE(q."quantity", 0) > 0`;
  const { skip, take } = toSkipTake(query);
  const rows = await prisma.$queryRaw`
    SELECT "id", "code", "name", "group", "unit", "onHand"::text AS "onHand", "minLevel"::text AS "minLevel", "unitCost"::text AS "unitCost",
           "onOrder"::text AS "onOrder", "requested"::text AS "requested", COUNT(*) OVER ()::int AS "total"
    FROM (${gaps}) g
    ORDER BY ("onHand" / NULLIF("minLevel", 0)) ASC NULLS FIRST, "name", "id"
    LIMIT ${take} OFFSET ${skip}`;
  // Son sayfanın ötesi istenirse pencere sayımı gelmez: toplam ayrıca sayılır.
  const total = rows.length ? rows[0].total : skip > 0 ? (await prisma.$queryRaw`SELECT COUNT(*)::int AS "total" FROM (${gaps}) g`)[0].total : 0;
  return buildPage(
    rows.map((row) => {
      const suggested = stockSuggestion({ minLevel: row.minLevel, onHand: row.onHand, onOrder: row.onOrder, requested: row.requested, unit: row.unit });
      return {
        id: row.id,
        stockItemId: row.id,
        code: row.code,
        name: row.name,
        group: row.group,
        unit: row.unit,
        onHand: quantityText(row.onHand),
        minLevel: quantityText(row.minLevel),
        onOrder: quantityText(row.onOrder),
        requested: quantityText(row.requested),
        suggested: suggested.toString(),
        unitCost: unitCostText(row.unitCost),
        estimatedTotal: moneyText(suggested.times(toDecimal(row.unitCost))),
      };
    }),
    total,
    query,
  );
}

/**
 * Banket ihtiyacından talep (kesin etkinlikler).
 *
 * @param {string} hotelId
 * @param {any} input `createBanquetPurchaseRequestSchema`
 */
export async function createFromBanquet(hotelId, input) {
  const actor = currentActor();
  const [{ timezone, today }, settings] = await Promise.all([hotelContext(hotelId), loadEventSettings(prisma, hotelId)]);
  let eventIds;
  if (input.eventId) {
    eventIds = [input.eventId];
  } else {
    const from = zonedWallTimeToUtc(`${input.from}T00:00`, timezone);
    const to = zonedWallTimeToUtc(`${new Date(Date.parse(`${input.to}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)}T00:00`, timezone);
    const rows = await prisma.eventMenu.findMany({
      where: { hotelId, serveAt: { gte: from, lt: to }, event: { status: { in: [...FNB_PLANNED_STATUSES] } } },
      distinct: ['eventId'],
      select: { eventId: true },
    });
    eventIds = rows.map((row) => row.eventId);
    if (eventIds.length === 0) throw new ConflictError('Bu aralıkta kesin etkinlik menüsü yok', 'NO_NEEDS');
  }

  try {
    const id = await writeWithEvents(async (tx, stage) => {
      const locked = await lockEvents(tx, hotelId, eventIds);
      if (input.eventId && !locked.has(input.eventId)) throw new NotFoundError('Etkinlik bulunamadı');
      // Kilit altında yeniden: durum, menü, kişi bu arada değişmiş olabilir.
      const rows = await loadPlanMenus(tx, { hotelId, eventId: { in: [...locked] }, event: { status: { in: [...FNB_PLANNED_STATUSES] } } }, MAX_NEEDS_MENUS);
      if (input.eventId && rows.length === 0) throw new ConflictError('Etkinlik kesin değil ya da menüsü yok; talep kesin etkinliğin menüsünden açılır', 'NO_NEEDS');
      const { graph, plans } = await computeMenus(tx, hotelId, rows, settings.overproductionPct);
      const requested = await requestedQuantities(tx, hotelId, [...locked]);
      const { perEvent } = aggregateNeeds(needEntries(plans, timezone), requested, new Map([...graph.stockItems.values()].map((item) => [item.id, item.unit])));

      /** @type {Record<string, string>} */
      const fields = {};
      const stale = [];
      const lines = [];
      input.lines.forEach((line, index) => {
        const stock = graph.stockItems.get(line.stockItemId);
        const entries = perEvent.filter((row) => row.planned && row.stockItemId === line.stockItemId);
        if (!stock || entries.length === 0) {
          fields[`lines.${index}.stockItemId`] = 'Bu malzeme seçili etkinliklerin menülerinde geçmiyor';
          return;
        }
        const shortfall = entries.reduce((total, row) => total.plus(row.shortfall), toDecimal(0));
        if (!shortfall.equals(toDecimal(line.expectedShortfall))) {
          stale.push(`${stock.name}: eksik ${quantityText(line.expectedShortfall)} → ${shortfall.toString()}`);
          return;
        }
        for (const share of allocateRequest(line.quantity, entries.map((row) => ({ key: row.eventId, shortfall: row.shortfall, needBy: row.needDay })))) {
          const entry = entries.find((row) => row.eventId === share.key);
          lines.push({ stockItemId: stock.id, unit: stock.unit, unitCost: stock.unitCost, eventId: share.key, quantity: share.quantity, neededBy: entry.needDay });
        }
      });
      const messages = Object.values(fields);
      if (messages.length) throw new ValidationError(`Talepte düzeltilmesi gereken satırlar var: ${messages[0]}${messages.length > 1 ? ` (+${messages.length - 1})` : ''}`, { fields });
      if (stale.length) {
        throw new ConflictError(`İhtiyaç bu arada değişti (başkası talep etti ya da menü / kişi değişti); liste yenilendi, tekrar bakın. ${stale.slice(0, 5).join(' · ')}`, 'NEEDS_CHANGED');
      }
      if (lines.length > MAX_REQUEST_LINES) throw new ValidationError(`Bir talepte en fazla ${MAX_REQUEST_LINES} satır olur (malzeme × etkinlik); aralığı ya da malzeme grubunu daraltın`);

      const neededBy = lines.reduce((min, line) => (line.neededBy < min ? line.neededBy : min), lines[0].neededBy);
      const number = await nextRequestNumber(tx, hotelId, Number(today.slice(0, 4)));
      const request = await tx.purchaseRequest.create({
        data: { hotelId, number, status: 'OPEN', source: 'BANQUET', neededBy: dateOnly(neededBy), note: input.note ?? null, requestedBy: actor },
        select: { id: true },
      });
      await tx.purchaseRequestLine.createMany({
        data: lines.map((line, index) => ({
          hotelId,
          requestId: request.id,
          stockItemId: line.stockItemId,
          quantity: line.quantity.toDecimalPlaces(3).toString(),
          unit: line.unit,
          neededBy: dateOnly(line.neededBy),
          eventId: line.eventId,
          estimatedUnitCost: line.unitCost,
          sortOrder: index,
        })),
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'PurchaseRequest',
        entityId: request.id,
        action: 'CREATE',
        after: {
          number,
          source: 'BANQUET',
          scope: input.eventId ? { eventId: input.eventId } : { from: input.from, to: input.to },
          neededBy,
          lines: input.lines.slice(0, 40).map((line) => `${graph.stockItems.get(line.stockItemId).name} ${quantityText(line.quantity)}`),
        },
      });
      await stage('purchase.request.changed', { hotelId, requestId: request.id, change: 'CREATED', source: 'BANQUET' });
      return request.id;
    });
    return getRequest(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Talebi gerekçeyle iptal eder (yalnız açık talep).
 * @param {string} hotelId @param {string} requestId @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function cancelRequest(hotelId, requestId, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockPurchaseRequests(tx, hotelId, [requestId])).has(requestId)) throw new NotFoundError('Talep bulunamadı');
    const request = await tx.purchaseRequest.findFirst({ where: { id: requestId, hotelId }, select: { number: true, status: true, source: true, updatedAt: true } });
    if (request.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
    if (request.status !== 'OPEN') throw new ConflictError('Yalnızca açık talep iptal edilir', 'REQUEST_STATUS');
    await tx.purchaseRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: actor, cancelReason: reason } });
    await recordAudit(tx, { hotelId, entity: 'PurchaseRequest', entityId: requestId, action: 'UPDATE', before: { status: 'OPEN' }, after: { status: 'CANCELLED', reason, number: request.number } });
    await stage('purchase.request.changed', { hotelId, requestId, change: 'CANCELLED', source: request.source });
  });
  return getRequest(hotelId, requestId);
}
