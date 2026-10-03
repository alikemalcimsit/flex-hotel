import { currentActor, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import {
  LAUNDRY_EDITABLE_STATUSES,
  LAUNDRY_OPEN_STATUSES,
  LAUNDRY_SERVICE_LABELS,
  RESERVATION_COUNT_CAP,
  laundryDueAtError,
  laundryOverdue,
  laundryTransitionError,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockLaundryOrders, lockReservations } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { MATCH_NOTHING, isFuzzyToken, matchGuestIds, matchRoomIdsByNumber, searchTokens } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { guestFullName } from '../reservations/guests.js';
import { chargePostingStatus } from './posting-status.js';
import { laundryTotals, newReference, repriceLines } from './rules.js';

/**
 * Çamaşırhane siparişi (modül 19).
 *
 * Sipariş içerideki misafir adına alınır (oda + konaklama; ekranın gördüğü
 * misafir kilit altında doğrulanır). Durum: alındı → yıkamada → hazır →
 * teslim edildi (ileri atlanabilir, geri dönülmez) ya da iptal (gerekçeli).
 * Parça sayısı çamaşırhanede sayılınca düzeltilir (alındı / yıkamada iken);
 * siparişteki parça sipariş anındaki fiyatını korur.
 *
 * **Ücret teslimde** folyoya `laundry.charged` olayıyla gider (folyo aktörü
 * işler; çamaşırhane vergisiyle, yönlendirmeye uyar; olay iki kez gelse de tek
 * yazılır). İptal edilen sipariş hiç işlenmez. Misafir teslimden önce çıktıysa
 * ücret açık folyosuna geç kalem olarak düşer; folyosu kapandıysa folyo
 * yetkilisine görev düşer. Çıkış penceresi teslim edilmemiş siparişi uyarır.
 *
 * Her durum değişikliği sipariş satırı kilitliyken ve sürüm damgasıyla
 * yapılır: aynı siparişi iki kişi aynı anda teslim edip ücreti iki kez yazamaz.
 */

const iso = (value) => (value ? value.toISOString() : null);

/** Aramada sipariş no: "LND-" önekli ya da öneksiz 6 karakter. */
const REFERENCE_TOKEN = /^(LND-)?[A-Z0-9]{6}$/i;
/** Prisma Decimal → "1234.50" (bütün modüllerdeki gibi iki ondalık). */
const money = (value) => (value === null || value === undefined ? null : toMoneyString(String(value)));

/** Yüzde metni: "50.00" → "50", "12.50" → "12.5". */
const pct = (value) => toDecimal(String(value)).toString();

const ORDER_SELECT = Object.freeze({
  id: true,
  roomId: true,
  reservationId: true,
  reference: true,
  status: true,
  express: true,
  expressPct: true,
  subtotal: true,
  surcharge: true,
  total: true,
  itemCount: true,
  dueAt: true,
  note: true,
  businessDate: true,
  receivedBy: true,
  receivedAt: true,
  statusChangedAt: true,
  statusChangedBy: true,
  deliveredAt: true,
  deliveredBy: true,
  chargeEventId: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  updatedAt: true,
  room: { select: { number: true } },
  reservation: { select: { id: true, confirmationCode: true, status: true, guest: { select: { firstName: true, lastName: true } } } },
  lines: { select: { itemId: true, name: true, service: true, unitPrice: true, quantity: true, total: true }, orderBy: { name: 'asc' } },
});

/**
 * @param {any} row
 * @param {Map<string, object>} posting
 * @param {Date} now
 */
function toOrderDto(row, posting, now) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    roomId: row.roomId,
    roomNumber: row.room?.number ?? null,
    stay: {
      id: row.reservation.id,
      confirmationCode: row.reservation.confirmationCode,
      status: row.reservation.status,
      guestName: guestFullName(row.reservation.guest),
    },
    express: row.express,
    expressPct: pct(row.expressPct),
    subtotal: money(row.subtotal),
    surcharge: money(row.surcharge),
    total: money(row.total),
    itemCount: row.itemCount,
    dueAt: iso(row.dueAt),
    overdue: laundryOverdue(row, now),
    note: row.note ?? null,
    businessDate: toIsoDay(row.businessDate),
    receivedBy: row.receivedBy,
    receivedAt: iso(row.receivedAt),
    statusChangedAt: iso(row.statusChangedAt),
    statusChangedBy: row.statusChangedBy,
    deliveredAt: iso(row.deliveredAt),
    deliveredBy: row.deliveredBy ?? null,
    cancelledAt: iso(row.cancelledAt),
    cancelledBy: row.cancelledBy ?? null,
    cancelReason: row.cancelReason ?? null,
    updatedAt: iso(row.updatedAt),
    lines: row.lines.map((line) => ({ ...line, unitPrice: money(line.unitPrice), total: money(line.total) })),
    posting: row.status === 'DELIVERED' ? (posting.get(row.chargeEventId) ?? { status: 'PENDING' }) : null,
  };
}

/** Denetim izi özeti. */
const orderAudit = (row) => ({
  reference: row.reference,
  status: row.status,
  express: row.express,
  total: money(row.total),
  itemCount: row.itemCount,
  dueAt: iso(row.dueAt),
});

/** @param {string} hotelId */
async function businessDay(hotelId) {
  return toIsoDay(await getBusinessDate(hotelId));
}

/** @param {string} day */
const dayStart = (day) => new Date(`${day}T00:00:00.000Z`);

/**
 * Satırlardaki ürünler satışta mı (güncel ad, hizmet, fiyat).
 * @param {any} tx
 * @param {string} hotelId
 * @param {string[]} itemIds
 */
async function loadCatalog(tx, hotelId, itemIds) {
  const items = await tx.laundryItem.findMany({
    where: { hotelId, id: { in: itemIds }, active: true },
    select: { id: true, name: true, service: true, price: true },
  });
  const catalog = new Map(items.map((item) => [item.id, { name: item.name, service: item.service, price: money(item.price) }]));
  if (itemIds.some((id) => !catalog.has(id))) {
    throw new ValidationError('Seçilen parçalardan biri fiyat listesinden kalkmış; listeyi yenileyin.', { field: 'lines' });
  }
  return catalog;
}

/**
 * Otelde boşta bir sipariş numarası.
 * @param {any} tx
 * @param {string} hotelId
 */
async function freeReference(tx, hotelId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = newReference('LND');
    if (!(await tx.laundryOrder.findFirst({ where: { hotelId, reference }, select: { id: true } }))) return reference;
  }
  throw new ConflictError('Sipariş numarası üretilemedi; tekrar deneyin.', 'REFERENCE_BUSY');
}

/** @param {string} hotelId @param {string} id @param {Date} now */
async function readOrder(hotelId, id, now = new Date()) {
  const row = await prisma.laundryOrder.findFirst({ where: { id, hotelId }, select: ORDER_SELECT });
  if (!row) throw new NotFoundError('Sipariş bulunamadı');
  const posting = row.status === 'DELIVERED' ? await chargePostingStatus(hotelId, [row.chargeEventId]) : new Map();
  return toOrderDto(row, posting, now);
}

/** Sipariş detayı. */
export function getLaundryOrder(hotelId, id) {
  return readOrder(hotelId, id);
}

/**
 * Sipariş al. Ekranın gördüğü misafir odada hâlâ içeride olmalı (kilit
 * altında); teslim zamanı ileride ve en fazla birkaç gün sonra. Aynı istek
 * kimliğiyle ikinci gönderim yeni sipariş açmaz.
 *
 * @param {string} hotelId
 * @param {object} input `laundryOrderSchema` çıktısı
 * @param {{ now?: Date }} [options]
 */
export async function createLaundryOrder(hotelId, input, { now = new Date() } = {}) {
  const dueProblem = laundryDueAtError(input.dueAt, now);
  if (dueProblem) throw new ValidationError(dueProblem, { field: 'dueAt' });
  const businessDate = await businessDay(hotelId);
  const actor = currentActor();
  try {
    const outcome = await writeWithEvents(async (tx, stage) => {
      const existing = await tx.laundryOrder.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } });
      if (existing) return { id: existing.id, created: false };

      if (!(await lockReservations(tx, hotelId, [input.reservationId])).has(input.reservationId)) {
        throw new NotFoundError('Konaklama bulunamadı; odayı yeniden açın.');
      }
      const stay = await tx.reservation.findFirst({ where: { id: input.reservationId, hotelId }, select: { status: true, roomId: true } });
      if (stay?.status !== 'CHECKED_IN' || stay.roomId !== input.roomId) {
        throw new ConflictError('Bu odada bu misafir artık konaklamıyor; odayı yeniden açın.', 'STAY_CHANGED');
      }
      const catalog = await loadCatalog(tx, hotelId, input.lines.map((line) => line.itemId));
      const hotel = await tx.hotel.findFirst({ where: { id: hotelId }, select: { laundryExpressPct: true } });
      const totals = laundryTotals({
        lines: repriceLines(input.lines, new Map(), catalog),
        express: input.express,
        expressPct: money(hotel.laundryExpressPct),
      });
      const reference = await freeReference(tx, hotelId);
      const created = await tx.laundryOrder.create({
        data: {
          hotelId,
          roomId: input.roomId,
          reservationId: input.reservationId,
          reference,
          status: 'RECEIVED',
          express: input.express,
          expressPct: totals.expressPct,
          subtotal: totals.subtotal,
          surcharge: totals.surcharge,
          total: totals.total,
          itemCount: totals.itemCount,
          dueAt: input.dueAt,
          note: input.note ?? null,
          requestId: input.requestId,
          businessDate: dayStart(businessDate),
          receivedBy: actor,
          receivedAt: now,
          statusChangedAt: now,
          statusChangedBy: actor,
          lines: { create: totals.lines.map((line) => lineRow(hotelId, line)) },
        },
        select: { id: true, reference: true, status: true, express: true, total: true, itemCount: true, dueAt: true },
      });
      await recordAudit(tx, { hotelId, entity: 'LaundryOrder', entityId: created.id, action: 'CREATE', after: orderAudit(created) });
      await stage('laundry.order.changed', { hotelId, orderId: created.id, roomId: input.roomId, reservationId: input.reservationId, status: 'RECEIVED' });
      return { id: created.id, created: true };
    });
    return { order: await readOrder(hotelId, outcome.id, now), created: outcome.created };
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {{ itemId: string, name: string, service: string, unitPrice: string, quantity: number, total: string }} line
 */
const lineRow = (hotelId, line) => ({
  hotelId,
  itemId: line.itemId,
  name: line.name,
  service: line.service,
  unitPrice: line.unitPrice,
  quantity: line.quantity,
  total: line.total,
});

/**
 * Kilitli siparişi okur; sürüm damgası tutmuyorsa (başkası değiştirdi) 409.
 * @param {any} tx
 * @param {string} hotelId
 * @param {string} id
 * @param {Date} expectedUpdatedAt
 */
async function lockedOrder(tx, hotelId, id, expectedUpdatedAt) {
  if (!(await lockLaundryOrders(tx, hotelId, [id])).has(id)) throw new NotFoundError('Sipariş bulunamadı');
  const order = await tx.laundryOrder.findFirst({ where: { id, hotelId }, select: { ...ORDER_SELECT, lines: { select: { itemId: true, unitPrice: true } } } });
  if (order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
  return order;
}

/**
 * Sayım düzeltmesi: parça listesi (alındı / yıkamada iken). Siparişte olan
 * parça eski fiyatını korur, yeni eklenen güncel fiyatla; ekspres farkı
 * sipariş anındaki yüzdeyle yeniden hesaplanır.
 *
 * @param {string} hotelId
 * @param {string} id
 * @param {{ expectedUpdatedAt: Date, lines: Array<{ itemId: string, quantity: number }>, note?: string | null }} input
 */
export async function updateLaundryLines(hotelId, id, { expectedUpdatedAt, lines, note }) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const order = await lockedOrder(tx, hotelId, id, expectedUpdatedAt);
      if (!LAUNDRY_EDITABLE_STATUSES.includes(order.status)) {
        throw new ConflictError('Parça listesi yalnızca alındı / yıkamada iken düzeltilir.', 'LAUNDRY_RULE', { status: order.status });
      }
      const catalog = await loadCatalog(
        tx,
        hotelId,
        lines.map((line) => line.itemId).filter((itemId) => !order.lines.some((existing) => existing.itemId === itemId)),
      );
      // Siparişte olan parça fiyat listesinden kalkmış olsa da sayılabilir (eski adı ve fiyatıyla).
      const kept = await tx.laundryOrderLine.findMany({ where: { orderId: id }, select: { itemId: true, name: true, service: true, unitPrice: true } });
      const keptMap = new Map(kept.map((line) => [line.itemId, { unitPrice: money(line.unitPrice) }]));
      for (const line of kept) catalog.set(line.itemId, { name: line.name, service: line.service, price: money(line.unitPrice) });
      const totals = laundryTotals({ lines: repriceLines(lines, keptMap, catalog), express: order.express, expressPct: money(order.expressPct) });

      await tx.laundryOrderLine.deleteMany({ where: { orderId: id } });
      await tx.laundryOrderLine.createMany({ data: totals.lines.map((line) => ({ ...lineRow(hotelId, line), orderId: id })) });
      const updated = await tx.laundryOrder.update({
        where: { id },
        data: {
          subtotal: totals.subtotal,
          surcharge: totals.surcharge,
          total: totals.total,
          itemCount: totals.itemCount,
          ...(note !== undefined ? { note: note ?? null } : {}),
        },
        select: { reference: true, status: true, express: true, total: true, itemCount: true, dueAt: true },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'LaundryOrder',
        entityId: id,
        action: 'UPDATE',
        before: { ...orderAudit(order), lines: order.lines.length },
        after: { ...orderAudit(updated), lines: totals.lines.map((line) => `${line.quantity} × ${line.name}`), recountedBy: actor },
      });
      await stage('laundry.order.changed', { hotelId, orderId: id, roomId: order.roomId, reservationId: order.reservationId, status: order.status });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return readOrder(hotelId, id);
}

/**
 * Durum geçişi. Teslimde ücret folyoya gider (`laundry.charged`; ekspres farkı
 * ayrı satır); iptal gerekçeli ve ücretsiz.
 *
 * @param {string} hotelId
 * @param {string} id
 * @param {{ expectedUpdatedAt: Date, status: 'IN_PROCESS' | 'READY' | 'DELIVERED' | 'CANCELLED', reason?: string | null }} input
 * @param {{ now?: Date }} [options]
 */
export async function changeLaundryStatus(hotelId, id, { expectedUpdatedAt, status, reason }, { now = new Date() } = {}) {
  const actor = currentActor();
  const businessDate = await businessDay(hotelId);
  try {
    await writeWithEvents(async (tx, stage) => {
      const order = await lockedOrder(tx, hotelId, id, expectedUpdatedAt);
      const blocked = laundryTransitionError(order.status, status);
      if (blocked) throw new ConflictError(blocked, 'LAUNDRY_RULE', { status: order.status });

      const data = { status, statusChangedAt: now, statusChangedBy: actor };
      if (status === 'DELIVERED') {
        const lines = await tx.laundryOrderLine.findMany({ where: { orderId: id }, select: { name: true, service: true, unitPrice: true, quantity: true }, orderBy: { name: 'asc' } });
        const items = lines.map((line) => ({
          description: `${line.name} — ${LAUNDRY_SERVICE_LABELS[line.service]}`,
          unitPrice: money(line.unitPrice),
          quantity: line.quantity,
        }));
        if (order.express && Number(order.surcharge) > 0) {
          items.push({ description: `Ekspres farkı (%${pct(order.expressPct)})`, unitPrice: money(order.surcharge), quantity: 1 });
        }
        const event = await stage('laundry.charged', { hotelId, reservationId: order.reservationId, roomId: order.roomId, reference: order.reference, items });
        Object.assign(data, { deliveredAt: now, deliveredBy: actor, deliveredBusinessDate: dayStart(businessDate), chargeEventId: event.id });
      }
      if (status === 'CANCELLED') Object.assign(data, { cancelledAt: now, cancelledBy: actor, cancelReason: reason });

      await tx.laundryOrder.update({ where: { id }, data });
      await recordAudit(tx, {
        hotelId,
        entity: 'LaundryOrder',
        entityId: id,
        action: 'UPDATE',
        before: { status: order.status },
        after: { status, ...(reason ? { reason } : {}), ...(status === 'DELIVERED' ? { charged: money(order.total) } : {}) },
      });
      await stage('laundry.order.changed', { hotelId, orderId: id, roomId: order.roomId, reservationId: order.reservationId, status });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return readOrder(hotelId, id, now);
}

/**
 * Pano: açık (teslim sırasıyla), geciken, teslim edilen (son teslim önce),
 * iptal; oda no, sipariş no ya da misafir adıyla arama. Sayfalı; sayım sınırlı.
 *
 * @param {string} hotelId
 * @param {{ view: 'OPEN' | 'OVERDUE' | 'DELIVERED' | 'CANCELLED', search?: string, page: number, pageSize: number }} query
 * @param {{ now?: Date }} [options]
 */
export async function listLaundryOrders(hotelId, query, { now = new Date() } = {}) {
  const and = [];
  if (query.view === 'OPEN') and.push({ status: { in: [...LAUNDRY_OPEN_STATUSES] } });
  if (query.view === 'OVERDUE') and.push({ status: { in: [...LAUNDRY_OPEN_STATUSES] }, dueAt: { lt: now } });
  if (query.view === 'DELIVERED') and.push({ status: 'DELIVERED' });
  if (query.view === 'CANCELLED') and.push({ status: 'CANCELLED' });
  for (const token of searchTokens(query.search)) {
    const [roomIds, guestIds] = await Promise.all([
      matchRoomIdsByNumber(prisma, hotelId, token),
      isFuzzyToken(token) ? matchGuestIds(prisma, hotelId, token) : Promise.resolve([]),
    ]);
    // Sipariş no tam eşleşir (tekil index; "3XH8PA" ya da "LND-3XH8PA"), oda no tam, misafir adı bulanık.
    const reference = REFERENCE_TOKEN.test(token) ? `LND-${token.toUpperCase().replace(/^LND-/, '')}` : null;
    const or = [];
    if (reference) or.push({ reference });
    if (roomIds.length) or.push({ roomId: { in: roomIds } });
    if (guestIds.length) or.push({ reservation: { guestId: { in: guestIds } } });
    and.push(or.length ? { OR: or } : MATCH_NOTHING);
  }
  const where = { hotelId, AND: and };
  // Teslim ve iptal son durumdur: son değişiklik anı = teslim / iptal anı ((hotelId, status, statusChangedAt, id) index'i).
  const orderBy = ['DELIVERED', 'CANCELLED'].includes(query.view) ? [{ statusChangedAt: 'desc' }, { id: 'desc' }] : [{ dueAt: 'asc' }, { id: 'asc' }];
  const [rows, counted] = await Promise.all([
    prisma.laundryOrder.findMany({ where, orderBy, ...toSkipTake(query), select: ORDER_SELECT }),
    prisma.laundryOrder.count({ where, take: RESERVATION_COUNT_CAP + 1 }),
  ]);
  const posting = await chargePostingStatus(
    hotelId,
    rows.filter((row) => row.status === 'DELIVERED').map((row) => row.chargeEventId),
  );
  const totalCapped = counted > RESERVATION_COUNT_CAP;
  const page = buildPage(
    rows.map((row) => toOrderDto(row, posting, now)),
    totalCapped ? RESERVATION_COUNT_CAP : counted,
    query,
  );
  return { ...page, meta: { ...page.meta, totalCapped } };
}

/**
 * Konaklamanın teslim edilmemiş siparişleri (çıkış penceresinin uyarısı).
 * @param {any} client
 * @param {string} hotelId
 * @param {string} reservationId
 */
export async function openLaundryForStay(client, hotelId, reservationId) {
  const rows = await client.laundryOrder.findMany({
    where: { hotelId, reservationId, status: { in: [...LAUNDRY_OPEN_STATUSES] } },
    select: { id: true, reference: true, status: true, total: true, dueAt: true },
    orderBy: { dueAt: 'asc' },
    take: 20,
  });
  return rows.map((row) => ({ id: row.id, reference: row.reference, status: row.status, total: money(row.total), dueAt: iso(row.dueAt) }));
}
