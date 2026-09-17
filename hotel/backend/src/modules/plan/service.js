import { addDays, nightCount, toIsoDay, toUtcDayStart } from '@hotelos/core';
import { PLAN_ASSIGNABLE_STATUSES, PLAN_SEGMENT_STATUSES } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { NotFoundError } from '../../lib/errors.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { buildPage } from '../../lib/pagination.js';
import { createReadCache } from '../../lib/read-cache.js';
import { containsText, isFuzzyToken, MATCH_NOTHING, matchGuestIds, searchTokens } from '../../lib/search.js';
import { naturalRoomPage } from '../rooms/service.js';
import { buildRoomSegments, planDays, summarizeDays } from './rules.js';

/**
 * Oda planı (rack chart) servisi — "satır oda, sütun gece" ızgarasının verisi.
 *
 * ### Neden ayrı modül
 *
 * Bu bir **okuma modeli**: kendi tablosu yok, oda envanteri (modül 3) ile
 * rezervasyonların (modül 4) kesişimini ekranın istediği şekle sokar. Yazma
 * işlemleri `rooms/service.js`'te (`changeRoom`), çünkü kilitler, overbooking
 * denetimi ve veritabanı garantileri orada tek yerde duruyor.
 *
 * ### Sayfalama ve özet neden ayrı hesaplanıyor
 *
 * 500 odalı bir otelde ızgara satırları sayfalanır (varsayılan 40 oda), ama
 * başlıktaki günlük özet **otelin tamamından** hesaplanır. Aksi hâlde 3.
 * sayfaya geçen resepsiyonist doluluğun değiştiğini görürdü.
 *
 * ### Yük
 *
 * Bir hesaplama pencere boyundan bağımsız ~9 sorgudur. Ekran canlıdır: bir
 * değişiklik tüm açık panellerin aynı anda yenilemesine yol açar. Cevaplar
 * otelin envanter sürümüyle anahtarlanıp önbelleğe alınır ve eşzamanlı aynı
 * istekler tek hesaplamada birleşir (`lib/read-cache.js`). Önbellek bayat veri
 * vermez: envanteri değiştiren her event sürümü artırır.
 */

/** Önbellekteki bir cevabın en uzun ömrü — event'siz değişikliklere karşı güvenlik ağı. */
const PLAN_CACHE_TTL_MS = 15_000;

/** Aynı anda tutulacak en fazla farklı görünüm (otel × pencere × filtre × sayfa). */
const PLAN_CACHE_MAX_ENTRIES = 500;

const planCache = createReadCache({ ttlMs: PLAN_CACHE_TTL_MS, maxEntries: PLAN_CACHE_MAX_ENTRIES });

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
  roomSince: true,
  status: true,
  adults: true,
  children: true,
  guest: { select: { firstName: true, lastName: true } },
  roomType: { select: ROOM_TYPE_SUMMARY },
});

/** Özet hesabının ihtiyacı: kim, hangi odada, hangi geceler. */
const SUMMARY_RESERVATION_SELECT = Object.freeze({
  id: true,
  roomId: true,
  checkIn: true,
  checkOut: true,
  roomSince: true,
  status: true,
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
 * Arama: tek kelimede oda numarası da eşleşir; her kelime misafirin adında,
 * soyadında ya da onay kodunda geçmeli ("ayşe yıl" → Ayşe Yılmaz). Misafir
 * eşleşmesi yalnızca **pencereye düşen** konaklamalarda aranır — ızgarada
 * görünmeyecek bir konaklama için odayı listelemek kafa karıştırır.
 *
 * Konaklamalar önce bulunur, oda sorgusu onların odalarıyla süzülür (ilişki
 * filtresi büyük tabloyu baştan sona birleştiriyordu; bkz. `lib/search.js`).
 * Üç harften kısa kelimeler yalnızca oda numarasında aranır.
 *
 * @param {string} hotelId
 * @param {string | undefined} search
 * @param {{ from: Date, to: Date }} window
 */
async function searchWhere(hotelId, search, { from, to }) {
  const tokens = searchTokens(search);
  if (tokens.length === 0) return {};

  const or = tokens.length === 1 ? [{ number: containsText(tokens[0]) }] : [];
  const fuzzy = tokens.filter(isFuzzyToken);
  if (fuzzy.length > 0) {
    const tokenFilters = await Promise.all(
      fuzzy.map(async (token) => {
        const guestIds = await matchGuestIds(prisma, hotelId, token);
        return {
          OR: [
            { confirmationCode: containsText(token) },
            ...(guestIds.length > 0 ? [{ guestId: { in: guestIds } }] : []),
          ],
        };
      }),
    );
    const stays = await prisma.reservation.findMany({
      where: {
        hotelId,
        roomId: { not: null },
        status: { in: [...PLAN_SEGMENT_STATUSES] },
        checkIn: { lt: to },
        checkOut: { gt: from },
        AND: tokenFilters,
      },
      select: { roomId: true },
    });
    const roomIds = [...new Set(stays.map((stay) => stay.roomId))];
    if (roomIds.length > 0) or.push({ id: { in: roomIds } });
  }
  return or.length > 0 ? { OR: or } : MATCH_NOTHING;
}

/** @param {{ guest?: { firstName: string, lastName: string } | null }} row */
const guestNameOf = (row) => (row.guest ? `${row.guest.firstName} ${row.guest.lastName}`.trim() : null);

/**
 * Izgara barı: rezervasyonun (ya da kapanmış dilimin) ekranda görünen hâli.
 * @param {object} row
 * @param {{ roomTypeId: string }} room
 */
function toBarDto(row, room) {
  return {
    key: row.key,
    id: row.id,
    segmentId: row.segmentId,
    confirmationCode: row.confirmationCode,
    guestName: guestNameOf(row),
    status: row.status,
    checkIn: isoDay(row.checkIn),
    checkOut: isoDay(row.checkOut),
    // Bu barın bu odada kapladığı geceler (oda değiştirmiş konaklamada
    // konaklamanın yalnızca bir kısmı).
    sliceFrom: isoDay(new Date(toUtcDayStart(row.sliceFrom))),
    sliceTo: isoDay(new Date(toUtcDayStart(row.sliceTo))),
    nights: nightCount(row.checkIn, row.checkOut),
    adults: row.adults,
    children: row.children,
    roomTypeCode: row.roomType?.code ?? null,
    // Misafir başka tipte satın alıp bu odaya yerleşmişse ızgarada işaretlenir.
    typeMismatch: row.roomTypeId !== room.roomTypeId,
    // Oda değişikliği: bu odaya sonradan geldi / buradan başka odaya gitti.
    movedIn: row.movedIn,
    movedOut: row.movedOut,
    moveReason: row.segmentReason ?? null,
    startIndex: row.startIndex,
    span: row.span,
    continuesBefore: row.continuesBefore,
    continuesAfter: row.continuesAfter,
  };
}

/** @param {object} row */
function toBlockBarDto(row) {
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
 * Pencereyle kesişen aralık filtresi (yarı açık).
 * @param {{ from: Date, to: Date }} window
 */
const stayOverlap = ({ from, to }) => ({ checkIn: { lt: to }, checkOut: { gt: from } });

/** @param {{ from: Date, to: Date }} window */
const rangeOverlap = ({ from, to }) => ({ startDate: { lt: to }, endDate: { gt: from } });

/**
 * Otelin tamamı için özet girdileri: oda sayısı, konaklamalar (çıkış
 * yapmışlar dahil), arıza kayıtları ve kapanmış oda dilimleri.
 *
 * @param {string} hotelId
 * @param {{ from: Date, to: Date }} window
 */
async function loadSummarySource(hotelId, window) {
  const [totalRooms, reservations, blocks, segments] = await Promise.all([
    prisma.room.count({ where: { hotelId } }),
    prisma.reservation.findMany({
      where: { hotelId, status: { in: [...PLAN_SEGMENT_STATUSES] }, ...stayOverlap(window) },
      select: SUMMARY_RESERVATION_SELECT,
    }),
    prisma.roomBlock.findMany({
      where: {
        hotelId,
        startDate: { lt: window.to },
        OR: [{ endDate: null }, { endDate: { gt: window.from } }],
      },
      select: { roomId: true, type: true, startDate: true, endDate: true },
    }),
    prisma.roomStaySegment.findMany({
      where: { hotelId, ...rangeOverlap(window) },
      select: { reservationId: true, roomId: true, startDate: true, endDate: true },
    }),
  ]);
  return { totalRooms, reservations, blocks, segments };
}

/**
 * Oda planı ızgarası (önbellekli).
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
  const key = JSON.stringify([
    'plan',
    hotelId,
    liveVersion(LIVE_SCOPES.INVENTORY, hotelId),
    isoDay(businessDate),
    isoDay(new Date(toUtcDayStart(query.from))),
    query.days,
    query.page,
    query.pageSize,
    query.search ?? '',
    query.roomTypeId ?? '',
    query.floor ?? '',
    query.occupancy ?? '',
    query.housekeepingStatus ?? '',
    query.condition ?? '',
  ]);
  return planCache.get(key, () => computeRoomPlan(hotelId, query, businessDate));
}

/**
 * @param {string} hotelId
 * @param {Parameters<typeof getRoomPlan>[1]} query
 * @param {Date} businessDate
 */
async function computeRoomPlan(hotelId, query, businessDate) {
  const from = new Date(toUtcDayStart(query.from));
  const to = addDays(from, query.days);
  const window = { from, to };

  const where = {
    hotelId,
    ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
    ...(query.occupancy ? { occupancy: query.occupancy } : {}),
    ...(query.housekeepingStatus ? { housekeepingStatus: query.housekeepingStatus } : {}),
    ...(query.floor !== undefined ? { floor: query.floor } : {}),
    AND: [conditionWhere(query.condition, businessDate), await searchWhere(hotelId, query.search, window)],
  };

  const [{ ids, total }, summarySource] = await Promise.all([
    naturalRoomPage(prisma, where, query),
    loadSummarySource(hotelId, window),
  ]);

  const [roomRows, reservations, blocks, segments] =
    ids.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          prisma.room.findMany({
            where: { id: { in: ids } },
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
          }),
          prisma.reservation.findMany({
            where: {
              hotelId,
              roomId: { in: ids },
              // İptal ve gelmedi çizilmez (odayı tutmuyorlar); çıkış yapmış
              // çizilir — dün kimin kaldığı temizlik ve oda kararında lazım.
              status: { in: [...PLAN_SEGMENT_STATUSES] },
              ...stayOverlap(window),
            },
            select: SEGMENT_RESERVATION_SELECT,
          }),
          prisma.roomBlock.findMany({
            where: {
              hotelId,
              roomId: { in: ids },
              startDate: { lt: to },
              OR: [{ endDate: null }, { endDate: { gt: from } }],
            },
            select: { id: true, roomId: true, type: true, startDate: true, endDate: true, reason: true },
          }),
          prisma.roomStaySegment.findMany({
            where: {
              hotelId,
              roomId: { in: ids },
              ...rangeOverlap(window),
              reservation: { status: { in: [...PLAN_SEGMENT_STATUSES] }, deletedAt: null },
            },
            select: {
              id: true,
              roomId: true,
              startDate: true,
              endDate: true,
              reason: true,
              reservation: { select: SEGMENT_RESERVATION_SELECT },
            },
          }),
        ]);

  const roomById = new Map(roomRows.map((room) => [room.id, room]));
  const rooms = ids.map((id) => roomById.get(id)).filter(Boolean);
  const bars = buildRoomSegments({ rooms, reservations, blocks, segments, from, days: query.days });

  return {
    window: {
      from: isoDay(from),
      days: query.days,
      dates: planDays(from, query.days),
      today: isoDay(businessDate),
    },
    summary: summarizeDays({ ...summarySource, from, days: query.days, businessDate }),
    ...buildPage(
      rooms.map((room) => {
        const row = bars.get(room.id) ?? { reservations: [], blocks: [] };
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
          reservations: row.reservations.map((entry) => toBarDto(entry, room)),
          blocks: row.blocks.map(toBlockBarDto),
        };
      }),
      total,
      query,
    ),
    hotelRoomCount: summarySource.totalRooms,
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
  const key = JSON.stringify([
    'unassigned',
    hotelId,
    liveVersion(LIVE_SCOPES.INVENTORY, hotelId),
    isoDay(from),
    query.days,
    query.status ?? '',
    query.limit,
  ]);
  return planCache.get(key, () => computeUnassigned(hotelId, { ...query, from }));
}

/**
 * @param {string} hotelId
 * @param {{ from: Date, days: number, status?: string, limit: number }} query
 */
async function computeUnassigned(hotelId, query) {
  const window = { from: query.from, to: addDays(query.from, query.days) };
  const where = {
    hotelId,
    roomId: null,
    status: query.status ? query.status : { in: [...PLAN_ASSIGNABLE_STATUSES] },
    ...stayOverlap(window),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.reservation.findMany({
      where,
      select: SEGMENT_RESERVATION_SELECT,
      orderBy: [{ checkIn: 'asc' }, { confirmationCode: 'asc' }],
      take: query.limit,
    }),
    prisma.reservation.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      confirmationCode: row.confirmationCode,
      guestName: guestNameOf(row),
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

/** Oda verilebilen / taşınabilen durumlar. */
const ROOM_CHANGEABLE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'CHECKED_IN']);

/**
 * Izgaradaki bara tıklayınca açılan detay.
 *
 * Modül 4'ün rezervasyon detay ekranı gelene kadar personelin bir konaklamayı
 * tek yerde gördüğü sayfa burası. Folyo bakiyesi (modül 15), misafir iletişimi
 * ve **oda geçmişi** de gösteriliyor, çünkü "oda değiştireyim mi" kararını
 * veren kişi bunları sorar.
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
          where: { deletedAt: null },
          select: { id: true, status: true, balance: true, currency: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        roomSegments: {
          where: { deletedAt: null },
          select: {
            id: true,
            startDate: true,
            endDate: true,
            reason: true,
            movedBy: true,
            createdAt: true,
            room: { select: { id: true, number: true } },
          },
          orderBy: { startDate: 'asc' },
        },
      },
    }),
    getBusinessDate(hotelId),
  ]);
  if (!row) throw new NotFoundError('Rezervasyon bulunamadı');

  const stayEnded = toUtcDayStart(row.checkOut) <= businessDate.getTime();
  const changeable = ROOM_CHANGEABLE_STATUSES.has(row.status);
  const folio = row.folios[0] ?? null;

  // Oda geçmişi: kapanmış dilimler + açık dilim, gece sırasıyla.
  const roomHistory = [
    ...row.roomSegments.map((segment) => ({
      roomId: segment.room.id,
      roomNumber: segment.room.number,
      from: isoDay(segment.startDate),
      to: isoDay(segment.endDate),
      reason: segment.reason,
      movedBy: segment.movedBy,
      movedAt: segment.createdAt.toISOString(),
    })),
    ...(row.room
      ? [
          {
            roomId: row.room.id,
            roomNumber: row.room.number,
            from: isoDay(row.roomSince ?? row.checkIn),
            to: isoDay(row.checkOut),
            reason: null,
            movedBy: null,
            movedAt: null,
          },
        ]
      : []),
  ];

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
    roomHistory,
    folio: folio ? { ...folio, balance: folio.balance.toString() } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    actions: {
      canChangeRoom: !stayEnded && changeable,
      canUnassign: !stayEnded && Boolean(row.roomId) && row.status !== 'CHECKED_IN' && changeable,
      // Düğme kapalıysa kullanıcı "neden" diye sorar; cevabı ekrana basılabilsin.
      reason: stayEnded ? 'Konaklama sona ermiş' : changeable ? null : 'Rezervasyon durumu işleme kapalı',
    },
  };
}

/** Sağlık ucu ve teşhis için önbellek istatistiği. */
export function planCacheStats() {
  return planCache.stats();
}
