import { addDays, toIsoDay } from '@hotelos/core';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { cache } from '../../lib/cache.js';
import { ConflictError, InUseError, NotFoundError, rethrowPrismaError, StaleWriteError, ValidationError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import {
  availabilityForStay,
  buildAvailabilityCalendar,
  freeRoomsForStay,
  INVENTORY_CONSUMING_STATUSES,
  pickBestRoom,
} from './rules.js';

/**
 * Oda envanteri, müsaitlik ve oda atama servisi.
 *
 * ### İki kaynak, tek doğru
 *
 * `Room.status` **şu anki** operasyonel durumdur (boş / dolu / kirli /
 * temizlikte) — kat planı ekranı bunu gösterir. Gelecekteki satılabilirliği
 * ise `RoomBlock` belirler, çünkü tarih bilir. Müsaitlik hesabı yalnızca
 * `RoomBlock`'a bakar; `status` ona girdi değildir.
 *
 * İkisinin tutarlı kalması bu servisin sorumluluğu: blok konulduğunda ve
 * kaldırıldığında oda durumu da güncellenir.
 *
 * ### Müsaitlik neden cache'lenmiyor
 *
 * Ayarlar (oda tipi, vergi, sezon) nadiren değişir, cache'lenir. Müsaitlik ise
 * her rezervasyonda değişir ve her tarih penceresi ayrı bir sonuçtur —
 * cache'lemek bayat veri riskini büyütür, isabet oranı düşük kalır. Bunun
 * yerine **sabit girdiler** (oda listesi) cache'lenir, hesap her seferinde
 * taze yapılır.
 */

const HOT_READ_TTL_MS = 5 * 60_000;

/** Oda atanabilecek rezervasyon durumları. */
const ASSIGNABLE_STATUSES = ['PENDING', 'CONFIRMED'];

/** Hata mesajında örnek olarak gösterilecek en fazla kayıt sayısı. */
const CONFLICT_SAMPLE_LIMIT = 5;

/* ══════════════════ Dönüştürücüler ══════════════════ */

function toRoomDto(row) {
  return {
    id: row.id,
    number: row.number,
    floor: row.floor,
    roomTypeId: row.roomTypeId,
    roomTypeCode: row.roomType?.code ?? null,
    roomTypeName: row.roomType?.name ?? null,
    status: row.status,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toBlockDto(row) {
  return {
    id: row.id,
    roomId: row.roomId,
    roomNumber: row.room?.number ?? null,
    startDate: toIsoDay(row.startDate),
    endDate: row.endDate ? toIsoDay(row.endDate) : null,
    reason: row.reason,
    createdBy: row.createdBy,
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
 * Denetim izine yazılacak anlık görüntü: türetilmiş alanlar ayıklanır.
 * @param {Record<string, unknown>} dto
 */
function toSnapshot({ roomTypeCode, roomTypeName, roomNumber, guestName, ...rest }) {
  return rest;
}

/* ══════════════════ Ortak yardımcılar ══════════════════ */

/**
 * Optimistic lock'lu güncelleme (bkz. settings/service.js'teki eşi).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} model
 * @param {Record<string, unknown>} identity
 * @param {Date} expectedUpdatedAt
 * @param {Record<string, unknown>} data
 * @param {string} notFoundMessage
 */
async function updateWithVersionCheck(tx, model, identity, expectedUpdatedAt, data, notFoundMessage) {
  const result = await tx[model].updateMany({ where: { ...identity, updatedAt: expectedUpdatedAt }, data });

  if (result.count === 0) {
    const exists = await tx[model].findFirst({ where: identity, select: { id: true } });
    if (!exists) throw new NotFoundError(notFoundMessage);
    throw new StaleWriteError();
  }
}

/** @param {Record<string, number>} counts */
function nonZero(counts) {
  return Object.fromEntries(Object.entries(counts).filter(([, value]) => value > 0));
}

/**
 * Müsaitlik hesabının ham girdilerini tek seferde toplar.
 *
 * Üç sorgu atar ve gün gün döngüye girmez — 90 günlük pencere de 3 gün de
 * aynı sayıda sorgu demektir. Gece başına sorgu atan naif yaklaşım, dolu bir
 * otelde saniyeler süren bir ekran üretirdi.
 *
 * @param {string} hotelId
 * @param {Date} from
 * @param {Date} to
 */
async function loadInventorySnapshot(hotelId, from, to) {
  const [rooms, reservations, blocks] = await Promise.all([
    prisma.room.findMany({
      where: { hotelId },
      select: { id: true, number: true, floor: true, roomTypeId: true, status: true },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    }),
    prisma.reservation.findMany({
      where: {
        hotelId,
        status: { in: INVENTORY_CONSUMING_STATUSES },
        // Yarı açık kesişim: pencerede en az bir gecesi olanlar.
        checkIn: { lt: to },
        checkOut: { gt: from },
      },
      select: { id: true, roomId: true, roomTypeId: true, checkIn: true, checkOut: true, status: true },
    }),
    prisma.roomBlock.findMany({
      where: {
        hotelId,
        startDate: { lt: to },
        // Süresiz bloklar (endDate = null) da pencereyi etkiler.
        OR: [{ endDate: null }, { endDate: { gt: from } }],
      },
      select: { id: true, roomId: true, startDate: true, endDate: true, reason: true },
    }),
  ]);

  return { rooms, reservations, blocks };
}

/* ══════════════════ Oda CRUD ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, roomTypeId?: string, status?: string, floor?: number }} query
 */
export async function listRooms(hotelId, query) {
  const where = {
    hotelId,
    ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.floor !== undefined ? { floor: query.floor } : {}),
    ...(query.search ? { number: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.room.findMany({
      where,
      include: { roomType: { select: { code: true, name: true } } },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.room.count({ where }),
  ]);

  return buildPage(items.map(toRoomDto), total, query);
}

/**
 * @param {string} hotelId
 * @param {object} input
 */
export async function createRoom(hotelId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const roomType = await tx.roomType.findFirst({
        where: { id: input.roomTypeId, hotelId },
        select: { id: true },
      });
      if (!roomType) throw new ValidationError('Seçilen oda tipi bulunamadı');

      const created = await tx.room.create({
        data: { hotelId, ...input, notes: input.notes || null },
        include: { roomType: { select: { code: true, name: true } } },
      });
      const dto = toRoomDto(created);

      await recordAudit(tx, {
        hotelId,
        entity: 'Room',
        entityId: created.id,
        action: 'CREATE',
        after: toSnapshot(dto),
      });
      await stage('inventory.room.created', {
        hotelId,
        id: created.id,
        label: `${dto.number}`,
        roomTypeId: dto.roomTypeId,
      });

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `"${input.number}" numaralı bir oda zaten var` });
  }
}

/**
 * @param {string} hotelId
 * @param {string} id
 * @param {object} input
 */
export async function updateRoom(hotelId, id, input) {
  const { expectedUpdatedAt, ...data } = input;

  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.room.findFirst({
        where: { id, hotelId },
        include: { roomType: { select: { code: true, name: true } } },
      });
      if (!before) throw new NotFoundError('Oda bulunamadı');

      const roomType = await tx.roomType.findFirst({
        where: { id: data.roomTypeId, hotelId },
        select: { id: true },
      });
      if (!roomType) throw new ValidationError('Seçilen oda tipi bulunamadı');

      // Oda tipi değişiyorsa, aktif rezervasyonlar yanlış tipte kalır.
      if (data.roomTypeId !== before.roomTypeId) {
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
      }

      await updateWithVersionCheck(
        tx,
        'room',
        { id, hotelId },
        expectedUpdatedAt,
        { ...data, notes: data.notes || null },
        'Oda bulunamadı',
      );

      const after = await tx.room.findFirst({
        where: { id },
        include: { roomType: { select: { code: true, name: true } } },
      });
      const dto = toRoomDto(after);

      const changedFields = await recordAudit(tx, {
        hotelId,
        entity: 'Room',
        entityId: id,
        action: 'UPDATE',
        before: toSnapshot(toRoomDto(before)),
        after: toSnapshot(dto),
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
 * @param {string} hotelId
 * @param {string} id
 */
export async function deleteRoom(hotelId, id) {
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.room.findFirst({
      where: { id, hotelId },
      include: { roomType: { select: { code: true, name: true } } },
    });
    if (!existing) throw new NotFoundError('Oda bulunamadı');

    const [activeReservations, activeBlocks] = await Promise.all([
      tx.reservation.count({ where: { roomId: id, hotelId, status: { in: INVENTORY_CONSUMING_STATUSES } } }),
      tx.roomBlock.count({ where: { roomId: id, hotelId } }),
    ]);

    const usage = nonZero({ aktifRezervasyon: activeReservations, blok: activeBlocks });
    if (Object.keys(usage).length > 0) {
      throw new InUseError(
        `"${existing.number}" numaralı oda kullanımda olduğu için silinemez. Önce bağlı kayıtları kaldırın.`,
        usage,
      );
    }

    await tx.room.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Room',
      entityId: id,
      action: 'DELETE',
      before: toSnapshot(toRoomDto(existing)),
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
 * Operasyonel durum değişikliği (temizlendi, kirlendi...).
 *
 * Bloklu bir odanın durumu buradan değiştirilemez: `BLOCKED`/`MAINTENANCE`
 * durumunun sahibi blok kaydıdır, elle geri alınırsa iki kaynak ayrışır.
 *
 * @param {string} hotelId
 * @param {string} id
 * @param {{ status: string, expectedUpdatedAt: Date }} input
 */
export async function setRoomStatus(hotelId, id, { status, expectedUpdatedAt }) {
  return writeWithEvents(async (tx, stage) => {
    const before = await tx.room.findFirst({
      where: { id, hotelId },
      include: { roomType: { select: { code: true, name: true } } },
    });
    if (!before) throw new NotFoundError('Oda bulunamadı');

    const activeBlock = await tx.roomBlock.findFirst({
      where: {
        roomId: id,
        hotelId,
        startDate: { lte: new Date() },
        OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      },
      select: { id: true, reason: true },
    });
    if (activeBlock) {
      throw new ConflictError(
        `Bu oda şu an bloklu ("${activeBlock.reason}"). Durumu değiştirmek için önce bloğu kaldırın.`,
        'ROOM_BLOCKED',
      );
    }

    if (before.status === status) return toRoomDto(before);

    await updateWithVersionCheck(tx, 'room', { id, hotelId }, expectedUpdatedAt, { status }, 'Oda bulunamadı');

    const after = await tx.room.findFirst({
      where: { id },
      include: { roomType: { select: { code: true, name: true } } },
    });
    const dto = toRoomDto(after);

    await recordAudit(tx, {
      hotelId,
      entity: 'Room',
      entityId: id,
      action: 'UPDATE',
      before: toSnapshot(toRoomDto(before)),
      after: toSnapshot(dto),
    });
    await stage('room.status.changed', {
      hotelId,
      roomId: id,
      roomNumber: dto.number,
      from: before.status,
      to: status,
    });

    return dto;
  });
}

/**
 * Sistem kaynaklı durum değişikliği (aktörler, check-in/out akışı).
 *
 * `setRoomStatus`'tan iki farkı var ve ikisi de kasıtlı:
 * - Optimistic lock aranmaz: ortada form dolduran bir kullanıcı yok, olayın
 *   kendisi zaten olmuş bir gerçeği bildiriyor ("misafir çıktı").
 * - `OCCUPIED` gibi elle atanamayan durumlara da geçebilir.
 *
 * @param {string} hotelId
 * @param {string} roomId
 * @param {string} status
 * @param {string} reason Denetim izine yazılacak gerekçe
 */
export async function applySystemRoomStatus(hotelId, roomId, status, reason) {
  return writeWithEvents(async (tx, stage) => {
    const before = await tx.room.findFirst({ where: { id: roomId, hotelId } });
    if (!before) throw new NotFoundError('Oda bulunamadı');
    if (before.status === status) return { changed: false, status };

    await tx.room.update({ where: { id: roomId }, data: { status } });

    await recordAudit(tx, {
      hotelId,
      entity: 'Room',
      entityId: roomId,
      action: 'UPDATE',
      before: { status: before.status, reason: null },
      after: { status, reason },
    });
    await stage('room.status.changed', {
      hotelId,
      roomId,
      roomNumber: before.number,
      from: before.status,
      to: status,
    });

    return { changed: true, status };
  });
}

/* ══════════════════ Bloklar ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ roomId?: string, includePast?: boolean }} [filter]
 */
export async function listBlocks(hotelId, { roomId, includePast = false } = {}) {
  const rows = await prisma.roomBlock.findMany({
    where: {
      hotelId,
      ...(roomId ? { roomId } : {}),
      ...(includePast ? {} : { OR: [{ endDate: null }, { endDate: { gt: new Date() } }] }),
    },
    include: { room: { select: { number: true } } },
    orderBy: [{ startDate: 'asc' }],
  });
  return rows.map(toBlockDto);
}

/**
 * Odayı belirli tarihlerde satış dışı bırakır.
 *
 * O aralıkta aktif rezervasyon varsa reddedilir: bloklamak, misafirin
 * rezervasyonunu sessizce geçersiz kılmak olurdu. Çakışan başka bir blok
 * varsa veritabanı kısıtı (`RoomBlock_no_overlap`) engeller.
 *
 * @param {string} hotelId
 * @param {string} roomId
 * @param {{ startDate: Date, endDate?: Date | null, reason: string }} input
 */
export async function blockRoom(hotelId, roomId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const room = await tx.room.findFirst({ where: { id: roomId, hotelId }, select: { id: true, number: true } });
      if (!room) throw new NotFoundError('Oda bulunamadı');

      const conflictFilter = {
        hotelId,
        roomId,
        status: { in: INVENTORY_CONSUMING_STATUSES },
        checkIn: input.endDate ? { lt: input.endDate } : undefined,
        checkOut: { gt: input.startDate },
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
          `Bu tarihlerde odanın ${conflictCount} rezervasyonu var; bloklanamaz. Önce misafirleri başka odaya taşıyın.`,
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

      const created = await tx.roomBlock.create({
        data: {
          hotelId,
          roomId,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          reason: input.reason,
          createdBy: 'ui',
        },
        include: { room: { select: { number: true } } },
      });

      // Blok bugünü kapsıyorsa oda durumu da yansıtsın (kat planı ekranı için).
      const now = new Date();
      if (created.startDate <= now && (created.endDate === null || created.endDate > now)) {
        await tx.room.update({ where: { id: roomId }, data: { status: 'BLOCKED' } });
      }

      const dto = toBlockDto(created);
      await recordAudit(tx, {
        hotelId,
        entity: 'RoomBlock',
        entityId: created.id,
        action: 'CREATE',
        after: toSnapshot(dto),
      });
      await stage('room.blocked', {
        hotelId,
        roomId,
        roomNumber: room.number,
        blockId: created.id,
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
 * @param {string} hotelId
 * @param {string} blockId
 */
export async function unblockRoom(hotelId, blockId) {
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.roomBlock.findFirst({
      where: { id: blockId, hotelId },
      include: { room: { select: { id: true, number: true, status: true } } },
    });
    if (!existing) throw new NotFoundError('Blok bulunamadı');

    await tx.roomBlock.update({ where: { id: blockId }, data: { deletedAt: new Date() } });

    // Oda yalnızca bu blok yüzünden kapalıysa tekrar satışa açılır.
    // Kirli bırakmak kasıtlı: tadilattan çıkan oda temizlik ister.
    if (existing.room.status === 'BLOCKED') {
      const otherActiveBlock = await tx.roomBlock.findFirst({
        where: {
          roomId: existing.roomId,
          hotelId,
          id: { not: blockId },
          startDate: { lte: new Date() },
          OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
        },
        select: { id: true },
      });
      if (!otherActiveBlock) {
        await tx.room.update({ where: { id: existing.roomId }, data: { status: 'DIRTY' } });
      }
    }

    await recordAudit(tx, {
      hotelId,
      entity: 'RoomBlock',
      entityId: blockId,
      action: 'DELETE',
      before: toSnapshot(toBlockDto(existing)),
    });
    await stage('room.unblocked', {
      hotelId,
      roomId: existing.roomId,
      roomNumber: existing.room.number,
      blockId,
    });
  });
}

/* ══════════════════ Müsaitlik ══════════════════ */

/**
 * Müsaitlik takvimi: oda tipi × gece kırılımında boş oda sayısı.
 * @param {string} hotelId
 * @param {{ from: Date, to: Date, roomTypeId?: string }} query
 */
export async function getAvailabilityCalendar(hotelId, { from, to, roomTypeId }) {
  const [snapshot, roomTypes] = await Promise.all([
    loadInventorySnapshot(hotelId, from, to),
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
 */
export async function getStayAvailability(hotelId, { checkIn, checkOut, roomTypeId }) {
  const [snapshot, roomTypes] = await Promise.all([
    loadInventorySnapshot(hotelId, checkIn, checkOut),
    prisma.roomType.findMany({
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
 * "bu tarihlerde bu tipten yer var mı" diye bunu çağırmalı.
 *
 * @param {string} hotelId
 * @param {{ checkIn: Date, checkOut: Date, roomTypeId: string }} query
 * @returns {Promise<number>}
 */
export async function checkAvailability(hotelId, { checkIn, checkOut, roomTypeId }) {
  const result = await getStayAvailability(hotelId, { checkIn, checkOut, roomTypeId });
  return result.roomTypes.find((type) => type.id === roomTypeId)?.available ?? 0;
}

/* ══════════════════ Oda atama ══════════════════ */

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
      roomType: { select: { code: true, name: true } },
      room: { select: { number: true } },
    },
  });
  if (!reservation) throw new NotFoundError('Rezervasyon bulunamadı');
  return reservation;
}

/**
 * Bir rezervasyona atanabilecek odalar.
 *
 * Varsayılan olarak rezervasyonun oda tipiyle sınırlıdır; `includeOtherTypes`
 * ile üst sınıf odalar da listelenebilir (upgrade). Upgrade envanteri bozmaz:
 * misafir Deluxe'e geçtiğinde Standart envanteri boşalır, hesap bunu doğru
 * yansıtır.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {{ includeOtherTypes?: boolean }} [options]
 */
export async function getAssignableRooms(hotelId, reservationId, { includeOtherTypes = false } = {}) {
  const reservation = await prisma.reservation.findFirst({
    where: { id: reservationId, hotelId },
    select: { id: true, roomTypeId: true, checkIn: true, checkOut: true, status: true },
  });
  if (!reservation) throw new NotFoundError('Rezervasyon bulunamadı');

  const snapshot = await loadInventorySnapshot(hotelId, reservation.checkIn, reservation.checkOut);

  const free = freeRoomsForStay({
    rooms: snapshot.rooms,
    reservations: snapshot.reservations,
    blocks: snapshot.blocks,
    roomTypeId: includeOtherTypes ? undefined : reservation.roomTypeId,
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    excludeReservationId: reservation.id,
  });

  const roomTypes = await prisma.roomType.findMany({
    where: { hotelId },
    select: { id: true, code: true, name: true },
  });
  const typeById = new Map(roomTypes.map((type) => [type.id, type]));

  // Otomatik atamanın seçeceği oda işaretleniyor: personel elle seçerken de
  // "sistem bunu seçerdi" bilgisini görsün. Upgrade odalar öneriye girmez —
  // misafiri sebepsiz üst sınıfa taşımak otelin kararı olmalı.
  const sameTypeRooms = free.filter((room) => room.roomTypeId === reservation.roomTypeId);
  const recommendedId = pickBestRoom(sameTypeRooms)?.id ?? null;

  return free.map((room) => ({
    id: room.id,
    number: room.number,
    floor: room.floor,
    status: room.status,
    roomTypeId: room.roomTypeId,
    roomTypeCode: typeById.get(room.roomTypeId)?.code ?? null,
    roomTypeName: typeById.get(room.roomTypeId)?.name ?? null,
    isUpgrade: room.roomTypeId !== reservation.roomTypeId,
    recommended: room.id === recommendedId,
  }));
}

/**
 * Rezervasyona oda atar.
 *
 * Uygunluk burada da kontrol edilir (kullanıcıya anlaşılır mesaj için) ama
 * garantiyi veritabanı verir: `Reservation_no_double_booking` EXCLUDE kısıtı,
 * iki personel aynı anda son odayı atasa bile ikincisini reddeder.
 *
 * @param {string} hotelId
 * @param {string} reservationId
 * @param {string} roomId
 * @param {{ assignedBy?: 'manual' | 'auto' }} [options]
 */
export async function assignRoom(hotelId, reservationId, roomId, { assignedBy = 'manual' } = {}) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const reservation = await loadAssignableReservation(tx, hotelId, reservationId);

      if (!ASSIGNABLE_STATUSES.includes(reservation.status)) {
        throw new ConflictError(
          `Durumu "${reservation.status}" olan rezervasyona oda atanamaz. Yalnızca bekleyen ve onaylı rezervasyonlar atanabilir.`,
          'NOT_ASSIGNABLE',
        );
      }

      const room = await tx.room.findFirst({ where: { id: roomId, hotelId } });
      if (!room) throw new NotFoundError('Oda bulunamadı');

      if (reservation.roomId === roomId) {
        return toReservationSummaryDto(reservation);
      }

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
        after: { roomId, roomNumber: room.number },
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
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} reservationId
 */
export async function unassignRoom(hotelId, reservationId) {
  return writeWithEvents(async (tx, stage) => {
    const reservation = await loadAssignableReservation(tx, hotelId, reservationId);

    if (!reservation.roomId) {
      throw new ConflictError('Bu rezervasyonda atanmış oda yok', 'NOT_ASSIGNED');
    }
    if (reservation.status === 'CHECKED_IN') {
      throw new ConflictError(
        'Misafir odada olduğu için oda kaydı kaldırılamaz. Önce oda değişikliği veya çıkış işlemi yapın.',
        'GUEST_IN_ROOM',
      );
    }

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
 * Oda atanmayı bekleyen rezervasyonlar.
 *
 * Modül 4'ün rezervasyon detay ekranı gelene kadar atama işinin yapıldığı yer
 * burası; o ekran geldiğinde aynı API oradan da kullanılacak.
 *
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string }} query
 */
export async function listUnassignedReservations(hotelId, query) {
  const where = {
    hotelId,
    roomId: null,
    status: { in: ASSIGNABLE_STATUSES },
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
        roomType: { select: { code: true, name: true } },
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
 * @param {string} hotelId
 * @param {string} reservationId
 * @returns {Promise<{ assigned: boolean, room?: { id: string, number: string }, reason?: string }>}
 */
export async function autoAssignRoom(hotelId, reservationId) {
  const candidates = await getAssignableRooms(hotelId, reservationId);
  const best = pickBestRoom(candidates);

  if (!best) {
    return { assigned: false, reason: 'Uygun boş oda bulunamadı' };
  }

  await assignRoom(hotelId, reservationId, best.id, { assignedBy: 'auto' });
  return { assigned: true, room: { id: best.id, number: best.number } };
}

/* ══════════════════ Sıcak okumalar ══════════════════ */

/**
 * Otelin oda listesi. Nadiren değişir, sık okunur — cache'lenir ve envanter
 * event'leriyle tazelenir (bkz. `lib/events.js`).
 * @param {string} hotelId
 */
export async function getActiveRooms(hotelId) {
  return cache.getOrSet(
    `inventory:${hotelId}:rooms`,
    async () => {
      const rows = await prisma.room.findMany({
        where: { hotelId },
        include: { roomType: { select: { code: true, name: true } } },
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
      });
      return rows.map(toRoomDto);
    },
    HOT_READ_TTL_MS,
  );
}

/**
 * Bugünden itibaren `days` günlük müsaitlik özeti — panel ekranı (modül 13)
 * ve doluluk göstergeleri için.
 * @param {string} hotelId
 * @param {number} [days]
 */
export async function getUpcomingAvailability(hotelId, days = 7) {
  const from = new Date(toIsoDay(new Date()));
  return getAvailabilityCalendar(hotelId, { from, to: addDays(from, days) });
}
