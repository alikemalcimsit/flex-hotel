import { currentActor, toIsoDay, toMoneyString } from '@hotelos/core';
import {
  LOST_ITEM_CONTACT_CHANNEL_LABELS,
  LOST_ITEM_DISPOSAL_LABELS,
  LOST_ITEM_MATCH_LOOKBACK_DAYS,
  LOST_ITEM_OPEN_STATUSES,
  RESERVATION_COUNT_CAP,
  lostItemActionError,
  lostItemExpired,
  lostItemExpiryCutoff,
  lostItemFoundAtError,
  lostItemRetainUntil,
  lostItemReturnError,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockLostItems } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { newReference, referenceFromToken } from '../../lib/reference.js';
import { MATCH_NOTHING, containsText, isFuzzyToken, matchGuestIds, matchRoomIdsByNumber, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { guestFullName, searchGuests } from '../reservations/guests.js';
import { getHotelSettings } from '../settings/service.js';
import { rankCandidates, roomIntervals } from './rules.js';

/**
 * Kayıp eşya (modül 21).
 *
 * Akış: **kayıt** (kat görevlisi / garson; fotoğraf ayrı uçtan) → **eşleştirme**
 * (resepsiyon: odada kim kalmıştı, ya da misafir araması) → **iletişim notları**
 * → **teslim** (elden ya da kargo) veya süre dolunca **kapatma** (yönetim).
 *
 * - Etiket no (`LF-XXXXXX`) poşetin üstüne yazılır; aramada tam eşleşir.
 * - Saklama süresi ayardan hesaplanır (kolon tutulmaz): ayar değişince bütün
 *   açık eşyalara uygulanır; "süresi dolan" listesi index'li tarih eşiğiyle.
 * - Her değişiklik eşya satırı kilitliyken ve sürüm damgasıyla yapılır: aynı
 *   eşya iki kişiye teslim edilemez, eski ekrandan yazılan değişiklik reddedilir.
 * - Misafirin telefonu / e-postası ve kargo adresi yalnızca teslim yetkisine
 *   (`includeContact`) gösterilir; socket'e yalnızca kimlikler çıkar.
 */

const iso = (value) => (value ? value.toISOString() : null);
const dayStart = (isoDay) => new Date(`${isoDay}T00:00:00.000Z`);
const money = (value) => (value === null || value === undefined ? null : toMoneyString(String(value)));
const DAY_MS = 24 * 60 * 60 * 1000;

/** Eşya ekranındaki en fazla iletişim notu (en yeniler). */
const DETAIL_NOTE_LIMIT = 100;
/** Çıkış penceresinde gösterilen en fazla eşya. */
const CHECKOUT_ITEM_LIMIT = 10;
/** Eşleştirme adayı için okunan en fazla konaklama (oda başına bir haftada fazlasıyla yeter). */
const CANDIDATE_SCAN_LIMIT = 60;

const ITEM_SELECT = Object.freeze({
  id: true,
  reference: true,
  description: true,
  category: true,
  valuable: true,
  roomId: true,
  locationText: true,
  foundAt: true,
  businessDate: true,
  foundByName: true,
  storageLocation: true,
  status: true,
  guestId: true,
  reservationId: true,
  matchedAt: true,
  matchedBy: true,
  returnMethod: true,
  receiverName: true,
  receiverIdChecked: true,
  carrier: true,
  trackingNumber: true,
  shippingAddress: true,
  shippingCost: true,
  shippingPayer: true,
  returnNote: true,
  disposalMethod: true,
  disposalReason: true,
  closedAt: true,
  closedBy: true,
  photosPurgedAt: true,
  recordedBy: true,
  createdAt: true,
  updatedAt: true,
  room: { select: { number: true } },
  guest: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
  reservation: {
    select: { id: true, confirmationCode: true, status: true, checkIn: true, checkOut: true, room: { select: { number: true } } },
  },
});

/* ─────────────── Ortak okumalar ─────────────── */

/**
 * Otelin saklama süreleri.
 * @param {any} client
 * @param {string} hotelId
 */
async function loadRetention(client, hotelId) {
  const hotel = await client.hotel.findFirst({
    where: { id: hotelId },
    select: { lostItemRetentionDays: true, lostItemValuableRetentionDays: true },
  });
  if (!hotel) throw new NotFoundError('Otel kaydı bulunamadı');
  return { retentionDays: hotel.lostItemRetentionDays, valuableRetentionDays: hotel.lostItemValuableRetentionDays };
}

/** @param {string} hotelId @param {Date} [at] */
async function businessDay(hotelId, at) {
  return toIsoDay(await getBusinessDate(hotelId, at));
}

/**
 * Eşyaların kapak fotoğrafı ve fotoğraf sayısı (sayfa başına tek sorgu).
 * @param {string} hotelId
 * @param {string[]} itemIds
 */
async function photoSummary(hotelId, itemIds) {
  if (itemIds.length === 0) return new Map();
  const photos = await prisma.lostItemPhoto.findMany({
    where: { hotelId, itemId: { in: itemIds } },
    select: { id: true, itemId: true },
    orderBy: [{ itemId: 'asc' }, { createdAt: 'asc' }],
  });
  const summary = new Map();
  for (const photo of photos) {
    const entry = summary.get(photo.itemId) ?? { coverPhotoId: photo.id, photoCount: 0 };
    entry.photoCount += 1;
    summary.set(photo.itemId, entry);
  }
  return summary;
}

/**
 * @param {any} row `ITEM_SELECT`
 * @param {{ retention: { retentionDays: number, valuableRetentionDays: number }, today: string, includeContact: boolean, photos?: { coverPhotoId: string, photoCount: number } }} context
 */
function toItemDto(row, { retention, today, includeContact, photos }) {
  const businessDate = toIsoDay(row.businessDate);
  const base = { status: row.status, businessDate, valuable: row.valuable };
  return {
    id: row.id,
    reference: row.reference,
    description: row.description,
    category: row.category,
    valuable: row.valuable,
    status: row.status,
    roomId: row.roomId,
    roomNumber: row.room?.number ?? null,
    locationText: row.locationText,
    foundAt: iso(row.foundAt),
    businessDate,
    foundByName: row.foundByName,
    storageLocation: row.storageLocation,
    guest: row.guest
      ? {
          id: row.guest.id,
          name: guestFullName(row.guest),
          ...(includeContact ? { phone: row.guest.phone, email: row.guest.email } : {}),
        }
      : null,
    stay: row.reservation
      ? {
          id: row.reservation.id,
          confirmationCode: row.reservation.confirmationCode,
          status: row.reservation.status,
          checkIn: toIsoDay(row.reservation.checkIn),
          checkOut: toIsoDay(row.reservation.checkOut),
          roomNumber: row.reservation.room?.number ?? null,
        }
      : null,
    matchedAt: iso(row.matchedAt),
    matchedBy: row.matchedBy,
    retainUntil: lostItemRetainUntil(base, retention),
    expired: lostItemExpired(base, retention, today),
    returned:
      row.status === 'RETURNED'
        ? {
            method: row.returnMethod,
            receiverName: row.receiverName,
            receiverIdChecked: row.receiverIdChecked,
            carrier: row.carrier,
            trackingNumber: row.trackingNumber,
            shippingCost: money(row.shippingCost),
            shippingPayer: row.shippingPayer,
            note: row.returnNote,
            ...(includeContact ? { shippingAddress: row.shippingAddress } : {}),
          }
        : null,
    disposal: row.status === 'DISPOSED' ? { method: row.disposalMethod, reason: row.disposalReason } : null,
    closedAt: iso(row.closedAt),
    closedBy: row.closedBy,
    photosPurgedAt: iso(row.photosPurgedAt),
    recordedBy: row.recordedBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    coverPhotoId: photos?.coverPhotoId ?? null,
    photoCount: photos?.photoCount ?? 0,
  };
}

/**
 * Kilitli eşya; sürüm damgası tutmuyorsa (başkası değiştirdi) 409, işlem
 * eşyanın durumunda yapılamıyorsa 409.
 *
 * @param {any} tx
 * @param {string} hotelId
 * @param {string} id
 * @param {Date | null} expectedUpdatedAt `null`: damga denetlenmez (ekleme işlemleri)
 * @param {Parameters<typeof lostItemActionError>[1]} action
 */
export async function lockedItem(tx, hotelId, id, expectedUpdatedAt, action) {
  if (!(await lockLostItems(tx, hotelId, [id])).has(id)) throw new NotFoundError('Kayıp eşya kaydı bulunamadı');
  const item = await tx.lostItem.findFirst({ where: { id, hotelId }, select: ITEM_SELECT });
  if (expectedUpdatedAt && item.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
  const blocked = lostItemActionError(item.status, action);
  if (blocked) throw new ConflictError(blocked, 'LOST_ITEM_RULE', { status: item.status });
  return item;
}

/** Denetim izine yazılan özet (iletişim bilgisi ve adres yok). */
const itemAudit = (item) => ({
  reference: item.reference,
  description: item.description,
  category: item.category,
  valuable: item.valuable,
  roomId: item.roomId,
  locationText: item.locationText,
  foundAt: iso(item.foundAt),
  foundByName: item.foundByName,
  storageLocation: item.storageLocation,
  status: item.status,
  guestId: item.guestId,
  reservationId: item.reservationId,
});

/**
 * @param {any} tx
 * @param {string} hotelId
 * @param {string | null | undefined} roomId
 */
async function assertRoom(tx, hotelId, roomId) {
  if (!roomId) return;
  const room = await tx.room.findFirst({ where: { id: roomId, hotelId }, select: { id: true } });
  if (!room) throw new ValidationError('Seçilen oda bulunamadı', { field: 'roomId' });
}

/**
 * @param {Date} foundAt
 * @param {Date} now
 */
function assertFoundAt(foundAt, now) {
  const error = lostItemFoundAtError(foundAt, now);
  if (error) throw new ValidationError(error, { field: 'foundAt' });
}

/* ─────────────── Okuma ─────────────── */

/**
 * Eşya ekranı: bilgiler, fotoğraflar, iletişim notları.
 * @param {string} hotelId
 * @param {string} id
 * @param {{ includeContact: boolean }} options
 */
export async function getLostItem(hotelId, id, { includeContact }) {
  const [row, retention, today] = await Promise.all([
    prisma.lostItem.findFirst({ where: { id, hotelId }, select: ITEM_SELECT }),
    loadRetention(prisma, hotelId),
    businessDay(hotelId),
  ]);
  if (!row) throw new NotFoundError('Kayıp eşya kaydı bulunamadı');
  const [photos, notes] = await Promise.all([
    prisma.lostItemPhoto.findMany({
      where: { itemId: id, hotelId },
      select: { id: true, contentType: true, sizeBytes: true, createdBy: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.lostItemNote.findMany({
      where: { itemId: id, hotelId },
      select: { id: true, channel: true, text: true, createdBy: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: DETAIL_NOTE_LIMIT,
    }),
  ]);
  return {
    ...toItemDto(row, {
      retention,
      today,
      includeContact,
      photos: photos.length ? { coverPhotoId: photos[0].id, photoCount: photos.length } : undefined,
    }),
    photos: photos.map((photo) => ({ ...photo, createdAt: iso(photo.createdAt) })),
    notes: notes.map((note) => ({ ...note, createdAt: iso(note.createdAt) })),
    retention,
  };
}

/**
 * Liste: görünüm (saklananlar / teslim bekleyen / süresi dolan / teslim edilen /
 * kapatılan), kategori, değerli, bulunma günü aralığı; etiket no, oda no,
 * açıklama ya da eşleşen misafir adıyla arama. Sayfalı; sayım sınırlı.
 *
 * @param {string} hotelId
 * @param {{ view: string, search?: string, category?: string, valuable?: boolean, from?: string, to?: string, page: number, pageSize: number }} query
 * @param {{ includeContact: boolean }} options
 */
export async function listLostItems(hotelId, query, { includeContact }) {
  const [retention, today] = await Promise.all([loadRetention(prisma, hotelId), businessDay(hotelId)]);
  const and = [viewFilter(query.view, retention, today)];
  if (query.category) and.push({ category: query.category });
  if (query.valuable !== undefined) and.push({ valuable: query.valuable });
  if (query.from || query.to) {
    and.push({ businessDate: { ...(query.from ? { gte: dayStart(query.from) } : {}), ...(query.to ? { lte: dayStart(query.to) } : {}) } });
  }
  for (const token of searchTokens(query.search)) and.push(await tokenFilter(hotelId, token));

  const where = { hotelId, AND: and };
  // Kapanmış kayıtlar son kapanan önce ((hotelId, status, closedAt) index'i); açıklar son bulunan önce;
  // süresi dolanlar en eski önce (kapatma sırası; aynı index geriye taranır).
  const orderBy = ['RETURNED', 'DISPOSED'].includes(query.view)
    ? [{ closedAt: 'desc' }, { id: 'desc' }]
    : query.view === 'EXPIRED'
      ? [{ foundAt: 'asc' }, { id: 'asc' }]
      : [{ foundAt: 'desc' }, { id: 'desc' }];
  const [rows, counted] = await Promise.all([
    prisma.lostItem.findMany({ where, orderBy, ...toSkipTake(query), select: ITEM_SELECT }),
    prisma.lostItem.count({ where, take: RESERVATION_COUNT_CAP + 1 }),
  ]);
  const photos = await photoSummary(hotelId, rows.map((row) => row.id));
  const totalCapped = counted > RESERVATION_COUNT_CAP;
  const page = buildPage(
    rows.map((row) => toItemDto(row, { retention, today, includeContact, photos: photos.get(row.id) })),
    totalCapped ? RESERVATION_COUNT_CAP : counted,
    query,
  );
  return { ...page, meta: { ...page.meta, totalCapped, today } };
}

/**
 * @param {string} view
 * @param {{ retentionDays: number, valuableRetentionDays: number }} retention
 * @param {string} today
 */
function viewFilter(view, retention, today) {
  if (view === 'MATCHED') return { status: 'MATCHED' };
  if (view === 'RETURNED') return { status: 'RETURNED' };
  if (view === 'DISPOSED') return { status: 'DISPOSED' };
  if (view === 'EXPIRED') return expiredFilter(retention, today);
  return { status: { in: [...LOST_ITEM_OPEN_STATUSES] } };
}

/**
 * Süresi dolan açık eşyalar: bulunduğu gün, (değerli / normal) süre eşiğinden
 * önce ((hotelId, status, valuable, businessDate) index'i).
 * @param {{ retentionDays: number, valuableRetentionDays: number }} retention
 * @param {string} today
 */
function expiredFilter(retention, today) {
  return {
    status: { in: [...LOST_ITEM_OPEN_STATUSES] },
    OR: [
      { valuable: false, businessDate: { lt: dayStart(lostItemExpiryCutoff(today, retention.retentionDays)) } },
      { valuable: true, businessDate: { lt: dayStart(lostItemExpiryCutoff(today, retention.valuableRetentionDays)) } },
    ],
  };
}

/**
 * Bir arama kelimesi: etiket no (tam), oda no (tam), açıklama (trigram) ya da
 * eşleşen misafirin adı.
 * @param {string} hotelId
 * @param {string} token
 */
async function tokenFilter(hotelId, token) {
  const fuzzy = isFuzzyToken(token);
  const [roomIds, guestIds] = await Promise.all([
    matchRoomIdsByNumber(prisma, hotelId, token),
    fuzzy ? matchGuestIds(prisma, hotelId, token) : Promise.resolve([]),
  ]);
  const reference = referenceFromToken('LF', token);
  const or = [];
  if (reference) or.push({ reference });
  if (roomIds.length) or.push({ roomId: { in: roomIds } });
  if (fuzzy) or.push({ description: containsText(token) }, { locationText: containsText(token) });
  if (guestIds.length) or.push({ guestId: { in: guestIds } });
  return or.length ? { OR: or } : MATCH_NOTHING;
}

/**
 * Sekme sayaçları: saklanan, teslim bekleyen, süresi dolan.
 * @param {string} hotelId
 */
export async function getLostItemSummary(hotelId) {
  const [retention, today] = await Promise.all([loadRetention(prisma, hotelId), businessDay(hotelId)]);
  const [open, matched, expired] = await Promise.all([
    prisma.lostItem.count({ where: { hotelId, status: { in: [...LOST_ITEM_OPEN_STATUSES] } } }),
    prisma.lostItem.count({ where: { hotelId, status: 'MATCHED' } }),
    prisma.lostItem.count({ where: { hotelId, ...expiredFilter(retention, today) } }),
  ]);
  return { open, matched, expired, today, retention };
}

/* ─────────────── Kayıt ─────────────── */

/**
 * Bulunan eşyayı kaydeder. Aynı istek kimliğiyle ikinci gönderim yeni kayıt açmaz.
 *
 * @param {string} hotelId
 * @param {object} input `lostItemInputSchema` çıktısı
 * @param {{ now?: Date, includeContact?: boolean }} [options]
 * @returns {Promise<{ item: object, created: boolean }>}
 */
export async function createLostItem(hotelId, input, { now = new Date(), includeContact = false } = {}) {
  assertFoundAt(input.foundAt, now);
  const businessDate = await businessDay(hotelId, input.foundAt);
  const actor = currentActor();
  let outcome;
  try {
    outcome = await writeWithEvents(async (tx, stage) => {
      const existing = await tx.lostItem.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } });
      if (existing) return { id: existing.id, created: false };
      await assertRoom(tx, hotelId, input.roomId);

      const reference = await freeReference(tx, hotelId);
      const created = await tx.lostItem.create({
        data: {
          hotelId,
          reference,
          requestId: input.requestId,
          description: input.description,
          category: input.category,
          valuable: input.valuable,
          roomId: input.roomId ?? null,
          locationText: input.locationText ?? null,
          foundAt: input.foundAt,
          businessDate: dayStart(businessDate),
          foundByName: input.foundByName,
          storageLocation: input.storageLocation,
          recordedBy: actor,
          ...(input.note ? { notes: { create: { hotelId, channel: 'NOTE', text: input.note, createdBy: actor } } } : {}),
        },
        select: ITEM_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'LostItem', entityId: created.id, action: 'CREATE', after: itemAudit(created) });
      await stage('lost_item.recorded', { hotelId, itemId: created.id, roomId: created.roomId, valuable: created.valuable });
      return { id: created.id, created: true };
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu eşya zaten kaydedildi' });
  }
  return { item: await getLostItem(hotelId, outcome.id, { includeContact }), created: outcome.created };
}

/**
 * Otelde boşta bir etiket no (çakışma olasılığı çok düşük; tekil kısıt son savunma).
 * @param {any} tx
 * @param {string} hotelId
 */
async function freeReference(tx, hotelId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = newReference('LF');
    if (!(await tx.lostItem.findFirst({ where: { hotelId, reference }, select: { id: true } }))) return reference;
  }
  throw new ConflictError('Etiket numarası üretilemedi; tekrar deneyin.', 'REFERENCE_BUSY');
}

/**
 * Açık eşyanın bilgilerini düzeltir (açıklama, kategori, değerli, yer, bulan,
 * bulunma zamanı, saklandığı yer).
 *
 * @param {string} hotelId
 * @param {string} id
 * @param {object} input `updateLostItemSchema` çıktısı
 * @param {{ now?: Date, includeContact?: boolean }} [options]
 */
export async function updateLostItem(hotelId, id, input, { now = new Date(), includeContact = false } = {}) {
  assertFoundAt(input.foundAt, now);
  const businessDate = await businessDay(hotelId, input.foundAt);
  try {
    await writeWithEvents(async (tx, stage) => {
      const item = await lockedItem(tx, hotelId, id, input.expectedUpdatedAt, 'EDIT');
      await assertRoom(tx, hotelId, input.roomId);
      const updated = await tx.lostItem.update({
        where: { id },
        data: {
          description: input.description,
          category: input.category,
          valuable: input.valuable,
          roomId: input.roomId ?? null,
          locationText: input.locationText ?? null,
          foundAt: input.foundAt,
          businessDate: dayStart(businessDate),
          foundByName: input.foundByName,
          storageLocation: input.storageLocation,
        },
        select: ITEM_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'LostItem', entityId: id, action: 'UPDATE', before: itemAudit(item), after: itemAudit(updated) });
      await stage('lost_item.changed', { hotelId, itemId: id, status: updated.status, change: 'UPDATED', guestId: updated.guestId });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getLostItem(hotelId, id, { includeContact });
}

/* ─────────────── Eşleştirme ─────────────── */

/**
 * Eşleştirme adayları: eşya odada bulunduysa o sırada odada kalan ve son
 * günlerde odadan ayrılan konaklamalar (oda değişimi dahil), misafirleri ve
 * refakatçileriyle. Ortak alanda bulunan eşyada aday yok (misafir araması).
 *
 * @param {string} hotelId
 * @param {string} id
 */
export async function getMatchCandidates(hotelId, id) {
  const item = await prisma.lostItem.findFirst({
    where: { id, hotelId },
    select: { id: true, roomId: true, foundAt: true, room: { select: { number: true } } },
  });
  if (!item) throw new NotFoundError('Kayıp eşya kaydı bulunamadı');
  if (!item.roomId) return { roomNumber: null, foundAt: iso(item.foundAt), lookbackDays: LOST_ITEM_MATCH_LOOKBACK_DAYS, candidates: [] };

  // Aralık sınırı gün hassasiyetinde (giriş / çıkış günleri gün başı): bir gün pay.
  const since = new Date(item.foundAt.getTime() - (LOST_ITEM_MATCH_LOOKBACK_DAYS + 1) * DAY_MS);
  const stayStatuses = ['CHECKED_IN', 'CHECKED_OUT'];
  const [current, segments] = await Promise.all([
    // (hotelId, roomId, checkIn, checkOut) index'i.
    prisma.reservation.findMany({
      where: { hotelId, roomId: item.roomId, status: { in: stayStatuses }, checkIn: { lte: item.foundAt }, checkOut: { gte: since } },
      select: { id: true, status: true, checkIn: true, checkOut: true, roomSince: true, checkedInAt: true, checkedOutAt: true },
      orderBy: { checkOut: 'desc' },
      take: CANDIDATE_SCAN_LIMIT,
    }),
    // (hotelId, roomId, startDate, endDate) index'i: bu odadan taşınanların eski dilimleri.
    prisma.roomStaySegment.findMany({
      where: {
        hotelId,
        roomId: item.roomId,
        startDate: { lte: item.foundAt },
        endDate: { gte: since },
        reservation: { status: { in: stayStatuses }, deletedAt: null },
      },
      select: { reservationId: true, startDate: true, endDate: true, createdAt: true },
      orderBy: { endDate: 'desc' },
      take: CANDIDATE_SCAN_LIMIT,
    }),
  ]);
  const ranked = rankCandidates(roomIntervals({ current, segments }), item.foundAt);
  if (ranked.length === 0) return { roomNumber: item.room?.number ?? null, foundAt: iso(item.foundAt), lookbackDays: LOST_ITEM_MATCH_LOOKBACK_DAYS, candidates: [] };

  const stays = await prisma.reservation.findMany({
    where: { hotelId, id: { in: ranked.map((entry) => entry.reservationId) } },
    select: {
      id: true,
      confirmationCode: true,
      status: true,
      checkIn: true,
      checkOut: true,
      checkedOutAt: true,
      guestId: true,
      room: { select: { number: true } },
      guest: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      reservationGuests: {
        where: { deletedAt: null },
        select: { isPrimary: true, guest: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  const byId = new Map(stays.map((stay) => [stay.id, stay]));
  return {
    roomNumber: item.room?.number ?? null,
    foundAt: iso(item.foundAt),
    lookbackDays: LOST_ITEM_MATCH_LOOKBACK_DAYS,
    candidates: ranked
      .filter((entry) => byId.has(entry.reservationId))
      .map((entry) => {
        const stay = byId.get(entry.reservationId);
        return {
          reservationId: stay.id,
          confirmationCode: stay.confirmationCode,
          status: stay.status,
          checkIn: toIsoDay(stay.checkIn),
          checkOut: toIsoDay(stay.checkOut),
          checkedOutAt: iso(stay.checkedOutAt),
          currentRoomNumber: stay.room?.number ?? null,
          relation: entry.relation,
          leftAt: iso(entry.leftAt),
          guests: stayGuests(stay),
        };
      }),
  };
}

/**
 * Konaklamanın misafirleri: kaydın sahibi önce, refakatçiler sonra (tekrar yok).
 * @param {any} stay
 */
function stayGuests(stay) {
  const guests = [{ ...stay.guest, isPrimary: true }];
  for (const link of stay.reservationGuests) {
    if (link.guest.id !== stay.guest.id) guests.push({ ...link.guest, isPrimary: false });
  }
  return guests.map((guest) => ({ id: guest.id, name: guestFullName(guest), phone: guest.phone, email: guest.email, isPrimary: guest.isPrimary }));
}

/**
 * Ortak alanda bulunan eşya için misafir araması (ad, telefon, e-posta).
 * @param {string} hotelId
 * @param {string} q
 */
export async function searchOwners(hotelId, q) {
  return searchGuests(hotelId, q, await getHotelSettings(hotelId));
}

/**
 * Eşyayı misafirle eşleştirir (sahibi bulundu). Konaklama verildiyse misafir
 * o konaklamanın misafirlerinden biri olmalı. Eşleşmiş eşya başka misafirle
 * yeniden eşleştirilebilir.
 *
 * @param {string} hotelId
 * @param {string} id
 * @param {{ expectedUpdatedAt: Date, guestId: string, reservationId?: string | null }} input
 * @param {{ now?: Date }} [options]
 */
export async function matchLostItem(hotelId, id, { expectedUpdatedAt, guestId, reservationId }, { now = new Date() } = {}) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const item = await lockedItem(tx, hotelId, id, expectedUpdatedAt, 'MATCH');
      if (reservationId) {
        const stay = await tx.reservation.findFirst({
          where: { id: reservationId, hotelId },
          select: { guestId: true, reservationGuests: { where: { guestId, deletedAt: null }, select: { id: true } } },
        });
        if (!stay) throw new ValidationError('Konaklama bulunamadı', { field: 'reservationId' });
        if (stay.guestId !== guestId && stay.reservationGuests.length === 0) {
          throw new ValidationError('Seçilen misafir bu konaklamada kalmıyor', { field: 'guestId' });
        }
      } else if (!(await tx.guest.findFirst({ where: { id: guestId, hotelId }, select: { id: true } }))) {
        throw new ValidationError('Misafir bulunamadı', { field: 'guestId' });
      }
      await tx.lostItem.update({
        where: { id },
        data: { status: 'MATCHED', guestId, reservationId: reservationId ?? null, matchedAt: now, matchedBy: actor },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'LostItem',
        entityId: id,
        action: 'UPDATE',
        before: { status: item.status, guestId: item.guestId, reservationId: item.reservationId },
        after: { status: 'MATCHED', guestId, reservationId: reservationId ?? null },
      });
      await stage('lost_item.changed', { hotelId, itemId: id, status: 'MATCHED', change: 'MATCHED', guestId });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getLostItem(hotelId, id, { includeContact: true });
}

/**
 * Yanlış eşleşmeyi kaldırır (gerekçe iletişim notlarına da yazılır).
 * @param {string} hotelId
 * @param {string} id
 * @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function unmatchLostItem(hotelId, id, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const item = await lockedItem(tx, hotelId, id, expectedUpdatedAt, 'UNMATCH');
      await tx.lostItem.update({
        where: { id },
        data: { status: 'STORED', guestId: null, reservationId: null, matchedAt: null, matchedBy: null },
      });
      await tx.lostItemNote.create({
        data: { hotelId, itemId: id, channel: 'NOTE', text: `Eşleşme kaldırıldı (${guestFullName(item.guest)}): ${reason}`, createdBy: actor },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'LostItem',
        entityId: id,
        action: 'UPDATE',
        before: { status: item.status, guestId: item.guestId, reservationId: item.reservationId },
        after: { status: 'STORED', guestId: null, reservationId: null, reason },
      });
      await stage('lost_item.changed', { hotelId, itemId: id, status: 'STORED', change: 'UNMATCHED', guestId: item.guestId });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getLostItem(hotelId, id, { includeContact: true });
}

/**
 * İletişim notu ("aradım, açmadı", "kargo adresini yolladı"). Her durumda
 * yazılır; silinmez. Eşyanın sürüm damgası değişmez (açık ekranlar bozulmaz).
 *
 * @param {string} hotelId
 * @param {string} id
 * @param {{ channel: string, text: string }} input
 */
export async function addContactNote(hotelId, id, { channel, text }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const item = await tx.lostItem.findFirst({ where: { id, hotelId }, select: { id: true, status: true, guestId: true } });
    if (!item) throw new NotFoundError('Kayıp eşya kaydı bulunamadı');
    const note = await tx.lostItemNote.create({ data: { hotelId, itemId: id, channel, text, createdBy: actor }, select: { id: true } });
    // Not kendisi değişmez bir iz; denetim kaydı aktivite akışında da görünsün diye.
    await recordAudit(tx, { hotelId, entity: 'LostItem', entityId: id, action: 'UPDATE', before: {}, after: { noteId: note.id, channel } });
    await stage('lost_item.changed', { hotelId, itemId: id, status: item.status, change: 'CONTACTED', guestId: item.guestId });
  });
  return { channel, channelLabel: LOST_ITEM_CONTACT_CHANNEL_LABELS[channel] };
}

/* ─────────────── Sonuç: teslim / kapatma ─────────────── */

/**
 * Teslim: elden (değerli eşyada kimlik görülmesi zorunlu) ya da kargo.
 * Eşleşmemiş eşya da teslim edilebilir (misafir gelip tarif etti); teslim alan
 * adı kayda geçer.
 *
 * @param {string} hotelId
 * @param {string} id
 * @param {object} input `lostItemReturnSchema` çıktısı
 * @param {{ now?: Date }} [options]
 */
export async function returnLostItem(hotelId, id, input, { now = new Date() } = {}) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const item = await lockedItem(tx, hotelId, id, input.expectedUpdatedAt, 'RETURN');
      const blocked = lostItemReturnError(item, input);
      if (blocked) throw new ValidationError(blocked, { field: 'receiverIdChecked' });
      const shipped = input.method === 'SHIPPED';
      await tx.lostItem.update({
        where: { id },
        data: {
          status: 'RETURNED',
          returnMethod: input.method,
          receiverName: input.receiverName ?? (shipped && item.guest ? guestFullName(item.guest) : null),
          receiverIdChecked: !shipped && input.receiverIdChecked,
          carrier: shipped ? input.carrier : null,
          trackingNumber: shipped ? input.trackingNumber : null,
          shippingAddress: shipped ? input.shippingAddress : null,
          shippingCost: shipped ? input.shippingCost : null,
          shippingPayer: shipped ? input.shippingPayer : null,
          returnNote: input.note ?? null,
          closedAt: now,
          closedBy: actor,
        },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'LostItem',
        entityId: id,
        action: 'UPDATE',
        before: { status: item.status },
        after: {
          status: 'RETURNED',
          method: input.method,
          receiverName: input.receiverName ?? null,
          receiverIdChecked: !shipped && input.receiverIdChecked,
          ...(shipped ? { carrier: input.carrier, trackingNumber: input.trackingNumber, shippingPayer: input.shippingPayer } : {}),
        },
      });
      await stage('lost_item.changed', { hotelId, itemId: id, status: 'RETURNED', change: 'RETURNED', guestId: item.guestId });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getLostItem(hotelId, id, { includeContact: true });
}

/**
 * Kapatma: sahibi çıkmayan eşya (bağış, imha, polis) ya da hatalı kayıt.
 * @param {string} hotelId
 * @param {string} id
 * @param {{ expectedUpdatedAt: Date, method: string, reason: string }} input
 * @param {{ now?: Date, includeContact?: boolean }} [options]
 */
export async function disposeLostItem(hotelId, id, { expectedUpdatedAt, method, reason }, { now = new Date(), includeContact = false } = {}) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const item = await lockedItem(tx, hotelId, id, expectedUpdatedAt, 'DISPOSE');
      await tx.lostItem.update({
        where: { id },
        data: { status: 'DISPOSED', disposalMethod: method, disposalReason: reason, closedAt: now, closedBy: actor },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'LostItem',
        entityId: id,
        action: 'UPDATE',
        before: { status: item.status },
        after: { status: 'DISPOSED', method: LOST_ITEM_DISPOSAL_LABELS[method], reason },
      });
      await stage('lost_item.changed', { hotelId, itemId: id, status: 'DISPOSED', change: 'DISPOSED', guestId: item.guestId });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getLostItem(hotelId, id, { includeContact });
}

/* ─────────────── Ayarlar ─────────────── */

/** @param {string} hotelId */
export async function getLostItemSettings(hotelId) {
  return loadRetention(prisma, hotelId);
}

/**
 * Saklama süreleri. Bütün açık eşyalara hemen uygulanır (süre kolonu yok).
 * @param {string} hotelId
 * @param {{ retentionDays: number, valuableRetentionDays: number }} input
 */
export async function updateLostItemSettings(hotelId, { retentionDays, valuableRetentionDays }) {
  await writeWithEvents(async (tx, stage) => {
    const before = await loadRetention(tx, hotelId);
    await tx.hotel.update({ where: { id: hotelId }, data: { lostItemRetentionDays: retentionDays, lostItemValuableRetentionDays: valuableRetentionDays } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Hotel',
      entityId: hotelId,
      action: 'UPDATE',
      before: { lostItemRetentionDays: before.retentionDays, lostItemValuableRetentionDays: before.valuableRetentionDays },
      after: { lostItemRetentionDays: retentionDays, lostItemValuableRetentionDays: valuableRetentionDays },
    });
    await stage('lost_items.settings.changed', { hotelId });
    // Otel satırı (sürüm damgası) değişti: açık "Genel parametreler" formu eski damgayla kaydedemesin diye.
    await stage('settings.hotel.updated', { hotelId, changedFields: ['lostItemRetentionDays', 'lostItemValuableRetentionDays'] });
  });
  return getLostItemSettings(hotelId);
}

/* ─────────────── Çıkış penceresi ─────────────── */

/**
 * Çıkış yapan misafirin teslim bekleyen eşyası (ona / konaklamasına eşleşmiş)
 * ve odasında konaklama süresince bulunup henüz eşleşmemiş eşyalar.
 *
 * @param {any} client
 * @param {string} hotelId
 * @param {{ id: string, guestId: string, roomId: string | null, checkedInAt: Date | null, checkIn: Date }} stay
 */
export async function lostItemsForCheckOut(client, hotelId, stay) {
  const select = { id: true, reference: true, description: true, storageLocation: true, valuable: true, foundAt: true };
  const [matched, foundInRoom] = await Promise.all([
    // (reservationId, status) ve (guestId, status) index'leri.
    client.lostItem.findMany({
      where: { hotelId, status: 'MATCHED', OR: [{ reservationId: stay.id }, { guestId: stay.guestId }] },
      select,
      orderBy: { foundAt: 'desc' },
      take: CHECKOUT_ITEM_LIMIT,
    }),
    stay.roomId
      ? client.lostItem.findMany({
          // (hotelId, roomId, foundAt) index'i.
          where: { hotelId, roomId: stay.roomId, status: 'STORED', foundAt: { gte: stay.checkedInAt ?? stay.checkIn } },
          select,
          orderBy: { foundAt: 'desc' },
          take: CHECKOUT_ITEM_LIMIT,
        })
      : [],
  ]);
  const dto = (row) => ({ ...row, foundAt: iso(row.foundAt) });
  return { matched: matched.map(dto), foundInRoom: foundInRoom.map(dto) };
}
