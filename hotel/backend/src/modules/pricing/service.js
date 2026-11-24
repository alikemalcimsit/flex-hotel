import { toMoneyString } from '@hotelos/core';
import { cache } from '../../lib/cache.js';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { NotFoundError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { assertNoRatePlanOverlap } from './rules.js';

/**
 * Fiyatlandırma servisi (modül 28): fiyat planları ve paketler.
 *
 * Sezonlar gibi iki tür okuma var:
 * 1. **Yönetim listeleri** (`listRatePlans`, `listPackages`) — admin ekranı,
 *    filtreli / sayfalı, cache'siz.
 * 2. **Sıcak okumalar** (`getActiveRatePlans`, `getActivePackages`) — fiyat
 *    hesabı her rezervasyonda çağırır; cache'lenir. Geçersiz kılma `settings.`
 *    önekli event'leri dinleyerek olur (bkz. `lib/events.js`); bu yüzden
 *    yazmalar `settings.rate_plan.*` / `settings.package.*` yayınlar ve cache
 *    anahtarı `settings:${hotelId}:...` önekindedir.
 */

const HOT_READ_TTL_MS = 5 * 60_000;

// Para alanları her zaman iki ondalıkla döner (Prisma Decimal.toString() sondaki
// sıfırları atar: "3000.00" → "3000"); ekranlar ve API tutarlı olsun.
const money = (value) => toMoneyString(value.toString());
const toIsoDay = (value) => value.toISOString().slice(0, 10);

/* ══════════════════ DTO ══════════════════ */

/** @param {Record<string, any>} row */
function toRatePlanDto(row) {
  return {
    id: row.id,
    roomTypeId: row.roomTypeId,
    roomTypeName: row.roomType?.name ?? null,
    name: row.name,
    boardType: row.boardType,
    startDate: toIsoDay(row.startDate),
    endDate: toIsoDay(row.endDate),
    price: money(row.price),
    baseOccupancy: row.baseOccupancy,
    extraAdultRate: money(row.extraAdultRate),
    childRate: money(row.childRate),
    minStay: row.minStay ?? null,
    isActive: row.isActive,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** @param {Record<string, any>} row */
function toPackageDto(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    boardType: row.boardType,
    nightlyPrice: money(row.nightlyPrice),
    components: Array.isArray(row.components) ? row.components : [],
    isActive: row.isActive,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Fiyat hesabının gördüğü sade plan (saf kural `priceStay` bunu bekler). */
function toRatePlanRate(row) {
  return {
    roomTypeId: row.roomTypeId,
    boardType: row.boardType,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    price: money(row.price),
    baseOccupancy: row.baseOccupancy,
    extraAdultRate: money(row.extraAdultRate),
    childRate: money(row.childRate),
    isActive: row.isActive,
    deletedAt: row.deletedAt ?? null,
  };
}

/** Denetim izi anlık görüntüsü: türetilmiş `roomTypeName` ayıklanır. */
function toRatePlanSnapshot({ roomTypeName, ...rest }) {
  return rest;
}

/* ══════════════════ Sıcak okumalar ══════════════════ */

/**
 * Otelin yayındaki (aktif, silinmemiş) fiyat planları — fiyat hesabı bunları
 * her rezervasyonda tüketir (bkz. reservations `priceStay`).
 * @param {string} hotelId
 */
export async function getActiveRatePlans(hotelId) {
  return cache.getOrSet(
    `settings:${hotelId}:ratePlans`,
    async () => {
      const rows = await prisma.ratePlan.findMany({
        where: { hotelId, deletedAt: null, isActive: true },
        orderBy: [{ startDate: 'asc' }],
      });
      return rows.map(toRatePlanRate);
    },
    HOT_READ_TTL_MS,
  );
}

/**
 * Otelin yayındaki paketleri — rezervasyon formu seçici ve fiyat hesabı için.
 * @param {string} hotelId
 */
export async function getActivePackages(hotelId) {
  return cache.getOrSet(
    `settings:${hotelId}:packages`,
    async () => {
      const rows = await prisma.package.findMany({
        where: { hotelId, deletedAt: null, isActive: true },
        orderBy: [{ name: 'asc' }],
      });
      return rows.map(toPackageDto);
    },
    HOT_READ_TTL_MS,
  );
}

/* ══════════════════ Fiyat planları: yönetim ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, roomTypeId?: string, boardType?: string, active?: boolean }} query
 */
export async function listRatePlans(hotelId, query) {
  const where = {
    hotelId,
    deletedAt: null,
    ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
    ...(query.boardType ? { boardType: query.boardType } : {}),
    ...(query.active === undefined ? {} : { isActive: query.active }),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.ratePlan.findMany({
      where,
      orderBy: [{ roomTypeId: 'asc' }, { boardType: 'asc' }, { startDate: 'asc' }],
      include: { roomType: { select: { name: true } } },
      ...toSkipTake(query),
    }),
    prisma.ratePlan.count({ where }),
  ]);

  return buildPage(items.map(toRatePlanDto), total, query);
}

/**
 * Aynı oda tipi + pansiyon için dönemi çakışan yayındaki planlar — yalnız onlar
 * okunur; EXCLUDE kısıtı garantidir.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
function findOverlappingPlans(tx, hotelId, candidate) {
  return tx.ratePlan.findMany({
    where: {
      hotelId,
      deletedAt: null,
      roomTypeId: candidate.roomTypeId,
      boardType: candidate.boardType,
      ...(candidate.id ? { id: { not: candidate.id } } : {}),
      startDate: { lte: candidate.endDate },
      endDate: { gte: candidate.startDate },
    },
    select: { id: true, name: true, boardType: true, startDate: true, endDate: true },
    orderBy: [{ startDate: 'asc' }],
    take: 1,
  });
}

/** Planın etkilediği günler ve oda tipi (`rate.changed` için). */
function ratePlanRateChange(hotelId, plans, reason) {
  const roomTypeIds = [...new Set(plans.map((plan) => plan.roomTypeId))];
  const from = plans.map((plan) => toIsoDay(plan.startDate)).sort()[0];
  const to = plans.map((plan) => toIsoDay(plan.endDate)).sort().at(-1);
  return { hotelId, roomTypeIds, from, to, reason: reason.slice(0, 200) };
}

async function loadRatePlanWithType(tx, where) {
  return tx.ratePlan.findFirst({ where, include: { roomType: { select: { name: true } } } });
}

/**
 * @param {string} hotelId
 * @param {object} input `ratePlanInputSchema` çıktısı
 */
export async function createRatePlan(hotelId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      await assertRoomTypeExists(tx, hotelId, input.roomTypeId);
      assertNoRatePlanOverlap(await findOverlappingPlans(tx, hotelId, input), input);

      const created = await tx.ratePlan.create({ data: { hotelId, ...input } });
      const dto = toRatePlanDto(await loadRatePlanWithType(tx, { id: created.id }));

      await recordAudit(tx, { hotelId, entity: 'RatePlan', entityId: created.id, action: 'CREATE', after: toRatePlanSnapshot(dto) });
      await stage('settings.rate_plan.created', { hotelId, id: created.id, label: dto.name });
      await stage('rate.changed', ratePlanRateChange(hotelId, [created], `Fiyat planı açıldı: ${dto.name}`));

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} id
 * @param {object} input `updateRatePlanSchema` çıktısı
 */
export async function updateRatePlan(hotelId, id, input) {
  const { expectedUpdatedAt, ...data } = input;

  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.ratePlan.findFirst({ where: { id, hotelId, deletedAt: null } });
      if (!before) throw new NotFoundError('Fiyat planı bulunamadı');

      await assertRoomTypeExists(tx, hotelId, data.roomTypeId);
      assertNoRatePlanOverlap(await findOverlappingPlans(tx, hotelId, { ...data, id }), { ...data, id });

      await updateWithVersionCheck(tx, 'ratePlan', { id, hotelId }, expectedUpdatedAt, data, 'Fiyat planı bulunamadı');

      const after = await loadRatePlanWithType(tx, { id });
      const dto = toRatePlanDto(after);
      const changedFields = await recordAudit(tx, {
        hotelId,
        entity: 'RatePlan',
        entityId: id,
        action: 'UPDATE',
        before: toRatePlanSnapshot(toRatePlanDto({ ...before, roomType: null })),
        after: toRatePlanSnapshot(dto),
      });
      await stage('settings.rate_plan.updated', { hotelId, id, label: dto.name, changedFields });
      // Tarih / fiyat / kişi farkı / pansiyon değişince satış fiyatı değişir: eski ve yeni dönem.
      if (changedFields.some((field) => ['startDate', 'endDate', 'price', 'boardType', 'baseOccupancy', 'extraAdultRate', 'childRate', 'isActive'].includes(field))) {
        await stage('rate.changed', ratePlanRateChange(hotelId, [before, after], `Fiyat planı değişti: ${dto.name}`));
      }

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} id
 */
export async function deleteRatePlan(hotelId, id) {
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.ratePlan.findFirst({ where: { id, hotelId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Fiyat planı bulunamadı');

    await tx.ratePlan.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await recordAudit(tx, { hotelId, entity: 'RatePlan', entityId: id, action: 'DELETE', before: toRatePlanSnapshot(toRatePlanDto({ ...existing, roomType: null })) });
    await stage('settings.rate_plan.deleted', { hotelId, id, label: existing.name });
    await stage('rate.changed', ratePlanRateChange(hotelId, [existing], `Fiyat planı silindi: ${existing.name}`));
  });
}

/* ══════════════════ Paketler: yönetim ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, boardType?: string, active?: boolean }} query
 */
export async function listPackages(hotelId, query) {
  const where = {
    hotelId,
    deletedAt: null,
    ...(query.boardType ? { boardType: query.boardType } : {}),
    ...(query.active === undefined ? {} : { isActive: query.active }),
    ...(query.search
      ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.package.findMany({ where, orderBy: [{ name: 'asc' }], ...toSkipTake(query) }),
    prisma.package.count({ where }),
  ]);

  return buildPage(items.map(toPackageDto), total, query);
}

/**
 * @param {string} hotelId
 * @param {object} input `packageInputSchema` çıktısı
 */
export async function createPackage(hotelId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const created = await tx.package.create({ data: { hotelId, ...input, components: input.components ?? [] } });
      const dto = toPackageDto(created);

      await recordAudit(tx, { hotelId, entity: 'Package', entityId: created.id, action: 'CREATE', after: dto });
      await stage('settings.package.created', { hotelId, id: created.id, label: dto.name });

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} id
 * @param {object} input `updatePackageSchema` çıktısı
 */
export async function updatePackage(hotelId, id, input) {
  const { expectedUpdatedAt, ...data } = input;

  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.package.findFirst({ where: { id, hotelId, deletedAt: null } });
      if (!before) throw new NotFoundError('Paket bulunamadı');

      await updateWithVersionCheck(tx, 'package', { id, hotelId }, expectedUpdatedAt, { ...data, components: data.components ?? [] }, 'Paket bulunamadı');

      const after = await tx.package.findFirst({ where: { id } });
      const dto = toPackageDto(after);
      const changedFields = await recordAudit(tx, {
        hotelId,
        entity: 'Package',
        entityId: id,
        action: 'UPDATE',
        before: toPackageDto(before),
        after: dto,
      });
      await stage('settings.package.updated', { hotelId, id, label: dto.name, changedFields });

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} id
 */
export async function deletePackage(hotelId, id) {
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.package.findFirst({ where: { id, hotelId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Paket bulunamadı');

    await tx.package.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await recordAudit(tx, { hotelId, entity: 'Package', entityId: id, action: 'DELETE', before: toPackageDto(existing) });
    await stage('settings.package.deleted', { hotelId, id, label: existing.name });
  });
}

/* ══════════════════ Yardımcı ══════════════════ */

async function assertRoomTypeExists(tx, hotelId, roomTypeId) {
  if (!roomTypeId) return;
  const type = await tx.roomType.findFirst({ where: { id: roomTypeId, hotelId, deletedAt: null }, select: { id: true } });
  if (!type) throw new NotFoundError('Seçilen oda tipi bulunamadı ya da silinmiş');
}
