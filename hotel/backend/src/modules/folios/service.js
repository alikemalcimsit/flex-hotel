import { randomUUID } from 'node:crypto';
import { addDays, currentActor, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import {
  FOLIO_ITEM_SOURCE_LABELS,
  FOLIO_ITEM_TYPE_LABELS,
  FOLIO_MAX_WINDOWS,
  FOLIO_ROUTABLE_TYPES,
  PERMISSIONS,
  RESERVATION_COUNT_CAP,
  folioActionError,
  folioDisplayName,
  folioItemActionError,
  folioTaxCategory,
} from '@hotelos/hotel-contracts';
import { prisma, prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockFolios, lockReservations } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { MATCH_NOTHING, containsText, isFuzzyToken, matchGuestIds, matchReservationIdsByCode, matchRoomIdsByNumber, searchTokens } from '../../lib/search.js';
import { SQL_NOW, sqlTimestamp } from '../../lib/sql-time.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { requestApproval } from '../approvals/service.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { stayPaymentStatus } from '../payments/service.js';
import { guestFullName } from '../reservations/guests.js';
import { getActiveTaxes, getHotelSettings } from '../settings/service.js';
import {
  activeFeeItems,
  createStayFolio,
  dayStart,
  dotted,
  loadStayFolioState,
  money,
  planStayRoomSpecs,
  postRoomCharges,
  postSpecs,
  refreshFolioTotals,
  reverseItems,
} from './posting.js';
import { balanceIsZero, chargeLine, linesTotal, nextWindow, resolvePostingFolio } from './rules.js';

/**
 * Folyo yönetimi (modül 15).
 *
 * ### Kim ne yazar
 *
 * - **Personel** (bu dosyanın ilk yarısı): elle harcama / indirim, iptal isteği
 *   (onay kuyruğuna gider), aktarma, bölme, birleştirme, yönlendirme, kapatma,
 *   yeniden açma, eksik oda ücretlerini işleme.
 * - **Folyo aktörü** (billing-worker, ikinci yarı): girişte folyo açar ve erken
 *   giriş ücretini, her gece oda ücretlerini, çıkışta kalan geceleri ve geç
 *   çıkış ücretini, iptal / gelmedi ücretini, restoran ve minibar kalemlerini
 *   işler; giriş / çıkış / iptal geri alınınca kendi işlediği ücreti ters
 *   kayıtla düşer. Aktör kapalıysa bu işler manuel göreve düşer; personel aynı
 *   işi folyo ekranından yapar (aynı fonksiyonlar, aynı tekrar işleme anahtarı).
 * - **Ödeme** (modül 17, `payments/service.js`) `Payment` yazar; folyo
 *   kilidini alıp `refreshFolioTotals` çağırır (toplamlar kilit altında
 *   tutarlı kalır). Onay bekleyen ödeme / iade ve ödeme iptali folyonun
 *   kapanmasını engeller; ödemeden sonra bitmiş konaklamanın sıfırlanan
 *   folyosunu aktör kapatır (`closeFolioIfSettled`).
 *
 * ### Para kuralları
 *
 * Kalem silinmez; iptal ters kayıttır (ikinci bir yetkilinin onayıyla).
 * Bakiye = Σ kalem toplamı − Σ ödeme (kurla). Kapalı folyoya kalem düşmez;
 * bakiyesi sıfır olmayan folyo kapanmaz; içerideki misafirin son açık folyosu
 * kapanmaz (kalemleri bir yere düşmeli).
 */

/** Toplu gece çalışmasında bir transaction'daki konaklama sayısı. */
export const ROOM_CHARGE_CHUNK_SIZE = 100;

/** "İptal / gelmedi ücreti" kalemlerinin vergi kategorisi (vergi ayarındaki "Diğer"). */
const RESERVATION_FEE_TAX_CATEGORY = 'OTHER';

const FEE_DESCRIPTIONS = Object.freeze({
  EARLY_CHECK_IN: 'Erken giriş ücreti',
  LATE_CHECK_OUT: 'Geç çıkış ücreti',
  CANCELLATION: 'İptal ücreti',
  NO_SHOW: 'Gelmedi (no-show) ücreti',
});

const iso = (value) => (value ? value.toISOString() : null);

/* ══════════════════ Okuma yardımcıları ══════════════════ */

const STAY_HEADER_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  confirmationCode: true,
  status: true,
  guestId: true,
  checkIn: true,
  checkOut: true,
  adults: true,
  children: true,
  currency: true,
  groupId: true,
  guest: { select: { id: true, firstName: true, lastName: true } },
  room: { select: { id: true, number: true } },
  roomType: { select: { code: true, name: true } },
});

/** @param {any} stay */
function stayHeader(stay) {
  return {
    id: stay.id,
    confirmationCode: stay.confirmationCode,
    status: stay.status,
    checkIn: toIsoDay(stay.checkIn),
    checkOut: toIsoDay(stay.checkOut),
    adults: stay.adults,
    children: stay.children,
    currency: stay.currency,
    groupId: stay.groupId ?? null,
    guest: { id: stay.guest.id, name: guestFullName(stay.guest) },
    room: stay.room ? { id: stay.room.id, number: stay.room.number } : null,
    roomType: stay.roomType ? { code: stay.roomType.code, name: stay.roomType.name } : null,
  };
}

/** Başka konaklamanın folyosuna işaret ederken gösterilen kısa bilgi. */
const FOLIO_REF_SELECT = Object.freeze({
  id: true,
  window: true,
  payerName: true,
  status: true,
  reservationId: true,
  reservation: {
    select: { confirmationCode: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } },
  },
});

/** @param {any} folio */
function folioRef(folio) {
  if (!folio) return null;
  return {
    id: folio.id,
    window: folio.window,
    name: folioDisplayName(folio),
    status: folio.status,
    reservationId: folio.reservationId,
    confirmationCode: folio.reservation?.confirmationCode ?? null,
    roomNumber: folio.reservation?.room?.number ?? null,
    guestName: folio.reservation?.guest ? guestFullName(folio.reservation.guest) : null,
  };
}

const FOLIO_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  reservationId: true,
  guestId: true,
  window: true,
  payerName: true,
  status: true,
  currency: true,
  chargesTotal: true,
  paymentsTotal: true,
  balance: true,
  openedBy: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
  closedBy: true,
  mergedAt: true,
  mergedBy: true,
  mergedInto: { select: FOLIO_REF_SELECT },
});

/** @param {any} row */
function toFolioDto(row) {
  return {
    id: row.id,
    reservationId: row.reservationId,
    window: row.window,
    payerName: row.payerName ?? null,
    name: folioDisplayName(row),
    status: row.status,
    currency: row.currency,
    chargesTotal: money(row.chargesTotal),
    paymentsTotal: money(row.paymentsTotal),
    balance: money(row.balance),
    openedBy: row.openedBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    closedAt: iso(row.closedAt),
    closedBy: row.closedBy ?? null,
    mergedInto: folioRef(row.mergedInto),
    mergedAt: iso(row.mergedAt),
    mergedBy: row.mergedBy ?? null,
  };
}

const ITEM_SELECT = Object.freeze({
  id: true,
  folioId: true,
  reservationId: true,
  type: true,
  source: true,
  description: true,
  amount: true,
  quantity: true,
  taxCategory: true,
  netAmount: true,
  taxAmount: true,
  total: true,
  taxLines: true,
  serviceDate: true,
  postedBy: true,
  postedAt: true,
  reversalOfId: true,
  voidedAt: true,
  voidedBy: true,
  voidReason: true,
  voidApprovalId: true,
  voidRequestedAt: true,
  voidRequestedBy: true,
  transferredAt: true,
  transferredBy: true,
  transferredFrom: { select: FOLIO_REF_SELECT },
  reservation: {
    select: { id: true, confirmationCode: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } },
  },
});

/**
 * @param {any} row
 * @param {string} folioReservationId folyonun konaklaması: kalem başka konaklamadan geldiyse kaynağı gösterilir
 */
function toItemDto(row, folioReservationId) {
  return {
    id: row.id,
    folioId: row.folioId,
    reservationId: row.reservationId,
    type: row.type,
    source: row.source,
    description: row.description,
    amount: money(row.amount),
    quantity: row.quantity,
    taxCategory: row.taxCategory ?? null,
    netAmount: money(row.netAmount),
    taxAmount: money(row.taxAmount),
    total: money(row.total),
    taxLines: row.taxLines ?? [],
    serviceDate: toIsoDay(row.serviceDate),
    postedBy: row.postedBy,
    postedAt: iso(row.postedAt),
    reversalOfId: row.reversalOfId ?? null,
    voided: Boolean(row.voidedAt),
    voidedAt: iso(row.voidedAt),
    voidedBy: row.voidedBy ?? null,
    voidReason: row.voidReason ?? null,
    voidPending: Boolean(row.voidRequestedAt),
    voidApprovalId: row.voidApprovalId ?? null,
    voidRequestedAt: iso(row.voidRequestedAt),
    voidRequestedBy: row.voidRequestedBy ?? null,
    transferredFrom: folioRef(row.transferredFrom),
    transferredAt: iso(row.transferredAt),
    transferredBy: row.transferredBy ?? null,
    origin:
      row.reservationId !== folioReservationId && row.reservation
        ? {
            reservationId: row.reservation.id,
            confirmationCode: row.reservation.confirmationCode,
            roomNumber: row.reservation.room?.number ?? null,
            guestName: guestFullName(row.reservation.guest),
          }
        : null,
  };
}

/** Denetim izine yazılan kalem özeti. */
const itemAudit = (item) => ({
  folioId: item.folioId,
  type: item.type,
  source: item.source,
  description: item.description,
  amount: money(item.amount),
  quantity: item.quantity,
  total: money(item.total),
  serviceDate: item.serviceDate ? toIsoDay(item.serviceDate) : null,
});

/** Denetim izine yazılan folyo özeti. */
const folioAudit = (folio) => ({
  window: folio.window,
  payerName: folio.payerName ?? null,
  status: folio.status,
  balance: money(folio.balance),
  mergedIntoId: folio.mergedIntoId ?? folio.mergedInto?.id ?? null,
});

/**
 * @param {string} hotelId
 * @param {string} folioId
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} [client]
 */
async function findFolio(hotelId, folioId, client = prisma) {
  const folio = await client.folio.findFirst({ where: { id: folioId, hotelId }, select: FOLIO_SELECT });
  if (!folio) throw new NotFoundError('Folyo bulunamadı');
  return folio;
}

/**
 * Folyo işlem kuralı ihlali → 409.
 * @param {any} folio
 * @param {Parameters<typeof folioActionError>[1]} action
 * @param {Parameters<typeof folioActionError>[2]} [context]
 */
function assertFolio(folio, action, context) {
  const reason = folioActionError(folio, action, context);
  if (reason) throw new ConflictError(reason, folio.status === 'OPEN' ? 'FOLIO_RULE' : 'FOLIO_NOT_OPEN', { status: folio.status });
}

/** @param {string} hotelId */
async function businessDay(hotelId) {
  return toIsoDay(await getBusinessDate(hotelId));
}

/**
 * Konaklama satırı (kilitli okuma için).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} reservationId
 */
async function readStayForPosting(tx, hotelId, reservationId) {
  const stay = await tx.reservation.findFirst({
    where: { id: reservationId, hotelId },
    select: {
      id: true,
      guestId: true,
      currency: true,
      status: true,
      checkedOutAt: true,
      cancellationFee: true,
      noShowFee: true,
      roomId: true,
      confirmationCode: true,
    },
  });
  if (!stay) throw new NotFoundError('Konaklama bulunamadı');
  return stay;
}

/* ══════════════════ Okuma ══════════════════ */

/**
 * Konaklamanın folyoları (sekmeler), yönlendirmesi ve eksik oda ücretleri.
 * @param {string} hotelId
 * @param {string} reservationId
 */
export async function getStayFolios(hotelId, reservationId) {
  const stay = await prisma.reservation.findFirst({
    where: { id: reservationId, hotelId },
    select: { ...STAY_HEADER_SELECT, checkedInAt: true, depositMethod: true, depositAmount: true, depositReference: true },
  });
  if (!stay) throw new NotFoundError('Konaklama bulunamadı');
  const businessDate = await businessDay(hotelId);

  const [folios, routes, counts, pending, payments] = await Promise.all([
    prisma.folio.findMany({ where: { hotelId, reservationId }, select: FOLIO_SELECT, orderBy: { window: 'asc' } }),
    prisma.folioRoute.findMany({
      where: { hotelId, reservationId },
      select: { type: true, folio: { select: FOLIO_REF_SELECT } },
      orderBy: { type: 'asc' },
    }),
    prisma.$queryRaw`
      SELECT i."folioId" AS "folioId",
             COUNT(*)::int AS "items",
             COUNT(*) FILTER (WHERE i."voidRequestedAt" IS NOT NULL)::int AS "pendingVoids"
      FROM "FolioItem" i
      JOIN "Folio" f ON f."id" = i."folioId"
      WHERE f."hotelId" = ${hotelId} AND f."reservationId" = ${reservationId} AND i."deletedAt" IS NULL
      GROUP BY i."folioId"`,
    pendingRoomCharges(hotelId, stay, businessDate),
    stayPaymentStatus(prisma, hotelId, stay),
  ]);
  const countBy = new Map(counts.map((row) => [row.folioId, row]));
  const paymentVoids = await pendingPaymentVoids(prisma, hotelId, folios.map((folio) => folio.id));

  return {
    stay: stayHeader(stay),
    businessDate,
    folios: folios.map((folio) => ({
      ...toFolioDto(folio),
      items: countBy.get(folio.id)?.items ?? 0,
      // Onay bekleyen kalem ve ödeme iptalleri; onay bekleyen ödeme / iade ayrı.
      pendingVoids: (countBy.get(folio.id)?.pendingVoids ?? 0) + (paymentVoids.get(folio.id) ?? 0),
      pendingPayments: payments.pendingByFolio.get(folio.id) ?? 0,
    })),
    routes: routes.map((route) => ({ type: route.type, folio: folioRef(route.folio) })),
    roomCharges: pending,
    // Ödeme (modül 17): onay bekleyen ödeme / iade toplamları, girişte alınan teminatın ödeme durumu.
    payments: {
      pendingPayments: payments.pendingPayments,
      pendingRefunds: payments.pendingRefunds,
      deposit: payments.deposit,
    },
  };
}

/**
 * Folyoların onay bekleyen ödeme iptali sayısı.
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string[]} folioIds
 * @returns {Promise<Map<string, number>>}
 */
async function pendingPaymentVoids(client, hotelId, folioIds) {
  if (folioIds.length === 0) return new Map();
  const rows = await client.payment.groupBy({
    by: ['folioId'],
    where: { hotelId, folioId: { in: folioIds }, voidRequestedAt: { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.folioId, row._count._all]));
}

/**
 * Folyoların onay bekleyen ödeme / iade sayısı (kapatmayı engeller).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string[]} folioIds
 * @returns {Promise<Map<string, number>>}
 */
async function pendingPaymentCounts(client, hotelId, folioIds) {
  if (folioIds.length === 0) return new Map();
  const rows = await client.payment.groupBy({
    by: ['folioId'],
    where: { hotelId, folioId: { in: folioIds }, status: 'PENDING' },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.folioId, row._count._all]));
}

/**
 * İşlenmesi gereken ama işlenmemiş oda geceleri: içerideki misafirde dün
 * geceye kadar, çıkmış misafirde bütün geceler. "Eksik oda ücretlerini işle"
 * düğmesi ve aktör kapalıyken personelin görmesi için.
 *
 * @param {string} hotelId
 * @param {{ id: string, status: string }} stay
 * @param {string} businessDate
 */
async function pendingRoomCharges(hotelId, stay, businessDate) {
  const throughNight =
    stay.status === 'CHECKED_IN' ? toIsoDay(addDays(dayStart(businessDate), -1)) : stay.status === 'CHECKED_OUT' ? null : undefined;
  if (throughNight === undefined) return { throughNight: null, nights: 0, amount: '0.00' };
  const specs = await planStayRoomSpecs(prisma, hotelId, [stay.id], { throughNight });
  return {
    throughNight,
    nights: specs.length,
    amount: toMoneyString(specs.length ? specs.reduce((acc, spec) => acc.plus(spec.amount), toDecimal(0)) : '0'),
  };
}

/**
 * Folyo başlığı: toplamlar, vergi özeti, konaklama.
 * @param {string} hotelId
 * @param {string} folioId
 */
export async function getFolio(hotelId, folioId) {
  const folio = await findFolio(hotelId, folioId);
  const [stay, taxes, totals] = await Promise.all([
    prisma.reservation.findFirst({ where: { id: folio.reservationId, hotelId }, select: STAY_HEADER_SELECT }),
    prisma.$queryRaw`
      SELECT t->>'name' AS "name", t->>'rate' AS "rate", (t->>'included')::boolean AS "included",
             SUM((t->>'amount')::numeric)::text AS "amount"
      FROM "FolioItem" i
      CROSS JOIN LATERAL jsonb_array_elements(i."taxLines") t
      WHERE i."folioId" = ${folioId} AND i."deletedAt" IS NULL
      GROUP BY 1, 2, 3
      ORDER BY 1, 2`,
    prisma.$queryRaw`
      SELECT COALESCE(SUM(i."netAmount"), 0)::text AS "net",
             COALESCE(SUM(i."taxAmount"), 0)::text AS "tax",
             COUNT(*) FILTER (WHERE i."voidRequestedAt" IS NOT NULL)::int AS "pendingVoids"
      FROM "FolioItem" i
      WHERE i."folioId" = ${folioId} AND i."deletedAt" IS NULL`,
  ]);
  return {
    folio: toFolioDto(folio),
    stay: stay ? stayHeader(stay) : null,
    netTotal: money(totals[0]?.net ?? '0'),
    taxTotal: money(totals[0]?.tax ?? '0'),
    pendingVoids: totals[0]?.pendingVoids ?? 0,
    taxSummary: taxes
      .map((row) => ({ name: row.name, rate: row.rate, included: row.included, amount: money(row.amount) }))
      .filter((row) => !toDecimal(row.amount).isZero()),
  };
}

/**
 * Döküm imleci: hizmet günü + işlenme anı + kimlik. Bozuksa doğrulama hatası.
 * @param {string | undefined} raw
 * @returns {{ day: string, at: Date, id: string } | null}
 */
function parseItemCursor(raw) {
  if (!raw) return null;
  try {
    const { d, t, i } = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const at = new Date(t);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(at.getTime()) && /^[0-9a-f-]{36}$/i.test(i)) return { day: d, at, id: i };
  } catch {
    // aşağıda
  }
  throw new ValidationError('Sayfalama imleci geçersiz; listeyi yenileyin.', { field: 'cursor' });
}

/** @param {{ serviceDate: Date, postedAt: Date, id: string }} row */
const itemCursor = (row) =>
  Buffer.from(JSON.stringify({ d: toIsoDay(row.serviceDate), t: row.postedAt.toISOString(), i: row.id }), 'utf8').toString('base64url');

/**
 * Folyo dökümü: hizmet gününe göre (oda ücreti gecesinde, harcama işlendiği
 * günde), aynı gün içinde işlenme sırasıyla; imleçli ("daha fazla").
 * @param {string} hotelId
 * @param {string} folioId
 * @param {{ cursor?: string, limit: number, includeVoided: boolean }} query
 */
export async function listFolioItems(hotelId, folioId, query) {
  const folio = await prisma.folio.findFirst({ where: { id: folioId, hotelId }, select: { id: true, reservationId: true } });
  if (!folio) throw new NotFoundError('Folyo bulunamadı');
  const cursor = parseItemCursor(query.cursor);
  const day = cursor ? dayStart(cursor.day) : null;
  const rows = await prisma.folioItem.findMany({
    where: {
      folioId,
      hotelId,
      ...(query.includeVoided ? {} : { voidedAt: null, source: { not: 'REVERSAL' } }),
      // Baştaki `>=` index taramasını imleçten başlatır (bkz. lib/cursor.js).
      ...(cursor
        ? {
            serviceDate: { gte: day },
            OR: [
              { serviceDate: { gt: day } },
              { serviceDate: day, postedAt: { gt: cursor.at } },
              { serviceDate: day, postedAt: cursor.at, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    select: ITEM_SELECT,
    orderBy: [{ serviceDate: 'asc' }, { postedAt: 'asc' }, { id: 'asc' }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => toItemDto(row, folio.reservationId)),
    nextCursor: rows.length > query.limit && last ? itemCursor(last) : null,
  };
}

/**
 * Folyo listesi (görünüm + arama, sayfalı; sayım 2000'de kesilir).
 * @param {string} hotelId
 * @param {{ view: string, search?: string, page: number, pageSize: number }} query
 */
export async function listFolios(hotelId, query) {
  const and = [];
  switch (query.view) {
    case 'IN_HOUSE':
      and.push({ status: 'OPEN', reservation: { status: 'CHECKED_IN' } });
      break;
    case 'OPEN_BALANCE':
      and.push({ status: 'OPEN', NOT: { balance: 0 }, reservation: { status: { not: 'CHECKED_IN' } } });
      break;
    case 'CLOSED':
      and.push({ status: 'CLOSED' });
      break;
    default:
      and.push({ status: 'OPEN' });
  }
  for (const token of searchTokens(query.search)) {
    const [guestIds, codeIds, roomIds] = await Promise.all([
      isFuzzyToken(token) ? matchGuestIds(prisma, hotelId, token) : Promise.resolve([]),
      isFuzzyToken(token) ? matchReservationIdsByCode(prisma, hotelId, token) : Promise.resolve([]),
      matchRoomIdsByNumber(prisma, hotelId, token),
    ]);
    const or = [];
    if (guestIds.length) or.push({ reservation: { guestId: { in: guestIds } } });
    if (codeIds.length) or.push({ reservationId: { in: codeIds } });
    if (roomIds.length) or.push({ reservation: { roomId: { in: roomIds } } });
    if (isFuzzyToken(token)) or.push({ payerName: containsText(token) });
    and.push(or.length ? { OR: or } : MATCH_NOTHING);
  }
  const where = { hotelId, AND: and };
  const orderBy =
    query.view === 'IN_HOUSE'
      ? [{ reservation: { room: { number: 'asc' } } }, { window: 'asc' }, { id: 'asc' }]
      : query.view === 'CLOSED'
        ? [{ closedAt: 'desc' }, { id: 'desc' }]
        : [{ updatedAt: 'desc' }, { id: 'desc' }];

  const [rows, counted] = await Promise.all([
    prisma.folio.findMany({
      where,
      orderBy,
      ...toSkipTake(query),
      select: { ...FOLIO_SELECT, reservation: { select: STAY_HEADER_SELECT } },
    }),
    prisma.folio.count({ where, take: RESERVATION_COUNT_CAP + 1 }),
  ]);
  const totalCapped = counted > RESERVATION_COUNT_CAP;
  const page = buildPage(
    rows.map((row) => ({ ...toFolioDto(row), stay: stayHeader(row.reservation) })),
    totalCapped ? RESERVATION_COUNT_CAP : counted,
    query,
  );
  return { ...page, meta: { ...page.meta, totalCapped } };
}

/**
 * Harcama formunun önizlemesi: vergi dökümü ve toplam (sunucunun hesabı).
 * @param {string} hotelId
 * @param {{ type: string, discountCategory?: string | null, amount: string, quantity: number }} input
 */
export async function previewCharge(hotelId, input) {
  const taxes = await getActiveTaxes(hotelId);
  const amount = input.type === 'DISCOUNT' ? toMoneyString(toDecimal(input.amount).negated()) : input.amount;
  return chargeLine({ amount, quantity: input.quantity, taxCategory: folioTaxCategory(input.type, input.discountCategory), taxes });
}

/**
 * Gece oda ücreti çalışmasının durumu: son işlenen gece, bu gece için
 * çalışma bekleniyor mu, eksik gecesi olan içerideki misafir sayısı.
 * @param {string} hotelId
 */
export async function getRoomChargeStatus(hotelId) {
  const [businessDate, hotel] = await Promise.all([businessDay(hotelId), getHotelSettings(hotelId)]);
  const dueNight = toIsoDay(addDays(dayStart(businessDate), -1));
  const [lastRun, dueRun, missing] = await Promise.all([
    prisma.roomChargeRun.findFirst({ where: { hotelId, completedAt: { not: null } }, orderBy: { night: 'desc' } }),
    prisma.roomChargeRun.findFirst({ where: { hotelId, night: dayStart(dueNight) } }),
    prisma.$queryRaw`
      SELECT COUNT(DISTINCT n."reservationId")::int AS "stays", COUNT(*)::int AS "nights"
      FROM "ReservationNight" n
      JOIN "Reservation" r ON r."id" = n."reservationId"
      WHERE r."hotelId" = ${hotelId} AND r."status" = 'CHECKED_IN' AND r."deletedAt" IS NULL
        AND n."deletedAt" IS NULL AND n."amount" > 0 AND n."date" <= ${sqlTimestamp(dayStart(dueNight))}
        AND NOT EXISTS (
          SELECT 1 FROM "FolioItem" i
          WHERE i."reservationId" = n."reservationId" AND i."source" = 'ROOM_NIGHT' AND i."serviceDate" = n."date"::date
        )`,
  ]);
  const runDto = (run) =>
    run
      ? {
          night: toIsoDay(run.night),
          dueAt: iso(run.dueAt),
          completedAt: iso(run.completedAt),
          completedBy: run.completedBy ?? null,
          stays: run.stays ?? 0,
          items: run.items ?? 0,
          total: money(run.total ?? '0'),
        }
      : null;
  return {
    businessDate,
    dueNight,
    currency: hotel.currency,
    lastRun: runDto(lastRun),
    dueRun: runDto(dueRun),
    missingStays: missing[0]?.stays ?? 0,
    missingNights: missing[0]?.nights ?? 0,
  };
}

/* ══════════════════ Personel: harcama, iptal ══════════════════ */

/**
 * Elle harcama / indirim. Aynı istek kimliğiyle ikinci gönderim ikinci kalem
 * açmaz (`created: false`). İndirim folyodaki harcamalardan büyük olamaz.
 *
 * @param {string} hotelId
 * @param {string} folioId
 * @param {{ requestId: string, type: string, discountCategory?: string | null, description: string, amount: string, quantity: number }} input
 * @returns {Promise<{ item: object, created: boolean }>}
 */
export async function postCharge(hotelId, folioId, input) {
  const [taxes, serviceDate] = await Promise.all([getActiveTaxes(hotelId), businessDay(hotelId)]);
  const sourceKey = `manual:${input.requestId}`;
  const discount = input.type === 'DISCOUNT';
  try {
    const outcome = await writeWithEvents(async (tx, stage) => {
      if (!(await lockFolios(tx, hotelId, [folioId])).has(folioId)) throw new NotFoundError('Folyo bulunamadı');
      const existing = await tx.folioItem.findFirst({ where: { hotelId, sourceKey }, select: { id: true, folioId: true } });
      if (existing) return { itemId: existing.id, folioId: existing.folioId, created: false };

      const folio = await findFolio(hotelId, folioId, tx);
      assertFolio(folio, 'post');
      const amount = discount ? toMoneyString(toDecimal(input.amount).negated()) : input.amount;
      const line = chargeLine({
        amount,
        quantity: input.quantity,
        taxCategory: folioTaxCategory(input.type, input.discountCategory),
        taxes,
      });
      if (discount && toDecimal(line.total).abs().greaterThan(toDecimal(money(folio.chargesTotal)))) {
        throw new ValidationError(
          `İndirim folyodaki harcamalardan (${money(folio.chargesTotal)} ${folio.currency}) büyük olamaz; fazlası iade ödemesidir.`,
          { field: 'amount' },
        );
      }

      const item = await tx.folioItem.create({
        data: {
          hotelId,
          folioId,
          reservationId: folio.reservationId,
          type: input.type,
          source: 'MANUAL',
          description: input.description,
          amount: line.amount,
          quantity: line.quantity,
          taxCategory: folioTaxCategory(input.type, input.discountCategory),
          netAmount: line.netAmount,
          taxAmount: line.taxAmount,
          total: line.total,
          taxLines: line.taxLines,
          serviceDate: dayStart(serviceDate),
          sourceKey,
          postedBy: currentActor(),
        },
        select: { id: true, folioId: true, type: true, source: true, description: true, amount: true, quantity: true, total: true, serviceDate: true },
      });
      await refreshFolioTotals(tx, [folioId]);
      await recordAudit(tx, { hotelId, entity: 'FolioItem', entityId: item.id, action: 'CREATE', after: itemAudit(item) });
      await stage('folio.charge.posted', {
        hotelId,
        folioId,
        reservationId: folio.reservationId,
        itemIds: [item.id],
        source: 'MANUAL',
        total: line.total,
      });
      return { itemId: item.id, folioId, created: true };
    });
    return { item: await readItem(hotelId, outcome.itemId), created: outcome.created };
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/** @param {string} hotelId @param {string} itemId */
async function readItem(hotelId, itemId) {
  const row = await prisma.folioItem.findFirst({ where: { id: itemId, hotelId }, select: { ...ITEM_SELECT, folio: { select: { reservationId: true } } } });
  if (!row) throw new NotFoundError('Kalem bulunamadı');
  return toItemDto(row, row.folio.reservationId);
}

/**
 * Kalem iptali isteği: onay kuyruğuna gider (ikinci bir yetkili karar verir;
 * isteyen kendi isteğini onaylayamaz). Onaylanınca ters kayıt işlenir
 * (`applyVoidDecision`).
 *
 * @param {string} hotelId
 * @param {string} folioId
 * @param {string} itemId
 * @param {{ reason: string }} input
 * @returns {Promise<{ approvalId: string }>}
 */
export async function requestVoid(hotelId, folioId, itemId, { reason }) {
  const actor = currentActor();
  try {
    return await writeWithEvents(async (tx, stage) => {
      if (!(await lockFolios(tx, hotelId, [folioId])).has(folioId)) throw new NotFoundError('Folyo bulunamadı');
      const folio = await findFolio(hotelId, folioId, tx);
      assertFolio(folio, 'post');
      const item = await tx.folioItem.findFirst({
        where: { id: itemId, folioId, hotelId },
        select: {
          id: true,
          folioId: true,
          type: true,
          source: true,
          description: true,
          amount: true,
          quantity: true,
          total: true,
          serviceDate: true,
          voidedAt: true,
          voidRequestedAt: true,
          reservation: { select: { confirmationCode: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } } },
        },
      });
      if (!item) throw new NotFoundError('Kalem bu folyoda bulunamadı; ekranı yenileyin.');
      const blocked = folioItemActionError({ ...item, voidPending: Boolean(item.voidRequestedAt) }, 'void');
      if (blocked) throw new ConflictError(blocked, 'ITEM_RULE');

      const where = `${item.reservation.room?.number ?? '—'} · ${guestFullName(item.reservation.guest)}`;
      const { approvalId } = await requestApproval(tx, stage, {
        hotelId,
        type: 'FOLIO_VOID',
        summary: `Folyo kalemi iptali: ${where} — ${item.description}`.slice(0, 200),
        reason,
        amount: toMoneyString(toDecimal(money(item.total)).abs()),
        currency: folio.currency,
        // Onay ekranı veriyi yorumlamadan gösterir: onaylayanın okuyacağı etiketlerle.
        // Kalemin kimliği `entityId`'de (karar dinleyicisi oradan okur).
        data: {
          Konaklama: `${item.reservation.confirmationCode} · oda ${item.reservation.room?.number ?? '—'} · ${guestFullName(item.reservation.guest)}`,
          Folyo: folioDisplayName(folio),
          Kalem: item.description,
          Tür: `${FOLIO_ITEM_TYPE_LABELS[item.type] ?? item.type} · ${FOLIO_ITEM_SOURCE_LABELS[item.source] ?? item.source}`,
          'Adet × birim': `${item.quantity} × ${money(item.amount)} ${folio.currency}`,
          Toplam: `${money(item.total)} ${folio.currency}`,
          'Hizmet günü': dotted(item.serviceDate),
        },
        entityType: 'FolioItem',
        entityId: item.id,
        requestedBy: actor,
      });
      await tx.folioItem.update({
        where: { id: item.id },
        data: { voidApprovalId: approvalId, voidRequestedAt: new Date(), voidRequestedBy: actor, voidReason: reason },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'FolioItem',
        entityId: item.id,
        action: 'UPDATE',
        before: { voidPending: false },
        after: { voidPending: true, approvalId, reason },
      });
      await stage('folio.item.void_requested', { hotelId, folioId, reservationId: folio.reservationId, itemId: item.id, approvalId });
      return { approvalId };
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Kalem iptali onayının sonucu (onay kuyruğunun olayı): onaylandıysa ters
 * kayıt işlenir; reddedildi ya da süresi dolduysa kalem olduğu gibi kalır.
 * İsteyenin ziline sonuç düşer. Aynı haber iki kez gelse de bir kez uygulanır
 * (kalemdeki bekleyen onay kimliği eşleşmezse dokunulmaz).
 *
 * @param {{ hotelId: string, approvalId: string, type: string, decidedBy?: string }} payload
 * @param {{ name: string }} envelope
 * @returns {Promise<{ handled: boolean, applied?: boolean }>}
 */
export async function applyVoidDecision(payload, envelope) {
  if (payload.type !== 'FOLIO_VOID') return { handled: false };
  const approval = await prismaUnfiltered.approval.findFirst({
    where: { id: payload.approvalId, hotelId: payload.hotelId },
    select: { id: true, entityId: true, requestedBy: true, decidedBy: true, note: true, status: true, summary: true },
  });
  if (!approval?.entityId) return { handled: false };
  const hotelId = payload.hotelId;
  const granted = envelope.name === 'approval.granted';
  const serviceDate = await businessDay(hotelId);

  const outcome = await writeWithEvents(async (tx, stage) => {
    const item = await tx.folioItem.findFirst({
      where: { id: approval.entityId, hotelId },
      select: { id: true, folioId: true, voidApprovalId: true, voidRequestedAt: true, voidReason: true, folio: { select: { reservationId: true, status: true } } },
    });
    if (!item || item.voidApprovalId !== approval.id || !item.voidRequestedAt) return { applied: false, stale: true };

    if (granted) {
      await lockFolios(tx, hotelId, [item.folioId]);
      const folio = await tx.folio.findFirst({ where: { id: item.folioId, hotelId }, select: { status: true, reservationId: true } });
      if (folio?.status === 'OPEN') {
        await reverseItems(tx, stage, { hotelId, itemIds: [item.id], reason: item.voidReason ?? 'Onaylı iptal', serviceDate, approvalId: approval.id });
        await recordAudit(tx, {
          hotelId,
          entity: 'FolioItem',
          entityId: item.id,
          action: 'UPDATE',
          before: { voided: false },
          after: { voided: true, approvalId: approval.id, decidedBy: approval.decidedBy },
        });
        return { applied: true };
      }
      // Kapanmış folyoya ters kayıt düşmez (kapatma bekleyen iptal varken engelli; buraya yalnızca yarışla gelinir).
      await clearVoidRequest(tx, hotelId, item.id);
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'FOLIO_ATTENTION',
        severity: 'WARNING',
        permission: PERMISSIONS.FOLIO_ADJUST,
        title: 'Onaylanan kalem iptali uygulanamadı',
        body: `${approval.summary}: folyo kapalı. Folyoyu yeniden açıp iptali tekrar isteyin.`,
        link: `/folyolar/${item.folio.reservationId}?folyo=${item.folioId}`,
        entityType: 'FolioItem',
        entityId: item.id,
      });
      return { applied: false, closed: true };
    }

    await clearVoidRequest(tx, hotelId, item.id);
    const outcomeName = envelope.name === 'approval.denied' ? 'DENIED' : 'EXPIRED';
    await recordAudit(tx, {
      hotelId,
      entity: 'FolioItem',
      entityId: item.id,
      action: 'UPDATE',
      before: { voidPending: true },
      after: { voidPending: false, outcome: outcomeName, approvalId: approval.id },
    });
    await stage('folio.item.void_declined', {
      hotelId,
      folioId: item.folioId,
      reservationId: item.folio.reservationId,
      itemId: item.id,
      approvalId: approval.id,
      outcome: outcomeName,
    });
    return { applied: false };
  });

  if (!outcome.stale) await alertVoidRequester(hotelId, approval, granted ? (outcome.applied ? 'GRANTED' : 'FAILED') : envelope.name);
  return { handled: true, applied: Boolean(outcome.applied) };
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} itemId
 */
function clearVoidRequest(tx, hotelId, itemId) {
  return tx.folioItem.updateMany({ where: { id: itemId, hotelId }, data: { voidRequestedAt: null, voidRequestedBy: null, voidReason: null } });
}

/**
 * İptali isteyen personelin ziline sonuç (kişi bulunamazsa folyo yetkilisine).
 * @param {string} hotelId
 * @param {{ id: string, requestedBy: string, note: string | null, summary: string }} approval
 * @param {string} outcome
 */
async function alertVoidRequester(hotelId, approval, outcome) {
  const staff = approval.requestedBy?.includes('@')
    ? await findActiveStaffByEmail(prismaUnfiltered, hotelId, approval.requestedBy.toLowerCase())
    : null;
  const titles = {
    GRANTED: `Kalem iptali onaylandı: ${approval.summary}`,
    FAILED: `Kalem iptali onaylandı ama uygulanamadı: ${approval.summary}`,
    'approval.denied': `Kalem iptali reddedildi: ${approval.summary}`,
    'approval.expired': `Kalem iptali onayının süresi doldu: ${approval.summary}`,
  };
  await writeWithEvents((tx, stage) =>
    raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'APPROVAL_DECIDED',
      severity: outcome === 'GRANTED' ? 'INFO' : 'WARNING',
      title: titles[outcome] ?? approval.summary,
      body: outcome === 'approval.denied' ? `Gerekçe: ${approval.note ?? '—'}` : null,
      link: `/onaylar/gecmis?onay=${approval.id}`,
      userId: staff?.id ?? null,
      permission: staff ? null : PERMISSIONS.FOLIO_POST,
      entityType: 'Approval',
      entityId: approval.id,
      dedupeKey: `approval-decided:${approval.id}`,
    }),
  );
}

/* ══════════════════ Personel: aktarma, bölme, birleştirme ══════════════════ */

/**
 * Seçilen kalemleri başka bir açık folyoya aktarır (aynı konaklamanın diğer
 * penceresi ya da başka konaklamanın folyosu). İptal edilmiş, ters kayıt ve
 * iptal onayı bekleyen kalem taşınmaz.
 *
 * @param {string} hotelId
 * @param {string} folioId
 * @param {{ itemIds: string[], targetFolioId: string }} input
 */
export async function transferItems(hotelId, folioId, { itemIds, targetFolioId }) {
  if (targetFolioId === folioId) throw new ValidationError('Kaynak ve hedef folyo aynı', { field: 'targetFolioId' });
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const locked = await lockFolios(tx, hotelId, [folioId, targetFolioId]);
      if (!locked.has(folioId)) throw new NotFoundError('Folyo bulunamadı');
      if (!locked.has(targetFolioId)) throw new NotFoundError('Hedef folyo bulunamadı');
      const [source, target] = await Promise.all([findFolio(hotelId, folioId, tx), findFolio(hotelId, targetFolioId, tx)]);
      assertFolio(source, 'transfer');
      assertFolio(target, 'post');
      if (source.currency !== target.currency) throw new ConflictError('Folyoların para birimi farklı; aktarılamaz.', 'CURRENCY_MISMATCH');

      await moveItems(tx, { hotelId, source, itemIds, targetId: targetFolioId, actor });
      await refreshFolioTotals(tx, [folioId, targetFolioId]);
      await recordAudit(tx, {
        hotelId,
        entity: 'Folio',
        entityId: folioId,
        action: 'UPDATE',
        before: { itemIds, folioId },
        after: { itemIds, folioId: targetFolioId, target: folioDisplayName(target), targetReservationId: target.reservationId },
      });
      await stage('folio.items.transferred', {
        hotelId,
        fromFolioId: folioId,
        toFolioId: targetFolioId,
        reservationIds: [...new Set([source.reservationId, target.reservationId])],
        itemIds,
      });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getFolio(hotelId, folioId);
}

/**
 * Kalemleri kaynaktan hedefe taşır (kilitler çağıranda). Hepsi kaynakta olmalı
 * ve taşınabilir olmalı.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ hotelId: string, source: { id: string }, itemIds: string[], targetId: string, actor: string }} input
 */
async function moveItems(tx, { hotelId, source, itemIds, targetId, actor }) {
  if (itemIds.length === 0) return;
  const items = await tx.folioItem.findMany({
    where: { id: { in: itemIds }, folioId: source.id, hotelId },
    select: { id: true, source: true, voidedAt: true, voidRequestedAt: true, description: true },
  });
  if (items.length !== itemIds.length) {
    throw new ConflictError('Seçilen kalemlerden bazıları artık bu folyoda değil; ekranı yenileyip tekrar seçin.', 'ITEMS_CHANGED');
  }
  for (const item of items) {
    const blocked = folioItemActionError({ ...item, voidPending: Boolean(item.voidRequestedAt) }, 'transfer');
    if (blocked) throw new ConflictError(`${item.description}: ${blocked}`, 'ITEM_RULE');
  }
  await tx.folioItem.updateMany({
    where: { id: { in: itemIds }, folioId: source.id, hotelId },
    data: { folioId: targetId, transferredFromFolioId: source.id, transferredAt: new Date(), transferredBy: actor },
  });
}

/**
 * Böl: aynı konaklamada yeni folyo (pencere) açar, seçilen kalemleri ona
 * taşır; istenirse sonraki sistem kalemlerini (ör. oda ücreti) yeni folyoya
 * yönlendirir.
 *
 * @param {string} hotelId
 * @param {string} folioId
 * @param {{ itemIds: string[], payerName: string | null, routeTypes: string[] }} input
 * @returns {Promise<{ folioId: string }>}
 */
export async function splitFolio(hotelId, folioId, { itemIds, payerName, routeTypes }) {
  const actor = currentActor();
  const seed = await prisma.folio.findFirst({ where: { id: folioId, hotelId }, select: { reservationId: true } });
  if (!seed) throw new NotFoundError('Folyo bulunamadı');
  try {
    const created = await writeWithEvents(async (tx, stage) => {
      await lockReservations(tx, hotelId, [seed.reservationId]);
      await lockFolios(tx, hotelId, [folioId]);
      const source = await findFolio(hotelId, folioId, tx);
      assertFolio(source, 'split');
      const stay = await readStayForPosting(tx, hotelId, source.reservationId);
      const windows = (await tx.folio.findMany({ where: { hotelId, reservationId: stay.id }, select: { window: true } })).map((row) => row.window);
      if (windows.length >= FOLIO_MAX_WINDOWS) {
        throw new ConflictError(`Bir konaklamanın en fazla ${FOLIO_MAX_WINDOWS} folyosu olabilir.`, 'FOLIO_LIMIT');
      }
      const folio = await createStayFolio(tx, stage, { hotelId, stay: { ...stay, currency: source.currency }, windows, payerName });
      await moveItems(tx, { hotelId, source, itemIds, targetId: folio.id, actor });
      for (const type of routeTypes) {
        await tx.folioRoute.upsert({
          where: { reservationId_type: { reservationId: stay.id, type } },
          create: { hotelId, reservationId: stay.id, type, folioId: folio.id, createdBy: actor },
          update: { folioId: folio.id, createdBy: actor },
        });
      }
      await refreshFolioTotals(tx, [folioId, folio.id]);
      await recordAudit(tx, {
        hotelId,
        entity: 'Folio',
        entityId: folio.id,
        action: 'CREATE',
        after: { window: folio.window, payerName, splitFrom: folioId, itemIds, routeTypes },
      });
      await stage('folio.split', { hotelId, folioId, reservationId: stay.id, newFolioId: folio.id, itemIds });
      if (routeTypes.length) await stage('folio.routes.changed', { hotelId, reservationId: stay.id });
      return folio.id;
    });
    return { folioId: created };
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Birleştir (grup hesabı): kaynak folyoların bütün kalem ve ödemeleri bu
 * folyoya taşınır, kaynaklar "birleştirildi" olur. Kaynağın konaklamasında o
 * folyoya düşen sistem kalemleri (oda ücreti vb.) bundan sonra buraya düşer.
 *
 * @param {string} hotelId
 * @param {string} targetId
 * @param {{ sourceFolioIds: string[] }} input
 */
export async function mergeFolios(hotelId, targetId, { sourceFolioIds }) {
  if (sourceFolioIds.includes(targetId)) throw new ValidationError('Folyo kendisiyle birleştirilemez', { field: 'sourceFolioIds' });
  const actor = currentActor();
  const all = [targetId, ...sourceFolioIds];
  try {
    await writeWithEvents(async (tx, stage) => {
      const locked = await lockFolios(tx, hotelId, all);
      if (all.some((id) => !locked.has(id))) throw new NotFoundError('Folyolardan biri bulunamadı; listeyi yenileyin.');
      const folios = await tx.folio.findMany({ where: { id: { in: all }, hotelId }, select: FOLIO_SELECT });
      const target = folios.find((folio) => folio.id === targetId);
      const sources = folios.filter((folio) => folio.id !== targetId);
      assertFolio(target, 'post');
      for (const source of sources) {
        const blocked = folioActionError(source, 'merge');
        if (blocked) throw new ConflictError(`${folioDisplayName(source)}: ${blocked}`, 'FOLIO_NOT_OPEN');
        if (source.currency !== target.currency) throw new ConflictError('Folyoların para birimi farklı; birleştirilemez.', 'CURRENCY_MISMATCH');
      }

      // Kaynak konaklamalarda, birleşen folyoya düşen tipler hedefe yönlenir
      // (diğer pencerelere düşenler olduğu gibi kalır).
      const otherStays = [...new Set(sources.map((folio) => folio.reservationId))].filter((id) => id !== target.reservationId);
      const state = await loadStayFolioState(tx, hotelId, otherStays);
      const sourceIds = new Set(sourceFolioIds);
      const now = new Date();

      await tx.$executeRaw`
        UPDATE "FolioItem"
        SET "transferredFromFolioId" = "folioId", "folioId" = ${targetId}, "transferredAt" = ${SQL_NOW},
            "transferredBy" = ${actor}, "updatedAt" = ${SQL_NOW}
        WHERE "folioId" = ANY(${sourceFolioIds}::text[]) AND "hotelId" = ${hotelId}`;
      await tx.payment.updateMany({ where: { folioId: { in: sourceFolioIds }, hotelId }, data: { folioId: targetId } });
      await tx.folioRoute.updateMany({ where: { folioId: { in: sourceFolioIds }, hotelId }, data: { folioId: targetId } });
      for (const reservationId of otherStays) {
        const entry = state.get(reservationId);
        for (const type of FOLIO_ROUTABLE_TYPES) {
          const resolved = resolvePostingFolio({ type, routes: entry.routes, stayFolios: entry.folios });
          if (!resolved || !sourceIds.has(resolved.folioId)) continue;
          await tx.folioRoute.upsert({
            where: { reservationId_type: { reservationId, type } },
            create: { hotelId, reservationId, type, folioId: targetId, createdBy: actor },
            update: { folioId: targetId, createdBy: actor },
          });
        }
      }
      await tx.folio.updateMany({
        where: { id: { in: sourceFolioIds }, hotelId },
        data: { status: 'TRANSFERRED', mergedIntoId: targetId, mergedAt: now, mergedBy: actor },
      });
      await refreshFolioTotals(tx, all);

      for (const source of sources) {
        await recordAudit(tx, {
          hotelId,
          entity: 'Folio',
          entityId: source.id,
          action: 'UPDATE',
          before: folioAudit(source),
          after: { ...folioAudit(source), status: 'TRANSFERRED', mergedIntoId: targetId, balance: '0.00' },
        });
      }
      const reservationIds = [...new Set(sources.map((folio) => folio.reservationId))];
      await stage('folio.merged', { hotelId, folioId: targetId, reservationId: target.reservationId, sourceFolioIds, reservationIds });
      for (const reservationId of otherStays) await stage('folio.routes.changed', { hotelId, reservationId });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getFolio(hotelId, targetId);
}

/**
 * Konaklamanın yönlendirmesi: tip → folyo (`null` kaldırır). Hedef açık
 * olmalı; başka konaklamanın folyosu da olabilir (grup hesabı).
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ routes: Array<{ type: string, folioId: string | null }> }} input
 */
export async function setRoutes(hotelId, reservationId, { routes }) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Konaklama bulunamadı');
      const stay = await readStayForPosting(tx, hotelId, reservationId);
      const targetIds = [...new Set(routes.map((route) => route.folioId).filter(Boolean))];
      const targets = await tx.folio.findMany({ where: { id: { in: targetIds }, hotelId }, select: { id: true, status: true, currency: true, window: true, payerName: true } });
      const byId = new Map(targets.map((folio) => [folio.id, folio]));
      for (const id of targetIds) {
        const folio = byId.get(id);
        if (!folio) throw new NotFoundError('Yönlendirilen folyo bulunamadı');
        if (folio.status !== 'OPEN') throw new ConflictError(`${folioDisplayName(folio)} açık değil; kapalı folyoya yönlendirilemez.`, 'FOLIO_NOT_OPEN');
        if (folio.currency !== stay.currency) throw new ConflictError('Para birimi farklı folyoya yönlendirilemez.', 'CURRENCY_MISMATCH');
      }
      const before = await tx.folioRoute.findMany({ where: { hotelId, reservationId }, select: { type: true, folioId: true } });
      for (const route of routes) {
        if (!route.folioId) {
          await tx.folioRoute.deleteMany({ where: { hotelId, reservationId, type: route.type } });
          continue;
        }
        await tx.folioRoute.upsert({
          where: { reservationId_type: { reservationId, type: route.type } },
          create: { hotelId, reservationId, type: route.type, folioId: route.folioId, createdBy: actor },
          update: { folioId: route.folioId, createdBy: actor },
        });
      }
      await recordAudit(tx, {
        hotelId,
        entity: 'Reservation',
        entityId: reservationId,
        action: 'UPDATE',
        before: { folioRoutes: before },
        after: { folioRoutes: routes },
      });
      await stage('folio.routes.changed', { hotelId, reservationId });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getStayFolios(hotelId, reservationId);
}

/* ══════════════════ Personel: aç, kapat, yeniden aç ══════════════════ */

/**
 * Konaklamaya folyo aç (hiç açık folyosu yoksa: gelmeden önce depozito için,
 * aktör kapalıyken girişte). Açık folyosu varsa yeni pencere bölmeyle açılır.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ payerName?: string | null }} input
 */
export async function openFolio(hotelId, reservationId, { payerName = null }) {
  try {
    await writeWithEvents(async (tx, stage) => {
      if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Konaklama bulunamadı');
      const stay = await readStayForPosting(tx, hotelId, reservationId);
      const folios = await tx.folio.findMany({ where: { hotelId, reservationId }, select: { window: true, status: true } });
      if (folios.some((folio) => folio.status === 'OPEN')) {
        throw new ConflictError('Konaklamanın açık folyosu var; yeni folyo için bölmeyi kullanın.', 'FOLIO_EXISTS');
      }
      if (folios.length >= FOLIO_MAX_WINDOWS) throw new ConflictError(`Bir konaklamanın en fazla ${FOLIO_MAX_WINDOWS} folyosu olabilir.`, 'FOLIO_LIMIT');
      const folio = await createStayFolio(tx, stage, { hotelId, stay, windows: folios.map((row) => row.window), payerName });
      await recordAudit(tx, { hotelId, entity: 'Folio', entityId: folio.id, action: 'CREATE', after: { window: folio.window, payerName } });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getStayFolios(hotelId, reservationId);
}

/**
 * Ödeyen adını düzelt.
 * @param {string} hotelId
 * @param {string} folioId
 * @param {{ payerName: string | null }} input
 */
export async function updateFolio(hotelId, folioId, { payerName }) {
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockFolios(tx, hotelId, [folioId])).has(folioId)) throw new NotFoundError('Folyo bulunamadı');
    const folio = await findFolio(hotelId, folioId, tx);
    if (folio.status === 'TRANSFERRED') throw new ConflictError('Birleştirilmiş folyo düzenlenemez.', 'FOLIO_NOT_OPEN');
    await tx.folio.update({ where: { id: folioId }, data: { payerName } });
    await recordAudit(tx, { hotelId, entity: 'Folio', entityId: folioId, action: 'UPDATE', before: folioAudit(folio), after: { ...folioAudit(folio), payerName } });
    await stage('folio.updated', { hotelId, folioId, reservationId: folio.reservationId });
  });
  return getFolio(hotelId, folioId);
}

/**
 * Folyoyu kapat (bakiye sıfır, bekleyen iptal yok, içerideki misafirin son açık
 * folyosu değil). Bu folyoya yönlenen tipler serbest kalır (konaklamalarının
 * ilk açık folyosuna düşer).
 *
 * @param {string} hotelId
 * @param {string} folioId
 */
export async function closeFolio(hotelId, folioId) {
  const seed = await prisma.folio.findFirst({ where: { id: folioId, hotelId }, select: { reservationId: true } });
  if (!seed) throw new NotFoundError('Folyo bulunamadı');
  await writeWithEvents(async (tx, stage) => {
    await lockReservations(tx, hotelId, [seed.reservationId]);
    await lockFolios(tx, hotelId, [folioId]);
    await closeLocked(tx, stage, { hotelId, folioId, actorLabel: currentActor() });
  });
  return getFolio(hotelId, folioId);
}

/**
 * Kilitli folyoyu kapatır (kurallar denetlenir).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{ hotelId: string, folioId: string, actorLabel: string }} input
 */
async function closeLocked(tx, stage, { hotelId, folioId, actorLabel }) {
  const totals = (await refreshFolioTotals(tx, [folioId])).get(folioId);
  const folio = await findFolio(hotelId, folioId, tx);
  const [stay, openSiblings, pendingVoids, paymentVoids, pendingPayments] = await Promise.all([
    tx.reservation.findFirst({ where: { id: folio.reservationId, hotelId }, select: { status: true } }),
    tx.folio.count({ where: { hotelId, reservationId: folio.reservationId, status: 'OPEN', id: { not: folioId } } }),
    tx.folioItem.count({ where: { hotelId, folioId, voidRequestedAt: { not: null } } }),
    tx.payment.count({ where: { hotelId, folioId, voidRequestedAt: { not: null } } }),
    tx.payment.count({ where: { hotelId, folioId, status: 'PENDING' } }),
  ]);
  assertFolio(folio, 'close', {
    balanceZero: balanceIsZero(totals?.balance ?? money(folio.balance)),
    pendingVoids: pendingVoids + paymentVoids,
    pendingPayments,
    lastOpenOfInHouseStay: stay?.status === 'CHECKED_IN' && openSiblings === 0,
  });
  const routed = await tx.folioRoute.findMany({ where: { hotelId, folioId }, select: { reservationId: true } });
  await tx.folioRoute.deleteMany({ where: { hotelId, folioId } });
  await tx.folio.update({ where: { id: folioId }, data: { status: 'CLOSED', closedAt: new Date(), closedBy: actorLabel } });
  await recordAudit(tx, {
    hotelId,
    entity: 'Folio',
    entityId: folioId,
    action: 'UPDATE',
    before: folioAudit(folio),
    after: { ...folioAudit(folio), status: 'CLOSED' },
  });
  await stage('folio.closed', {
    hotelId,
    folioId,
    reservationId: folio.reservationId,
    chargesTotal: totals?.chargesTotal ?? money(folio.chargesTotal),
    currency: folio.currency,
  });
  for (const reservationId of new Set(routed.map((route) => route.reservationId))) {
    await stage('folio.routes.changed', { hotelId, reservationId });
  }
}

/** Konaklaması bitmiş sayılan durumlar: folyo ödemeyle sıfırlanınca kendiliğinden kapanır. */
const ENDED_STAY_STATUSES = Object.freeze(['CHECKED_OUT', 'CANCELLED', 'NO_SHOW']);

/**
 * Ödemeden sonra (folyo aktörü, modül 17): konaklaması bitmiş (çıkmış, iptal,
 * gelmedi) misafirin folyosu bakiyesi sıfırlandıysa kapanır (`folio.closed` →
 * fatura). Kapatma kuralları aynı (`closeLocked`): bekleyen iptal ya da onay
 * bekleyen ödeme varsa kapanmaz. İçerideki misafirin folyosuna dokunulmaz.
 *
 * @param {string} hotelId
 * @param {string} folioId
 * @returns {Promise<{ closed: boolean, reason?: string, balance?: string }>}
 */
export async function closeFolioIfSettled(hotelId, folioId) {
  const seed = await prisma.folio.findFirst({ where: { id: folioId, hotelId }, select: { reservationId: true } });
  if (!seed) return { closed: false, reason: 'Folyo bulunamadı' };
  return writeWithEvents(async (tx, stage) => {
    await lockReservations(tx, hotelId, [seed.reservationId]);
    await lockFolios(tx, hotelId, [folioId]);
    const folio = await findFolio(hotelId, folioId, tx);
    if (folio.status !== 'OPEN') return { closed: false, reason: 'Folyo açık değil' };
    const stay = await tx.reservation.findFirst({ where: { id: folio.reservationId, hotelId }, select: { status: true } });
    if (!ENDED_STAY_STATUSES.includes(stay?.status ?? '')) return { closed: false, reason: 'Konaklama sürüyor; folyo açık kalır' };
    const totals = (await refreshFolioTotals(tx, [folioId])).get(folioId);
    const balance = totals?.balance ?? money(folio.balance);
    if (!balanceIsZero(balance)) return { closed: false, reason: 'Bakiye sıfır değil', balance };
    const [itemVoids, paymentVoids, pendingPayments] = await Promise.all([
      tx.folioItem.count({ where: { hotelId, folioId, voidRequestedAt: { not: null } } }),
      tx.payment.count({ where: { hotelId, folioId, voidRequestedAt: { not: null } } }),
      tx.payment.count({ where: { hotelId, folioId, status: 'PENDING' } }),
    ]);
    if (itemVoids + paymentVoids + pendingPayments > 0) return { closed: false, reason: 'Folyoda onay bekleyen iş var' };
    await closeLocked(tx, stage, { hotelId, folioId, actorLabel: currentActor() });
    return { closed: true };
  });
}

/**
 * Kapanmış folyoyu yeniden aç (yetkiliyle, gerekçeli): geç gelen harcama,
 * yanlış kapanış. Fatura modülü (16) faturası kesilmiş folyoyu burada durduracak.
 *
 * @param {string} hotelId
 * @param {string} folioId
 * @param {{ reason: string }} input
 */
export async function reopenFolio(hotelId, folioId, { reason }) {
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockFolios(tx, hotelId, [folioId])).has(folioId)) throw new NotFoundError('Folyo bulunamadı');
    const folio = await findFolio(hotelId, folioId, tx);
    assertFolio(folio, 'reopen');
    await reopenLocked(tx, stage, { hotelId, folio, reason });
  });
  return getFolio(hotelId, folioId);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{ hotelId: string, folio: any, reason: string }} input
 */
async function reopenLocked(tx, stage, { hotelId, folio, reason }) {
  await tx.folio.update({ where: { id: folio.id }, data: { status: 'OPEN', closedAt: null, closedBy: null } });
  await recordAudit(tx, {
    hotelId,
    entity: 'Folio',
    entityId: folio.id,
    action: 'UPDATE',
    before: folioAudit(folio),
    after: { ...folioAudit(folio), status: 'OPEN', reason },
  });
  await stage('folio.reopened', { hotelId, folioId: folio.id, reservationId: folio.reservationId, reason });
}

/* ══════════════════ Oda ücretleri ══════════════════ */

/**
 * Konaklamanın eksik oda ücretlerini işler (personelin düğmesi; aktör kapalıyken
 * gece çalışmasının tek konaklamalık karşılığı). İçerideyse dün geceye kadar,
 * çıkmışsa bütün geceler.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 */
export async function postStayRoomCharges(hotelId, reservationId) {
  const [taxes, today] = await Promise.all([getActiveTaxes(hotelId), businessDay(hotelId)]);
  const result = await writeWithEvents(async (tx, stage) => {
    if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Konaklama bulunamadı');
    const stay = await readStayForPosting(tx, hotelId, reservationId);
    if (!['CHECKED_IN', 'CHECKED_OUT'].includes(stay.status)) {
      throw new ConflictError('Oda ücreti yalnızca girişi yapılmış konaklamaya işlenir.', 'INVALID_STATUS');
    }
    const throughNight = stay.status === 'CHECKED_IN' ? toIsoDay(addDays(dayStart(today), -1)) : null;
    return postRoomCharges(tx, stage, { hotelId, stays: [stay], throughNight, taxes });
  });
  return { items: result.items.length, total: linesTotal(result.items) };
}

/**
 * Gecenin oda ücretleri: içerideki bütün konaklamaların o geceye kadar (dahil)
 * eksik geceleri işlenir. Konaklamalar parça parça (ayrı transaction'larda)
 * işlenir; yarıda kesilen çalışma tekrarlanınca kalan yerden devam eder
 * (işlenmiş gece yeniden işlenmez). Sonunda çalışma kaydı tamamlanır ve tek
 * özet olay yayınlanır (2500 oda için 2500 socket haberi yerine).
 *
 * @param {string} hotelId
 * @param {{ night?: string }} [options] verilmezse dün gece (otelin iş gününe göre)
 */
export async function runRoomCharges(hotelId, { night } = {}) {
  const taxes = await getActiveTaxes(hotelId);
  const today = await businessDay(hotelId);
  const throughNight = night ?? toIsoDay(addDays(dayStart(today), -1));
  if (throughNight >= today) throw new ValidationError('Henüz bitmemiş gecenin oda ücreti işlenmez.', { field: 'night' });
  const nextDay = addDays(dayStart(throughNight), 1);
  const totals = { stays: 0, items: 0, total: toDecimal(0) };

  let cursor = null;
  for (;;) {
    const batch = await prisma.reservation.findMany({
      where: { hotelId, status: 'CHECKED_IN', checkIn: { lt: nextDay }, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: ROOM_CHARGE_CHUNK_SIZE,
    });
    if (batch.length === 0) break;
    cursor = batch.at(-1).id;
    const ids = batch.map((row) => row.id);
    const result = await writeWithEvents(async (tx, stage) => {
      await lockReservations(tx, hotelId, ids);
      const stays = await tx.reservation.findMany({
        where: { id: { in: ids }, hotelId, status: 'CHECKED_IN' },
        select: { id: true, guestId: true, currency: true },
      });
      return postRoomCharges(tx, stage, { hotelId, stays, throughNight, taxes, announce: false });
    });
    totals.stays += result.stays;
    totals.items += result.items.length;
    totals.total = totals.total.plus(linesTotal(result.items));
  }

  const actor = currentActor();
  const summary = { night: throughNight, stays: totals.stays, items: totals.items, total: toMoneyString(totals.total) };
  await writeWithEvents(async (tx, stage) => {
    const run = await tx.roomChargeRun.upsert({
      where: { hotelId_night: { hotelId, night: dayStart(throughNight) } },
      create: { hotelId, night: dayStart(throughNight), completedAt: new Date(), completedBy: actor, stays: totals.stays, items: totals.items, total: summary.total },
      update: { completedAt: new Date(), completedBy: actor, stays: totals.stays, items: totals.items, total: summary.total },
      select: { id: true },
    });
    await recordAudit(tx, { hotelId, entity: 'RoomChargeRun', entityId: run.id, action: 'UPDATE', after: summary });
    await stage('folio.room_charges.posted', { hotelId, ...summary });
  });
  return summary;
}

/**
 * Zamanlayıcı: her otelde gün dönünce (iş günü ilerleyince) dünün gecesi için
 * bir kez çalışma kaydı açar ve folyo aktörüne haber verir. Kayıt tekil
 * (`hotelId`, `night`): sunucu yeniden başlasa da haber ikinci kez çıkmaz.
 * Aktör kapalıysa iş "oda ücretleri işlenecek" manuel görevine düşer.
 *
 * @param {Date} [now]
 * @returns {Promise<number>} açılan çalışma sayısı
 */
export async function scheduleDueRoomCharges(now = new Date()) {
  const hotels = await prismaUnfiltered.hotel.findMany({ where: { deletedAt: null }, select: { id: true } });
  let opened = 0;
  for (const hotel of hotels) {
    const night = toIsoDay(addDays(await getBusinessDate(hotel.id, now), -1));
    const inserted = await writeWithEvents(async (tx, stage) => {
      const rows = await tx.$queryRaw`
        INSERT INTO "RoomChargeRun" ("id", "hotelId", "night", "dueAt", "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${hotel.id}, ${night}::date, ${SQL_NOW}, ${SQL_NOW}, ${SQL_NOW})
        ON CONFLICT ("hotelId", "night") DO NOTHING
        RETURNING "id"`;
      if (rows.length > 0) await stage('folio.room_charges.due', { hotelId: hotel.id, night });
      return rows.length;
    });
    opened += inserted;
  }
  return opened;
}

/* ══════════════════ Çıkış (modül 6'nın bakiye sorusu) ══════════════════ */

/**
 * Çıkışta henüz folyoya işlenmemiş ama işlenecek tutarlar: kalan oda geceleri
 * (uzlaştırmayla) ve geç çıkış ücreti — vergileriyle. Yönlendirmeyle başka
 * konaklamanın folyosuna düşecek olanlar misafirin borcuna yazılmaz
 * (`elsewhere`). Yazmaz; çıkış transaction'ında da önizlemede de çalışır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {{ id: string }} stay
 * @param {{ keptNights: Array<{ date: string, amount: string }>, lateFee: string | null }} input
 * @returns {Promise<{ own: Array<{ source: string, label: string, total: string }>, elsewhere: Array<{ source: string, label: string, total: string, folio: object }>, ownTotal: string }>}
 */
export async function pendingStayCharges(client, hotelId, stay, { keptNights, lateFee }) {
  const taxes = await getActiveTaxes(hotelId);
  const specs = await planStayRoomSpecs(client, hotelId, [stay.id], { throughNight: null, nightsOverride: new Map([[stay.id, keptNights]]) });
  if (lateFee && (await activeFeeItems(client, hotelId, stay.id, ['LATE_CHECK_OUT'])).length === 0) {
    specs.push({ ...feeSpec(stay.id, 'LATE_CHECK_OUT', lateFee, 'ROOM', null), serviceDate: toIsoDay(new Date()) });
  }
  if (specs.length === 0) return { own: [], elsewhere: [], ownTotal: '0.00' };

  const state = (await loadStayFolioState(client, hotelId, [stay.id])).get(stay.id);
  const externalIds = [
    ...new Set(state.routes.filter((route) => route.folio.reservationId !== stay.id).map((route) => route.folio.id)),
  ];
  const externals = externalIds.length
    ? await client.folio.findMany({ where: { id: { in: externalIds }, hotelId }, select: FOLIO_REF_SELECT })
    : [];
  const externalById = new Map(externals.map((folio) => [folio.id, folioRef(folio)]));

  const own = [];
  const elsewhere = [];
  for (const spec of specs) {
    const line = chargeLine({ amount: spec.amount, quantity: spec.quantity, taxCategory: spec.taxCategory, taxes });
    const target = resolvePostingFolio({ type: spec.routeType ?? spec.type, routes: state.routes, stayFolios: state.folios });
    const external = target?.reservationId && target.reservationId !== stay.id ? externalById.get(target.folioId) : null;
    if (external) elsewhere.push({ source: spec.source, label: spec.description, total: line.total, folio: external });
    else own.push({ source: spec.source, label: spec.description, total: line.total });
  }
  return { own, elsewhere, ownTotal: linesTotal(own) };
}

/**
 * Tek seferlik ücret kalemi (erken giriş, geç çıkış, iptal, gelmedi).
 * @param {string} reservationId
 * @param {'EARLY_CHECK_IN' | 'LATE_CHECK_OUT' | 'CANCELLATION' | 'NO_SHOW'} source
 * @param {string} amount
 * @param {string} taxCategory
 * @param {string | null} eventId
 * @returns {import('./posting.js').PostingSpec}
 */
function feeSpec(reservationId, source, amount, taxCategory, eventId) {
  return {
    reservationId,
    type: taxCategory === 'ROOM' ? 'ROOM' : 'OTHER',
    routeType: taxCategory === 'ROOM' ? 'ROOM' : 'OTHER',
    taxCategory,
    description: FEE_DESCRIPTIONS[source],
    amount: money(amount),
    quantity: 1,
    serviceDate: '',
    source,
    sourceKey: eventId ? `evt:${eventId}` : null,
  };
}

/* ══════════════════ Aktör işleri (billing-worker) ══════════════════ */

/**
 * Misafir girdi: folyo açılır (yoksa), erken giriş ücreti işlenir (konaklamada
 * etkin erken giriş ücreti yoksa — giriş geri alınıp yeniden yapıldıysa ikinci
 * ücret çıkmaz). Giriş bu arada geri alındıysa bir şey yapılmaz.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ earlyCheckInFee: string | null, eventId: string }} input
 */
export async function openStayOnCheckIn(hotelId, reservationId, { earlyCheckInFee, eventId }) {
  const [taxes, today] = await Promise.all([getActiveTaxes(hotelId), businessDay(hotelId)]);
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Konaklama bulunamadı');
    const stay = await readStayForPosting(tx, hotelId, reservationId);
    if (stay.status !== 'CHECKED_IN') return { skipped: 'Konaklama içeride değil (giriş geri alınmış)' };

    const state = (await loadStayFolioState(tx, hotelId, [stay.id])).get(stay.id);
    let opened = false;
    if (!state.folios.some((folio) => folio.status === 'OPEN')) {
      await createStayFolio(tx, stage, { hotelId, stay, windows: state.folios.map((folio) => folio.window) });
      opened = true;
    }
    let feePosted = null;
    if (earlyCheckInFee && (await activeFeeItems(tx, hotelId, stay.id, ['EARLY_CHECK_IN'])).length === 0) {
      const { items } = await postSpecs(tx, stage, {
        hotelId,
        specs: [{ ...feeSpec(stay.id, 'EARLY_CHECK_IN', earlyCheckInFee, 'ROOM', eventId), serviceDate: today }],
        stays: new Map([[stay.id, stay]]),
        taxes,
      });
      feePosted = items[0]?.total ?? null;
    }
    return { opened, feePosted };
  });
}

/**
 * Misafir çıktı: kalan oda geceleri ve geç çıkış ücreti işlenir, bakiyesi
 * sıfır olan folyolar kapanır (`folio.closed` → fatura). Bakiye kalan folyo
 * açık kalır; çıkış bakiyeyle yapılmadıysa (beklenmedik fark) folyo
 * yetkilisinin ziline uyarı düşer.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ lateCheckOutFee: string | null, openBalance: string | null, eventId: string }} input
 */
export async function settleStayOnCheckOut(hotelId, reservationId, { lateCheckOutFee, openBalance, eventId }) {
  const [taxes, today] = await Promise.all([getActiveTaxes(hotelId), businessDay(hotelId)]);
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Konaklama bulunamadı');
    const stay = await readStayForPosting(tx, hotelId, reservationId);
    if (stay.status !== 'CHECKED_OUT') return { skipped: 'Konaklama çıkmış değil (çıkış geri alınmış)' };

    const rooms = await postRoomCharges(tx, stage, { hotelId, stays: [stay], throughNight: null, taxes });
    let feePosted = null;
    if (lateCheckOutFee && (await activeFeeItems(tx, hotelId, stay.id, ['LATE_CHECK_OUT'])).length === 0) {
      const { items } = await postSpecs(tx, stage, {
        hotelId,
        specs: [{ ...feeSpec(stay.id, 'LATE_CHECK_OUT', lateCheckOutFee, 'ROOM', eventId), serviceDate: today }],
        stays: new Map([[stay.id, stay]]),
        taxes,
      });
      feePosted = items[0]?.total ?? null;
    }

    const open = await tx.folio.findMany({
      where: { hotelId, reservationId, status: 'OPEN' },
      select: { id: true, window: true, payerName: true },
      orderBy: { window: 'asc' },
    });
    const openIds = open.map((folio) => folio.id);
    await lockFolios(tx, hotelId, openIds);
    const totals = await refreshFolioTotals(tx, openIds);
    // Bekleyen kalem / ödeme iptali ya da onay bekleyen ödeme / iade olan folyo kapanmaz.
    const [itemVoids, paymentVoids, pendingPayments] = await Promise.all([
      tx.folioItem.groupBy({
        by: ['folioId'],
        where: { hotelId, folioId: { in: openIds }, voidRequestedAt: { not: null } },
        _count: { _all: true },
      }),
      pendingPaymentVoids(tx, hotelId, openIds),
      pendingPaymentCounts(tx, hotelId, openIds),
    ]);
    const blockedIds = new Set([...itemVoids.map((row) => row.folioId), ...paymentVoids.keys(), ...pendingPayments.keys()]);
    const closed = [];
    const remaining = [];
    for (const folio of open) {
      const balance = totals.get(folio.id)?.balance ?? '0.00';
      if (balanceIsZero(balance) && !blockedIds.has(folio.id)) {
        await closeLocked(tx, stage, { hotelId, folioId: folio.id, actorLabel: currentActor() });
        closed.push(folio.id);
      } else {
        remaining.push({ folioId: folio.id, name: folioDisplayName(folio), balance, blocked: blockedIds.has(folio.id) });
      }
    }
    if (remaining.length > 0 && !openBalance) {
      await raiseStaffAlert(tx, stage, {
        hotelId,
        kind: 'FOLIO_ATTENTION',
        severity: 'WARNING',
        permission: PERMISSIONS.FOLIO_POST,
        title: `${stay.confirmationCode}: çıkıştan sonra folyo kapanmadı`,
        body: remainingFoliosNote(remaining, stay.currency),
        link: `/folyolar/${stay.id}`,
        entityType: 'Reservation',
        entityId: stay.id,
        dedupeKey: `folio-balance:${stay.id}`,
      });
    }
    return { roomItems: rooms.items.length, feePosted, closed: closed.length, open: remaining.length };
  });
}

/**
 * Çıkıştan sonra kapanmayan folyoların açıklaması (zil): pencere başına bakiye;
 * toplam sıfırsa pencereler dengesizdir (ör. misafirin ödemesi ana pencereye,
 * şirketin harcaması diğerine düştü) — kalem aktararak düzeltilir.
 *
 * @param {Array<{ name: string, balance: string, blocked: boolean }>} remaining
 * @param {string} currency
 */
function remainingFoliosNote(remaining, currency) {
  const lines = remaining.map((row) => `${row.name}: ${row.balance} ${currency}${row.blocked ? ' (onay bekleyen iş var)' : ''}`);
  const net = remaining.reduce((acc, row) => acc.plus(row.balance), toDecimal(0));
  const hint = remaining.every((row) => balanceIsZero(row.balance))
    ? 'Onay bekleyen iptal / ödeme karara bağlanınca folyoyu kapatın.'
    : net.isZero()
      ? 'Toplam sıfır ama pencereler dengesiz: kalemleri ödemenin düştüğü folyoya aktarın ya da doğru folyoda iade / tahsilat yapın.'
      : 'Tahsilat ya da iade gerekiyor.';
  return `${lines.join('; ')}. ${hint}`;
}

/**
 * Yanlış giriş geri alındı: bu girişin erken giriş ücreti ters kayıtla düşer.
 * Geri almadan sonra yapılan yeni girişin ücretine dokunulmaz (`occurredAt`).
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ reason: string, occurredAt: Date }} input
 */
export async function reverseCheckInFees(hotelId, reservationId, { reason, occurredAt }) {
  const today = await businessDay(hotelId);
  return writeWithEvents(async (tx, stage) => {
    await lockReservations(tx, hotelId, [reservationId]);
    const fees = await activeFeeItems(tx, hotelId, reservationId, ['EARLY_CHECK_IN'], { postedBefore: occurredAt });
    const reversed = await reverseItems(tx, stage, {
      hotelId,
      itemIds: fees.map((fee) => fee.id),
      reason: `Giriş geri alındı: ${reason}`,
      serviceDate: today,
    });
    return { reversed: reversed.length };
  });
}

/**
 * Yanlış çıkış geri alındı: misafir yine içeride. Açık folyosu kalmadıysa ana
 * folyo yeniden açılır; geç çıkış ücreti (geri almadan önce işlenmişse) ters
 * kayıtla düşer. Çıkışta işlenen geceler geçerli kalır (konaklama sürüyor).
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ reason: string, occurredAt: Date }} input
 */
export async function reopenStayOnCheckOutRevert(hotelId, reservationId, { reason, occurredAt }) {
  const today = await businessDay(hotelId);
  return writeWithEvents(async (tx, stage) => {
    await lockReservations(tx, hotelId, [reservationId]);
    const fees = await activeFeeItems(tx, hotelId, reservationId, ['LATE_CHECK_OUT'], { postedBefore: occurredAt });
    const folios = await tx.folio.findMany({ where: { hotelId, reservationId }, select: { id: true, window: true, status: true } });
    const reopenIds = new Set(fees.map((fee) => fee.folioId));
    if (!folios.some((folio) => folio.status === 'OPEN')) {
      const primary = folios.filter((folio) => folio.status === 'CLOSED').sort((a, b) => a.window - b.window)[0];
      if (primary) reopenIds.add(primary.id);
    }
    await lockFolios(tx, hotelId, [...reopenIds]);
    let reopened = 0;
    for (const id of reopenIds) {
      const folio = await findFolio(hotelId, id, tx);
      if (folio.status !== 'CLOSED') continue;
      await reopenLocked(tx, stage, { hotelId, folio, reason: `Çıkış geri alındı: ${reason}` });
      reopened += 1;
    }
    const reversed = await reverseItems(tx, stage, {
      hotelId,
      itemIds: fees.map((fee) => fee.id),
      reason: `Çıkış geri alındı: ${reason}`,
      serviceDate: today,
    });
    return { reopened, reversed: reversed.length };
  });
}

/**
 * İptal / gelmedi ücreti: rezervasyona yazılan ücret folyoya işlenir (folyo
 * yoksa açılır; tahsilat ödeme modülünde). Rezervasyon bu arada geri
 * alındıysa ya da ücret yoksa bir şey yapılmaz.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ kind: 'CANCELLATION' | 'NO_SHOW', eventId: string }} input
 */
export async function postReservationFee(hotelId, reservationId, { kind, eventId }) {
  const [taxes, today] = await Promise.all([getActiveTaxes(hotelId), businessDay(hotelId)]);
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Konaklama bulunamadı');
    const stay = await readStayForPosting(tx, hotelId, reservationId);
    const expected = kind === 'CANCELLATION' ? 'CANCELLED' : 'NO_SHOW';
    if (stay.status !== expected) return { skipped: 'Rezervasyonun durumu değişmiş' };
    const fee = money(kind === 'CANCELLATION' ? stay.cancellationFee : stay.noShowFee);
    if (!fee || balanceIsZero(fee)) return { skipped: 'Ücret yok' };
    if ((await activeFeeItems(tx, hotelId, stay.id, [kind])).length > 0) return { skipped: 'Ücret zaten işlenmiş' };
    const { items } = await postSpecs(tx, stage, {
      hotelId,
      specs: [{ ...feeSpec(stay.id, kind, fee, RESERVATION_FEE_TAX_CATEGORY, eventId), serviceDate: today }],
      stays: new Map([[stay.id, stay]]),
      taxes,
    });
    return { posted: items[0]?.total ?? null };
  });
}

/**
 * İptal / gelmedi geri alındı: o ücretler ters kayıtla düşer.
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ occurredAt: Date }} input
 */
export async function reverseReservationFees(hotelId, reservationId, { occurredAt }) {
  const today = await businessDay(hotelId);
  return writeWithEvents(async (tx, stage) => {
    await lockReservations(tx, hotelId, [reservationId]);
    const fees = await activeFeeItems(tx, hotelId, reservationId, ['CANCELLATION', 'NO_SHOW'], { postedBefore: occurredAt });
    if (fees.length === 0) return { reversed: 0 };
    // Ücretin folyosu kapanmışsa (tahsil edilip kapatılmış) önce açılır: geri alınan iptalin ücreti iade edilecek.
    await lockFolios(tx, hotelId, fees.map((fee) => fee.folioId));
    for (const folioId of new Set(fees.map((fee) => fee.folioId))) {
      const folio = await findFolio(hotelId, folioId, tx);
      if (folio.status === 'CLOSED') await reopenLocked(tx, stage, { hotelId, folio, reason: 'Rezervasyon geri alındı' });
    }
    const reversed = await reverseItems(tx, stage, { hotelId, itemIds: fees.map((fee) => fee.id), reason: 'Rezervasyon geri alındı', serviceDate: today });
    return { reversed: reversed.length };
  });
}

/**
 * Dış kaynaklı harcama (restoran siparişi, minibar tüketimi): konaklama
 * verilmişse ona, yalnızca oda verilmişse o odada içerideki misafire işlenir.
 * İçeride misafir yoksa iş kuralı hatası (aktör tekrar denemez, personele düşer).
 *
 * @param {string} hotelId
 * @param {{ reservationId: string | null, roomId: string | null, reference: string, items: Array<{ description: string, unitPrice: string, quantity: number }> }} charge
 * @param {{ source: 'FNB_ORDER' | 'MINIBAR', eventId: string }} options
 */
export async function postExternalCharge(hotelId, charge, { source, eventId }) {
  const [taxes, today] = await Promise.all([getActiveTaxes(hotelId), businessDay(hotelId)]);
  const type = source === 'FNB_ORDER' ? 'FNB' : 'MINIBAR';
  const stayRef = charge.reservationId
    ? await prisma.reservation.findFirst({ where: { id: charge.reservationId, hotelId }, select: { id: true, status: true } })
    : await prisma.reservation.findFirst({ where: { hotelId, roomId: charge.roomId, status: 'CHECKED_IN' }, select: { id: true, status: true } });
  if (!stayRef || stayRef.status !== 'CHECKED_IN') {
    throw new ConflictError(
      charge.reservationId ? 'Konaklama içeride değil; harcama folyoya elle işlenmeli.' : 'Odada konaklayan misafir yok; harcama folyoya elle işlenmeli.',
      'NO_STAY',
    );
  }
  return writeWithEvents(async (tx, stage) => {
    await lockReservations(tx, hotelId, [stayRef.id]);
    const stay = await readStayForPosting(tx, hotelId, stayRef.id);
    if (stay.status !== 'CHECKED_IN') throw new ConflictError('Misafir bu sırada çıkış yaptı; harcama folyoya elle işlenmeli.', 'NO_STAY');
    const specs = charge.items.map((item, index) => ({
      reservationId: stay.id,
      type,
      taxCategory: type,
      description: `${item.description} (${charge.reference})`.slice(0, 200),
      amount: money(item.unitPrice),
      quantity: item.quantity,
      serviceDate: today,
      source,
      sourceKey: `evt:${eventId}:${index}`,
    }));
    const { items } = await postSpecs(tx, stage, { hotelId, specs, stays: new Map([[stay.id, stay]]), taxes });
    return { reservationId: stay.id, items: items.length, total: linesTotal(items) };
  });
}
