import { currentActor, rangesOverlapClosed, toIsoDay } from '@hotelos/core';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockAgencies } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { INVENTORY_CONSUMING_STATUSES } from '../rooms/rules.js';
import { allotmentHolds, allotmentUsage } from './allotment-rules.js';

/**
 * Allotment / kota servisi (modül 30): acenteye dönem boyunca gecelik ayrılan
 * oda kotası. Yönetim CRUD'u burada; müsaitliğe etkisi `holdsForSale` ile
 * tüketicilere (rezervasyon guard'ı, teklif, bekleme listesi, ARI) verilir.
 *
 * Yazmalar acenteyi **özel** kilitler (kontrat / stop-sale yazımıyla aynı
 * düzen; kilit sırası: rezervasyon → oda tipi → acente): acente satışı kontratı
 * paylaşımlı kilitle okurken kota değişimi yarışamaz. Guard'ın kota okuması
 * kilitsizdir — kota bir **garanti** olduğu için yarışta en kötü ihtimal bir
 * satışın eski kotayı görmesidir; sonraki satış yeni kotayı görür.
 */

const ALLOTMENT_SELECT = Object.freeze({
  id: true,
  agencyId: true,
  roomTypeId: true,
  startDate: true,
  endDate: true,
  quantity: true,
  releaseDays: true,
  notes: true,
  createdBy: true,
  updatedAt: true,
  roomType: { select: { code: true, name: true } },
});

/** @param {Record<string, any>} row */
function toAllotmentDto(row) {
  return {
    id: row.id,
    agencyId: row.agencyId,
    roomTypeId: row.roomTypeId,
    roomTypeCode: row.roomType?.code ?? null,
    roomTypeName: row.roomType?.name ?? null,
    startDate: toIsoDay(row.startDate),
    endDate: toIsoDay(row.endDate),
    quantity: row.quantity,
    releaseDays: row.releaseDays,
    notes: row.notes ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Denetim izi anlık görüntüsü: türetilmiş oda tipi adları ayıklanır. */
function toSnapshot({ roomTypeCode, roomTypeName, ...rest }) {
  return rest;
}

/* ══════════════════ Yönetim ══════════════════ */

/**
 * @param {string} hotelId
 * @param {string} agencyId
 * @param {{ page: number, pageSize: number }} query
 */
export async function listAllotments(hotelId, agencyId, query) {
  const agency = await prisma.agency.findFirst({ where: { id: agencyId, hotelId }, select: { id: true } });
  if (!agency) throw new NotFoundError('Acente bulunamadı');

  const where = { hotelId, agencyId, deletedAt: null };
  const [items, total] = await prisma.$transaction([
    prisma.allotment.findMany({
      where,
      orderBy: [{ startDate: 'asc' }, { roomTypeId: 'asc' }],
      select: ALLOTMENT_SELECT,
      ...toSkipTake(query),
    }),
    prisma.allotment.count({ where }),
  ]);
  return buildPage(items.map(toAllotmentDto), total, query);
}

/**
 * Aday dönemle çakışan yayındaki kota — kullanıcıya hangisiyle çakıştığını
 * söylemek için; garanti veritabanındaki `Allotment_no_overlap` EXCLUDE kısıtı.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
async function assertNoOverlap(tx, hotelId, agencyId, candidate) {
  const clash = await tx.allotment.findFirst({
    where: {
      hotelId,
      agencyId,
      roomTypeId: candidate.roomTypeId,
      deletedAt: null,
      ...(candidate.id ? { id: { not: candidate.id } } : {}),
      startDate: { lte: candidate.endDate },
      endDate: { gte: candidate.startDate },
    },
    select: { id: true, startDate: true, endDate: true },
  });
  if (clash && rangesOverlapClosed(clash, candidate)) {
    throw new ValidationError(
      `Bu dönem acentenin aynı oda tipindeki ${toIsoDay(clash.startDate)} – ${toIsoDay(clash.endDate)} kotasıyla çakışıyor. ` +
        'Bir geceye tek kota satırı düşebilir; mevcut satırı düzenleyin.',
      { conflictingAllotmentId: clash.id },
    );
  }
}

/** Kota değişiminin olay gövdesi: etkilenen pencere (eski + yeni dönemin birleşimi). */
function allotmentEvent(hotelId, agencyId, allotmentId, roomTypeId, rows, change) {
  const from = rows.map((row) => toIsoDay(row.startDate)).sort()[0];
  const to = rows.map((row) => toIsoDay(row.endDate)).sort().at(-1);
  return { hotelId, agencyId, allotmentId, roomTypeId, from, to, change };
}

/**
 * @param {string} hotelId
 * @param {string} agencyId
 * @param {object} input `createAllotmentSchema` çıktısı
 */
export async function createAllotment(hotelId, agencyId, input) {
  try {
    return await writeWithEvents(async (tx, stage) => {
      if (!(await lockAgencies(tx, hotelId, [agencyId])).has(agencyId)) throw new NotFoundError('Acente bulunamadı');
      const type = await tx.roomType.findFirst({ where: { id: input.roomTypeId, hotelId, deletedAt: null }, select: { id: true } });
      if (!type) throw new NotFoundError('Seçilen oda tipi bulunamadı ya da silinmiş');
      await assertNoOverlap(tx, hotelId, agencyId, input);

      const created = await tx.allotment.create({
        data: { hotelId, agencyId, ...input, createdBy: currentActor() },
        select: ALLOTMENT_SELECT,
      });
      const dto = toAllotmentDto(created);
      await recordAudit(tx, { hotelId, entity: 'Allotment', entityId: created.id, action: 'CREATE', after: toSnapshot(dto) });
      await stage('agency.allotment.changed', allotmentEvent(hotelId, agencyId, created.id, created.roomTypeId, [created], 'CREATED'));
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} allotmentId
 * @param {object} input `updateAllotmentSchema` çıktısı
 */
export async function updateAllotment(hotelId, allotmentId, input) {
  const { expectedUpdatedAt, ...data } = input;
  try {
    return await writeWithEvents(async (tx, stage) => {
      const before = await tx.allotment.findFirst({ where: { id: allotmentId, hotelId, deletedAt: null } });
      if (!before) throw new NotFoundError('Kota kaydı bulunamadı');
      if (!(await lockAgencies(tx, hotelId, [before.agencyId])).has(before.agencyId)) throw new NotFoundError('Acente bulunamadı');
      const type = await tx.roomType.findFirst({ where: { id: data.roomTypeId, hotelId, deletedAt: null }, select: { id: true } });
      if (!type) throw new NotFoundError('Seçilen oda tipi bulunamadı ya da silinmiş');
      await assertNoOverlap(tx, hotelId, before.agencyId, { ...data, id: allotmentId });

      await updateWithVersionCheck(tx, 'allotment', { id: allotmentId, hotelId }, expectedUpdatedAt, data, 'Kota kaydı bulunamadı');

      const after = await tx.allotment.findFirst({ where: { id: allotmentId }, select: ALLOTMENT_SELECT });
      const dto = toAllotmentDto(after);
      await recordAudit(tx, {
        hotelId,
        entity: 'Allotment',
        entityId: allotmentId,
        action: 'UPDATE',
        before: toSnapshot(toAllotmentDto({ ...before, roomType: null })),
        after: toSnapshot(dto),
      });
      // Eski ve yeni dönemin birleşimi: iki tarafta da müsaitlik değişti.
      await stage('agency.allotment.changed', allotmentEvent(hotelId, before.agencyId, allotmentId, after.roomTypeId, [before, after], 'UPDATED'));
      return dto;
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
}

/**
 * @param {string} hotelId
 * @param {string} allotmentId
 */
export async function deleteAllotment(hotelId, allotmentId) {
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.allotment.findFirst({ where: { id: allotmentId, hotelId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Kota kaydı bulunamadı');
    if (!(await lockAgencies(tx, hotelId, [existing.agencyId])).has(existing.agencyId)) throw new NotFoundError('Acente bulunamadı');

    await tx.allotment.update({ where: { id: allotmentId }, data: { deletedAt: new Date() } });
    await recordAudit(tx, {
      hotelId,
      entity: 'Allotment',
      entityId: allotmentId,
      action: 'DELETE',
      before: toSnapshot(toAllotmentDto({ ...existing, roomType: null })),
    });
    await stage('agency.allotment.changed', allotmentEvent(hotelId, existing.agencyId, allotmentId, existing.roomTypeId, [existing], 'DELETED'));
  });
}

/**
 * Kota kullanım tablosu (ekran): satırın gün gün verilen / kullanılan / kalan /
 * release durumu + özet.
 * @param {string} hotelId
 * @param {string} allotmentId
 */
export async function getAllotmentUsage(hotelId, allotmentId) {
  const allotment = await prisma.allotment.findFirst({
    where: { id: allotmentId, hotelId, deletedAt: null },
    select: ALLOTMENT_SELECT,
  });
  if (!allotment) throw new NotFoundError('Kota kaydı bulunamadı');

  const [stays, businessDate] = await Promise.all([
    loadAgencyStays(prisma, hotelId, {
      from: allotment.startDate,
      to: new Date(allotment.endDate.getTime() + 86_400_000),
      roomTypeIds: [allotment.roomTypeId],
      agencyId: allotment.agencyId,
    }),
    getBusinessDate(hotelId),
  ]);

  const days = allotmentUsage(allotment, stays, businessDate);
  const usedNights = days.reduce((sum, day) => sum + Math.min(day.used, day.given), 0);
  return {
    allotment: toAllotmentDto(allotment),
    days,
    summary: {
      givenNights: days.length * allotment.quantity,
      usedNights,
      remainingNights: days.length * allotment.quantity - usedNights,
    },
  };
}

/* ══════════════════ Müsaitlik tüketicileri ══════════════════ */

/**
 * Pencereye düşen yayındaki kotalar. Cache'siz: kota tablosu küçük ve
 * indeksli; guard transaction içinde günceli okumalı.
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 */
export function loadActiveAllotments(client, hotelId, { roomTypeIds, from, to }) {
  return client.allotment.findMany({
    where: {
      hotelId,
      deletedAt: null,
      ...(roomTypeIds ? { roomTypeId: { in: roomTypeIds } } : {}),
      startDate: { lt: to },
      endDate: { gte: from },
    },
    select: { id: true, agencyId: true, roomTypeId: true, startDate: true, endDate: true, quantity: true, releaseDays: true },
  });
}

/**
 * Acenteli, envanter tüketen konaklamalar (kota kullanımının kaynağı) — elinde
 * envanter anlık görüntüsü olmayan tüketiciler için (teklif, kullanım tablosu).
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 */
export function loadAgencyStays(client, hotelId, { from, to, roomTypeIds, agencyId }) {
  return client.reservation.findMany({
    where: {
      hotelId,
      deletedAt: null,
      agencyId: agencyId ?? { not: null },
      status: { in: [...INVENTORY_CONSUMING_STATUSES] },
      checkOut: { gt: from },
      checkIn: { lt: to },
      ...(roomTypeIds ? { roomTypeId: { in: roomTypeIds } } : {}),
    },
    select: { agencyId: true, roomTypeId: true, checkIn: true, checkOut: true },
  });
}

/**
 * Satış bağlamı için gece gece tutulan kota — müsaitlik tüketicilerinin tek
 * kapısı. Kota yoksa `null` döner (sıfır ek yük: tek indeksli sorgu).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} hotelId
 * @param {object} args
 * @param {Date} args.from pencere başı
 * @param {Date} args.to pencere sonu (hariç)
 * @param {string[]} args.days pencerenin günleri ("YYYY-MM-DD") — tüketicinin takviminden
 * @param {string[]} [args.roomTypeIds]
 * @param {string | null} [args.saleAgencyId] satışı yapan acente (genel satışta null)
 * @param {Date} args.today otelin iş günü
 * @param {Array<{ agencyId: string | null, roomTypeId: string, checkIn: Date | string, checkOut: Date | string }>} [args.agencyStays]
 *   elde varsa (envanter anlık görüntüsü) yeniden sorgulanmaz
 * @returns {Promise<Record<string, Record<string, number>> | null>}
 */
export async function holdsForSale(client, hotelId, { from, to, days, roomTypeIds, saleAgencyId = null, today, agencyStays }) {
  const allotments = await loadActiveAllotments(client, hotelId, { roomTypeIds, from, to });
  const relevant = allotments.filter((row) => row.agencyId !== saleAgencyId);
  if (relevant.length === 0) return null;

  const stays =
    agencyStays ??
    (await loadAgencyStays(client, hotelId, {
      from,
      to,
      roomTypeIds: [...new Set(relevant.map((row) => row.roomTypeId))],
    }));
  const holds = allotmentHolds({ allotments: relevant, agencyStays: stays, saleAgencyId, days, today });
  return Object.keys(holds).length > 0 ? holds : null;
}
