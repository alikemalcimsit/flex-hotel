import { randomBytes } from 'node:crypto';
import { addDays, currentActor, eachNight, toDecimal, toIsoDay, toMoneyString, toUtcDayStart } from '@hotelos/core';
import {
  APPROVAL_DEFAULT_TTL_MS,
  MAX_GROUP_ROOMS,
  RESERVATION_COUNT_CAP,
  RESERVATION_STATUS_LABELS,
  WAITLIST_OPEN_STATUSES,
  allowedReservationActions,
  reservationActionError,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { encodeCursor, olderThan, parseCursor } from '../../lib/cursor.js';
import { AppError, ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { lockReservations, lockRoomTypes, lockWaitlistEntries } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { createReadCache } from '../../lib/read-cache.js';
import { containsText, isFuzzyToken, MATCH_NOTHING, matchGuestIds, matchRoomIdsByNumber, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { PHONE_MATCH_DIGITS } from '../messaging/rules.js';
import { availabilityForStay, buildAvailabilityCalendar, findNewOverbooking, fitsCapacity } from '../rooms/rules.js';
import { assignRoomInTransaction, getAvailabilityCalendar, loadInventorySnapshot, roomConflictForStay } from '../rooms/service.js';
import { getActiveRoomTypes, getActiveSeasons, getActiveTaxes, getHotelSettings } from '../settings/service.js';
import { findGuestsByContact, guestFullName, resolveGuest, toGuestDto } from './guests.js';
import {
  cancellationTerms,
  changedReservationFields,
  distributeTotal,
  expandGroupLines,
  generateConfirmationCode,
  mergeNights,
  noShowFee,
  priceStay,
  roomTaxBreakdown,
  stayChanged,
  totalOf,
} from './rules.js';

/**
 * Rezervasyon yönetimi servisi (modül 4).
 *
 * ### Envanter güvenliği
 *
 * Envanteri tüketen her yazma (açma, grup, tarih/tip düzenleme, iptali geri
 * alma) aynı sırayla ilerler: **rezervasyon kilidi → oda tipi kilidi → oda
 * kilidi**, sonra aynı transaction'ın kendi bağlantısıyla (`tx`) müsaitlik
 * okunur. Son odaya aynı saniyede gelen iki istekten ikincisi birincinin
 * kaydını görerek karar verir; veritabanı kısıtları (çifte rezervasyon,
 * arızalı oda) son savunma hattıdır.
 *
 * Kapasite kuralı modül 3'ün kuralıdır: değişiklik **yeni** overbooking
 * yaratmamalı (`findNewOverbooking`). Yer yoksa otelin politikasına göre
 * reddedilir ya da (yalnızca yeni rezervasyon ve grup için) yönetici onayına
 * gider (modül 11); onaylanınca aynı istek kapasite aşılarak açılır.
 *
 * ### Fiyat
 *
 * Gece gece: oda tipinin taban fiyatı × o gecenin sezon çarpanı
 * (`ReservationNight`). Yetkili personel toplamı elle girebilir (gerekçesiyle,
 * geceler eşit bölünür). Konaklama değişince anlaşılan geceler anlaşılan
 * fiyatında kalır, yalnızca eklenen geceler güncel fiyatla hesaplanır.
 *
 * ### Tekrar gönderim
 *
 * Form açılırken istemci bir istek kimliği üretir (`requestId`). Aynı kimlikle
 * ikinci gönderim yeni kayıt açmaz: ilki döner (çift tık, ağ tekrarı, onay
 * sonrası yeniden deneme). Kimlik otel başına tekildir (kısmi index).
 */

const DAY_MS = 86_400_000;

/** Onay kodu üretiminde en fazla deneme (çakışma olasılığı yok denecek kadar az). */
const CODE_ATTEMPTS = 5;

/** Durum geçmişinde bir seferde gelen kayıt. */
const HISTORY_PAGE_SIZE = 20;

/** Aramasız liste önbelleği (resepsiyonun "bugün gelecek" gibi sık görünümleri). */
const LIST_CACHE_TTL_MS = 15_000;
const LIST_CACHE_MAX_ENTRIES = 2000;
const listCache = createReadCache({ ttlMs: LIST_CACHE_TTL_MS, maxEntries: LIST_CACHE_MAX_ENTRIES });

/** Onay isteğinde kapasite aşımının gösterilen en fazla gecesi. */
const SHORTFALL_SAMPLE = 5;

/** Onay isteğindeki ham rezervasyon isteğinin anahtarı (ekranda gösterilmez). */
export const APPROVAL_REQUEST_KEY = '_request';

/** Rezervasyon isteği onaylarında ilgili kayıt türü. */
export const RESERVATION_REQUEST_ENTITY = 'ReservationRequest';

const RESERVATION_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  confirmationCode: true,
  status: true,
  source: true,
  guestId: true,
  roomTypeId: true,
  roomId: true,
  roomSince: true,
  checkIn: true,
  checkOut: true,
  adults: true,
  children: true,
  boardType: true,
  totalPrice: true,
  currency: true,
  priceMode: true,
  priceNote: true,
  notes: true,
  groupId: true,
  requestId: true,
  createdBy: true,
  confirmedAt: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  cancellationFee: true,
  noShowAt: true,
  noShowFee: true,
  createdAt: true,
  updatedAt: true,
  guest: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, nationality: true } },
  roomType: { select: { id: true, code: true, name: true } },
  room: { select: { id: true, number: true } },
  group: { select: { id: true, code: true, name: true } },
});

const NIGHT_SELECT = Object.freeze({ date: true, amount: true, baseRate: true, multiplier: true, seasonName: true });

/** Prisma Decimal → "1234.50" (para yardımcısıyla; `Number()` ile değil). */
const money = (value) => (value === null || value === undefined ? null : toMoneyString(String(value)));
/** Çarpan: "1.500" (üç hane, şemadaki Decimal(6,3) ile hizalı). */
const multiplierText = (value) => (value === null || value === undefined ? null : toDecimal(String(value)).toFixed(3));
/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);

/**
 * @param {object} row `RESERVATION_SELECT`
 */
function toListDto(row) {
  return {
    id: row.id,
    confirmationCode: row.confirmationCode,
    status: row.status,
    source: row.source,
    guest: row.guest ? { id: row.guest.id, name: guestFullName(row.guest), phone: row.guest.phone, email: row.guest.email } : null,
    roomType: row.roomType,
    room: row.room ? { id: row.room.id, number: row.room.number } : null,
    checkIn: toIsoDay(row.checkIn),
    checkOut: toIsoDay(row.checkOut),
    nights: Math.round((toUtcDayStart(row.checkOut) - toUtcDayStart(row.checkIn)) / DAY_MS),
    adults: row.adults,
    children: row.children,
    boardType: row.boardType,
    totalPrice: money(row.totalPrice),
    currency: row.currency,
    priceMode: row.priceMode,
    group: row.group ? { id: row.group.id, code: row.group.code, name: row.group.name } : null,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Denetim izine yazılan alanlar. */
function snapshot(row) {
  return {
    status: row.status,
    guestId: row.guestId,
    roomTypeId: row.roomTypeId,
    roomId: row.roomId,
    checkIn: toIsoDay(row.checkIn),
    checkOut: toIsoDay(row.checkOut),
    adults: row.adults,
    children: row.children,
    boardType: row.boardType,
    totalPrice: money(row.totalPrice),
    priceMode: row.priceMode,
    priceNote: row.priceNote ?? null,
    notes: row.notes ?? null,
    source: row.source,
    groupId: row.groupId ?? null,
    cancelReason: row.cancelReason ?? null,
    cancellationFee: money(row.cancellationFee),
    noShowFee: money(row.noShowFee),
  };
}

/** Olay gövdesi: kimlik ve envanter etkisi. */
const stayPayload = (row) => ({
  hotelId: row.hotelId,
  reservationId: row.id,
  roomTypeId: row.roomTypeId,
  checkIn: row.checkIn,
  checkOut: row.checkOut,
});

/** @param {Date | string} value */
const dotted = (value) => {
  const [year, month, day] = toIsoDay(value).split('-');
  return `${day}.${month}.${year}`;
};

/* ══════════════════ Ortak yardımcılar ══════════════════ */

/**
 * @param {string} hotelId
 */
async function loadContext(hotelId) {
  const [hotel, businessDate, seasons, roomTypes] = await Promise.all([
    getHotelSettings(hotelId),
    getBusinessDate(hotelId),
    getActiveSeasons(hotelId),
    getActiveRoomTypes(hotelId),
  ]);
  return { hotel, businessDate, seasons, roomTypes, typeById: new Map(roomTypes.map((type) => [type.id, type])) };
}

/**
 * Oda tipi var mı, kişi sayısı sığıyor mu?
 * @param {Map<string, { id: string, code: string, name: string, capacityAdults: number, capacityChildren: number }>} typeById
 * @param {{ roomTypeId: string, adults: number, children: number }} line
 * @param {string} field hata alanı
 */
function assertLineFits(typeById, line, field = 'roomTypeId') {
  const type = typeById.get(line.roomTypeId);
  if (!type) throw new ValidationError('Seçilen oda tipi bulunamadı ya da silinmiş', { field });
  if (!fitsCapacity(line, type)) {
    throw new ValidationError(
      `${type.name} en fazla ${type.capacityAdults} yetişkin ve ${type.capacityChildren} çocuk alır; ` +
        `${line.adults} yetişkin, ${line.children} çocuk sığmaz. Başka tip seçin ya da odayı bölün.`,
      { field: 'adults' },
    );
  }
  return type;
}

/**
 * Değişikliğin yeni overbooking yaratıp yaratmadığı (çağıranın transaction'ında,
 * oda tipleri kilitliyken).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ roomTypeIds: string[], from: Date, to: Date, apply: (reservations: object[]) => object[] }} change
 */
async function overbookingViolations(tx, hotelId, { roomTypeIds, from, to, apply }) {
  const snap = await loadInventorySnapshot(tx, hotelId, from, to, { roomTypeIds });
  const before = buildAvailabilityCalendar({ ...snap, from, to, roomTypeIds });
  const after = buildAvailabilityCalendar({ ...snap, reservations: apply(snap.reservations), from, to, roomTypeIds });
  return findNewOverbooking(before, after, roomTypeIds);
}

/**
 * Yer yok hatası: hangi tipte, hangi gecede, kaç oda eksik.
 * @param {ReturnType<typeof findNewOverbooking>} violations
 * @param {Map<string, { code: string, name: string }>} typeById
 */
function noAvailabilityError(violations, typeById) {
  const first = violations[0];
  const type = typeById.get(first.roomTypeId);
  const nights = new Set(violations.map((violation) => violation.day)).size;
  return new ConflictError(
    `${type?.name ?? 'Seçilen tip'} için ${dotted(first.day)} gecesi${nights > 1 ? ` (ve ${nights - 1} gece daha)` : ''} yer yok: ` +
      `${first.sellable} satılabilir odanın hepsi dolu. Başka tip ya da tarih seçin ya da misafiri bekleme listesine alın.`,
    'NO_AVAILABILITY',
    { shortfall: shortfallDetails(violations, typeById) },
  );
}

/**
 * @param {ReturnType<typeof findNewOverbooking>} violations
 * @param {Map<string, { code: string, name: string }>} typeById
 */
function shortfallDetails(violations, typeById) {
  return violations.slice(0, SHORTFALL_SAMPLE).map((violation) => ({
    day: violation.day,
    roomTypeId: violation.roomTypeId,
    roomTypeCode: typeById.get(violation.roomTypeId)?.code ?? null,
    sellable: violation.sellable,
    demand: violation.demand,
  }));
}

/**
 * Tekil onay kodları (çağıranın transaction'ında). Kod uzayı çok büyük;
 * yine de yazmadan önce denetlenir — tekil kısıt ihlali transaction'ı
 * kullanılamaz hâle getirirdi.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelCode
 * @param {number} count
 */
async function uniqueConfirmationCodes(tx, hotelCode, count) {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const codes = new Set();
    while (codes.size < count) codes.add(generateConfirmationCode(hotelCode, randomBytes));
    const taken = await tx.reservation.findMany({ where: { confirmationCode: { in: [...codes] } }, select: { id: true } });
    const takenGroup = await tx.reservationGroup.findMany({ where: { code: { in: [...codes] } }, select: { id: true } });
    if (taken.length === 0 && takenGroup.length === 0) return [...codes];
  }
  throw new AppError('Onay kodu üretilemedi; lütfen tekrar deneyin', { statusCode: 503, code: 'CODE_EXHAUSTED' });
}

/**
 * Gece satırlarını yazar.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {Array<{ date: string, amount: string, baseRate: string | null, multiplier: string | null, seasonName: string | null }>} nights
 */
function writeNights(tx, hotelId, reservationId, nights) {
  if (nights.length === 0) return Promise.resolve();
  return tx.reservationNight.createMany({
    data: nights.map((night) => ({
      hotelId,
      reservationId,
      date: new Date(`${night.date}T00:00:00.000Z`),
      amount: night.amount,
      baseRate: night.baseRate,
      multiplier: night.multiplier,
      seasonName: night.seasonName,
    })),
  });
}

/** Prisma hatası istek kimliği tekilliğinden mi? */
function isDuplicateRequest(error) {
  const text = `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`;
  return error?.code === 'P2002' && text.includes('requestId');
}

/**
 * Kilitli rezervasyonu yükler; sürüm eskiyse 409, yoksa 404.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {Date | undefined} expectedUpdatedAt
 */
async function lockForWrite(tx, hotelId, reservationId, expectedUpdatedAt) {
  if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) {
    throw new NotFoundError('Rezervasyon bulunamadı');
  }
  const row = await tx.reservation.findFirst({
    where: { id: reservationId, hotelId },
    select: { ...RESERVATION_SELECT, nights: { select: NIGHT_SELECT, orderBy: { date: 'asc' } } },
  });
  if (!row) throw new NotFoundError('Rezervasyon bulunamadı');
  if (expectedUpdatedAt && row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
  return row;
}

/**
 * @param {'edit' | 'confirm' | 'cancel' | 'noShow' | 'reinstate'} action
 * @param {object} row
 * @param {Date} businessDate
 */
function assertAction(action, row, businessDate) {
  const reason = reservationActionError(action, row, businessDate);
  if (reason) throw new ConflictError(reason, 'INVALID_STATUS', { status: row.status });
}

/* ══════════════════ Açma ══════════════════ */

/**
 * @typedef {{
 *   allowOverbooking?: boolean,
 *   createdBy?: string,
 *   canOverridePrice?: boolean,
 *   approvalAllowed?: boolean,
 * }} CreateOptions
 *
 * `approvalAllowed: false`: yer yoksa politika ne olursa olsun reddedilir
 * (kanal istekleri, onaydan dönen istekler).
 */

/**
 * Aynı istek kimliğiyle açılmış rezervasyon ya da bekleyen kapasite onayı.
 * @param {string} hotelId
 * @param {string} requestId
 */
async function findPriorOutcome(hotelId, requestId) {
  const existing = await prisma.reservation.findFirst({
    where: { hotelId, requestId: { in: [requestId, `${requestId}:0`] } },
    select: { id: true, groupId: true },
  });
  if (existing) return { outcome: 'EXISTING', reservationId: existing.id, groupId: existing.groupId };
  const approval = await prisma.approval.findFirst({
    where: { hotelId, entityType: RESERVATION_REQUEST_ENTITY, entityId: requestId, status: 'PENDING' },
    select: { id: true },
  });
  if (approval) return { outcome: 'APPROVAL_PENDING', approvalId: approval.id };
  return null;
}

/**
 * Kilit alındıktan sonra aynı istek kimliğinin sonucu (transaction içinden).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} requestId
 */
async function findDuplicateInTransaction(tx, hotelId, requestId) {
  const existing = await tx.reservation.findFirst({
    where: { hotelId, requestId: { in: [requestId, `${requestId}:0`] } },
    select: { id: true, groupId: true },
  });
  if (existing) return { outcome: 'EXISTING', reservationId: existing.id, groupId: existing.groupId };
  const approval = await tx.approval.findFirst({
    where: { hotelId, entityType: RESERVATION_REQUEST_ENTITY, entityId: requestId, status: 'PENDING' },
    select: { id: true },
  });
  return approval ? { outcome: 'APPROVAL_PENDING', approvalId: approval.id } : null;
}

/**
 * Yer yok, politika "onaya gönder": istek onay kuyruğuna yazılır. Misafir
 * kartı bu noktada belirlenmiştir (onayda yeniden eşleştirme yapılmaz).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {object} context
 */
async function sendToApproval(tx, stage, { hotelId, hotel, kind, input, guest, rooms, violations, typeById, total, createdBy }) {
  const typeSummary = [...new Set(rooms.map((room) => typeById.get(room.roomTypeId)?.code ?? '?'))].join(', ');
  const stayText = `${dotted(input.checkIn)} – ${dotted(input.checkOut)}`;
  const nowMs = Date.now();
  const arrivalEnd = toUtcDayStart(input.checkIn) + DAY_MS;
  // Giriş günü geçtikten sonra verilen onay anlamsız: süre en geç girişin bitiminde dolar.
  const expiresInMs = Math.max(60_000, Math.min(APPROVAL_DEFAULT_TTL_MS, arrivalEnd - nowMs));

  const request = {
    kind,
    input: { ...input, guestId: guest.id, guest: null, forceNewGuest: false, checkIn: toIsoDay(input.checkIn), checkOut: toIsoDay(input.checkOut) },
    createdBy,
    // Elle fiyat yetkisi istek anında denetlendi; onayda yeniden sorulmaz.
    canOverridePrice: input.manualTotal !== null && input.manualTotal !== undefined,
  };
  const outcome = await requestApproval(tx, stage, {
    hotelId,
    type: 'OVERBOOKING',
    summary: `${guestFullName(guest)} · ${typeSummary} · ${stayText}${rooms.length > 1 ? ` · ${rooms.length} oda` : ''}`.slice(0, 200),
    reason:
      `Kapasite aşımı: ${violations.length} gecede yer yok (ilk gece ${dotted(violations[0].day)}: ` +
      `${violations[0].sellable} satılabilir oda, ${violations[0].demand} rezervasyon). Onaylanırsa rezervasyon kapasite aşılarak açılır.`,
    data: {
      Misafir: guestFullName(guest),
      Konaklama: stayText,
      Oda: rooms.length > 1 ? `${rooms.length} oda (${typeSummary})` : typeSummary,
      Kişi: `${rooms.reduce((sum, room) => sum + room.adults, 0)} yetişkin, ${rooms.reduce((sum, room) => sum + room.children, 0)} çocuk`,
      'Aşılan geceler': shortfallDetails(violations, typeById)
        .map((row) => `${dotted(row.day)} ${row.roomTypeCode}: ${row.sellable} oda / ${row.demand + 1} talep`)
        .join('; '),
      [APPROVAL_REQUEST_KEY]: request,
    },
    amount: total,
    currency: hotel.currency,
    entityType: RESERVATION_REQUEST_ENTITY,
    entityId: input.requestId,
    requestedBy: createdBy,
    expiresInMs,
  });
  return { outcome: 'APPROVAL_REQUESTED', approvalId: outcome.approvalId };
}

/**
 * Rezervasyonları yazar (tek ya da grup): gece fiyatları, denetim izi, olaylar.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {object} context
 * @returns {Promise<string[]>} rezervasyon kimlikleri
 */
async function insertReservations(tx, stage, { hotelId, hotel, input, guest, rooms, seasons, typeById, createdBy, groupId, manual }) {
  const codes = await uniqueConfirmationCodes(tx, hotel.code, rooms.length);
  const now = new Date();
  const ids = [];
  for (const [index, room] of rooms.entries()) {
    const type = typeById.get(room.roomTypeId);
    const priced = manual
      ? { nights: distributeTotal(manual.total, eachNight(input.checkIn, input.checkOut)), total: manual.total }
      : priceStay({ basePrice: type.basePrice, seasons, checkIn: input.checkIn, checkOut: input.checkOut });
    const row = await tx.reservation.create({
      data: {
        hotelId,
        guestId: guest.id,
        roomTypeId: room.roomTypeId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        adults: room.adults,
        children: room.children,
        boardType: room.boardType,
        status: input.status,
        source: input.source,
        totalPrice: manual ? manual.total : priced.total,
        currency: hotel.currency,
        priceMode: manual ? 'MANUAL' : 'CALCULATED',
        priceNote: manual ? manual.note : null,
        notes: input.notes ?? null,
        confirmationCode: codes[index],
        requestId: room.requestId,
        groupId: groupId ?? null,
        createdBy,
        confirmedAt: input.status === 'CONFIRMED' ? now : null,
      },
      select: RESERVATION_SELECT,
    });
    await writeNights(tx, hotelId, row.id, priced.nights);
    await recordAudit(tx, { hotelId, entity: 'Reservation', entityId: row.id, action: 'CREATE', after: snapshot(row) });
    await stage('reservation.created', { ...stayPayload(row), roomId: room.roomId ?? null, groupId: groupId ?? null });
    ids.push(row.id);
  }
  return ids;
}

/**
 * Bekleme listesi kaydını rezervasyona çevrildi olarak kapatır.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {string} hotelId
 * @param {string} waitlistId
 * @param {string} reservationId
 * @param {string} actor
 */
async function convertWaitlistEntry(tx, stage, hotelId, waitlistId, reservationId, actor) {
  if (!(await lockWaitlistEntries(tx, hotelId, [waitlistId])).has(waitlistId)) {
    throw new NotFoundError('Bekleme listesi kaydı bulunamadı');
  }
  const entry = await tx.waitlistEntry.findFirst({ where: { id: waitlistId, hotelId }, select: { id: true, status: true } });
  if (!WAITLIST_OPEN_STATUSES.includes(entry.status)) {
    throw new ConflictError('Bu bekleme listesi kaydı zaten kapanmış', 'WAITLIST_CLOSED');
  }
  await tx.waitlistEntry.update({
    where: { id: waitlistId },
    data: { status: 'CONVERTED', reservationId, closedAt: new Date(), closedBy: actor },
  });
  await recordAudit(tx, {
    hotelId,
    entity: 'WaitlistEntry',
    entityId: waitlistId,
    action: 'UPDATE',
    before: { status: entry.status },
    after: { status: 'CONVERTED', reservationId },
  });
  await stage('waitlist.changed', { hotelId, waitlistId, status: 'CONVERTED' });
}

/**
 * Tek rezervasyon açar.
 *
 * Dönüş `outcome`:
 * - `CREATED` / `EXISTING` (aynı istek kimliği) → `reservation`
 * - `APPROVAL_REQUESTED` / `APPROVAL_PENDING` → `approvalId` (yer yok, politika onay)
 *
 * @param {string} hotelId
 * @param {object} input `createReservationSchema` çıktısı
 * @param {CreateOptions} [options]
 */
export async function createReservation(hotelId, input, options = {}) {
  const prior = await findPriorOutcome(hotelId, input.requestId);
  if (prior) return withReservation(hotelId, prior);

  const context = await loadContext(hotelId);
  const { hotel, businessDate, seasons, typeById } = context;
  assertArrivalNotPast(input.checkIn, businessDate);
  assertLineFits(typeById, input);
  const manual = manualPrice(input, options);
  const createdBy = options.createdBy ?? currentActor();

  let result;
  try {
    result = await writeWithEvents(async (tx, stage) => {
      await lockRoomTypes(tx, hotelId, [input.roomTypeId]);
      // Aynı istek kimliğiyle eşzamanlı gelen gönderim kilidi bekledi: ilki bu
      // arada açıldıysa ikinci rezervasyon (ve ikinci misafir kartı) açılmaz.
      const duplicate = await findDuplicateInTransaction(tx, hotelId, input.requestId);
      if (duplicate) return duplicate;
      const { guest } = await resolveGuest(tx, hotelId, input, hotel);
      const rooms = [{ ...pickLine(input), requestId: input.requestId, roomId: input.roomId ?? null }];

      const violations = await overbookingViolations(tx, hotelId, {
        roomTypeIds: [input.roomTypeId],
        from: input.checkIn,
        to: input.checkOut,
        apply: (reservations) => [...reservations, ...placeholders(rooms, input)],
      });
      if (violations.length > 0 && !options.allowOverbooking) {
        if (input.roomId) throw noAvailabilityError(violations, typeById);
        if (hotel.overbookingPolicy === 'APPROVAL' && options.approvalAllowed !== false) {
          const total = manual?.total ?? priceStay({ basePrice: typeById.get(input.roomTypeId).basePrice, seasons, checkIn: input.checkIn, checkOut: input.checkOut }).total;
          return sendToApproval(tx, stage, { hotelId, hotel, kind: 'single', input, guest, rooms, violations, typeById, total, createdBy });
        }
        throw noAvailabilityError(violations, typeById);
      }

      const [reservationId] = await insertReservations(tx, stage, { hotelId, hotel, input, guest, rooms, seasons, typeById, createdBy, manual });
      if (input.waitlistId) await convertWaitlistEntry(tx, stage, hotelId, input.waitlistId, reservationId, createdBy);
      if (input.roomId) {
        await assignRoomInTransaction(tx, stage, hotelId, reservationId, input.roomId, { businessDate, reason: 'Oda planından açıldı' });
      }
      return { outcome: 'CREATED', reservationId };
    });
  } catch (error) {
    if (isDuplicateRequest(error)) return withReservation(hotelId, await findPriorOutcome(hotelId, input.requestId));
    rethrowPrismaError(error);
  }
  return withReservation(hotelId, result);
}

/**
 * Grup rezervasyonu: bütün odalar tek transaction'da açılır; biri açılamazsa
 * hiçbiri açılmaz. Odalar ayrı rezervasyonlardır (her biri kendi onay
 * koduyla), grup kaydı onları bağlar. Misafir grubun sorumlusudur.
 *
 * @param {string} hotelId
 * @param {object} input `createGroupReservationSchema` çıktısı
 * @param {CreateOptions} [options]
 */
export async function createGroupReservation(hotelId, input, options = {}) {
  const prior = await findPriorOutcome(hotelId, input.requestId);
  if (prior) return withReservation(hotelId, prior);

  const context = await loadContext(hotelId);
  const { hotel, businessDate, seasons, typeById } = context;
  assertArrivalNotPast(input.checkIn, businessDate);
  input.lines.forEach((line, index) => assertLineFits(typeById, line, `lines.${index}.roomTypeId`));
  const rooms = expandGroupLines(input.lines).map((room, index) => ({ ...room, requestId: `${input.requestId}:${index}`, roomId: null }));
  if (rooms.length > MAX_GROUP_ROOMS) throw new ValidationError(`Tek grupta en fazla ${MAX_GROUP_ROOMS} oda açılabilir`, { field: 'lines' });
  const roomTypeIds = [...new Set(rooms.map((room) => room.roomTypeId))];
  const createdBy = options.createdBy ?? currentActor();

  let result;
  try {
    result = await writeWithEvents(async (tx, stage) => {
      await lockRoomTypes(tx, hotelId, roomTypeIds);
      const duplicate = await findDuplicateInTransaction(tx, hotelId, input.requestId);
      if (duplicate) return duplicate;
      const { guest } = await resolveGuest(tx, hotelId, input, hotel);

      const violations = await overbookingViolations(tx, hotelId, {
        roomTypeIds,
        from: input.checkIn,
        to: input.checkOut,
        apply: (reservations) => [...reservations, ...placeholders(rooms, input)],
      });
      if (violations.length > 0 && !options.allowOverbooking) {
        if (hotel.overbookingPolicy === 'APPROVAL' && options.approvalAllowed !== false) {
          const total = totalOf(
            rooms.map((room) => ({
              amount: priceStay({ basePrice: typeById.get(room.roomTypeId).basePrice, seasons, checkIn: input.checkIn, checkOut: input.checkOut }).total,
            })),
          );
          return sendToApproval(tx, stage, { hotelId, hotel, kind: 'group', input, guest, rooms, violations, typeById, total, createdBy });
        }
        throw noAvailabilityError(violations, typeById);
      }

      const [code] = await uniqueConfirmationCodes(tx, hotel.code, 1);
      const group = await tx.reservationGroup.create({
        data: { hotelId, code, name: input.groupName, notes: input.notes ?? null, createdBy },
        select: { id: true },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'ReservationGroup',
        entityId: group.id,
        action: 'CREATE',
        after: { code, name: input.groupName, rooms: rooms.length, guestId: guest.id },
      });
      const ids = await insertReservations(tx, stage, {
        hotelId,
        hotel,
        input,
        guest,
        rooms,
        seasons,
        typeById,
        createdBy,
        groupId: group.id,
        manual: null,
      });
      if (input.waitlistId) await convertWaitlistEntry(tx, stage, hotelId, input.waitlistId, ids[0], createdBy);
      return { outcome: 'CREATED', reservationId: ids[0], groupId: group.id };
    }, { timeout: GROUP_TRANSACTION_TIMEOUT_MS });
  } catch (error) {
    if (isDuplicateRequest(error)) return withReservation(hotelId, await findPriorOutcome(hotelId, input.requestId));
    rethrowPrismaError(error);
  }
  return withReservation(hotelId, result);
}

/** Büyük grupta (50 oda × uzun konaklama) gece satırları için daha uzun süre. */
const GROUP_TRANSACTION_TIMEOUT_MS = 30_000;

/**
 * @param {string} hotelId
 * @param {{ outcome: string, reservationId?: string, groupId?: string | null, approvalId?: string }} result
 */
async function withReservation(hotelId, result) {
  if (!result.reservationId) return result;
  const reservation = await getReservation(hotelId, result.reservationId);
  return { ...result, groupId: result.groupId ?? reservation.group?.id ?? null, reservation };
}

/** @param {{ roomTypeId: string, adults: number, children?: number, boardType: string }} input */
const pickLine = (input) => ({
  roomTypeId: input.roomTypeId,
  adults: input.adults,
  children: input.children ?? 0,
  boardType: input.boardType,
});

/**
 * Müsaitlik hesabına eklenecek yeni rezervasyonlar (henüz yazılmamış).
 * @param {Array<{ roomTypeId: string, adults: number, children: number }>} rooms
 * @param {{ checkIn: Date, checkOut: Date }} stay
 */
const placeholders = (rooms, stay) =>
  rooms.map((room, index) => ({
    id: `new-${index}`,
    roomId: null,
    roomTypeId: room.roomTypeId,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    roomSince: null,
    status: 'CONFIRMED',
    adults: room.adults,
    children: room.children,
  }));

/**
 * @param {Date} checkIn
 * @param {Date} businessDate
 */
function assertArrivalNotPast(checkIn, businessDate) {
  if (toUtcDayStart(checkIn) < businessDate.getTime()) {
    throw new ValidationError(`Geçmiş tarihe rezervasyon açılamaz (otelin bugünü ${dotted(businessDate)})`, { field: 'checkIn' });
  }
}

/**
 * Elle fiyat isteniyorsa yetki denetimiyle birlikte.
 * @param {{ manualTotal?: string | null, priceNote?: string | null }} input
 * @param {CreateOptions} options
 */
function manualPrice(input, options) {
  if (input.manualTotal === null || input.manualTotal === undefined) return null;
  if (!options.canOverridePrice) {
    throw new AppError('Fiyatı elle değiştirme yetkiniz yok', { statusCode: 403, code: 'FORBIDDEN' });
  }
  return { total: input.manualTotal, note: input.priceNote };
}

/* ══════════════════ Düzenleme ══════════════════ */

/**
 * Rezervasyonu düzenler (bkz. `updateReservationSchema`).
 *
 * - Bekleyen / onaylı: tarih, tip, kişi, pansiyon, not, fiyat.
 * - İçerideki misafir: çıkış tarihi (uzatma / kısaltma), kişi, pansiyon, not.
 * - Atanmış oda yeni hâle uymuyorsa (tip değişti, yeni gecelerde dolu ya da
 *   arızalı, kişi sığmıyor) atama kaldırılır; oda-worker ya da personel yeniden
 *   atar. İçerideki misafirin odası kaldırılamaz: uzatma o odada mümkün
 *   değilse işlem reddedilir (önce oda değişikliği).
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {object} input
 * @param {{ canOverridePrice?: boolean }} [options]
 */
export async function updateReservation(hotelId, reservationId, input, options = {}) {
  const { hotel, businessDate, seasons, typeById } = await loadContext(hotelId);
  if (input.price?.mode === 'MANUAL' && !options.canOverridePrice) {
    throw new AppError('Fiyatı elle değiştirme yetkiniz yok', { statusCode: 403, code: 'FORBIDDEN' });
  }

  try {
    await writeWithEvents(async (tx, stage) => {
      const current = await lockForWrite(tx, hotelId, reservationId, input.expectedUpdatedAt);
      assertAction('edit', current, businessDate);
      const inHouse = current.status === 'CHECKED_IN';

      if (inHouse && input.checkIn && toIsoDay(input.checkIn) !== toIsoDay(current.checkIn)) {
        throw new ValidationError('Misafir içeride; giriş tarihi değiştirilemez', { field: 'checkIn' });
      }
      if (inHouse && input.roomTypeId && input.roomTypeId !== current.roomTypeId) {
        throw new ValidationError('Misafir içeride; oda tipi yerine oda planından oda değiştirin', { field: 'roomTypeId' });
      }

      const next = {
        checkIn: input.checkIn ?? current.checkIn,
        checkOut: input.checkOut ?? current.checkOut,
        roomTypeId: input.roomTypeId ?? current.roomTypeId,
        adults: input.adults ?? current.adults,
        children: input.children ?? current.children,
        boardType: input.boardType ?? current.boardType,
        notes: input.notes === undefined ? current.notes : input.notes,
      };
      if (toUtcDayStart(next.checkOut) <= toUtcDayStart(next.checkIn)) {
        throw new ValidationError('Çıkış tarihi girişten sonra olmalı', { field: 'checkOut' });
      }
      if (toIsoDay(next.checkIn) !== toIsoDay(current.checkIn)) assertArrivalNotPast(next.checkIn, businessDate);
      if (toIsoDay(next.checkOut) !== toIsoDay(current.checkOut) && toUtcDayStart(next.checkOut) < businessDate.getTime()) {
        throw new ValidationError('Çıkış tarihi otelin bugününden önce olamaz', { field: 'checkOut' });
      }
      if (inHouse && current.roomSince && toUtcDayStart(next.checkOut) < toUtcDayStart(current.roomSince)) {
        throw new ValidationError(`Misafir ${dotted(current.roomSince)} tarihinde bu odaya taşındı; çıkış bundan önce olamaz`, { field: 'checkOut' });
      }
      assertLineFits(typeById, next);

      const changedStay = stayChanged(current, next);
      const roomTypeIds = [...new Set([current.roomTypeId, next.roomTypeId])];
      if (changedStay) await lockRoomTypes(tx, hotelId, roomTypeIds);

      // Atanmış oda yeni hâle uyuyor mu? (yazmadan önce: veritabanı çifte
      // rezervasyonu yazma sırasında reddeder ve transaction bozulur)
      let releaseRoom = false;
      if (current.roomId && (changedStay || next.adults !== current.adults || next.children !== current.children)) {
        const candidate = { ...next, id: current.id, roomSince: current.roomSince, status: current.status };
        const conflict = await roomConflictForStay(tx, hotelId, current.roomId, candidate, {
          stayFrom: inHouse ? new Date(Math.max(businessDate.getTime(), toUtcDayStart(current.checkIn))) : undefined,
        });
        if (conflict) {
          if (inHouse) {
            throw new ConflictError(
              `${conflict.message} Misafir içeride olduğu için oda kaldırılamaz; önce oda planından başka odaya taşıyın.`,
              conflict.code,
              conflict.details,
            );
          }
          releaseRoom = true;
        }
      }

      if (changedStay) {
        const violations = await overbookingViolations(tx, hotelId, {
          roomTypeIds,
          from: new Date(Math.min(toUtcDayStart(current.checkIn), toUtcDayStart(next.checkIn))),
          to: new Date(Math.max(toUtcDayStart(current.checkOut), toUtcDayStart(next.checkOut))),
          apply: (reservations) =>
            reservations.map((row) =>
              row.id === current.id
                ? { ...row, checkIn: next.checkIn, checkOut: next.checkOut, roomTypeId: next.roomTypeId, roomId: releaseRoom ? null : row.roomId }
                : row,
            ),
        });
        if (violations.length > 0) throw noAvailabilityError(violations, typeById);
      }

      const pricing = repriceFor({ current, next, input, changedStay, inHouse, businessDate, seasons, typeById });
      const changedFields = changedReservationFields(
        { ...current, totalPrice: money(current.totalPrice) },
        { ...next, totalPrice: pricing ? pricing.total : money(current.totalPrice), priceMode: pricing ? pricing.mode : current.priceMode },
      );
      if (releaseRoom) changedFields.push('roomId');
      if (pricing && pricing.note !== (current.priceNote ?? null) && !changedFields.includes('priceMode')) changedFields.push('priceNote');
      // Hiçbir şey değişmiyorsa yazılmaz: sürüm (updatedAt) boşuna ilerlemez,
      // denetim izine boş kayıt düşmez.
      if (changedFields.length === 0) return;

      const updated = await tx.reservation.update({
        where: { id: current.id },
        data: {
          ...next,
          ...(releaseRoom ? { roomId: null } : {}),
          ...(pricing ? { totalPrice: pricing.total, priceMode: pricing.mode, priceNote: pricing.note } : {}),
        },
        select: RESERVATION_SELECT,
      });
      if (pricing) {
        await tx.reservationNight.deleteMany({ where: { reservationId: current.id, hotelId } });
        await writeNights(tx, hotelId, current.id, pricing.nights);
      }

      await recordAudit(tx, {
        hotelId,
        entity: 'Reservation',
        entityId: current.id,
        action: 'UPDATE',
        before: snapshot(current),
        after: snapshot(updated),
      });
      if (releaseRoom) {
        await stage('room.unassigned', { hotelId, reservationId: current.id, roomId: current.roomId, roomNumber: current.room?.number ?? '' });
      }
      await stage('reservation.updated', { ...stayPayload(updated), changedFields });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getReservation(hotelId, reservationId);
}

/**
 * Düzenlemede yeni gece fiyatları; fiyat değişmiyorsa `null`.
 * @param {object} args
 */
function repriceFor({ current, next, input, changedStay, inHouse, businessDate, seasons, typeById }) {
  const dates = () => eachNight(next.checkIn, next.checkOut);
  const today = toIsoDay(businessDate);
  const existing = current.nights.map((night) => ({
    date: toIsoDay(night.date),
    amount: money(night.amount),
    baseRate: night.baseRate === null ? null : money(night.baseRate),
    multiplier: multiplierText(night.multiplier),
    seasonName: night.seasonName,
  }));

  if (input.price?.mode === 'MANUAL') {
    return { mode: 'MANUAL', note: input.price.note, total: input.price.total, nights: distributeTotal(input.price.total, dates()) };
  }
  const fresh = () => priceStay({ basePrice: typeById.get(next.roomTypeId).basePrice, seasons, checkIn: next.checkIn, checkOut: next.checkOut }).nights;
  if (input.price?.mode === 'CALCULATED') {
    // Güncel fiyatlarla baştan; içerideki misafirin geçmiş geceleri değişmez.
    const nights = mergeNights(existing, fresh(), (date) => inHouse && date < today);
    return { mode: 'CALCULATED', note: null, total: totalOf(nights), nights };
  }
  if (!changedStay) return null;
  if (current.priceMode === 'MANUAL') {
    throw new AppError(
      'Bu rezervasyonun fiyatı elle girilmiş. Konaklama değiştiği için yeni fiyatı seçin: sistem fiyatı ya da yeni elle fiyat.',
      { statusCode: 422, code: 'PRICE_DECISION_REQUIRED' },
    );
  }
  // Tip değiştiyse bütün geceler yeni tipin fiyatıyla; değişmediyse anlaşılan geceler korunur.
  const keep = next.roomTypeId === current.roomTypeId ? () => true : () => false;
  const nights = mergeNights(existing, fresh(), keep);
  return { mode: 'CALCULATED', note: null, total: totalOf(nights), nights };
}

/* ══════════════════ Durum işlemleri ══════════════════ */

/**
 * Opsiyonlu rezervasyonu kesinleştirir (onay bildirimi bu anda gider).
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function confirmReservation(hotelId, reservationId, { expectedUpdatedAt }) {
  const businessDate = await getBusinessDate(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const current = await lockForWrite(tx, hotelId, reservationId, expectedUpdatedAt);
    assertAction('confirm', current, businessDate);
    const updated = await tx.reservation.update({
      where: { id: current.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
      select: RESERVATION_SELECT,
    });
    await recordAudit(tx, { hotelId, entity: 'Reservation', entityId: current.id, action: 'UPDATE', before: snapshot(current), after: snapshot(updated) });
    await stage('reservation.confirmed', { hotelId, reservationId: current.id });
  });
  return getReservation(hotelId, reservationId);
}

/**
 * İptal: politikaya göre ceza hesaplanır (personel gerekçeyle vazgeçebilir).
 * Tahsilat folyo / ödeme modülünde (15, 17). Oda kaydı geçmiş için kalır;
 * iptal edilmiş rezervasyon envanter tüketmez.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ expectedUpdatedAt?: Date, reason: string, waiveFee: boolean }} input
 */
export async function cancelReservation(hotelId, reservationId, input) {
  const [hotel, businessDate] = await Promise.all([getHotelSettings(hotelId), getBusinessDate(hotelId)]);
  await writeWithEvents((tx, stage) => cancelLocked(tx, stage, { hotelId, reservationId, input, hotel, businessDate }));
  return getReservation(hotelId, reservationId);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {object} context
 */
async function cancelLocked(tx, stage, { hotelId, reservationId, input, hotel, businessDate, alreadyLocked = false }) {
  const current = alreadyLocked
    ? await tx.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { ...RESERVATION_SELECT, nights: { select: NIGHT_SELECT } } })
    : await lockForWrite(tx, hotelId, reservationId, input.expectedUpdatedAt);
  assertAction('cancel', current, businessDate);
  const terms = cancellationTerms({ totalPrice: money(current.totalPrice), checkIn: current.checkIn }, hotel, businessDate);
  const fee = input.waiveFee ? '0.00' : terms.fee;
  const actor = currentActor();
  const updated = await tx.reservation.update({
    where: { id: current.id },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: actor, cancelReason: input.reason, cancellationFee: fee },
    select: RESERVATION_SELECT,
  });
  await recordAudit(tx, {
    hotelId,
    entity: 'Reservation',
    entityId: current.id,
    action: 'UPDATE',
    before: snapshot(current),
    after: { ...snapshot(updated), policyFee: terms.fee, feeWaived: input.waiveFee && terms.penaltyApplies },
  });
  await stage('reservation.cancelled', stayPayload(updated));
  return { id: current.id, fee };
}

/**
 * Gelmedi: giriş günü gelmiş ama misafir gelmemiş. Ücret ilk gecedir
 * (personel gerekçeyle vazgeçebilir); envanter serbest kalır.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ expectedUpdatedAt: Date, waiveFee: boolean }} input
 */
export async function markNoShow(hotelId, reservationId, input) {
  const businessDate = await getBusinessDate(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const current = await lockForWrite(tx, hotelId, reservationId, input.expectedUpdatedAt);
    assertAction('noShow', current, businessDate);
    const policyFee = noShowFee(current.nights.map((night) => ({ date: night.date, amount: money(night.amount) })));
    const fee = input.waiveFee ? '0.00' : policyFee;
    const updated = await tx.reservation.update({
      where: { id: current.id },
      data: { status: 'NO_SHOW', noShowAt: new Date(), noShowFee: fee },
      select: RESERVATION_SELECT,
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'Reservation',
      entityId: current.id,
      action: 'UPDATE',
      before: snapshot(current),
      after: { ...snapshot(updated), policyFee, feeWaived: input.waiveFee },
    });
    await stage('reservation.no_show', stayPayload(updated));
  });
  return getReservation(hotelId, reservationId);
}

/**
 * İptali ya da gelmediyi geri alır: envanter yeniden tüketilir (kilit +
 * kapasite denetimi). Kesinleşmişse onaylı, değilse opsiyonlu döner. Eski
 * oda bu arada başkasına verildiyse atama kaldırılır.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function reinstateReservation(hotelId, reservationId, { expectedUpdatedAt }) {
  const { businessDate, typeById } = await loadContext(hotelId);
  try {
    await writeWithEvents(async (tx, stage) => {
      const current = await lockForWrite(tx, hotelId, reservationId, expectedUpdatedAt);
      assertAction('reinstate', current, businessDate);
      const status = current.confirmedAt ? 'CONFIRMED' : 'PENDING';
      await lockRoomTypes(tx, hotelId, [current.roomTypeId]);

      let releaseRoom = false;
      if (current.roomId) {
        const conflict = await roomConflictForStay(tx, hotelId, current.roomId, { ...current, status });
        releaseRoom = Boolean(conflict);
      }
      const violations = await overbookingViolations(tx, hotelId, {
        roomTypeIds: [current.roomTypeId],
        from: new Date(Math.max(toUtcDayStart(current.checkIn), businessDate.getTime())),
        to: current.checkOut,
        apply: (reservations) => [
          ...reservations,
          { ...current, roomId: releaseRoom ? null : current.roomId, status },
        ],
      });
      if (violations.length > 0) throw noAvailabilityError(violations, typeById);

      const updated = await tx.reservation.update({
        where: { id: current.id },
        data: {
          status,
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
          cancellationFee: null,
          noShowAt: null,
          noShowFee: null,
          ...(releaseRoom ? { roomId: null } : {}),
        },
        select: RESERVATION_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'Reservation', entityId: current.id, action: 'UPDATE', before: snapshot(current), after: snapshot(updated) });
      if (releaseRoom) {
        await stage('room.unassigned', { hotelId, reservationId: current.id, roomId: current.roomId, roomNumber: current.room?.number ?? '' });
      }
      await stage('reservation.reinstated', stayPayload(updated));
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getReservation(hotelId, reservationId);
}

/**
 * Grubun açık (bekleyen / onaylı) odalarını birlikte iptal eder. Giriş
 * yapmış ya da kapanmış odalara dokunulmaz; kaçının iptal edildiği döner.
 *
 * @param {string} hotelId
 * @param {string} groupId
 * @param {{ reason: string, waiveFee: boolean }} input
 */
export async function cancelGroup(hotelId, groupId, input) {
  const [hotel, businessDate] = await Promise.all([getHotelSettings(hotelId), getBusinessDate(hotelId)]);
  return writeWithEvents(async (tx, stage) => {
    const group = await tx.reservationGroup.findFirst({ where: { id: groupId, hotelId }, select: { id: true, code: true } });
    if (!group) throw new NotFoundError('Grup bulunamadı');
    const members = await tx.reservation.findMany({
      where: { hotelId, groupId, status: { in: ['PENDING', 'CONFIRMED'] } },
      select: { id: true },
      take: MAX_GROUP_ROOMS,
    });
    await lockReservations(tx, hotelId, members.map((row) => row.id));
    const results = [];
    for (const member of members) {
      results.push(await cancelLocked(tx, stage, { hotelId, reservationId: member.id, input, hotel, businessDate, alreadyLocked: true }));
    }
    return { groupId, cancelled: results.length, fees: results.map((row) => ({ reservationId: row.id, fee: row.fee })) };
  });
}

/* ══════════════════ Okuma ══════════════════ */

/**
 * Rezervasyon listesi (sayfalı, sayım üst sınırlı).
 *
 * @param {string} hotelId
 * @param {object} query `reservationListQuerySchema` çıktısı
 */
export async function listReservations(hotelId, query) {
  const businessDate = await getBusinessDate(hotelId);
  const search = query.search?.trim();
  if (!search) {
    const key = JSON.stringify([hotelId, liveVersion(LIVE_SCOPES.RESERVATIONS, hotelId), toIsoDay(businessDate), query]);
    return listCache.get(key, () => computeList(hotelId, query, businessDate));
  }
  return computeList(hotelId, query, businessDate);
}

/** Sağlık ucu için. */
export function reservationCacheStats() {
  return listCache.stats();
}

/** Testler için. */
export function clearReservationCache() {
  listCache.clear();
}

/**
 * @param {string} hotelId
 * @param {object} query
 * @param {Date} businessDate
 */
async function computeList(hotelId, query, businessDate) {
  const hotel = await getHotelSettings(hotelId);
  const where = await listWhere(hotelId, query, businessDate, hotel);
  const orderBy = listOrder(query);
  const [rows, counted] = await Promise.all([
    prisma.reservation.findMany({ where, orderBy, ...toSkipTake(query), select: RESERVATION_SELECT }),
    // Sınırlı sayım: milyonluk tabloda her sayfada hepsini saymak yerine "2000+".
    prisma.reservation.count({ where, orderBy, take: RESERVATION_COUNT_CAP + 1 }),
  ]);
  const totalCapped = counted > RESERVATION_COUNT_CAP;
  const page = buildPage(rows.map(toListDto), totalCapped ? RESERVATION_COUNT_CAP : counted, query);
  return { ...page, meta: { ...page.meta, totalCapped, businessDate: toIsoDay(businessDate) } };
}

/** @param {{ view: string, sort?: string }} query */
function listOrder(query) {
  const sort = query.sort ?? (query.view === 'ALL' ? 'CREATED_DESC' : query.view === 'DEPARTURES' ? 'CHECK_OUT_ASC' : 'CHECK_IN_ASC');
  switch (sort) {
    case 'CHECK_IN_DESC':
      return [{ checkIn: 'desc' }, { id: 'desc' }];
    case 'CREATED_DESC':
      return [{ createdAt: 'desc' }, { id: 'desc' }];
    case 'CHECK_OUT_ASC':
      return [{ checkOut: 'asc' }, { id: 'asc' }];
    default:
      return [{ checkIn: 'asc' }, { id: 'asc' }];
  }
}

/**
 * @param {string} hotelId
 * @param {object} query
 * @param {Date} businessDate
 * @param {{ phoneCountryCode: string }} hotel
 */
async function listWhere(hotelId, query, businessDate, hotel) {
  const today = businessDate;
  const tomorrow = new Date(businessDate.getTime() + DAY_MS);
  const and = [];
  switch (query.view) {
    case 'ARRIVALS':
      and.push({ checkIn: { gte: today, lt: tomorrow }, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] } });
      break;
    case 'DEPARTURES':
      and.push({ checkOut: { gte: today, lt: tomorrow }, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] } });
      break;
    case 'IN_HOUSE':
      and.push({ status: 'CHECKED_IN' });
      break;
    case 'UPCOMING':
      and.push({ checkIn: { gte: tomorrow }, status: { in: ['PENDING', 'CONFIRMED'] } });
      break;
    case 'PENDING':
      and.push({ status: 'PENDING' });
      break;
    default:
      break;
  }
  if (query.status) and.push({ status: query.status });
  if (query.source) and.push({ source: query.source });
  if (query.roomTypeId) and.push({ roomTypeId: query.roomTypeId });
  if (query.groupId) and.push({ groupId: query.groupId });
  // Aralıkta en az bir gecesi olan konaklamalar (iki uç dahil).
  if (query.from) and.push({ checkOut: { gt: query.from } });
  if (query.to) and.push({ checkIn: { lt: addDays(query.to, 1) } });

  for (const token of listSearchTokens(query.search)) {
    and.push(await tokenWhere(hotelId, token, hotel));
  }
  return { hotelId, ...(and.length ? { AND: and } : {}) };
}

/**
 * Arama kelimeleri. Telefon boşluklu yazılır ("0555 111 22 33"); rakam,
 * boşluk ve telefon işaretlerinden oluşan metin tek kelime sayılır.
 * @param {string | undefined} search
 */
function listSearchTokens(search) {
  const text = String(search ?? '').trim();
  if (/^[\d\s()+-]+$/.test(text) && text.replace(/\D/g, '').length >= PHONE_MATCH_DIGITS) return [text];
  return searchTokens(text);
}

/**
 * Tek arama kelimesi: onay kodu, misafir adı, telefon ya da oda numarası.
 * @param {string} hotelId
 * @param {string} token
 * @param {{ phoneCountryCode: string }} hotel
 */
async function tokenWhere(hotelId, token, hotel) {
  const or = [];
  const digits = token.replace(/\D/g, '');
  if (isFuzzyToken(token)) or.push({ confirmationCode: containsText(token) });
  if (isFuzzyToken(token) && /\p{L}/u.test(token)) {
    const guestIds = await matchGuestIds(prisma, hotelId, token);
    if (guestIds.length) or.push({ guestId: { in: guestIds } });
  }
  if (digits.length >= PHONE_MATCH_DIGITS) {
    const guests = await findGuestsByContact(prisma, hotelId, { phone: token }, hotel.phoneCountryCode);
    if (guests.length) or.push({ guestId: { in: guests.map((guest) => guest.id) } });
  }
  if (/^[\p{L}\d-]{1,10}$/u.test(token)) {
    const roomIds = await matchRoomIdsByNumber(prisma, hotelId, token);
    if (roomIds.length) or.push({ roomId: { in: roomIds } });
  }
  return or.length ? { OR: or } : MATCH_NOTHING;
}

/**
 * Rezervasyonun dökümü: geceler, vergi, izin verilen işlemler, iptal / gelmedi
 * önizlemesi, grup üyeleri.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 */
export async function getReservation(hotelId, reservationId) {
  const [row, businessDate, hotel, taxes] = await Promise.all([
    prisma.reservation.findFirst({
      where: { id: reservationId, hotelId },
      select: {
        ...RESERVATION_SELECT,
        nights: { select: NIGHT_SELECT, orderBy: { date: 'asc' } },
        waitlistEntries: { select: { id: true }, take: 1 },
      },
    }),
    getBusinessDate(hotelId),
    getHotelSettings(hotelId),
    getActiveTaxes(hotelId),
  ]);
  if (!row) throw new NotFoundError('Rezervasyon bulunamadı');

  const actions = allowedReservationActions(row, businessDate);
  const nightlyRates = row.nights.map((night) => ({
    date: toIsoDay(night.date),
    amount: money(night.amount),
    baseRate: night.baseRate === null ? null : money(night.baseRate),
    multiplier: multiplierText(night.multiplier),
    seasonName: night.seasonName,
  }));
  const members = row.groupId
    ? await prisma.reservation.findMany({
        where: { hotelId, groupId: row.groupId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: MAX_GROUP_ROOMS,
        select: {
          id: true,
          confirmationCode: true,
          status: true,
          adults: true,
          children: true,
          totalPrice: true,
          roomType: { select: { code: true, name: true } },
          room: { select: { number: true } },
        },
      })
    : [];

  return {
    ...toListDto(row),
    guest: row.guest ? toGuestDto(row.guest) : null,
    notes: row.notes,
    priceNote: row.priceNote,
    roomSince: row.roomSince ? toIsoDay(row.roomSince) : null,
    confirmedAt: iso(row.confirmedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
    cancellationFee: money(row.cancellationFee),
    noShowAt: iso(row.noShowAt),
    noShowFee: money(row.noShowFee),
    nightlyRates,
    taxes: roomTaxBreakdown(money(row.totalPrice), taxes),
    businessDate: toIsoDay(businessDate),
    actions,
    cancellationPreview: actions.includes('cancel')
      ? cancellationTerms({ totalPrice: money(row.totalPrice), checkIn: row.checkIn }, hotel, businessDate)
      : null,
    noShowPreview: actions.includes('noShow') ? { fee: noShowFee(nightlyRates) } : null,
    fromWaitlist: row.waitlistEntries.length > 0,
    groupMembers: members.map((member) => ({
      id: member.id,
      confirmationCode: member.confirmationCode,
      status: member.status,
      statusLabel: RESERVATION_STATUS_LABELS[member.status] ?? member.status,
      roomType: member.roomType,
      roomNumber: member.room?.number ?? null,
      adults: member.adults,
      children: member.children,
      totalPrice: money(member.totalPrice),
    })),
  };
}

/**
 * Durum geçmişi: denetim izindeki kayıtlar (en yeni önce, imleçli).
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ cursor?: string }} query
 */
export async function getReservationHistory(hotelId, reservationId, query = {}) {
  const cursor = parseCursor(query.cursor);
  const exists = await prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { id: true } });
  if (!exists) throw new NotFoundError('Rezervasyon bulunamadı');
  const rows = await prisma.auditLog.findMany({
    where: { hotelId, entity: 'Reservation', entityId: reservationId, ...(cursor ? olderThan('createdAt', cursor) : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: HISTORY_PAGE_SIZE + 1,
    select: { id: true, action: true, actor: true, before: true, after: true, changedFields: true, createdAt: true },
  });
  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      action: row.action,
      actor: row.actor,
      at: row.createdAt.toISOString(),
      changedFields: row.changedFields,
      before: row.before,
      after: row.after,
    })),
    nextCursor: rows.length > HISTORY_PAGE_SIZE && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
  };
}

/**
 * Formun fiyat ve müsaitlik önizlemesi: bütün satılabilir tiplerin bu
 * tarihlerdeki boş oda sayısı ve fiyatı, istenen satırların toplamı, vergi
 * dökümü ve iptal koşulu.
 *
 * Müsaitlik envanter sürümüyle önbellekli takvimden okunur (her tuşta
 * yeniden hesaplanmaz). Düzenlenen rezervasyonun kendi tuttuğu yer "boş"
 * sayılır (önbelleksiz, nadir).
 *
 * Önizlemedir: kayıt anında müsaitlik kilitli olarak yeniden denetlenir.
 *
 * @param {string} hotelId
 * @param {object} input `reservationQuoteSchema` çıktısı
 */
export async function quoteReservation(hotelId, input) {
  const { hotel, businessDate, seasons, roomTypes, typeById } = await loadContext(hotelId);
  const taxes = await getActiveTaxes(hotelId);
  const excluded = input.excludeReservationId
    ? await prisma.reservation.findFirst({
        where: { id: input.excludeReservationId, hotelId },
        select: { id: true, roomTypeId: true, checkIn: true, checkOut: true, status: true, roomId: true, roomSince: true },
      })
    : null;
  if (!excluded) assertArrivalNotPast(input.checkIn, businessDate);

  let availability;
  if (excluded) {
    const snap = await loadInventorySnapshot(prisma, hotelId, input.checkIn, input.checkOut);
    const calendar = buildAvailabilityCalendar({
      ...snap,
      reservations: snap.reservations.filter((row) => row.id !== excluded.id),
      from: input.checkIn,
      to: input.checkOut,
      roomTypeIds: roomTypes.map((type) => type.id),
    });
    availability = (typeId) => availabilityForStay(calendar, typeId, input.checkIn, input.checkOut);
  } else {
    const calendar = await getAvailabilityCalendar(hotelId, { from: input.checkIn, to: input.checkOut });
    const byType = new Map(calendar.roomTypes.map((type) => [type.id, type]));
    availability = (typeId) => {
      const entry = byType.get(typeId);
      if (!entry) return 0;
      const days = Object.values(entry.days);
      return days.length ? Math.min(...days.map((day) => day.free)) : 0;
    };
  }

  const types = roomTypes.map((type) => {
    const priced = priceStay({ basePrice: type.basePrice, seasons, checkIn: input.checkIn, checkOut: input.checkOut });
    return {
      id: type.id,
      code: type.code,
      name: type.name,
      capacityAdults: type.capacityAdults,
      capacityChildren: type.capacityChildren,
      available: availability(type.id),
      total: priced.total,
      nights: priced.nights,
    };
  });
  const typeQuote = new Map(types.map((type) => [type.id, type]));

  const demand = new Map();
  const lines = input.lines.map((line) => {
    const type = typeQuote.get(line.roomTypeId);
    if (!type) throw new ValidationError('Seçilen oda tipi bulunamadı ya da silinmiş', { field: 'roomTypeId' });
    demand.set(line.roomTypeId, (demand.get(line.roomTypeId) ?? 0) + line.quantity);
    return {
      roomTypeId: line.roomTypeId,
      quantity: line.quantity,
      fitsCapacity: fitsCapacity(line, typeById.get(line.roomTypeId)),
      unitTotal: type.total,
      total: totalOf(Array.from({ length: line.quantity }, () => ({ amount: type.total }))),
    };
  });
  const total = totalOf(lines.map((line) => ({ amount: line.total })));
  const shortages = [...demand].filter(([typeId, count]) => (typeQuote.get(typeId)?.available ?? 0) < count).map(([typeId, count]) => ({
    roomTypeId: typeId,
    requested: count,
    available: Math.max(0, typeQuote.get(typeId)?.available ?? 0),
  }));

  return {
    checkIn: toIsoDay(input.checkIn),
    checkOut: toIsoDay(input.checkOut),
    nights: types[0]?.nights.length ?? Math.round((toUtcDayStart(input.checkOut) - toUtcDayStart(input.checkIn)) / DAY_MS),
    currency: hotel.currency,
    roomTypes: types,
    lines,
    total,
    taxes: roomTaxBreakdown(total, taxes),
    shortages,
    overbookingPolicy: hotel.overbookingPolicy,
    cancellation: cancellationTerms({ totalPrice: total, checkIn: input.checkIn }, hotel, businessDate),
  };
}

/**
 * Kanal isteği (reservation-worker): yer yoksa ya da istek geçersizse
 * `reservation.rejected` yayınlanır (hata değil, sonuç). Aynı istek
 * kimliğiyle ikinci kez gelirse ilk sonuç döner. Kanal isteği onaya gitmez;
 * misafir eşleşmesinde ad farklıysa yeni kart açılır (kanal personele soramaz).
 *
 * @param {object} payload `reservation.requested` gövdesi
 * @returns {Promise<{ outcome: 'CREATED' | 'EXISTING' | 'REJECTED', reservationId?: string, confirmationCode?: string, code?: string, reason?: string }>}
 */
export async function createFromChannelRequest(payload) {
  const { hotelId } = payload;
  const input = {
    guestId: null,
    guest: {
      firstName: payload.guest.firstName,
      lastName: payload.guest.lastName,
      phone: payload.guest.phone,
      email: payload.guest.email,
      nationality: payload.guest.nationality,
    },
    forceNewGuest: true,
    roomTypeId: payload.roomTypeId,
    adults: payload.adults,
    children: payload.children ?? 0,
    checkIn: new Date(toUtcDayStart(payload.checkIn)),
    checkOut: new Date(toUtcDayStart(payload.checkOut)),
    status: payload.status ?? 'PENDING',
    source: payload.source,
    notes: payload.notes,
    requestId: payload.requestId,
    waitlistId: null,
    roomId: null,
    manualTotal: null,
    priceNote: null,
  };

  const reject = async (code, reason) => {
    await writeWithEvents((tx, stage) => stage('reservation.rejected', { hotelId, requestId: payload.requestId, code, reason }));
    return { outcome: 'REJECTED', code, reason };
  };

  try {
    const hotel = await getHotelSettings(hotelId);
    input.boardType = payload.boardType ?? hotel.defaultBoardType;
    if (!input.guest.phone && !input.guest.email) return reject('VALIDATION', 'Misafirin telefonu ya da e-postası yok');
    if (toUtcDayStart(input.checkOut) <= toUtcDayStart(input.checkIn)) return reject('VALIDATION', 'Çıkış tarihi girişten sonra olmalı');
    // Kanal isteği politikadan bağımsız onaya gitmez: kapasite aşımı misafire
    // söz vermektir; kanaldan gelen istek yalnızca yer varsa açılır.
    const result = await createReservation(hotelId, input, { approvalAllowed: false, createdBy: `kanal:${payload.source}` });
    return { outcome: result.outcome, reservationId: result.reservation.id, confirmationCode: result.reservation.confirmationCode };
  } catch (error) {
    if (error instanceof AppError && error.statusCode >= 400 && error.statusCode < 500) {
      return reject(error.code ?? 'REJECTED', error.message);
    }
    throw error;
  }
}
