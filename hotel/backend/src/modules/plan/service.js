import { addDays, nightCount, toIsoDay, toUtcDayStart } from '@hotelos/core';
import { PLAN_SEGMENT_STATUSES } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { NotFoundError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { loadInventorySnapshot } from '../rooms/service.js';
import { buildRoomSegments, planDays, summarizeDays } from './rules.js';

/**
 * Oda planı (rack chart) servisi — "satır oda, sütun gece" ızgarasının verisi.
 *
 * ### Neden ayrı modül
 *
 * Bu bir **okuma modeli**: kendi tablosu yok, oda envanteri (modül 3) ile
 * rezervasyonların (modül 4) kesişimini ekranın istediği şekle sokar. Yazma
 * işlemleri buraya taşınmadı; oda değişikliği `rooms/service.js` →
 * `changeRoom`, çünkü kilitler, overbooking denetimi ve veritabanı garantileri
 * orada tek yerde duruyor.
 *
 * ### Sayfalama ve özet neden ayrı hesaplanıyor
 *
 * 500 odalı bir otelde ızgara satırları sayfalanır (varsayılan 40 oda), ama
 * başlıktaki günlük özet **otelin tamamından** hesaplanır. Aksi hâlde 3.
 * sayfaya geçen resepsiyonist "doluluk %38"den "%91"e çıktığını görürdü.
 *
 * ### Sorgu sayısı
 *
 * Pencere 7 gün de 45 gün de olsa sabit: sayfa odaları + sayım + o odaların
 * rezervasyonları + arıza kayıtları + otel geneli anlık görüntü. Gün başına
 * sorgu atılmaz.
 */

/** Bar etiketinde ve satır başlığında görünen oda tipi alanları. */
const ROOM_TYPE_SUMMARY = Object.freeze({ code: true, name: true });

/** Rezervasyon barında gösterilecek alanlar — ızgara için gerekenin fazlası taşınmaz. */
const SEGMENT_RESERVATION_SELECT = Object.freeze({
  id: true,
  confirmationCode: true,
  roomId: true,
  roomTypeId: true,
  checkIn: true,
  checkOut: true,
  status: true,
  adults: true,
  children: true,
  guest: { select: { firstName: true, lastName: true } },
  roomType: { select: ROOM_TYPE_SUMMARY },
});

/** @param {Date} date */
const isoDay = (date) => toIsoDay(date);

/**
 * Verilen günü kapsayan arıza kaydı filtresi (ilişki filtrelerinde soft-delete
 * eklentisi devreye girmiyor, `deletedAt` elle yazılı).
 * @param {Date} day
 */
function activeBlockWhere(day) {
  return { deletedAt: null, startDate: { lte: day }, OR: [{ endDate: null }, { endDate: { gt: day } }] };
}

/**
 * @param {string | undefined} condition
 * @param {Date} businessDate
 */
function conditionWhere(condition, businessDate) {
  if (!condition) return {};
  if (condition === 'IN_SERVICE') return { blocks: { none: activeBlockWhere(businessDate) } };
  return { blocks: { some: { ...activeBlockWhere(businessDate), type: condition } } };
}

/**
 * Izgara barı: rezervasyonun ekranda görünen hâli.
 * @param {object} row
 * @param {{ roomTypeId: string }} room
 */
function toSegmentDto(row, room) {
  return {
    id: row.id,
    confirmationCode: row.confirmationCode,
    guestName: row.guest ? `${row.guest.firstName} ${row.guest.lastName}`.trim() : null,
    status: row.status,
    checkIn: isoDay(row.checkIn),
    checkOut: isoDay(row.checkOut),
    nights: nightCount(row.checkIn, row.checkOut),
    adults: row.adults,
    children: row.children,
    roomTypeCode: row.roomType?.code ?? null,
    // Misafir başka tipte satın alıp bu odaya yerleşmişse ızgarada işaretlenir:
    // fiyat farkı ve "neden Suit'te STD misafiri var" sorusu buradan görünür.
    typeMismatch: row.roomTypeId !== room.roomTypeId,
    startIndex: row.startIndex,
    span: row.span,
    continuesBefore: row.continuesBefore,
    continuesAfter: row.continuesAfter,
  };
}

/** @param {object} row */
function toBlockSegmentDto(row) {
  return {
    id: row.id,
    type: row.type,
    reason: row.reason,
    startDate: isoDay(row.startDate),
    endDate: row.endDate ? isoDay(row.endDate) : null,
    startIndex: row.startIndex,
    span: row.span,
    continuesBefore: row.continuesBefore,
    continuesAfter: row.continuesAfter,
  };
}

/**
 * Oda planı ızgarası.
 *
 * @param {string} hotelId
 * @param {{
 *   from: Date, days: number, page: number, pageSize: number,
 *   search?: string, roomTypeId?: string, floor?: number,
 *   occupancy?: string, housekeepingStatus?: string, condition?: string,
 * }} query
 */
export async function getRoomPlan(hotelId, query) {
  const businessDate = await getBusinessDate(hotelId);
  const from = new Date(toUtcDayStart(query.from));
  const to = addDays(from, query.days);

  const where = {
    hotelId,
    ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
    ...(query.occupancy ? { occupancy: query.occupancy } : {}),
    ...(query.housekeepingStatus ? { housekeepingStatus: query.housekeepingStatus } : {}),
    ...(query.floor !== undefined ? { floor: query.floor } : {}),
    ...(query.search ? { number: { contains: query.search, mode: 'insensitive' } } : {}),
    ...conditionWhere(query.condition, businessDate),
  };

  const [rooms, total] = await prisma.$transaction([
    prisma.room.findMany({
      where,
      select: {
        id: true,
        number: true,
        floor: true,
        roomTypeId: true,
        occupancy: true,
        housekeepingStatus: true,
        roomType: { select: ROOM_TYPE_SUMMARY },
        // Bugünün arıza kaydı: satır başındaki rozet (ızgaradaki bar ileri
        // tarihli olabilir, bu "şu an" bilgisidir).
        blocks: { where: activeBlockWhere(businessDate), orderBy: { startDate: 'desc' }, take: 1 },
      },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.room.count({ where }),
  ]);

  const roomIds = rooms.map((room) => room.id);

  const [reservations, blocks, snapshot] = await Promise.all([
    roomIds.length === 0
      ? []
      : prisma.reservation.findMany({
          where: {
            hotelId,
            roomId: { in: roomIds },
            // İptal ve gelmedi kayıtları çizilmez (odayı tutmuyorlar); çıkış
            // yapmış kayıt çizilir — dün kimin kaldığı temizlik ve oda
            // değişikliği kararında lazım.
            status: { in: [...PLAN_SEGMENT_STATUSES] },
            checkIn: { lt: to },
            checkOut: { gt: from },
          },
          select: SEGMENT_RESERVATION_SELECT,
        }),
    roomIds.length === 0
      ? []
      : prisma.roomBlock.findMany({
          where: {
            hotelId,
            roomId: { in: roomIds },
            startDate: { lt: to },
            OR: [{ endDate: null }, { endDate: { gt: from } }],
          },
          select: { id: true, roomId: true, type: true, startDate: true, endDate: true, reason: true },
        }),
    // Özet otelin tamamından: sayfaya göre değişen doluluk yüzdesi yanlış olur.
    loadInventorySnapshot(prisma, hotelId, from, to),
  ]);

  const segments = buildRoomSegments({ rooms, reservations, blocks, from, days: query.days });

  return {
    window: {
      from: isoDay(from),
      days: query.days,
      dates: planDays(from, query.days),
      today: isoDay(businessDate),
    },
    summary: summarizeDays({
      totalRooms: snapshot.rooms.length,
      reservations: snapshot.reservations,
      blocks: snapshot.blocks,
      from,
      days: query.days,
    }),
    ...buildPage(
      rooms.map((room) => {
        const row = segments.get(room.id) ?? { reservations: [], blocks: [] };
        const currentBlock = room.blocks?.[0] ?? null;
        return {
          id: room.id,
          number: room.number,
          floor: room.floor,
          roomTypeId: room.roomTypeId,
          roomTypeCode: room.roomType?.code ?? null,
          roomTypeName: room.roomType?.name ?? null,
          occupancy: room.occupancy,
          housekeepingStatus: room.housekeepingStatus,
          condition: currentBlock ? currentBlock.type : 'IN_SERVICE',
          reservations: row.reservations.map((entry) => toSegmentDto(entry, room)),
          blocks: row.blocks.map(toBlockSegmentDto),
        };
      }),
      total,
      query,
    ),
    hotelRoomCount: snapshot.rooms.length,
  };
}

/**
 * Pencereye düşen, henüz odası olmayan rezervasyonlar (ızgaranın üstündeki şerit).
 *
 * Bunlar envanteri tüketir ama hiçbir satırda görünmez; sürüklenip bir odaya
 * bırakılmayı bekler. Girişi en yakın olan en acildir, o sırayla döner.
 *
 * @param {string} hotelId
 * @param {{ from: Date, days: number, status?: string, limit: number }} query
 */
export async function getUnassignedForWindow(hotelId, query) {
  const from = new Date(toUtcDayStart(query.from));
  const to = addDays(from, query.days);

  const where = {
    hotelId,
    roomId: null,
    status: query.status ? { equals: query.status } : { in: ['PENDING', 'CONFIRMED'] },
    checkIn: { lt: to },
    checkOut: { gt: from },
  };

  const [rows, total] = await prisma.$transaction([
    prisma.reservation.findMany({
      where,
      select: SEGMENT_RESERVATION_SELECT,
      orderBy: [{ checkIn: 'asc' }],
      take: query.limit,
    }),
    prisma.reservation.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      confirmationCode: row.confirmationCode,
      guestName: row.guest ? `${row.guest.firstName} ${row.guest.lastName}`.trim() : null,
      status: row.status,
      checkIn: isoDay(row.checkIn),
      checkOut: isoDay(row.checkOut),
      nights: nightCount(row.checkIn, row.checkOut),
      adults: row.adults,
      children: row.children,
      roomTypeId: row.roomTypeId,
      roomTypeCode: row.roomType?.code ?? null,
      roomTypeName: row.roomType?.name ?? null,
    })),
    total,
    shown: rows.length,
  };
}

/**
 * Izgaradaki bara tıklayınca açılan detay.
 *
 * Modül 4'ün rezervasyon detay ekranı gelene kadar personelin bir konaklamayı
 * tek yerde gördüğü sayfa burası. Folyo bakiyesi (modül 15) ve misafir iletişimi
 * de gösteriliyor, çünkü "oda değiştireyim mi" kararını veren kişi bunları sorar.
 *
 * `actions`, ekranın düğmeleri açıp kapatması için: kuralı iki yerde (sunucu +
 * React) tekrar yazmak yerine sunucu ne yapılabileceğini söyler.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 */
export async function getReservationDetail(hotelId, reservationId) {
  const [row, businessDate] = await Promise.all([
    prisma.reservation.findFirst({
      where: { id: reservationId, hotelId },
      include: {
        guest: {
          select: { id: true, firstName: true, lastName: true, phone: true, email: true, nationality: true },
        },
        roomType: {
          select: { id: true, code: true, name: true, capacityAdults: true, capacityChildren: true },
        },
        room: {
          select: { id: true, number: true, floor: true, occupancy: true, housekeepingStatus: true },
        },
        folios: {
          select: { id: true, status: true, balance: true, currency: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    }),
    getBusinessDate(hotelId),
  ]);
  if (!row) throw new NotFoundError('Rezervasyon bulunamadı');

  const stayEnded = toUtcDayStart(row.checkOut) <= businessDate.getTime();
  const folio = row.folios[0] ?? null;

  return {
    id: row.id,
    confirmationCode: row.confirmationCode,
    status: row.status,
    source: row.source,
    boardType: row.boardType,
    checkIn: isoDay(row.checkIn),
    checkOut: isoDay(row.checkOut),
    nights: nightCount(row.checkIn, row.checkOut),
    adults: row.adults,
    children: row.children,
    // Para uçtan uca string taşınır (bkz. contracts/fields.js).
    totalPrice: row.totalPrice.toString(),
    currency: row.currency,
    notes: row.notes,
    guest: row.guest,
    roomType: row.roomType,
    room: row.room,
    folio: folio ? { ...folio, balance: folio.balance.toString() } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    actions: {
      canChangeRoom: !stayEnded && ['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(row.status),
      canUnassign: Boolean(row.roomId) && ['PENDING', 'CONFIRMED'].includes(row.status),
      // Düğme kapalıysa kullanıcı "neden" diye sorar; cevabı ekrana basılabilsin.
      reason: stayEnded
        ? 'Konaklama sona ermiş'
        : ['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(row.status)
          ? null
          : 'Rezervasyon durumu işleme kapalı',
    },
  };
}
