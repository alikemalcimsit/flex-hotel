import { ConflictError, NotFoundError, rethrowPrismaError } from '../../lib/errors.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { employeeLabel, prisma, roomLabel } from './shared.js';

/**
 * Demirbaş tanımları (modül 46): kategori (varsayılan faydalı ömür) ve alan (oda dışı yer). Adlar otel içinde büyük /
 * küçük harf duyarsız tekildir. Kullanımdan kaldırılan tanım yeni kartta seçilemez; mevcut kartlar etkilenmez. Kullanımdaki
 * demirbaşın durduğu alan kaldırılamaz (önce taşınır).
 */

const DEFINITIONS = Object.freeze({
  category: { model: 'assetCategory', key: 'categoryId', change: 'CATEGORY', label: 'kategori', notFound: 'Kategori bulunamadı' },
  area: { model: 'assetArea', key: 'areaId', change: 'AREA', label: 'alan', notFound: 'Alan bulunamadı' },
});

/** Etkin demirbaş sayıları (tanım başına). @param {'category' | 'area'} kind @param {string} hotelId */
async function activeCounts(kind, hotelId) {
  const { key } = DEFINITIONS[kind];
  // Kategori zorunlu alan; alan boş olabilir (odadaki kart).
  const placed = kind === 'area' ? { areaId: { not: null } } : {};
  const groups = await prisma.asset.groupBy({ by: [key], where: { hotelId, status: 'ACTIVE', ...placed }, _count: { _all: true } });
  return new Map(groups.map((group) => [group[key], group._count._all]));
}

/**
 * @param {'category' | 'area'} kind
 * @param {string} hotelId
 * @param {{ includeInactive?: boolean }} query
 */
async function listDefinitions(kind, hotelId, { includeInactive = false }) {
  const { model } = DEFINITIONS[kind];
  const [rows, counts] = await Promise.all([
    prisma[model].findMany({ where: { hotelId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
    activeCounts(kind, hotelId),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      ...(kind === 'category' ? { usefulLifeYears: row.usefulLifeYears } : {}),
      isActive: row.isActive,
      assetCount: counts.get(row.id) ?? 0,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

/** Aynı adlı (harf duyarsız) başka tanım var mı. @param {any} tx @param {'category' | 'area'} kind */
async function assertUniqueName(tx, kind, hotelId, name, exceptId = null) {
  const { model, label } = DEFINITIONS[kind];
  const clash = await tx[model].findFirst({ where: { hotelId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (clash) throw new ConflictError(`Bu adla bir ${label} zaten var`, 'DUPLICATE');
}

/** @param {'category' | 'area'} kind @param {string} hotelId @param {Record<string, any>} input */
async function createDefinition(kind, hotelId, input) {
  const { model, change } = DEFINITIONS[kind];
  try {
    const row = await writeWithEvents(async (tx, stage) => {
      await assertUniqueName(tx, kind, hotelId, input.name);
      const created = await tx[model].create({ data: { hotelId, ...input } });
      await stage('asset.settings.changed', { hotelId, change });
      return created;
    });
    return { id: row.id };
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `Bu adla bir ${DEFINITIONS[kind].label} zaten var` });
  }
}

/** @param {'category' | 'area'} kind @param {string} hotelId @param {string} id @param {Record<string, any>} input */
async function updateDefinition(kind, hotelId, id, input) {
  const { model, key, change, notFound } = DEFINITIONS[kind];
  const { expectedUpdatedAt, ...data } = input;
  try {
    await writeWithEvents(async (tx, stage) => {
      const current = await tx[model].findFirst({ where: { id, hotelId }, select: { id: true } });
      if (!current) throw new NotFoundError(notFound);
      if (data.name) await assertUniqueName(tx, kind, hotelId, data.name, id);
      if (kind === 'area' && data.isActive === false) {
        const placed = await tx.asset.count({ where: { hotelId, [key]: id, status: 'ACTIVE' } });
        if (placed > 0) throw new ConflictError(`Bu alanda ${placed} demirbaş duruyor; kaldırmadan önce taşıyın`, 'AREA_IN_USE');
      }
      await updateWithVersionCheck(tx, model, { id, hotelId }, expectedUpdatedAt, data, notFound);
      await stage('asset.settings.changed', { hotelId, change });
    });
    return { id };
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `Bu adla bir ${DEFINITIONS[kind].label} zaten var` });
  }
}

export const listCategories = (hotelId, query) => listDefinitions('category', hotelId, query);
export const listAreas = (hotelId, query) => listDefinitions('area', hotelId, query);
export const createCategory = (hotelId, input) => createDefinition('category', hotelId, input);
export const createArea = (hotelId, input) => createDefinition('area', hotelId, input);
export const updateCategory = (hotelId, id, input) => updateDefinition('category', hotelId, id, input);
export const updateArea = (hotelId, id, input) => updateDefinition('area', hotelId, id, input);

/**
 * Form seçenekleri: etkin kategori ve alanlar, odalar, çalışan personel (zimmet).
 * @param {string} hotelId
 */
export async function getAssetOptions(hotelId) {
  const [categories, areas, rooms, employees] = await Promise.all([
    prisma.assetCategory.findMany({ where: { hotelId, isActive: true }, select: { id: true, name: true, usefulLifeYears: true }, orderBy: { name: 'asc' } }),
    prisma.assetArea.findMany({ where: { hotelId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.room.findMany({ where: { hotelId, deletedAt: null }, select: { id: true, number: true, floor: true }, orderBy: [{ floor: 'asc' }, { number: 'asc' }] }),
    prisma.employee.findMany({
      where: { hotelId, status: 'ACTIVE' },
      select: { id: true, code: true, firstName: true, lastName: true, department: { select: { name: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
  ]);
  return {
    categories,
    areas,
    rooms: rooms.map((room) => ({ ...room, label: roomLabel(room) })),
    employees: employees.map((employee) => ({
      id: employee.id,
      code: employee.code,
      name: `${employee.firstName} ${employee.lastName}`,
      label: employeeLabel(employee),
      departmentName: employee.department.name,
    })),
  };
}
