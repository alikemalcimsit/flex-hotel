import { depreciationRatePct, depreciationSchedule, disposalResult, parseAssetCode, toCents } from '@hotelos/hotel-contracts';
import { NotFoundError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { ASSET_ROW_SELECT, isoDay, locationLabel, money, postedByAsset, prisma, toAssetRow, yearOf } from './shared.js';

/** Kart ekranında en fazla hareket satırı (en yeniler). */
const MAX_MOVEMENTS = 100;

/**
 * Demirbaş listesi: durum, kategori, yer, zimmet süzgeci ve arama (kod, ad, seri no, marka, model). Özet: süzgeçteki
 * kart sayısı ve toplam maliyet.
 * @param {string} hotelId
 * @param {Record<string, any>} query `assetListQuerySchema`
 */
export async function listAssets(hotelId, query) {
  const search = query.search?.trim();
  const code = search ? parseAssetCode(search) : null;
  const contains = (field) => ({ [field]: { contains: search, mode: 'insensitive' } });
  const where = {
    hotelId,
    ...(query.state === 'ALL' ? {} : { status: query.state }),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.areaId ? { areaId: query.areaId } : {}),
    ...(query.roomId ? { roomId: query.roomId } : {}),
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(search ? { OR: code ? [{ code }] : ['code', 'name', 'serialNumber', 'brand', 'model'].map(contains) } : {}),
  };
  const [rows, total, sum] = await Promise.all([
    prisma.asset.findMany({ where, select: ASSET_ROW_SELECT, orderBy: { code: 'asc' }, ...toSkipTake(query) }),
    prisma.asset.count({ where }),
    prisma.asset.aggregate({ where, _sum: { cost: true } }),
  ]);
  const posted = await postedByAsset(prisma, rows.map((row) => row.id));
  return {
    ...buildPage(rows.map((row) => toAssetRow(row, posted.get(row.id))), total, query),
    summary: { count: total, totalCost: money(sum._sum.cost ?? 0) },
  };
}

/**
 * Demirbaş kartı: bilgiler, finansal özet + yıl yıl amortisman tablosu (açılış, kaydedilmiş, plan), elden çıkarma
 * sonucu ve hareket geçmişi.
 * @param {string} hotelId
 * @param {string} assetId
 */
export async function getAsset(hotelId, assetId) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, hotelId },
    select: {
      ...ASSET_ROW_SELECT,
      categoryId: true,
      employeeId: true,
      assignedAt: true,
      supplierName: true,
      invoiceNumber: true,
      note: true,
      usefulLifeYears: true,
      openingThroughYear: true,
      disposalType: true,
      disposedOn: true,
      disposalPrice: true,
      disposalReason: true,
      disposalBookValue: true,
      disposedBy: true,
      createdBy: true,
      createdAt: true,
      depreciations: { select: { year: true, amount: true }, orderBy: { year: 'asc' } },
      movements: { orderBy: { occurredAt: 'desc' }, take: MAX_MOVEMENTS },
    },
  });
  if (!asset) throw new NotFoundError('Demirbaş bulunamadı');

  const postedCents = asset.depreciations.reduce((sum, row) => sum + toCents(String(row.amount)), 0n);
  const lastPostedYear = asset.depreciations.at(-1)?.year ?? null;
  const row = toAssetRow(asset, { cents: postedCents });
  const schedule = depreciationSchedule({
    cost: money(asset.cost),
    usefulLifeYears: asset.usefulLifeYears,
    purchaseYear: yearOf(asset.purchaseDate),
    openingAccumulated: money(asset.openingAccumulated),
    openingThroughYear: asset.openingThroughYear,
    posted: asset.depreciations.map((entry) => ({ year: entry.year, amount: money(entry.amount) })),
    disposedYear: asset.disposedOn ? yearOf(asset.disposedOn) : null,
  });
  return {
    ...row,
    categoryId: asset.categoryId,
    roomId: asset.roomId,
    areaId: asset.areaId,
    employeeId: asset.employeeId,
    assignedAt: asset.assignedAt?.toISOString() ?? null,
    supplierName: asset.supplierName,
    invoiceNumber: asset.invoiceNumber,
    note: asset.note,
    usefulLifeYears: asset.usefulLifeYears,
    ratePct: depreciationRatePct(asset.usefulLifeYears),
    openingAccumulated: money(asset.openingAccumulated),
    openingThroughYear: asset.openingThroughYear,
    financialsLocked: asset.depreciations.length > 0,
    lastPostedYear,
    disposal: asset.disposalType
      ? {
          type: asset.disposalType,
          disposedOn: isoDay(asset.disposedOn),
          price: money(asset.disposalPrice),
          reason: asset.disposalReason,
          bookValue: money(asset.disposalBookValue),
          gainLoss: disposalResult({ cost: money(asset.disposalBookValue), accumulated: '0', price: money(asset.disposalPrice) }).gainLoss,
          disposedBy: asset.disposedBy,
        }
      : null,
    schedule,
    movements: asset.movements.map((movement) => ({
      id: movement.id,
      kind: movement.kind,
      fromLabel: movement.fromLabel,
      toLabel: movement.toLabel,
      note: movement.note,
      actor: movement.actor,
      occurredAt: movement.occurredAt.toISOString(),
    })),
    createdBy: asset.createdBy,
    createdAt: asset.createdAt.toISOString(),
  };
}

/**
 * Etiketteki QR (ya da yazılan kod) → kart kimliği.
 * @param {string} hotelId @param {string} code normalize edilmiş kod ("DM-000123")
 */
export async function findAssetByCode(hotelId, code) {
  const asset = await prisma.asset.findFirst({ where: { hotelId, code }, select: { id: true, code: true } });
  if (!asset) throw new NotFoundError(`${code} kodlu demirbaş bulunamadı`);
  return asset;
}

/**
 * Etiket bilgileri (istenen sırayla): kod, ad, kategori, yer + otel adı.
 * @param {string} hotelId @param {string[]} ids
 */
export async function assetLabels(hotelId, ids) {
  const [hotel, rows] = await Promise.all([
    prisma.hotel.findUnique({ where: { id: hotelId }, select: { name: true } }),
    prisma.asset.findMany({
      where: { hotelId, id: { in: ids } },
      select: { id: true, code: true, name: true, category: { select: { name: true } }, room: { select: { number: true } }, area: { select: { name: true } } },
    }),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({ id: row.id, code: row.code, name: row.name, categoryName: row.category.name, locationLabel: locationLabel(row) }));
  if (items.length === 0) throw new NotFoundError('Etiket için demirbaş bulunamadı');
  return { hotelName: hotel?.name ?? '', items };
}
