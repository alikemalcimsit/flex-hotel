import { currentActor } from '@hotelos/core';
import {
  SPA_MAX_ROOMS,
  SPA_MAX_SERVICES,
  SPA_MAX_THERAPISTS,
  spaMinuteOfDay,
  spaMissingTranslations,
  spaTimeOfMinute,
} from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, InUseError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { spaListPrice, spaTotal } from './rules.js';
import { dayBounds, iso, loadSpaSettings, money, prisma, settingsView, spaContext, wallParts, wallToUtc } from './shared.js';

/**
 * Spa tanımları (modül 57): ayar, oda, terapist (haftalık çalışma saatleri ve verebildiği hizmetler), hizmet
 * (uygun terapist ve odalar), izin / bakım blokları.
 *
 * - Yazımlar `updatedAt` ile iyimser kilitli; tanım sayıları sınırlı (`SPA_MAX_*`), listeler tek seferde döner.
 * - Silme soft-delete'tir ve **ileri tarihli işi olan** kayıt silinmez (randevusu olan terapist / oda, randevusu
 *   ya da seansı olan hizmet): önce işler taşınır. Kullanımdan kaldırmak (`isActive`) her zaman serbesttir: yeni
 *   randevu verilmez, mevcutlar kalır.
 * - Hizmetin süresi / fiyatı değişince mevcut randevular değişmez (randevu kendi kopyasını taşır).
 */

const endMinuteOf = (time) => (time === '24:00' ? 1440 : spaMinuteOfDay(time));

/* ══════════════════ Ayar ══════════════════ */

/** @param {string} hotelId */
export async function getSpaSettings(hotelId) {
  const [settings, context] = await Promise.all([loadSpaSettings(prisma, hotelId), spaContext(hotelId)]);
  return { settings: settingsView(settings), currency: context.currency, today: context.today };
}

/**
 * @param {string} hotelId
 * @param {{ expectedUpdatedAt: Date | null, openTime: string, closeTime: string, slotMinutes: number, freeCancelHours: number, lateCancelFeePct: string, noShowFeePct: string, portalEnabled: boolean, portalLeadMinutes: number, portalMaxActive: number, reminderHours: number }} input
 */
export async function saveSpaSettings(hotelId, input) {
  const actor = currentActor();
  const data = {
    openMinute: spaMinuteOfDay(input.openTime),
    closeMinute: endMinuteOf(input.closeTime),
    slotMinutes: input.slotMinutes,
    freeCancelHours: input.freeCancelHours,
    lateCancelFeePct: input.lateCancelFeePct,
    noShowFeePct: input.noShowFeePct,
    portalEnabled: input.portalEnabled,
    portalLeadMinutes: input.portalLeadMinutes,
    portalMaxActive: input.portalMaxActive,
    reminderHours: input.reminderHours,
    updatedBy: actor,
  };
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await tx.spaSettings.findUnique({ where: { hotelId } });
      if (before) {
        if (!input.expectedUpdatedAt || before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError();
        await tx.spaSettings.update({ where: { hotelId }, data });
      } else {
        if (input.expectedUpdatedAt) throw new StaleWriteError();
        await tx.spaSettings.create({ data: { hotelId, ...data } });
      }
      const pick = (row) => (row ? Object.fromEntries(Object.keys(data).filter((key) => key !== 'updatedBy').map((key) => [key, String(row[key])])) : null);
      await recordAudit(tx, { hotelId, entity: 'SpaSettings', entityId: hotelId, action: before ? 'UPDATE' : 'CREATE', before: pick(before), after: pick(data) });
      await stage('spa.setup.changed', { hotelId, entity: 'SETTINGS' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getSpaSettings(hotelId);
}

/* ══════════════════ Tanımların tamamı ══════════════════ */

const ROOM_SELECT = Object.freeze({ id: true, name: true, kind: true, isActive: true, sortOrder: true, updatedAt: true });
const THERAPIST_SELECT = Object.freeze({
  id: true,
  name: true,
  title: true,
  gender: true,
  phone: true,
  isActive: true,
  sortOrder: true,
  updatedAt: true,
  hours: { select: { weekday: true, startMinute: true, endMinute: true }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
  services: { select: { serviceId: true } },
});
const SERVICE_SELECT = Object.freeze({
  id: true,
  name: true,
  description: true,
  translations: true,
  category: true,
  kind: true,
  durationMinutes: true,
  bufferMinutes: true,
  price: true,
  therapistCount: true,
  guestCount: true,
  capacity: true,
  requiresRoom: true,
  portalBookable: true,
  isActive: true,
  sortOrder: true,
  updatedAt: true,
  therapists: { select: { therapistId: true } },
  rooms: { select: { roomId: true } },
});

/** @param {any} row */
const roomView = (row) => ({ id: row.id, name: row.name, kind: row.kind, isActive: row.isActive, sortOrder: row.sortOrder, updatedAt: iso(row.updatedAt) });

/** @param {any} row */
const therapistView = (row) => ({
  id: row.id,
  name: row.name,
  title: row.title,
  gender: row.gender,
  phone: row.phone,
  isActive: row.isActive,
  sortOrder: row.sortOrder,
  updatedAt: iso(row.updatedAt),
  hours: row.hours.map((hour) => ({ weekday: hour.weekday, start: spaTimeOfMinute(hour.startMinute), end: spaTimeOfMinute(hour.endMinute) })),
  serviceIds: row.services.map((link) => link.serviceId),
});

/**
 * @param {any} row @param {any[]} taxes
 * @param {{ therapists: Set<string>, rooms: Set<string> }} usable kullanımdaki terapist / oda kimlikleri
 */
const serviceView = (row, taxes, usable) => {
  const therapistIds = row.therapists.map((link) => link.therapistId);
  const roomIds = row.rooms.map((link) => link.roomId);
  const price = money(row.price);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    translations: row.translations ?? {},
    missingTranslations: spaMissingTranslations(row),
    category: row.category,
    kind: row.kind,
    durationMinutes: row.durationMinutes,
    bufferMinutes: row.bufferMinutes,
    price,
    /** Kişi başı, misafirin ödeyeceği (hariç vergiler eklenmiş). */
    priceTotal: spaTotal(price, taxes),
    /** Bir randevunun toplamı (çift masajında iki kişi). */
    bookingTotal: spaTotal(spaListPrice(price, row.guestCount), taxes),
    therapistCount: row.therapistCount,
    guestCount: row.guestCount,
    capacity: row.capacity,
    requiresRoom: row.requiresRoom,
    portalBookable: row.portalBookable,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    updatedAt: iso(row.updatedAt),
    therapistIds,
    roomIds,
    /** Kullanımdaki terapist / oda hizmete yetmiyor: randevu verilemez. */
    staffingIssue: therapistIds.filter((id) => usable.therapists.has(id)).length < row.therapistCount || (row.requiresRoom && !roomIds.some((id) => usable.rooms.has(id))),
  };
};

/**
 * Bütün tanımlar (takvim, formlar ve tanım ekranları tek istekle). Sayılar sınırlıdır.
 * @param {string} hotelId
 */
export async function getSpaSetup(hotelId) {
  const [context, settings, rooms, therapists, services] = await Promise.all([
    spaContext(hotelId),
    loadSpaSettings(prisma, hotelId),
    prisma.spaRoom.findMany({ where: { hotelId }, select: ROOM_SELECT, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: SPA_MAX_ROOMS }),
    prisma.spaTherapist.findMany({ where: { hotelId }, select: THERAPIST_SELECT, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: SPA_MAX_THERAPISTS }),
    prisma.spaService.findMany({ where: { hotelId }, select: SERVICE_SELECT, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take: SPA_MAX_SERVICES }),
  ]);
  const usable = { therapists: new Set(therapists.filter((row) => row.isActive).map((row) => row.id)), rooms: new Set(rooms.filter((row) => row.isActive).map((row) => row.id)) };
  return {
    settings: settingsView(settings),
    currency: context.currency,
    today: context.today,
    rooms: rooms.map(roomView),
    therapists: therapists.map(therapistView),
    services: services.map((row) => serviceView(row, context.taxes, usable)),
  };
}

/**
 * Kimlikler otelin silinmemiş kayıtları mı? Değilse alan hatası.
 * @param {any} tx @param {'spaTherapist' | 'spaRoom' | 'spaService'} model @param {string} hotelId @param {string[]} ids @param {string} field @param {string} label
 */
async function assertOwned(tx, model, hotelId, ids, field, label) {
  if (!ids.length) return;
  const count = await tx[model].count({ where: { hotelId, id: { in: ids } } });
  if (count !== ids.length) throw new ValidationError(`Seçilen ${label} arasında silinmiş ya da geçersiz olan var; sayfayı yenileyin.`, { field });
}

/** @param {any} tx @param {'spaTherapist' | 'spaRoom' | 'spaService'} model @param {string} hotelId @param {number} max @param {string} label */
async function assertRoom(tx, model, hotelId, max, label) {
  if ((await tx[model].count({ where: { hotelId } })) >= max) throw new ConflictError(`En fazla ${max} ${label} tanımlanabilir.`, 'SPA_LIMIT');
}

/**
 * İyimser kilitli güncelleme: sürüm tutmuyorsa "bayat", kayıt yoksa "bulunamadı".
 * @param {any} tx @param {'spaTherapist' | 'spaRoom' | 'spaService'} model @param {string} hotelId @param {string} id @param {Date} expected @param {object} data @param {string} label
 */
async function updateFresh(tx, model, hotelId, id, expected, data, label) {
  const { count } = await tx[model].updateMany({ where: { id, hotelId, updatedAt: expected }, data });
  if (count === 1) return;
  if (!(await tx[model].findFirst({ where: { id, hotelId }, select: { id: true } }))) throw new NotFoundError(`${label} bulunamadı`);
  throw new StaleWriteError();
}

/* ══════════════════ Oda ══════════════════ */

/** @param {string} hotelId @param {{ name: string, kind: string, isActive: boolean, sortOrder: number }} input */
export async function createSpaRoom(hotelId, input) {
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      await assertRoom(tx, 'spaRoom', hotelId, SPA_MAX_ROOMS, 'oda');
      const row = await tx.spaRoom.create({ data: { hotelId, ...input, createdBy: currentActor() }, select: { id: true } });
      await recordAudit(tx, { hotelId, entity: 'SpaRoom', entityId: row.id, action: 'CREATE', after: input });
      await stage('spa.setup.changed', { hotelId, entity: 'ROOM' });
      return row.id;
    });
    return roomView(await prisma.spaRoom.findFirst({ where: { id, hotelId }, select: ROOM_SELECT }));
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir spa odası zaten var.' });
  }
}

/** @param {string} hotelId @param {string} id @param {{ expectedUpdatedAt: Date, name: string, kind: string, isActive: boolean, sortOrder: number }} input */
export async function updateSpaRoom(hotelId, id, { expectedUpdatedAt, ...input }) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await tx.spaRoom.findFirst({ where: { id, hotelId }, select: ROOM_SELECT });
      await updateFresh(tx, 'spaRoom', hotelId, id, expectedUpdatedAt, input, 'Oda');
      await recordAudit(tx, { hotelId, entity: 'SpaRoom', entityId: id, action: 'UPDATE', before: before && { name: before.name, kind: before.kind, isActive: before.isActive, sortOrder: before.sortOrder }, after: input });
      await stage('spa.setup.changed', { hotelId, entity: 'ROOM' });
    });
    return roomView(await prisma.spaRoom.findFirst({ where: { id, hotelId }, select: ROOM_SELECT }));
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir spa odası zaten var.' });
  }
}

/**
 * Kaynağın (terapist / oda) ileri tarihli etkin randevu ve seans tutmaları.
 * @param {any} tx @param {{ therapistId?: string, roomId?: string }} where
 */
async function futureWork(tx, where) {
  const now = new Date();
  const [appointments, sessions] = await Promise.all([
    tx.spaHold.count({ where: { ...where, active: true, endsAt: { gt: now }, appointmentId: { not: null } } }),
    tx.spaHold.count({ where: { ...where, active: true, endsAt: { gt: now }, sessionId: { not: null } } }),
  ]);
  return { appointments, sessions };
}

/** @param {string} hotelId @param {string} id @param {{ expectedUpdatedAt: Date }} input */
export async function deleteSpaRoom(hotelId, id, { expectedUpdatedAt }) {
  await writeWithEvents(async (tx, stage) => {
    const before = await tx.spaRoom.findFirst({ where: { id, hotelId }, select: ROOM_SELECT });
    if (!before) throw new NotFoundError('Oda bulunamadı');
    const usage = await futureWork(tx, { roomId: id });
    if (usage.appointments || usage.sessions) throw new InUseError('Bu odada ileri tarihli randevu ya da ders var; önce onları başka odaya taşıyın (ya da odayı kullanımdan kaldırın).', usage);
    await updateFresh(tx, 'spaRoom', hotelId, id, expectedUpdatedAt, { deletedAt: new Date() }, 'Oda');
    await tx.spaServiceRoom.deleteMany({ where: { roomId: id } });
    await recordAudit(tx, { hotelId, entity: 'SpaRoom', entityId: id, action: 'DELETE', before: { name: before.name, kind: before.kind } });
    await stage('spa.setup.changed', { hotelId, entity: 'ROOM' });
  });
  return { deleted: true };
}

/* ══════════════════ Terapist ══════════════════ */

/** @param {Array<{ weekday: number, start: string, end: string }>} hours @param {string} hotelId @param {string} therapistId */
const hourRows = (hours, hotelId, therapistId) => hours.map((row) => ({ hotelId, therapistId, weekday: row.weekday, startMinute: spaMinuteOfDay(row.start), endMinute: endMinuteOf(row.end) }));

/** @param {any} input */
const therapistData = (input) => ({ name: input.name, title: input.title ?? null, gender: input.gender ?? null, phone: input.phone ?? null, isActive: input.isActive, sortOrder: input.sortOrder });

/** @param {any} input */
const therapistAudit = (input) => ({ ...therapistData(input), hours: input.hours.map((row) => `${row.weekday} ${row.start}-${row.end}`), serviceCount: input.serviceIds.length });

/** @param {string} hotelId @param {string} id */
const readTherapist = async (hotelId, id) => therapistView(await prisma.spaTherapist.findFirst({ where: { id, hotelId }, select: THERAPIST_SELECT }));

/** @param {string} hotelId @param {any} input */
export async function createSpaTherapist(hotelId, input) {
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      await assertRoom(tx, 'spaTherapist', hotelId, SPA_MAX_THERAPISTS, 'terapist');
      await assertOwned(tx, 'spaService', hotelId, input.serviceIds, 'serviceIds', 'hizmetler');
      const row = await tx.spaTherapist.create({ data: { hotelId, ...therapistData(input), createdBy: currentActor() }, select: { id: true } });
      if (input.hours.length) await tx.spaTherapistHour.createMany({ data: hourRows(input.hours, hotelId, row.id) });
      if (input.serviceIds.length) await tx.spaServiceTherapist.createMany({ data: input.serviceIds.map((serviceId) => ({ hotelId, serviceId, therapistId: row.id })) });
      await recordAudit(tx, { hotelId, entity: 'SpaTherapist', entityId: row.id, action: 'CREATE', after: therapistAudit(input) });
      await stage('spa.setup.changed', { hotelId, entity: 'THERAPIST' });
      return row.id;
    });
    return await readTherapist(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir terapist zaten var.' });
  }
}

/**
 * Çalışma saatleri ve hizmetler tümüyle yeniden yazılır. Çalışma saati daralınca mevcut randevular kalır (takvimde
 * görünür); yeni randevu yeni saatlere göre verilir.
 * @param {string} hotelId @param {string} id @param {any} input
 */
export async function updateSpaTherapist(hotelId, id, { expectedUpdatedAt, ...input }) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await tx.spaTherapist.findFirst({ where: { id, hotelId }, select: THERAPIST_SELECT });
      await assertOwned(tx, 'spaService', hotelId, input.serviceIds, 'serviceIds', 'hizmetler');
      await updateFresh(tx, 'spaTherapist', hotelId, id, expectedUpdatedAt, therapistData(input), 'Terapist');
      await tx.spaTherapistHour.deleteMany({ where: { therapistId: id } });
      if (input.hours.length) await tx.spaTherapistHour.createMany({ data: hourRows(input.hours, hotelId, id) });
      await tx.spaServiceTherapist.deleteMany({ where: { therapistId: id } });
      if (input.serviceIds.length) await tx.spaServiceTherapist.createMany({ data: input.serviceIds.map((serviceId) => ({ hotelId, serviceId, therapistId: id })) });
      const view = before ? therapistView(before) : null;
      await recordAudit(tx, {
        hotelId,
        entity: 'SpaTherapist',
        entityId: id,
        action: 'UPDATE',
        before: view && therapistAudit({ ...view, serviceIds: view.serviceIds }),
        after: therapistAudit(input),
      });
      await stage('spa.setup.changed', { hotelId, entity: 'THERAPIST' });
    });
    return await readTherapist(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir terapist zaten var.' });
  }
}

/** @param {string} hotelId @param {string} id @param {{ expectedUpdatedAt: Date }} input */
export async function deleteSpaTherapist(hotelId, id, { expectedUpdatedAt }) {
  await writeWithEvents(async (tx, stage) => {
    const before = await tx.spaTherapist.findFirst({ where: { id, hotelId }, select: { name: true } });
    if (!before) throw new NotFoundError('Terapist bulunamadı');
    const usage = await futureWork(tx, { therapistId: id });
    if (usage.appointments || usage.sessions) throw new InUseError('Bu terapistin ileri tarihli randevusu ya da dersi var; önce onları başkasına atayın (ya da terapisti kullanımdan kaldırın).', usage);
    await updateFresh(tx, 'spaTherapist', hotelId, id, expectedUpdatedAt, { deletedAt: new Date() }, 'Terapist');
    await tx.spaServiceTherapist.deleteMany({ where: { therapistId: id } });
    await recordAudit(tx, { hotelId, entity: 'SpaTherapist', entityId: id, action: 'DELETE', before: { name: before.name } });
    await stage('spa.setup.changed', { hotelId, entity: 'THERAPIST' });
  });
  return { deleted: true };
}

/* ══════════════════ Hizmet ══════════════════ */

/** @param {any} input */
const serviceData = (input) => ({
  name: input.name,
  description: input.description ?? null,
  translations: input.translations ?? {},
  category: input.category,
  kind: input.kind,
  durationMinutes: input.durationMinutes,
  bufferMinutes: input.bufferMinutes,
  price: input.price,
  therapistCount: input.therapistCount,
  guestCount: input.guestCount,
  capacity: input.capacity,
  requiresRoom: input.requiresRoom,
  portalBookable: input.portalBookable,
  isActive: input.isActive,
  sortOrder: input.sortOrder,
});

/** @param {any} input */
const serviceAudit = (input) => {
  const { translations: _translations, description: _description, ...rest } = serviceData(input);
  return { ...rest, price: money(rest.price), therapistCountSelected: input.therapistIds.length, roomCountSelected: input.roomIds.length };
};

/** @param {string} hotelId @param {string} id */
async function readService(hotelId, id) {
  const [context, row, therapists, rooms] = await Promise.all([
    spaContext(hotelId),
    prisma.spaService.findFirst({ where: { id, hotelId }, select: SERVICE_SELECT }),
    prisma.spaTherapist.findMany({ where: { hotelId, isActive: true }, select: { id: true } }),
    prisma.spaRoom.findMany({ where: { hotelId, isActive: true }, select: { id: true } }),
  ]);
  return serviceView(row, context.taxes, { therapists: new Set(therapists.map((item) => item.id)), rooms: new Set(rooms.map((item) => item.id)) });
}

/** @param {any} tx @param {string} hotelId @param {string} serviceId @param {any} input */
async function writeServiceLinks(tx, hotelId, serviceId, input) {
  await tx.spaServiceTherapist.deleteMany({ where: { serviceId } });
  await tx.spaServiceRoom.deleteMany({ where: { serviceId } });
  if (input.therapistIds.length) await tx.spaServiceTherapist.createMany({ data: input.therapistIds.map((therapistId) => ({ hotelId, serviceId, therapistId })) });
  if (input.roomIds.length) await tx.spaServiceRoom.createMany({ data: input.roomIds.map((roomId) => ({ hotelId, serviceId, roomId })) });
}

/** @param {string} hotelId @param {any} input */
export async function createSpaService(hotelId, input) {
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      await assertRoom(tx, 'spaService', hotelId, SPA_MAX_SERVICES, 'hizmet');
      await assertOwned(tx, 'spaTherapist', hotelId, input.therapistIds, 'therapistIds', 'terapistler');
      await assertOwned(tx, 'spaRoom', hotelId, input.roomIds, 'roomIds', 'odalar');
      const row = await tx.spaService.create({ data: { hotelId, ...serviceData(input), createdBy: currentActor() }, select: { id: true } });
      await writeServiceLinks(tx, hotelId, row.id, input);
      await recordAudit(tx, { hotelId, entity: 'SpaService', entityId: row.id, action: 'CREATE', after: serviceAudit(input) });
      await stage('spa.setup.changed', { hotelId, entity: 'SERVICE' });
      return row.id;
    });
    return await readService(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir hizmet zaten var.' });
  }
}

/**
 * Türü (birebir ↔ grup) randevusu ya da seansı olan hizmette değişmez: geçmiş kayıtlar anlamını yitirirdi.
 * @param {string} hotelId @param {string} id @param {any} input
 */
export async function updateSpaService(hotelId, id, { expectedUpdatedAt, ...input }) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await tx.spaService.findFirst({ where: { id, hotelId }, select: SERVICE_SELECT });
      if (!before) throw new NotFoundError('Hizmet bulunamadı');
      if (before.kind !== input.kind) {
        const [appointments, sessions] = await Promise.all([tx.spaAppointment.count({ where: { hotelId, serviceId: id }, take: 1 }), tx.spaSession.count({ where: { hotelId, serviceId: id }, take: 1 })]);
        if (appointments || sessions) throw new ValidationError('Bu hizmetin randevusu / seansı var; türü değiştirilemez. Yeni bir hizmet açın.', { field: 'kind' });
      }
      await assertOwned(tx, 'spaTherapist', hotelId, input.therapistIds, 'therapistIds', 'terapistler');
      await assertOwned(tx, 'spaRoom', hotelId, input.roomIds, 'roomIds', 'odalar');
      await updateFresh(tx, 'spaService', hotelId, id, expectedUpdatedAt, serviceData(input), 'Hizmet');
      await writeServiceLinks(tx, hotelId, id, input);
      await recordAudit(tx, {
        hotelId,
        entity: 'SpaService',
        entityId: id,
        action: 'UPDATE',
        before: serviceAudit({ ...before, therapistIds: before.therapists, roomIds: before.rooms }),
        after: serviceAudit(input),
      });
      await stage('spa.setup.changed', { hotelId, entity: 'SERVICE' });
    });
    return await readService(hotelId, id);
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir hizmet zaten var.' });
  }
}

/** @param {string} hotelId @param {string} id @param {{ expectedUpdatedAt: Date }} input */
export async function deleteSpaService(hotelId, id, { expectedUpdatedAt }) {
  await writeWithEvents(async (tx, stage) => {
    const before = await tx.spaService.findFirst({ where: { id, hotelId }, select: { name: true } });
    if (!before) throw new NotFoundError('Hizmet bulunamadı');
    const now = new Date();
    const [appointments, sessions] = await Promise.all([
      tx.spaAppointment.count({ where: { hotelId, serviceId: id, status: { in: ['BOOKED', 'WAITLISTED'] }, endsAt: { gt: now } } }),
      tx.spaSession.count({ where: { hotelId, serviceId: id, status: 'SCHEDULED', endsAt: { gt: now } } }),
    ]);
    if (appointments || sessions) throw new InUseError('Bu hizmetin ileri tarihli randevusu ya da seansı var; önce onları iptal edin (ya da hizmeti kullanımdan kaldırın).', { appointments, sessions });
    await updateFresh(tx, 'spaService', hotelId, id, expectedUpdatedAt, { deletedAt: now }, 'Hizmet');
    await recordAudit(tx, { hotelId, entity: 'SpaService', entityId: id, action: 'DELETE', before: { name: before.name } });
    await stage('spa.setup.changed', { hotelId, entity: 'SERVICE' });
  });
  return { deleted: true };
}

/* ══════════════════ Blok (izin, mola, bakım) ══════════════════ */

const BLOCK_SELECT = Object.freeze({
  id: true,
  therapistId: true,
  roomId: true,
  startsAt: true,
  endsAt: true,
  reason: true,
  createdBy: true,
  createdAt: true,
  therapist: { select: { name: true } },
  room: { select: { name: true } },
});

/** @param {any} row @param {string} timezone */
export const blockView = (row, timezone) => ({
  id: row.id,
  therapistId: row.therapistId,
  roomId: row.roomId,
  resourceName: row.therapist?.name ?? row.room?.name ?? null,
  startsAt: iso(row.startsAt),
  endsAt: iso(row.endsAt),
  startsAtWall: wallParts(row.startsAt, timezone).wall,
  endsAtWall: wallParts(row.endsAt, timezone).wall,
  reason: row.reason,
  createdBy: row.createdBy,
});

/**
 * Aralığa değen bloklar (başlangıca göre).
 * @param {string} hotelId @param {{ from: string, to: string, page: number, pageSize: number }} query
 */
export async function listSpaBlocks(hotelId, query) {
  const { timezone } = await spaContext(hotelId);
  const where = { hotelId, endsAt: { gt: dayBounds(query.from, timezone).start }, startsAt: { lt: dayBounds(query.to, timezone).end } };
  const [rows, total] = await Promise.all([
    prisma.spaBlock.findMany({ where, select: BLOCK_SELECT, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], ...toSkipTake(query) }),
    prisma.spaBlock.count({ where }),
  ]);
  return buildPage(rows.map((row) => blockView(row, timezone)), total, query);
}

/**
 * Blok açar. Aralıkta o kaynağın etkin randevusu / dersi varsa açılmaz (önce taşınır): izin girilirken randevular
 * sessizce sahipsiz kalmasın. Yarışı EXCLUDE kısıtı keser.
 * @param {string} hotelId @param {{ therapistId: string | null, roomId: string | null, startsAt: string, endsAt: string, reason: string }} input
 */
export async function createSpaBlock(hotelId, input) {
  const { timezone } = await spaContext(hotelId);
  const startsAt = wallToUtc(input.startsAt, timezone, 'startsAt');
  const endsAt = wallToUtc(input.endsAt, timezone, 'endsAt');
  if (endsAt <= startsAt) throw new ValidationError('Bitiş başlangıçtan sonra olmalı', { field: 'endsAt' });
  const resource = input.therapistId ? { therapistId: input.therapistId } : { roomId: /** @type {string} */ (input.roomId) };
  try {
    const id = await writeWithEvents(async (tx, stage) => {
      await assertOwned(tx, input.therapistId ? 'spaTherapist' : 'spaRoom', hotelId, [input.therapistId ?? /** @type {string} */ (input.roomId)], input.therapistId ? 'therapistId' : 'roomId', input.therapistId ? 'terapist' : 'oda');
      const busy = await tx.spaHold.findMany({
        where: { ...resource, active: true, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        select: { appointmentId: true, sessionId: true, blockId: true },
        take: 50,
      });
      if (busy.some((hold) => hold.blockId)) throw new ConflictError('Bu aralıkta zaten bir blok var.', 'SPA_BLOCK_CONFLICT');
      if (busy.length) {
        throw new ConflictError(`Bu aralıkta ${busy.length >= 50 ? '50+' : busy.length} randevu / ders var; önce onları taşıyın ya da iptal edin.`, 'SPA_BLOCK_CONFLICT', {
          appointments: busy.filter((hold) => hold.appointmentId).length,
          sessions: busy.filter((hold) => hold.sessionId).length,
        });
      }
      const block = await tx.spaBlock.create({ data: { hotelId, ...resource, startsAt, endsAt, reason: input.reason, createdBy: currentActor() }, select: { id: true } });
      await tx.spaHold.create({ data: { hotelId, ...resource, blockId: block.id, startsAt, endsAt } });
      await recordAudit(tx, { hotelId, entity: 'SpaBlock', entityId: block.id, action: 'CREATE', after: { ...resource, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason } });
      await stage('spa.setup.changed', { hotelId, entity: 'BLOCK' });
      return block.id;
    });
    return blockView(await prisma.spaBlock.findFirst({ where: { id, hotelId }, select: BLOCK_SELECT }), timezone);
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/** @param {string} hotelId @param {string} blockId */
export async function deleteSpaBlock(hotelId, blockId) {
  const { timezone } = await spaContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const before = await tx.spaBlock.findFirst({ where: { id: blockId, hotelId }, select: BLOCK_SELECT });
    if (!before) throw new NotFoundError('Blok bulunamadı');
    // Tutma satırı blokla birlikte silinir (ON DELETE CASCADE).
    await tx.spaBlock.delete({ where: { id: blockId } });
    const view = blockView(before, timezone);
    await recordAudit(tx, { hotelId, entity: 'SpaBlock', entityId: blockId, action: 'DELETE', before: { resource: view.resourceName, startsAt: view.startsAtWall, endsAt: view.endsAtWall, reason: view.reason } });
    await stage('spa.setup.changed', { hotelId, entity: 'BLOCK' });
  });
  return { deleted: true };
}
