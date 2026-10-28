import { currentActor, toDecimal, toMoneyString } from '@hotelos/core';
import {
  EVENT_DOCUMENT_KIND_LABELS,
  MAX_EVENT_ITEMS,
  MAX_EVENT_LEAD_DAYS,
  MAX_EVENT_SESSIONS,
  VENUE_LAYOUT_LABELS,
  daysBetween,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockEventEquipment, lockEvents, lockVenues } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { containsText } from '../../lib/search.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { eventPaymentTotals } from './payments.js';
import { alertCancelledRequests, alertPaxChange, shiftSessionMenus } from './fnb-hooks.js';
import {
  allocateInstallments,
  atomicVenueIds,
  amountDue,
  billablePax,
  cancellationFee,
  eventRefundLimit,
  holdRank,
  occupiedRange,
  peakUsage,
  shiftDay,
  suggestInstallments,
  suggestVenuePrice,
} from './rules.js';
import {
  BALANCE_DAYS_BEFORE,
  dateOnly,
  day,
  hotelContext,
  iso,
  loadEventRanks,
  loadEventSettings,
  loadVenues,
  money,
  nextNumber,
  optionalMoney,
  prisma,
  recomputeEventTotals,
  refreshEventSpan,
  sessionFootprint,
  sessionTimes,
  tiersOf,
  writeSessionHolds,
} from './shared.js';

/**
 * Etkinlik dosyası servisi (modül 37).
 *
 * ### Durum ve salon
 *
 * | Durum      | Salon tutması            | Not |
 * |------------|--------------------------|-----|
 * | Talep      | yok                      | oturum ve kalem serbestçe düzenlenir |
 * | Opsiyonlu  | opsiyon (sıralı)         | opsiyon tarihi geçince talebe döner (iş) |
 * | Kesin      | kesin (çakışamaz)        | yalnızca **1. opsiyon** kesinleşir; kapasite ve ekipman stoğu denetlenir |
 * | Gerçekleşti| kesin (geçmiş)           | kesin kişiyle toplam son hâlini alır, proforma |
 * | İptal / kayıp | silinir               | iptal bedeli politikadan |
 *
 * ### Kilit düzeni
 *
 * etkinlik → salon → ekipman. Kesine geçiş ve kesin etkinliğin oturum değişikliği
 * ilgili atomik salon parçalarını kilitler: aynı anda iki etkinlik aynı salonda
 * kesinleşemez; sıra ve çakışma kilit altında okunur, son savunma veritabanı
 * kısıtıdır (`EventVenueHold_no_double_definite`). Ekipman stoğu ekipman satırı
 * kilitliyken sayılır.
 */

/** Etkinlik ekranında listelenen en fazla belge sürümü. */
const DETAIL_DOCUMENT_LIMIT = 100;
/** Takvimde bir pencerede gösterilen en fazla tutma (kalabalık otelde bile birkaç bin). */
const CALENDAR_HOLD_LIMIT = 5000;
const MINUTE_MS = 60_000;

const EVENT_LIST_SELECT = Object.freeze({
  id: true,
  code: true,
  name: true,
  type: true,
  status: true,
  ownerEmail: true,
  expectedPax: true,
  guaranteedPax: true,
  actualPax: true,
  billablePax: true,
  optionUntil: true,
  firstStartAt: true,
  lastEndAt: true,
  currency: true,
  grandTotal: true,
  paidTotal: true,
  cancellationFee: true,
  updatedAt: true,
  client: { select: { id: true, name: true, type: true } },
  _count: { select: { sessions: true } },
});

/* ══════════════════ Yardımcılar ══════════════════ */

/**
 * Ekranın kullandığı ortak alanlar.
 * @param {any} row
 * @param {string} timezone
 */
function eventSummary(row, timezone) {
  const due = amountDue({ status: row.status, grandTotal: String(row.grandTotal), cancellationFee: row.cancellationFee === null ? null : String(row.cancellationFee) });
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    status: row.status,
    client: row.client,
    ownerEmail: row.ownerEmail,
    expectedPax: row.expectedPax,
    guaranteedPax: row.guaranteedPax,
    actualPax: row.actualPax,
    billablePax: row.billablePax,
    optionUntil: day(row.optionUntil),
    firstStartAt: iso(row.firstStartAt),
    lastEndAt: iso(row.lastEndAt),
    firstStartLocal: row.firstStartAt ? utcToZonedWallTime(row.firstStartAt, timezone) : null,
    lastEndLocal: row.lastEndAt ? utcToZonedWallTime(row.lastEndAt, timezone) : null,
    currency: row.currency,
    grandTotal: money(row.grandTotal),
    cancellationFee: optionalMoney(row.cancellationFee),
    amountDue: due,
    paidTotal: money(row.paidTotal),
    balance: toMoneyString(toDecimal(due).minus(toDecimal(String(row.paidTotal)))),
    sessionCount: row._count?.sessions ?? undefined,
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Kilitli etkinlik (sürüm kontrolüyle).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} eventId
 * @param {Date | null} expectedUpdatedAt
 */
export async function lockedEvent(tx, hotelId, eventId, expectedUpdatedAt) {
  await lockEvents(tx, hotelId, [eventId]);
  const event = await tx.event.findFirst({
    where: { id: eventId, hotelId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      clientId: true,
      notes: true,
      status: true,
      ownerEmail: true,
      expectedPax: true,
      guaranteedPax: true,
      actualPax: true,
      optionUntil: true,
      firstStartAt: true,
      lastEndAt: true,
      grandTotal: true,
      paidTotal: true,
      cancellationTiers: true,
      currency: true,
      updatedAt: true,
    },
  });
  if (!event) throw new NotFoundError('Etkinlik bulunamadı');
  if (expectedUpdatedAt && event.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
  return event;
}

/** @param {{ status: string }} event @param {string} action */
export function assertEditable(event, action) {
  if (event.status === 'CANCELLED' || event.status === 'LOST') throw new ConflictError(`Kapanmış etkinlikte ${action} yapılamaz`, 'EVENT_CLOSED');
}

/** @param {{ status: string }} event @param {string} action */
export function assertProgramEditable(event, action) {
  assertEditable(event, action);
  if (event.status === 'COMPLETED') throw new ConflictError(`Gerçekleşmiş etkinlikte ${action} yapılamaz`, 'EVENT_COMPLETED');
}

/**
 * Etkinliğin sorumlusuna (bulunamazsa banket yetkilisine) zil uyarısı.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {{ hotelId: string, event: { id: string, code: string, name: string, ownerEmail: string }, title: string, body: string, severity?: string, dedupeKey: string, permission?: string }} input
 */
export async function alertOwner(tx, stage, { hotelId, event, title, body, severity = 'INFO', dedupeKey, permission = PERMISSIONS.BANQUET_MANAGE }) {
  const owner = event.ownerEmail ? await findActiveStaffByEmail(tx, hotelId, event.ownerEmail.toLowerCase()) : null;
  await raiseStaffAlert(tx, stage, {
    hotelId,
    kind: 'BANQUET',
    severity,
    title,
    body,
    link: `/etkinlikler/${event.id}`,
    userId: owner?.id ?? null,
    permission: owner ? null : permission,
    entityType: 'Event',
    entityId: event.id,
    dedupeKey,
  });
}

/**
 * Etkinliğin tutmalarıyla kesişen başka **opsiyonlu** etkinlikler (salon boşalınca
 * sırası yükselebilecekler) ve şu anki sıraları.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} eventId
 */
async function overlappingTentatives(tx, hotelId, eventId) {
  const rows = await tx.$queryRaw`
    SELECT DISTINCT o."eventId"
    FROM "EventVenueHold" h
    JOIN "EventVenueHold" o ON o."venueId" = h."venueId" AND o."hotelId" = ${hotelId}
      AND o."startAt" < h."endAt" AND h."startAt" < o."endAt" AND o."eventId" <> h."eventId" AND o."status" = 'TENTATIVE'
    WHERE h."hotelId" = ${hotelId} AND h."eventId" = ${eventId}`;
  const ids = /** @type {Array<{ eventId: string }>} */ (rows).map((row) => row.eventId);
  return { ids, ranks: await loadEventRanks(tx, hotelId, ids) };
}

/**
 * Salon boşaldıktan sonra sırası 1'e yükselen opsiyonların sorumlularına haber.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {Function} stage
 * @param {string} hotelId
 * @param {{ ids: string[], ranks: Map<string, { rank: number }> }} before
 * @param {string} reason
 */
async function alertPromoted(tx, stage, hotelId, before, reason) {
  if (before.ids.length === 0) return;
  const after = await loadEventRanks(tx, hotelId, before.ids);
  const promoted = before.ids.filter((id) => (before.ranks.get(id)?.rank ?? 1) > 1 && after.get(id)?.rank === 1);
  if (promoted.length === 0) return;
  const events = await tx.event.findMany({ where: { id: { in: promoted }, hotelId, status: 'TENTATIVE' }, select: { id: true, code: true, name: true, ownerEmail: true } });
  for (const event of events) {
    await alertOwner(tx, stage, {
      hotelId,
      event,
      title: `1. opsiyon oldunuz: ${event.name}`,
      body: `${reason} Salon artık sizin; etkinliği kesinleştirebilirsiniz (${event.code}).`,
      // Aynı etkinliğin yeniden yükselmesi aynı uyarıda birleşir (sayaç artar, okunmamışa döner).
      dedupeKey: `banquet-promoted:${event.id}`,
    });
  }
}

/**
 * Salon bu oturumu alıyor mu: salon aktif, düzen tanımlı, kişi kapasiteyi aşmıyor.
 * Oturum kaydında ve (salon tanımı sonradan değişebileceği için) opsiyon /
 * kesinleştirmede yeniden denetlenir.
 *
 * @param {any} venue
 * @param {{ layout: string, pax: number }} session
 * @returns {{ field: 'venueId' | 'layout' | 'pax', message: string, fieldMessage: string } | null}
 */
function sessionFitIssue(venue, { layout, pax }) {
  if (!venue) return { field: 'venueId', message: 'Salon bulunamadı', fieldMessage: 'Salon bulunamadı' };
  if (venue.status !== 'ACTIVE') return { field: 'venueId', message: `${venue.name} pasif; oturum başka salona alınmalı`, fieldMessage: 'Bu salon pasif' };
  const layoutLabel = VENUE_LAYOUT_LABELS[layout].toLocaleLowerCase('tr');
  const capacity = venue.capacities.find((entry) => entry.layout === layout)?.capacity;
  if (!capacity) return { field: 'layout', message: `${venue.name} salonunda ${layoutLabel} düzeni tanımlı değil`, fieldMessage: 'Bu salonda bu düzen tanımlı değil' };
  if (pax > capacity) return { field: 'pax', message: `${venue.name} ${layoutLabel} düzeninde en fazla ${capacity} kişi alır`, fieldMessage: `Kapasite ${capacity} kişi` };
  return null;
}

/**
 * Opsiyon / kesinleştirme öncesi: bütün oturumların salonu hâlâ uygun mu.
 * @param {any[]} sessions
 * @param {any[]} venues
 */
function assertSessionsFit(sessions, venues) {
  const issues = sessions
    .map((session) => ({ session, issue: sessionFitIssue(venues.find((venue) => venue.id === session.venueId), session) }))
    .filter((entry) => entry.issue);
  if (issues.length) {
    throw new ConflictError(`Programda salona uymayan oturum var: ${issues.map(({ session, issue }) => `"${session.title}": ${issue.message}`).join('; ')}.`, 'SESSION_UNFIT');
  }
}

/**
 * Oturumun girdisini doğrular ve gerçek ana çevirir: salon uygun, geçmişte değil,
 * en uzak ileri tarih içinde. Var olan oturumun başlangıcı değişmediyse (ör. dünkü
 * oturumun kişisi düzeltiliyor) geçmiş tarih denetimi yapılmaz.
 *
 * @param {any[]} venues
 * @param {any} input `createSessionSchema`
 * @param {{ timezone: string, today: string }} context
 * @param {Date | null} previousStartAt düzenlenen oturumun kayıtlı başlangıcı
 */
function resolveSessionInput(venues, input, { timezone, today }, previousStartAt) {
  const venue = venues.find((candidate) => candidate.id === input.venueId);
  const issue = sessionFitIssue(venue, input);
  if (issue) throw new ValidationError(issue.message, { fields: { [issue.field]: issue.fieldMessage } });
  const startAt = zonedWallTimeToUtc(input.startAt, timezone);
  const endAt = zonedWallTimeToUtc(input.endAt, timezone);
  if (!startAt || !endAt) throw new ValidationError('Saat geçersiz', { fields: { startAt: 'Saat geçersiz' } });
  const startUnchanged = previousStartAt?.getTime() === startAt.getTime();
  if (!startUnchanged && input.startAt.slice(0, 10) < today) throw new ValidationError('Geçmiş güne oturum açılmaz', { fields: { startAt: 'Geçmiş güne oturum açılmaz' } });
  if (daysBetween(today, input.startAt.slice(0, 10)) > MAX_EVENT_LEAD_DAYS) {
    throw new ValidationError(`Etkinlik en fazla ${MAX_EVENT_LEAD_DAYS} gün sonrası için açılır`, { fields: { startAt: 'Tarih çok ileri' } });
  }
  return {
    title: input.title,
    venueId: venue.id,
    layout: input.layout,
    pax: input.pax,
    startAt,
    endAt,
    setupMinutes: input.setupMinutes ?? venue.setupMinutes,
    teardownMinutes: input.teardownMinutes ?? venue.teardownMinutes,
    notes: input.notes ?? null,
  };
}

/**
 * Oturumların salonlarını (rezerve edilen salon + kapladığı atomik parçalar) kilitler ve
 * salon tanımını **kilitten sonra** yeniden okur: kapasite, pasiflik ya da bütün / parça
 * yapısı kilit beklenirken değişmiş olabilir. Yapı değişip yeni parça çıktıysa o da
 * kilitlenir (çok nadir; olası kilitlenme veritabanınca çözülür, iş yeniden denenir).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {Array<{ venueId: string }>} sessions
 */
async function lockedVenueTree(tx, hotelId, sessions) {
  const lockSet = (venues) => [...new Set(sessions.flatMap((session) => [session.venueId, ...atomicVenueIds(session.venueId, venues)]))];
  const locked = lockSet(await loadVenues(tx, hotelId));
  await lockVenues(tx, hotelId, locked);
  const venues = await loadVenues(tx, hotelId);
  const missing = lockSet(venues).filter((id) => !locked.includes(id));
  if (missing.length) await lockVenues(tx, hotelId, missing);
  return venues;
}

/**
 * Kesin tutma yazmadan önce: yeni ayak izinde başka etkinliğin **hiçbir** etkin
 * tutması olmamalı (kesin çakışamaz; opsiyonun önceliği vardır).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ startAt: Date, endAt: Date, venueIds: string[] }} footprint
 */
async function assertSlotFree(tx, hotelId, eventId, footprint) {
  const clash = await tx.eventVenueHold.findFirst({
    where: { hotelId, eventId: { not: eventId }, venueId: { in: footprint.venueIds }, startAt: { lt: footprint.endAt }, endAt: { gt: footprint.startAt } },
    select: { status: true, event: { select: { code: true, name: true } }, venue: { select: { name: true } } },
    orderBy: [{ heldAt: 'asc' }],
  });
  if (clash) {
    throw new ConflictError(
      `${clash.venue.name} bu saatlerde ${clash.status === 'DEFINITE' ? 'kesin' : 'opsiyonlu'} olarak "${clash.event.name}" (${clash.event.code}) etkinliğinde (kurulum / söküm dahil).`,
      'VENUE_TAKEN',
    );
  }
}

/**
 * Ekipman stoğu: bu etkinliğin ekipman ayrımları, kesin / gerçekleşmiş diğer
 * etkinliklerinkiyle aynı anda stoğu aşamaz. Ekipman satırları kilitlenir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ strict: boolean }} options `strict`: aşımda hata (kesin), değilse uyarı listesi
 * @returns {Promise<Array<{ equipmentId: string, name: string, stock: number, peak: number }>>}
 */
export async function equipmentShortages(tx, hotelId, eventId, { strict }) {
  const mine = await tx.eventItem.findMany({
    where: { eventId, equipmentId: { not: null } },
    select: { equipmentId: true, quantity: true, session: { select: { startAt: true, endAt: true, setupMinutes: true, teardownMinutes: true } } },
  });
  if (mine.length === 0) return [];
  const equipmentIds = [...new Set(mine.map((item) => item.equipmentId))];
  if (strict) await lockEventEquipment(tx, hotelId, equipmentIds);
  const usages = mine.map((item) => ({ equipmentId: item.equipmentId, quantity: Number(item.quantity), ...occupiedRange(item.session) }));
  const windowStart = new Date(Math.min(...usages.map((usage) => usage.startAt.getTime())));
  const windowEnd = new Date(Math.max(...usages.map((usage) => usage.endAt.getTime())));
  const [others, equipment] = await Promise.all([
    tx.eventItem.findMany({
      where: {
        hotelId,
        equipmentId: { in: equipmentIds },
        eventId: { not: eventId },
        event: { status: { in: ['DEFINITE', 'COMPLETED'] } },
        session: { startAt: { lt: new Date(windowEnd.getTime() + 720 * MINUTE_MS) }, endAt: { gt: new Date(windowStart.getTime() - 720 * MINUTE_MS) } },
      },
      select: { equipmentId: true, quantity: true, session: { select: { startAt: true, endAt: true, setupMinutes: true, teardownMinutes: true } } },
    }),
    tx.eventEquipment.findMany({ where: { hotelId, id: { in: equipmentIds } }, select: { id: true, name: true, stockQuantity: true } }),
  ]);
  for (const item of others) usages.push({ equipmentId: item.equipmentId, quantity: Number(item.quantity), ...occupiedRange(item.session) });
  const shortages = [];
  for (const entry of equipment) {
    const peak = peakUsage(usages.filter((usage) => usage.equipmentId === entry.id));
    if (peak > entry.stockQuantity) shortages.push({ equipmentId: entry.id, name: entry.name, stock: entry.stockQuantity, peak });
  }
  if (strict && shortages.length > 0) {
    throw new ConflictError(
      `Ekipman stoğu yetmiyor: ${shortages.map((entry) => `${entry.name} (aynı anda ${entry.peak} adet gerekli, stok ${entry.stock})`).join('; ')}.`,
      'EQUIPMENT_STOCK',
      { shortages },
    );
  }
  return shortages;
}

/* ══════════════════ Okuma ══════════════════ */

/**
 * Etkinlik listesi (sayfalı): durum, tür, müşteri, tarih aralığı (ilk oturum),
 * "benim etkinliklerim", arama (numara, ad, müşteri). Opsiyonlu etkinliklerin sırası
 * tek ek sorguyla.
 *
 * @param {string} hotelId
 * @param {any} query `eventListQuerySchema`
 */
export async function listEvents(hotelId, query) {
  const { timezone, currency } = await hotelContext(hotelId);
  const and = [];
  if (query.status) and.push({ status: query.status });
  if (query.type) and.push({ type: query.type });
  if (query.clientId) and.push({ clientId: query.clientId });
  if (query.mine === 'true') and.push({ ownerEmail: currentActor().toLowerCase() });
  if (query.from) and.push({ lastEndAt: { gte: zonedWallTimeToUtc(`${day(query.from)}T00:00`, timezone) } });
  if (query.to) and.push({ firstStartAt: { lt: zonedWallTimeToUtc(`${day(new Date(query.to.getTime() + 86_400_000))}T00:00`, timezone) } });
  const search = query.search?.trim();
  if (search) {
    const clients = await prisma.eventClient.findMany({ where: { hotelId, name: containsText(search) }, select: { id: true }, take: 500 });
    and.push({ OR: [{ code: { contains: search.toUpperCase() } }, { name: containsText(search) }, ...(clients.length ? [{ clientId: { in: clients.map((row) => row.id) } }] : [])] });
  }
  const where = { hotelId, ...(and.length ? { AND: and } : {}) };
  const [rows, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: [{ firstStartAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      ...toSkipTake(query),
      select: EVENT_LIST_SELECT,
    }),
    prisma.event.count({ where }),
  ]);
  const ranks = await loadEventRanks(
    prisma,
    hotelId,
    rows.filter((row) => row.status === 'TENTATIVE').map((row) => row.id),
  );
  const page = buildPage(
    rows.map((row) => ({ ...eventSummary(row, timezone), optionRank: ranks.get(row.id)?.rank ?? null })),
    total,
    query,
  );
  return { ...page, meta: { ...page.meta, currency, timezone } };
}

/** Özet panelinde "opsiyonu yakında doluyor" sayılan gün. */
const OPTION_WARNING_DAYS = 2;
/** Özet panelinde "yaklaşan" sayılan gün. */
const UPCOMING_DAYS = 7;

/**
 * Vadesi geçmiş taksiti olan etkinlikler: vadesi bugünden önce olan taksitlerin
 * toplamı ödenenden büyükse fark gecikmiştir (ödeme vadesi eskiden yeniye
 * dağıtılır). Tek gruplu sorgu (`EventInstallment(hotelId, dueDate)`).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string} today
 * @param {number} limit
 * @returns {Promise<Array<{ eventId: string, overdue: string, oldestDue: string }>>}
 */
export async function overdueInstallments(client, hotelId, today, limit) {
  const rows = await client.$queryRaw`
    SELECT e."id" AS "eventId", (SUM(i."amount") - e."paidTotal")::text AS "overdue", MIN(i."dueDate")::text AS "oldestDue"
    FROM "EventInstallment" i
    JOIN "Event" e ON e."id" = i."eventId"
    WHERE i."hotelId" = ${hotelId} AND i."dueDate" < ${today}::date AND e."status" IN ('INQUIRY', 'TENTATIVE', 'DEFINITE', 'COMPLETED')
    GROUP BY e."id", e."paidTotal"
    HAVING SUM(i."amount") > e."paidTotal"
    ORDER BY MIN(i."dueDate"), e."id"
    LIMIT ${limit}`;
  return /** @type {any[]} */ (rows).map((row) => ({ eventId: row.eventId, overdue: money(row.overdue), oldestDue: row.oldestDue }));
}

/** Özetteki gecikmiş taksit listesinin üst sınırı (toplam ayrıca sayılır). */
const SUMMARY_OVERDUE_LIMIT = 500;

/**
 * Etkinlik listesinin özet paneli: açık dosyalar (durum bazında), yakında dolan
 * opsiyonlar, önümüzdeki hafta kesin etkinlikler, gecikmiş taksitler, faturaya
 * hazır (proforması üretilmemiş gerçekleşmiş / bedelli iptal) etkinlikler.
 *
 * @param {string} hotelId
 */
export async function getBanquetSummary(hotelId) {
  const { timezone, today, currency } = await hotelContext(hotelId);
  const warnUntil = dateOnly(shiftDay(today, OPTION_WARNING_DAYS));
  const dayStartUtc = (text) => zonedWallTimeToUtc(`${text}T00:00`, timezone);
  const [byStatus, expiring, upcoming, overdue, invoiceReady] = await Promise.all([
    prisma.event.groupBy({ by: ['status'], where: { hotelId, status: { in: ['INQUIRY', 'TENTATIVE', 'DEFINITE'] } }, _count: { _all: true } }),
    prisma.event.count({ where: { hotelId, status: 'TENTATIVE', optionUntil: { lte: warnUntil } } }),
    prisma.event.aggregate({
      where: { hotelId, status: 'DEFINITE', firstStartAt: { gte: dayStartUtc(today), lt: dayStartUtc(shiftDay(today, UPCOMING_DAYS)) } },
      _count: { _all: true },
      _sum: { billablePax: true },
    }),
    overdueInstallments(prisma, hotelId, today, SUMMARY_OVERDUE_LIMIT),
    prisma.event.count({
      where: {
        hotelId,
        OR: [{ status: 'COMPLETED' }, { status: 'CANCELLED', cancellationFee: { gt: 0 } }],
        documents: { none: { kind: 'PROFORMA', status: { not: 'SUPERSEDED' } } },
      },
    }),
  ]);
  const count = (status) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
  return {
    today,
    currency,
    open: { inquiry: count('INQUIRY'), tentative: count('TENTATIVE'), definite: count('DEFINITE') },
    optionsExpiringSoon: expiring,
    optionWarningDays: OPTION_WARNING_DAYS,
    upcoming: { days: UPCOMING_DAYS, events: upcoming._count._all, pax: upcoming._sum.billablePax ?? 0 },
    overdue: {
      events: overdue.length,
      amount: toMoneyString(overdue.reduce((sum, row) => sum.plus(toDecimal(row.overdue)), toDecimal(0))),
      truncated: overdue.length >= SUMMARY_OVERDUE_LIMIT,
    },
    invoiceReady,
  };
}

/**
 * Etkinlik ekranı: dosya, müşteri, oturumlar (yerel saat, salon, kapasite), kalemler,
 * ödeme planı (dağıtılmış), ödemeler, belgeler, opsiyon sırası ve önündekiler,
 * ekipman stok uyarısı, iptal bedeli önizlemesi.
 *
 * @param {string} hotelId
 * @param {string} eventId
 */
export async function getEvent(hotelId, eventId) {
  const { timezone, today } = await hotelContext(hotelId);
  const row = await prisma.event.findFirst({
    where: { id: eventId, hotelId },
    select: {
      ...EVENT_LIST_SELECT,
      netTotal: true,
      taxTotal: true,
      notes: true,
      optionedAt: true,
      cancellationTiers: true,
      definiteAt: true,
      definiteBy: true,
      completedAt: true,
      completedBy: true,
      cancelledAt: true,
      cancelledBy: true,
      cancelReason: true,
      lostAt: true,
      lostBy: true,
      lostReason: true,
      createdBy: true,
      createdAt: true,
      client: {
        select: { id: true, type: true, name: true, contactName: true, phone: true, email: true, taxOffice: true, taxNumber: true, address: true },
      },
      sessions: {
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          venueId: true,
          layout: true,
          pax: true,
          startAt: true,
          endAt: true,
          setupMinutes: true,
          teardownMinutes: true,
          notes: true,
          venue: { select: { code: true, name: true, parentId: true } },
        },
      },
      items: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          sessionId: true,
          equipmentId: true,
          category: true,
          description: true,
          perPerson: true,
          quantity: true,
          billedQuantity: true,
          unit: true,
          unitPrice: true,
          discountPct: true,
          taxCategory: true,
          netAmount: true,
          taxAmount: true,
          total: true,
          taxLines: true,
          eventMenuId: true,
          equipment: { select: { code: true, name: true, isActive: true } },
        },
      },
      installments: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }], select: { id: true, label: true, dueDate: true, amount: true } },
      documents: {
        orderBy: [{ createdAt: 'desc' }],
        take: DETAIL_DOCUMENT_LIMIT,
        select: { id: true, kind: true, number: true, version: true, status: true, grandTotal: true, validUntil: true, decisionDate: true, decidedBy: true, note: true, issuedBy: true, createdAt: true },
      },
    },
  });
  if (!row) throw new NotFoundError('Etkinlik bulunamadı');

  const [ranks, shortages, settings, paymentState] = await Promise.all([
    loadEventRanks(prisma, hotelId, [eventId]),
    ['TENTATIVE', 'INQUIRY', 'DEFINITE'].includes(row.status) ? equipmentShortages(prisma, hotelId, eventId, { strict: false }) : Promise.resolve([]),
    loadEventSettings(prisma, hotelId),
    eventPaymentTotals(prisma, eventId),
  ]);
  const rank = ranks.get(eventId) ?? null;
  const blockingEvents = rank?.blockedBy.length
    ? await prisma.event.findMany({ where: { id: { in: rank.blockedBy }, hotelId }, select: { id: true, code: true, name: true, status: true } })
    : [];

  const summary = eventSummary(row, timezone);
  const tiers = row.cancellationTiers ? tiersOf(row.cancellationTiers) : settings.cancellationTiers;
  const firstDay = row.firstStartAt ? sessionDay(row.firstStartAt, timezone) : null;
  const feePreview = row.status === 'DEFINITE' && firstDay ? cancellationFee({ grandTotal: String(row.grandTotal), tiers, daysBefore: daysBetween(today, firstDay) }) : null;
  const currentContract = row.documents.find((document) => document.kind === 'CONTRACT' && document.status !== 'SUPERSEDED') ?? null;

  return {
    ...summary,
    client: row.client,
    netTotal: money(row.netTotal),
    taxTotal: money(row.taxTotal),
    notes: row.notes,
    optionedAt: iso(row.optionedAt),
    optionRank: rank?.rank ?? null,
    blockingEvents,
    cancellationTiers: tiers,
    cancellationTiersSnapshot: Boolean(row.cancellationTiers),
    cancellationPreview: feePreview,
    requireSignedContract: settings.requireSignedContract,
    contractSigned: currentContract?.status === 'SIGNED',
    // Borç kesinleşti (gerçekleşti ya da bedelli iptal): proforma üretilir, resmî fatura fatura modülünde.
    invoiceReady: row.status === 'COMPLETED' || (row.status === 'CANCELLED' && toDecimal(String(row.cancellationFee ?? 0)).greaterThan(0)),
    proformaIssued: row.documents.some((document) => document.kind === 'PROFORMA' && document.status !== 'SUPERSEDED'),
    equipmentShortages: shortages,
    trail: {
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
      definiteAt: iso(row.definiteAt),
      definiteBy: row.definiteBy,
      completedAt: iso(row.completedAt),
      completedBy: row.completedBy,
      cancelledAt: iso(row.cancelledAt),
      cancelledBy: row.cancelledBy,
      cancelReason: row.cancelReason,
      lostAt: iso(row.lostAt),
      lostBy: row.lostBy,
      lostReason: row.lostReason,
    },
    sessions: row.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      venueId: session.venueId,
      venue: session.venue,
      layout: session.layout,
      pax: session.pax,
      ...sessionTimes(session, timezone),
      setupMinutes: session.setupMinutes,
      teardownMinutes: session.teardownMinutes,
      notes: session.notes,
    })),
    items: row.items.map((item) => ({
      id: item.id,
      sessionId: item.sessionId,
      equipmentId: item.equipmentId,
      equipment: item.equipment,
      category: item.category,
      description: item.description,
      perPerson: item.perPerson,
      quantity: toDecimal(String(item.quantity)).toString(),
      billedQuantity: toDecimal(String(item.billedQuantity)).toString(),
      unit: item.unit,
      unitPrice: money(item.unitPrice),
      discountPct: toDecimal(String(item.discountPct)).toString(),
      taxCategory: item.taxCategory,
      netAmount: money(item.netAmount),
      taxAmount: money(item.taxAmount),
      total: money(item.total),
      taxLines: item.taxLines,
      // Menüden gelen kalem (modül 43): kalem tablosunda salt okunur, menü sekmesinde düzenlenir.
      eventMenuId: item.eventMenuId,
    })),
    installments: allocateInstallments(
      row.installments.map((entry) => ({ id: entry.id, label: entry.label, dueDate: day(entry.dueDate), amount: money(entry.amount) })),
      String(row.paidTotal),
      today,
    ),
    paymentSummary: { ...paymentState, refundable: eventRefundLimit({ status: row.status, amountDue: summary.amountDue, state: paymentState }) },
    documents: row.documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      kindLabel: EVENT_DOCUMENT_KIND_LABELS[document.kind],
      number: document.number,
      version: document.version,
      status: document.status,
      grandTotal: money(document.grandTotal),
      validUntil: day(document.validUntil),
      decisionDate: day(document.decisionDate),
      decidedBy: document.decidedBy,
      note: document.note,
      issuedBy: document.issuedBy,
      createdAt: iso(document.createdAt),
    })),
    today,
    timezone,
  };
}

/**
 * Salon takvimi: salonlar (bütünler ve parçaları) ve pencereye düşen tutmalar
 * (etkinlik, durum, opsiyon sırası, yerel saat). Pencere en fazla 31 gün.
 *
 * @param {string} hotelId
 * @param {{ from: Date, to: Date }} query
 */
export async function getCalendar(hotelId, query) {
  const { timezone, today } = await hotelContext(hotelId);
  const from = zonedWallTimeToUtc(`${day(query.from)}T00:00`, timezone);
  const until = zonedWallTimeToUtc(`${day(new Date(query.to.getTime() + 86_400_000))}T00:00`, timezone);
  const [venues, holds] = await Promise.all([
    loadVenues(prisma, hotelId),
    prisma.eventVenueHold.findMany({
      where: { hotelId, startAt: { lt: until }, endAt: { gt: from } },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      take: CALENDAR_HOLD_LIMIT,
      select: {
        id: true,
        eventId: true,
        sessionId: true,
        venueId: true,
        startAt: true,
        endAt: true,
        status: true,
        heldAt: true,
        session: { select: { title: true, startAt: true, endAt: true, venueId: true, pax: true, layout: true } },
        event: { select: { code: true, name: true, status: true, type: true, client: { select: { name: true } } } },
      },
    }),
  ]);
  return {
    from: day(query.from),
    to: day(query.to),
    today,
    timezone,
    truncated: holds.length >= CALENDAR_HOLD_LIMIT,
    venues: venues.map((venue) => ({
      id: venue.id,
      code: venue.code,
      name: venue.name,
      parentId: venue.parentId,
      status: venue.status,
      capacities: venue.capacities,
    })),
    holds: holds.map((hold) => ({
      id: hold.id,
      eventId: hold.eventId,
      sessionId: hold.sessionId,
      venueId: hold.venueId,
      bookedVenueId: hold.session.venueId,
      status: hold.status,
      rank: holdRank(hold, holds),
      occupiedFrom: iso(hold.startAt),
      occupiedUntil: iso(hold.endAt),
      ...sessionTimes(hold.session, timezone),
      title: hold.session.title,
      pax: hold.session.pax,
      layout: hold.session.layout,
      event: { code: hold.event.code, name: hold.event.name, status: hold.event.status, type: hold.event.type, clientName: hold.event.client.name },
    })),
  };
}

/**
 * Oturum formunun önizlemesi: bu salon bu saatte (kurulum / söküm dahil) kimde,
 * bu oturum hangi sırada olurdu, salonun kapasiteleri ve önerilen kira.
 *
 * @param {string} hotelId
 * @param {any} query `venueAvailabilityQuerySchema`
 */
export async function venueAvailability(hotelId, query) {
  const { timezone } = await hotelContext(hotelId);
  const venues = await loadVenues(prisma, hotelId);
  const venue = venues.find((candidate) => candidate.id === query.venueId);
  if (!venue) throw new NotFoundError('Salon bulunamadı');
  const startAt = zonedWallTimeToUtc(query.startAt, timezone);
  const endAt = zonedWallTimeToUtc(query.endAt, timezone);
  const footprint = sessionFootprint(
    { venueId: venue.id, startAt, endAt, setupMinutes: query.setupMinutes ?? venue.setupMinutes, teardownMinutes: query.teardownMinutes ?? venue.teardownMinutes },
    venues,
  );
  const clashes = await prisma.eventVenueHold.findMany({
    where: {
      hotelId,
      venueId: { in: footprint.venueIds },
      startAt: { lt: footprint.endAt },
      endAt: { gt: footprint.startAt },
      ...(query.excludeSessionId ? { sessionId: { not: query.excludeSessionId } } : {}),
      ...(query.eventId ? { eventId: { not: query.eventId } } : {}),
    },
    orderBy: [{ heldAt: 'asc' }],
    take: 50,
    select: { eventId: true, status: true, heldAt: true, venue: { select: { name: true } }, event: { select: { code: true, name: true } }, session: { select: { startAt: true, endAt: true } } },
  });
  const byEvent = new Map();
  for (const clash of clashes) {
    if (!byEvent.has(clash.eventId)) {
      byEvent.set(clash.eventId, { eventId: clash.eventId, code: clash.event.code, name: clash.event.name, status: clash.status, venueName: clash.venue.name, ...sessionTimes(clash.session, timezone) });
    }
  }
  const conflicts = [...byEvent.values()];
  const minutes = Math.round((endAt.getTime() - startAt.getTime()) / MINUTE_MS);
  return {
    venue: { id: venue.id, name: venue.name, capacities: venue.capacities, setupMinutes: venue.setupMinutes, teardownMinutes: venue.teardownMinutes },
    occupiedFrom: iso(footprint.startAt),
    occupiedUntil: iso(footprint.endAt),
    occupiedFromLocal: utcToZonedWallTime(footprint.startAt, timezone),
    occupiedUntilLocal: utcToZonedWallTime(footprint.endAt, timezone),
    definiteTaken: conflicts.some((entry) => entry.status === 'DEFINITE'),
    wouldBeRank: conflicts.length + 1,
    conflicts,
    priceSuggestion: suggestVenuePrice(
      { hourlyRate: optionalMoney(venue.hourlyRate), halfDayRate: optionalMoney(venue.halfDayRate), dayRate: optionalMoney(venue.dayRate) },
      minutes,
    ),
  };
}

/* ══════════════════ Dosya ══════════════════ */

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} clientId
 */
async function assertClient(tx, hotelId, clientId) {
  const client = await tx.eventClient.findFirst({ where: { id: clientId, hotelId }, select: { id: true } });
  if (!client) throw new ValidationError('Müşteri bulunamadı', { fields: { clientId: 'Müşteri bulunamadı' } });
}

/** @param {any} event */
const eventSnapshot = (event) => ({
  name: event.name,
  type: event.type,
  clientId: event.clientId,
  ownerEmail: event.ownerEmail,
  expectedPax: event.expectedPax,
  guaranteedPax: event.guaranteedPax ?? null,
  notes: event.notes ?? null,
  status: event.status,
});

/**
 * Yeni etkinlik dosyası (talep). Sorumlu verilmezse açan kişi.
 * @param {string} hotelId
 * @param {any} input `createEventSchema`
 */
export async function createEvent(hotelId, input) {
  const actor = currentActor();
  const { currency, today } = await hotelContext(hotelId);
  let eventId;
  try {
    eventId = await writeWithEvents(async (tx, stage) => {
      await assertClient(tx, hotelId, input.clientId);
      const code = await nextNumber(tx, hotelId, 'EVENT', Number(today.slice(0, 4)));
      const data = {
        hotelId,
        code,
        name: input.name,
        type: input.type,
        clientId: input.clientId,
        ownerEmail: (input.ownerEmail ?? actor).toLowerCase(),
        expectedPax: input.expectedPax,
        guaranteedPax: input.guaranteedPax ?? null,
        billablePax: input.guaranteedPax ?? input.expectedPax,
        notes: input.notes ?? null,
        currency,
        createdBy: actor,
      };
      const row = await tx.event.create({ data, select: { id: true } });
      await recordAudit(tx, { hotelId, entity: 'Event', entityId: row.id, action: 'CREATE', after: { code, ...eventSnapshot({ ...data, status: 'INQUIRY' }) } });
      await stage('banquet.event.changed', { hotelId, eventId: row.id, change: 'CREATED' });
      return row.id;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getEvent(hotelId, eventId);
}

/**
 * Dosya başlığı: ad, tür, müşteri, sorumlu, kişi sayıları, not. Kişi değişince
 * kişi başı kalemler yeniden fiyatlanır.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {any} input `updateEventSchema`
 */
export async function updateEvent(hotelId, eventId, input) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const full = await lockedEvent(tx, hotelId, eventId, input.expectedUpdatedAt);
      assertEditable(full, 'değişiklik');
      await assertClient(tx, hotelId, input.clientId);
      const data = {
        name: input.name,
        type: input.type,
        clientId: input.clientId,
        ownerEmail: (input.ownerEmail ?? full.ownerEmail).toLowerCase(),
        expectedPax: input.expectedPax,
        guaranteedPax: input.guaranteedPax ?? null,
        notes: input.notes ?? null,
      };
      await tx.event.update({ where: { id: eventId }, data });
      const totals = await recomputeEventTotals(tx, hotelId, eventId);
      await alertPaxChange(tx, stage, { hotelId, event: full, beforePax: billablePax(full), afterPax: totals.billablePax });
      await recordAudit(tx, { hotelId, entity: 'Event', entityId: eventId, action: 'UPDATE', before: eventSnapshot(full), after: eventSnapshot({ ...full, ...data }) });
      await stage('banquet.event.changed', { hotelId, eventId, change: 'UPDATED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getEvent(hotelId, eventId);
}

/* ══════════════════ Oturum ══════════════════ */

/**
 * Oturum ekler / değiştirir. Opsiyonlu etkinlikte tutma opsiyon olarak yazılır
 * (salon ya da saat değişirse sıra arkaya düşer); kesin etkinlikte salon kilitlenir,
 * yeni ayak izinde başka etkinliğin hiçbir tutması olmamalı ve ekipman stoğu
 * yeniden denetlenir.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {string | null} sessionId `null`: yeni oturum
 * @param {any} input `createSessionSchema`
 */
export async function saveSession(hotelId, eventId, sessionId, input) {
  const context = await hotelContext(hotelId);
  try {
    await writeWithEvents(async (tx, stage) => {
      const event = await lockedEvent(tx, hotelId, eventId, input.expectedUpdatedAt);
      assertProgramEditable(event, 'program değişikliği');
      let before = null;
      if (sessionId) {
        before = await tx.eventSession.findFirst({ where: { id: sessionId, eventId } });
        if (!before) throw new NotFoundError('Oturum bulunamadı');
      } else if ((await tx.eventSession.count({ where: { eventId } })) >= MAX_EVENT_SESSIONS) {
        throw new ConflictError(`Bir etkinlikte en fazla ${MAX_EVENT_SESSIONS} oturum olur`, 'LIMIT');
      }
      // Kesin etkinlikte salon kilitli ve kilitten sonra okunmuş tanımla (kapasite / pasiflik yarışı yok).
      const venues = event.status === 'DEFINITE' ? await lockedVenueTree(tx, hotelId, [{ venueId: input.venueId }]) : await loadVenues(tx, hotelId);
      const data = resolveSessionInput(venues, input, context, before?.startAt ?? null);
      const promotions = event.status === 'TENTATIVE' || event.status === 'DEFINITE' ? await overlappingTentatives(tx, hotelId, eventId) : null;
      if (event.status === 'DEFINITE') await assertSlotFree(tx, hotelId, eventId, sessionFootprint(data, venues));
      const session = sessionId
        ? await tx.eventSession.update({ where: { id: sessionId }, data })
        : await tx.eventSession.create({ data: { hotelId, eventId, ...data } });
      if (event.status === 'TENTATIVE' || event.status === 'DEFINITE') {
        await writeSessionHolds(tx, { hotelId, eventId, session, venues, status: event.status, now: new Date() });
      }
      if (before) await shiftSessionMenus(tx, stage, { hotelId, event, before, after: session, timezone: context.timezone });
      await refreshEventSpan(tx, eventId);
      if (event.status === 'DEFINITE') await equipmentShortages(tx, hotelId, eventId, { strict: true });
      if (event.status === 'TENTATIVE' && event.optionUntil) {
        const first = await tx.event.findFirst({ where: { id: eventId }, select: { firstStartAt: true } });
        // Opsiyon, etkinliğin ilk gününden sonraya taşamaz: ilk oturum öne alındıysa opsiyon da çekilir.
        const firstDay = sessionDay(first.firstStartAt, context.timezone);
        if (day(event.optionUntil) > firstDay) await tx.event.update({ where: { id: eventId }, data: { optionUntil: dateOnly(firstDay) } });
      }
      await recordAudit(tx, {
        hotelId,
        entity: 'EventSession',
        entityId: session.id,
        action: before ? 'UPDATE' : 'CREATE',
        before: before ? sessionSnapshot(before) : null,
        after: sessionSnapshot(session),
      });
      if (promotions) await alertPromoted(tx, stage, hotelId, promotions, `"${event.name}" etkinliğinin programı değişti.`);
      await stage('banquet.event.changed', { hotelId, eventId, change: 'SESSIONS' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getEvent(hotelId, eventId);
}

/** Anın otel saatindeki günü ("YYYY-AA-GG"). @param {Date} at @param {string} timezone */
const sessionDay = (at, timezone) => utcToZonedWallTime(at, timezone).slice(0, 10);

/** @param {any} session */
const sessionSnapshot = (session) => ({
  title: session.title,
  venueId: session.venueId,
  layout: session.layout,
  pax: session.pax,
  startAt: iso(session.startAt),
  endAt: iso(session.endAt),
  setupMinutes: session.setupMinutes,
  teardownMinutes: session.teardownMinutes,
});

/**
 * Oturumu siler (tutmaları onunla gider). Kaleme bağlı oturum silinmez: önce kalem
 * başka oturuma bağlanır ya da kaldırılır. Kesin etkinliğin son oturumu silinmez.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {string} sessionId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function deleteSession(hotelId, eventId, sessionId, { expectedUpdatedAt }) {
  await writeWithEvents(async (tx, stage) => {
    const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
    assertProgramEditable(event, 'program değişikliği');
    const session = await tx.eventSession.findFirst({ where: { id: sessionId, eventId } });
    if (!session) throw new NotFoundError('Oturum bulunamadı');
    const menus = await tx.eventMenu.count({ where: { sessionId } });
    if (menus > 0) throw new ConflictError(`Bu oturumda ${menus} menü var; önce menüyü kaldırın ya da başka oturuma taşıyın (Menü sekmesi).`, 'SESSION_IN_USE');
    const linked = await tx.eventItem.count({ where: { sessionId } });
    if (linked > 0) throw new ConflictError(`Bu oturuma bağlı ${linked} kalem var; önce kalemleri başka oturuma bağlayın ya da kaldırın.`, 'SESSION_IN_USE');
    const remaining = await tx.eventSession.count({ where: { eventId } });
    if (remaining <= 1 && event.status !== 'INQUIRY') throw new ConflictError('Opsiyonlu / kesin etkinliğin son oturumu silinmez', 'LAST_SESSION');
    const promotions = await overlappingTentatives(tx, hotelId, eventId);
    await tx.eventSession.delete({ where: { id: sessionId } });
    await refreshEventSpan(tx, eventId);
    await recordAudit(tx, { hotelId, entity: 'EventSession', entityId: sessionId, action: 'DELETE', before: sessionSnapshot(session) });
    await alertPromoted(tx, stage, hotelId, promotions, `"${event.name}" etkinliğinin bir oturumu kaldırıldı.`);
    await stage('banquet.event.changed', { hotelId, eventId, change: 'SESSIONS' });
  });
  return getEvent(hotelId, eventId);
}

/* ══════════════════ Kalemler ══════════════════ */

/**
 * Kalem tablosunun tamamını kaydeder (ekran bütün olarak gönderir). Tutarlar vergi
 * motoruyla yeniden hesaplanır; kesin etkinlikte ekipman stoğu denetlenir.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ expectedUpdatedAt: Date, items: any[] }} input `saveEventItemsSchema`
 */
export async function saveItems(hotelId, eventId, { expectedUpdatedAt, items }) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
      assertEditable(event, 'kalem değişikliği');
      // Menüden gelen kalemler (modül 43) tabloda yok: menü sekmesi yönetir; sınır ikisinin toplamına.
      const menuItems = await tx.eventItem.count({ where: { eventId, eventMenuId: { not: null } } });
      if (items.length + menuItems > MAX_EVENT_ITEMS) throw new ValidationError(`En fazla ${MAX_EVENT_ITEMS} kalem (menülerden gelen ${menuItems} kalem dahil)`);
      const sessionIds = new Set((await tx.eventSession.findMany({ where: { eventId }, select: { id: true } })).map((row) => row.id));
      const equipmentIds = [...new Set(items.map((item) => item.equipmentId).filter(Boolean))];
      const equipment = equipmentIds.length ? await tx.eventEquipment.findMany({ where: { hotelId, id: { in: equipmentIds } }, select: { id: true, isActive: true } }) : [];
      const previousEquipment = new Set((await tx.eventItem.findMany({ where: { eventId, equipmentId: { not: null } }, select: { equipmentId: true } })).map((row) => row.equipmentId));
      const fields = {};
      items.forEach((item, index) => {
        if (item.sessionId && !sessionIds.has(item.sessionId)) fields[`items.${index}.sessionId`] = 'Oturum bu etkinliğin değil';
        const entry = item.equipmentId ? equipment.find((candidate) => candidate.id === item.equipmentId) : null;
        if (item.equipmentId && !entry) fields[`items.${index}.equipmentId`] = 'Ekipman bulunamadı';
        // Pasif ekipman yeni kaleme seçilmez; kayıtlı kalemde kalabilir.
        if (entry && !entry.isActive && !previousEquipment.has(entry.id)) fields[`items.${index}.equipmentId`] = 'Ekipman pasif';
      });
      if (Object.keys(fields).length) throw new ValidationError('Kalemlerde düzeltilmesi gereken alanlar var', { fields });

      const before = await tx.event.findFirst({ where: { id: eventId }, select: { grandTotal: true, _count: { select: { items: true } } } });
      await tx.eventItem.deleteMany({ where: { eventId, eventMenuId: null } });
      if (items.length) {
        await tx.eventItem.createMany({
          data: items.map((item, index) => ({
            hotelId,
            eventId,
            sessionId: item.sessionId ?? null,
            equipmentId: item.equipmentId ?? null,
            category: item.category,
            description: item.description,
            perPerson: item.perPerson,
            quantity: item.quantity,
            billedQuantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            discountPct: item.discountPct,
            taxCategory: item.taxCategory,
            netAmount: '0',
            taxAmount: '0',
            total: '0',
            sortOrder: index,
          })),
        });
      }
      const totals = await recomputeEventTotals(tx, hotelId, eventId);
      if (event.status === 'DEFINITE') await equipmentShortages(tx, hotelId, eventId, { strict: true });
      await recordAudit(tx, {
        hotelId,
        entity: 'EventItem',
        entityId: eventId,
        action: 'UPDATE',
        before: { items: before._count.items, grandTotal: money(before.grandTotal) },
        after: { items: items.length, grandTotal: totals.grandTotal, lines: items.slice(0, 40).map((item) => `${item.description} × ${item.perPerson ? 'kişi' : item.quantity} @ ${item.unitPrice}`) },
      });
      await stage('banquet.event.changed', { hotelId, eventId, change: 'ITEMS' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getEvent(hotelId, eventId);
}

/* ══════════════════ Ödeme planı ══════════════════ */

/**
 * Ödeme planını kaydeder (tümünü değiştirir). Plan toplamı etkinliğin borcundan
 * farklı olabilir (ekranda uyarı): kişi / kalem sonradan değişir.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ expectedUpdatedAt: Date, installments: Array<{ label: string, dueDate: Date, amount: string }> }} input
 */
export async function saveInstallments(hotelId, eventId, { expectedUpdatedAt, installments }) {
  await writeWithEvents(async (tx, stage) => {
    const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
    assertEditable(event, 'ödeme planı değişikliği');
    const before = await tx.eventInstallment.findMany({ where: { eventId }, orderBy: { dueDate: 'asc' }, select: { label: true, dueDate: true, amount: true } });
    await tx.eventInstallment.deleteMany({ where: { eventId } });
    if (installments.length) {
      await tx.eventInstallment.createMany({
        data: installments.map((entry, index) => ({ hotelId, eventId, label: entry.label, dueDate: entry.dueDate, amount: entry.amount, sortOrder: index })),
      });
    }
    // Sürüm damgası ilerlesin (açık formlar eski planla kaydedemesin).
    await tx.event.update({ where: { id: eventId }, data: { updatedAt: new Date() } });
    const text = (rows) => rows.map((row) => `${row.label} ${day(row.dueDate)} ${money(row.amount)}`);
    await recordAudit(tx, { hotelId, entity: 'EventInstallment', entityId: eventId, action: 'UPDATE', before: { plan: text(before) }, after: { plan: text(installments) } });
    await stage('banquet.event.changed', { hotelId, eventId, change: 'INSTALLMENTS' });
  });
  return getEvent(hotelId, eventId);
}

/**
 * Önerilen ödeme planı (kaydetmez): imzada politikadaki depozito, kalan etkinlikten bir hafta önce.
 * @param {string} hotelId
 * @param {string} eventId
 */
export async function suggestPlan(hotelId, eventId) {
  const { timezone, today } = await hotelContext(hotelId);
  const [event, settings] = await Promise.all([
    prisma.event.findFirst({ where: { id: eventId, hotelId }, select: { status: true, grandTotal: true, cancellationFee: true, firstStartAt: true, lastEndAt: true } }),
    loadEventSettings(prisma, hotelId),
  ]);
  if (!event) throw new NotFoundError('Etkinlik bulunamadı');
  if (!event.firstStartAt) throw new ConflictError('Önce programa oturum ekleyin', 'NO_SESSIONS');
  return {
    installments: suggestInstallments({
      grandTotal: amountDue({ status: event.status, grandTotal: String(event.grandTotal), cancellationFee: event.cancellationFee === null ? null : String(event.cancellationFee) }),
      depositPct: settings.depositPct,
      today,
      eventDay: sessionDay(event.firstStartAt, timezone),
      balanceDaysBefore: BALANCE_DAYS_BEFORE,
    }),
  };
}

/* ══════════════════ Durum ══════════════════ */

/**
 * Opsiyona alır (talepten) ya da opsiyon tarihini değiştirir. Opsiyon tarihi bugün
 * ile ilk oturum günü arasında olmalı.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ expectedUpdatedAt: Date, optionUntil: Date }} input
 */
export async function setTentative(hotelId, eventId, { expectedUpdatedAt, optionUntil }) {
  const { timezone, today } = await hotelContext(hotelId);
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
    if (event.status !== 'INQUIRY' && event.status !== 'TENTATIVE') throw new ConflictError('Yalnızca talep ya da opsiyonlu etkinlik opsiyonlanır', 'EVENT_STATUS');
    const sessions = await tx.eventSession.findMany({ where: { eventId } });
    if (sessions.length === 0) throw new ConflictError('Opsiyon için önce programa oturum ekleyin (salon ve saat)', 'NO_SESSIONS');
    const until = day(optionUntil);
    const firstDay = sessionDay(event.firstStartAt, timezone);
    if (until < today) throw new ValidationError('Opsiyon tarihi geçmiş olamaz', { fields: { optionUntil: 'Geçmiş tarih' } });
    if (until > firstDay) throw new ValidationError(`Opsiyon en geç ilk oturum günü (${firstDay}) olabilir`, { fields: { optionUntil: 'İlk oturum gününden sonra olamaz' } });
    const extending = event.status === 'TENTATIVE';
    if (!extending) {
      const venues = await loadVenues(tx, hotelId);
      assertSessionsFit(sessions, venues);
      const now = new Date();
      for (const session of sessions) await writeSessionHolds(tx, { hotelId, eventId, session, venues, status: 'TENTATIVE', now });
    }
    await tx.event.update({ where: { id: eventId }, data: { status: 'TENTATIVE', optionUntil: dateOnly(until), ...(extending ? {} : { optionedAt: new Date() }) } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Event',
      entityId: eventId,
      action: 'UPDATE',
      before: { status: event.status, optionUntil: day(event.optionUntil) },
      after: { status: 'TENTATIVE', optionUntil: until, by: actor },
    });
    await stage('banquet.event.changed', { hotelId, eventId, change: extending ? 'OPTION_EXTENDED' : 'TENTATIVE' });
  });
  return getEvent(hotelId, eventId);
}

/**
 * Salonu bırakır: opsiyonlu etkinlik talebe döner (tutmaları silinir); sırası
 * yükselen opsiyonların sorumlularına haber gider.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ expectedUpdatedAt: Date | null, reason: string }} input
 * @param {{ expiredBefore?: string | null }} [options] zamanlanmış iş: opsiyonun son günü bu
 *   günden önceyse düşer. Kilit altında yeniden bakılır: iş listeyi okuduktan sonra opsiyon
 *   uzatılmış ya da etkinlik kesinleşmiş olabilir.
 */
export async function releaseOption(hotelId, eventId, { expectedUpdatedAt, reason }, { expiredBefore = null } = {}) {
  const expired = Boolean(expiredBefore);
  const result = await writeWithEvents(async (tx, stage) => {
    const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
    if (expired && (event.status !== 'TENTATIVE' || !event.optionUntil || day(event.optionUntil) >= expiredBefore)) return { skipped: true };
    if (event.status !== 'TENTATIVE') throw new ConflictError('Yalnızca opsiyonlu etkinliğin opsiyonu bırakılır', 'EVENT_STATUS');
    const promotions = await overlappingTentatives(tx, hotelId, eventId);
    await tx.eventVenueHold.deleteMany({ where: { eventId } });
    await tx.event.update({ where: { id: eventId }, data: { status: 'INQUIRY', optionUntil: null } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Event',
      entityId: eventId,
      action: 'UPDATE',
      before: { status: 'TENTATIVE', optionUntil: day(event.optionUntil) },
      after: { status: 'INQUIRY', reason },
    });
    if (expired) {
      await alertOwner(tx, stage, {
        hotelId,
        event,
        severity: 'WARNING',
        title: `Opsiyon düştü: ${event.name}`,
        body: `${event.code}: opsiyon tarihi (${day(event.optionUntil)}) geçti; salon bırakıldı, dosya talebe döndü. Müşteri devam ederse yeniden opsiyonlayın.`,
        dedupeKey: `banquet-option-expired:${eventId}:${day(event.optionUntil)}`,
      });
    }
    await alertPromoted(tx, stage, hotelId, promotions, `"${event.name}" etkinliğinin opsiyonu ${expired ? 'süresi dolduğu için düştü' : 'bırakıldı'}.`);
    await stage('banquet.event.changed', { hotelId, eventId, change: expired ? 'OPTION_EXPIRED' : 'RELEASED' });
    return { skipped: false };
  });
  return expired ? result : getEvent(hotelId, eventId);
}

/**
 * Kesinleştirir. Koşullar: oturum ve kalem var; politika istiyorsa güncel sözleşme
 * imzalı; her salonda **1. opsiyon** (önünde başka tutma yok); ekipman stoğu yetiyor.
 * Salonlar ve ekipman kilitlenir; iptal kademeleri politikadan kopyalanır; aynı
 * saatte opsiyonu olanların sorumlularına "salon kesinleşti" haberi gider.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function confirmEvent(hotelId, eventId, { expectedUpdatedAt }) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
      if (event.status !== 'INQUIRY' && event.status !== 'TENTATIVE') throw new ConflictError('Yalnızca talep ya da opsiyonlu etkinlik kesinleşir', 'EVENT_STATUS');
      const [sessions, itemCount, settings, contract] = await Promise.all([
        tx.eventSession.findMany({ where: { eventId } }),
        tx.eventItem.count({ where: { eventId } }),
        loadEventSettings(tx, hotelId),
        tx.eventDocument.findFirst({ where: { eventId, kind: 'CONTRACT', status: { not: 'SUPERSEDED' } }, select: { status: true } }),
      ]);
      if (sessions.length === 0) throw new ConflictError('Kesinleştirmek için programa oturum ekleyin', 'NO_SESSIONS');
      if (itemCount === 0) throw new ConflictError('Kesinleştirmek için fiyat kalemlerini girin', 'NO_ITEMS');
      if (settings.requireSignedContract && contract?.status !== 'SIGNED') {
        throw new ConflictError('Politika gereği kesinleştirmeden önce sözleşme üretilip imzalandı olarak işaretlenmeli', 'CONTRACT_REQUIRED');
      }
      const venues = await lockedVenueTree(tx, hotelId, sessions);
      assertSessionsFit(sessions, venues);
      if (event.status === 'INQUIRY') {
        // Talepten doğrudan kesine: önündeki opsiyonları atlayamaz (yeni tutma en sonda).
        const now = new Date();
        for (const session of sessions) await writeSessionHolds(tx, { hotelId, eventId, session, venues, status: 'TENTATIVE', now });
      }
      const ranks = await loadEventRanks(tx, hotelId, [eventId]);
      const rank = ranks.get(eventId);
      if (rank && rank.rank > 1) {
        const ahead = await tx.event.findMany({ where: { id: { in: rank.blockedBy }, hotelId }, select: { code: true, name: true, status: true } });
        throw new ConflictError(
          `Salonda önde ${ahead.map((entry) => `"${entry.name}" (${entry.code}, ${entry.status === 'DEFINITE' ? 'kesin' : 'opsiyonlu'})`).join(', ')} var; bu etkinlik ${rank.rank}. opsiyon. Öndeki opsiyon düşmeden kesinleşemez.`,
          'OPTION_RANK',
          { rank: rank.rank },
        );
      }
      await equipmentShortages(tx, hotelId, eventId, { strict: true });
      const blocked = await overlappingTentatives(tx, hotelId, eventId);
      await tx.eventVenueHold.updateMany({ where: { eventId }, data: { status: 'DEFINITE' } });
      await tx.event.update({
        where: { id: eventId },
        data: { status: 'DEFINITE', optionUntil: null, definiteAt: new Date(), definiteBy: actor, cancellationTiers: settings.cancellationTiers },
      });
      await recomputeEventTotals(tx, hotelId, eventId);
      await recordAudit(tx, { hotelId, entity: 'Event', entityId: eventId, action: 'UPDATE', before: { status: event.status }, after: { status: 'DEFINITE', by: actor, cancellationTiers: settings.cancellationTiers } });
      if (blocked.ids.length) {
        const others = await tx.event.findMany({ where: { id: { in: blocked.ids }, hotelId }, select: { id: true, code: true, name: true, ownerEmail: true } });
        for (const other of others) {
          await alertOwner(tx, stage, {
            hotelId,
            event: other,
            severity: 'WARNING',
            title: `Salon kesinleşti: ${other.name} kesinleşemez`,
            body: `"${event.name}" (${event.code}) aynı salonda aynı saatte kesinleşti. Opsiyonunuz bekleme sırasında; müşteriye başka saat / salon önerin.`,
            dedupeKey: `banquet-blocked:${other.id}:${eventId}`,
          });
        }
      }
      await stage('banquet.event.changed', { hotelId, eventId, change: 'DEFINITE' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getEvent(hotelId, eventId);
}

/**
 * Gerçekleşti: kesin etkinliğin son oturumu bittikten sonra, gerçekleşen kişi
 * sayısıyla. Kişi başı kalemler en çok (garanti, gerçekleşen) ile yeniden fiyatlanır;
 * etkinlik faturaya hazırdır (proforma).
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ expectedUpdatedAt: Date, actualPax: number }} input
 */
export async function completeEvent(hotelId, eventId, { expectedUpdatedAt, actualPax }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
    if (event.status !== 'DEFINITE') throw new ConflictError('Yalnızca kesin etkinlik gerçekleşti olarak kapatılır', 'EVENT_STATUS');
    if (!event.lastEndAt || event.lastEndAt.getTime() > Date.now()) throw new ConflictError('Etkinliğin son oturumu henüz bitmedi', 'EVENT_NOT_OVER');
    await tx.event.update({ where: { id: eventId }, data: { status: 'COMPLETED', actualPax, completedAt: new Date(), completedBy: actor } });
    const totals = await recomputeEventTotals(tx, hotelId, eventId);
    await recordAudit(tx, {
      hotelId,
      entity: 'Event',
      entityId: eventId,
      action: 'UPDATE',
      before: { status: 'DEFINITE', grandTotal: money(event.grandTotal) },
      after: { status: 'COMPLETED', actualPax, billablePax: totals.billablePax, grandTotal: totals.grandTotal },
    });
    await stage('banquet.event.changed', { hotelId, eventId, change: 'COMPLETED' });
  });
  return getEvent(hotelId, eventId);
}

/**
 * Kesin etkinliği iptal eder: iptal bedeli kesinleşirken kopyalanan kademelerden
 * (ilk oturum gününe kalan güne göre); salon boşalır, sırası yükselenlere haber.
 * Ödenmiş tutar bedelden fazlaysa fark iade olarak (onaylı) verilir.
 *
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function cancelEvent(hotelId, eventId, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  const { timezone, today } = await hotelContext(hotelId);
  await writeWithEvents(async (tx, stage) => {
    const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
    if (event.status !== 'DEFINITE') throw new ConflictError('Yalnızca kesin etkinlik iptal edilir (talep / opsiyon "kaybedildi" olarak kapanır)', 'EVENT_STATUS');
    const tiers = tiersOf(event.cancellationTiers);
    const fee = cancellationFee({ grandTotal: money(event.grandTotal), tiers, daysBefore: daysBetween(today, sessionDay(event.firstStartAt, timezone)) });
    const promotions = await overlappingTentatives(tx, hotelId, eventId);
    await tx.eventVenueHold.deleteMany({ where: { eventId } });
    await tx.event.update({
      where: { id: eventId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: actor, cancelReason: reason, cancellationFee: fee.fee },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'Event',
      entityId: eventId,
      action: 'UPDATE',
      before: { status: 'DEFINITE', grandTotal: money(event.grandTotal) },
      after: { status: 'CANCELLED', reason, feePct: fee.feePct, cancellationFee: fee.fee, paidTotal: money(event.paidTotal) },
    });
    const refundable = toDecimal(String(event.paidTotal)).minus(toDecimal(fee.fee));
    if (refundable.greaterThan(0)) {
      await alertOwner(tx, stage, {
        hotelId,
        event,
        severity: 'WARNING',
        title: `İade gerekiyor: ${event.name}`,
        body: `${event.code} iptal edildi. Ödenen ${money(event.paidTotal)}, iptal bedeli ${fee.fee} (%${fee.feePct}); müşteriye ${toMoneyString(refundable)} ${event.currency} iade edilmeli (Ödemeler sekmesi, onaylı).`,
        dedupeKey: `banquet-refund:${eventId}`,
      });
    }
    await alertPromoted(tx, stage, hotelId, promotions, `"${event.name}" iptal edildi.`);
    await alertCancelledRequests(tx, stage, { hotelId, event });
    await stage('banquet.event.changed', { hotelId, eventId, change: 'CANCELLED' });
  });
  return getEvent(hotelId, eventId);
}

/**
 * Talep ya da opsiyonu kaybedildi olarak kapatır (satış istatistiği için sebebiyle).
 * @param {string} hotelId
 * @param {string} eventId
 * @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function loseEvent(hotelId, eventId, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const event = await lockedEvent(tx, hotelId, eventId, expectedUpdatedAt);
    if (event.status !== 'INQUIRY' && event.status !== 'TENTATIVE') throw new ConflictError('Yalnızca talep ya da opsiyon kaybedilir (kesin etkinlik iptal edilir)', 'EVENT_STATUS');
    const promotions = event.status === 'TENTATIVE' ? await overlappingTentatives(tx, hotelId, eventId) : null;
    await tx.eventVenueHold.deleteMany({ where: { eventId } });
    await tx.event.update({ where: { id: eventId }, data: { status: 'LOST', optionUntil: null, lostAt: new Date(), lostBy: actor, lostReason: reason } });
    await recordAudit(tx, { hotelId, entity: 'Event', entityId: eventId, action: 'UPDATE', before: { status: event.status }, after: { status: 'LOST', reason } });
    if (promotions) await alertPromoted(tx, stage, hotelId, promotions, `"${event.name}" kaybedildi.`);
    await stage('banquet.event.changed', { hotelId, eventId, change: 'LOST' });
  });
  return getEvent(hotelId, eventId);
}
