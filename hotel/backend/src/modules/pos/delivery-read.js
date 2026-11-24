import { toDecimal } from '@hotelos/core';
import { DELIVERY_ACTIVE_STATUSES, MAX_DELIVERY_BOARD_COLUMN, MAX_DELIVERY_CUSTOMER_ADDRESSES, deliveryDurations, internationalPhone, utcToZonedWallTime } from '@hotelos/hotel-contracts';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { dayWindow } from './room-service-read.js';
import { checkBalance } from './rules.js';
import { hotelContext, iso, loadPosSettings, money, prisma } from './shared.js';

/**
 * Paket servisin okuma uçları (modül 42): sipariş ekranı, paket panosu (günün özetiyle), geçmiş (sayfalı, aramalı)
 * ve tekrar gelen müşteri (telefonla son ad / adresler).
 *
 * Her liste sınırlıdır: pano sütunu `MAX_DELIVERY_BOARD_COLUMN` (sayısı ayrıca), geçmiş sayfalı, müşteri sorgusu son
 * siparişlerle. Gün süzgeçleri otelin gününe göredir.
 */

/** Telefonla aranan müşterinin en fazla bu kadar son siparişine bakılır (adresler bunlardan). */
const CUSTOMER_LOOKBACK = 20;
/** Aramada telefon sayılması için en az rakam (daha kısası numara / ad parçası). */
const MIN_PHONE_SEARCH_DIGITS = 7;

const CARD_SELECT = Object.freeze({
  id: true,
  number: true,
  status: true,
  source: true,
  outletId: true,
  checkId: true,
  customerName: true,
  phone: true,
  address: true,
  addressNote: true,
  note: true,
  doorMethod: true,
  changeFor: true,
  dueAt: true,
  courierEmail: true,
  assignedAt: true,
  createdBy: true,
  createdAt: true,
  preparingAt: true,
  readyAt: true,
  dispatchedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  updatedAt: true,
  outlet: { select: { name: true } },
  check: {
    select: {
      grandTotal: true,
      paidTotal: true,
      roomChargeTotal: true,
      lines: { orderBy: { sortOrder: 'asc' }, select: { name: true, quantity: true, voidedQuantity: true, station: true, note: true } },
    },
  },
});

/**
 * Pano / liste kartı: kalemler (iptal düşülmüş; paket ücreti gibi sistem kalemi hariç), toplam, kapıda kalan, süreler.
 * @param {any} row @param {Date} now
 */
function toCard(row, now) {
  const check = row.check;
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    source: row.source,
    outletId: row.outletId,
    outletName: row.outlet?.name ?? null,
    checkId: row.checkId,
    customerName: row.customerName,
    phone: row.phone,
    address: row.address,
    addressNote: row.addressNote,
    note: row.note,
    doorMethod: row.doorMethod,
    changeFor: row.changeFor === null ? null : money(row.changeFor),
    dueAt: iso(row.dueAt),
    courierEmail: row.courierEmail,
    assignedAt: iso(row.assignedAt),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    preparingAt: iso(row.preparingAt),
    readyAt: iso(row.readyAt),
    dispatchedAt: iso(row.dispatchedAt),
    deliveredAt: iso(row.deliveredAt),
    cancelledAt: iso(row.cancelledAt),
    items: check.lines
      .filter((line) => line.station !== 'NONE' && line.quantity - line.voidedQuantity > 0)
      .map((line) => ({ name: line.name, quantity: line.quantity - line.voidedQuantity, note: line.note ?? null })),
    total: money(check.grandTotal),
    balance: checkBalance({ grandTotal: money(check.grandTotal), paidTotal: money(check.paidTotal), roomChargeTotal: money(check.roomChargeTotal) }),
    late: DELIVERY_ACTIVE_STATUSES.includes(row.status) && row.dueAt.getTime() < now.getTime(),
    durations: deliveryDurations(row),
    updatedAt: iso(row.updatedAt),
  };
}

/* ══════════════════ Sipariş ekranı ══════════════════ */

/**
 * Sipariş: kart alanları, adisyonun hesabı (ön ödemeler dahil), iptal / teslim izleri.
 * @param {string} hotelId @param {string} orderId
 */
export async function getDeliveryOrder(hotelId, orderId) {
  const row = await prisma.deliveryOrder.findFirst({
    where: { id: orderId, hotelId },
    select: {
      ...CARD_SELECT,
      deliveredBy: true,
      cancelledBy: true,
      cancelReason: true,
      check: {
        select: {
          ...CARD_SELECT.check.select,
          id: true,
          number: true,
          status: true,
          waiterEmail: true,
          compTotal: true,
          voidTotal: true,
          discountTotal: true,
          payments: {
            where: { kind: 'PAYMENT' },
            orderBy: { receivedAt: 'asc' },
            select: { id: true, method: true, amount: true, status: true, reference: true, receivedBy: true, receivedAt: true },
          },
        },
      },
    },
  });
  if (!row) throw new NotFoundError('Paket sipariş bulunamadı');
  const { currency } = await hotelContext(hotelId);
  const check = row.check;
  return {
    ...toCard(row, new Date()),
    currency,
    deliveredBy: row.deliveredBy,
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
    check: {
      id: check.id,
      number: check.number,
      status: check.status,
      waiterEmail: check.waiterEmail,
      grandTotal: money(check.grandTotal),
      paidTotal: money(check.paidTotal),
      givenAway: money(toDecimal(String(check.compTotal)).plus(toDecimal(String(check.voidTotal))).plus(toDecimal(String(check.discountTotal)))),
      balance: checkBalance({ grandTotal: money(check.grandTotal), paidTotal: money(check.paidTotal), roomChargeTotal: money(check.roomChargeTotal) }),
    },
    payments: check.payments.map((payment) => ({ ...payment, amount: money(payment.amount), receivedAt: iso(payment.receivedAt) })),
  };
}

/* ══════════════════ Paket panosu ══════════════════ */

/** @param {Date | null} deliveredAt @param {Date} dueAt */
const onTime = (deliveredAt, dueAt) => Boolean(deliveredAt && deliveredAt.getTime() <= dueAt.getTime());

/**
 * Pano: mutfakta (düşen + hazırlanan), hazır, yolda — teslim hedefine göre; sütun başına sınırlı. Günün özeti (otelin
 * takvim günü): teslim edilen, iptal edilen, zamanında oranı.
 *
 * @param {string} hotelId @param {{ outletId?: string }} query
 */
export async function getDeliveryBoard(hotelId, { outletId }) {
  const now = new Date();
  const outlet = outletId ? { outletId } : {};
  const column = (statuses) =>
    prisma.deliveryOrder.findMany({ where: { hotelId, ...outlet, status: { in: statuses } }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: MAX_DELIVERY_BOARD_COLUMN, select: CARD_SELECT });
  const [{ currency, timezone }, settings] = await Promise.all([hotelContext(hotelId), loadPosSettings(prisma, hotelId)]);
  const today = utcToZonedWallTime(now, timezone).slice(0, 10);
  const window = dayWindow(today, today, timezone);
  const [kitchen, ready, onTheWay, counts, delivered, cancelled] = await Promise.all([
    column(['RECEIVED', 'PREPARING']),
    column(['READY']),
    column(['ON_THE_WAY']),
    prisma.deliveryOrder.groupBy({ by: ['status'], where: { hotelId, ...outlet, status: { in: [...DELIVERY_ACTIVE_STATUSES] } }, _count: { _all: true } }),
    prisma.deliveryOrder.findMany({ where: { hotelId, ...outlet, status: 'DELIVERED', deliveredAt: { gte: window.start, lt: window.end } }, select: { deliveredAt: true, dueAt: true } }),
    prisma.deliveryOrder.count({ where: { hotelId, ...outlet, status: 'CANCELLED', cancelledAt: { gte: window.start, lt: window.end } } }),
  ]);
  const count = (status) => counts.find((entry) => entry.status === status)?._count._all ?? 0;
  const cards = (rows) => rows.map((row) => toCard(row, now));
  const punctual = delivered.filter((row) => onTime(row.deliveredAt, row.dueAt)).length;
  return {
    currency,
    now: now.toISOString(),
    settings: { deliveryFee: settings.deliveryFee, deliveryMinOrder: settings.deliveryMinOrder, deliveryOrderMinutes: settings.deliveryOrderMinutes },
    columns: {
      kitchen: { items: cards(kitchen), total: count('RECEIVED') + count('PREPARING') },
      ready: { items: cards(ready), total: count('READY') },
      onTheWay: { items: cards(onTheWay), total: count('ON_THE_WAY') },
    },
    today: { delivered: delivered.length, cancelled, onTimePct: delivered.length ? Math.round((punctual / delivered.length) * 1000) / 10 : null },
  };
}

/* ══════════════════ Geçmiş ══════════════════ */

/**
 * Arama koşulu: 7+ rakam telefon (otelin ülke koduyla, birebir — telefon index'i), değilse numara ya da müşteri adı
 * parçası (trigram index'i).
 * @param {string} search @param {string} countryCode
 */
function searchWhere(search, countryCode) {
  if (search.replace(/\D/g, '').length >= MIN_PHONE_SEARCH_DIGITS) return { phone: internationalPhone(search, countryCode) ?? search.replace(/\D/g, '') };
  return { OR: [{ number: { contains: search, mode: /** @type {const} */ ('insensitive') } }, { customerName: { contains: search, mode: /** @type {const} */ ('insensitive') } }] };
}

/**
 * Sipariş geçmişi (sayfalı; en yeni önce): durum grubu, satış noktası, sipariş günü aralığı, arama.
 * @param {string} hotelId @param {any} query `deliveryListQuerySchema`
 */
export async function listDeliveryOrders(hotelId, query) {
  const { currency, timezone, hotel } = await hotelContext(hotelId);
  const statuses = { ACTIVE: [...DELIVERY_ACTIVE_STATUSES], DELIVERED: ['DELIVERED'], CANCELLED: ['CANCELLED'] }[query.state] ?? null;
  const window = query.from || query.to ? dayWindow(query.from ?? query.to, query.to ?? query.from, timezone) : null;
  const search = query.search?.trim();
  const where = {
    hotelId,
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(query.outletId ? { outletId: query.outletId } : {}),
    ...(window ? { createdAt: { gte: window.start, lt: window.end } } : {}),
    ...(search ? searchWhere(search, hotel.phoneCountryCode) : {}),
  };
  const now = new Date();
  const [rows, total] = await Promise.all([
    prisma.deliveryOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query), select: CARD_SELECT }),
    prisma.deliveryOrder.count({ where }),
  ]);
  const page = buildPage(
    rows.map((row) => toCard(row, now)),
    total,
    query,
  );
  return { ...page, meta: { ...page.meta, currency } };
}

/* ══════════════════ Tekrar gelen müşteri ══════════════════ */

/**
 * Telefonla son siparişlerin adı ve farklı adresleri (en yeni önce): personel tek tıkla doldurur.
 * @param {string} hotelId @param {{ phone: string }} query
 */
export async function findDeliveryCustomer(hotelId, { phone: written }) {
  const { hotel } = await hotelContext(hotelId);
  const phone = internationalPhone(written, hotel.phoneCountryCode);
  if (!phone) throw new ValidationError('Telefon geçersiz', { field: 'phone' });
  const rows = await prisma.deliveryOrder.findMany({
    where: { hotelId, phone },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: CUSTOMER_LOOKBACK,
    select: { customerName: true, address: true, addressNote: true, createdAt: true },
  });
  const addresses = [];
  for (const row of rows) {
    if (addresses.length >= MAX_DELIVERY_CUSTOMER_ADDRESSES) break;
    if (addresses.some((entry) => entry.address.toLocaleLowerCase('tr-TR') === row.address.toLocaleLowerCase('tr-TR'))) continue;
    addresses.push({ address: row.address, addressNote: row.addressNote, lastOrderAt: iso(row.createdAt) });
  }
  return { phone, customerName: rows[0]?.customerName ?? null, addresses };
}
