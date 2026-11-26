import { BOARD_TYPES, MAX_GROUP_LINES } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { encodeCursor, newerThan, olderThan, parseCursor } from '../../lib/cursor.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { idempotencyRequestId } from '../../lib/webhook-signature.js';
import { applyReservationUpdate, cancelReservation, createReservation, quoteReservation } from '../reservations/service.js';
import { getActiveRoomTypes, getHotelSettings } from '../settings/service.js';

/**
 * Açık API'nin işleyicileri (modül 61). Hepsi mevcut servislerin ince sarmalayıcısıdır: fiyat motoru, müsaitlik
 * kilidi, iptal politikası, misafir eşleştirmesi panelle **aynı** kod yolundan geçer.
 *
 * Dönen gövdeler kararlı bir sözleşmedir (`publicReservationSchema` …): iç alan adları değişse de dışarıya giden
 * biçim değişmez. Misafirin iletişim bilgisi yalnız `guests:read` uçlarından; kimlik belgesi hiçbir uçtan dönmez.
 * Rezervasyonun notu yalnız o rezervasyonu açan uygulamaya döner (personelin iç notu dışarı çıkmaz).
 */

/** @typedef {{ keyId: string, clientId: string, clientName: string, hotelId: string, scopes: string[], bookingStatus: 'PENDING' | 'CONFIRMED' }} ApiCaller */

const PUBLIC_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];

const day = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const iso = (value) => (value instanceof Date ? value.toISOString() : value);
const moneyText = (value) => (value === null || value === undefined ? null : typeof value === 'string' ? value : value.toFixed(2));
/** "YYYY-MM-DD" → UTC gün başı (rezervasyon tarihleri bu biçimde saklanır). */
const dayDate = (text) => new Date(`${text}T00:00:00.000Z`);

/* ─────────────── Otel ve müsaitlik ─────────────── */

/** @param {string} hotelId */
export async function getPublicHotel(hotelId) {
  const hotel = await getHotelSettings(hotelId);
  return {
    id: hotelId,
    name: hotel.name,
    currency: hotel.currency,
    timezone: hotel.timezone,
    checkInTime: hotel.checkInTime,
    checkOutTime: hotel.checkOutTime,
    defaultBoardType: hotel.defaultBoardType,
    boardTypes: [...BOARD_TYPES],
  };
}

/** @param {any} type */
const roomTypeDto = (type) => ({
  id: type.id,
  code: type.code,
  name: type.name,
  description: type.description ?? null,
  capacityAdults: type.capacityAdults,
  capacityChildren: type.capacityChildren,
});

/** @param {string} hotelId */
export async function listPublicRoomTypes(hotelId) {
  return { items: (await getActiveRoomTypes(hotelId)).map(roomTypeDto) };
}

/**
 * Her oda tipinin bütün geceler boyunca boş oda sayısı ve kişi sayısına göre konaklama toplamı. Sığan tipler satır
 * olarak fiyatlanır (kişi başı ek dahil; kayıttaki fiyatla aynı hesap). Negatif müsaitlik (izinli kapasite aşımı)
 * dışarıya 0 görünür.
 *
 * @param {string} hotelId @param {object} query `publicAvailabilityQuerySchema` çıktısı
 */
export async function getPublicAvailability(hotelId, query) {
  const hotel = await getHotelSettings(hotelId);
  const boardType = query.boardType ?? hotel.defaultBoardType;
  const checkIn = dayDate(query.checkIn);
  const checkOut = dayDate(query.checkOut);
  const types = await getActiveRoomTypes(hotelId);
  const fitting = types.filter((type) => query.adults <= type.capacityAdults && query.children <= type.capacityChildren);

  const base = { checkIn, checkOut, boardType, agencyId: null, excludeReservationId: null, couponCode: null, source: 'API' };
  const totals = new Map();
  let quote = null;
  // Teklif ucu en fazla MAX_GROUP_LINES satır fiyatlar; çok tipli otelde paketler hâlinde.
  for (let start = 0; start === 0 || start < fitting.length; start += MAX_GROUP_LINES) {
    const chunk = fitting.slice(start, start + MAX_GROUP_LINES);
    const result = await quoteReservation(hotelId, {
      ...base,
      lines: chunk.map((type) => ({ roomTypeId: type.id, quantity: 1, adults: query.adults, children: query.children, boardType })),
    });
    quote ??= result;
    for (const line of result.lines ?? []) if (line.fitsCapacity && line.unitTotal !== null) totals.set(line.roomTypeId, line.total);
    if (chunk.length === 0) break;
  }

  const byId = new Map((quote?.roomTypes ?? []).map((type) => [type.id, type]));
  return {
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    nights: quote?.nights ?? 0,
    currency: hotel.currency,
    boardType,
    roomTypes: types.map((type) => ({
      roomTypeId: type.id,
      code: type.code,
      name: type.name,
      available: Math.max(0, Math.trunc(byId.get(type.id)?.available ?? 0)),
      fits: totals.has(type.id),
      total: totals.get(type.id) ?? null,
    })),
  };
}

/* ─────────────── Rezervasyon ─────────────── */

const RESERVATION_PUBLIC_SELECT = Object.freeze({
  id: true,
  confirmationCode: true,
  status: true,
  source: true,
  roomTypeId: true,
  roomId: true,
  room: { select: { number: true } },
  checkIn: true,
  checkOut: true,
  adults: true,
  children: true,
  boardType: true,
  totalPrice: true,
  currency: true,
  cancellationFee: true,
  notes: true,
  apiClientId: true,
  createdAt: true,
  updatedAt: true,
  guest: { select: { id: true, firstName: true, lastName: true } },
});

/** @param {any} row @param {ApiCaller} caller */
function reservationDto(row, caller) {
  const owned = row.apiClientId === caller.clientId;
  return {
    id: row.id,
    confirmationCode: row.confirmationCode,
    status: row.status,
    source: row.source,
    roomTypeId: row.roomTypeId,
    roomId: row.roomId ?? null,
    roomNumber: row.room?.number ?? null,
    checkIn: day(row.checkIn),
    checkOut: day(row.checkOut),
    adults: row.adults,
    children: row.children,
    boardType: row.boardType,
    totalPrice: moneyText(row.totalPrice),
    currency: row.currency,
    cancellationFee: moneyText(row.cancellationFee),
    guest: { id: row.guest.id, firstName: row.guest.firstName, lastName: row.guest.lastName },
    notes: owned ? row.notes ?? null : null,
    ownedByClient: owned,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Sayfa: `updatedSince` varsa değişiklik zamanına göre eskiden yeniye (senkron), yoksa açılışa göre yeniden eskiye.
 * @template T
 * @param {any[]} rows @param {number} limit @param {'updatedAt' | 'createdAt'} field @param {(row: any) => T} map
 */
function page(rows, limit, field, map) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items: items.map(map), nextCursor: rows.length > limit && last ? encodeCursor({ at: last[field], id: last.id }) : null };
}

/**
 * @param {ApiCaller} caller @param {object} query `publicReservationListQuerySchema` çıktısı
 */
export async function listPublicReservations(caller, query) {
  const cursor = parseCursor(query.cursor);
  const sync = Boolean(query.updatedSince);
  const where = { hotelId: caller.hotelId, status: query.status ? query.status : { in: PUBLIC_RESERVATION_STATUSES } };
  const and = [];
  if (sync) and.push({ updatedAt: { gt: new Date(query.updatedSince) } });
  if (query.checkInFrom) and.push({ checkIn: { gte: dayDate(query.checkInFrom) } });
  if (query.checkInTo) and.push({ checkIn: { lt: new Date(dayDate(query.checkInTo).getTime() + 86_400_000) } });
  if (query.confirmationCode) and.push({ confirmationCode: query.confirmationCode.toUpperCase() });
  if (cursor) and.push(sync ? newerThan('updatedAt', cursor) : olderThan('createdAt', cursor));
  const field = sync ? 'updatedAt' : 'createdAt';
  const direction = sync ? 'asc' : 'desc';
  const rows = await prisma.reservation.findMany({
    where: and.length ? { ...where, AND: and } : where,
    select: RESERVATION_PUBLIC_SELECT,
    orderBy: [{ [field]: direction }, { id: direction }],
    take: query.limit + 1,
  });
  return page(rows, query.limit, field, (row) => reservationDto(row, caller));
}

/** @param {ApiCaller} caller @param {string} id */
export async function getPublicReservation(caller, id) {
  const row = await prisma.reservation.findFirst({
    where: { id, hotelId: caller.hotelId, status: { in: PUBLIC_RESERVATION_STATUSES } },
    select: RESERVATION_PUBLIC_SELECT,
  });
  if (!row) throw new NotFoundError('Rezervasyon bulunamadı');
  return reservationDto(row, caller);
}

/**
 * Rezervasyon açar (paneldeki `createReservation`): fiyat motor, müsaitlik kilitli, yer yoksa 409 (onaya gitmez).
 * Aynı `Idempotency-Key` ilk sonucu döner (`created: false`). Misafirin iletişimi başka ada kayıtlı bir kartla
 * çakışırsa yeni kart açılır: dış sisteme başka misafirin kartı gösterilmez, sorulmaz.
 *
 * @param {ApiCaller} caller @param {object} input `publicReservationCreateSchema` çıktısı @param {string} idempotencyKey
 * @returns {Promise<{ created: boolean, reservation: ReturnType<typeof reservationDto> }>}
 */
export async function createPublicReservation(caller, input, idempotencyKey) {
  const hotel = await getHotelSettings(caller.hotelId);
  const result = await createReservation(
    caller.hotelId,
    {
      guestId: input.guestId ?? null,
      guest: input.guest ? { firstName: input.guest.firstName, lastName: input.guest.lastName, email: input.guest.email ?? null, phone: input.guest.phone ?? null, nationality: input.guest.nationality ?? null } : null,
      forceNewGuest: true,
      roomTypeId: input.roomTypeId,
      adults: input.adults,
      children: input.children,
      boardType: input.boardType ?? hotel.defaultBoardType,
      packageId: null,
      checkIn: dayDate(input.checkIn),
      checkOut: dayDate(input.checkOut),
      status: caller.bookingStatus,
      source: 'API',
      notes: input.notes ?? null,
      requestId: idempotencyRequestId(caller.clientId, idempotencyKey),
      waitlistId: null,
      agencyId: null,
      couponCode: input.couponCode ?? null,
      manualTotal: null,
      priceNote: null,
      roomId: null,
      apiClientId: caller.clientId,
    },
    { approvalAllowed: false },
  );
  const reservationId = result.reservation?.id ?? result.reservationId;
  if (!reservationId) throw new NotFoundError('Rezervasyon açılamadı');
  return { created: result.outcome === 'CREATED', reservation: await getPublicReservation(caller, reservationId) };
}

/** Yalnız bu uygulamanın açtığı rezervasyon değiştirilir. @param {ApiCaller} caller @param {string} id */
async function assertOwned(caller, id) {
  const row = await prisma.reservation.findFirst({ where: { id, hotelId: caller.hotelId }, select: { apiClientId: true } });
  if (!row) throw new NotFoundError('Rezervasyon bulunamadı');
  if (row.apiClientId !== caller.clientId) {
    throw Object.assign(new ForbiddenError('Bu rezervasyonu bu uygulama açmadı; yalnız kendi açtığınız rezervasyonları değiştirebilirsiniz.'), { code: 'NOT_OWNER' });
  }
}

/**
 * @param {ApiCaller} caller @param {string} id @param {object} input `publicReservationUpdateSchema` çıktısı
 */
export async function updatePublicReservation(caller, id, input) {
  await assertOwned(caller, id);
  const changes = { expectedUpdatedAt: new Date(input.expectedUpdatedAt) };
  if (input.checkIn !== undefined) changes.checkIn = dayDate(input.checkIn);
  if (input.checkOut !== undefined) changes.checkOut = dayDate(input.checkOut);
  for (const key of ['roomTypeId', 'adults', 'children', 'boardType', 'notes']) if (input[key] !== undefined) changes[key] = input[key];
  await applyReservationUpdate(caller.hotelId, id, changes, { canOverridePrice: false });
  return getPublicReservation(caller, id);
}

/**
 * İptal: otelin politikasındaki ceza uygulanır (API ile silinemez).
 * @param {ApiCaller} caller @param {string} id @param {object} input `publicReservationCancelSchema` çıktısı
 */
export async function cancelPublicReservation(caller, id, input) {
  await assertOwned(caller, id);
  await cancelReservation(caller.hotelId, id, { expectedUpdatedAt: new Date(input.expectedUpdatedAt), reason: input.reason, waiveFee: false });
  return getPublicReservation(caller, id);
}

/* ─────────────── Misafir ─────────────── */

const GUEST_PUBLIC_SELECT = Object.freeze({ id: true, firstName: true, lastName: true, email: true, phone: true, nationality: true, createdAt: true, updatedAt: true });

/** @param {any} row */
const guestDto = (row) => ({
  id: row.id,
  firstName: row.firstName,
  lastName: row.lastName,
  email: row.email ?? null,
  phone: row.phone ?? null,
  nationality: row.nationality ?? null,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/**
 * Misafir listesi: `updatedSince` ile eskiden yeniye senkron, yoksa son değişen önce (ikisi de `(hotelId, updatedAt, id)`
 * indeksinde).
 * @param {ApiCaller} caller @param {object} query `publicGuestListQuerySchema` çıktısı
 */
export async function listPublicGuests(caller, query) {
  const cursor = parseCursor(query.cursor);
  const sync = Boolean(query.updatedSince);
  const and = [];
  if (sync) and.push({ updatedAt: { gt: new Date(query.updatedSince) } });
  // E-posta küçük harfle saklanır (kart açılırken normalize); tam eşitlik indeksi kullanır, joker karakter yok.
  if (query.email) and.push({ email: query.email });
  if (cursor) and.push(sync ? newerThan('updatedAt', cursor) : olderThan('updatedAt', cursor));
  const direction = sync ? 'asc' : 'desc';
  const rows = await prisma.guest.findMany({
    where: and.length ? { hotelId: caller.hotelId, AND: and } : { hotelId: caller.hotelId },
    select: GUEST_PUBLIC_SELECT,
    orderBy: [{ updatedAt: direction }, { id: direction }],
    take: query.limit + 1,
  });
  return page(rows, query.limit, 'updatedAt', guestDto);
}

/** @param {ApiCaller} caller @param {string} id */
export async function getPublicGuest(caller, id) {
  const row = await prisma.guest.findFirst({ where: { id, hotelId: caller.hotelId }, select: GUEST_PUBLIC_SELECT });
  if (!row) throw new NotFoundError('Misafir bulunamadı');
  return guestDto(row);
}
