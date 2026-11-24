import { randomBytes } from 'node:crypto';
import { currentActor, toIsoDay, toUtcDayStart } from '@hotelos/core';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { AppError, ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { getActiveRatePlans } from '../pricing/service.js';
import { getActiveAdjustments } from '../pricing/yield-service.js';
import { priceStay } from '../reservations/rules.js';
import { createReservation } from '../reservations/service.js';
import { getActiveRoomTypes, getActiveSeasons, getHotelSettings } from '../settings/service.js';
import { assertLeadTransition, assertQuoteTransition, generateQuoteCode, splitLeadName } from './rules.js';

/**
 * Satış CRM servisi (modül 36): fırsat (Lead), arama kaydı (CallLog), teklif
 * (Quote).
 *
 * - Teklifin fiyatı **hazırlandığı anda kilitlenir**: gece gece anlık görüntü
 *   o anki sistem fiyatıyla (M28 plan + M34 onaylı çarpan dahil) yazılır;
 *   sonradan fiyat değişse de müşteriye verilen söz değişmez. Kabulde
 *   rezervasyon bu toplamla (elle fiyat, gerekçe teklif kodu) açılır.
 * - Kabul **idempotenttir**: rezervasyon `requestId = quote.id` ile açılır —
 *   iki adımın (rezervasyon + işaretleme) arasında kopan istek tekrarlandığında
 *   ikinci rezervasyon açılmaz, aynı kayıt bulunur.
 * - WON yalnız teklif kabulüyle; LOST sebep ister (rules.js).
 */

const QUOTE_CODE_ATTEMPTS = 5;
const DAY_MS = 86_400_000;

const money = (value) => Number(value).toFixed(2);
const isoDay = (value) => (value ? toIsoDay(value) : null);

/* ══════════════════ DTO ══════════════════ */

const LEAD_SELECT = Object.freeze({
  id: true,
  name: true,
  company: true,
  phone: true,
  email: true,
  source: true,
  status: true,
  guestId: true,
  checkIn: true,
  checkOut: true,
  roomTypeId: true,
  adults: true,
  children: true,
  notes: true,
  followUpAt: true,
  wonReservationId: true,
  lostReason: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  roomType: { select: { code: true, name: true } },
  guest: { select: { firstName: true, lastName: true } },
});

function toLeadDto(row, extras = {}) {
  return {
    id: row.id,
    name: row.name,
    company: row.company ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    source: row.source,
    status: row.status,
    guestId: row.guestId ?? null,
    guestName: row.guest ? `${row.guest.firstName} ${row.guest.lastName}` : null,
    checkIn: isoDay(row.checkIn),
    checkOut: isoDay(row.checkOut),
    roomTypeId: row.roomTypeId ?? null,
    roomTypeName: row.roomType?.name ?? null,
    adults: row.adults ?? null,
    children: row.children ?? null,
    notes: row.notes ?? null,
    followUpAt: isoDay(row.followUpAt),
    wonReservationId: row.wonReservationId ?? null,
    lostReason: row.lostReason ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...extras,
  };
}

/** Denetim izi: türetilmiş adlar ayıklanır. */
function leadSnapshot(dto) {
  const { guestName, roomTypeName, callCount, quoteCount, ...rest } = dto;
  return rest;
}

function toCallDto(row) {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    phone: row.phone ?? null,
    outcome: row.outcome,
    summary: row.summary,
    recordingRef: row.recordingRef ?? null,
    calledAt: row.calledAt.toISOString(),
    createdBy: row.createdBy,
  };
}

const QUOTE_SELECT = Object.freeze({
  id: true,
  leadId: true,
  code: true,
  status: true,
  roomTypeId: true,
  boardType: true,
  checkIn: true,
  checkOut: true,
  adults: true,
  children: true,
  nightsSnapshot: true,
  total: true,
  currency: true,
  validUntil: true,
  notes: true,
  sentAt: true,
  decidedAt: true,
  rejectReason: true,
  reservationId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  roomType: { select: { code: true, name: true } },
});

function toQuoteDto(row) {
  return {
    id: row.id,
    leadId: row.leadId,
    code: row.code,
    status: row.status,
    roomTypeId: row.roomTypeId,
    roomTypeName: row.roomType?.name ?? null,
    boardType: row.boardType,
    checkIn: isoDay(row.checkIn),
    checkOut: isoDay(row.checkOut),
    adults: row.adults,
    children: row.children,
    nights: Array.isArray(row.nightsSnapshot) ? row.nightsSnapshot : [],
    total: money(row.total),
    currency: row.currency,
    validUntil: isoDay(row.validUntil),
    notes: row.notes ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason ?? null,
    reservationId: row.reservationId ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function quoteSnapshotForAudit(dto) {
  const { nights, roomTypeName, ...rest } = dto;
  return { ...rest, nightCount: nights.length };
}

/* ══════════════════ Fırsatlar ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, status?: string, source?: string, dueOnly?: boolean }} query
 */
export async function listLeads(hotelId, query) {
  const businessDate = query.dueOnly ? await getBusinessDate(hotelId) : null;
  const where = {
    hotelId,
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.dueOnly
      ? { followUpAt: { lte: businessDate }, status: { in: ['NEW', 'QUOTED', 'WAITING'] } }
      : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { company: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.lead.findMany({
      where,
      orderBy: query.dueOnly ? [{ followUpAt: 'asc' }] : [{ updatedAt: 'desc' }],
      select: { ...LEAD_SELECT, _count: { select: { calls: true, quotes: { where: { deletedAt: null } } } } },
      ...toSkipTake(query),
    }),
    prisma.lead.count({ where }),
  ]);
  return buildPage(
    items.map((row) => toLeadDto(row, { callCount: row._count.calls, quoteCount: row._count.quotes })),
    total,
    query,
  );
}

/** Pano sayıları + bugün aranacaklar (özet şerit). */
export async function getSalesSummary(hotelId) {
  const businessDate = await getBusinessDate(hotelId);
  const [byStatus, dueToday] = await Promise.all([
    prisma.lead.groupBy({ by: ['status'], where: { hotelId, deletedAt: null }, _count: { _all: true } }),
    prisma.lead.count({
      where: { hotelId, deletedAt: null, status: { in: ['NEW', 'QUOTED', 'WAITING'] }, followUpAt: { lte: businessDate } },
    }),
  ]);
  const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
  return { byStatus: counts, dueToday, businessDate: isoDay(businessDate) };
}

/**
 * @param {string} hotelId
 * @param {object} input `createLeadSchema` çıktısı
 */
export async function createLead(hotelId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      await assertLeadRefs(tx, hotelId, input);
      const created = await tx.lead.create({
        data: { hotelId, ...input, createdBy: currentActor() },
        select: LEAD_SELECT,
      });
      const dto = toLeadDto(created);
      await recordAudit(tx, { hotelId, entity: 'Lead', entityId: created.id, action: 'CREATE', after: leadSnapshot(dto) });
      await stage('sales.lead.changed', { hotelId, leadId: created.id, change: 'CREATED' });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} leadId
 * @param {object} input `updateLeadSchema` çıktısı (durum burada değişmez)
 */
export async function updateLead(hotelId, leadId, input) {
  const { expectedUpdatedAt, ...data } = input;
  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.lead.findFirst({ where: { id: leadId, hotelId, deletedAt: null }, select: LEAD_SELECT });
      if (!before) throw new NotFoundError('Fırsat bulunamadı');
      await assertLeadRefs(tx, hotelId, data);
      await updateWithVersionCheck(tx, 'lead', { id: leadId, hotelId }, expectedUpdatedAt, data, 'Fırsat bulunamadı');
      const after = await tx.lead.findFirst({ where: { id: leadId }, select: LEAD_SELECT });
      const dto = toLeadDto(after);
      await recordAudit(tx, {
        hotelId,
        entity: 'Lead',
        entityId: leadId,
        action: 'UPDATE',
        before: leadSnapshot(toLeadDto(before)),
        after: leadSnapshot(dto),
      });
      await stage('sales.lead.changed', { hotelId, leadId, change: 'UPDATED' });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Pano durum geçişi (WON hariç — o yalnız teklif kabulüyle).
 * @param {string} hotelId
 * @param {string} leadId
 * @param {{ status: string, lostReason?: string | null, expectedUpdatedAt: Date }} input
 */
export async function setLeadStatus(hotelId, leadId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.lead.findFirst({ where: { id: leadId, hotelId, deletedAt: null }, select: LEAD_SELECT });
      if (!before) throw new NotFoundError('Fırsat bulunamadı');
      assertLeadTransition(before.status, input.status);
      if (before.status === input.status) return toLeadDto(before);

      await updateWithVersionCheck(
        tx,
        'lead',
        { id: leadId, hotelId },
        input.expectedUpdatedAt,
        { status: input.status, lostReason: input.status === 'LOST' ? input.lostReason : null },
        'Fırsat bulunamadı',
      );
      const after = await tx.lead.findFirst({ where: { id: leadId }, select: LEAD_SELECT });
      const dto = toLeadDto(after);
      await recordAudit(tx, {
        hotelId,
        entity: 'Lead',
        entityId: leadId,
        action: 'UPDATE',
        before: leadSnapshot(toLeadDto(before)),
        after: leadSnapshot(dto),
      });
      await stage('sales.lead.changed', { hotelId, leadId, change: input.status === 'LOST' ? 'LOST' : 'STATUS_CHANGED' });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/** Fırsat dosyası: kart + aramalar + teklifler. */
export async function getLead(hotelId, leadId) {
  const row = await prisma.lead.findFirst({
    where: { id: leadId, hotelId, deletedAt: null },
    select: {
      ...LEAD_SELECT,
      calls: { orderBy: { calledAt: 'desc' }, take: 100 },
      quotes: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, select: QUOTE_SELECT },
    },
  });
  if (!row) throw new NotFoundError('Fırsat bulunamadı');
  return {
    ...toLeadDto(row),
    calls: row.calls.map(toCallDto),
    quotes: row.quotes.map(toQuoteDto),
  };
}

/** Misafir / oda tipi bağları bu otele ait ve yaşıyor olmalı. */
async function assertLeadRefs(tx, hotelId, data) {
  if (data.guestId) {
    const guest = await tx.guest.findFirst({ where: { id: data.guestId, hotelId, deletedAt: null }, select: { id: true } });
    if (!guest) throw new ValidationError('Seçilen misafir kartı bulunamadı', { field: 'guestId' });
  }
  if (data.roomTypeId) {
    const type = await tx.roomType.findFirst({ where: { id: data.roomTypeId, hotelId, deletedAt: null }, select: { id: true } });
    if (!type) throw new ValidationError('Seçilen oda tipi bulunamadı ya da silinmiş', { field: 'roomTypeId' });
  }
}

/* ══════════════════ Arama kayıtları ══════════════════ */

/**
 * Ekle-yalnız günlük; "tekrar aranacak" sonucu fırsatın takip tarihini de
 * günceller (ayrı adım unutulmasın).
 * @param {string} hotelId
 * @param {string} leadId
 * @param {object} input `createCallLogSchema` çıktısı
 */
export async function addCallLog(hotelId, leadId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, hotelId, deletedAt: null }, select: { id: true } });
      if (!lead) throw new NotFoundError('Fırsat bulunamadı');
      const { followUpAt, ...call } = input;
      const created = await tx.callLog.create({
        data: { hotelId, leadId, ...call, createdBy: currentActor() },
      });
      if (followUpAt) {
        await tx.lead.update({ where: { id: leadId }, data: { followUpAt } });
      }
      await recordAudit(tx, { hotelId, entity: 'CallLog', entityId: created.id, action: 'CREATE', after: toCallDto(created) });
      await stage('sales.lead.changed', { hotelId, leadId, change: 'UPDATED' });
      return toCallDto(created);
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/* ══════════════════ Teklifler ══════════════════ */

/**
 * O anki sistem fiyatıyla gece gece anlık görüntü (M28 plan + M34 onaylı
 * çarpan dahil). Teklifin sözü budur.
 */
async function priceQuote(hotelId, input) {
  const [hotel, roomTypes, seasons, ratePlans, adjustments] = await Promise.all([
    getHotelSettings(hotelId),
    getActiveRoomTypes(hotelId),
    getActiveSeasons(hotelId),
    getActiveRatePlans(hotelId),
    getActiveAdjustments(hotelId),
  ]);
  const type = roomTypes.find((row) => row.id === input.roomTypeId);
  if (!type) throw new ValidationError('Seçilen oda tipi bulunamadı ya da silinmiş', { field: 'roomTypeId' });
  if (input.adults > type.capacityAdults || input.children > type.capacityChildren) {
    throw new ValidationError(
      `${type.name} en fazla ${type.capacityAdults} yetişkin ve ${type.capacityChildren} çocuk alır`,
      { field: 'adults' },
    );
  }
  const priced = priceStay({
    basePrice: type.basePrice,
    seasons,
    ratePlans,
    adjustments,
    roomTypeId: input.roomTypeId,
    boardType: input.boardType,
    occupancy: { adults: input.adults, children: input.children },
    checkIn: input.checkIn,
    checkOut: input.checkOut,
  });
  return {
    currency: hotel.currency,
    nights: priced.nights.map((night) => ({ date: night.date, amount: night.amount })),
    total: priced.total,
  };
}

async function uniqueQuoteCode(tx, hotelId) {
  for (let attempt = 0; attempt < QUOTE_CODE_ATTEMPTS; attempt += 1) {
    const code = generateQuoteCode((size) => randomBytes(size));
    const taken = await tx.quote.findFirst({ where: { hotelId, code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new AppError('Teklif kodu üretilemedi; tekrar deneyin', { statusCode: 503, code: 'BUSY' });
}

/**
 * @param {string} hotelId
 * @param {string} leadId
 * @param {object} input `createQuoteSchema` çıktısı
 */
export async function createQuote(hotelId, leadId, input) {
  const priced = await priceQuote(hotelId, input);
  try {
    return await writeWithEvents(async (tx, stage) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, hotelId, deletedAt: null }, select: { id: true, status: true } });
      if (!lead) throw new NotFoundError('Fırsat bulunamadı');
      if (lead.status === 'WON' || lead.status === 'LOST') {
        throw new ConflictError('Kapanmış fırsata teklif hazırlanamaz; yeni fırsat açın.', 'LEAD_CLOSED');
      }
      const code = await uniqueQuoteCode(tx, hotelId);
      const created = await tx.quote.create({
        data: {
          hotelId,
          leadId,
          code,
          roomTypeId: input.roomTypeId,
          boardType: input.boardType,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          adults: input.adults,
          children: input.children,
          validUntil: input.validUntil,
          notes: input.notes ?? null,
          nightsSnapshot: priced.nights,
          total: priced.total,
          currency: priced.currency,
          createdBy: currentActor(),
        },
        select: QUOTE_SELECT,
      });
      const dto = toQuoteDto(created);
      await recordAudit(tx, { hotelId, entity: 'Quote', entityId: created.id, action: 'CREATE', after: quoteSnapshotForAudit(dto) });
      await stage('sales.quote.changed', { hotelId, leadId, quoteId: created.id, change: 'CREATED' });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Taslak düzenlenir; fiyat güncel sistem fiyatıyla yeniden kilitlenir.
 * @param {string} hotelId
 * @param {string} quoteId
 * @param {object} input `updateQuoteSchema` çıktısı
 */
export async function updateQuote(hotelId, quoteId, input) {
  const { expectedUpdatedAt, ...data } = input;
  const priced = await priceQuote(hotelId, data);
  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.quote.findFirst({ where: { id: quoteId, hotelId, deletedAt: null }, select: QUOTE_SELECT });
      if (!before) throw new NotFoundError('Teklif bulunamadı');
      if (before.status !== 'DRAFT') {
        throw new ConflictError('Yalnız taslak teklif düzenlenir; gönderilmiş teklif için yenisini hazırlayın.', 'QUOTE_NOT_DRAFT');
      }
      await updateWithVersionCheck(
        tx,
        'quote',
        { id: quoteId, hotelId },
        expectedUpdatedAt,
        { ...data, notes: data.notes ?? null, nightsSnapshot: priced.nights, total: priced.total, currency: priced.currency },
        'Teklif bulunamadı',
      );
      const after = await tx.quote.findFirst({ where: { id: quoteId }, select: QUOTE_SELECT });
      const dto = toQuoteDto(after);
      await recordAudit(tx, {
        hotelId,
        entity: 'Quote',
        entityId: quoteId,
        action: 'UPDATE',
        before: quoteSnapshotForAudit(toQuoteDto(before)),
        after: quoteSnapshotForAudit(dto),
      });
      await stage('sales.quote.changed', { hotelId, leadId: after.leadId, quoteId, change: 'UPDATED' });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Teklifi gönderildi işaretler ve fırsatı panoda ilerletir. E-posta zinciri
 * bilinçli devirde: geçit (email-gateway) stub — PDF indirilip elle gönderilir,
 * kayıt burada tutulur (bkz. GÖREVLER notu).
 * @param {string} hotelId
 * @param {string} quoteId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function sendQuote(hotelId, quoteId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.quote.findFirst({
        where: { id: quoteId, hotelId, deletedAt: null },
        select: { ...QUOTE_SELECT, lead: { select: { id: true, status: true } } },
      });
      if (!before) throw new NotFoundError('Teklif bulunamadı');
      assertQuoteTransition(before.status, 'SENT');
      await updateWithVersionCheck(
        tx,
        'quote',
        { id: quoteId, hotelId },
        input.expectedUpdatedAt,
        { status: 'SENT', sentAt: new Date() },
        'Teklif bulunamadı',
      );
      if (before.lead.status === 'NEW') {
        await tx.lead.update({ where: { id: before.lead.id }, data: { status: 'QUOTED' } });
        await stage('sales.lead.changed', { hotelId, leadId: before.lead.id, change: 'STATUS_CHANGED' });
      }
      const after = await tx.quote.findFirst({ where: { id: quoteId }, select: QUOTE_SELECT });
      const dto = toQuoteDto(after);
      await recordAudit(tx, {
        hotelId,
        entity: 'Quote',
        entityId: quoteId,
        action: 'UPDATE',
        before: quoteSnapshotForAudit(toQuoteDto(before)),
        after: quoteSnapshotForAudit(dto),
      });
      await stage('sales.quote.changed', { hotelId, leadId: after.leadId, quoteId, change: 'SENT' });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} quoteId
 * @param {{ expectedUpdatedAt: Date, reason?: string | null }} input
 */
export async function rejectQuote(hotelId, quoteId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.quote.findFirst({ where: { id: quoteId, hotelId, deletedAt: null }, select: QUOTE_SELECT });
      if (!before) throw new NotFoundError('Teklif bulunamadı');
      assertQuoteTransition(before.status, 'REJECTED');
      await updateWithVersionCheck(
        tx,
        'quote',
        { id: quoteId, hotelId },
        input.expectedUpdatedAt,
        { status: 'REJECTED', decidedAt: new Date(), rejectReason: input.reason ?? null },
        'Teklif bulunamadı',
      );
      const after = await tx.quote.findFirst({ where: { id: quoteId }, select: QUOTE_SELECT });
      const dto = toQuoteDto(after);
      await recordAudit(tx, {
        hotelId,
        entity: 'Quote',
        entityId: quoteId,
        action: 'UPDATE',
        before: quoteSnapshotForAudit(toQuoteDto(before)),
        after: quoteSnapshotForAudit(dto),
      });
      await stage('sales.quote.changed', { hotelId, leadId: after.leadId, quoteId, change: 'REJECTED' });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Kabul: teklifin kilitli toplamıyla rezervasyon açılır (elle fiyat, gerekçe
 * teklif kodu — fiyat sözü korunur), teklif ACCEPTED, fırsat WON olur.
 *
 * İki adım: (1) rezervasyon kendi transaction'ında (`requestId = quote.id` —
 * idempotent: yarıda kopan kabul tekrarlandığında ikinci rezervasyon açılmaz);
 * (2) teklif + fırsat işaretlemesi. Yer yoksa rezervasyon sebepli reddeder,
 * teklif SENT kalır — personel tarih/tip değişikliğiyle yeni teklif hazırlar.
 *
 * @param {string} hotelId
 * @param {string} quoteId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function acceptQuote(hotelId, quoteId, input) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, hotelId, deletedAt: null },
    select: { ...QUOTE_SELECT, lead: { select: LEAD_SELECT } },
  });
  if (!quote) throw new NotFoundError('Teklif bulunamadı');
  assertQuoteTransition(quote.status, 'ACCEPTED');
  if (quote.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
    throw new ConflictError('Teklif bu arada değişti; sayfayı yenileyip tekrar deneyin.', 'STALE_WRITE');
  }
  const businessDate = await getBusinessDate(hotelId);
  if (toUtcDayStart(quote.validUntil) + DAY_MS <= businessDate.getTime()) {
    throw new ConflictError('Teklifin süresi dolmuş; güncel fiyatla yeni teklif hazırlayın.', 'QUOTE_EXPIRED');
  }

  const lead = quote.lead;
  const guestChoice = lead.guestId
    ? { guestId: lead.guestId, guest: null, forceNewGuest: false }
    : {
        guestId: null,
        // Fırsattan misafir kartı: iletişim fırsattan; aynı ad + iletişim mevcut
        // kartı bulur, farklı ada kayıtlı iletişim yeni kart açar (kabul akışı
        // kesilmesin; kartlar CRM'de birleştirilebilir — M22).
        guest: { ...splitLeadName(lead.name), phone: lead.phone, email: lead.email, nationality: null },
        forceNewGuest: true,
      };

  const result = await createReservation(
    hotelId,
    {
      ...guestChoice,
      roomTypeId: quote.roomTypeId,
      adults: quote.adults,
      children: quote.children,
      boardType: quote.boardType,
      checkIn: new Date(toUtcDayStart(quote.checkIn)),
      checkOut: new Date(toUtcDayStart(quote.checkOut)),
      status: 'CONFIRMED',
      source: 'PHONE',
      notes: null,
      requestId: quote.id,
      waitlistId: null,
      roomId: null,
      manualTotal: money(quote.total),
      priceNote: `Teklif ${quote.code}`,
      couponCode: null,
      packageId: null,
      agencyId: null,
    },
    // Teklif kabulü fiyat sözünün uygulanmasıdır: elle fiyat yetkisi burada
    // teklife (ve sales.manage iznine) dayanır, ayrıca fiyat izni istenmez.
    { canOverridePrice: true, approvalAllowed: false },
  );
  if (result.outcome !== 'CREATED') {
    throw new ConflictError('Rezervasyon açılamadı; teklif gönderilmiş olarak kaldı.', 'QUOTE_ACCEPT_FAILED');
  }

  return writeWithEvents(async (tx, stage) => {
    const current = await tx.quote.findFirst({ where: { id: quoteId, hotelId }, select: QUOTE_SELECT });
    if (!current || current.status !== 'SENT') return toQuoteDto(current ?? quote);

    await tx.quote.update({
      where: { id: quoteId },
      data: { status: 'ACCEPTED', decidedAt: new Date(), reservationId: result.reservation.id },
    });
    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'WON', wonReservationId: result.reservation.id },
    });
    const after = await tx.quote.findFirst({ where: { id: quoteId }, select: QUOTE_SELECT });
    const dto = toQuoteDto(after);
    await recordAudit(tx, {
      hotelId,
      entity: 'Quote',
      entityId: quoteId,
      action: 'UPDATE',
      before: quoteSnapshotForAudit(toQuoteDto(current)),
      after: quoteSnapshotForAudit(dto),
    });
    await stage('sales.quote.changed', { hotelId, leadId: lead.id, quoteId, change: 'ACCEPTED' });
    await stage('sales.lead.changed', { hotelId, leadId: lead.id, change: 'WON' });
    return { ...dto, reservation: { id: result.reservation.id, confirmationCode: result.reservation.confirmationCode } };
  });
}

/** PDF çizimi için tam görüntü (pdf.js tüketir). */
export async function getQuoteSnapshot(hotelId, quoteId) {
  const row = await prisma.quote.findFirst({
    where: { id: quoteId, hotelId, deletedAt: null },
    select: { ...QUOTE_SELECT, lead: { select: { name: true, company: true, phone: true, email: true } } },
  });
  if (!row) throw new NotFoundError('Teklif bulunamadı');
  const hotel = await getHotelSettings(hotelId);
  return { quote: toQuoteDto(row), lead: row.lead, hotel: { name: hotel.name, currency: hotel.currency } };
}

/* ══════════════════ Süre doldurma + takip zili (iş) ══════════════════ */

/**
 * Günlük süpürme (jobs.js çağırır): geçerliliği geçen gönderilmiş teklifler
 * EXPIRED olur (olaylı); açık fırsatların bugünü gelen takipleri için tek
 * birleşik zil çalınır.
 *
 * @param {string} hotelId
 * @param {{ raiseStaffAlert: Function }} deps zil bağımlılığı (test sahteleyebilir)
 * @returns {Promise<{ expired: number, due: number }>}
 */
export async function sweepSales(hotelId, { raiseStaffAlert }) {
  const businessDate = await getBusinessDate(hotelId);
  const today = isoDay(businessDate);

  const stale = await prisma.quote.findMany({
    where: { hotelId, deletedAt: null, status: 'SENT', validUntil: { lt: businessDate } },
    select: { id: true, leadId: true },
  });
  for (const row of stale) {
    await writeWithEvents(async (tx, stage) => {
      const updated = await tx.quote.updateMany({
        where: { id: row.id, status: 'SENT' },
        data: { status: 'EXPIRED', decidedAt: new Date() },
      });
      if (updated.count === 0) return;
      await stage('sales.quote.changed', { hotelId, leadId: row.leadId, quoteId: row.id, change: 'EXPIRED' });
    });
  }

  const due = await prisma.lead.count({
    where: { hotelId, deletedAt: null, status: { in: ['NEW', 'QUOTED', 'WAITING'] }, followUpAt: { lte: businessDate } },
  });
  if (due > 0) {
    await writeWithEvents(async (tx, stage) => {
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'SALES_FOLLOW_UP',
        severity: 'INFO',
        title: `${due} satış fırsatı bugün aranacak`,
        body: 'Takip tarihi gelen fırsatlar sizi bekliyor.',
        link: '/satis?due=1',
        permission: 'sales.manage',
        dedupeKey: `sales-follow:${hotelId}:${today}`,
      });
    });
  }
  return { expired: stale.length, due };
}
