import { randomUUID } from 'node:crypto';
import { currentActor, toDecimal } from '@hotelos/core';
import {
  MAX_ROUND_QUOTES,
  MAX_ROUND_REQUEST_LINES,
  PURCHASE_ORDER_APPROVAL_DAYS,
  PURCHASE_ORDER_PREFIX,
  PURCHASE_ROUND_PREFIX,
  STOCK_ITEM_GROUP_LABELS,
  bestQuoteLine,
} from '@hotelos/hotel-contracts';
import { Prisma } from '@prisma/client';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockPurchaseRequests, lockPurchaseRounds } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { matchStockItemIds, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { addDays, consolidateRoundLines, lineAmounts, needsApproval, planAward, sumAmounts } from './rules.js';
import {
  dateOnly,
  dayText,
  hotelContext,
  iso,
  loadPurchaseSettings,
  money,
  nextNumber,
  plain,
  optionalPlain,
  priced,
  prisma,
  refreshRequestStatuses,
  refreshRoundStatus,
} from './shared.js';

/**
 * Teklif turu (modül 45): talep → teklif karşılaştırma → sipariş.
 *
 * - **Açık satırlar:** henüz tura alınmamış talep satırları (açık / işlemdeki talepler) malzeme başına
 *   toplanır. Tur, seçilen malzemelerin bütün açık satırlarını birleştirir; ekran gördüğü toplamı
 *   gönderir, sunucu talepleri kilitleyip yeniden toplar (tutmazsa tur açılmaz).
 * - **Teklif:** turda tedarikçi başına tek teklif (termin, geçerlilik, satır fiyatı KDV hariç + KDV
 *   oranı). Her kayıt turun sürüm damgasını ilerletir; kazanan seçimi eski karşılaştırmayla yapılamaz.
 * - **Kazanan (satır bazında):** her malzeme kendi teklifinden; en uygun dışı seçim gerekçe ister.
 *   Seçimler tedarikçi başına siparişe döner; KDV dahil tutar politika eşiğinde / üstündeyse sipariş
 *   onay kuyruğuna gider (dört göz), değilse onaylı açılır.
 * - **Kapatma:** siparişe dönmemiş satırlar talebe geri bırakılır (yeniden tura alınabilir).
 */

/** Tur ekranında satır başına gösterilen en fazla talep. */
const ROUND_LINE_REQUEST_PREVIEW = 20;

const ROUND_SELECT = Object.freeze({
  id: true,
  number: true,
  status: true,
  neededBy: true,
  note: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  awardedAt: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
});

/** @param {any} row */
const roundHeader = (row) => ({
  id: row.id,
  number: row.number,
  status: row.status,
  neededBy: dayText(row.neededBy),
  note: row.note,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  awardedAt: iso(row.awardedAt),
  cancelledAt: iso(row.cancelledAt),
  cancelledBy: row.cancelledBy,
  cancelReason: row.cancelReason,
});

/* ─────────────── Açık talep satırları ─────────────── */

/**
 * Arama kelimeleri → malzeme kimlikleri (her kelime ayrı; kesişim). Kelime hiçbir malzemeye uymazsa `null`.
 * @param {string} hotelId @param {string | undefined} search
 */
async function searchedItemIds(hotelId, search) {
  const tokens = searchTokens(search);
  if (tokens.length === 0) return undefined;
  const lists = await Promise.all(tokens.map((token) => matchStockItemIds(prisma, hotelId, token)));
  const [first, ...rest] = lists;
  const ids = first.filter((id) => rest.every((list) => list.includes(id)));
  return ids.length ? ids : null;
}

/**
 * @param {string} hotelId
 * @param {{ from?: string | null, to?: string | null, group?: string, itemIds?: string[] }} filter
 */
function openLineFilters(hotelId, { from, to, group, itemIds }) {
  const filters = [Prisma.sql`l."hotelId" = ${hotelId}`, Prisma.sql`l."roundLineId" IS NULL`, Prisma.sql`r."status"::text IN ('OPEN', 'IN_PROGRESS')`];
  if (from) filters.push(Prisma.sql`l."neededBy" >= ${from}::date`);
  if (to) filters.push(Prisma.sql`l."neededBy" <= ${to}::date`);
  if (group) filters.push(Prisma.sql`s."group"::text = ${group}`);
  if (itemIds) filters.push(Prisma.sql`l."stockItemId" = ANY(${itemIds}::text[])`);
  return Prisma.join(filters, ' AND ');
}

/**
 * Teklif turuna alınabilecek açık talep satırları, malzeme başına (en erken ihtiyaç önce).
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, group?: string, search?: string, from?: string, to?: string }} query
 */
export async function listOpenLines(hotelId, query) {
  const itemIds = await searchedItemIds(hotelId, query.search);
  if (itemIds === null) return buildPage([], 0, query);
  const where = openLineFilters(hotelId, { from: query.from, to: query.to, group: query.group, itemIds });
  const { skip, take } = toSkipTake(query);
  // Toplama bir kez: sayfa ve toplam malzeme sayısı aynı ifadeden (pencere sayımı).
  const rows = await prisma.$queryRaw`
    SELECT s."id" AS "stockItemId", s."code", s."name", s."group"::text AS "group", s."unit"::text AS "unit",
           s."onHand"::text AS "onHand", s."unitCost"::text AS "unitCost",
           COALESCE(SUM(l."quantity") FILTER (WHERE l."unit" = s."unit"), 0)::text AS "quantity",
           COUNT(*) FILTER (WHERE l."unit" <> s."unit")::int AS "mismatched",
           MIN(l."neededBy") AS "neededBy", COUNT(*)::int AS "lines", COUNT(DISTINCT l."requestId")::int AS "requests",
           array_agg(DISTINCT r."source"::text) AS "sources",
           COUNT(*) OVER ()::int AS "total"
    FROM "PurchaseRequestLine" l
    JOIN "PurchaseRequest" r ON r."id" = l."requestId"
    JOIN "StockItem" s ON s."id" = l."stockItemId"
    WHERE ${where}
    GROUP BY s."id"
    ORDER BY MIN(l."neededBy"), s."name", s."id"
    LIMIT ${take} OFFSET ${skip}`;
  // Son sayfanın ötesi istenirse pencere sayımı gelmez: toplam ayrıca sayılır.
  const total = rows.length
    ? rows[0].total
    : skip > 0
      ? (
          await prisma.$queryRaw`
            SELECT COUNT(DISTINCT l."stockItemId")::int AS "total"
            FROM "PurchaseRequestLine" l
            JOIN "PurchaseRequest" r ON r."id" = l."requestId"
            JOIN "StockItem" s ON s."id" = l."stockItemId"
            WHERE ${where}`
        )[0].total
      : 0;
  return buildPage(
    rows.map((row) => ({
      id: row.stockItemId,
      stockItemId: row.stockItemId,
      code: row.code,
      name: row.name,
      group: row.group,
      unit: row.unit,
      onHand: plain(row.onHand),
      unitCost: plain(row.unitCost),
      quantity: plain(row.quantity),
      estimatedTotal: money(toDecimal(row.quantity).times(toDecimal(row.unitCost))),
      unitMismatchLines: row.mismatched,
      neededBy: dayText(row.neededBy),
      lines: row.lines,
      requests: row.requests,
      sources: row.sources,
    })),
    total,
    query,
  );
}

/* ─────────────── Tur açma ─────────────── */

/**
 * @param {string} hotelId
 * @param {{ from?: string | null, to?: string | null, items: Array<{ stockItemId: string, expectedQuantity: string }>, note?: string | null }} input
 */
export async function createRound(hotelId, input) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  const itemIds = input.items.map((item) => item.stockItemId);
  const lineWhere = {
    hotelId,
    stockItemId: { in: itemIds },
    roundLineId: null,
    request: { status: { in: /** @type {any[]} */ (['OPEN', 'IN_PROGRESS']) } },
    ...(input.from || input.to ? { neededBy: { ...(input.from ? { gte: dateOnly(input.from) } : {}), ...(input.to ? { lte: dateOnly(input.to) } : {}) } } : {}),
  };
  const candidates = await prisma.purchaseRequestLine.findMany({ where: lineWhere, distinct: ['requestId'], select: { requestId: true } });
  if (candidates.length === 0) throw new ConflictError('Seçilen malzemelerin açık talep satırı kalmadı (başka tura alındı ya da talep iptal edildi); liste yenilendi', 'LINES_CHANGED');

  try {
    const id = await writeWithEvents(async (tx, stage) => {
      const locked = await lockPurchaseRequests(
        tx,
        hotelId,
        candidates.map((row) => row.requestId),
      );
      // Kilit altında yeniden: yalnız kilitli taleplerin hâlâ açık satırları (bu arada açılan talep sonraki tura).
      const lines = await tx.purchaseRequestLine.findMany({
        where: { ...lineWhere, requestId: { in: [...locked] } },
        orderBy: [{ neededBy: 'asc' }, { id: 'asc' }],
        take: MAX_ROUND_REQUEST_LINES + 1,
        select: { id: true, requestId: true, stockItemId: true, quantity: true, unit: true, neededBy: true },
      });
      if (lines.length > MAX_ROUND_REQUEST_LINES) {
        throw new ValidationError(`Bir turda en fazla ${MAX_ROUND_REQUEST_LINES} talep satırı birleşir; ihtiyaç günü aralığını ya da malzemeleri daraltın`);
      }
      const items = await tx.stockItem.findMany({ where: { hotelId, id: { in: itemIds } }, select: { id: true, name: true, unit: true, group: true } });
      const itemById = new Map(items.map((item) => [item.id, item]));
      const { items: merged, mismatched } = consolidateRoundLines(
        lines.map((line) => ({ id: line.id, stockItemId: line.stockItemId, quantity: String(line.quantity), unit: line.unit, neededBy: dayText(line.neededBy) })),
        new Map(items.map((item) => [item.id, item.unit])),
      );

      /** @type {Record<string, string>} */
      const fields = {};
      const stale = [];
      input.items.forEach((entry, index) => {
        const item = itemById.get(entry.stockItemId);
        if (!item) {
          fields[`items.${index}.stockItemId`] = 'Malzeme bulunamadı';
          return;
        }
        if (mismatched.includes(item.id)) {
          fields[`items.${index}.stockItemId`] = `${item.name}: stok birimi talepten sonra değişmiş; eski birimdeki talebi iptal edip yeniden açın`;
          return;
        }
        const quantity = merged.get(item.id)?.quantity ?? toDecimal(0);
        if (!quantity.equals(toDecimal(entry.expectedQuantity))) stale.push(`${item.name}: ${plain(entry.expectedQuantity)} → ${quantity.toString()}`);
      });
      const messages = Object.values(fields);
      if (messages.length) throw new ValidationError(`Turda düzeltilmesi gereken malzemeler var: ${messages[0]}${messages.length > 1 ? ` (+${messages.length - 1})` : ''}`, { fields });
      if (stale.length) {
        throw new ConflictError(`Açık talepler bu arada değişti (yeni talep, iptal ya da başka tur); liste yenilendi, tekrar bakın. ${stale.slice(0, 5).join(' · ')}`, 'LINES_CHANGED');
      }

      const ordered = [...merged.values()].sort((a, b) => a.neededBy.localeCompare(b.neededBy) || itemById.get(a.stockItemId).name.localeCompare(itemById.get(b.stockItemId).name, 'tr'));
      const neededBy = ordered[0].neededBy;
      const number = await nextNumber(tx, hotelId, PURCHASE_ROUND_PREFIX, Number(today.slice(0, 4)));
      const round = await tx.purchaseRound.create({
        data: { hotelId, number, status: 'OPEN', neededBy: dateOnly(neededBy), note: input.note ?? null, createdBy: actor },
        select: { id: true },
      });
      const roundLines = ordered.map((item, index) => ({ id: randomUUID(), item, index }));
      await tx.purchaseRoundLine.createMany({
        data: roundLines.map(({ id: lineId, item, index }) => ({
          id: lineId,
          hotelId,
          roundId: round.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity.toFixed(3),
          unit: /** @type {any} */ (item.unit),
          neededBy: dateOnly(item.neededBy),
          sortOrder: index,
        })),
      });
      const pairs = roundLines.flatMap(({ id: lineId, item }) => item.requestLineIds.map((requestLineId) => [requestLineId, lineId]));
      await tx.$executeRaw`
        UPDATE "PurchaseRequestLine" AS l SET "roundLineId" = v."roundLineId"
        FROM unnest(${pairs.map((pair) => pair[0])}::text[], ${pairs.map((pair) => pair[1])}::text[]) AS v("id", "roundLineId")
        WHERE l."id" = v."id" AND l."hotelId" = ${hotelId} AND l."roundLineId" IS NULL`;
      await refreshRequestStatuses(tx, hotelId, [...new Set(lines.map((line) => line.requestId))]);
      await recordAudit(tx, {
        hotelId,
        entity: 'PurchaseRound',
        entityId: round.id,
        action: 'CREATE',
        after: {
          number,
          neededBy,
          requestLines: lines.length,
          items: ordered.slice(0, 40).map((item) => `${itemById.get(item.stockItemId).name} ${item.quantity.toString()}`),
        },
      });
      await stage('purchase.round.changed', { hotelId, roundId: round.id, change: 'CREATED' });
      return round.id;
    });
    return getRound(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/* ─────────────── Liste ve karşılaştırma ─────────────── */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, status?: string, search?: string }} query
 */
export async function listRounds(hotelId, query) {
  /** @type {Record<string, any>} */
  const where = { hotelId };
  if (query.status) where.status = query.status;
  const tokens = searchTokens(query.search);
  if (tokens.length) {
    const items = await Promise.all(tokens.map((token) => matchStockItemIds(prisma, hotelId, token)));
    where.AND = tokens.map((token, index) => ({
      OR: [{ number: { contains: token, mode: 'insensitive' } }, ...(items[index].length ? [{ lines: { some: { stockItemId: { in: items[index] } } } }] : [])],
    }));
  }
  const [rows, total] = await Promise.all([
    prisma.purchaseRound.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query), select: { ...ROUND_SELECT, _count: { select: { lines: true, quotes: true } } } }),
    prisma.purchaseRound.count({ where }),
  ]);
  const ids = rows.map((row) => row.id);
  const stats = ids.length
    ? await prisma.$queryRaw`
        SELECT "roundId", COUNT("orderLineId")::int AS "ordered", COUNT("releasedAt")::int AS "released"
        FROM "PurchaseRoundLine" WHERE "roundId" = ANY(${ids}::text[]) GROUP BY "roundId"`
    : [];
  const byId = new Map(stats.map((row) => [row.roundId, row]));
  return buildPage(
    rows.map((row) => ({
      ...roundHeader(row),
      lines: row._count.lines,
      quotes: row._count.quotes,
      orderedLines: byId.get(row.id)?.ordered ?? 0,
      releasedLines: byId.get(row.id)?.released ?? 0,
    })),
    total,
    query,
  );
}

/**
 * Karşılaştırma ekranı: satırlar (malzeme × miktar × ihtiyaç), teklifler (tedarikçi × termin ×
 * geçerlilik) ve hücreler (fiyat, tutar, geç kalma), satır başına en uygun teklif.
 * @param {string} hotelId @param {string} roundId
 */
export async function getRound(hotelId, roundId) {
  const [{ today, currency }, row] = await Promise.all([
    hotelContext(hotelId),
    prisma.purchaseRound.findFirst({
      where: { id: roundId, hotelId },
      select: {
        ...ROUND_SELECT,
        lines: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            stockItemId: true,
            quantity: true,
            unit: true,
            neededBy: true,
            awardedQuoteLineId: true,
            awardReason: true,
            orderLineId: true,
            releasedAt: true,
            stockItem: { select: { code: true, name: true, group: true, unitCost: true, onHand: true } },
            orderLine: { select: { order: { select: { id: true, number: true, status: true, supplierId: true } } } },
          },
        },
        quotes: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            supplierId: true,
            deliveryDays: true,
            validUntil: true,
            note: true,
            createdBy: true,
            createdAt: true,
            updatedAt: true,
            supplier: { select: { code: true, name: true, isActive: true, paymentTermDays: true, groups: true } },
            lines: { select: { id: true, roundLineId: true, unitPrice: true, taxRatePct: true } },
          },
        },
      },
    }),
  ]);
  if (!row) throw new NotFoundError('Teklif turu bulunamadı');
  const lineIds = row.lines.map((line) => line.id);
  const requests = lineIds.length
    ? await prisma.$queryRaw`
        SELECT l."roundLineId", r."id", r."number", r."source"::text AS "source", SUM(l."quantity")::text AS "quantity"
        FROM "PurchaseRequestLine" l JOIN "PurchaseRequest" r ON r."id" = l."requestId"
        WHERE l."hotelId" = ${hotelId} AND l."roundLineId" = ANY(${lineIds}::text[])
        GROUP BY l."roundLineId", r."id" ORDER BY r."number"`
    : [];
  /** @type {Map<string, any[]>} */
  const requestsByLine = new Map();
  for (const request of requests) {
    const list = requestsByLine.get(request.roundLineId) ?? [];
    list.push({ id: request.id, number: request.number, source: request.source, quantity: plain(request.quantity) });
    requestsByLine.set(request.roundLineId, list);
  }

  const quotes = row.quotes.map((quote) => {
    const validUntil = dayText(quote.validUntil);
    return {
      quote,
      validUntil,
      expired: Boolean(validUntil && validUntil < today),
      expectedOn: addDays(today, quote.deliveryDays),
      cells: new Map(quote.lines.map((line) => [line.roundLineId, line])),
    };
  });
  const lines = row.lines.map((line) => {
    const pending = !line.orderLineId && !line.releasedAt;
    const neededBy = dayText(line.neededBy);
    const candidates = quotes
      .filter((entry) => entry.quote.supplier.isActive && !entry.expired)
      .map((entry) => ({ entry, cell: entry.cells.get(line.id) }))
      .filter(({ cell }) => cell && cell.unitPrice !== null)
      .map(({ entry, cell }) => ({ id: cell.id, unitPrice: plain(cell.unitPrice), deliveryDays: entry.quote.deliveryDays, createdAt: iso(entry.quote.createdAt), late: entry.expectedOn > neededBy }));
    const order = line.orderLine?.order ?? null;
    const lineRequests = requestsByLine.get(line.id) ?? [];
    return {
      id: line.id,
      stockItemId: line.stockItemId,
      code: line.stockItem.code,
      name: line.stockItem.name,
      group: line.stockItem.group,
      unit: line.unit,
      quantity: plain(line.quantity),
      neededBy,
      currentCost: plain(line.stockItem.unitCost),
      onHand: plain(line.stockItem.onHand),
      state: line.releasedAt ? 'RELEASED' : line.orderLineId ? 'ORDERED' : 'PENDING',
      bestQuoteLineId: pending ? bestQuoteLine(candidates) : null,
      awardedQuoteLineId: line.awardedQuoteLineId,
      awardReason: line.awardReason,
      order: order ? { id: order.id, number: order.number, status: order.status, supplierId: order.supplierId } : null,
      releasedAt: iso(line.releasedAt),
      requestCount: lineRequests.length,
      requests: lineRequests.slice(0, ROUND_LINE_REQUEST_PREVIEW),
    };
  });
  const lineById = new Map(row.lines.map((line) => [line.id, line]));
  const bestIds = new Set(lines.map((line) => line.bestQuoteLineId).filter(Boolean));

  return {
    ...roundHeader(row),
    currency,
    today,
    lines,
    quotes: quotes.map(({ quote, validUntil, expired, expectedOn, cells }) => {
      const amounts = [];
      let lateLines = 0;
      const quoteLines = [...cells.values()].map((cell) => {
        const line = lineById.get(cell.roundLineId);
        const amount = cell.unitPrice === null ? null : lineAmounts(String(line.quantity), String(cell.unitPrice), String(cell.taxRatePct));
        if (amount) amounts.push(amount);
        const late = expectedOn > dayText(line.neededBy);
        if (late && amount) lateLines += 1;
        return {
          id: cell.id,
          roundLineId: cell.roundLineId,
          unitPrice: optionalPlain(cell.unitPrice),
          taxRatePct: plain(cell.taxRatePct),
          net: amount ? money(amount.net) : null,
          total: amount ? money(amount.total) : null,
          late,
          best: bestIds.has(cell.id),
        };
      });
      const totals = sumAmounts(amounts);
      return {
        id: quote.id,
        supplierId: quote.supplierId,
        supplierCode: quote.supplier.code,
        supplierName: quote.supplier.name,
        supplierActive: quote.supplier.isActive,
        supplierGroups: quote.supplier.groups,
        paymentTermDays: quote.supplier.paymentTermDays,
        deliveryDays: quote.deliveryDays,
        expectedOn,
        validUntil,
        expired,
        note: quote.note,
        createdBy: quote.createdBy,
        createdAt: iso(quote.createdAt),
        updatedAt: iso(quote.updatedAt),
        pricedLines: amounts.length,
        bestLines: quoteLines.filter((line) => line.best).length,
        lateLines,
        net: money(totals.net),
        tax: money(totals.tax),
        total: money(totals.total),
        lines: quoteLines,
      };
    }),
  };
}

/* ─────────────── Teklif ─────────────── */

/**
 * Turu kilitler, açık ve sürümü güncel olduğunu denetler.
 * @param {any} tx @param {string} hotelId @param {string} roundId @param {Date} expectedUpdatedAt
 */
async function lockedOpenRound(tx, hotelId, roundId, expectedUpdatedAt) {
  if (!(await lockPurchaseRounds(tx, hotelId, [roundId])).has(roundId)) throw new NotFoundError('Teklif turu bulunamadı');
  const round = await tx.purchaseRound.findUnique({
    where: { id: roundId },
    select: {
      number: true,
      status: true,
      updatedAt: true,
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          stockItemId: true,
          quantity: true,
          unit: true,
          neededBy: true,
          orderLineId: true,
          releasedAt: true,
          awardedQuoteLineId: true,
          stockItem: { select: { name: true, unit: true } },
          requestLines: { select: { requestId: true } },
        },
      },
    },
  });
  if (round.status !== 'OPEN') throw new ConflictError('Tur kapandı (siparişe döndü ya da iptal edildi)', 'ROUND_STATUS');
  if (round.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
  return round;
}

/**
 * Tedarikçinin teklifini kaydeder (yoksa açar). Yalnız bekleyen satırların fiyatı yazılır; siparişe
 * dönmüş / bırakılmış satırın teklif satırına dokunulmaz. Boş fiyat = bu malzemeyi vermiyor.
 *
 * @param {string} hotelId @param {string} roundId @param {string} supplierId
 * @param {{ expectedUpdatedAt: Date, deliveryDays: number, validUntil?: string | null, note?: string | null, lines: Array<{ roundLineId: string, unitPrice: string | null, taxRatePct: string }> }} input
 */
export async function saveQuote(hotelId, roundId, supplierId, input) {
  const actor = currentActor();
  const { today } = await hotelContext(hotelId);
  if (input.validUntil && input.validUntil < today) throw new ValidationError('Geçerlilik bugünden önce olamaz', { fields: { validUntil: 'Geçerlilik bugünden önce olamaz' } });
  try {
    await writeWithEvents(async (tx, stage) => {
      const round = await lockedOpenRound(tx, hotelId, roundId, input.expectedUpdatedAt);
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId, hotelId }, select: { name: true, isActive: true } });
      if (!supplier) throw new NotFoundError('Tedarikçi bulunamadı');
      if (!supplier.isActive) throw new ConflictError(`${supplier.name} pasif; teklifi alınmaz`, 'SUPPLIER_INACTIVE');
      const existing = await tx.purchaseQuote.findUnique({
        where: { roundId_supplierId: { roundId, supplierId } },
        select: { id: true, deliveryDays: true, lines: { select: { id: true, roundLineId: true } } },
      });
      if (!existing && (await tx.purchaseQuote.count({ where: { roundId } })) >= MAX_ROUND_QUOTES) {
        throw new ValidationError(`Bir turda en fazla ${MAX_ROUND_QUOTES} tedarikçi teklifi olur`);
      }

      const lineIds = new Set(round.lines.map((line) => line.id));
      /** @type {Record<string, string>} */
      const fields = {};
      input.lines.forEach((line, index) => {
        if (!lineIds.has(line.roundLineId)) fields[`lines.${index}.roundLineId`] = 'Satır bu turda yok';
      });
      if (Object.keys(fields).length) throw new ValidationError('Teklifte bu turda olmayan satır var', { fields });
      const pending = round.lines.filter((line) => !line.orderLineId && !line.releasedAt);
      const pendingIds = new Set(pending.map((line) => line.id));
      const pricedLines = input.lines.filter((line) => pendingIds.has(line.roundLineId) && line.unitPrice !== null);
      const keptAwarded = (existing?.lines ?? []).filter((line) => !pendingIds.has(line.roundLineId)).length;
      if (pricedLines.length === 0 && keptAwarded === 0) throw new ValidationError('Bekleyen malzemelerden en az birine fiyat girin');

      const quoteId = existing?.id ?? randomUUID();
      if (existing) {
        await tx.purchaseQuote.update({ where: { id: quoteId }, data: { deliveryDays: input.deliveryDays, validUntil: input.validUntil ? dateOnly(input.validUntil) : null, note: input.note ?? null } });
        // Bekleyen satırların teklif satırları yeniden yazılır (kazanan bağları yalnız siparişli satırlarda).
        await tx.purchaseQuoteLine.deleteMany({ where: { quoteId, roundLineId: { in: [...pendingIds] } } });
      } else {
        await tx.purchaseQuote.create({
          data: { id: quoteId, hotelId, roundId, supplierId, deliveryDays: input.deliveryDays, validUntil: input.validUntil ? dateOnly(input.validUntil) : null, note: input.note ?? null, createdBy: actor },
        });
      }
      if (pricedLines.length) {
        await tx.purchaseQuoteLine.createMany({
          data: pricedLines.map((line) => ({ hotelId, quoteId, roundLineId: line.roundLineId, unitPrice: line.unitPrice, taxRatePct: line.taxRatePct })),
        });
      }
      await tx.purchaseRound.update({ where: { id: roundId }, data: { updatedAt: new Date() } });
      await recordAudit(tx, {
        hotelId,
        entity: 'PurchaseQuote',
        entityId: quoteId,
        action: existing ? 'UPDATE' : 'CREATE',
        ...(existing ? { before: { deliveryDays: existing.deliveryDays } } : {}),
        after: { round: round.number, supplier: supplier.name, deliveryDays: input.deliveryDays, validUntil: input.validUntil ?? null, pricedLines: pricedLines.length },
      });
      await stage('purchase.round.changed', { hotelId, roundId, change: 'QUOTED' });
    });
    return getRound(hotelId, roundId);
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Teklifi turdan çıkarır (yanlış tedarikçi, geri çekilen teklif). Siparişe dönmüş satırı olan teklif çıkarılamaz.
 * @param {string} hotelId @param {string} roundId @param {string} supplierId @param {{ expectedUpdatedAt: Date }} input
 */
export async function removeQuote(hotelId, roundId, supplierId, { expectedUpdatedAt }) {
  await writeWithEvents(async (tx, stage) => {
    const round = await lockedOpenRound(tx, hotelId, roundId, expectedUpdatedAt);
    const quote = await tx.purchaseQuote.findUnique({
      where: { roundId_supplierId: { roundId, supplierId } },
      select: { id: true, supplier: { select: { name: true } }, lines: { select: { id: true } } },
    });
    if (!quote) throw new NotFoundError('Bu tedarikçinin bu turda teklifi yok');
    const quoteLineIds = new Set(quote.lines.map((line) => line.id));
    if (round.lines.some((line) => line.awardedQuoteLineId && quoteLineIds.has(line.awardedQuoteLineId))) {
      throw new ConflictError('Siparişe dönmüş satırı olan teklif çıkarılamaz; önce siparişi iptal edin', 'QUOTE_AWARDED');
    }
    await tx.purchaseQuote.delete({ where: { id: quote.id } });
    await tx.purchaseRound.update({ where: { id: roundId }, data: { updatedAt: new Date() } });
    await recordAudit(tx, { hotelId, entity: 'PurchaseQuote', entityId: quote.id, action: 'DELETE', before: { round: round.number, supplier: quote.supplier.name, lines: quote.lines.length } });
    await stage('purchase.round.changed', { hotelId, roundId, change: 'QUOTED' });
  });
  return getRound(hotelId, roundId);
}

/* ─────────────── Kazanan → sipariş ─────────────── */

/**
 * Satır bazında kazanan seçimi: seçimler tedarikçi başına siparişe döner (eşik üstü onaya gider).
 * @param {string} hotelId @param {string} roundId
 * @param {{ expectedUpdatedAt: Date, awards: Array<{ roundLineId: string, quoteLineId: string, reason?: string | null }> }} input
 */
export async function awardRound(hotelId, roundId, input) {
  const actor = currentActor();
  const [{ today, currency }, settings] = await Promise.all([hotelContext(hotelId), loadPurchaseSettings(prisma, hotelId)]);
  try {
    const orderIds = await writeWithEvents(async (tx, stage) => {
      const round = await lockedOpenRound(tx, hotelId, roundId, input.expectedUpdatedAt);
      const quotes = await tx.purchaseQuote.findMany({
        where: { roundId },
        select: {
          id: true,
          supplierId: true,
          deliveryDays: true,
          validUntil: true,
          createdAt: true,
          supplier: { select: { name: true, isActive: true, paymentTermDays: true } },
          lines: { select: { id: true, roundLineId: true, unitPrice: true, taxRatePct: true } },
        },
      });
      const plan = planAward({
        lines: round.lines.map((line) => ({ id: line.id, name: line.stockItem.name, neededBy: dayText(line.neededBy), ordered: line.orderLineId !== null, released: line.releasedAt !== null })),
        quotes: quotes.map((quote) => ({
          id: quote.id,
          supplierId: quote.supplierId,
          supplierName: quote.supplier.name,
          supplierActive: quote.supplier.isActive,
          deliveryDays: quote.deliveryDays,
          validUntil: dayText(quote.validUntil),
          createdAt: iso(quote.createdAt),
          lines: quote.lines.map((line) => ({ id: line.id, roundLineId: line.roundLineId, unitPrice: optionalPlain(line.unitPrice), taxRatePct: plain(line.taxRatePct) })),
        })),
        awards: input.awards,
        today,
      });
      const lineById = new Map(round.lines.map((line) => [line.id, line]));
      input.awards.forEach((award, index) => {
        const line = lineById.get(award.roundLineId);
        if (line && line.unit !== line.stockItem.unit) plan.fields[`awards.${index}.roundLineId`] = `${line.stockItem.name}: stok birimi tur açıldıktan sonra değişmiş; turu kapatıp yeniden açın`;
      });
      const messages = Object.values(plan.fields);
      if (messages.length) throw new ValidationError(`Seçimde düzeltilmesi gereken satırlar var: ${messages[0]}${messages.length > 1 ? ` (+${messages.length - 1})` : ''}`, { fields: plan.fields });

      const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
      const year = Number(today.slice(0, 4));
      const created = [];
      const links = [];
      for (const group of plan.groups) {
        const quote = quoteById.get(group.quoteId);
        const orderId = randomUUID();
        const number = await nextNumber(tx, hotelId, PURCHASE_ORDER_PREFIX, year);
        const orderLines = group.lines.map((pick, index) => {
          const line = lineById.get(pick.roundLineId);
          const amounts = lineAmounts(String(line.quantity), pick.unitPrice, pick.taxRatePct);
          return { id: randomUUID(), pick, line, amounts, index };
        });
        const totals = sumAmounts(orderLines.map((entry) => entry.amounts));
        const expectedOn = addDays(today, group.deliveryDays);
        const approval = needsApproval(totals.total, settings.orderApprovalAmount);
        let approvalId = null;
        if (approval) {
          ({ approvalId } = await requestApproval(tx, stage, {
            hotelId,
            type: 'PURCHASE_ORDER',
            summary: `Satın alma siparişi ${number}: ${group.supplierName} — ${priced(totals.total, currency)}`.slice(0, 200),
            reason: `KDV dahil tutar onay eşiğine (${priced(settings.orderApprovalAmount, currency)}) eşit ya da üstünde`,
            amount: money(totals.total),
            currency,
            data: {
              Tedarikçi: group.supplierName,
              'Teklif turu': round.number,
              Kalem: String(orderLines.length),
              'KDV hariç': priced(totals.net, currency),
              KDV: priced(totals.tax, currency),
              'KDV dahil': priced(totals.total, currency),
              'Beklenen teslim': expectedOn,
              'Ödeme vadesi': `${quote.supplier.paymentTermDays} gün`,
              ...(orderLines.some((entry) => !entry.pick.best) ? { 'En uygun dışı seçim': orderLines.filter((entry) => !entry.pick.best).map((entry) => `${entry.line.stockItem.name}: ${entry.pick.reason}`).join(' · ').slice(0, 500) } : {}),
              İsteyen: actor,
            },
            entityType: 'PurchaseOrder',
            entityId: orderId,
            requestedBy: actor,
            expiresInMs: PURCHASE_ORDER_APPROVAL_DAYS * 86_400_000,
          }));
        }
        const now = new Date();
        await tx.purchaseOrder.create({
          data: {
            id: orderId,
            hotelId,
            number,
            supplierId: group.supplierId,
            roundId,
            status: approval ? 'PENDING_APPROVAL' : 'APPROVED',
            expectedOn: dateOnly(expectedOn),
            paymentTermDays: quote.supplier.paymentTermDays,
            currency,
            netTotal: money(totals.net),
            taxTotal: money(totals.tax),
            grandTotal: money(totals.total),
            approvalId,
            createdBy: actor,
            ...(approval ? {} : { approvedAt: now, approvedBy: actor }),
          },
        });
        await tx.purchaseOrderLine.createMany({
          data: orderLines.map((entry) => ({
            id: entry.id,
            hotelId,
            orderId,
            stockItemId: entry.line.stockItemId,
            quantity: plain(entry.line.quantity),
            unit: entry.line.unit,
            unitPrice: entry.pick.unitPrice,
            taxRatePct: entry.pick.taxRatePct,
            netAmount: money(entry.amounts.net),
            taxAmount: money(entry.amounts.tax),
            total: money(entry.amounts.total),
            sortOrder: entry.index,
          })),
        });
        for (const entry of orderLines) links.push({ roundLineId: entry.line.id, quoteLineId: entry.pick.quoteLineId, orderLineId: entry.id, reason: entry.pick.reason ?? null });
        await recordAudit(tx, {
          hotelId,
          entity: 'PurchaseOrder',
          entityId: orderId,
          action: 'CREATE',
          after: {
            number,
            round: round.number,
            supplier: group.supplierName,
            status: approval ? 'PENDING_APPROVAL' : 'APPROVED',
            grandTotal: money(totals.total),
            expectedOn,
            lines: orderLines.slice(0, 40).map((entry) => `${entry.line.stockItem.name} ${plain(entry.line.quantity)} × ${entry.pick.unitPrice}`),
          },
        });
        await stage('purchase.order.changed', { hotelId, orderId, change: 'CREATED' });
        created.push(orderId);
      }
      await tx.$executeRaw`
        UPDATE "PurchaseRoundLine" AS rl
        SET "awardedQuoteLineId" = v."quoteLineId", "orderLineId" = v."orderLineId", "awardReason" = v."reason"
        FROM unnest(
          ${links.map((link) => link.roundLineId)}::text[],
          ${links.map((link) => link.quoteLineId)}::text[],
          ${links.map((link) => link.orderLineId)}::text[],
          ${links.map((link) => link.reason)}::text[]
        ) AS v("id", "quoteLineId", "orderLineId", "reason")
        WHERE rl."id" = v."id" AND rl."roundId" = ${roundId} AND rl."orderLineId" IS NULL`;
      await refreshRoundStatus(tx, roundId);
      await tx.purchaseRound.update({ where: { id: roundId }, data: { updatedAt: new Date() } });
      await recordAudit(tx, {
        hotelId,
        entity: 'PurchaseRound',
        entityId: roundId,
        action: 'UPDATE',
        after: { number: round.number, awarded: links.length, orders: created.length, notBest: plan.groups.flatMap((group) => group.lines).filter((line) => !line.best).length },
      });
      await stage('purchase.round.changed', { hotelId, roundId, change: 'AWARDED' });
      const awarded = new Set(links.map((link) => link.roundLineId));
      await refreshRequestStatuses(tx, hotelId, round.lines.filter((line) => awarded.has(line.id)).flatMap((line) => line.requestLines.map((request) => request.requestId)));
      return created;
    });
    const orders = await prisma.purchaseOrder.findMany({
      where: { id: { in: orderIds }, hotelId },
      orderBy: { number: 'asc' },
      select: { id: true, number: true, status: true, grandTotal: true, supplier: { select: { name: true } } },
    });
    return {
      round: await getRound(hotelId, roundId),
      orders: orders.map((order) => ({ id: order.id, number: order.number, status: order.status, grandTotal: money(order.grandTotal), supplierName: order.supplier.name })),
    };
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Turu kapatır: siparişe dönmemiş satırlar talebe geri bırakılır (yeniden tura alınabilir). Hiç
 * sipariş yoksa tur iptal, varsa "siparişe döndü" olarak kalır.
 * @param {string} hotelId @param {string} roundId @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function cancelRound(hotelId, roundId, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const round = await lockedOpenRound(tx, hotelId, roundId, expectedUpdatedAt);
    const pending = round.lines.filter((line) => !line.orderLineId && !line.releasedAt);
    const now = new Date();
    if (pending.length) {
      await tx.purchaseRoundLine.updateMany({ where: { id: { in: pending.map((line) => line.id) } }, data: { releasedAt: now } });
      await tx.purchaseRequestLine.updateMany({ where: { hotelId, roundLineId: { in: pending.map((line) => line.id) } }, data: { roundLineId: null } });
    }
    await tx.purchaseRound.update({ where: { id: roundId }, data: { cancelledAt: now, cancelledBy: actor, cancelReason: reason } });
    const { after } = await refreshRoundStatus(tx, roundId);
    await recordAudit(tx, { hotelId, entity: 'PurchaseRound', entityId: roundId, action: 'UPDATE', before: { status: 'OPEN' }, after: { status: after, reason, released: pending.length, number: round.number } });
    await stage('purchase.round.changed', { hotelId, roundId, change: 'CANCELLED' });
    await refreshRequestStatuses(tx, hotelId, pending.flatMap((line) => line.requestLines.map((request) => request.requestId)));
  });
  return getRound(hotelId, roundId);
}

/** Tedarikçi önerisi: turdaki malzeme gruplarını tedarik eden etkin tedarikçiler (teklif ekranında). */
export async function suggestSuppliers(hotelId, roundId) {
  const round = await prisma.purchaseRound.findFirst({ where: { id: roundId, hotelId }, select: { lines: { select: { stockItem: { select: { group: true } } } }, quotes: { select: { supplierId: true } } } });
  if (!round) throw new NotFoundError('Teklif turu bulunamadı');
  const groups = [...new Set(round.lines.map((line) => line.stockItem.group))];
  const quoted = round.quotes.map((quote) => quote.supplierId);
  const rows = await prisma.supplier.findMany({
    where: { hotelId, isActive: true, groups: { hasSome: groups }, id: { notIn: quoted } },
    orderBy: { name: 'asc' },
    take: MAX_ROUND_QUOTES,
    select: { id: true, code: true, name: true, leadTimeDays: true, groups: true },
  });
  return rows.map((row) => ({ ...row, matchingGroups: row.groups.filter((group) => groups.includes(group)).map((group) => STOCK_ITEM_GROUP_LABELS[group] ?? group) }));
}

