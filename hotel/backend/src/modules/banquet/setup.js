import { currentActor } from '@hotelos/core';
import { MAX_EQUIPMENT, MAX_VENUES } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockEventEquipment, lockVenues } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { occupiedRange, peakUsage } from './rules.js';
import { iso, loadEventSettings, money, optionalMoney, prisma, tiersOf } from './shared.js';

/**
 * Banket tanımları (modül 37): salonlar, ekipman, müşteri kartı ve banket politikası.
 *
 * ### Bölünebilir salon
 *
 * İki seviye: bütün (parçaları olan salon) ve parçaları. Parçanın parçası olmaz;
 * parçaları olan salon başka bir salonun parçası olamaz. Bütün satılınca bütün
 * parçaları, parça satılınca bütün dolar (tutma satırları atomik parça başına).
 * Bir salonun bütün / parça yapısı, gelecekte tutması varken değiştirilemez
 * (eski tutmalar yeni yapıyla tutarsız kalırdı).
 */

const VENUE_SELECT = Object.freeze({
  id: true,
  code: true,
  name: true,
  description: true,
  parentId: true,
  areaSqm: true,
  hourlyRate: true,
  halfDayRate: true,
  dayRate: true,
  setupMinutes: true,
  teardownMinutes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  capacities: { select: { layout: true, capacity: true }, orderBy: { layout: 'asc' } },
  parent: { select: { id: true, code: true, name: true } },
  _count: { select: { parts: true } },
});

/** @param {any} row */
function toVenueDto(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    parentId: row.parentId,
    parent: row.parent ?? null,
    partCount: row._count?.parts ?? 0,
    areaSqm: optionalMoney(row.areaSqm),
    hourlyRate: optionalMoney(row.hourlyRate),
    halfDayRate: optionalMoney(row.halfDayRate),
    dayRate: optionalMoney(row.dayRate),
    setupMinutes: row.setupMinutes,
    teardownMinutes: row.teardownMinutes,
    status: row.status,
    capacities: row.capacities.map((entry) => ({ layout: entry.layout, capacity: entry.capacity })),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** @param {any} row */
const venueSnapshot = (row) => ({
  code: row.code,
  name: row.name,
  parentId: row.parentId ?? null,
  hourlyRate: optionalMoney(row.hourlyRate),
  halfDayRate: optionalMoney(row.halfDayRate),
  dayRate: optionalMoney(row.dayRate),
  setupMinutes: row.setupMinutes,
  teardownMinutes: row.teardownMinutes,
  status: row.status,
  capacities: [...row.capacities].sort((a, b) => a.layout.localeCompare(b.layout)).map((entry) => `${entry.layout}:${entry.capacity}`),
});

/**
 * Otelin salonları (sınırlı sayıda; takvim ve formlar hepsini ister). Bütünler ve
 * altlarında parçaları sırayla.
 * @param {string} hotelId
 * @param {{ includePassive?: boolean }} [options]
 */
export async function listVenues(hotelId, { includePassive = true } = {}) {
  const rows = await prisma.venue.findMany({
    where: { hotelId, ...(includePassive ? {} : { status: 'ACTIVE' }) },
    orderBy: [{ code: 'asc' }],
    take: MAX_VENUES,
    select: VENUE_SELECT,
  });
  // Bütünün hemen altında parçaları (takvimde girintili).
  const roots = rows.filter((row) => !row.parentId || !rows.some((candidate) => candidate.id === row.parentId));
  const ordered = [];
  for (const root of roots) {
    ordered.push(root);
    ordered.push(...rows.filter((row) => row.parentId === root.id));
  }
  return { items: ordered.map(toVenueDto) };
}

/**
 * Salon yapısı denetimi: parça yalnızca bütüne bağlanır (iki seviye).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string | null} parentId
 * @param {string | null} selfId
 */
async function assertParent(tx, hotelId, parentId, selfId) {
  if (!parentId) return;
  if (parentId === selfId) throw new ValidationError('Salon kendisinin parçası olamaz', { fields: { parentId: 'Salon kendisinin parçası olamaz' } });
  const parent = await tx.venue.findFirst({ where: { id: parentId, hotelId }, select: { id: true, parentId: true } });
  if (!parent) throw new ValidationError('Bütün salon bulunamadı', { fields: { parentId: 'Bütün salon bulunamadı' } });
  if (parent.parentId) throw new ValidationError('Parçanın parçası olmaz', { fields: { parentId: 'Seçilen salon zaten bir parça; bütünü seçin' } });
  if (selfId && (await tx.venue.count({ where: { parentId: selfId } })) > 0) {
    throw new ValidationError('Parçaları olan salon başka salonun parçası olamaz', { fields: { parentId: 'Bu salonun parçaları var; önce onları ayırın' } });
  }
}

/** @param {any} input */
const venueData = (input) => ({
  code: input.code,
  name: input.name,
  description: input.description ?? null,
  parentId: input.parentId ?? null,
  areaSqm: input.areaSqm,
  hourlyRate: input.hourlyRate,
  halfDayRate: input.halfDayRate,
  dayRate: input.dayRate,
  setupMinutes: input.setupMinutes,
  teardownMinutes: input.teardownMinutes,
});

/**
 * @param {string} hotelId
 * @param {any} input `createVenueSchema`
 */
export async function createVenue(hotelId, input) {
  const actor = currentActor();
  try {
    return await writeWithEvents(async (tx, stage) => {
      if ((await tx.venue.count({ where: { hotelId } })) >= MAX_VENUES) throw new ConflictError(`En fazla ${MAX_VENUES} salon tanımlanabilir`, 'LIMIT');
      await assertParent(tx, hotelId, input.parentId ?? null, null);
      const row = await tx.venue.create({
        data: { hotelId, ...venueData(input), createdBy: actor, capacities: { create: input.capacities } },
        select: VENUE_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'Venue', entityId: row.id, action: 'CREATE', after: venueSnapshot(row) });
      await stage('banquet.venue.changed', { hotelId, venueId: row.id, change: 'CREATED' });
      return toVenueDto(row);
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kodlu bir salon zaten var' });
  }
}

/**
 * Salonu günceller. Bütün / parça yapısı gelecekte tutması olan salonda değişmez;
 * pasife alınan salon yeni oturuma seçilemez (var olanlar etkilenmez).
 *
 * @param {string} hotelId
 * @param {string} venueId
 * @param {any} input `updateVenueSchema`
 */
export async function updateVenue(hotelId, venueId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const seed = await tx.venue.findFirst({ where: { id: venueId, hotelId }, select: { parentId: true } });
      if (!seed) throw new NotFoundError('Salon bulunamadı');
      // Salon, eski ve yeni bütünü kilitlenir: aynı anda bu salonlarda kesinleştirme (salon kilidi alır) beklesin.
      await lockVenues(tx, hotelId, [venueId, seed.parentId, input.parentId ?? null].filter(Boolean));
      const before = await tx.venue.findFirst({ where: { id: venueId, hotelId }, select: VENUE_SELECT });
      if (before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError();
      const parentId = input.parentId ?? null;
      if (parentId !== (before.parentId ?? null)) {
        await assertParent(tx, hotelId, parentId, venueId);
        const affected = [venueId, before.parentId, parentId].filter(Boolean);
        const future = await tx.eventVenueHold.count({ where: { hotelId, endAt: { gt: new Date() }, venueId: { in: affected } } });
        const futureParts = await tx.eventVenueHold.count({ where: { hotelId, endAt: { gt: new Date() }, venue: { parentId: { in: affected } } } });
        if (future + futureParts > 0) {
          throw new ConflictError('Bu salonun (ya da bütününün) ileri tarihli etkinliği var; bütün / parça yapısı şimdi değiştirilemez.', 'VENUE_IN_USE');
        }
      }
      await tx.venueCapacity.deleteMany({ where: { venueId } });
      const after = await tx.venue.update({
        where: { id: venueId },
        data: { ...venueData(input), status: input.status, capacities: { create: input.capacities } },
        select: VENUE_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'Venue', entityId: venueId, action: 'UPDATE', before: venueSnapshot(before), after: venueSnapshot(after) });
      await stage('banquet.venue.changed', { hotelId, venueId, change: 'UPDATED' });
      return toVenueDto(after);
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kodlu bir salon zaten var' });
  }
}

/* ══════════════════ Ekipman ══════════════════ */

const EQUIPMENT_SELECT = Object.freeze({ id: true, code: true, name: true, unitPrice: true, stockQuantity: true, isActive: true, createdAt: true, updatedAt: true });

/** @param {any} row */
const toEquipmentDto = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  unitPrice: money(row.unitPrice),
  stockQuantity: row.stockQuantity,
  isActive: row.isActive,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, active?: 'true' | 'false' }} query
 */
export async function listEquipment(hotelId, query) {
  const where = /** @type {Record<string, unknown>} */ ({ hotelId });
  if (query.active) where.isActive = query.active === 'true';
  const search = query.search?.trim();
  if (search) where.OR = [{ name: containsText(search) }, { code: containsText(search) }];
  const [rows, total] = await Promise.all([
    prisma.eventEquipment.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(query), select: EQUIPMENT_SELECT }),
    prisma.eventEquipment.count({ where }),
  ]);
  return buildPage(rows.map(toEquipmentDto), total, query);
}

/**
 * @param {string} hotelId
 * @param {any} input `createEquipmentSchema`
 */
export async function createEquipment(hotelId, input) {
  const actor = currentActor();
  try {
    return await writeWithEvents(async (tx, stage) => {
      if ((await tx.eventEquipment.count({ where: { hotelId } })) >= MAX_EQUIPMENT) throw new ConflictError(`En fazla ${MAX_EQUIPMENT} ekipman tanımlanabilir`, 'LIMIT');
      const row = await tx.eventEquipment.create({ data: { hotelId, ...input, createdBy: actor }, select: EQUIPMENT_SELECT });
      await recordAudit(tx, { hotelId, entity: 'EventEquipment', entityId: row.id, action: 'CREATE', after: toEquipmentDto(row) });
      await stage('banquet.equipment.changed', { hotelId, equipmentId: row.id, change: 'CREATED' });
      return toEquipmentDto(row);
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kodlu bir ekipman zaten var' });
  }
}

/**
 * Stok düşürülürken kesin etkinliklerin ileri tarihli ayrımları yeni stoğu aşamaz:
 * bitmemiş kesin oturumlardaki aynı anda en yüksek kullanım (kurulum / söküm dahil)
 * ekipman kilitliyken sayılır — kesinleştirme de aynı kilidi alır.
 *
 * @param {string} hotelId
 * @param {string} equipmentId
 * @param {any} input `updateEquipmentSchema`
 */
export async function updateEquipment(hotelId, equipmentId, input) {
  const { expectedUpdatedAt, ...data } = input;
  try {
    return await writeWithEvents(async (tx, stage) => {
      if (!(await lockEventEquipment(tx, hotelId, [equipmentId])).has(equipmentId)) throw new NotFoundError('Ekipman bulunamadı');
      const before = await tx.eventEquipment.findFirst({ where: { id: equipmentId, hotelId }, select: EQUIPMENT_SELECT });
      if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
      if (data.stockQuantity < before.stockQuantity) {
        const usages = await tx.eventItem.findMany({
          where: { hotelId, equipmentId, event: { status: 'DEFINITE' }, session: { endAt: { gt: new Date() } } },
          select: { quantity: true, session: { select: { startAt: true, endAt: true, setupMinutes: true, teardownMinutes: true } } },
        });
        const peak = peakUsage(usages.map((usage) => ({ quantity: Number(usage.quantity), ...occupiedRange(usage.session) })));
        if (peak > data.stockQuantity) {
          throw new ValidationError(`Kesin etkinliklerde aynı anda ${peak} adet ayrılmış; stok bunun altına düşürülemez`, { field: 'stockQuantity' });
        }
      }
      const after = await tx.eventEquipment.update({ where: { id: equipmentId }, data, select: EQUIPMENT_SELECT });
      await recordAudit(tx, { hotelId, entity: 'EventEquipment', entityId: equipmentId, action: 'UPDATE', before: toEquipmentDto(before), after: toEquipmentDto(after) });
      await stage('banquet.equipment.changed', { hotelId, equipmentId, change: 'UPDATED' });
      return toEquipmentDto(after);
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kodlu bir ekipman zaten var' });
  }
}

/* ══════════════════ Müşteri ══════════════════ */

const CLIENT_SELECT = Object.freeze({
  id: true,
  type: true,
  name: true,
  contactName: true,
  phone: true,
  email: true,
  taxOffice: true,
  taxNumber: true,
  address: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { events: true } },
});

/** @param {any} row */
const toClientDto = (row) => ({
  id: row.id,
  type: row.type,
  name: row.name,
  contactName: row.contactName,
  phone: row.phone,
  email: row.email,
  taxOffice: row.taxOffice,
  taxNumber: row.taxNumber,
  address: row.address,
  notes: row.notes,
  eventCount: row._count?.events ?? 0,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/** @param {any} row */
const clientSnapshot = (row) => {
  const { eventCount, createdAt, updatedAt, ...rest } = toClientDto(row);
  return rest;
};

/**
 * Müşteri listesi / seçici: ada, yetkiliye, telefona ya da vergi numarasına göre arama.
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string }} query
 */
export async function listClients(hotelId, query) {
  const where = /** @type {Record<string, unknown>} */ ({ hotelId });
  const search = query.search?.trim();
  if (search) {
    where.OR = [{ name: containsText(search) }, { contactName: containsText(search) }, { phone: { contains: search.replace(/\s+/g, '') } }, { taxNumber: search }];
  }
  const [rows, total] = await Promise.all([
    prisma.eventClient.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(query), select: CLIENT_SELECT }),
    prisma.eventClient.count({ where }),
  ]);
  return buildPage(rows.map(toClientDto), total, query);
}

/** @param {string} hotelId @param {string} clientId */
export async function getClient(hotelId, clientId) {
  const row = await prisma.eventClient.findFirst({ where: { id: clientId, hotelId }, select: CLIENT_SELECT });
  if (!row) throw new NotFoundError('Müşteri bulunamadı');
  return toClientDto(row);
}

/**
 * Aynı ada iki müşteri kartı açılmaz (büyük / küçük harf duyarsız): mükerrer kart
 * cari ve geçmişi böler.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} name
 * @param {string | null} exceptId
 */
async function assertClientUnique(tx, hotelId, name, exceptId) {
  const clash = await tx.eventClient.findFirst({
    where: { hotelId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ValidationError('Bu adla bir müşteri kartı zaten var; onu seçin', { fields: { name: 'Bu adla bir müşteri kartı zaten var' }, clientId: clash.id });
}

/**
 * @param {string} hotelId
 * @param {any} input `createEventClientSchema`
 */
export async function createClient(hotelId, input) {
  const actor = currentActor();
  return writeWithEvents(async (tx, stage) => {
    await assertClientUnique(tx, hotelId, input.name, null);
    const row = await tx.eventClient.create({ data: { hotelId, ...input, createdBy: actor }, select: CLIENT_SELECT });
    await recordAudit(tx, { hotelId, entity: 'EventClient', entityId: row.id, action: 'CREATE', after: clientSnapshot(row) });
    await stage('banquet.client.changed', { hotelId, clientId: row.id, change: 'CREATED' });
    return toClientDto(row);
  });
}

/**
 * @param {string} hotelId
 * @param {string} clientId
 * @param {any} input `updateEventClientSchema`
 */
export async function updateClient(hotelId, clientId, input) {
  const { expectedUpdatedAt, ...data } = input;
  return writeWithEvents(async (tx, stage) => {
    const before = await tx.eventClient.findFirst({ where: { id: clientId, hotelId }, select: CLIENT_SELECT });
    if (!before) throw new NotFoundError('Müşteri bulunamadı');
    if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
    await assertClientUnique(tx, hotelId, data.name, clientId);
    const after = await tx.eventClient.update({ where: { id: clientId }, data, select: CLIENT_SELECT });
    await recordAudit(tx, { hotelId, entity: 'EventClient', entityId: clientId, action: 'UPDATE', before: clientSnapshot(before), after: clientSnapshot(after) });
    await stage('banquet.client.changed', { hotelId, clientId, change: 'UPDATED' });
    return toClientDto(after);
  });
}

/* ══════════════════ Politika ══════════════════ */

/** @param {string} hotelId */
export function getSettings(hotelId) {
  return loadEventSettings(prisma, hotelId);
}

/**
 * Banket politikası (tek satır; ilk kayıtta açılır). Kesinleşmiş etkinlikler iptal
 * kademelerini kesinleştikleri anda kopyalamıştır: değişiklik onları etkilemez.
 *
 * @param {string} hotelId
 * @param {any} input `updateEventSettingsSchema`
 */
export async function updateSettings(hotelId, input) {
  const { expectedUpdatedAt, ...data } = input;
  await writeWithEvents(async (tx, stage) => {
    await tx.$executeRaw`SELECT 1 FROM "Hotel" WHERE "id" = ${hotelId} FOR UPDATE`;
    const before = await tx.eventSettings.findFirst({ where: { hotelId } });
    if (before && (!expectedUpdatedAt || before.updatedAt.getTime() !== expectedUpdatedAt.getTime())) throw new StaleWriteError();
    if (!before && expectedUpdatedAt) throw new StaleWriteError();
    const values = { ...data, cancellationTiers: data.cancellationTiers.map((tier) => ({ daysBefore: tier.daysBefore, feePct: tier.feePct })) };
    const after = before
      ? await tx.eventSettings.update({ where: { hotelId }, data: values })
      : await tx.eventSettings.create({ data: { hotelId, ...values } });
    await recordAudit(tx, {
      hotelId,
      entity: 'EventSettings',
      entityId: hotelId,
      action: before ? 'UPDATE' : 'CREATE',
      before: before ? { ...before, depositPct: money(before.depositPct), cancellationTiers: tiersOf(before.cancellationTiers) } : null,
      after: { ...after, depositPct: money(after.depositPct), cancellationTiers: tiersOf(after.cancellationTiers) },
    });
    await stage('banquet.settings.changed', { hotelId });
  });
  return getSettings(hotelId);
}
