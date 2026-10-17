import { toIsoDay, toMoneyString } from '@hotelos/core';
import { utcToZonedWallTime } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { getActiveTaxes, getHotelSettings } from '../settings/service.js';
import { atomicVenueIds, billablePax, eventRank, eventTotals, itemLine, occupiedRange } from './rules.js';

/**
 * Banket / etkinlik (modül 37) servislerinin ortak parçaları: biçimler, politika,
 * numara serisi, salon ağacı, salon tutma satırları, opsiyon sırası ve toplamların
 * yeniden hesabı.
 */

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
export const day = (value) => (value ? toIsoDay(value) : null);
export const money = (value) => toMoneyString(String(value ?? 0));
export const optionalMoney = (value) => (value === null || value === undefined ? null : money(value));
/** "YYYY-AA-GG" → @db.Date değeri. @param {string} text */
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);

/** Politika satırı yokken geçerli varsayılanlar (migration'daki varsayılanlarla aynı). */
export const DEFAULT_EVENT_SETTINGS = Object.freeze({
  optionDays: 7,
  offerValidityDays: 14,
  depositPct: '30.00',
  requireSignedContract: true,
  cancellationTiers: Object.freeze([]),
  contractTerms: null,
  updatedAt: null,
});

/** Kalan ödemenin etkinlikten kaç gün önce istendiği (önerilen planda). */
export const BALANCE_DAYS_BEFORE = 7;

/** Numara serisi önekleri. */
export const NUMBER_PREFIX = Object.freeze({ EVENT: 'ETK', OFFER: 'TKL', CONTRACT: 'SZL', PROFORMA: 'PRF' });

/**
 * Otelin saat dilimi, para birimi ve iş günü.
 * @param {string} hotelId
 */
export async function hotelContext(hotelId) {
  const [hotel, businessDate] = await Promise.all([getHotelSettings(hotelId), getBusinessDate(hotelId)]);
  return { hotel, timezone: hotel.timezone, currency: hotel.currency, today: toIsoDay(businessDate) };
}

/**
 * Banket politikası (satır yoksa varsayılanlar).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 */
export async function loadEventSettings(client, hotelId) {
  const row = await client.eventSettings.findFirst({ where: { hotelId } });
  if (!row) return { ...DEFAULT_EVENT_SETTINGS, cancellationTiers: [] };
  return {
    optionDays: row.optionDays,
    offerValidityDays: row.offerValidityDays,
    depositPct: money(row.depositPct),
    requireSignedContract: row.requireSignedContract,
    cancellationTiers: tiersOf(row.cancellationTiers),
    contractTerms: row.contractTerms,
    updatedAt: iso(row.updatedAt),
  };
}

/** Kayıtlı kademeler (JSON) → biçimli liste. @param {unknown} value */
export function tiersOf(value) {
  return /** @type {Array<{ daysBefore: unknown, feePct: unknown }>} */ (Array.isArray(value) ? value : []).map((tier) => ({
    daysBefore: Number(tier.daysBefore),
    feePct: String(tier.feePct),
  }));
}

/**
 * Sıradaki numara (otel × tür × yıl): tek ifadede artırılır, kilit gerekmez
 * (aynı anda iki istek iki ayrı numara alır).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {keyof typeof NUMBER_PREFIX} kind
 * @param {number} year
 */
export async function nextNumber(tx, hotelId, kind, year) {
  const [row] = await tx.$queryRaw`
    INSERT INTO "EventSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, ${kind}, ${year}, 1)
    ON CONFLICT ("hotelId", "kind", "year") DO UPDATE SET "last" = "EventSequence"."last" + 1
    RETURNING "last"`;
  return `${NUMBER_PREFIX[kind]}-${year}-${String(row.last).padStart(4, '0')}`;
}

/* ══════════════════ Salon ağacı ══════════════════ */

/**
 * Otelin salonları (kapasiteleriyle). Salon sayısı sınırlıdır (`MAX_VENUES`).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 */
export function loadVenues(client, hotelId) {
  return client.venue.findMany({
    where: { hotelId },
    orderBy: [{ code: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      parentId: true,
      status: true,
      hourlyRate: true,
      halfDayRate: true,
      dayRate: true,
      setupMinutes: true,
      teardownMinutes: true,
      capacities: { select: { layout: true, capacity: true } },
    },
  });
}

/* ══════════════════ Oturum ve salon tutma ══════════════════ */

/**
 * Oturumun dolu aralığı (kurulum / söküm dahil) ve kapladığı atomik salon parçaları.
 * @param {{ venueId: string, startAt: Date, endAt: Date, setupMinutes: number, teardownMinutes: number }} session
 * @param {Array<{ id: string, parentId: string | null }>} venues
 */
export function sessionFootprint(session, venues) {
  return { ...occupiedRange(session), venueIds: atomicVenueIds(session.venueId, venues) };
}

/**
 * Oturumun salon tutma satırlarını yeniden yazar. Salon ve aralık değişmediyse
 * opsiyon sırası (`heldAt`) korunur; değiştiyse yeni an (sıra arkaya düşer).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ hotelId: string, eventId: string, session: any, venues: any[], status: 'TENTATIVE' | 'DEFINITE', now: Date }} input
 */
export async function writeSessionHolds(tx, { hotelId, eventId, session, venues, status, now }) {
  const footprint = sessionFootprint(session, venues);
  const existing = await tx.eventVenueHold.findMany({ where: { sessionId: session.id }, select: { venueId: true, startAt: true, endAt: true, heldAt: true } });
  const unchanged =
    existing.length === footprint.venueIds.length &&
    existing.every(
      (hold) => footprint.venueIds.includes(hold.venueId) && hold.startAt.getTime() === footprint.startAt.getTime() && hold.endAt.getTime() === footprint.endAt.getTime(),
    );
  const heldAt = unchanged && existing.length ? existing[0].heldAt : now;
  await tx.eventVenueHold.deleteMany({ where: { sessionId: session.id } });
  await tx.eventVenueHold.createMany({
    data: footprint.venueIds.map((venueId) => ({ hotelId, eventId, sessionId: session.id, venueId, startAt: footprint.startAt, endAt: footprint.endAt, status, heldAt })),
  });
}

/**
 * Oturumların kapsadığı aralığı etkinliğe yazar (liste / takvim).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} eventId
 */
export async function refreshEventSpan(tx, eventId) {
  const span = await tx.eventSession.aggregate({ where: { eventId }, _min: { startAt: true }, _max: { endAt: true } });
  await tx.event.update({ where: { id: eventId }, data: { firstStartAt: span._min.startAt, lastEndAt: span._max.endAt } });
}

/* ══════════════════ Opsiyon sırası ══════════════════ */

/**
 * Etkinliklerin opsiyon sırası: kendi tutmaları ve onlarla kesişen diğer tutmalar
 * tek sorguda okunur (N+1 yok), sıra saf kuralla hesaplanır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string[]} eventIds
 * @returns {Promise<Map<string, { rank: number, blockedBy: string[] }>>}
 */
export async function loadEventRanks(client, hotelId, eventIds) {
  if (eventIds.length === 0) return new Map();
  const own = await client.eventVenueHold.findMany({
    where: { hotelId, eventId: { in: eventIds } },
    select: { id: true, eventId: true, venueId: true, startAt: true, endAt: true, status: true, heldAt: true },
  });
  if (own.length === 0) return new Map();
  const others = await client.$queryRaw`
    SELECT DISTINCT o."id", o."eventId", o."venueId", o."startAt", o."endAt", o."status"::text AS "status", o."heldAt"
    FROM "EventVenueHold" h
    JOIN "EventVenueHold" o ON o."venueId" = h."venueId" AND o."hotelId" = ${hotelId}
      AND o."startAt" < h."endAt" AND h."startAt" < o."endAt" AND o."eventId" <> h."eventId"
    WHERE h."hotelId" = ${hotelId} AND h."eventId" = ANY(${eventIds}::text[])`;
  const result = new Map();
  for (const eventId of eventIds) {
    const mine = own.filter((hold) => hold.eventId === eventId);
    const rank = eventRank(mine, /** @type {any[]} */ (others));
    if (rank) result.set(eventId, rank);
  }
  return result;
}

/* ══════════════════ Toplamlar ══════════════════ */

/**
 * Kalemlerin tutarlarını (kişi başında faturalanacak kişiyle) ve etkinliğin
 * toplamlarını yeniden yazar. Kalem / kişi / durum değiştiren her işlem aynı
 * transaction'da çağırır (etkinlik kilitliyken).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} eventId
 */
export async function recomputeEventTotals(tx, hotelId, eventId) {
  const [event, items, taxes] = await Promise.all([
    tx.event.findFirst({ where: { id: eventId, hotelId }, select: { status: true, expectedPax: true, guaranteedPax: true, actualPax: true } }),
    tx.eventItem.findMany({
      where: { eventId },
      select: { id: true, perPerson: true, quantity: true, unitPrice: true, discountPct: true, taxCategory: true },
    }),
    getActiveTaxes(hotelId),
  ]);
  const pax = billablePax(event);
  const lines = items.map((item) => ({
    id: item.id,
    ...itemLine({ perPerson: item.perPerson, quantity: String(item.quantity), unitPrice: String(item.unitPrice), discountPct: String(item.discountPct), taxCategory: item.taxCategory }, pax, taxes),
  }));
  if (lines.length > 0) {
    await tx.$executeRaw`
      UPDATE "EventItem" AS i
      SET "billedQuantity" = v."billedQuantity", "netAmount" = v."netAmount", "taxAmount" = v."taxAmount",
          "total" = v."total", "taxLines" = v."taxLines"
      FROM jsonb_to_recordset(${JSON.stringify(lines)}::jsonb)
           AS v("id" text, "billedQuantity" numeric, "netAmount" numeric, "taxAmount" numeric, "total" numeric, "taxLines" jsonb)
      WHERE i."id" = v."id" AND i."eventId" = ${eventId}`;
  }
  const totals = eventTotals(lines);
  await tx.event.update({
    where: { id: eventId },
    data: { billablePax: pax, netTotal: totals.netTotal, taxTotal: totals.taxTotal, grandTotal: totals.grandTotal },
  });
  return { ...totals, billablePax: pax };
}

/**
 * Bakiyeye girmiş ödemelerin toplamını yeniden yazar (etkinlik kilitliyken).
 * Ham SQL: sürüm damgası (`updatedAt`) ilerlemez — tahsilat, aynı anda kalem /
 * program düzenleyen kişinin formunu "kayıt değişti" hatasına düşürmemeli.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} eventId
 */
export async function recomputePaidTotal(tx, eventId) {
  const [row] = await tx.$queryRaw`
    UPDATE "Event" SET "paidTotal" = COALESCE(
      (SELECT SUM(p."amount") FROM "EventPayment" p WHERE p."eventId" = ${eventId} AND p."status" = 'POSTED'), 0)
    WHERE "id" = ${eventId}
    RETURNING "paidTotal"::text AS "paidTotal"`;
  return money(row.paidTotal);
}

/* ══════════════════ Saat ══════════════════ */

/**
 * Oturumun ekran biçimi: gerçek an + otelin duvar saati.
 * @param {{ startAt: Date, endAt: Date }} session
 * @param {string} timezone
 */
export const sessionTimes = (session, timezone) => ({
  startAt: iso(session.startAt),
  endAt: iso(session.endAt),
  startLocal: utcToZonedWallTime(session.startAt, timezone),
  endLocal: utcToZonedWallTime(session.endAt, timezone),
});

/** Ham SQL için an (oturum saat dilimi sonuca karışmasın). */
export { sqlTimestamp };

export { prisma };
