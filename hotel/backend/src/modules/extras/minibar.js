import { currentActor, toIsoDay, toMoneyString } from '@hotelos/core';
import { LAUNDRY_OPEN_STATUSES, MINIBAR_LATE_CHARGE_HOURS, MINIBAR_ROOM_RECENT_LIMIT } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { encodeCursor, olderThan, parseCursor } from '../../lib/cursor.js';
import { ConflictError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockReservations, lockRooms } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { guestFullName } from '../reservations/guests.js';
import { chargePostingStatus } from './posting-status.js';
import { chargeItems, chargeTargetError, chargeableStays, lineTotals, newReference } from './rules.js';

/**
 * Minibar tüketimi (modül 19).
 *
 * Kat görevlisi odayı açar (numarayla), ekran odadaki misafiri ve odadan son
 * 24 saatte ayrılanları (çıkış yapan ya da başka odaya taşınan) gösterir.
 * Sayım bir "fiş"tir:
 *
 * - **Odadaki misafire** ya da **ayrılan misafire (geç kalem)** yazılırsa fiş
 *   `minibar.consumed` olayıyla folyoya gider; folyo aktörü kalemleri işler
 *   (vergi otelin minibar vergisiyle, yönlendirmeye uyar, olay iki kez gelse de
 *   tek yazılır). Ayrılan misafirin açık folyosu yoksa iş folyo yetkilisine
 *   görev olarak düşer (yeniden açıp işler ya da kayıp yazar).
 * - **Kayıp:** kimseye yazılmaz (boş odada eksik, ikram); gerekçe zorunlu.
 *
 * Fiş silinmez, değiştirilmez: yanlış adet folyodaki kalem iptaliyle (onaylı)
 * düzeltilir. Ekran, aynı odaya son 24 saatte yapılan sayımları gösterir (iki
 * görevlinin aynı odayı iki kez yazmasına karşı); istek kimliği çift gönderimi
 * engeller.
 *
 * ### Kilit sırası
 *
 * Rezervasyon → oda (bkz. `lib/locks.js`): odadaki misafir kilit altında
 * yeniden çözülür; bu arada çıkış ya da oda değişimi olduysa fiş yazılmaz.
 */

const iso = (value) => (value ? value.toISOString() : null);
/** Prisma Decimal → "1234.50" (bütün modüllerdeki gibi iki ondalık). */
const money = (value) => (value === null || value === undefined ? null : toMoneyString(String(value)));

const STAY_SELECT = Object.freeze({
  id: true,
  confirmationCode: true,
  status: true,
  roomId: true,
  checkIn: true,
  checkOut: true,
  checkedOutAt: true,
  room: { select: { number: true } },
  guest: { select: { firstName: true, lastName: true } },
});

/** @param {any} stay */
const stayDto = (stay) =>
  stay
    ? {
        id: stay.id,
        confirmationCode: stay.confirmationCode,
        status: stay.status,
        guestName: guestFullName(stay.guest),
        roomNumber: stay.room?.number ?? null,
        checkIn: toIsoDay(stay.checkIn),
        checkOut: toIsoDay(stay.checkOut),
        checkedOutAt: iso(stay.checkedOutAt),
      }
    : null;

/** @param {string} hotelId */
async function businessDay(hotelId) {
  return toIsoDay(await getBusinessDate(hotelId));
}

/**
 * Odaya yazılabilecek konaklamalar (kilitli ya da kilitsiz okuma): içerideki
 * misafir, son saatlerde çıkış yapanlar ve başka odaya taşınanlar.
 *
 * @param {any} client
 * @param {string} hotelId
 * @param {string} roomId
 * @param {Date} now
 */
async function roomStays(client, hotelId, roomId, now) {
  const since = new Date(now.getTime() - MINIBAR_LATE_CHARGE_HOURS * 60 * 60 * 1000);
  const [inHouse, checkedOut, moved] = await Promise.all([
    client.reservation.findFirst({ where: { hotelId, roomId, status: 'CHECKED_IN' }, select: STAY_SELECT }),
    client.reservation.findMany({
      where: { hotelId, roomId, status: 'CHECKED_OUT', checkedOutAt: { gte: since } },
      select: STAY_SELECT,
      orderBy: { checkedOutAt: 'desc' },
      take: 3,
    }),
    // Bu odadan başka odaya taşınan (hâlâ içeride) misafir: dilim taşıma anında yazılır.
    client.roomStaySegment.findMany({
      where: { hotelId, roomId, createdAt: { gte: since }, reservation: { status: 'CHECKED_IN' } },
      select: { createdAt: true, reservation: { select: STAY_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
  ]);
  const stays = chargeableStays({
    inHouse,
    checkedOut: checkedOut.map((stay) => ({ id: stay.id, at: stay.checkedOutAt })),
    movedOut: moved.map((segment) => ({ id: segment.reservation.id, at: segment.createdAt })),
    now,
  });
  const byId = new Map([...checkedOut, ...moved.map((segment) => segment.reservation)].map((stay) => [stay.id, stay]));
  return {
    ...stays,
    inHouse,
    late: stays.lateIds.map((id) => byId.get(id)),
  };
}

/**
 * Giriş ekranı: oda, odadaki ve odadan yeni ayrılan misafirler, son 24 saatin
 * sayımları, açık çamaşır siparişi sayısı.
 *
 * @param {string} hotelId
 * @param {{ number: string }} query
 * @param {{ now?: Date }} [options]
 */
export async function lookupRoom(hotelId, { number }, { now = new Date() } = {}) {
  const ROOM_SELECT = { id: true, number: true, floor: true, occupancy: true, housekeepingStatus: true, roomType: { select: { code: true, name: true } } };
  // Önce tam eşleşme ((hotelId, number) index'i); harf büyüklüğü farklı yazıldıysa ("a12") duyarsız.
  const room =
    (await prisma.room.findFirst({ where: { hotelId, number: number.trim() }, select: ROOM_SELECT })) ??
    (await prisma.room.findFirst({ where: { hotelId, number: { equals: number.trim(), mode: 'insensitive' } }, select: ROOM_SELECT }));
  if (!room) throw new NotFoundError(`${number} numaralı oda bulunamadı`);
  const since = new Date(now.getTime() - MINIBAR_LATE_CHARGE_HOURS * 60 * 60 * 1000);
  const [stays, recent, openLaundry, businessDate] = await Promise.all([
    roomStays(prisma, hotelId, room.id, now),
    prisma.minibarConsumption.findMany({
      where: { hotelId, roomId: room.id, recordedAt: { gte: since } },
      select: CONSUMPTION_SELECT,
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take: MINIBAR_ROOM_RECENT_LIMIT,
    }),
    prisma.laundryOrder.count({ where: { hotelId, roomId: room.id, status: { in: [...LAUNDRY_OPEN_STATUSES] } } }),
    businessDay(hotelId),
  ]);
  return {
    businessDate,
    room: {
      id: room.id,
      number: room.number,
      floor: room.floor,
      occupancy: room.occupancy,
      housekeepingStatus: room.housekeepingStatus,
      roomType: room.roomType,
    },
    inHouse: stayDto(stays.inHouse),
    late: stays.late.map((stay) => ({
      ...stayDto(stay),
      // Çıkış yaptıysa çıkış anı; hâlâ içerideyse (taşındı) şimdiki odası.
      reason: stay.status === 'CHECKED_OUT' ? 'CHECKED_OUT' : 'MOVED',
    })),
    recent: await withPostingStatus(hotelId, recent),
    openLaundry,
  };
}

const CONSUMPTION_SELECT = Object.freeze({
  id: true,
  roomId: true,
  reservationId: true,
  chargeTarget: true,
  reference: true,
  businessDate: true,
  totalAmount: true,
  itemCount: true,
  lossReason: true,
  note: true,
  eventId: true,
  recordedBy: true,
  recordedAt: true,
  room: { select: { number: true } },
  reservation: { select: { id: true, confirmationCode: true, guest: { select: { firstName: true, lastName: true } } } },
  lines: { select: { itemId: true, name: true, unitPrice: true, quantity: true, total: true }, orderBy: { name: 'asc' } },
});

/**
 * Fişler ve folyo durumları (sayfa başına iki ek sorgu).
 * @param {string} hotelId
 * @param {any[]} rows
 */
async function withPostingStatus(hotelId, rows) {
  const status = await chargePostingStatus(hotelId, rows.map((row) => row.eventId));
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    roomId: row.roomId,
    roomNumber: row.room?.number ?? null,
    chargeTarget: row.chargeTarget,
    stay: row.reservation
      ? { id: row.reservation.id, confirmationCode: row.reservation.confirmationCode, guestName: guestFullName(row.reservation.guest) }
      : null,
    businessDate: toIsoDay(row.businessDate),
    totalAmount: money(row.totalAmount),
    itemCount: row.itemCount,
    lossReason: row.lossReason ?? null,
    note: row.note ?? null,
    recordedBy: row.recordedBy,
    recordedAt: iso(row.recordedAt),
    lines: row.lines.map((line) => ({ ...line, unitPrice: money(line.unitPrice), total: money(line.total) })),
    posting: row.chargeTarget === 'NONE' ? { status: 'LOSS' } : (status.get(row.eventId) ?? { status: 'PENDING' }),
  }));
}

/**
 * Sayım fişini yazar. Hedef (odadaki / ayrılan misafir / kayıp) ekranın
 * seçtiğidir; oda kilit altında yeniden çözülür, bu arada misafir değiştiyse
 * fiş yazılmaz (`STAY_CHANGED`). Aynı istek kimliğiyle ikinci gönderim yeni
 * fiş açmaz.
 *
 * @param {string} hotelId
 * @param {object} input `minibarConsumptionSchema` çıktısı
 * @param {{ now?: Date }} [options]
 * @returns {Promise<{ consumption: object, created: boolean }>}
 */
export async function recordConsumption(hotelId, input, { now = new Date() } = {}) {
  const businessDate = await businessDay(hotelId);
  const actor = currentActor();
  try {
    const outcome = await writeWithEvents(async (tx, stage) => {
      const existing = await tx.minibarConsumption.findFirst({ where: { hotelId, requestId: input.requestId }, select: { id: true } });
      if (existing) return { id: existing.id, created: false };

      // Kilit sırası: rezervasyon → oda.
      if (input.reservationId && !(await lockReservations(tx, hotelId, [input.reservationId])).has(input.reservationId)) {
        throw new NotFoundError('Konaklama bulunamadı; odayı yeniden açın.');
      }
      if (!(await lockRooms(tx, hotelId, [input.roomId])).has(input.roomId)) throw new NotFoundError('Oda bulunamadı');
      const stays = await roomStays(tx, hotelId, input.roomId, now);
      const blocked = chargeTargetError(input, stays);
      if (blocked) throw new ConflictError(blocked, 'STAY_CHANGED');

      const items = await tx.minibarItem.findMany({
        where: { hotelId, id: { in: input.lines.map((line) => line.itemId) }, active: true },
        select: { id: true, name: true, price: true },
      });
      const byId = new Map(items.map((item) => [item.id, item]));
      const missing = input.lines.find((line) => !byId.has(line.itemId));
      if (missing) throw new ValidationError('Seçilen ürünlerden biri satıştan kalkmış; listeyi yenileyin.', { field: 'lines' });

      const priced = lineTotals(
        input.lines.map((line) => ({ itemId: line.itemId, name: byId.get(line.itemId).name, unitPrice: money(byId.get(line.itemId).price), quantity: line.quantity })),
      );
      const reference = await freeReference(tx, hotelId);
      const charged = input.chargeTo !== 'NONE';
      const event = charged
        ? await stage('minibar.consumed', {
            hotelId,
            reservationId: input.reservationId,
            roomId: input.roomId,
            reference,
            items: chargeItems(priced.lines),
          })
        : null;

      const created = await tx.minibarConsumption.create({
        data: {
          hotelId,
          roomId: input.roomId,
          reservationId: charged ? input.reservationId : null,
          chargeTarget: input.chargeTo,
          reference,
          businessDate: new Date(`${businessDate}T00:00:00.000Z`),
          totalAmount: priced.total,
          itemCount: priced.itemCount,
          lossReason: charged ? null : input.lossReason,
          note: input.note ?? null,
          requestId: input.requestId,
          eventId: event?.id ?? null,
          recordedBy: actor,
          recordedAt: now,
          lines: {
            create: priced.lines.map((line) => ({
              hotelId,
              itemId: line.itemId,
              name: line.name,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              total: line.total,
            })),
          },
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'MinibarConsumption',
        entityId: created.id,
        action: 'CREATE',
        after: {
          reference,
          roomId: input.roomId,
          chargeTarget: input.chargeTo,
          reservationId: charged ? input.reservationId : null,
          total: priced.total,
          lines: priced.lines.map((line) => `${line.quantity} × ${line.name}`),
          lossReason: charged ? null : input.lossReason,
        },
      });
      await stage('minibar.recorded', {
        hotelId,
        consumptionId: created.id,
        roomId: input.roomId,
        reservationId: charged ? input.reservationId : null,
        chargeTarget: input.chargeTo,
      });
      return { id: created.id, created: true };
    });
    return { consumption: await readConsumption(hotelId, outcome.id), created: outcome.created };
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Otelde boşta bir fiş numarası (çakışma olasılığı çok düşük; tekil kısıt son savunma).
 * @param {any} tx
 * @param {string} hotelId
 */
async function freeReference(tx, hotelId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = newReference('MB');
    if (!(await tx.minibarConsumption.findFirst({ where: { hotelId, reference }, select: { id: true } }))) return reference;
  }
  throw new ConflictError('Fiş numarası üretilemedi; tekrar deneyin.', 'REFERENCE_BUSY');
}

/** @param {string} hotelId @param {string} id */
async function readConsumption(hotelId, id) {
  const row = await prisma.minibarConsumption.findFirst({ where: { id, hotelId }, select: CONSUMPTION_SELECT });
  if (!row) throw new NotFoundError('Fiş bulunamadı');
  return (await withPostingStatus(hotelId, [row]))[0];
}

/**
 * Günün fişleri (son girilen önce), imleçli; oda süzgeci.
 * @param {string} hotelId
 * @param {{ date?: string, roomId?: string, cursor?: string, limit: number }} query
 */
export async function listConsumptions(hotelId, query) {
  const date = query.date ?? (await businessDay(hotelId));
  const cursor = parseCursor(query.cursor);
  const rows = await prisma.minibarConsumption.findMany({
    where: {
      hotelId,
      businessDate: new Date(`${date}T00:00:00.000Z`),
      ...(query.roomId ? { roomId: query.roomId } : {}),
      ...(cursor ? olderThan('recordedAt', cursor) : {}),
    },
    select: CONSUMPTION_SELECT,
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    date,
    consumptions: await withPostingStatus(hotelId, page),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.recordedAt, id: last.id }) : null,
  };
}
