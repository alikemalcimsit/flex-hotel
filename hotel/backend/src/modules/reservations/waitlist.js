import { currentActor, toIsoDay, toUtcDayStart } from '@hotelos/core';
import { RESERVATION_COUNT_CAP, WAITLIST_OPEN_STATUSES } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { lockWaitlistEntries } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { availabilityForStay, buildAvailabilityCalendar, fitsCapacity } from '../rooms/rules.js';
import { loadInventorySnapshot } from '../rooms/service.js';
import { getActiveRoomTypes, getHotelSettings } from '../settings/service.js';
import { storablePhone } from './guests.js';
import { chunkByWindow } from './rules.js';

/**
 * Bekleme listesi (modül 4): yer yokken misafir "listeye alınır"; yer
 * açılınca personelin ziline uyarı düşer, personel misafiri arayıp
 * rezervasyona çevirir.
 *
 * ### Yer açıldığını kim fark eder
 *
 * İptal, gelmedi, tarih kısaltma, arıza kaydının kalkması, yeni oda gibi
 * envanteri artırabilen her olaydan sonra otelin açık kayıtları taranır
 * (`subscribers.js`, otel başına birleştirilerek). Olay kaçarsa zamanlanmış
 * tarama (`jobs.js`) yakalar ve tarihi geçen kayıtları kapatır.
 *
 * Tarama gece gece bakar: kaydın her gecesinde en az bir yer olmalı.
 * Kayıtlar tarih penceresine göre gruplanıp her pencere için envanter tek
 * sorguda okunur (kayıt başına sorgu yok).
 *
 * Yer yeniden dolarsa kayıt "yer bekliyor"a döner; uyarı yalnızca bekleyenden
 * yer açılana geçişte gider (aynı açılış için ikinci uyarı yok).
 */

const DAY_MS = 86_400_000;

/** Bir taramada bakılan en fazla açık kayıt (en yakın giriş önce). */
const REFRESH_BATCH = 500;
/** Tek seferde kapatılan tarihi geçmiş kayıt. */
const EXPIRE_BATCH = 200;

const ENTRY_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  guestId: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  roomTypeId: true,
  checkIn: true,
  checkOut: true,
  adults: true,
  children: true,
  boardType: true,
  notes: true,
  status: true,
  availableSince: true,
  reservationId: true,
  closedAt: true,
  closedBy: true,
  closeReason: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  roomType: { select: { id: true, code: true, name: true } },
  reservation: { select: { id: true, confirmationCode: true } },
});

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);

/** @param {object} row */
function toEntryDto(row) {
  return {
    id: row.id,
    guestId: row.guestId,
    name: `${row.firstName} ${row.lastName}`.trim(),
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    email: row.email,
    roomType: row.roomType,
    checkIn: toIsoDay(row.checkIn),
    checkOut: toIsoDay(row.checkOut),
    nights: Math.round((toUtcDayStart(row.checkOut) - toUtcDayStart(row.checkIn)) / DAY_MS),
    adults: row.adults,
    children: row.children,
    boardType: row.boardType,
    notes: row.notes,
    status: row.status,
    availableSince: iso(row.availableSince),
    reservation: row.reservation,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    closedAt: iso(row.closedAt),
    closedBy: row.closedBy,
    closeReason: row.closeReason,
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, status?: string, open?: boolean, roomTypeId?: string }} query
 */
export async function listWaitlist(hotelId, query) {
  const open = query.status ? false : query.open !== false;
  const where = {
    hotelId,
    ...(query.status ? { status: query.status } : open ? { status: { in: [...WAITLIST_OPEN_STATUSES] } } : {}),
    ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
  };
  // Açık kayıtlar en yakın girişten; kapanmışlar en yeniden.
  const orderBy = open ? [{ checkIn: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }];
  const [rows, counted] = await Promise.all([
    prisma.waitlistEntry.findMany({ where, orderBy, ...toSkipTake(query), select: ENTRY_SELECT }),
    prisma.waitlistEntry.count({ where, orderBy, take: RESERVATION_COUNT_CAP + 1 }),
  ]);
  const totalCapped = counted > RESERVATION_COUNT_CAP;
  const page = buildPage(rows.map(toEntryDto), totalCapped ? RESERVATION_COUNT_CAP : counted, query);
  const available = open ? await prisma.waitlistEntry.count({ where: { hotelId, status: 'AVAILABLE' } }) : null;
  return { ...page, meta: { ...page.meta, totalCapped, available } };
}

/**
 * @param {string} hotelId
 * @param {string} waitlistId
 */
export async function getWaitlistEntry(hotelId, waitlistId) {
  const row = await prisma.waitlistEntry.findFirst({ where: { id: waitlistId, hotelId }, select: ENTRY_SELECT });
  if (!row) throw new NotFoundError('Bekleme listesi kaydı bulunamadı');
  return toEntryDto(row);
}

/**
 * Listeye alır. Kayıt açılır açılmaz bir kez taranır: yer zaten varsa
 * "yer açıldı" olarak döner (personel doğrudan rezervasyon açabilir).
 *
 * @param {string} hotelId
 * @param {object} input `createWaitlistSchema` çıktısı
 */
export async function createWaitlistEntry(hotelId, input) {
  const [hotel, businessDate, roomTypes] = await Promise.all([
    getHotelSettings(hotelId),
    getBusinessDate(hotelId),
    getActiveRoomTypes(hotelId),
  ]);
  const type = roomTypes.find((row) => row.id === input.roomTypeId);
  if (!type) throw new ValidationError('Seçilen oda tipi bulunamadı ya da silinmiş', { field: 'roomTypeId' });
  if (!fitsCapacity(input, type)) {
    throw new ValidationError(`${type.name} en fazla ${type.capacityAdults} yetişkin ve ${type.capacityChildren} çocuk alır`, {
      field: 'adults',
    });
  }
  if (toUtcDayStart(input.checkIn) < businessDate.getTime()) {
    throw new ValidationError('Geçmiş tarih için bekleme listesine alınamaz', { field: 'checkIn' });
  }

  const created = await writeWithEvents(async (tx, stage) => {
    if (input.guestId) {
      const guest = await tx.guest.findFirst({ where: { id: input.guestId, hotelId }, select: { id: true } });
      if (!guest) throw new NotFoundError('Seçilen misafir kartı bulunamadı');
    }
    const row = await tx.waitlistEntry.create({
      data: {
        hotelId,
        guestId: input.guestId ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: storablePhone(input.phone, hotel.phoneCountryCode),
        email: input.email ?? null,
        roomTypeId: input.roomTypeId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        adults: input.adults,
        children: input.children ?? 0,
        boardType: input.boardType,
        notes: input.notes ?? null,
        createdBy: currentActor(),
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'WaitlistEntry',
      entityId: row.id,
      action: 'CREATE',
      after: { roomTypeId: input.roomTypeId, checkIn: toIsoDay(input.checkIn), checkOut: toIsoDay(input.checkOut), status: 'WAITING' },
    });
    await stage('waitlist.changed', { hotelId, waitlistId: row.id, status: 'WAITING' });
    return row;
  });

  await refreshWaitlist(hotelId, { entryIds: [created.id], alert: false });
  return getWaitlistEntry(hotelId, created.id);
}

/**
 * Kaydı kapatır (misafir vazgeçti, başka yerde kaldı).
 * @param {string} hotelId
 * @param {string} waitlistId
 * @param {{ reason: string }} input
 */
export async function closeWaitlistEntry(hotelId, waitlistId, { reason }) {
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockWaitlistEntries(tx, hotelId, [waitlistId])).has(waitlistId)) {
      throw new NotFoundError('Bekleme listesi kaydı bulunamadı');
    }
    const entry = await tx.waitlistEntry.findFirst({ where: { id: waitlistId, hotelId }, select: { status: true } });
    if (!WAITLIST_OPEN_STATUSES.includes(entry.status)) {
      throw new ConflictError('Bu kayıt zaten kapanmış', 'WAITLIST_CLOSED');
    }
    const actor = currentActor();
    await tx.waitlistEntry.update({
      where: { id: waitlistId },
      data: { status: 'CANCELLED', closedAt: new Date(), closedBy: actor, closeReason: reason },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'WaitlistEntry',
      entityId: waitlistId,
      action: 'UPDATE',
      before: { status: entry.status },
      after: { status: 'CANCELLED', closeReason: reason },
    });
    await stage('waitlist.changed', { hotelId, waitlistId, status: 'CANCELLED' });
  });
  return getWaitlistEntry(hotelId, waitlistId);
}

/**
 * Otelin açık kayıtlarını tarar: yer açılan "yer açıldı" olur (zile uyarı),
 * yeri dolan "yer bekliyor"a döner, girişi geçmiş olan kapanır.
 *
 * Geçişler koşullu yazılır (`status` hâlâ eskisiyse): aynı anda rezervasyona
 * çevrilen ya da kapatılan kayıt ezilmez.
 *
 * @param {string} hotelId
 * @param {{ entryIds?: string[], roomTypeIds?: string[], alert?: boolean, now?: Date }} [options]
 * @returns {Promise<{ opened: number, closed: number, expired: number }>}
 */
export async function refreshWaitlist(hotelId, { entryIds, roomTypeIds, alert = true, now = new Date() } = {}) {
  const businessDate = await getBusinessDate(hotelId, now);
  const expired = entryIds ? 0 : await expireWaitlist(hotelId, businessDate);

  const entries = await prisma.waitlistEntry.findMany({
    where: {
      hotelId,
      status: { in: [...WAITLIST_OPEN_STATUSES] },
      checkIn: { gte: businessDate },
      ...(entryIds ? { id: { in: entryIds } } : {}),
      ...(roomTypeIds ? { roomTypeId: { in: roomTypeIds } } : {}),
    },
    orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
    take: REFRESH_BATCH,
    select: { id: true, status: true, roomTypeId: true, checkIn: true, checkOut: true, firstName: true, lastName: true, roomType: { select: { code: true } } },
  });
  if (entries.length === 0) return { opened: 0, closed: 0, expired };

  /** @type {Array<{ entry: object, next: 'WAITING' | 'AVAILABLE' }>} */
  const transitions = [];
  for (const chunk of chunkByWindow(entries)) {
    const types = [...new Set(chunk.entries.map((entry) => entry.roomTypeId))];
    const snapshot = await loadInventorySnapshot(prisma, hotelId, chunk.from, chunk.to, { roomTypeIds: types });
    const calendar = buildAvailabilityCalendar({ ...snapshot, from: chunk.from, to: chunk.to, roomTypeIds: types });
    for (const entry of chunk.entries) {
      const free = availabilityForStay(calendar, entry.roomTypeId, entry.checkIn, entry.checkOut) >= 1;
      if (free && entry.status === 'WAITING') transitions.push({ entry, next: 'AVAILABLE' });
      if (!free && entry.status === 'AVAILABLE') transitions.push({ entry, next: 'WAITING' });
    }
  }
  if (transitions.length === 0) return { opened: 0, closed: 0, expired };

  return writeWithEvents(async (tx, stage) => {
    let opened = 0;
    let closed = 0;
    const at = new Date();
    for (const { entry, next } of transitions) {
      const result = await tx.waitlistEntry.updateMany({
        where: { id: entry.id, hotelId, status: entry.status },
        data: { status: next, availableSince: next === 'AVAILABLE' ? at : null },
      });
      if (result.count === 0) continue;
      await stage('waitlist.changed', { hotelId, waitlistId: entry.id, status: next });
      if (next === 'WAITING') {
        closed += 1;
        continue;
      }
      opened += 1;
      if (!alert) continue;
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'WAITLIST_AVAILABLE',
        severity: 'WARNING',
        title: `Bekleme listesinde yer açıldı: ${entry.firstName} ${entry.lastName}`.trim(),
        body: `${entry.roomType.code} · ${toIsoDay(entry.checkIn)} – ${toIsoDay(entry.checkOut)} · misafiri arayıp rezervasyona çevirin`,
        link: `/rezervasyonlar/bekleme-listesi?kayit=${entry.id}`,
        permission: PERMISSIONS.RESERVATIONS_MANAGE,
        entityType: 'WaitlistEntry',
        entityId: entry.id,
        dedupeKey: `waitlist:${entry.id}:${at.getTime()}`,
      });
    }
    return { opened, closed, expired };
  });
}

/**
 * Girişi geçmiş açık kayıtları kapatır (en eski önce, paketler hâlinde).
 * @param {string} hotelId
 * @param {Date} businessDate
 */
async function expireWaitlist(hotelId, businessDate) {
  const stale = await prisma.waitlistEntry.findMany({
    where: { hotelId, status: { in: [...WAITLIST_OPEN_STATUSES] }, checkIn: { lt: businessDate } },
    orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
    take: EXPIRE_BATCH,
    select: { id: true, status: true },
  });
  if (stale.length === 0) return 0;
  return writeWithEvents(async (tx, stage) => {
    let count = 0;
    for (const entry of stale) {
      const result = await tx.waitlistEntry.updateMany({
        where: { id: entry.id, hotelId, status: entry.status },
        data: { status: 'EXPIRED', closedAt: new Date(), closedBy: 'system', closeReason: 'Giriş tarihi geçti' },
      });
      if (result.count === 0) continue;
      count += 1;
      await stage('waitlist.changed', { hotelId, waitlistId: entry.id, status: 'EXPIRED' });
    }
    return count;
  });
}

/**
 * Açık kaydı olan oteller (zamanlanmış tarama için).
 * @returns {Promise<string[]>}
 */
export async function hotelsWithOpenWaitlist() {
  const rows = await prisma.waitlistEntry.groupBy({
    by: ['hotelId'],
    where: { status: { in: [...WAITLIST_OPEN_STATUSES] } },
  });
  return rows.map((row) => row.hotelId);
}
