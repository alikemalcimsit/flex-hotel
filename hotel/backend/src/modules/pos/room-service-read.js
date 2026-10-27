import { Prisma } from '@prisma/client';
import { toDecimal, toMoneyString } from '@hotelos/core';
import {
  MAX_BOARD_COLUMN,
  MAX_PREP_LIST_ORDERS,
  MAX_TRAY_LIST,
  PREP_SLOT_MINUTES,
  ROOM_SERVICE_ACTIVE_STATUSES,
  ROOM_SERVICE_KITCHEN_STATUSES,
  roomServiceDurations,
  trayOverdue,
  trayTrackingSince,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from '@hotelos/hotel-contracts';
import { NotFoundError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { prepSlots } from './room-service-rules.js';
import { checkBalance } from './rules.js';
import { hotelContext, iso, loadPosSettings, money, prisma } from './shared.js';

/**
 * Oda servisinin okuma uçları (modül 41): sipariş ekranı, teslim panosu, geçmiş (sayfalı, aramalı), hazırlık
 * listesi (kahvaltı kartı), toplanacak tepsiler ve rapor.
 *
 * Her liste sınırlıdır: pano sütunu `MAX_BOARD_COLUMN` (sayısı ayrıca), hazırlık listesi bir gün ve
 * `MAX_PREP_LIST_ORDERS` (aşarsa "kesildi"), tepsi listesi `MAX_TRAY_LIST`, geçmiş sayfalı. Gün süzgeçleri otelin
 * gününe göredir (saat dilimiyle UTC aralığına çevrilir; ham SQL'de `sqlTimestamp`).
 */

/** Numara aramasında en kısa parça (trigram index'i üç karakterle çalışır). */
const MIN_NUMBER_SEARCH = 3;
/** Ad aramasında en kısa parça. */
const MIN_NAME_SEARCH = 2;
/** Rapordaki götüren listesi en fazla. */
const REPORT_RUNNERS = 30;
const MINUTE_MS = 60_000;

const CARD_SELECT = Object.freeze({
  id: true,
  number: true,
  status: true,
  source: true,
  outletId: true,
  checkId: true,
  reservationId: true,
  roomNumber: true,
  guestName: true,
  covers: true,
  note: true,
  deliverAt: true,
  releaseAt: true,
  dueAt: true,
  items: true,
  itemsTotal: true,
  trayExpected: true,
  createdBy: true,
  createdAt: true,
  acceptedAt: true,
  receivedAt: true,
  preparingAt: true,
  readyAt: true,
  dispatchedAt: true,
  runnerEmail: true,
  deliveredAt: true,
  cancelledAt: true,
  rejectedAt: true,
  trayCollectedAt: true,
  updatedAt: true,
  outlet: { select: { name: true } },
  reservation: { select: { status: true, room: { select: { number: true } } } },
});

/**
 * Pano / liste kartı: kalemler, zamanlar, gecikme ve oda değişikliği.
 * @param {any} row @param {Date} now
 */
function toCard(row, now) {
  const active = ROOM_SERVICE_ACTIVE_STATUSES.includes(row.status);
  const currentRoom = row.reservation?.room?.number ?? null;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    source: row.source,
    outletId: row.outletId,
    outletName: row.outlet?.name ?? null,
    checkId: row.checkId,
    reservationId: row.reservationId,
    roomNumber: row.roomNumber,
    /** Konaklama sipariş sonrası oda değiştirdiyse şimdiki oda (teslim oraya). */
    movedTo: active && currentRoom && currentRoom !== row.roomNumber ? currentRoom : null,
    stayActive: row.reservation?.status === 'CHECKED_IN',
    guestName: row.guestName,
    covers: row.covers,
    note: row.note,
    deliverAt: iso(row.deliverAt),
    releaseAt: iso(row.releaseAt),
    dueAt: iso(row.dueAt),
    items: Array.isArray(row.items) ? row.items : [],
    itemsTotal: money(row.itemsTotal),
    trayExpected: row.trayExpected,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    acceptedAt: iso(row.acceptedAt),
    receivedAt: iso(row.receivedAt),
    preparingAt: iso(row.preparingAt),
    readyAt: iso(row.readyAt),
    dispatchedAt: iso(row.dispatchedAt),
    runnerEmail: row.runnerEmail,
    deliveredAt: iso(row.deliveredAt),
    cancelledAt: iso(row.cancelledAt),
    rejectedAt: iso(row.rejectedAt),
    trayCollectedAt: iso(row.trayCollectedAt),
    late: ROOM_SERVICE_KITCHEN_STATUSES.includes(row.status) && row.dueAt.getTime() < now.getTime(),
    durations: roomServiceDurations(row),
    updatedAt: iso(row.updatedAt),
  };
}

/** Otelin gün aralığı → [başı, son günün ertesinin başı) UTC. @param {string} from @param {string} to @param {string} timezone */
export function dayWindow(from, to, timezone) {
  const next = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start: zonedWallTimeToUtc(`${from}T00:00`, timezone), end: zonedWallTimeToUtc(`${next}T00:00`, timezone) };
}

/** Takvim günü (otelin saatine göre bugün). @param {string} timezone */
const localToday = (timezone) => utcToZonedWallTime(new Date(), timezone).slice(0, 10);

/* ══════════════════ Sipariş ekranı ══════════════════ */

/**
 * Sipariş: kart alanları, adisyonun hesabı (teslimde tahsil edilecek), misafir isteği, kabul / ret / iptal / teslim /
 * tepsi izleri.
 * @param {string} hotelId @param {string} orderId
 */
export async function getOrder(hotelId, orderId) {
  const row = await prisma.roomServiceOrder.findFirst({
    where: { id: orderId, hotelId },
    select: {
      ...CARD_SELECT,
      acceptedBy: true,
      rejectedBy: true,
      rejectReason: true,
      deliveredBy: true,
      cancelledBy: true,
      cancelReason: true,
      trayCollectedBy: true,
      linkId: true,
      guestRequest: { select: { id: true, title: true, status: true } },
      check: { select: { id: true, number: true, status: true, waiterEmail: true, grandTotal: true, paidTotal: true, roomChargeTotal: true, compTotal: true, voidTotal: true, discountTotal: true } },
    },
  });
  if (!row) throw new NotFoundError('Oda servisi siparişi bulunamadı');
  const [{ currency }, settings] = await Promise.all([hotelContext(hotelId), loadPosSettings(prisma, hotelId)]);
  const now = new Date();
  const check = row.check;
  return {
    ...toCard(row, now),
    currency,
    acceptedBy: row.acceptedBy,
    rejectedBy: row.rejectedBy,
    rejectReason: row.rejectReason,
    deliveredBy: row.deliveredBy,
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
    trayCollectedBy: row.trayCollectedBy,
    fromGuestLink: Boolean(row.linkId),
    trayOverdue: trayOverdue(row, now, settings.trayAlertMinutes),
    guestRequest: row.guestRequest,
    check: check
      ? {
          id: check.id,
          number: check.number,
          status: check.status,
          waiterEmail: check.waiterEmail,
          grandTotal: money(check.grandTotal),
          paidTotal: money(check.paidTotal),
          roomChargeTotal: money(check.roomChargeTotal),
          givenAway: money(toDecimal(String(check.compTotal)).plus(toDecimal(String(check.voidTotal))).plus(toDecimal(String(check.discountTotal)))),
          balance: checkBalance({ grandTotal: money(check.grandTotal), paidTotal: money(check.paidTotal), roomChargeTotal: money(check.roomChargeTotal) }),
        }
      : null,
  };
}

/* ══════════════════ Teslim panosu ══════════════════ */

/**
 * Pano: onay bekleyen (misafir), mutfakta (düşen + hazırlanan), hazır, yolda — teslim hedefine göre; planlı
 * siparişlerin sayısı ve ilk düşecek olanı, toplanacak / gecikmiş tepsi sayısı. Sütun başına sınırlı.
 *
 * @param {string} hotelId @param {{ outletId?: string }} query
 */
export async function getBoard(hotelId, { outletId }) {
  const now = new Date();
  const outlet = outletId ? { outletId } : {};
  const column = (statuses) =>
    prisma.roomServiceOrder.findMany({ where: { hotelId, ...outlet, status: { in: statuses } }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: MAX_BOARD_COLUMN, select: CARD_SELECT });
  const settings = await loadPosSettings(prisma, hotelId);
  const trayCutoff = new Date(now.getTime() - settings.trayAlertMinutes * MINUTE_MS);
  // Takipteki tepsiler (pencerenin dışındaki oda temizliğiyle toplanmış sayılır): kısmi index'le.
  const trayWhere = { hotelId, ...outlet, status: /** @type {const} */ ('DELIVERED'), trayExpected: true, trayCollectedAt: null, deliveredAt: { gte: trayTrackingSince(now) } };
  const [requested, kitchen, ready, onTheWay, counts, nextScheduled, trays, overdueTrays, { currency }] = await Promise.all([
    column(['REQUESTED']),
    column(['RECEIVED', 'PREPARING']),
    column(['READY']),
    column(['ON_THE_WAY']),
    prisma.roomServiceOrder.groupBy({ by: ['status'], where: { hotelId, ...outlet, status: { in: [...ROOM_SERVICE_ACTIVE_STATUSES] } }, _count: { _all: true } }),
    prisma.roomServiceOrder.findFirst({ where: { hotelId, ...outlet, status: 'SCHEDULED' }, orderBy: [{ releaseAt: 'asc' }, { id: 'asc' }], select: { releaseAt: true, deliverAt: true, number: true } }),
    prisma.roomServiceOrder.count({ where: trayWhere }),
    prisma.roomServiceOrder.count({ where: { ...trayWhere, deliveredAt: { gte: trayTrackingSince(now), lte: trayCutoff } } }),
    hotelContext(hotelId),
  ]);
  const count = (status) => counts.find((entry) => entry.status === status)?._count._all ?? 0;
  const cards = (rows) => rows.map((row) => toCard(row, now));
  return {
    currency,
    now: now.toISOString(),
    settings: { deliveryTargetMinutes: settings.deliveryTargetMinutes, prepLeadMinutes: settings.prepLeadMinutes, trayAlertMinutes: settings.trayAlertMinutes, trayCharge: settings.trayCharge, guestOrderingEnabled: settings.guestOrderingEnabled },
    columns: {
      requested: { items: cards(requested), total: count('REQUESTED') },
      kitchen: { items: cards(kitchen), total: count('RECEIVED') + count('PREPARING') },
      ready: { items: cards(ready), total: count('READY') },
      onTheWay: { items: cards(onTheWay), total: count('ON_THE_WAY') },
    },
    scheduled: { total: count('SCHEDULED'), next: nextScheduled ? { number: nextScheduled.number, releaseAt: iso(nextScheduled.releaseAt), deliverAt: iso(nextScheduled.deliverAt) } : null },
    trays: { pending: trays, overdue: overdueTrays },
  };
}

/* ══════════════════ Geçmiş ══════════════════ */

/**
 * Sipariş geçmişi (sayfalı; en yeni önce): durum grubu, kaynak, satış noktası, konaklama, sipariş günü aralığı
 * (otelin günü), arama (numara parçası, oda numarası birebir, misafir adı parçası).
 * @param {string} hotelId @param {any} query `roomServiceListQuerySchema`
 */
export async function listOrders(hotelId, query) {
  const { currency, timezone } = await hotelContext(hotelId);
  const now = new Date();
  const statuses = { ACTIVE: [...ROOM_SERVICE_ACTIVE_STATUSES], DELIVERED: ['DELIVERED'], CANCELLED: ['CANCELLED', 'REJECTED'] }[query.state] ?? null;
  const window = query.from || query.to ? dayWindow(query.from ?? query.to, query.to ?? query.from, timezone) : null;
  const search = query.search?.trim();
  if (search) {
    const found = await searchOrderIds(hotelId, { statuses, window, query }, search);
    const rows = found.ids.length ? await prisma.roomServiceOrder.findMany({ where: { hotelId, id: { in: found.ids } }, select: CARD_SELECT }) : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const page = buildPage(
      found.ids.map((id) => toCard(byId.get(id), now)),
      found.total,
      query,
    );
    return { ...page, meta: { ...page.meta, currency } };
  }
  const where = {
    hotelId,
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.outletId ? { outletId: query.outletId } : {}),
    ...(query.reservationId ? { reservationId: query.reservationId } : {}),
    ...(window ? { createdAt: { gte: window.start, lt: window.end } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.roomServiceOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query), select: CARD_SELECT }),
    prisma.roomServiceOrder.count({ where }),
  ]);
  const page = buildPage(
    rows.map((row) => toCard(row, now)),
    total,
    query,
  );
  return { ...page, meta: { ...page.meta, currency } };
}

/**
 * Aramalı geçmişin sayfası: eşleşenler önce ayrı (MATERIALIZED) bulunur — numara parçası ve ad parçası trigram
 * index'iyle, oda numarası `(hotelId, roomNumber, createdAt)` ile; yalnızca eşleşme kümesi sıralanır (planlayıcı
 * tarih index'iyle bütün geçmişi taramaz; restoranın adisyon aramasıyla aynı yol).
 *
 * @param {string} hotelId @param {{ statuses: string[] | null, window: { start: Date, end: Date } | null, query: any }} filters @param {string} search
 */
async function searchOrderIds(hotelId, { statuses, window, query }, search) {
  const escaped = search.replace(/[\\%_]/g, (char) => `\\${char}`);
  const match = [Prisma.sql`"roomNumber" = ${search}`];
  if (search.length >= MIN_NUMBER_SEARCH) match.push(Prisma.sql`"number" LIKE ${`%${escaped.toUpperCase()}%`}`);
  if (search.length >= MIN_NAME_SEARCH && /\p{L}/u.test(search)) match.push(Prisma.sql`"guestName" ILIKE ${`%${escaped}%`}`);
  const filters = [Prisma.sql`"hotelId" = ${hotelId}`, Prisma.sql`(${Prisma.join(match, ' OR ')})`];
  if (statuses) filters.push(Prisma.sql`"status"::text = ANY(${statuses}::text[])`);
  if (query.source) filters.push(Prisma.sql`"source" = ${query.source}::"RoomServiceSource"`);
  if (query.outletId) filters.push(Prisma.sql`"outletId" = ${query.outletId}`);
  if (query.reservationId) filters.push(Prisma.sql`"reservationId" = ${query.reservationId}`);
  if (window) filters.push(Prisma.sql`"createdAt" >= ${sqlTimestamp(window.start)} AND "createdAt" < ${sqlTimestamp(window.end)}`);
  const hits = Prisma.sql`WITH hits AS MATERIALIZED (SELECT "id", "createdAt" FROM "RoomServiceOrder" WHERE ${Prisma.join(filters, ' AND ')})`;
  const { skip, take } = toSkipTake(query);
  const [rows, [{ total }]] = await Promise.all([
    prisma.$queryRaw`${hits} SELECT "id" FROM hits ORDER BY "createdAt" DESC, "id" DESC LIMIT ${take} OFFSET ${skip}`,
    prisma.$queryRaw`${hits} SELECT COUNT(*)::int AS "total" FROM hits`,
  ]);
  return { ids: rows.map((row) => row.id), total };
}

/* ══════════════════ Hazırlık listesi ══════════════════ */

/**
 * Hazırlık listesi (kahvaltı kartı): seçilen gün (otelin günü) teslim saatli siparişler — teslim saatine göre
 * 15 dakikalık aralıklar, her aralıkta ve günün tamamında ürün başına adet; iptal / ret hariç. Bir günde en fazla
 * `MAX_PREP_LIST_ORDERS` sipariş (aşarsa "kesildi").
 *
 * @param {string} hotelId @param {{ date?: string, outletId?: string }} query
 */
export async function prepList(hotelId, { date, outletId }) {
  const { timezone } = await hotelContext(hotelId);
  const now = new Date();
  const day = date ?? localToday(timezone);
  const { start, end } = dayWindow(day, day, timezone);
  const rows = await prisma.roomServiceOrder.findMany({
    where: { hotelId, ...(outletId ? { outletId } : {}), deliverAt: { gte: start, lt: end }, status: { notIn: ['CANCELLED', 'REJECTED'] } },
    orderBy: [{ deliverAt: 'asc' }, { id: 'asc' }],
    take: MAX_PREP_LIST_ORDERS + 1,
    select: CARD_SELECT,
  });
  const truncated = rows.length > MAX_PREP_LIST_ORDERS;
  const cards = rows.slice(0, MAX_PREP_LIST_ORDERS).map((row) => ({ ...toCard(row, now), deliverAtDate: row.deliverAt }));
  const plan = prepSlots(
    cards.map((card) => ({ ...card, deliverAt: card.deliverAtDate })),
    { timeZone: timezone, slotMinutes: PREP_SLOT_MINUTES },
  );
  const strip = ({ deliverAtDate, ...card }) => ({ ...card, deliverAt: iso(deliverAtDate) });
  const byStatus = (statuses) => cards.filter((card) => statuses.includes(card.status)).length;
  return {
    date: day,
    timezone,
    slotMinutes: PREP_SLOT_MINUTES,
    total: cards.length,
    truncated,
    counts: { scheduled: byStatus(['SCHEDULED', 'REQUESTED']), inKitchen: byStatus(['RECEIVED', 'PREPARING', 'READY']), out: byStatus(['ON_THE_WAY', 'DELIVERED']) },
    slots: plan.slots.map((slot) => ({ time: slot.time, items: slot.items, orders: slot.orders.map(strip) })),
    items: plan.items,
  };
}

/* ══════════════════ Tepsiler ══════════════════ */

/**
 * Toplanacak tepsiler: teslim edilmiş, tepsi bırakılmış, işaretlenmemiş ve takip penceresinde (`TRAY_TRACKING_HOURS`) —
 * en eski önce; uyarı süresini geçen işaretli.
 * @param {string} hotelId @param {{ outletId?: string }} query
 */
export async function listTrays(hotelId, { outletId }) {
  const now = new Date();
  const settings = await loadPosSettings(prisma, hotelId);
  const where = { hotelId, ...(outletId ? { outletId } : {}), status: /** @type {const} */ ('DELIVERED'), trayExpected: true, trayCollectedAt: null, deliveredAt: { gte: trayTrackingSince(now) } };
  const [rows, total] = await Promise.all([
    prisma.roomServiceOrder.findMany({
      where,
      orderBy: [{ deliveredAt: 'asc' }, { id: 'asc' }],
      take: MAX_TRAY_LIST,
      select: { id: true, number: true, roomNumber: true, guestName: true, deliveredAt: true, runnerEmail: true, trayExpected: true, trayCollectedAt: true, reservation: { select: { status: true, room: { select: { number: true } } } } },
    }),
    prisma.roomServiceOrder.count({ where }),
  ]);
  return {
    trayAlertMinutes: settings.trayAlertMinutes,
    total,
    items: rows.map((row) => ({
      id: row.id,
      number: row.number,
      roomNumber: row.roomNumber,
      // Misafir bu arada oda değiştirdiyse tepsi hâlâ eski odadadır; çıkış yaptıysa oda boşalmıştır.
      currentRoom: row.reservation?.room?.number ?? null,
      checkedOut: row.reservation?.status === 'CHECKED_OUT',
      guestName: row.guestName,
      deliveredAt: iso(row.deliveredAt),
      runnerEmail: row.runnerEmail,
      minutes: Math.max(0, Math.round((now.getTime() - row.deliveredAt.getTime()) / MINUTE_MS)),
      overdue: trayOverdue(row, now, settings.trayAlertMinutes),
    })),
  };
}

/* ══════════════════ Rapor ══════════════════ */

/**
 * Oda servisi cirosu **kapanış iş gününe göre** (restoranın satış raporuyla aynı muhasebe tabanı): oda servisi
 * noktalarının kapanmış adisyonları — toplam, ikram + indirim, odaya yazılan, kapıda alınan; tepsi ücreti kalemleri.
 * Adisyon `(hotelId, businessDate, outletId)`, kalem `(hotelId, businessDate)` index'leriyle okunur; adisyonlar
 * yeniden açılıp düzeltildiyse güncel tutar gelir. (Siparişten adisyona kimlik listesiyle inmek 31 günde ≈ 9.000
 * kimlikte planlayıcıyı 1,7 milyon kalem ve 587.000 adisyonu taramaya itiyordu: 300 ms.)
 *
 * @param {string} hotelId @param {{ from: string, to: string, outletId?: string }} range iş günleri
 */
async function closedRevenue(hotelId, { from, to, outletId }) {
  const outletIds = outletId ? [outletId] : (await prisma.posOutlet.findMany({ where: { hotelId, kind: 'ROOM_SERVICE' }, select: { id: true } })).map((row) => row.id);
  if (!outletIds.length) return { grandTotal: '0', givenAway: '0', roomCharged: '0', doorPaid: '0', trayCharges: '0' };
  const [[totals], [tray]] = await Promise.all([
    prisma.$queryRaw`
      SELECT COALESCE(SUM(c."grandTotal"), 0)::text AS "grandTotal", COALESCE(SUM(c."compTotal" + c."discountTotal"), 0)::text AS "givenAway",
             COALESCE(SUM(c."roomChargeTotal"), 0)::text AS "roomCharged", COALESCE(SUM(c."paidTotal"), 0)::text AS "doorPaid"
      FROM "PosCheck" c
      WHERE c."hotelId" = ${hotelId} AND c."status" = 'CLOSED' AND c."businessDate" BETWEEN ${from}::date AND ${to}::date
        AND c."outletId" = ANY(${outletIds}::text[])`,
    // Tepsi ücreti kalemi yalnızca oda servisi adisyonunda olur; nokta süzgeci verildiyse adisyonuna bakılır.
    prisma.$queryRaw`
      SELECT COALESCE(SUM(l."unitPrice" * (l."quantity" - l."voidedQuantity" - l."compedQuantity")), 0)::text AS "trayCharges"
      FROM "PosOrderLine" l
      WHERE l."hotelId" = ${hotelId} AND l."businessDate" BETWEEN ${from}::date AND ${to}::date
        AND l."menuItemId" IN (SELECT m."id" FROM "MenuItem" m WHERE m."hotelId" = ${hotelId} AND m."system" = 'TRAY_CHARGE')
        ${outletId ? Prisma.sql`AND EXISTS (SELECT 1 FROM "PosCheck" c WHERE c."id" = l."checkId" AND c."outletId" = ${outletId})` : Prisma.empty}`,
  ]);
  return { ...totals, trayCharges: tray.trayCharges };
}

/** Yüzde (bir ondalık); payda sıfırsa boş. @param {number} part @param {number} whole */
const percent = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
/** Dakika (bir ondalık) ya da boş. @param {any} value */
const minutes = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10);

/**
 * Oda servisi raporu (sipariş günü aralığı, otelin günü; en fazla 31 gün): sipariş sayıları (durum, kaynak, hemen /
 * planlı), süreler (mutfak, yol, toplam — ortalama, medyan, %90), zamanında teslim oranı, misafir siparişinin kabul
 * süresi, ciro (kapanış iş gününe göre; tepsi ücreti ayrıca; kapıda / odaya), götüren kırılımı, saat dağılımı,
 * günlük seyir, toplanmamış tepsiler. Her parça tek gruplu sorgu (`(hotelId, createdAt, id)` index'i).
 *
 * @param {string} hotelId @param {{ from?: string, to?: string, outletId?: string }} query
 */
export async function roomServiceReport(hotelId, query) {
  const { currency, timezone } = await hotelContext(hotelId);
  const today = localToday(timezone);
  const from = query.from ?? today;
  const to = query.to ?? today;
  const { start, end } = dayWindow(from, to, timezone);
  const scope = Prisma.sql`o."hotelId" = ${hotelId} AND o."createdAt" >= ${sqlTimestamp(start)} AND o."createdAt" < ${sqlTimestamp(end)} ${query.outletId ? Prisma.sql`AND o."outletId" = ${query.outletId}` : Prisma.empty}`;
  const local = (column) => Prisma.sql`((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})`;
  const span = (fromColumn, toColumn) => Prisma.sql`EXTRACT(EPOCH FROM (${Prisma.raw(toColumn)} - ${Prisma.raw(fromColumn)})) / 60.0`;
  const [[summary], bySource, timing, revenue, byRunner, byHour, byDay, [trays]] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS "orders",
             COUNT(*) FILTER (WHERE o."status" = 'DELIVERED')::int AS "delivered",
             COUNT(*) FILTER (WHERE o."status" = 'CANCELLED')::int AS "cancelled",
             COUNT(*) FILTER (WHERE o."status" = 'REJECTED')::int AS "rejected",
             COUNT(*) FILTER (WHERE o."status"::text = ANY(${[...ROOM_SERVICE_ACTIVE_STATUSES]}::text[]))::int AS "open",
             COUNT(*) FILTER (WHERE o."deliverAt" IS NOT NULL)::int AS "scheduled",
             COALESCE(SUM(o."covers") FILTER (WHERE o."status" = 'DELIVERED'), 0)::int AS "covers",
             AVG(${span('o."createdAt"', 'o."acceptedAt"')}) FILTER (WHERE o."source" = 'GUEST' AND o."acceptedAt" IS NOT NULL) AS "acceptMinutes"
      FROM "RoomServiceOrder" o WHERE ${scope}`,
    prisma.$queryRaw`
      SELECT o."source", COUNT(*)::int AS "orders", COUNT(*) FILTER (WHERE o."status" = 'DELIVERED')::int AS "delivered",
             COUNT(*) FILTER (WHERE o."status" IN ('CANCELLED', 'REJECTED'))::int AS "lost"
      FROM "RoomServiceOrder" o WHERE ${scope} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw`
      SELECT (o."deliverAt" IS NOT NULL) AS "scheduled", COUNT(*)::int AS "delivered",
             COUNT(*) FILTER (WHERE o."deliveredAt" <= o."dueAt")::int AS "onTime",
             AVG(${span('o."receivedAt"', 'o."readyAt"')}) AS "kitchenAvg",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ${span('o."receivedAt"', 'o."readyAt"')}) AS "kitchenP50",
             percentile_cont(0.9) WITHIN GROUP (ORDER BY ${span('o."receivedAt"', 'o."readyAt"')}) AS "kitchenP90",
             AVG(${span('o."dispatchedAt"', 'o."deliveredAt"')}) AS "transitAvg",
             AVG(${span('o."receivedAt"', 'o."deliveredAt"')}) AS "totalAvg",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ${span('o."receivedAt"', 'o."deliveredAt"')}) AS "totalP50",
             percentile_cont(0.9) WITHIN GROUP (ORDER BY ${span('o."receivedAt"', 'o."deliveredAt"')}) AS "totalP90",
             AVG(${span('o."dueAt"', 'o."deliveredAt"')}) FILTER (WHERE o."deliveredAt" > o."dueAt") AS "lateAvg"
      FROM "RoomServiceOrder" o WHERE ${scope} AND o."status" = 'DELIVERED' GROUP BY 1`,
    closedRevenue(hotelId, { from, to, outletId: query.outletId }),
    prisma.$queryRaw`
      SELECT o."runnerEmail", COUNT(*)::int AS "delivered", COUNT(*) FILTER (WHERE o."deliveredAt" <= o."dueAt")::int AS "onTime",
             AVG(${span('o."dispatchedAt"', 'o."deliveredAt"')}) AS "transitAvg"
      FROM "RoomServiceOrder" o WHERE ${scope} AND o."status" = 'DELIVERED' AND o."runnerEmail" IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT ${REPORT_RUNNERS}`,
    prisma.$queryRaw`
      SELECT EXTRACT(HOUR FROM ${local('o."createdAt"')})::int AS "hour", COUNT(*)::int AS "orders"
      FROM "RoomServiceOrder" o WHERE ${scope} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT to_char(${local('o."createdAt"')}, 'YYYY-MM-DD') AS "date", COUNT(*)::int AS "orders",
             COUNT(*) FILTER (WHERE o."status" = 'DELIVERED')::int AS "delivered",
             COUNT(*) FILTER (WHERE o."status" = 'DELIVERED' AND o."deliveredAt" <= o."dueAt")::int AS "onTime",
             AVG(${span('o."receivedAt"', 'o."deliveredAt"')}) FILTER (WHERE o."status" = 'DELIVERED') AS "totalAvg"
      FROM "RoomServiceOrder" o WHERE ${scope} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw`
      SELECT COUNT(*) FILTER (WHERE o."trayCollectedAt" IS NULL)::int AS "uncollected",
             AVG(${span('o."deliveredAt"', 'o."trayCollectedAt"')}) FILTER (WHERE o."trayCollectedAt" IS NOT NULL) AS "collectAvg"
      FROM "RoomServiceOrder" o WHERE ${scope} AND o."status" = 'DELIVERED' AND o."trayExpected"`,
  ]);
  const money0 = revenue;
  const timingRows = timing.map((row) => ({
    scheduled: row.scheduled,
    delivered: row.delivered,
    onTime: row.onTime,
    onTimePct: percent(row.onTime, row.delivered),
    kitchen: { avg: minutes(row.kitchenAvg), p50: minutes(row.kitchenP50), p90: minutes(row.kitchenP90) },
    transitAvg: minutes(row.transitAvg),
    total: { avg: minutes(row.totalAvg), p50: minutes(row.totalP50), p90: minutes(row.totalP90) },
    lateAvg: minutes(row.lateAvg),
  }));
  const deliveredAll = timingRows.reduce((sum, row) => sum + row.delivered, 0);
  const onTimeAll = timingRows.reduce((sum, row) => sum + row.onTime, 0);
  return {
    from,
    to,
    currency,
    timezone,
    summary: {
      orders: summary.orders,
      delivered: summary.delivered,
      cancelled: summary.cancelled,
      rejected: summary.rejected,
      open: summary.open,
      scheduled: summary.scheduled,
      covers: summary.covers,
      onTimePct: percent(onTimeAll, deliveredAll),
      guestAcceptMinutes: minutes(summary.acceptMinutes),
    },
    bySource: bySource,
    timing: { asap: timingRows.find((row) => !row.scheduled) ?? null, scheduled: timingRows.find((row) => row.scheduled) ?? null },
    revenue: {
      grandTotal: money(money0.grandTotal),
      givenAway: money(money0.givenAway),
      roomCharged: money(money0.roomCharged),
      doorPaid: money(money0.doorPaid),
      trayCharges: money(money0.trayCharges),
      average: summary.delivered ? toMoneyString(toDecimal(money0.grandTotal).dividedBy(summary.delivered)) : null,
    },
    byRunner: byRunner.map((row) => ({ runnerEmail: row.runnerEmail, delivered: row.delivered, onTimePct: percent(row.onTime, row.delivered), transitAvg: minutes(row.transitAvg) })),
    byHour,
    byDay: byDay.map((row) => ({ date: row.date, orders: row.orders, delivered: row.delivered, onTimePct: percent(row.onTime, row.delivered), totalAvg: minutes(row.totalAvg) })),
    trays: { uncollected: trays.uncollected, collectAvg: minutes(trays.collectAvg) },
  };
}
