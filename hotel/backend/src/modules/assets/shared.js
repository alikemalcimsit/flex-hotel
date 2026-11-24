import { addDays, toIsoDay } from '@hotelos/core';
import { fromCents, toCents } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';

/**
 * Demirbaş modülünün (46) ortak parçaları: tutar / gün biçimi, yer ve zimmet adları, sıra numarası, kaydedilmiş
 * amortisman toplamları ve kart DTO'su.
 */

export { prisma };

/** Prisma Decimal / metin → "1250.50". @param {unknown} value */
export const money = (value) => (value == null ? null : fromCents(toCents(String(value))));
/** @param {Date | null | undefined} value */
export const isoDay = (value) => (value ? toIsoDay(value) : null);
/** "2026-03-15" → UTC gün başı. @param {string} day */
export const dayDate = (day) => new Date(`${day}T00:00:00.000Z`);
/** @param {Date} value */
export const yearOf = (value) => value.getUTCFullYear();

/** Otelin bugünü ("YYYY-AA-GG") ve yılı. @param {string} hotelId */
export async function businessToday(hotelId) {
  const date = await getBusinessDate(hotelId);
  return { date, day: toIsoDay(date), year: yearOf(date) };
}

/** İki gün arası gün farkı (b − a). @param {Date} from @param {Date} to */
export const daysBetween = (from, to) => Math.round((to.getTime() - from.getTime()) / 86_400_000);
export { addDays };

/* ─────────────── Adlar ─────────────── */

/** @param {{ number: string }} room */
export const roomLabel = (room) => `Oda ${room.number}`;
/** @param {{ firstName: string, lastName: string, code: string }} employee */
export const employeeLabel = (employee) => `${employee.firstName} ${employee.lastName} (${employee.code})`;
/** Kartın / sayımın yeri. @param {{ room?: { number: string } | null, area?: { name: string } | null }} row */
export const locationLabel = (row) => (row.room ? roomLabel(row.room) : (row.area?.name ?? null));

/**
 * Oda / alan kimliklerinden ad sözlüğü (sayım satırları gibi ilişkisiz anlık görüntüler için).
 * @param {any} client
 * @param {string} hotelId
 * @param {{ roomIds: (string | null)[], areaIds: (string | null)[] }} ids
 * @returns {Promise<(roomId: string | null, areaId: string | null) => string | null>}
 */
export async function locationNamer(client, hotelId, { roomIds, areaIds }) {
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const [rooms, areas] = await Promise.all([
    client.room.findMany({ where: { hotelId, id: { in: unique(roomIds) } }, select: { id: true, number: true } }),
    client.assetArea.findMany({ where: { hotelId, id: { in: unique(areaIds) } }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...rooms.map((room) => [room.id, roomLabel(room)]), ...areas.map((area) => [area.id, area.name])]);
  return (roomId, areaId) => names.get(roomId ?? areaId) ?? null;
}

/* ─────────────── Doğrulayıcı okumalar ─────────────── */

/**
 * Kartın yeri: silinmemiş oda ya da etkin alan (tam olarak biri; şema denetledi).
 * @param {any} client
 * @param {string} hotelId
 * @param {{ roomId?: string | null, areaId?: string | null }} location
 * @returns {Promise<{ roomId: string | null, areaId: string | null, label: string }>}
 */
export async function resolveLocation(client, hotelId, { roomId, areaId }) {
  if (roomId) {
    const room = await client.room.findFirst({ where: { id: roomId, hotelId, deletedAt: null }, select: { number: true } });
    if (!room) throw new ValidationError('Oda bulunamadı', { field: 'roomId' });
    return { roomId, areaId: null, label: roomLabel(room) };
  }
  const area = await client.assetArea.findFirst({ where: { id: areaId, hotelId }, select: { name: true, isActive: true } });
  if (!area || !area.isActive) throw new ValidationError('Alan bulunamadı ya da kullanımdan kalktı', { field: 'areaId' });
  return { roomId: null, areaId, label: area.name };
}

/**
 * Zimmet alacak personel: bu otelde çalışan (ayrılmamış) personel kartı.
 * @param {any} client @param {string} hotelId @param {string} employeeId
 */
export async function resolveEmployee(client, hotelId, employeeId) {
  const employee = await client.employee.findFirst({
    where: { id: employeeId, hotelId },
    select: { id: true, code: true, firstName: true, lastName: true, status: true },
  });
  if (!employee) throw new ValidationError('Personel bulunamadı', { field: 'employeeId' });
  if (employee.status !== 'ACTIVE') throw new ValidationError('Ayrılmış personele zimmet verilemez', { field: 'employeeId' });
  return { id: employee.id, label: employeeLabel(employee) };
}

/** Etkin kategori. @param {any} client @param {string} hotelId @param {string} categoryId */
export async function resolveCategory(client, hotelId, categoryId) {
  const category = await client.assetCategory.findFirst({ where: { id: categoryId, hotelId }, select: { id: true, name: true, usefulLifeYears: true, isActive: true } });
  if (!category || !category.isActive) throw new ValidationError('Kategori bulunamadı ya da kullanımdan kalktı', { field: 'categoryId' });
  return category;
}

/**
 * Kart (yazma için; kilit çağıran tarafta alınmış olmalı). Elden çıkarılmış kart değişmez.
 * @param {any} tx @param {string} hotelId @param {string} assetId
 * @param {{ allowDisposed?: boolean }} [options]
 */
export async function loadAsset(tx, hotelId, assetId, { allowDisposed = false } = {}) {
  const asset = await tx.asset.findFirst({
    where: { id: assetId, hotelId },
    include: { room: { select: { number: true } }, area: { select: { name: true } }, employee: { select: { code: true, firstName: true, lastName: true } } },
  });
  if (!asset) throw new NotFoundError('Demirbaş bulunamadı');
  if (!allowDisposed && asset.status !== 'ACTIVE') throw new ConflictError('Demirbaş elden çıkarılmış; kartı değiştirilemez', 'ASSET_DISPOSED');
  return asset;
}

/* ─────────────── Sıra numarası ─────────────── */

/**
 * Sıradaki numara(lar): `count` kadar ayırır, ilkini döner. Demirbaş kodu `year = 0` (kesintisiz), sayım yıllık.
 * @param {any} tx @param {string} hotelId @param {'ASSET' | 'COUNT'} kind @param {number} year @param {number} [count]
 */
export async function nextSequence(tx, hotelId, kind, year, count = 1) {
  const [row] = await tx.$queryRaw`
    INSERT INTO "AssetSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, ${kind}, ${year}, ${count})
    ON CONFLICT ("hotelId", "kind", "year") DO UPDATE SET "last" = "AssetSequence"."last" + ${count}
    RETURNING "last"`;
  return row.last - count + 1;
}

/* ─────────────── Kaydedilmiş amortisman ─────────────── */

/**
 * Kartların kaydedilmiş amortisman toplamı (kuruş) ve son kaydedilmiş yılı.
 * @param {any} client @param {string[]} assetIds
 * @returns {Promise<Map<string, { cents: bigint, lastYear: number }>>}
 */
export async function postedByAsset(client, assetIds) {
  if (assetIds.length === 0) return new Map();
  const groups = await client.assetDepreciation.groupBy({
    by: ['assetId'],
    where: { assetId: { in: assetIds } },
    _sum: { amount: true },
    _max: { year: true },
  });
  return new Map(groups.map((group) => [group.assetId, { cents: toCents(String(group._sum.amount ?? 0)), lastYear: group._max.year }]));
}

/**
 * Birikmiş amortisman = açılış + kaydedilmiş yıllar.
 * @param {{ openingAccumulated: unknown }} asset @param {{ cents: bigint } | undefined} posted
 */
export const accumulatedCents = (asset, posted) => toCents(String(asset.openingAccumulated)) + (posted?.cents ?? 0n);

/** Kartın amortismanla kapanmış son yılı (açılış ya da kayıt). @param {{ openingThroughYear: number | null }} asset @param {{ lastYear: number } | undefined} posted */
export const lastCoveredYear = (asset, posted) => Math.max(asset.openingThroughYear ?? -Infinity, posted?.lastYear ?? -Infinity);

/* ─────────────── Liste DTO'su ─────────────── */

export const ASSET_ROW_SELECT = Object.freeze({
  id: true,
  code: true,
  name: true,
  brand: true,
  model: true,
  serialNumber: true,
  status: true,
  purchaseDate: true,
  cost: true,
  openingAccumulated: true,
  warrantyUntil: true,
  roomId: true,
  areaId: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  room: { select: { number: true } },
  area: { select: { name: true } },
  employee: { select: { id: true, code: true, firstName: true, lastName: true } },
});

/**
 * @param {any} row `ASSET_ROW_SELECT` satırı
 * @param {{ cents: bigint } | undefined} posted
 */
export function toAssetRow(row, posted) {
  const accumulated = accumulatedCents(row, posted);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serialNumber,
    status: row.status,
    category: row.category,
    location: { roomId: row.roomId, areaId: row.areaId, label: locationLabel(row) },
    employee: row.employee ? { id: row.employee.id, code: row.employee.code, name: `${row.employee.firstName} ${row.employee.lastName}` } : null,
    purchaseDate: isoDay(row.purchaseDate),
    cost: money(row.cost),
    accumulated: fromCents(accumulated),
    bookValue: fromCents(toCents(String(row.cost)) - accumulated),
    warrantyUntil: isoDay(row.warrantyUntil),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Kartın hareket satırı (ekle-yalnız).
 * @param {any} tx
 * @param {{ hotelId: string, assetId: string, kind: string, fromLabel?: string | null, toLabel?: string | null, note?: string | null, countId?: string | null, actor: string }} movement
 */
export function addMovement(tx, movement) {
  return tx.assetMovement.create({ data: { fromLabel: null, toLabel: null, note: null, countId: null, ...movement } });
}
