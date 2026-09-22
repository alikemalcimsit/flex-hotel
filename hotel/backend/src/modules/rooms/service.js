import { Prisma } from '@prisma/client';
import { addDays, currentActor, rangesOverlapHalfOpen, toDecimal, toIsoDay, toUtcDayStart } from '@hotelos/core';
import {
  housekeepingTransitionError,
  RESERVATION_STATUS_LABELS,
  ROOM_BLOCK_TYPE_LABELS,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import {
  ConflictError,
  InUseError,
  NotFoundError,
  rethrowPrismaError,
  ValidationError,
} from '../../lib/errors.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { lockReservations, lockRooms, lockRoomTypes } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { createReadCache } from '../../lib/read-cache.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import {
  assignmentKind,
  blockRemovalMode,
  buildAvailabilityCalendar,
  availabilityForStay,
  compareRoomsNaturally,
  consumesInventory,
  findNewOverbooking,
  fitsCapacity,
  freeRoomsForStay,
  INVENTORY_CONSUMING_STATUSES,
  INVENTORY_REMOVING_BLOCK_TYPE,
  rankRooms,
  openSliceStart,
  roomChangeMode,
} from './rules.js';

/**
 * Oda envanteri, oda durumu, arıza kayıtları, müsaitlik ve oda atama servisi.
 *
 * ### Oda durumu üç bağımsız bilgidir
 *
 * - `occupancy` (Boş/Dolu): yalnızca giriş-çıkış akışı değiştirir
 *   (`applySystemRoomState`). Personel elle "boş" yapamaz — misafir içerideyken
 *   oda boş görünürse ikinci misafire verilir.
 * - `housekeepingStatus` (Kirli/Temizleniyor/Temiz/Kontrol edildi): personel
 *   değiştirir; dolu odada da değişir (kalan misafirin günlük temizliği).
 * - Arıza kaydı (`RoomBlock`): tarihli. "Bugün arızalı mı" kolondan değil o günü
 *   kapsayan bloktan okunur; ileri tarihli kayıt günü gelince kendiliğinden
 *   etkin olur, zamanlayıcı gerekmez.
 *
 * ### "Bugün" otelin günüdür
 *
 * Tüm tarih kararları `getBusinessDate` ile alınır (otelin saat dilimi). Sunucu
 * saatiyle (`new Date()`) hesaplanan "bugün" İstanbul'da gece 00:00–03:00
 * arası dünü gösterir.
 *
 * ### Eşzamanlılık
 *
 * Aynı odaya dokunan yazımlar oda satırını, envanteri azaltanlar oda tipi
 * satırını kilitler (`lib/locks.js`, önce tip sonra oda). Son savunma hattı
 * veritabanıdır: çifte rezervasyon EXCLUDE kısıtı ve rezervasyon ↔ arıza
 * kaydı tetikleyicisi; ihlalleri `rethrowPrismaError` Türkçe mesaja çevirir.
 *
 * ### Müsaitlik neden cache'lenmiyor
 *
 * Her rezervasyonda değişir ve her tarih penceresi ayrı bir sonuçtur;
 * cache'lemek bayat veri riskini büyütür. Hesap sabit sayıda sorguyla yapılır
 * (gece başına sorgu atılmaz).
 */

/** Oda atanabilecek rezervasyon durumları. */
const ASSIGNABLE_STATUSES = Object.freeze(['PENDING', 'CONFIRMED']);

/** Hata mesajında örnek olarak gösterilecek en fazla kayıt sayısı. */
const CONFLICT_SAMPLE_LIMIT = 5;

/** Otomatik atamada eşzamanlı çakışmaya karşı taze listeyle en fazla deneme. */
const AUTO_ASSIGN_MAX_ATTEMPTS = 3;

/**
 * Envanteri azaltan işlemlerde (arıza kaydı, oda silme, tip değişikliği)
 * overbooking denetiminin ileriye bakacağı en uzun süre. Talep daha ilerideyse
 * denetim bu ufukta kesilir; iki yıldan ileri rezervasyon pratikte yoktur ve
 * sınırsız pencere bellekte yüz binlerce rezervasyon demektir.
 */
const INVENTORY_GUARD_HORIZON_DAYS = 730;

/** Otomatik atamanın yarışta kaybedip sıradaki odayı denemesini gerektiren kodlar. */
const RETRYABLE_ASSIGNMENT_CODES = new Set(['ROOM_NOT_FREE']);

/** Aday listesinde sınıf sırası: önce misafirin tipi, sonra üst sınıf. */
const ASSIGNMENT_KIND_ORDER = Object.freeze(['SAME', 'UPGRADE', 'LATERAL', 'DOWNGRADE']);

const ROOM_TYPE_SUMMARY = Object.freeze({ code: true, name: true });

/**
 * Müsaitlik takvimi önbelleği (okuma ekranı). Anahtar otelin envanter
 * sürümünü içerir: rezervasyon, oda ya da arıza kaydı değişince eski cevap
 * bir daha okunmaz (bkz. `lib/read-cache.js`). Yazma yolundaki kontroller
 * (atama, overbooking) önbelleği hiç kullanmaz.
 */
const AVAILABILITY_CACHE_TTL_MS = 15_000;
const AVAILABILITY_CACHE_MAX_ENTRIES = 300;
const availabilityCache = createReadCache({
  ttlMs: AVAILABILITY_CACHE_TTL_MS,
  maxEntries: AVAILABILITY_CACHE_MAX_ENTRIES,
});

const dayLabelFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** @param {Date | string} value */
const formatDay = (value) => dayLabelFormatter.format(new Date(toUtcDayStart(value)));

/* ══════════════════ Sorgu parçaları ══════════════════ */

/**
 * Verilen günü kapsayan bloklar. İlişki filtrelerinde soft-delete eklentisi
 * devreye girmediği için `deletedAt` elle yazılı.
 * @param {Date} day
 */
function activeBlockWhere(day) {
  return { deletedAt: null, startDate: { lte: day }, OR: [{ endDate: null }, { endDate: { gt: day } }] };
}

/** Bitmemiş (süren veya başlayacak) bloklar. @param {Date} day */
function openBlockWhere(day) {
  return { deletedAt: null, OR: [{ endDate: null }, { endDate: { gt: day } }] };
}

/**
 * Oda DTO'su için tek sorguda gereken her şey: tip, bugünkü arıza kaydı ve
 * açık kayıt sayısı (N+1 yok).
 * @param {Date} businessDate
 */
function roomInclude(businessDate) {
  return {
    roomType: { select: ROOM_TYPE_SUMMARY },
    blocks: { where: activeBlockWhere(businessDate), orderBy: { startDate: 'desc' }, take: 1 },
    _count: { select: { blocks: { where: openBlockWhere(businessDate) } } },
  };
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

/* ══════════════════ Dönüştürücüler ══════════════════ */

/**
 * @param {object} row
 * @param {Date} [businessDate] verilirse kaydın bugüne göre durumu eklenir
 */
function toBlockDto(row, businessDate) {
  return {
    id: row.id,
    roomId: row.roomId,
    roomNumber: row.room?.number ?? null,
    type: row.type,
    startDate: toIsoDay(row.startDate),
    endDate: row.endDate ? toIsoDay(row.endDate) : null,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(businessDate ? blockTimeline(row, businessDate) : {}),
  };
}

/**
 * Ekranın ihtiyacı: kayıt sürüyor mu, başlayacak mı, bitti mi — ve kaldırma
 * düğmesi "İptal et" mi "Bitir" mi olmalı.
 * @param {{ startDate: Date, endDate: Date | null }} row
 * @param {Date} businessDate
 */
function blockTimeline(row, businessDate) {
  const today = businessDate.getTime();
  const state =
    row.endDate && toUtcDayStart(row.endDate) <= today
      ? 'ENDED'
      : toUtcDayStart(row.startDate) > today
        ? 'UPCOMING'
        : 'CURRENT';
  return { state, removal: blockRemovalMode(row, businessDate) };
}

function toRoomDto(row) {
  const currentBlock = row.blocks?.[0] ?? null;
  return {
    id: row.id,
    number: row.number,
    floor: row.floor,
    roomTypeId: row.roomTypeId,
    roomTypeCode: row.roomType?.code ?? null,
    roomTypeName: row.roomType?.name ?? null,
    occupancy: row.occupancy,
    housekeepingStatus: row.housekeepingStatus,
    condition: currentBlock ? currentBlock.type : 'IN_SERVICE',
    currentBlock: currentBlock ? toBlockDto(currentBlock) : null,
    openBlockCount: row._count?.blocks ?? 0,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toReservationSummaryDto(row) {
  return {
    id: row.id,
    confirmationCode: row.confirmationCode,
    guestName: row.guest ? `${row.guest.firstName} ${row.guest.lastName}`.trim() : null,
    roomTypeId: row.roomTypeId,
    roomTypeCode: row.roomType?.code ?? null,
    roomTypeName: row.roomType?.name ?? null,
    roomId: row.roomId,
    roomNumber: row.room?.number ?? null,
    checkIn: toIsoDay(row.checkIn),
    checkOut: toIsoDay(row.checkOut),
    adults: row.adults,
    children: row.children,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Denetim izine yazılacak anlık görüntü: türetilmiş alanlar (tip adı, bugünkü
 * arıza durumu...) kaydın kendi değeri değildir, ayıklanır.
 */
function roomSnapshot({ roomTypeCode, roomTypeName, condition, currentBlock, openBlockCount, ...rest }) {
  return rest;
}

function blockSnapshot({ roomNumber, state, removal, ...rest }) {
  return rest;
}

/* ══════════════════ Ortak yardımcılar ══════════════════ */

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string} id
 * @param {Date} businessDate
 */
async function loadRoomDto(client, hotelId, id, businessDate) {
  const row = await client.room.findFirst({ where: { id, hotelId }, include: roomInclude(businessDate) });
  if (!row) throw new NotFoundError('Oda bulunamadı');
  return toRoomDto(row);
}

/**
 * Müsaitlik hesabının ham girdilerini tek seferde toplar.
 *
 * Modül 5'in (oda planı) günlük özeti de bunu kullanıyor: ızgara sayfalansa da
 * "bugün otel %62 dolu" sayısı otelin tamamından hesaplanmalı.
 *
 * Üç sorgu atar ve gün gün döngüye girmez — 90 günlük pencere de 3 gün de
 * aynı sayıda sorgu demektir.
 *
 * `roomTypeIds` verilirse yalnızca o tiplerin hesabı için gereken veri
 * okunur: tiplerin odaları, tiplerin talebi **ve** başka tipten gelip bu
 * tiplerin odalarına yerleşmiş rezervasyonlar. Envanter denetimi uzun
 * pencerelerde otelin tamamını belleğe çekmesin diye.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {Date} from
 * @param {Date} to
 * @param {{ roomTypeIds?: string[] }} [options]
 */
export async function loadInventorySnapshot(client, hotelId, from, to, { roomTypeIds } = {}) {
  const rooms = await client.room.findMany({
    where: { hotelId, ...(roomTypeIds ? { roomTypeId: { in: roomTypeIds } } : {}) },
    select: { id: true, number: true, floor: true, roomTypeId: true, occupancy: true, housekeepingStatus: true },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
  });
  const roomIds = rooms.map((room) => room.id);

  // Ham SQL: 90 günlük pencerede on binlerce satır döner; Prisma'nın nesne
  // katmanı bu okumayı üç katına uzatıyordu. Yarı açık kesişim: pencerede en
  // az bir gecesi olanlar (fazlası zararsız).
  const typeScope = roomTypeIds
    ? Prisma.sql`AND (
        r."roomTypeId" = ANY(${roomTypeIds}::text[])
        OR r."roomId" = ANY(${roomIds}::text[])
        -- Bu tiplerin odalarında kalıp sonra başka odaya taşınmış olanlar.
        OR EXISTS (
          SELECT 1 FROM "RoomStaySegment" s
          WHERE s."reservationId" = r."id" AND s."deletedAt" IS NULL AND s."roomId" = ANY(${roomIds}::text[])
        )
      )`
    : Prisma.empty;

  const [reservations, blocks, segments] = await Promise.all([
    client.$queryRaw`
      SELECT r."id", r."roomId", r."roomTypeId", r."checkIn", r."checkOut", r."roomSince",
             r."status"::text AS "status", r."adults", r."children"
      FROM "Reservation" r
      WHERE r."hotelId" = ${hotelId}
        AND r."deletedAt" IS NULL
        AND r."status"::text = ANY(${[...INVENTORY_CONSUMING_STATUSES]}::text[])
        AND r."checkOut" > ${sqlTimestamp(from)}
        AND r."checkIn" < ${sqlTimestamp(to)}
        ${typeScope}`,
    client.roomBlock.findMany({
      where: {
        hotelId,
        startDate: { lt: to },
        // Süresiz bloklar (endDate = null) da pencereyi etkiler.
        OR: [{ endDate: null }, { endDate: { gt: from } }],
        ...(roomTypeIds ? { roomId: { in: roomIds } } : {}),
      },
      select: { id: true, roomId: true, type: true, startDate: true, endDate: true, reason: true },
    }),
    // Oda değiştirmiş konaklamaların eski odalarda geçen geceleri. Yalnızca
    // envanteri hâlâ tüketen konaklamalarınki: çıkış yapmışın geçmişi
    // müsaitliği etkilemez.
    client.roomStaySegment.findMany({
      where: {
        hotelId,
        startDate: { lt: to },
        endDate: { gt: from },
        reservation: { status: { in: INVENTORY_CONSUMING_STATUSES }, deletedAt: null },
        ...(roomTypeIds ? { roomId: { in: roomIds } } : {}),
      },
      select: { id: true, reservationId: true, roomId: true, startDate: true, endDate: true },
    }),
  ]);

  return { rooms, reservations, blocks, segments };
}

/**
 * Tiplerin talebinin ne kadar ileriye uzandığı: denetim penceresinin sonu.
 * Talep yoksa `null` — envanteri azaltmak o durumda overbooking yaratamaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string[]} roomTypeIds
 * @param {Date} from
 * @returns {Promise<Date | null>}
 */
async function demandHorizon(tx, hotelId, roomTypeIds, from) {
  const result = await tx.reservation.aggregate({
    _max: { checkOut: true },
    where: {
      hotelId,
      status: { in: INVENTORY_CONSUMING_STATUSES },
      checkOut: { gt: from },
      OR: [{ roomTypeId: { in: roomTypeIds } }, { room: { roomTypeId: { in: roomTypeIds } } }],
    },
  });
  const latest = result._max.checkOut;
  if (!latest) return null;

  // Çıkış gecesi tüketilmez; pencere çıkış gününün başında biter.
  const end = new Date(toUtcDayStart(latest));
  const cap = addDays(from, INVENTORY_GUARD_HORIZON_DAYS);
  return end < cap ? end : cap;
}

/**
 * Envanteri azaltan bir değişikliğin **yeni** overbooking yaratmadığını
 * doğrular; yaratıyorsa hangi gecelerde olduğunu söyleyerek reddeder.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{
 *   roomTypeIds: string[],
 *   from: Date,
 *   to: Date | null,
 *   apply: (snapshot: Awaited<ReturnType<typeof loadInventorySnapshot>>) => Awaited<ReturnType<typeof loadInventorySnapshot>>,
 *   action: string,
 *   snapshot?: Awaited<ReturnType<typeof loadInventorySnapshot>>,
 * }} options `action`: mesajın öznesi ("101 numaralı odayı silmek")
 */
async function assertNoNewOverbooking(tx, hotelId, { roomTypeIds, from, to, apply, action, snapshot }) {
  const until = to ?? (await demandHorizon(tx, hotelId, roomTypeIds, from));
  if (!until || toUtcDayStart(until) <= toUtcDayStart(from)) return;

  const base = snapshot ?? (await loadInventorySnapshot(tx, hotelId, from, until, { roomTypeIds }));
  const before = buildAvailabilityCalendar({ ...base, from, to: until, roomTypeIds });
  const after = buildAvailabilityCalendar({ ...apply(base), from, to: until, roomTypeIds });
  const violations = findNewOverbooking(before, after, roomTypeIds);
  if (violations.length === 0) return;

  const types = await tx.roomType.findMany({
    where: { hotelId, id: { in: roomTypeIds } },
    select: { id: true, code: true },
  });
  const codeOf = new Map(types.map((type) => [type.id, type.code]));
  const first = violations[0];

  throw new ConflictError(
    `${action}, ${codeOf.get(first.roomTypeId) ?? 'bu'} tipinde ${violations.length} gecede overbooking'e yol açar ` +
      `(ilk gece ${formatDay(first.day)}: ${first.sellable} satılabilir oda, ${first.demand} rezervasyon). ` +
      'Önce rezervasyonları başka tipe/odaya taşıyın ya da tarihleri değiştirin.',
    'WOULD_OVERBOOK',
    {
      total: violations.length,
      shown: Math.min(violations.length, CONFLICT_SAMPLE_LIMIT),
      nights: violations.slice(0, CONFLICT_SAMPLE_LIMIT).map((violation) => ({
        ...violation,
        roomTypeCode: codeOf.get(violation.roomTypeId) ?? null,
      })),
    },
  );
}

/* ══════════════════ Oda CRUD ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, roomTypeId?: string, occupancy?: string, housekeepingStatus?: string, condition?: string, floor?: number }} query
 */
export async function listRooms(hotelId, query) {
  const businessDate = await getBusinessDate(hotelId);
  const where = {
    hotelId,
    ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
    ...(query.occupancy ? { occupancy: query.occupancy } : {}),
    ...(query.housekeepingStatus ? { housekeepingStatus: query.housekeepingStatus } : {}),
    ...(query.floor !== undefined ? { floor: query.floor } : {}),
    ...(query.search ? { number: { contains: query.search, mode: 'insensitive' } } : {}),
    ...conditionWhere(query.condition, businessDate),
  };

  const { ids, total } = await naturalRoomPage(prisma, where, query);
  const rows = await prisma.room.findMany({ where: { id: { in: ids } }, include: roomInclude(businessDate) });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return buildPage(
    ids.map((id) => byId.get(id)).filter(Boolean).map(toRoomDto),
    total,
    query,
  );
}

/**
 * Filtreye uyan odaların doğal sıradaki (kat, sonra numara: 1, 2, 10) bir sayfası.
 *
 * Veritabanı numarayı metin olarak sıralar (1, 10, 2); villa ve bungalov
 * numaralı otellerde liste karışır. Bu yüzden önce yalnızca kimlik/kat/numara
 * çekilip bellekte sıralanır, sonra sayfanın ayrıntısı okunur. En büyük tek
 * otelde bile birkaç bin hafif satırdır; iki sorgu, gece başına sorgu yok.
 *
 * Modül 5 (oda planı) da aynı sırayı kullanır.
 *
 * @param {typeof prisma | import('@prisma/client').Prisma.TransactionClient} client
 * @param {object} where
 * @param {{ page: number, pageSize: number }} paging
 * @returns {Promise<{ ids: string[], total: number }>}
 */
export async function naturalRoomPage(client, where, paging) {
  const matching = await client.room.findMany({ where, select: { id: true, floor: true, number: true } });
  matching.sort(compareRoomsNaturally);
  const { skip, take } = toSkipTake(paging);
  return { ids: matching.slice(skip, skip + take).map((room) => room.id), total: matching.length };
}

/**
 * @param {string} hotelId
 * @param {{ number: string, floor: number, roomTypeId: string, notes?: string | null }} input
 */
export async function createRoom(hotelId, input) {
  const businessDate = await getBusinessDate(hotelId);

  try {
    return await writeWithEvents(async (tx, stage) => {
      // Tip kilitlenir: aynı anda tip silinirse oda silinmiş bir tipe bağlanmasın.
      const lockedTypes = await lockRoomTypes(tx, hotelId, [input.roomTypeId]);
      if (!lockedTypes.has(input.roomTypeId)) throw new ValidationError('Seçilen oda tipi bulunamadı');

      const created = await tx.room.create({
        data: {
          hotelId,
          number: input.number,
          floor: input.floor,
          roomTypeId: input.roomTypeId,
          notes: input.notes || null,
        },
      });
      const dto = await loadRoomDto(tx, hotelId, created.id, businessDate);

      await recordAudit(tx, {
        hotelId,
        entity: 'Room',
        entityId: created.id,
        action: 'CREATE',
        after: roomSnapshot(dto),
      });
      await stage('inventory.room.created', {
        hotelId,
        id: created.id,
        label: dto.number,
        roomTypeId: dto.roomTypeId,
      });

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `"${input.number}" numaralı bir oda zaten var` });
  }
}

/**
 * Oda bilgisini günceller. Tip değişikliği eski tipin envanterini bir azaltır;
 * gelecekteki talep bunu kaldıramıyorsa reddedilir.
 *
 * @param {string} hotelId
 * @param {string} id
 * @param {{ number: string, floor: number, roomTypeId: string, notes?: string | null, expectedUpdatedAt: Date }} input
 */
export async function updateRoom(hotelId, id, input) {
  const { expectedUpdatedAt, ...data } = input;
  const businessDate = await getBusinessDate(hotelId);

  try {
    return await writeWithEvents(async (tx, stage) => {
      const current = await tx.room.findFirst({ where: { id, hotelId }, select: { roomTypeId: true } });
      if (!current) throw new NotFoundError('Oda bulunamadı');

      const typeChanges = data.roomTypeId !== current.roomTypeId;
      const lockedTypes = await lockRoomTypes(
        tx,
        hotelId,
        typeChanges ? [current.roomTypeId, data.roomTypeId] : [data.roomTypeId],
      );
      if (!lockedTypes.has(data.roomTypeId)) throw new ValidationError('Seçilen oda tipi bulunamadı');
      if (!(await lockRooms(tx, hotelId, [id])).has(id)) throw new NotFoundError('Oda bulunamadı');

      const before = await loadRoomDto(tx, hotelId, id, businessDate);

      if (typeChanges) {
        const activeCount = await tx.reservation.count({
          where: { roomId: id, hotelId, status: { in: INVENTORY_CONSUMING_STATUSES } },
        });
        if (activeCount > 0) {
          throw new ConflictError(
            `Bu odanın ${activeCount} aktif rezervasyonu var; oda tipi değiştirilemez. Önce rezervasyonları başka odaya taşıyın.`,
            'IN_USE',
            { usage: { aktifRezervasyon: activeCount } },
          );
        }

        await assertNoNewOverbooking(tx, hotelId, {
          roomTypeIds: [current.roomTypeId],
          from: businessDate,
          to: null,
          apply: (snapshot) => ({ ...snapshot, rooms: snapshot.rooms.filter((room) => room.id !== id) }),
          action: `${before.number} numaralı odanın tipini değiştirmek`,
        });
      }

      await updateWithVersionCheck(
        tx,
        'room',
        { id, hotelId },
        expectedUpdatedAt,
        { number: data.number, floor: data.floor, roomTypeId: data.roomTypeId, notes: data.notes || null },
        'Oda bulunamadı',
      );

      const dto = await loadRoomDto(tx, hotelId, id, businessDate);
      const changedFields = await recordAudit(tx, {
        hotelId,
        entity: 'Room',
        entityId: id,
        action: 'UPDATE',
        before: roomSnapshot(before),
        after: roomSnapshot(dto),
      });
      await stage('inventory.room.updated', {
        hotelId,
        id,
        label: dto.number,
        roomTypeId: dto.roomTypeId,
        changedFields,
      });

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `"${data.number}" numaralı bir oda zaten var` });
  }
}

/**
 * Odayı soft-delete eder.
 *
 * Aktif rezervasyonu varsa reddedilir. Açık arıza kayıtları odayla birlikte
 * kapanır (başlamamışlar iptal, sürenler bugün biter) — kullanımdan kaldırılan
 * oda çoğu zaman zaten süresiz arızadadır; "önce kaydı kaldır" demek odayı bir
 * anlığına satışa açmak olurdu. Eski (bitmiş) kayıtlar silmeyi engellemez.
 *
 * @param {string} hotelId
 * @param {string} id
 */
export async function deleteRoom(hotelId, id) {
  const businessDate = await getBusinessDate(hotelId);

  await writeWithEvents(async (tx, stage) => {
    const current = await tx.room.findFirst({ where: { id, hotelId }, select: { roomTypeId: true } });
    if (!current) throw new NotFoundError('Oda bulunamadı');

    await lockRoomTypes(tx, hotelId, [current.roomTypeId]);
    if (!(await lockRooms(tx, hotelId, [id])).has(id)) throw new NotFoundError('Oda bulunamadı');

    const existing = await loadRoomDto(tx, hotelId, id, businessDate);

    const activeReservations = await tx.reservation.count({
      where: { roomId: id, hotelId, status: { in: INVENTORY_CONSUMING_STATUSES } },
    });
    if (activeReservations > 0) {
      throw new InUseError(
        `"${existing.number}" numaralı odanın ${activeReservations} aktif rezervasyonu var; silinemez. Önce misafirleri başka odaya taşıyın.`,
        { aktifRezervasyon: activeReservations },
      );
    }

    await assertNoNewOverbooking(tx, hotelId, {
      roomTypeIds: [current.roomTypeId],
      from: businessDate,
      to: null,
      apply: (snapshot) => ({ ...snapshot, rooms: snapshot.rooms.filter((room) => room.id !== id) }),
      action: `"${existing.number}" numaralı odayı silmek`,
    });

    const openBlocks = await tx.roomBlock.findMany({
      where: { roomId: id, hotelId, OR: [{ endDate: null }, { endDate: { gt: businessDate } }] },
    });
    for (const block of openBlocks) {
      const before = blockSnapshot(toBlockDto(block));
      if (blockRemovalMode(block, businessDate) === 'CANCEL') {
        await tx.roomBlock.update({ where: { id: block.id }, data: { deletedAt: new Date() } });
        await recordAudit(tx, { hotelId, entity: 'RoomBlock', entityId: block.id, action: 'DELETE', before });
      } else {
        const ended = await tx.roomBlock.update({ where: { id: block.id }, data: { endDate: businessDate } });
        await recordAudit(tx, {
          hotelId,
          entity: 'RoomBlock',
          entityId: block.id,
          action: 'UPDATE',
          before,
          after: blockSnapshot(toBlockDto(ended)),
        });
      }
    }

    await tx.room.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Room',
      entityId: id,
      action: 'DELETE',
      before: roomSnapshot(existing),
    });
    await stage('inventory.room.deleted', {
      hotelId,
      id,
      label: existing.number,
      roomTypeId: existing.roomTypeId,
    });
  });
}

/* ══════════════════ Oda durumu ══════════════════ */

/**
 * Kat hizmeti durumunu değiştirir (Kirli → Temizleniyor → Temiz → Kontrol edildi).
 *
 * Doluluğa dokunmaz: kalan misafirin odası temizlenince oda "Dolu · Temiz"
 * olur, boşalmaz. Arızalı odada da değiştirilebilir — tadilat sonrası
 * temizlik o kayıt sürerken yapılır.
 *
 * @param {string} hotelId
 * @param {string} id
 * @param {{ status: string, expectedUpdatedAt: Date }} input
 */
export async function setHousekeepingStatus(hotelId, id, { status, expectedUpdatedAt }) {
  const businessDate = await getBusinessDate(hotelId);

  return writeWithEvents(async (tx, stage) => {
    if (!(await lockRooms(tx, hotelId, [id])).has(id)) throw new NotFoundError('Oda bulunamadı');

    const before = await loadRoomDto(tx, hotelId, id, businessDate);
    if (before.housekeepingStatus === status) return before;

    const transitionError = housekeepingTransitionError(before.housekeepingStatus, status);
    if (transitionError) throw new ConflictError(transitionError, 'INVALID_TRANSITION');

    await updateWithVersionCheck(
      tx,
      'room',
      { id, hotelId },
      expectedUpdatedAt,
      { housekeepingStatus: status },
      'Oda bulunamadı',
    );

    const dto = await loadRoomDto(tx, hotelId, id, businessDate);
    await recordAudit(tx, {
      hotelId,
      entity: 'Room',
      entityId: id,
      action: 'UPDATE',
      before: roomSnapshot(before),
      after: roomSnapshot(dto),
    });
    await stage('room.status.changed', {
      hotelId,
      roomId: id,
      roomNumber: dto.number,
      field: 'housekeeping',
      from: before.housekeepingStatus,
      to: status,
    });

    return dto;
  });
}

/**
 * Sistem kaynaklı durum değişikliği (giriş-çıkış akışı, aktörler).
 *
 * `setHousekeepingStatus`'tan farkları kasıtlı:
 * - Optimistic lock aranmaz: ortada form dolduran kullanıcı yok, olay zaten
 *   olmuş bir gerçeği bildiriyor ("misafir çıktı").
 * - Doluluğu da değiştirebilir; doluluğun tek yazıcısı budur.
 *
 * Değişen her bilgi için ayrı `room.status.changed` event'i yayınlanır.
 *
 * @param {string} hotelId
 * @param {string} roomId
 * @param {{ occupancy?: 'VACANT' | 'OCCUPIED', housekeepingStatus?: 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED' }} state
 * @param {string} reason Denetim izine yazılacak gerekçe
 * @returns {Promise<{ changed: string[] }>}
 */
export async function applySystemRoomState(hotelId, roomId, state, reason) {
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockRooms(tx, hotelId, [roomId])).has(roomId)) throw new NotFoundError('Oda bulunamadı');

    const before = await tx.room.findFirst({
      where: { id: roomId, hotelId },
      select: { id: true, number: true, occupancy: true, housekeepingStatus: true },
    });

    return writeRoomState(tx, stage, hotelId, before, state, reason);
  });
}

/**
 * Oda durumunu **çağıranın transaction'ında** değiştirir.
 *
 * `applySystemRoomState` bunun tek odalık sarmalayıcısıdır. Oda değişikliği
 * (`changeRoom`) iki odaya birden dokunduğu için ayrı transaction'lar
 * kullanamaz: yarıda kalırsa misafir hem eski hem yeni odada görünür.
 *
 * Değişmeyen alan yazılmaz — her tıklamada audit satırı üretmemek için.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {string} hotelId
 * @param {{ id: string, number: string, occupancy: string, housekeepingStatus: string }} before
 * @param {{ occupancy?: string, housekeepingStatus?: string }} state
 * @param {string} reason
 * @returns {Promise<{ changed: string[] }>}
 */
async function writeRoomState(tx, stage, hotelId, before, state, reason) {
  const data = {};
  if (state.occupancy && state.occupancy !== before.occupancy) data.occupancy = state.occupancy;
  if (state.housekeepingStatus && state.housekeepingStatus !== before.housekeepingStatus) {
    data.housekeepingStatus = state.housekeepingStatus;
  }
  const changed = Object.keys(data);
  if (changed.length === 0) return { changed };

  await tx.room.update({ where: { id: before.id }, data });

  await recordAudit(tx, {
    hotelId,
    entity: 'Room',
    entityId: before.id,
    action: 'UPDATE',
    before: { occupancy: before.occupancy, housekeepingStatus: before.housekeepingStatus, reason: null },
    after: {
      occupancy: data.occupancy ?? before.occupancy,
      housekeepingStatus: data.housekeepingStatus ?? before.housekeepingStatus,
      reason,
    },
  });

  if (data.occupancy) {
    await stage('room.status.changed', {
      hotelId,
      roomId: before.id,
      roomNumber: before.number,
      field: 'occupancy',
      from: before.occupancy,
      to: data.occupancy,
    });
  }
  if (data.housekeepingStatus) {
    await stage('room.status.changed', {
      hotelId,
      roomId: before.id,
      roomNumber: before.number,
      field: 'housekeeping',
      from: before.housekeepingStatus,
      to: data.housekeepingStatus,
    });
  }

  return { changed };
}

/* ══════════════════ Arıza kayıtları (bloklar) ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ roomId?: string, scope: 'ACTIVE' | 'PAST', page: number, pageSize: number }} query
 *   `ACTIVE`: süren + başlayacak (yakın olan önce); `PAST`: bitmiş (yeni biten önce)
 */
export async function listBlocks(hotelId, query) {
  const businessDate = await getBusinessDate(hotelId);
  const past = query.scope === 'PAST';
  const where = {
    hotelId,
    ...(query.roomId ? { roomId: query.roomId } : {}),
    ...(past ? { endDate: { lte: businessDate } } : { OR: [{ endDate: null }, { endDate: { gt: businessDate } }] }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.roomBlock.findMany({
      where,
      include: { room: { select: { number: true } } },
      orderBy: past ? [{ endDate: 'desc' }, { startDate: 'desc' }] : [{ startDate: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.roomBlock.count({ where }),
  ]);

  return buildPage(
    items.map((row) => toBlockDto(row, businessDate)),
    total,
    query,
  );
}

/**
 * Odayı tarih aralığıyla arızalı ya da hizmet dışı işaretler.
 *
 * - Bugünden önce başlayamaz: geçmiş gecelerin müsaitliği değiştirilemez.
 * - O gecelerde odada rezervasyon varsa reddedilir: kayıt açmak misafirin
 *   rezervasyonunu sessizce geçersiz kılmak olurdu.
 * - `OUT_OF_ORDER` tipin envanterini azaltır; atanmamış talebi karşılayamaz
 *   hâle gelecekse reddedilir (canlıda bulunan sessiz overbooking hatası).
 * - Aynı odada çakışan başka kayıt varsa veritabanı kısıtı engeller.
 *
 * @param {string} hotelId
 * @param {string} roomId
 * @param {{ type: 'OUT_OF_ORDER' | 'OUT_OF_SERVICE', startDate: Date, endDate?: Date | null, reason: string }} input
 */
export async function blockRoom(hotelId, roomId, input) {
  const businessDate = await getBusinessDate(hotelId);
  // Tarihler gün başına indirgenir; veritabanı da bunu kısıtla zorunlu tutuyor.
  const startDate = new Date(toUtcDayStart(input.startDate));
  const endDate = input.endDate ? new Date(toUtcDayStart(input.endDate)) : null;

  if (startDate < businessDate) {
    throw new ValidationError(
      `Arıza kaydı bugünden (${formatDay(businessDate)}) önce başlayamaz; geçmiş gecelerin müsaitliği değiştirilemez.`,
      { field: 'startDate' },
    );
  }
  if (endDate && endDate <= startDate) {
    throw new ValidationError('Bitiş başlangıçtan en az bir gün sonra olmalı', { field: 'endDate' });
  }

  try {
    return await writeWithEvents(async (tx, stage) => {
      const room = await tx.room.findFirst({
        where: { id: roomId, hotelId },
        select: { id: true, number: true, roomTypeId: true },
      });
      if (!room) throw new NotFoundError('Oda bulunamadı');

      const removesInventory = input.type === INVENTORY_REMOVING_BLOCK_TYPE;
      if (removesInventory) await lockRoomTypes(tx, hotelId, [room.roomTypeId]);
      if (!(await lockRooms(tx, hotelId, [roomId])).has(roomId)) throw new NotFoundError('Oda bulunamadı');

      // Gece semantiği: çıkış günü öğlen biten konaklama o günü tutmaz; bu yüzden
      // "çıkış > başlangıç" değil "çıkış >= başlangıç + 1 gün".
      const conflictFilter = {
        hotelId,
        roomId,
        status: { in: INVENTORY_CONSUMING_STATUSES },
        ...(endDate ? { checkIn: { lt: endDate } } : {}),
        checkOut: { gte: addDays(startDate, 1) },
      };

      // Sayı ve örnekler ayrı sorgular: listeyi kısaltmak (take) sayıyı da
      // kısaltırsa kullanıcıya "5 rezervasyon var" denir ama aslında 12 vardır.
      const [conflictCount, samples] = await Promise.all([
        tx.reservation.count({ where: conflictFilter }),
        tx.reservation.findMany({
          where: conflictFilter,
          select: { confirmationCode: true, checkIn: true, checkOut: true },
          orderBy: [{ checkIn: 'asc' }],
          take: CONFLICT_SAMPLE_LIMIT,
        }),
      ]);

      if (conflictCount > 0) {
        throw new ConflictError(
          `Bu tarihlerde odanın ${conflictCount} rezervasyonu var; arıza kaydı açılamaz. Önce misafirleri başka odaya taşıyın.`,
          'HAS_RESERVATIONS',
          {
            total: conflictCount,
            shown: samples.length,
            reservations: samples.map((reservation) => ({
              confirmationCode: reservation.confirmationCode,
              checkIn: toIsoDay(reservation.checkIn),
              checkOut: toIsoDay(reservation.checkOut),
            })),
          },
        );
      }

      if (removesInventory) {
        await assertNoNewOverbooking(tx, hotelId, {
          roomTypeIds: [room.roomTypeId],
          from: startDate,
          to: endDate,
          apply: (snapshot) => ({
            ...snapshot,
            blocks: [...snapshot.blocks, { roomId, type: input.type, startDate, endDate }],
          }),
          action: `${room.number} numaralı odayı arızaya almak`,
        });
      }

      const created = await tx.roomBlock.create({
        data: {
          hotelId,
          roomId,
          type: input.type,
          startDate,
          endDate,
          reason: input.reason,
          createdBy: currentActor(),
        },
        include: { room: { select: { number: true } } },
      });

      const dto = toBlockDto(created, businessDate);
      await recordAudit(tx, {
        hotelId,
        entity: 'RoomBlock',
        entityId: created.id,
        action: 'CREATE',
        after: blockSnapshot(dto),
      });
      await stage('room.blocked', {
        hotelId,
        roomId,
        roomNumber: room.number,
        blockId: created.id,
        type: created.type,
        startDate: created.startDate,
        endDate: created.endDate,
        reason: created.reason,
      });

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Arıza kaydını kaldırır — geçmişi değiştirmeden.
 *
 * Başlamamış kayıt iptal edilir; süren kaydın bitişi bugüne çekilir (bu
 * geceden itibaren oda açılır, geçmiş günler "arızalıydı" olarak kalır);
 * bitmiş kayda dokunulmaz. Arızalı (satış dışı) kaydı bitirilen oda kirli
 * işaretlenir: tadilattan çıkan oda temizlik ister.
 *
 * @param {string} hotelId
 * @param {string} blockId
 * @returns {Promise<{ id: string, mode: 'CANCELLED' | 'ENDED' }>}
 */
export async function removeBlock(hotelId, blockId) {
  const businessDate = await getBusinessDate(hotelId);

  return writeWithEvents(async (tx, stage) => {
    const located = await tx.roomBlock.findFirst({ where: { id: blockId, hotelId }, select: { roomId: true } });
    if (!located) throw new NotFoundError('Arıza kaydı bulunamadı');

    await lockRooms(tx, hotelId, [located.roomId]);

    // Kilitten sonra yeniden okunur: aynı anda iki kez "Bitir" basılırsa ikincisi
    // birincinin sonucunu görür (çift denetim kaydı ve olay yazılmaz).
    const existing = await tx.roomBlock.findFirst({
      where: { id: blockId, hotelId },
      include: { room: { select: { number: true } } },
    });
    if (!existing) throw new NotFoundError('Arıza kaydı bulunamadı');

    const removal = blockRemovalMode(existing, businessDate);
    if (removal === 'ALREADY_ENDED') {
      throw new ConflictError('Bu arıza kaydı zaten sona ermiş; geçmiş kayıtlar değiştirilemez.', 'BLOCK_ENDED');
    }

    const before = blockSnapshot(toBlockDto(existing));
    const roomNumber = existing.room?.number ?? '';
    const mode = removal === 'CANCEL' ? 'CANCELLED' : 'ENDED';

    if (removal === 'CANCEL') {
      await tx.roomBlock.update({ where: { id: blockId }, data: { deletedAt: new Date() } });
      await recordAudit(tx, { hotelId, entity: 'RoomBlock', entityId: blockId, action: 'DELETE', before });
    } else {
      const ended = await tx.roomBlock.update({ where: { id: blockId }, data: { endDate: businessDate } });
      await recordAudit(tx, {
        hotelId,
        entity: 'RoomBlock',
        entityId: blockId,
        action: 'UPDATE',
        before,
        after: blockSnapshot(toBlockDto(ended)),
      });

      if (existing.type === INVENTORY_REMOVING_BLOCK_TYPE) {
        const room = await tx.room.findFirst({
          where: { id: existing.roomId, hotelId },
          select: { housekeepingStatus: true },
        });
        if (room && room.housekeepingStatus !== 'DIRTY') {
          await tx.room.update({ where: { id: existing.roomId }, data: { housekeepingStatus: 'DIRTY' } });
          await recordAudit(tx, {
            hotelId,
            entity: 'Room',
            entityId: existing.roomId,
            action: 'UPDATE',
            before: { housekeepingStatus: room.housekeepingStatus, reason: null },
            after: { housekeepingStatus: 'DIRTY', reason: 'Arıza kaydı bitti' },
          });
          await stage('room.status.changed', {
            hotelId,
            roomId: existing.roomId,
            roomNumber,
            field: 'housekeeping',
            from: room.housekeepingStatus,
            to: 'DIRTY',
          });
        }
      }
    }

    await stage('room.unblocked', { hotelId, roomId: existing.roomId, roomNumber, blockId, mode });
    return { id: blockId, mode };
  });
}

/* ══════════════════ Müsaitlik ══════════════════ */

/**
 * Müsaitlik takvimi: oda tipi × gece kırılımında boş oda sayısı.
 * @param {string} hotelId
 * @param {{ from: Date, to: Date, roomTypeId?: string }} query
 */
export async function getAvailabilityCalendar(hotelId, { from, to, roomTypeId }) {
  const key = JSON.stringify([
    hotelId,
    liveVersion(LIVE_SCOPES.INVENTORY, hotelId),
    toIsoDay(from),
    toIsoDay(to),
    roomTypeId ?? '',
  ]);
  return availabilityCache.get(key, () => computeAvailabilityCalendar(hotelId, { from, to, roomTypeId }));
}

/**
 * @param {string} hotelId
 * @param {{ from: Date, to: Date, roomTypeId?: string }} query
 */
async function computeAvailabilityCalendar(hotelId, { from, to, roomTypeId }) {
  const [snapshot, roomTypes] = await Promise.all([
    loadInventorySnapshot(prisma, hotelId, from, to),
    prisma.roomType.findMany({
      where: { hotelId, ...(roomTypeId ? { id: roomTypeId } : {}) },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: 'asc' }],
    }),
  ]);

  const roomTypeIds = roomTypes.map((type) => type.id);
  const calendar = buildAvailabilityCalendar({ ...snapshot, from, to, roomTypeIds });

  return {
    days: calendar.days,
    roomTypes: roomTypes.map((type) => ({
      id: type.id,
      code: type.code,
      name: type.name,
      total: calendar.byRoomType[type.id]?.total ?? 0,
      days: calendar.byRoomType[type.id]?.days ?? {},
    })),
  };
}

/**
 * "15-18 Ekim'de kaç Standart boş?" — modül 4 rezervasyon açarken bunu sorar.
 * @param {string} hotelId
 * @param {{ checkIn: Date, checkOut: Date, roomTypeId?: string }} query
 * @param {{ client?: import('@prisma/client').Prisma.TransactionClient | typeof prisma }} [options]
 *   `client`: çağıranın transaction'ı — bkz. `checkAvailability`.
 */
export async function getStayAvailability(hotelId, { checkIn, checkOut, roomTypeId }, { client = prisma } = {}) {
  const [snapshot, roomTypes] = await Promise.all([
    loadInventorySnapshot(client, hotelId, checkIn, checkOut),
    client.roomType.findMany({
      where: { hotelId, ...(roomTypeId ? { id: roomTypeId } : {}) },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: 'asc' }],
    }),
  ]);

  const calendar = buildAvailabilityCalendar({
    ...snapshot,
    from: checkIn,
    to: checkOut,
    roomTypeIds: roomTypes.map((type) => type.id),
  });

  return {
    checkIn: toIsoDay(checkIn),
    checkOut: toIsoDay(checkOut),
    roomTypes: roomTypes.map((type) => ({
      id: type.id,
      code: type.code,
      name: type.name,
      total: calendar.byRoomType[type.id]?.total ?? 0,
      available: availabilityForStay(calendar, type.id, checkIn, checkOut),
    })),
  };
}

/**
 * Sistemin dış modüllere açtığı kapı: modül 4 rezervasyon oluştururken
 * "bu tarihlerde bu tipten yer var mı" diye bunu çağırmalı — **aynı
 * transaction içinde `lockRoomTypes` aldıktan sonra ve `client: tx` vererek**:
 *
 * ```js
 * await lockRoomTypes(tx, hotelId, [roomTypeId]);
 * if ((await checkAvailability(hotelId, stay, { client: tx })) < 1) throw ...;
 * await tx.reservation.create(...);
 * ```
 *
 * Kilit olmadan aynı anda açılan son iki rezervasyon ikisi de "1 yer var"
 * okur. `client` verilmezse sayım havuzdan ayrı bir bağlantıyla yapılır:
 * transaction'ın kendi yazdığı (henüz commit edilmemiş) rezervasyonları
 * görmez — grup rezervasyonunda ikinci oda yanlış sayılır — ve transaction
 * bağlantısını tutarken ikinci bir bağlantı beklemek yoğun saatte havuzu
 * tüketip isteği kilitleyebilir.
 *
 * @param {string} hotelId
 * @param {{ checkIn: Date, checkOut: Date, roomTypeId: string }} query
 * @param {{ client?: import('@prisma/client').Prisma.TransactionClient | typeof prisma }} [options]
 * @returns {Promise<number>}
 */
export async function checkAvailability(hotelId, { checkIn, checkOut, roomTypeId }, options = {}) {
  const result = await getStayAvailability(hotelId, { checkIn, checkOut, roomTypeId }, options);
  return result.roomTypes.find((type) => type.id === roomTypeId)?.available ?? 0;
}

/* ══════════════════ Oda atama ══════════════════ */

/**
 * Oda uygunluğunun aranacağı ilk gece: içerideki misafir için bugün (geçmiş
 * geceler çoktan eski odada geçti), diğerleri için giriş günü.
 *
 * @param {{ status: string, checkIn: Date }} reservation
 * @param {Date} businessDate
 * @returns {Date}
 */
function inHouseStayFrom(reservation, businessDate) {
  const checkIn = new Date(toUtcDayStart(reservation.checkIn));
  if (reservation.status !== 'CHECKED_IN') return checkIn;
  return businessDate > checkIn ? businessDate : checkIn;
}

/**
 * Rezervasyonu kilitleyip yükler. Odası değişecek her işlem bununla başlar
 * (kilit sırası: rezervasyon → oda tipi → oda); aynı misafiri aynı anda
 * taşıyan ikinci işlem birincinin sonucunu görerek karar verir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} reservationId
 */
async function lockAssignableReservation(tx, hotelId, reservationId) {
  if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) {
    throw new NotFoundError('Rezervasyon bulunamadı');
  }
  return loadAssignableReservation(tx, hotelId, reservationId);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} reservationId
 */
async function loadAssignableReservation(tx, hotelId, reservationId) {
  const reservation = await tx.reservation.findFirst({
    where: { id: reservationId, hotelId },
    include: {
      guest: { select: { firstName: true, lastName: true } },
      roomType: { select: ROOM_TYPE_SUMMARY },
      room: { select: { number: true, roomTypeId: true } },
    },
  });
  if (!reservation) throw new NotFoundError('Rezervasyon bulunamadı');
  return reservation;
}

/**
 * @param {{ status: string, checkOut: Date }} reservation
 * @param {Date} businessDate
 * @param {{ allowInHouse?: boolean }} [options] `allowInHouse`: içerideki misafirin
 *   odası da değiştirilebilir (oda planı). Yazma yolunda **kapalıdır**: giriş
 *   yapmış misafiri `assignRoom` taşıyamaz, `changeRoom` taşır — çünkü eski ve
 *   yeni odanın durumu da değişmeli.
 */
function assertAssignable(reservation, businessDate, { allowInHouse = false } = {}) {
  const allowed = allowInHouse ? [...ASSIGNABLE_STATUSES, 'CHECKED_IN'] : ASSIGNABLE_STATUSES;
  if (!allowed.includes(reservation.status)) {
    const label = RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status;
    throw new ConflictError(
      `Durumu "${label}" olan rezervasyona oda atanamaz. Yalnızca bekleyen ve onaylı rezervasyonlar atanabilir.`,
      'NOT_ASSIGNABLE',
    );
  }
  if (toUtcDayStart(reservation.checkOut) <= businessDate.getTime()) {
    throw new ConflictError('Bu rezervasyonun konaklama tarihleri geçmiş; oda atanamaz.', 'STAY_ENDED');
  }
}

/**
 * Bir rezervasyona atanabilecek odalar, otomatik atamanın tercih sırasıyla.
 *
 * Bir oda listeye ancak şunların hepsi doğruysa girer:
 * - Konaklamanın her gecesinde boş: başka rezervasyon, arızalı ya da hizmet
 *   dışı kaydı yok.
 * - Başka tipteyse misafir sayısı o tipin kapasitesine sığıyor.
 * - Misafiri oraya yerleştirmek o tipte **yeni** overbooking yaratmıyor.
 *
 * Sıralama: misafirin tipi, sonra üst sınıf, farklı tip, alt sınıf; her grupta
 * fiyatı en yakın tip önce, sonra oda tercih sırası (`rankRooms`).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {{ id: string, roomTypeId: string, roomId: string | null, checkIn: Date, checkOut: Date, status: string, adults: number, children: number }} reservation
 * @param {Date} businessDate
 * @param {{ includeOtherTypes: boolean }} options
 */
async function rankAssignableRooms(client, hotelId, reservation, businessDate, { includeOtherTypes }) {
  // İçerideki misafir için yalnızca kalan geceler aranır (bkz. assertRoomUsableForStay).
  const stayFrom = inHouseStayFrom(reservation, businessDate);
  const [snapshot, roomTypeRows] = await Promise.all([
    loadInventorySnapshot(client, hotelId, stayFrom, reservation.checkOut),
    client.roomType.findMany({
      where: { hotelId },
      select: { id: true, code: true, name: true, basePrice: true, capacityAdults: true, capacityChildren: true },
    }),
  ]);

  const typeById = new Map(
    roomTypeRows.map((type) => [type.id, { ...type, basePrice: type.basePrice.toString() }]),
  );
  const reservedType = typeById.get(reservation.roomTypeId);
  if (!reservedType) return [];

  const stay = { checkIn: stayFrom, checkOut: reservation.checkOut };
  const free = freeRoomsForStay({
    ...snapshot,
    roomTypeId: includeOtherTypes ? undefined : reservation.roomTypeId,
    ...stay,
    excludeReservationId: reservation.id,
  });

  // Oda her gecesi boş olduğu için yerleştirmenin envanter etkisi tipteki her
  // oda için aynıdır; tip başına bir kez hesaplanır.
  const allTypeIds = [...typeById.keys()];
  const before = buildAvailabilityCalendar({ ...snapshot, from: stay.checkIn, to: stay.checkOut, roomTypeIds: allTypeIds });
  const inSnapshot = snapshot.reservations.some((row) => row.id === reservation.id);
  const overbooksByType = new Map();

  const wouldOverbook = (room) => {
    if (!overbooksByType.has(room.roomTypeId)) {
      const place = (row) => ({ ...row, roomId: room.id, roomSince: stayFrom > row.checkIn ? stayFrom : row.roomSince ?? null });
      const reservations = inSnapshot
        ? snapshot.reservations.map((row) => (row.id === reservation.id ? place(row) : row))
        : [...snapshot.reservations, place(reservation)];
      const after = buildAvailabilityCalendar({
        ...snapshot,
        reservations,
        from: stay.checkIn,
        to: stay.checkOut,
        roomTypeIds: allTypeIds,
      });
      overbooksByType.set(room.roomTypeId, findNewOverbooking(before, after, [room.roomTypeId]).length > 0);
    }
    return overbooksByType.get(room.roomTypeId);
  };

  const eligible = [];
  for (const room of free) {
    const type = typeById.get(room.roomTypeId);
    if (!type) continue;
    const kind = assignmentKind(reservedType, type);
    if (kind !== 'SAME' && !fitsCapacity(reservation, type)) continue;
    if (wouldOverbook(room)) continue;
    eligible.push({ ...room, kind, type });
  }

  const arrivalIsToday = toUtcDayStart(reservation.checkIn) <= businessDate.getTime();
  const priceDistance = (room) => toDecimal(room.type.basePrice).minus(toDecimal(reservedType.basePrice)).abs();

  const ordered = ASSIGNMENT_KIND_ORDER.flatMap((kind) =>
    // Array.prototype.sort kararlıdır: aynı fiyat mesafesinde rankRooms sırası korunur.
    rankRooms(
      eligible.filter((room) => room.kind === kind),
      { arrivalIsToday },
    ).sort((a, b) => priceDistance(a).comparedTo(priceDistance(b))),
  );

  // Otomatik atama yalnızca misafirin kendi tipinden seçer; öneri de oradan.
  const recommendedId = ordered.find((room) => room.kind === 'SAME')?.id ?? null;

  return ordered.map((room) => ({
    id: room.id,
    number: room.number,
    floor: room.floor,
    occupancy: room.occupancy,
    housekeepingStatus: room.housekeepingStatus,
    roomTypeId: room.roomTypeId,
    roomTypeCode: room.type.code,
    roomTypeName: room.type.name,
    kind: room.kind,
    recommended: room.id === recommendedId,
  }));
}

/**
 * Bir rezervasyona atanabilecek odalar (sayfalı).
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ includeOtherTypes?: boolean, page?: number, pageSize?: number }} [options]
 */
export async function getAssignableRooms(hotelId, reservationId, { includeOtherTypes = false, page = 1, pageSize = 25 } = {}) {
  const [reservation, businessDate] = await Promise.all([
    prisma.reservation.findFirst({
      where: { id: reservationId, hotelId },
      select: {
        id: true,
        roomTypeId: true,
        roomId: true,
        checkIn: true,
        checkOut: true,
        roomSince: true,
        status: true,
        adults: true,
        children: true,
      },
    }),
    getBusinessDate(hotelId),
  ]);
  if (!reservation) throw new NotFoundError('Rezervasyon bulunamadı');
  // Liste yalnızca okuma: içerideki misafir için de "hangi odalar boş" sorusu
  // meşru (oda değişikliği). Yerleştirmeyi yine `changeRoom` yapar.
  assertAssignable(reservation, businessDate, { allowInHouse: true });

  const ranked = await rankAssignableRooms(prisma, hotelId, reservation, businessDate, { includeOtherTypes });
  const { skip, take } = toSkipTake({ page, pageSize });

  return {
    ...buildPage(ranked.slice(skip, skip + take), ranked.length, { page, pageSize }),
    recommendedRoomId: ranked.find((room) => room.recommended)?.id ?? null,
  };
}

/**
 * Hedef odanın bu konaklamaya uygunluğu — atama ve oda değişikliğinin ortak
 * kontrolleri. Sırayla: kapasite, arıza kaydı, başka rezervasyon, hedef tipte
 * yeni overbooking. Hepsi kullanıcıya **neden** olmadığını söylemek için;
 * garantiyi veritabanı verir.
 *
 * İçerideki misafir taşınırken kontrol **kalan geceler** içindir: önceki
 * geceler eski odada geçti (`RoomStaySegment`) ve veritabanı kısıtları da
 * yalnızca açık dilime (`roomSince`'ten itibaren) bakar.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{
 *   room: { id: string, number: string, roomTypeId: string, roomType: { code: string, capacityAdults: number, capacityChildren: number } },
 *   reservation: { id: string, roomTypeId: string, checkIn: Date, checkOut: Date, roomSince?: Date | null, adults: number, children: number },
 *   actionLabel: string,
 *   stayFrom?: Date,
 * }} context `actionLabel`: overbooking mesajının öznesi; `stayFrom`: kontrolün
 *   başlayacağı gece (içerideki misafir için bugün, aksi hâlde giriş).
 */
async function assertRoomUsableForStay(tx, hotelId, { room, reservation, actionLabel, stayFrom }) {
  if (room.roomTypeId !== reservation.roomTypeId && !fitsCapacity(reservation, room.roomType)) {
    throw new ConflictError(
      `${room.number} numaralı oda (${room.roomType.code}) en fazla ${room.roomType.capacityAdults} yetişkin, ` +
        `${room.roomType.capacityChildren} çocuk alır; rezervasyonda ${reservation.adults} yetişkin, ` +
        `${reservation.children} çocuk var.`,
      'CAPACITY_EXCEEDED',
    );
  }

  // Misafir içerideyse yalnızca kalan geceler önemli: geçmiş gecelerde hedef
  // odada kim kaldığı ya da odanın arızalı olup olmadığı taşımayı engellemez.
  const from = stayFrom ?? reservation.checkIn;
  const snapshot = await loadInventorySnapshot(tx, hotelId, from, reservation.checkOut, {
    roomTypeIds: [room.roomTypeId],
  });
  const stayRange = { start: from, end: reservation.checkOut };

  const blocking = snapshot.blocks.find(
    (block) => block.roomId === room.id && rangesOverlapHalfOpen({ start: block.startDate, end: block.endDate }, stayRange),
  );
  if (blocking) {
    const until = blocking.endDate ? formatDay(blocking.endDate) : 'süresiz';
    throw new ConflictError(
      `${room.number} numaralı oda ${formatDay(blocking.startDate)} – ${until} arası ` +
        `${ROOM_BLOCK_TYPE_LABELS[blocking.type].toLocaleLowerCase('tr')} ("${blocking.reason}"); bu konaklamaya atanamaz.`,
      'ROOM_NOT_FREE',
      { blockId: blocking.id, type: blocking.type },
    );
  }

  const occupiedBy =
    snapshot.reservations.find(
      (row) =>
        row.id !== reservation.id &&
        row.roomId === room.id &&
        consumesInventory(row) &&
        rangesOverlapHalfOpen({ start: openSliceStart(row), end: row.checkOut }, stayRange),
    ) ??
    snapshot.segments.find(
      (segment) =>
        segment.reservationId !== reservation.id &&
        segment.roomId === room.id &&
        rangesOverlapHalfOpen({ start: segment.startDate, end: segment.endDate }, stayRange),
    );
  if (occupiedBy) {
    throw new ConflictError(
      `${room.number} numaralı oda bu gecelerde başka bir rezervasyona ait.`,
      'ROOM_NOT_FREE',
    );
  }

  const placed = (row) => ({
    ...row,
    roomId: room.id,
    roomSince: toUtcDayStart(from) > toUtcDayStart(row.checkIn) ? new Date(toUtcDayStart(from)) : row.roomSince ?? null,
  });
  await assertNoNewOverbooking(tx, hotelId, {
    roomTypeIds: [room.roomTypeId],
    from,
    to: reservation.checkOut,
    snapshot,
    apply: (base) => ({
      ...base,
      reservations: base.reservations.some((row) => row.id === reservation.id)
        ? base.reservations.map((row) => (row.id === reservation.id ? placed(row) : row))
        : [...base.reservations, placed(reservation)],
    }),
    action: actionLabel,
  });
}

/**
 * Rezervasyona oda atar.
 *
 * Uygulama kontrolleri kullanıcıya **neden** olmadığını söylemek için:
 * arızalı/hizmet dışı kayıt, başka rezervasyon, kapasite, hedef tipte
 * overbooking. Garantiyi yine de veritabanı verir (çifte rezervasyon EXCLUDE
 * kısıtı ve rezervasyon ↔ arıza tetikleyicisi) — iki personel aynı anda son
 * odayı atasa bile ikincisi reddedilir.
 *
 * Misafir içerideyken (giriş yapmış) bu fonksiyon kullanılmaz; oda değişikliği
 * `changeRoom` üzerinden yapılır, çünkü eski ve yeni odanın durumu da değişir.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {string} roomId
 * @param {{ assignedBy?: 'manual' | 'auto', reason?: string | null, onlyIfUnassigned?: boolean }} [options]
 *   `onlyIfUnassigned`: otomatik atama — rezervasyona bu arada (elle) oda
 *   verildiyse üzerine yazılmaz, `ALREADY_ASSIGNED` hatası döner.
 */
export async function assignRoom(
  hotelId,
  reservationId,
  roomId,
  { assignedBy = 'manual', reason = null, onlyIfUnassigned = false } = {},
) {
  const businessDate = await getBusinessDate(hotelId);

  try {
    return await writeWithEvents(async (tx, stage) => {
      const reservation = await lockAssignableReservation(tx, hotelId, reservationId);
      if (onlyIfUnassigned && reservation.roomId && reservation.roomId !== roomId) {
        throw new ConflictError(
          `Rezervasyona bu arada ${reservation.room?.number ?? 'başka bir'} numaralı oda atanmış; dokunulmadı.`,
          'ALREADY_ASSIGNED',
          { roomId: reservation.roomId, roomNumber: reservation.room?.number ?? null },
        );
      }
      assertAssignable(reservation, businessDate);
      return assignLockedReservation(tx, stage, hotelId, reservation, roomId, { assignedBy, reason });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Kilitli (ve atanabilir olduğu denetlenmiş) rezervasyona odayı verir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {string} hotelId
 * @param {Awaited<ReturnType<typeof loadAssignableReservation>>} reservation
 * @param {string} roomId
 * @param {{ assignedBy: 'manual' | 'auto', reason: string | null }} options
 */
async function assignLockedReservation(tx, stage, hotelId, reservation, roomId, { assignedBy, reason }) {
  const reservationId = reservation.id;
  const room = await tx.room.findFirst({
    where: { id: roomId, hotelId },
    include: {
      roomType: { select: { code: true, capacityAdults: true, capacityChildren: true } },
    },
  });
  if (!room) throw new NotFoundError('Oda bulunamadı');

  if (reservation.roomId === roomId) {
    return toReservationSummaryDto(reservation);
  }

  await lockRoomTypes(tx, hotelId, [room.roomTypeId]);
  await lockRooms(tx, hotelId, [roomId, reservation.roomId]);

  await assertRoomUsableForStay(tx, hotelId, {
    room,
    reservation,
    actionLabel: `Misafiri ${room.number} numaralı odaya yerleştirmek`,
  });

  const previousRoomId = reservation.roomId;
  const previousRoomNumber = reservation.room?.number ?? null;

  await tx.reservation.update({ where: { id: reservationId }, data: { roomId } });

  const after = await loadAssignableReservation(tx, hotelId, reservationId);
  const dto = toReservationSummaryDto(after);

  await recordAudit(tx, {
    hotelId,
    entity: 'Reservation',
    entityId: reservationId,
    action: 'UPDATE',
    before: { roomId: previousRoomId, roomNumber: previousRoomNumber },
    after: { roomId, roomNumber: room.number, reason: reason || null },
  });

  // Oda değiştirildiyse önce eskisinin bırakıldığı duyurulur; zincir
  // (Activity Feed) "301'den 305'e taşındı" olarak okunabilsin.
  if (previousRoomId) {
    await stage('room.unassigned', {
      hotelId,
      reservationId,
      roomId: previousRoomId,
      roomNumber: previousRoomNumber ?? '',
    });
  }
  await stage('room.assigned', {
    hotelId,
    reservationId,
    roomId,
    roomNumber: room.number,
    assignedBy,
  });

  return dto;
}

/**
 * Çağıranın transaction'ında odayı verir (modül 4: oda planından "bu odaya
 * rezervasyon aç"). Rezervasyon aynı transaction'da yeni açıldığı için ayrıca
 * kilitlenmez (henüz kimse göremez); oda tipi ve oda kilidi, uygunluk ve
 * overbooking denetimleri `assignRoom` ile aynıdır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {string} roomId
 * @param {{ businessDate: Date, assignedBy?: 'manual' | 'auto', reason?: string | null }} options
 */
export async function assignRoomInTransaction(tx, stage, hotelId, reservationId, roomId, { businessDate, assignedBy = 'manual', reason = null }) {
  const reservation = await loadAssignableReservation(tx, hotelId, reservationId);
  assertAssignable(reservation, businessDate);
  return assignLockedReservation(tx, stage, hotelId, reservation, roomId, { assignedBy, reason });
}

/**
 * Atanmış oda, rezervasyonun **yeni** hâline (tarih, tip, kişi) uyuyor mu?
 * Uymuyorsa sebebi (`ConflictError`: `ROOM_NOT_FREE`, `CAPACITY_EXCEEDED`,
 * `WOULD_OVERBOOK`) döner; fırlatmaz — çağıran atamayı kaldırmakla hata
 * vermek arasında karar verir (modül 4 düzenleme, iptal geri alma).
 *
 * Denetim yazmadan **önce** yapılmalı: yazma sırasında veritabanı çifte
 * rezervasyonu reddeder ve transaction kullanılamaz hâle gelir. Rezervasyon
 * satırı veritabanında eski hâliyle durur; kontrol onu yeni hâliyle yerleştirir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} roomId
 * @param {{ id: string, roomTypeId: string, checkIn: Date, checkOut: Date, roomSince: Date | null, status: string, adults: number, children: number }} reservation yeni hâl
 * @param {{ stayFrom?: Date }} [options] içerideki misafirde kalan gecelerin ilki
 * @returns {Promise<ConflictError | null>}
 */
export async function roomConflictForStay(tx, hotelId, roomId, reservation, { stayFrom } = {}) {
  const room = await tx.room.findFirst({
    where: { id: roomId, hotelId },
    include: { roomType: { select: { code: true, capacityAdults: true, capacityChildren: true } } },
  });
  if (!room) return new ConflictError('Atanmış oda artık yok', 'ROOM_NOT_FREE');
  // Aynı tipte oda: yerleştirmenin envanter etkisi sıfırdır, kapasite zaten
  // tipin kapasitesidir; yine de kişi sayısı değişmiş olabilir.
  if (!fitsCapacity(reservation, room.roomType)) {
    return new ConflictError(
      `${room.number} numaralı oda en fazla ${room.roomType.capacityAdults} yetişkin, ${room.roomType.capacityChildren} çocuk alır.`,
      'CAPACITY_EXCEEDED',
    );
  }
  try {
    await assertRoomUsableForStay(tx, hotelId, {
      room,
      reservation,
      actionLabel: `Misafiri ${room.number} numaralı odada tutmak`,
      stayFrom,
    });
    return null;
  } catch (error) {
    if (error instanceof ConflictError) return error;
    throw error;
  }
}

/**
 * @param {string} hotelId
 * @param {string} reservationId
 */
export async function unassignRoom(hotelId, reservationId) {
  const businessDate = await getBusinessDate(hotelId);

  return writeWithEvents(async (tx, stage) => {
    const reservation = await lockAssignableReservation(tx, hotelId, reservationId);

    if (!reservation.roomId) {
      throw new ConflictError('Bu rezervasyonda atanmış oda yok', 'NOT_ASSIGNED');
    }
    if (reservation.status === 'CHECKED_IN') {
      throw new ConflictError(
        'Misafir odada olduğu için oda kaydı kaldırılamaz. Önce oda değişikliği veya çıkış işlemi yapın.',
        'GUEST_IN_ROOM',
      );
    }
    // Bitmiş konaklamanın odasını silmek geçmişi yeniden yazar: gece
    // raporları "o gece bu oda boştu" der.
    if (toUtcDayStart(reservation.checkOut) <= businessDate.getTime()) {
      throw new ConflictError('Bu konaklamanın tarihleri geçmiş; oda kaydı değiştirilemez.', 'STAY_ENDED');
    }

    await lockRooms(tx, hotelId, [reservation.roomId]);

    const roomNumber = reservation.room?.number ?? '';
    const previousRoomId = reservation.roomId;

    await tx.reservation.update({ where: { id: reservationId }, data: { roomId: null } });

    await recordAudit(tx, {
      hotelId,
      entity: 'Reservation',
      entityId: reservationId,
      action: 'UPDATE',
      before: { roomId: previousRoomId, roomNumber },
      after: { roomId: null, roomNumber: null },
    });
    await stage('room.unassigned', { hotelId, reservationId, roomId: previousRoomId, roomNumber });

    const after = await loadAssignableReservation(tx, hotelId, reservationId);
    return toReservationSummaryDto(after);
  });
}

/**
 * Oda planındaki tek işlem: rezervasyona oda ver ya da odasını değiştir.
 *
 * Üç senaryo aynı yerden geçer, çünkü personel açısından hepsi "şu rezervasyonu
 * şu odaya koy" hareketidir — ama sonuçları farklıdır:
 *
 * - `ASSIGNED` / `MOVED`: misafir henüz gelmemiş; yalnızca kayıttaki oda değişir
 *   (atamanın tüm kontrolleriyle).
 * - `IN_HOUSE_MOVED`: misafir içeride. Rezervasyonun odası değişir **ve** oda
 *   durumları aynı transaction'da düzeltilir: eski oda boş + kirli (teknisyen
 *   ya da kat hizmeti girecek), yeni oda dolu. Aksi hâlde eski oda "dolu" kalıp
 *   satılamaz, yeni oda "boş" görünüp ikinci kez satılırdı.
 * - `UNCHANGED`: zaten o odada; yazma yapılmaz (sürükle-bırakta sık olur).
 *
 * Hangi senaryonun geçerli olduğu **kilitli** rezervasyondan okunur: aynı
 * misafiri aynı anda başka odaya taşıyan (ya da giriş yaptıran) işlem
 * bitmeden karar verilmez; aksi hâlde ikinci taşıma eski okumayla çalışır ve
 * ilk taşımanın odası sahipsiz "dolu" kalır.
 *
 * İçerideki misafir taşınırken eski odada geçen geceler kapanmış bir dilim
 * (`RoomStaySegment`) olarak yazılır, rezervasyonun açık dilimi bugünden
 * başlar (`roomSince`). Böylece geçmiş yeniden yazılmaz: dün gece misafir
 * hâlâ eski odada görünür, gece kapanışı ve faturalama doğru odayı okur.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {string} roomId
 * @param {{ reason?: string | null }} [options] taşıma sebebi (geçmişe ve denetim izine yazılır)
 * @returns {Promise<{ mode: 'ASSIGNED' | 'MOVED' | 'IN_HOUSE_MOVED' | 'UNCHANGED', reservation: object, previousRoomNumber: string | null }>}
 */
export async function changeRoom(hotelId, reservationId, roomId, { reason = null } = {}) {
  const businessDate = await getBusinessDate(hotelId);

  try {
    return await writeWithEvents(async (tx, stage) => {
      const reservation = await lockAssignableReservation(tx, hotelId, reservationId);
      const previousRoomNumber = reservation.room?.number ?? null;
      const mode = roomChangeMode(reservation);

      if (mode !== 'IN_HOUSE_MOVED') {
        assertAssignable(reservation, businessDate);
        const unchanged = reservation.roomId === roomId;
        const dto = await assignLockedReservation(tx, stage, hotelId, reservation, roomId, {
          assignedBy: 'manual',
          reason,
        });
        return { mode: unchanged ? 'UNCHANGED' : mode, reservation: dto, previousRoomNumber };
      }

      if (reservation.roomId === roomId) {
        return { mode: 'UNCHANGED', reservation: toReservationSummaryDto(reservation), previousRoomNumber };
      }
      if (toUtcDayStart(reservation.checkOut) <= businessDate.getTime()) {
        throw new ConflictError('Bu konaklama sona ermiş; oda değişikliği yapılamaz.', 'STAY_ENDED');
      }

      const room = await tx.room.findFirst({
        where: { id: roomId, hotelId },
        include: { roomType: { select: { code: true, capacityAdults: true, capacityChildren: true } } },
      });
      if (!room) throw new NotFoundError('Oda bulunamadı');

      await lockRoomTypes(tx, hotelId, [room.roomTypeId]);
      await lockRooms(tx, hotelId, [roomId, reservation.roomId]);

      // Kalan geceler: bugünden (ya da henüz başlamadıysa girişten) çıkışa.
      const stayFrom = inHouseStayFrom(reservation, businessDate);

      await assertRoomUsableForStay(tx, hotelId, {
        room,
        reservation,
        stayFrom,
        actionLabel: `Misafiri ${room.number} numaralı odaya taşımak`,
      });

      // Oda durumları kilit alındıktan sonra okunur: bu arada değişmiş olabilir.
      const roomStateSelect = { id: true, number: true, occupancy: true, housekeepingStatus: true };
      const [previousRoom, targetRoom] = await Promise.all([
        reservation.roomId
          ? tx.room.findFirst({ where: { id: reservation.roomId, hotelId }, select: roomStateSelect })
          : null,
        tx.room.findFirst({ where: { id: roomId, hotelId }, select: roomStateSelect }),
      ]);

      // Eski odadaki geceler kapanır. Aynı gün ikinci kez taşınan misafirin
      // eski odada gecesi yoktur (boş aralık yazılmaz).
      const previousStart = new Date(toUtcDayStart(openSliceStart(reservation)));
      const segment =
        previousRoom && stayFrom > previousStart
          ? await tx.roomStaySegment.create({
              data: {
                hotelId,
                reservationId,
                roomId: previousRoom.id,
                startDate: previousStart,
                endDate: stayFrom,
                movedBy: currentActor(),
                reason: reason || null,
              },
            })
          : null;

      const roomSince = stayFrom > new Date(toUtcDayStart(reservation.checkIn)) ? stayFrom : null;
      await tx.reservation.update({ where: { id: reservationId }, data: { roomId, roomSince } });

      await recordAudit(tx, {
        hotelId,
        entity: 'Reservation',
        entityId: reservationId,
        action: 'UPDATE',
        before: {
          roomId: reservation.roomId,
          roomNumber: previousRoom?.number ?? null,
          roomSince: reservation.roomSince ? toIsoDay(reservation.roomSince) : null,
        },
        after: {
          roomId,
          roomNumber: room.number,
          roomSince: roomSince ? toIsoDay(roomSince) : null,
          segmentId: segment?.id ?? null,
          reason: reason || null,
        },
      });

      const stateReason =
        `Misafir ${previousRoom?.number ?? '—'} → ${room.number} odasına taşındı` + (reason ? ` (${reason})` : '');
      if (previousRoom) {
        // Boşalan oda temizlik bekler: misafir eşyasıyla çıktı, oda kullanılmış.
        await writeRoomState(
          tx,
          stage,
          hotelId,
          previousRoom,
          { occupancy: 'VACANT', housekeepingStatus: 'DIRTY' },
          stateReason,
        );
      }
      await writeRoomState(tx, stage, hotelId, targetRoom, { occupancy: 'OCCUPIED' }, stateReason);

      if (previousRoom) {
        await stage('room.unassigned', {
          hotelId,
          reservationId,
          roomId: previousRoom.id,
          roomNumber: previousRoom.number,
        });
      }
      await stage('room.assigned', { hotelId, reservationId, roomId, roomNumber: room.number, assignedBy: 'manual' });

      const after = await loadAssignableReservation(tx, hotelId, reservationId);
      return {
        mode: 'IN_HOUSE_MOVED',
        reservation: toReservationSummaryDto(after),
        previousRoomNumber: previousRoom?.number ?? null,
      };
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * Oda atanmayı bekleyen rezervasyonlar.
 *
 * Modül 4'ün rezervasyon detay ekranı gelene kadar atama işinin yapıldığı yer
 * burası; o ekran geldiğinde aynı API oradan da kullanılacak. Konaklaması
 * bitmiş (gece kapanışı işlenmemiş) kayıtlar listelenmez — onlara oda atamak
 * anlamsız, ele alınması modül 18'in işi.
 *
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string }} query
 */
export async function listUnassignedReservations(hotelId, query) {
  const businessDate = await getBusinessDate(hotelId);
  const where = {
    hotelId,
    roomId: null,
    status: { in: ASSIGNABLE_STATUSES },
    checkOut: { gt: businessDate },
    ...(query.search
      ? {
          OR: [
            { confirmationCode: { contains: query.search, mode: 'insensitive' } },
            { guest: { firstName: { contains: query.search, mode: 'insensitive' } } },
            { guest: { lastName: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.reservation.findMany({
      where,
      include: {
        guest: { select: { firstName: true, lastName: true } },
        roomType: { select: ROOM_TYPE_SUMMARY },
        room: { select: { number: true } },
      },
      // Girişi en yakın olan en acildir.
      orderBy: [{ checkIn: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.reservation.count({ where }),
  ]);

  return buildPage(items.map(toReservationSummaryDto), total, query);
}

/**
 * Otomatik atama: aktörün (room-worker) kullandığı giriş noktası.
 *
 * Yalnızca misafirin kendi tipinden seçer. Seçtiği oda yarışta başka bir
 * atamaya giderse (`ROOM_NOT_FREE`) taze listeyle sıradaki odayı dener —
 * eskiden bu durumda iş hata verip manuel göreve düşüyordu. Rezervasyona bu
 * arada (elle) oda verildiyse dokunmaz (`alreadyAssigned`).
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @returns {Promise<{ assigned: boolean, alreadyAssigned?: boolean, room?: { id: string, number: string }, reason?: string }>}
 */
export async function autoAssignRoom(hotelId, reservationId) {
  for (let attempt = 1; attempt <= AUTO_ASSIGN_MAX_ATTEMPTS; attempt += 1) {
    const current = await prisma.reservation.findFirst({
      where: { id: reservationId, hotelId },
      select: { roomId: true, room: { select: { number: true } } },
    });
    if (current?.roomId) {
      return { assigned: false, alreadyAssigned: true, room: { id: current.roomId, number: current.room?.number ?? '' } };
    }

    const { items } = await getAssignableRooms(hotelId, reservationId, { includeOtherTypes: false, page: 1, pageSize: 1 });
    const best = items[0];
    if (!best) return { assigned: false, reason: 'Uygun boş oda bulunamadı' };

    try {
      await assignRoom(hotelId, reservationId, best.id, { assignedBy: 'auto', onlyIfUnassigned: true });
      return { assigned: true, room: { id: best.id, number: best.number } };
    } catch (error) {
      if (error?.code === 'ALREADY_ASSIGNED') {
        return {
          assigned: false,
          alreadyAssigned: true,
          room: { id: error.details.roomId, number: error.details.roomNumber ?? '' },
        };
      }
      if (!RETRYABLE_ASSIGNMENT_CODES.has(error?.code)) throw error;
    }
  }

  return {
    assigned: false,
    reason: `Eşzamanlı atamalar nedeniyle ${AUTO_ASSIGN_MAX_ATTEMPTS} denemede oda ayrılamadı; elle atayın`,
  };
}
