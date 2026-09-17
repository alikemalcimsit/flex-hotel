import { calendarDateInTimeZone } from '@hotelos/core';
import { cache } from '../../lib/cache.js';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import {
  ConflictError,
  InUseError,
  NotFoundError,
  rethrowPrismaError,
  ValidationError,
} from '../../lib/errors.js';
import { lockRoomTypes } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { assertNoOverlap, findSeasonForDate, isValidTimeZone } from './rules.js';

/**
 * Ayarlar servisi.
 *
 * İki tür okuma var ve bilinçli olarak farklı davranıyorlar:
 *
 * 1. **Yönetim listeleri** (`listRoomTypes` vb.) — admin ekranından gelir, düşük
 *    hacimlidir, filtre/sayfa kombinasyonu sonsuzdur. Cache'lenmez.
 * 2. **Sıcak okumalar** (`getActiveRoomTypes`, `getActiveSeasons`, ...) — fiyat
 *    hesabı ve müsaitlik sorgusu bunları her rezervasyonda çağıracak. Cache'lenir;
 *    geçersiz kılma doğrudan çağrıyla değil, yayınlanan event'i dinleyerek olur
 *    (bkz. `lib/events.js` → `registerCoreSubscribers`).
 *
 * Her yazma işlemi üç şeyi **tek transaction'da** yapar: veriyi değiştirir,
 * denetim izi bırakır, event'i outbox'a yazar. Üçü ya birlikte olur ya hiç.
 *
 * Modül 3 (müsaitlik) ve modül 4 (rezervasyon) bu dosyanın "sıcak okuma"
 * bölümündeki fonksiyonları kullanmalı; doğrudan Prisma'ya gitmemeli.
 */

const HOT_READ_TTL_MS = 5 * 60_000;

/** Envanteri tüketen rezervasyon durumları (bkz. rooms/rules.js). */
const ACTIVE_RESERVATION_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN']);

/** Hata mesajında örnek olarak gösterilecek en fazla kayıt sayısı. */
const CONFLICT_SAMPLE_LIMIT = 5;

/* ══════════════════ Dönüştürücüler ══════════════════ */

/** @param {{ toString(): string }} value */
const decimalToString = (value) => value.toString();

/** @param {Date} value */
const toIsoDay = (value) => value.toISOString().slice(0, 10);

function toHotelDto(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    address: row.address,
    phone: row.phone,
    email: row.email,
    logoUrl: row.logoUrl,
    currency: row.currency,
    timezone: row.timezone,
    phoneCountryCode: row.phoneCountryCode,
    checkInTime: row.checkInTime,
    checkOutTime: row.checkOutTime,
    defaultBoardType: row.defaultBoardType,
    cancellationPolicyDays: row.cancellationPolicyDays,
    cancellationPolicyPenaltyPct: decimalToString(row.cancellationPolicyPenaltyPct),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRoomTypeDto(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    capacityAdults: row.capacityAdults,
    capacityChildren: row.capacityChildren,
    basePrice: decimalToString(row.basePrice),
    description: row.description,
    roomCount: row._count?.rooms ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTaxDto(row) {
  return {
    id: row.id,
    name: row.name,
    rate: decimalToString(row.rate),
    isIncluded: row.isIncluded,
    appliesTo: row.appliesTo,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSeasonDto(row) {
  return {
    id: row.id,
    name: row.name,
    startDate: toIsoDay(row.startDate),
    endDate: toIsoDay(row.endDate),
    multiplier: decimalToString(row.multiplier),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Denetim izine yazılacak anlık görüntü: türetilmiş alanlar (ör. oda sayısı)
 * ayıklanır — onlar kaydın kendi değeri değil, çevresinin durumu.
 * @param {Record<string, unknown>} dto
 */
function toSnapshot({ roomCount, ...rest }) {
  return rest;
}

/* ══════════════════ Ortak yardımcılar ══════════════════ */

/**
 * Silinmek istenen kaydın başka kayıtlarca kullanılıp kullanılmadığını bildirir.
 * @param {Record<string, number>} counts
 * @returns {Record<string, number>} yalnızca sıfırdan büyük olanlar
 */
function nonZero(counts) {
  return Object.fromEntries(Object.entries(counts).filter(([, value]) => value > 0));
}

/* ══════════════════ Otel bilgileri & genel parametreler ══════════════════ */

/**
 * Yönetim ekranı için otel kaydı. Kasıtlı olarak cache'siz: form, kaydederken
 * geri göndereceği `updatedAt` sürüm damgasını buradan alıyor. Cache'lenmiş
 * (bayat) bir damga her kaydetmeyi "başkası değiştirdi" hatasına düşürürdü.
 * Diğer modüllerin okuması gereken sürüm `getHotelSettings`.
 *
 * @param {string} hotelId
 */
export async function getHotel(hotelId) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
  if (!hotel) throw new NotFoundError('Otel kaydı bulunamadı');
  return toHotelDto(hotel);
}

/**
 * Otel bilgilerini günceller.
 *
 * Para birimi, otelde rezervasyon ya da folyo oluştuktan sonra
 * değiştirilemez: kayıtlı tutarlar eski para biriminde durur, çevrilmeden
 * "TRY" yazısının "EUR" olması 2500 TL'lik odayı 2500 EUR gösterir. Böyle bir
 * geçiş ancak kur çevrimli bir veri taşıma işiyle yapılabilir.
 *
 * @param {string} hotelId
 * @param {object} input
 */
export async function updateHotel(hotelId, input) {
  if (!isValidTimeZone(input.timezone)) {
    throw new ValidationError(`Geçersiz saat dilimi: "${input.timezone}". Örnek: Europe/Istanbul`);
  }

  const { expectedUpdatedAt, ...data } = input;

  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.hotel.findFirst({ where: { id: hotelId } });
      if (!before) throw new NotFoundError('Otel kaydı bulunamadı');

      if (data.currency !== before.currency) {
        const [reservations, folios] = await Promise.all([
          tx.reservation.count({ where: { hotelId } }),
          tx.folio.count({ where: { hotelId } }),
        ]);
        const usage = nonZero({ rezervasyon: reservations, folyo: folios });
        if (Object.keys(usage).length > 0) {
          throw new ConflictError(
            `Otelde parası ${before.currency} olarak kaydedilmiş kayıtlar var; para birimi ${data.currency} yapılamaz. ` +
              'Tutarlar çevrilmeden birim değişirse tüm fiyatlar yanlış görünür.',
            'CURRENCY_LOCKED',
            { usage, field: 'currency' },
          );
        }
      }

      await updateWithVersionCheck(
        tx,
        'hotel',
        { id: hotelId },
        expectedUpdatedAt,
        {
          name: data.name,
          address: data.address || null,
          phone: data.phone || null,
          email: data.email || null,
          logoUrl: data.logoUrl || null,
          currency: data.currency,
          timezone: data.timezone,
          checkInTime: data.checkInTime,
          checkOutTime: data.checkOutTime,
        },
        'Otel kaydı bulunamadı',
      );

      const after = await tx.hotel.findFirst({ where: { id: hotelId } });
      const dto = toHotelDto(after);
      const changedFields = await recordAudit(tx, {
        hotelId,
        entity: 'Hotel',
        entityId: hotelId,
        action: 'UPDATE',
        before: toHotelDto(before),
        after: dto,
      });

      await stage('settings.hotel.updated', { hotelId, changedFields });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {object} input
 */
export async function updateGeneralSettings(hotelId, input) {
  const { expectedUpdatedAt, ...data } = input;

  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.hotel.findFirst({ where: { id: hotelId } });
      if (!before) throw new NotFoundError('Otel kaydı bulunamadı');

      await updateWithVersionCheck(
        tx,
        'hotel',
        { id: hotelId },
        expectedUpdatedAt,
        {
          defaultBoardType: data.defaultBoardType,
          cancellationPolicyDays: data.cancellationPolicyDays,
          cancellationPolicyPenaltyPct: data.cancellationPolicyPenaltyPct,
          phoneCountryCode: data.phoneCountryCode,
        },
        'Otel kaydı bulunamadı',
      );

      const after = await tx.hotel.findFirst({ where: { id: hotelId } });
      const dto = toHotelDto(after);
      const changedFields = await recordAudit(tx, {
        hotelId,
        entity: 'Hotel',
        entityId: hotelId,
        action: 'UPDATE',
        before: toHotelDto(before),
        after: dto,
      });

      await stage('settings.hotel.updated', { hotelId, changedFields });
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/* ══════════════════ Oda tipleri ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string }} query
 */
export async function listRoomTypes(hotelId, query) {
  const where = {
    hotelId,
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  // Sayım ve sayfa aynı transaction'da: iki ayrı sorgu arasında kayıt eklenirse
  // "toplam 30 ama 31. kayıt görünüyor" tutarsızlığı oluşmasın.
  const [items, total] = await prisma.$transaction([
    prisma.roomType.findMany({
      where,
      orderBy: [{ code: 'asc' }],
      // Oda sayısı ilişkili tablodan tek sorguda geliyor (N+1 yok).
      include: { _count: { select: { rooms: true } } },
      ...toSkipTake(query),
    }),
    prisma.roomType.count({ where }),
  ]);

  return buildPage(items.map(toRoomTypeDto), total, query);
}

/**
 * @param {string} hotelId
 * @param {object} input
 */
export async function createRoomType(hotelId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      const created = await tx.roomType.create({
        data: { hotelId, ...input, description: input.description || null },
        include: { _count: { select: { rooms: true } } },
      });
      const dto = toRoomTypeDto(created);

      await recordAudit(tx, {
        hotelId,
        entity: 'RoomType',
        entityId: created.id,
        action: 'CREATE',
        after: toSnapshot(dto),
      });
      await stage('settings.roomType.created', { hotelId, id: created.id, label: `${dto.code} — ${dto.name}` });

      return dto;
    });
  } catch (error) {
    // Aynı kodla eşzamanlı iki ekleme: kısmi unique index yakalar.
    rethrowPrismaError(error, { uniqueMessage: `"${input.code}" kodlu bir oda tipi zaten var` });
  }
}

/**
 * Oda tipini günceller.
 *
 * Kapasite, gelecekteki rezervasyonların kişi sayısının altına düşürülemez:
 * 3 yetişkinlik rezervasyonu olan tipi "2 yetişkin" yapmak, o misafirleri
 * sığmadıkları odalara bırakmak demektir. Bu tipin odalarına başka tipten
 * yerleştirilmiş misafirler de sayılır.
 *
 * @param {string} hotelId
 * @param {string} id
 * @param {object} input
 */
export async function updateRoomType(hotelId, id, input) {
  const { expectedUpdatedAt, ...data } = input;

  try {
    return await writeWithEvents(async (tx, stage) => {
      if (!(await lockRoomTypes(tx, hotelId, [id])).has(id)) throw new NotFoundError('Oda tipi bulunamadı');
      const before = await tx.roomType.findFirst({ where: { id, hotelId } });
      if (!before) throw new NotFoundError('Oda tipi bulunamadı');

      const capacityShrinks =
        data.capacityAdults < before.capacityAdults || data.capacityChildren < before.capacityChildren;
      if (capacityShrinks) {
        const today = calendarDateInTimeZone((await tx.hotel.findFirst({ where: { id: hotelId } })).timezone);
        const overCapacity = {
          hotelId,
          status: { in: ACTIVE_RESERVATION_STATUSES },
          checkOut: { gt: today },
          AND: [
            { OR: [{ roomTypeId: id }, { room: { roomTypeId: id } }] },
            { OR: [{ adults: { gt: data.capacityAdults } }, { children: { gt: data.capacityChildren } }] },
          ],
        };
        const [count, samples] = await Promise.all([
          tx.reservation.count({ where: overCapacity }),
          tx.reservation.findMany({
            where: overCapacity,
            select: { confirmationCode: true, adults: true, children: true },
            orderBy: [{ checkIn: 'asc' }],
            take: CONFLICT_SAMPLE_LIMIT,
          }),
        ]);
        if (count > 0) {
          throw new ConflictError(
            `Bu tipte yeni kapasiteyi (${data.capacityAdults} yetişkin, ${data.capacityChildren} çocuk) aşan ` +
              `${count} gelecek rezervasyon var; kapasite düşürülemez. Önce o misafirleri başka tipe taşıyın.`,
            'CAPACITY_IN_USE',
            { total: count, shown: samples.length, reservations: samples },
          );
        }
      }

      await updateWithVersionCheck(
        tx,
        'roomType',
        { id, hotelId },
        expectedUpdatedAt,
        { ...data, description: data.description || null },
        'Oda tipi bulunamadı',
      );

      const after = await tx.roomType.findFirst({
        where: { id },
        include: { _count: { select: { rooms: true } } },
      });
      const dto = toRoomTypeDto(after);

      const changedFields = await recordAudit(tx, {
        hotelId,
        entity: 'RoomType',
        entityId: id,
        action: 'UPDATE',
        before: toSnapshot(toRoomTypeDto(before)),
        after: toSnapshot(dto),
      });
      await stage('settings.roomType.updated', {
        hotelId,
        id,
        label: `${dto.code} — ${dto.name}`,
        changedFields,
      });

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `"${data.code}" kodlu bir oda tipi zaten var` });
  }
}

/**
 * Oda tipini soft-delete eder. Bağlı oda / rezervasyon / fiyat planı varsa
 * silmez — sessizce veri tutarsızlığı üretmektense kullanıcıya ne engellediğini
 * sayısıyla söyler.
 *
 * @param {string} hotelId
 * @param {string} id
 */
export async function deleteRoomType(hotelId, id) {
  await writeWithEvents(async (tx, stage) => {
    // Kilit: aynı anda bu tipe oda eklenirse (createRoom da kilitliyor) sayım
    // "0 oda" okuyup silmesin, oda silinmiş bir tipe bağlı kalmasın.
    if (!(await lockRoomTypes(tx, hotelId, [id])).has(id)) throw new NotFoundError('Oda tipi bulunamadı');
    const existing = await tx.roomType.findFirst({ where: { id, hotelId } });
    if (!existing) throw new NotFoundError('Oda tipi bulunamadı');

    const [rooms, reservations, ratePlans] = await Promise.all([
      tx.room.count({ where: { roomTypeId: id, hotelId } }),
      tx.reservation.count({
        where: { roomTypeId: id, hotelId, status: { in: ACTIVE_RESERVATION_STATUSES } },
      }),
      tx.ratePlan.count({ where: { roomTypeId: id, hotelId } }),
    ]);

    const usage = nonZero({ oda: rooms, aktifRezervasyon: reservations, fiyatPlani: ratePlans });
    if (Object.keys(usage).length > 0) {
      throw new InUseError(
        `"${existing.name}" oda tipi kullanımda olduğu için silinemez. Önce bağlı kayıtları kaldırın.`,
        usage,
      );
    }

    await tx.roomType.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, {
      hotelId,
      entity: 'RoomType',
      entityId: id,
      action: 'DELETE',
      before: toSnapshot(toRoomTypeDto(existing)),
    });
    await stage('settings.roomType.deleted', { hotelId, id, label: `${existing.code} — ${existing.name}` });
  });
}

/* ══════════════════ Vergiler ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string }} query
 */
export async function listTaxes(hotelId, query) {
  const where = {
    hotelId,
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.tax.findMany({ where, orderBy: [{ name: 'asc' }], ...toSkipTake(query) }),
    prisma.tax.count({ where }),
  ]);

  return buildPage(items.map(toTaxDto), total, query);
}

/**
 * @param {string} hotelId
 * @param {object} input
 */
export async function createTax(hotelId, input) {
  return writeWithEvents(async (tx, stage) => {
    const created = await tx.tax.create({ data: { hotelId, ...input } });
    const dto = toTaxDto(created);

    await recordAudit(tx, { hotelId, entity: 'Tax', entityId: created.id, action: 'CREATE', after: dto });
    await stage('settings.tax.created', { hotelId, id: created.id, label: dto.name });

    return dto;
  });
}

/**
 * @param {string} hotelId
 * @param {string} id
 * @param {object} input
 */
export async function updateTax(hotelId, id, input) {
  const { expectedUpdatedAt, ...data } = input;

  return writeWithEvents(async (tx, stage) => {
    const before = await tx.tax.findFirst({ where: { id, hotelId } });
    if (!before) throw new NotFoundError('Vergi bulunamadı');

    await updateWithVersionCheck(tx, 'tax', { id, hotelId }, expectedUpdatedAt, data, 'Vergi bulunamadı');

    const after = await tx.tax.findFirst({ where: { id } });
    const dto = toTaxDto(after);

    const changedFields = await recordAudit(tx, {
      hotelId,
      entity: 'Tax',
      entityId: id,
      action: 'UPDATE',
      before: toTaxDto(before),
      after: dto,
    });
    await stage('settings.tax.updated', { hotelId, id, label: dto.name, changedFields });

    return dto;
  });
}

/**
 * @param {string} hotelId
 * @param {string} id
 */
export async function deleteTax(hotelId, id) {
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.tax.findFirst({ where: { id, hotelId } });
    if (!existing) throw new NotFoundError('Vergi bulunamadı');

    // Kesilmiş folyo kalemlerine bağlı vergi silinirse geçmiş hesap bozulur.
    const folioItems = await tx.folioItem.count({ where: { taxId: id, hotelId } });
    const usage = nonZero({ folyoKalemi: folioItems });
    if (Object.keys(usage).length > 0) {
      throw new InUseError(
        `"${existing.name}" vergisi geçmiş folyo kalemlerinde kullanıldığı için silinemez.`,
        usage,
      );
    }

    await tx.tax.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Tax',
      entityId: id,
      action: 'DELETE',
      before: toTaxDto(existing),
    });
    await stage('settings.tax.deleted', { hotelId, id, label: existing.name });
  });
}

/* ══════════════════ Sezonlar ══════════════════ */

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string }} query
 */
export async function listSeasons(hotelId, query) {
  const where = {
    hotelId,
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const [items, total] = await prisma.$transaction([
    prisma.season.findMany({ where, orderBy: [{ startDate: 'asc' }], ...toSkipTake(query) }),
    prisma.season.count({ where }),
  ]);

  return buildPage(items.map(toSeasonDto), total, query);
}

/**
 * Aday aralıkla çakışan sezonlar — yalnızca onlar okunur.
 *
 * Eskiden otelin *bütün* sezonları belleğe çekilip orada karşılaştırılıyordu;
 * yıllar içinde yüzlerce satır. Aralık kesişimi veritabanında
 * `[hotelId, startDate, endDate]` index'iyle yapılır, kural (`assertNoOverlap`)
 * aynı kalır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ id?: string, startDate: Date, endDate: Date }} candidate
 */
function findOverlappingSeasons(tx, hotelId, candidate) {
  return tx.season.findMany({
    where: {
      hotelId,
      ...(candidate.id ? { id: { not: candidate.id } } : {}),
      // İki uçtan kapalı `[]` kesişim.
      startDate: { lte: candidate.endDate },
      endDate: { gte: candidate.startDate },
    },
    select: { id: true, name: true, startDate: true, endDate: true },
    orderBy: [{ startDate: 'asc' }],
    take: 1,
  });
}

/**
 * Sezon ekler.
 *
 * Çakışma kontrolü iki katmanlı: burada çakışan sezon okunup kullanıcıya
 * *hangi* sezonla çakıştığı söyleniyor; garantiyi ise veritabanındaki
 * `Season_no_overlap` EXCLUDE kısıtı veriyor. Bu yüzden eşzamanlılık için ayrı
 * bir kilide gerek yok — iki istek aynı anda gelse biri kısıta takılır ve
 * `rethrowPrismaError` onu anlaşılır mesaja çevirir.
 *
 * @param {string} hotelId
 * @param {object} input
 */
export async function createSeason(hotelId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      assertNoOverlap(await findOverlappingSeasons(tx, hotelId, input), input);

      const created = await tx.season.create({ data: { hotelId, ...input } });
      const dto = toSeasonDto(created);

      await recordAudit(tx, { hotelId, entity: 'Season', entityId: created.id, action: 'CREATE', after: dto });
      await stage('settings.season.created', { hotelId, id: created.id, label: dto.name });

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} id
 * @param {object} input
 */
export async function updateSeason(hotelId, id, input) {
  const { expectedUpdatedAt, ...data } = input;

  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.season.findFirst({ where: { id, hotelId } });
      if (!before) throw new NotFoundError('Sezon bulunamadı');

      const candidate = { ...data, id };
      assertNoOverlap(await findOverlappingSeasons(tx, hotelId, candidate), candidate);

      await updateWithVersionCheck(tx, 'season', { id, hotelId }, expectedUpdatedAt, data, 'Sezon bulunamadı');

      const after = await tx.season.findFirst({ where: { id } });
      const dto = toSeasonDto(after);

      const changedFields = await recordAudit(tx, {
        hotelId,
        entity: 'Season',
        entityId: id,
        action: 'UPDATE',
        before: toSeasonDto(before),
        after: dto,
      });
      await stage('settings.season.updated', { hotelId, id, label: dto.name, changedFields });

      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} id
 */
export async function deleteSeason(hotelId, id) {
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.season.findFirst({ where: { id, hotelId } });
    if (!existing) throw new NotFoundError('Sezon bulunamadı');

    await tx.season.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Season',
      entityId: id,
      action: 'DELETE',
      before: toSeasonDto(existing),
    });
    await stage('settings.season.deleted', { hotelId, id, label: existing.name });
  });
}

/* ══════════════════ Sıcak okumalar (diğer modüller buradan tüketir) ══════════════════ */

/**
 * Otelin operasyonel parametreleri. Modül 4 iptal politikasını, modül 6
 * check-in/out saatlerini buradan okur.
 * @param {string} hotelId
 */
export async function getHotelSettings(hotelId) {
  return cache.getOrSet(
    `settings:${hotelId}:hotel`,
    async () => {
      const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
      if (!hotel) throw new NotFoundError('Otel kaydı bulunamadı');
      return toHotelDto(hotel);
    },
    HOT_READ_TTL_MS,
  );
}

/**
 * Satılabilir oda tipleri (müsaitlik ve fiyat hesabının girdisi).
 * @param {string} hotelId
 */
export async function getActiveRoomTypes(hotelId) {
  return cache.getOrSet(
    `settings:${hotelId}:roomTypes`,
    async () => {
      const rows = await prisma.roomType.findMany({ where: { hotelId }, orderBy: [{ code: 'asc' }] });
      return rows.map(toRoomTypeDto);
    },
    HOT_READ_TTL_MS,
  );
}

/**
 * @param {string} hotelId
 */
export async function getActiveTaxes(hotelId) {
  return cache.getOrSet(
    `settings:${hotelId}:taxes`,
    async () => {
      const rows = await prisma.tax.findMany({ where: { hotelId }, orderBy: [{ name: 'asc' }] });
      return rows.map(toTaxDto);
    },
    HOT_READ_TTL_MS,
  );
}

/**
 * @param {string} hotelId
 */
export async function getActiveSeasons(hotelId) {
  return cache.getOrSet(
    `settings:${hotelId}:seasons`,
    async () => {
      const rows = await prisma.season.findMany({ where: { hotelId }, orderBy: [{ startDate: 'asc' }] });
      return rows.map(toSeasonDto);
    },
    HOT_READ_TTL_MS,
  );
}

/**
 * Belirli bir güne düşen sezon. Fiyat hesabının (modül 4) giriş kapısı:
 * çakışma veritabanı kısıtıyla engellendiği için sonuç tekildir.
 * @param {string} hotelId
 * @param {Date | string} date
 */
export async function getSeasonForDate(hotelId, date) {
  const seasons = await getActiveSeasons(hotelId);
  return findSeasonForDate(seasons, date);
}
