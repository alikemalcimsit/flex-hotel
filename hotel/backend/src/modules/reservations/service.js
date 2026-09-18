import { randomUUID } from 'node:crypto';
import { RESERVATION_INVENTORY_STATUSES } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { lockReservations, lockRoomTypes } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { checkAvailability } from '../rooms/service.js';
import { getActiveRoomTypes, getActiveSeasons, getHotelSettings } from '../settings/service.js';
import { computeStayPrice, generateConfirmationCode, splitGuestName, toUtcDayStart } from './rules.js';

/**
 * Rezervasyon servisi (modül 4).
 *
 * Envanter tüketen her yazma (aç/düzenle/iptal/no-show) tek transaction'da
 * kilit → müsaitlik → yazı sırasını izler (`writeWithEvents` + `lockRoomTypes`);
 * yoksa son oda iki kez satılır. Fiyat `rules.js`'te hesaplanır (para-kritik).
 * Her yazma ilgili `reservation.*` event'ini yayınlar (plan cache + canlı ekran).
 */

/** Düzenlenebilir/iptal edilebilir "açık" durumlar. */
const OPEN_STATUSES = ['PENDING', 'CONFIRMED'];

const RESERVATION_INCLUDE = Object.freeze({
  guest: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
  room: { select: { number: true } },
  roomType: { select: { code: true, name: true } },
});

const isoDay = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const iso = (value) => (value ? new Date(value).toISOString() : null);
const decimalToString = (value) => (value == null ? null : value.toString());

function toReservationDto(row) {
  return {
    id: row.id,
    confirmationCode: row.confirmationCode,
    status: row.status,
    source: row.source,
    checkIn: isoDay(row.checkIn),
    checkOut: isoDay(row.checkOut),
    adults: row.adults,
    children: row.children,
    boardType: row.boardType,
    roomTypeId: row.roomTypeId,
    roomTypeCode: row.roomType?.code ?? null,
    roomTypeName: row.roomType?.name ?? null,
    roomId: row.roomId,
    roomNumber: row.room?.number ?? null,
    guestId: row.guestId,
    guestName: row.guest ? `${row.guest.firstName} ${row.guest.lastName}`.trim() : null,
    guestPhone: row.guest?.phone ?? null,
    guestEmail: row.guest?.email ?? null,
    totalPrice: decimalToString(row.totalPrice),
    currency: row.currency,
    groupId: row.groupId,
    notes: row.notes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Fiyat/kapasite girdileri (cache'li sıcak okumalar). */
async function loadPricingContext(hotelId) {
  const [roomTypes, seasons, hotel] = await Promise.all([
    getActiveRoomTypes(hotelId),
    getActiveSeasons(hotelId),
    getHotelSettings(hotelId),
  ]);
  return { roomTypes, seasons, currency: hotel.currency };
}

function requireRoomType(roomTypes, roomTypeId) {
  const roomType = roomTypes.find((type) => type.id === roomTypeId);
  if (!roomType) throw new ValidationError('Oda tipi bulunamadı', { field: 'roomTypeId' });
  return roomType;
}

function assertCapacity(roomType, adults, children) {
  const capacity = roomType.capacityAdults + roomType.capacityChildren;
  if (adults + children > capacity) {
    throw new ValidationError(`Bu oda tipi en fazla ${capacity} kişi alır`, { field: 'adults' });
  }
}

/**
 * Misafiri çözer: `id` verildiyse doğrular; yoksa telefon/e-posta ile eşleştirir;
 * o da yoksa yeni misafir açar. Aynı transaction'da (tx).
 */
async function findOrCreateGuest(tx, hotelId, guest) {
  if (guest.id) {
    const existing = await tx.guest.findFirst({ where: { id: guest.id, hotelId }, select: { id: true } });
    if (!existing) throw new ValidationError('Seçilen misafir bulunamadı', { field: 'guest' });
    return existing;
  }

  const phone = guest.phone?.trim() || null;
  const email = guest.email?.trim().toLowerCase() || null;
  if (phone || email) {
    const match = await tx.guest.findFirst({
      where: { hotelId, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] },
      select: { id: true },
    });
    if (match) return match;
  }

  const { firstName, lastName } = splitGuestName(guest.name);
  return tx.guest.create({ data: { hotelId, firstName, lastName, phone, email } });
}

/* ─────────────── Fiyat önizleme ─────────────── */

/**
 * Form için fiyat + müsaitlik önizlemesi (yazma yok).
 * @param {string} hotelId
 * @param {{ roomTypeId: string, checkIn: Date, checkOut: Date }} query
 */
export async function quote(hotelId, { roomTypeId, checkIn, checkOut }) {
  const { roomTypes, seasons, currency } = await loadPricingContext(hotelId);
  const roomType = requireRoomType(roomTypes, roomTypeId);
  const price = computeStayPrice({ basePrice: roomType.basePrice, seasons, checkIn, checkOut });
  const available = await checkAvailability(hotelId, { checkIn, checkOut, roomTypeId });
  return { ...price, currency, roomTypeName: roomType.name, available };
}

/* ─────────────── Oluşturma ─────────────── */

/**
 * Tek rezervasyon açar (senkron, resepsiyon). Kilit → müsaitlik → yazı; commit
 * sonrası room-worker `reservation.created` ile odayı otomatik atar.
 *
 * @param {string} hotelId
 * @param {object} input `reservationInputSchema` çıktısı
 * @param {{ status?: string, source?: string }} [options]
 */
export async function createReservation(hotelId, input, { status = 'CONFIRMED', source = 'UI' } = {}) {
  const { guest, roomTypeId, checkIn, checkOut, adults, children, boardType, notes } = input;
  const { roomTypes, seasons, currency } = await loadPricingContext(hotelId);
  const roomType = requireRoomType(roomTypes, roomTypeId);
  assertCapacity(roomType, adults, children);

  const businessDate = await getBusinessDate(hotelId);
  if (toUtcDayStart(checkIn).getTime() < toUtcDayStart(businessDate).getTime()) {
    throw new ValidationError('Giriş tarihi geçmişte olamaz', { field: 'checkIn' });
  }

  const price = computeStayPrice({ basePrice: roomType.basePrice, seasons, checkIn, checkOut });

  return writeWithEvents(async (tx, stage) => {
    if (!(await lockRoomTypes(tx, hotelId, [roomTypeId])).has(roomTypeId)) {
      throw new NotFoundError('Oda tipi bulunamadı');
    }
    const free = await checkAvailability(hotelId, { checkIn, checkOut, roomTypeId }, { client: tx });
    if (free < 1) {
      throw new ConflictError('Seçilen oda tipi bu tarihlerde dolu.', 'NO_AVAILABILITY');
    }

    const guestRow = await findOrCreateGuest(tx, hotelId, guest);
    const created = await tx.reservation.create({
      data: {
        hotelId,
        guestId: guestRow.id,
        roomTypeId,
        checkIn,
        checkOut,
        adults,
        children,
        status,
        source,
        boardType,
        totalPrice: price.total,
        currency,
        confirmationCode: generateConfirmationCode(),
        notes: notes ?? null,
      },
      include: RESERVATION_INCLUDE,
    });

    const dto = toReservationDto(created);
    await recordAudit(tx, { hotelId, entity: 'Reservation', entityId: created.id, action: 'CREATE', after: dto });
    await stage('reservation.created', { hotelId, reservationId: created.id, roomTypeId, checkIn, checkOut, roomId: null });
    return dto;
  });
}

/* ─────────────── Grup ─────────────── */

/**
 * Grup rezervasyonu: ortak misafir + birden çok oda satırı, tek transaction.
 * Her satır ayrı rezervasyon; grup içinde de fazla satış engellenir (bir satır
 * yazıldıktan sonra sonraki müsaitlik onu görür — `client: tx`).
 */
export async function createGroupReservation(hotelId, input) {
  const { roomTypes, seasons, currency } = await loadPricingContext(hotelId);
  const businessDate = await getBusinessDate(hotelId);
  for (const line of input.rooms) {
    const roomType = requireRoomType(roomTypes, line.roomTypeId);
    assertCapacity(roomType, line.adults, line.children);
    if (toUtcDayStart(line.checkIn).getTime() < toUtcDayStart(businessDate).getTime()) {
      throw new ValidationError('Giriş tarihi geçmişte olamaz', { field: 'checkIn' });
    }
  }

  const groupId = randomUUID();
  const typeIds = [...new Set(input.rooms.map((line) => line.roomTypeId))];

  return writeWithEvents(async (tx, stage) => {
    await lockRoomTypes(tx, hotelId, typeIds);
    const guestRow = await findOrCreateGuest(tx, hotelId, input.guest);
    const reservations = [];

    for (const line of input.rooms) {
      const roomType = requireRoomType(roomTypes, line.roomTypeId);
      const free = await checkAvailability(hotelId, line, { client: tx });
      if (free < 1) {
        throw new ConflictError(`${roomType.name}: seçilen tarihlerde yeterli yer yok.`, 'NO_AVAILABILITY');
      }
      const price = computeStayPrice({ basePrice: roomType.basePrice, seasons, checkIn: line.checkIn, checkOut: line.checkOut });
      const row = await tx.reservation.create({
        data: {
          hotelId,
          guestId: guestRow.id,
          roomTypeId: line.roomTypeId,
          checkIn: line.checkIn,
          checkOut: line.checkOut,
          adults: line.adults,
          children: line.children,
          status: 'CONFIRMED',
          source: 'UI',
          boardType: line.boardType,
          groupId,
          totalPrice: price.total,
          currency,
          confirmationCode: generateConfirmationCode(),
          notes: input.notes ?? null,
        },
        include: RESERVATION_INCLUDE,
      });
      await recordAudit(tx, { hotelId, entity: 'Reservation', entityId: row.id, action: 'CREATE', after: toReservationDto(row) });
      await stage('reservation.created', {
        hotelId,
        reservationId: row.id,
        roomTypeId: line.roomTypeId,
        checkIn: line.checkIn,
        checkOut: line.checkOut,
        roomId: null,
      });
      reservations.push(toReservationDto(row));
    }

    return { groupId, reservations };
  });
}

/* ─────────────── Düzenleme ─────────────── */

/**
 * Rezervasyon düzenler (tarih/tip/kişi/pansiyon/not). Yalnızca açık (PENDING/
 * CONFIRMED) rezervasyon düzenlenir. Tip değişirse oda ataması sıfırlanır
 * (eski oda yanlış tip). Yazımdan sonra tipin aşırı-satışa girmediği doğrulanır.
 */
export async function updateReservation(hotelId, id, input) {
  const { roomTypeId, checkIn, checkOut, adults, children, boardType, notes, expectedUpdatedAt } = input;
  const { roomTypes, seasons } = await loadPricingContext(hotelId);
  const roomType = requireRoomType(roomTypes, roomTypeId);
  assertCapacity(roomType, adults, children);
  const price = computeStayPrice({ basePrice: roomType.basePrice, seasons, checkIn, checkOut });

  return writeWithEvents(async (tx, stage) => {
    if (!(await lockReservations(tx, hotelId, [id])).has(id)) throw new NotFoundError('Rezervasyon bulunamadı');
    const before = await tx.reservation.findFirst({ where: { id, hotelId }, include: RESERVATION_INCLUDE });
    if (!before) throw new NotFoundError('Rezervasyon bulunamadı');
    if (!OPEN_STATUSES.includes(before.status)) {
      throw new ValidationError('Yalnızca bekleyen veya onaylı rezervasyon düzenlenebilir');
    }
    await lockRoomTypes(tx, hotelId, [...new Set([roomTypeId, before.roomTypeId])]);

    const typeChanged = roomTypeId !== before.roomTypeId;
    const data = { roomTypeId, checkIn, checkOut, adults, children, boardType, notes: notes ?? null, totalPrice: price.total };
    // Tip değişince atanmış oda (eski tip) artık geçersiz — sıfırla, sonra elle/otomatik atanır.
    if (typeChanged) data.roomId = null;

    await updateWithVersionCheck(tx, 'reservation', { id, hotelId }, expectedUpdatedAt, data, 'Rezervasyon bulunamadı');

    // Yazı sonrası: yeni tip+pencere aşırı satışa girdi mi (self dahil sayılır).
    const free = await checkAvailability(hotelId, { checkIn, checkOut, roomTypeId }, { client: tx });
    if (free < 0) throw new ConflictError('Bu değişiklik oda tipini aşırı-satışa sokuyor.', 'NO_AVAILABILITY');

    const after = await tx.reservation.findFirst({ where: { id, hotelId }, include: RESERVATION_INCLUDE });
    const beforeDto = toReservationDto(before);
    const afterDto = toReservationDto(after);
    await recordAudit(tx, { hotelId, entity: 'Reservation', entityId: id, action: 'UPDATE', before: beforeDto, after: afterDto });
    await stage('reservation.updated', { hotelId, reservationId: id, roomTypeId, checkIn, checkOut, roomId: after.roomId ?? null });
    return afterDto;
  });
}

/* ─────────────── Durum geçişleri ─────────────── */

async function transition(hotelId, id, { toStatus, event, guardOpen, mutate }) {
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockReservations(tx, hotelId, [id])).has(id)) throw new NotFoundError('Rezervasyon bulunamadı');
    const before = await tx.reservation.findFirst({ where: { id, hotelId }, include: RESERVATION_INCLUDE });
    if (!before) throw new NotFoundError('Rezervasyon bulunamadı');
    if (guardOpen && !OPEN_STATUSES.includes(before.status)) {
      throw new ValidationError('Bu rezervasyon zaten kapatılmış (iptal/çıkış/gelmedi).');
    }
    const after = await tx.reservation.update({
      where: { id },
      data: { status: toStatus, ...(mutate ? mutate(before) : {}) },
      include: RESERVATION_INCLUDE,
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'Reservation',
      entityId: id,
      action: 'UPDATE',
      before: toReservationDto(before),
      after: toReservationDto(after),
    });
    await stage(event, {
      hotelId,
      reservationId: id,
      roomTypeId: before.roomTypeId,
      checkIn: before.checkIn,
      checkOut: before.checkOut,
    });
    return toReservationDto(after);
  });
}

/** İptal — envanteri serbest bırakır; sebep nota eklenir. */
export function cancelReservation(hotelId, id, { reason } = {}) {
  return transition(hotelId, id, {
    toStatus: 'CANCELLED',
    event: 'reservation.cancelled',
    guardOpen: true,
    mutate: (before) => ({
      notes: reason ? [before.notes, `İptal sebebi: ${reason}`].filter(Boolean).join('\n') : before.notes,
    }),
  });
}

/** Gelmedi — giriş yapmadan kapatılır, envanter ileriye serbest kalır. */
export function markNoShow(hotelId, id) {
  return transition(hotelId, id, { toStatus: 'NO_SHOW', event: 'reservation.no_show', guardOpen: true });
}

/* ─────────────── Bekleyen liste ─────────────── */

/** Yer yokken talebi kaydeder (WAITLISTED — envanter tüketmez). */
export async function addToWaitingList(hotelId, input) {
  const { guest, roomTypeId, checkIn, checkOut, adults, children, boardType, notes } = input;
  const { roomTypes, seasons, currency } = await loadPricingContext(hotelId);
  const roomType = requireRoomType(roomTypes, roomTypeId);
  assertCapacity(roomType, adults, children);
  const price = computeStayPrice({ basePrice: roomType.basePrice, seasons, checkIn, checkOut });

  return writeWithEvents(async (tx, stage) => {
    const guestRow = await findOrCreateGuest(tx, hotelId, guest);
    const created = await tx.reservation.create({
      data: {
        hotelId,
        guestId: guestRow.id,
        roomTypeId,
        checkIn,
        checkOut,
        adults,
        children,
        status: 'WAITLISTED',
        source: 'UI',
        boardType,
        totalPrice: price.total,
        currency,
        confirmationCode: generateConfirmationCode(),
        notes: notes ?? null,
      },
      include: RESERVATION_INCLUDE,
    });
    const dto = toReservationDto(created);
    await recordAudit(tx, { hotelId, entity: 'Reservation', entityId: created.id, action: 'CREATE', after: dto });
    await stage('reservation.waitlisted', { hotelId, reservationId: created.id, roomTypeId, checkIn, checkOut });
    return dto;
  });
}

/** Bekleyeni onaylar: yer açıldıysa CONFIRMED'e çevirir (room-worker odayı atar). */
export async function promoteWaiting(hotelId, id) {
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockReservations(tx, hotelId, [id])).has(id)) throw new NotFoundError('Rezervasyon bulunamadı');
    const before = await tx.reservation.findFirst({ where: { id, hotelId }, include: RESERVATION_INCLUDE });
    if (!before) throw new NotFoundError('Rezervasyon bulunamadı');
    if (before.status !== 'WAITLISTED') throw new ValidationError('Bu rezervasyon bekleyen listede değil.');

    await lockRoomTypes(tx, hotelId, [before.roomTypeId]);
    const free = await checkAvailability(hotelId, { checkIn: before.checkIn, checkOut: before.checkOut, roomTypeId: before.roomTypeId }, { client: tx });
    if (free < 1) throw new ConflictError('Hâlâ yer yok; bekleyen listede kalıyor.', 'NO_AVAILABILITY');

    const after = await tx.reservation.update({ where: { id }, data: { status: 'CONFIRMED' }, include: RESERVATION_INCLUDE });
    await recordAudit(tx, { hotelId, entity: 'Reservation', entityId: id, action: 'UPDATE', before: toReservationDto(before), after: toReservationDto(after) });
    await stage('reservation.created', { hotelId, reservationId: id, roomTypeId: before.roomTypeId, checkIn: before.checkIn, checkOut: before.checkOut, roomId: null });
    return toReservationDto(after);
  });
}

/* ─────────────── Async kanal talebi (reservation-worker) ─────────────── */

/**
 * Async kanaldan (chat/OTA — modül 8/32) gelen `reservation.requested`'i işler:
 * rezervasyonu açar (`reservation.created`) ya da yer yoksa `reservation.rejected`
 * yayınlar. reservation-worker bunu çağırır; HTTP path bunu kullanmaz.
 *
 * @param {string} hotelId
 * @param {object} payload `reservation.requested` gövdesi
 * @returns {Promise<{ created?: object, rejected?: boolean, reason?: string }>}
 */
export async function requestReservation(hotelId, payload) {
  const input = {
    guest: { name: payload.guest.name, phone: payload.guest.phone ?? null, email: payload.guest.email ?? null },
    roomTypeId: payload.roomTypeId,
    checkIn: new Date(payload.checkIn),
    checkOut: new Date(payload.checkOut),
    adults: payload.adults,
    children: payload.children ?? 0,
    boardType: payload.boardType ?? 'BB',
    notes: null,
  };
  try {
    const created = await createReservation(hotelId, input, { source: payload.source ?? 'WEBCHAT' });
    return { created };
  } catch (error) {
    if (error instanceof ConflictError && error.code === 'NO_AVAILABILITY') {
      await writeWithEvents(async (tx, stage) => {
        await stage('reservation.rejected', { hotelId, requestId: payload.requestId ?? null, reason: error.message });
      });
      return { rejected: true, reason: error.message };
    }
    throw error;
  }
}

/* ─────────────── Okuma ─────────────── */

/**
 * Filtreli, sayfalı liste. Durum verilmezse bekleyen liste (WAITLISTED) hariç
 * tutulur — o ayrı sekmede.
 * @param {string} hotelId
 * @param {{ page, pageSize, search?, from?, to?, status?, source? }} query
 */
export async function listReservations(hotelId, { page, pageSize, search, from, to, status, source }) {
  const where = { hotelId };
  where.status = status ? status : { not: 'WAITLISTED' };
  if (source) where.source = source;
  // [checkIn, checkOut) ile [from, to] kesişimi.
  if (from) where.checkOut = { gt: from };
  if (to) where.checkIn = { lt: to };
  if (search) {
    where.OR = [
      { confirmationCode: { contains: search, mode: 'insensitive' } },
      {
        guest: {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
          ],
        },
      },
    ];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.reservation.findMany({ where, include: RESERVATION_INCLUDE, orderBy: [{ checkIn: 'desc' }], ...toSkipTake({ page, pageSize }) }),
    prisma.reservation.count({ where }),
  ]);
  return buildPage(rows.map(toReservationDto), total, { page, pageSize });
}

/** Rezervasyon detayı + durum/değişiklik geçmişi (audit'ten). */
export async function getReservation(hotelId, id) {
  const row = await prisma.reservation.findFirst({ where: { id, hotelId }, include: RESERVATION_INCLUDE });
  if (!row) throw new NotFoundError('Rezervasyon bulunamadı');

  const logs = await prisma.auditLog.findMany({
    where: { hotelId, entity: 'Reservation', entityId: id },
    orderBy: [{ createdAt: 'asc' }],
    select: { action: true, actor: true, changedFields: true, createdAt: true, after: true },
  });
  const history = logs.map((log) => ({
    action: log.action,
    actor: log.actor,
    changedFields: log.changedFields,
    status: log.after?.status ?? null,
    at: log.createdAt.toISOString(),
  }));

  return { ...toReservationDto(row), history };
}

/** Rezervasyon formunun oda tipi seçici verisi (reservations.view ile erişilir). */
export async function listBookableRoomTypes(hotelId) {
  const roomTypes = await getActiveRoomTypes(hotelId);
  return roomTypes.map((type) => ({
    id: type.id,
    code: type.code,
    name: type.name,
    basePrice: type.basePrice,
    capacityAdults: type.capacityAdults,
    capacityChildren: type.capacityChildren,
  }));
}

/** Form misafir araması (ad/telefon/e-posta). */
export async function searchGuests(hotelId, query) {
  const q = (query ?? '').trim();
  if (q.length < 2) return [];
  const rows = await prisma.guest.findMany({
    where: {
      hotelId,
      OR: [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true },
    orderBy: [{ firstName: 'asc' }],
    take: 10,
  });
  return rows.map((g) => ({ id: g.id, name: `${g.firstName} ${g.lastName}`.trim(), phone: g.phone, email: g.email }));
}
