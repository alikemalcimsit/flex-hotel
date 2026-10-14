import { randomBytes, randomUUID } from 'node:crypto';
import { currentActor, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import { MAX_COUPON_BATCH, RESERVATION_COUNT_CAP, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { AppError, InUseError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockCoupons, lockPromotions } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { guestFullName } from '../reservations/guests.js';
import { reservationSearchConditions } from '../reservations/service.js';
import { getActiveRoomTypes, getHotelSettings } from '../settings/service.js';
import { discountLabel, generateCouponCode, toTerms } from './rules.js';
import { COUPON_USE_STATUSES } from './sale.js';

/**
 * Promosyon ve kupon servisi (modül 31).
 *
 * ### Promosyonun ömrü
 *
 * Taslak → yayında ⇄ durduruldu. Yayındaki promosyon düzenlenebilir: yalnızca
 * **sonradan açılan** rezervasyonları etkiler (açılmış rezervasyon promosyonu
 * koşullarıyla kopyalamıştır). Kullanılmış promosyon silinmez, durdurulur.
 *
 * ### Kilit düzeni
 *
 * Promosyonu değiştiren işlem promosyonu, kuponu değiştiren işlem kuponu özel
 * kilitler (rezervasyon → oda tipi → acente → promosyon → kupon). Kupon kullanan
 * rezervasyon kuponu kilitleyip kullanımı sayar (`promotions/sale.js`).
 */

/** Promosyon kartında listelenen en fazla kupon üretimi (en yeniler). */
const CARD_BATCH_LIMIT = 50;
/** Kod üretiminde çakışma olursa en fazla bu kadar yeniden deneme (kod uzayı çok büyük). */
const CODE_ATTEMPTS = 5;
/** Toplu kupon yazımı (5000 kod) için transaction süresi. */
const COUPON_TRANSACTION_TIMEOUT_MS = 30_000;

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
const day = (value) => (value ? toIsoDay(value) : null);
const money = (value) => toMoneyString(String(value ?? 0));
/** "YYYY-MM-DD" → @db.Date değeri. @param {Date | null} value */
const dateOnly = (value) => (value ? new Date(`${toIsoDay(value)}T00:00:00.000Z`) : null);

/* ══════════════════ Seçimler ve DTO'lar ══════════════════ */

const PROMOTION_SELECT = Object.freeze({
  id: true,
  name: true,
  notes: true,
  status: true,
  requiresCoupon: true,
  discountType: true,
  discountValue: true,
  stayNights: true,
  payNights: true,
  bookFrom: true,
  bookTo: true,
  stayFrom: true,
  stayTo: true,
  minNights: true,
  maxNights: true,
  minLeadDays: true,
  maxLeadDays: true,
  roomTypeIds: true,
  boardTypes: true,
  sources: true,
  createdBy: true,
  activatedAt: true,
  activatedBy: true,
  createdAt: true,
  updatedAt: true,
});

const COUPON_SELECT = Object.freeze({
  id: true,
  promotionId: true,
  code: true,
  maxUses: true,
  isActive: true,
  batchId: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Yayındaki promosyonun satışa göre durumu: satış dönemi başlamamış, sürüyor ya da geçmiş.
 * @param {any} row
 * @param {string} today
 * @returns {'SCHEDULED' | 'LIVE' | 'EXPIRED' | null}
 */
function availabilityOf(row, today) {
  if (row.status !== 'ACTIVE') return null;
  if (row.bookTo && day(row.bookTo) < today) return 'EXPIRED';
  if (row.bookFrom && day(row.bookFrom) > today) return 'SCHEDULED';
  return 'LIVE';
}

/**
 * @param {any} row `PROMOTION_SELECT`
 * @param {{ today: string, currency: string }} context
 */
function toPromotionDto(row, { today, currency }) {
  const terms = toTerms(row);
  return {
    ...terms,
    notes: row.notes,
    status: row.status,
    availability: availabilityOf(row, today),
    label: discountLabel(terms, currency),
    createdBy: row.createdBy,
    activatedAt: iso(row.activatedAt),
    activatedBy: row.activatedBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Denetim izine yazılan alanlar. @param {any} row */
function promotionSnapshot(row) {
  const { id, ...terms } = toTerms(row);
  return { ...terms, notes: row.notes ?? null, status: row.status };
}

/** @param {any} row `COUPON_SELECT` @param {number} used */
const toCouponDto = (row, used) => ({
  id: row.id,
  promotionId: row.promotionId,
  code: row.code,
  maxUses: row.maxUses,
  used,
  remaining: row.maxUses === null ? null : Math.max(row.maxUses - used, 0),
  isActive: row.isActive,
  batchId: row.batchId,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

/**
 * Promosyonların geçerli kullanımı (iptal / gelmedi sayılmaz), tek sorguda.
 * @param {string} hotelId
 * @param {string[]} promotionIds
 */
async function promotionUsage(hotelId, promotionIds) {
  if (promotionIds.length === 0) return new Map();
  const rows = await prisma.reservation.groupBy({
    by: ['promotionId'],
    where: { hotelId, promotionId: { in: promotionIds }, status: { in: COUPON_USE_STATUSES } },
    _count: { _all: true },
    _sum: { discountTotal: true, totalPrice: true },
  });
  return new Map(
    rows.map((row) => [
      row.promotionId,
      { reservations: row._count._all, discountTotal: money(row._sum.discountTotal), netTotal: money(row._sum.totalPrice) },
    ]),
  );
}

/**
 * Kuponların geçerli kullanımı, tek sorguda.
 * @param {string} hotelId
 * @param {string[]} couponIds
 */
async function couponUsage(hotelId, couponIds) {
  if (couponIds.length === 0) return new Map();
  const rows = await prisma.reservation.groupBy({
    by: ['couponId'],
    where: { hotelId, couponId: { in: couponIds }, status: { in: COUPON_USE_STATUSES } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.couponId, row._count._all]));
}

const EMPTY_USAGE = Object.freeze({ reservations: 0, discountTotal: '0.00', netTotal: '0.00' });

/** @param {string} hotelId */
async function listContext(hotelId) {
  const [hotel, businessDate] = await Promise.all([getHotelSettings(hotelId), getBusinessDate(hotelId)]);
  return { hotel, today: toIsoDay(businessDate), currency: hotel.currency };
}

/* ══════════════════ Promosyon ══════════════════ */

/**
 * Promosyon listesi (sayfalı): ada göre arama, durum ve tür (otomatik / kuponla)
 * süzgeci. Kullanım ve kupon sayıları sayfa için tek ek sorguyla gelir.
 *
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, status?: string, kind?: 'AUTO' | 'COUPON' }} query
 */
export async function listPromotions(hotelId, query) {
  const context = await listContext(hotelId);
  const where = /** @type {Record<string, unknown>} */ ({ hotelId });
  if (query.status) where.status = query.status;
  if (query.kind) where.requiresCoupon = query.kind === 'COUPON';
  const search = query.search?.trim();
  if (search) where.name = containsText(search);

  const [rows, total] = await Promise.all([
    prisma.promotion.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(query), select: PROMOTION_SELECT }),
    prisma.promotion.count({ where }),
  ]);
  const ids = rows.map((row) => row.id);
  const [usage, coupons] = await Promise.all([
    promotionUsage(hotelId, ids),
    ids.length
      ? prisma.coupon.groupBy({ by: ['promotionId'], where: { hotelId, promotionId: { in: ids } }, _count: { _all: true } })
      : [],
  ]);
  const couponCount = new Map(coupons.map((row) => [row.promotionId, row._count._all]));
  return buildPage(
    rows.map((row) => ({ ...toPromotionDto(row, context), usage: usage.get(row.id) ?? EMPTY_USAGE, couponCount: couponCount.get(row.id) ?? 0 })),
    total,
    query,
  );
}

/**
 * Yayına almayı engelleyen eksikler ve uyarılar.
 * @param {any} row
 * @param {{ today: string, typeIds: Set<string>, activeCoupons: number }} context
 */
function readiness(row, { today, typeIds, activeCoupons }) {
  const blockers = [];
  const warnings = [];
  if (row.bookTo && day(row.bookTo) < today) blockers.push('Rezervasyon (satış) dönemi geçmiş; tarihleri güncelleyin.');
  if (row.stayTo && day(row.stayTo) < today) blockers.push('Konaklama dönemi geçmiş; tarihleri güncelleyin.');
  const missingTypes = row.roomTypeIds.filter((id) => !typeIds.has(id)).length;
  if (row.roomTypeIds.length > 0 && missingTypes === row.roomTypeIds.length) blockers.push('Seçili oda tiplerinin hepsi silinmiş.');
  else if (missingTypes > 0) warnings.push(`Seçili oda tiplerinden ${missingTypes} tanesi silinmiş; o tiplerde zaten satış yok.`);
  if (row.requiresCoupon && activeCoupons === 0) warnings.push('Henüz kullanılabilir kupon yok: kupon kodu girilmeden uygulanmaz.');
  return { blockers, warnings };
}

/**
 * Promosyon kartı: koşullar, kullanım özeti, kupon üretimleri, yayına alma eksikleri.
 * @param {string} hotelId
 * @param {string} promotionId
 */
export async function getPromotion(hotelId, promotionId) {
  const [context, row, roomTypes] = await Promise.all([
    listContext(hotelId),
    prisma.promotion.findFirst({ where: { id: promotionId, hotelId }, select: PROMOTION_SELECT }),
    getActiveRoomTypes(hotelId),
  ]);
  if (!row) throw new NotFoundError('Promosyon bulunamadı');

  const [usage, cancelled, couponTotals, batches] = await Promise.all([
    promotionUsage(hotelId, [row.id]),
    prisma.reservation.count({ where: { hotelId, promotionId: row.id, status: { in: ['CANCELLED', 'NO_SHOW'] } } }),
    prisma.coupon.groupBy({ by: ['isActive'], where: { hotelId, promotionId: row.id }, _count: { _all: true } }),
    prisma.coupon.groupBy({
      by: ['batchId'],
      where: { hotelId, promotionId: row.id },
      _count: { _all: true },
      _min: { createdAt: true, code: true, maxUses: true },
      orderBy: { _min: { createdAt: 'desc' } },
      take: CARD_BATCH_LIMIT,
    }),
  ]);
  const activeCoupons = couponTotals.find((entry) => entry.isActive)?._count._all ?? 0;
  const allCoupons = couponTotals.reduce((total, entry) => total + entry._count._all, 0);

  return {
    ...toPromotionDto(row, context),
    usage: { ...(usage.get(row.id) ?? EMPTY_USAGE), cancelled },
    coupons: {
      total: allCoupons,
      active: activeCoupons,
      batches: batches.map((batch) => ({
        batchId: batch.batchId,
        count: batch._count._all,
        createdAt: iso(batch._min.createdAt),
        sampleCode: batch._min.code,
        maxUses: batch._min.maxUses,
      })),
    },
    ...readiness(row, { today: context.today, typeIds: new Set(roomTypes.map((type) => type.id)), activeCoupons }),
  };
}

/**
 * Oda tipleri otelin (silinmemiş) tipleri mi; ad otel içinde tekil mi?
 * @param {any} tx
 * @param {string} hotelId
 * @param {{ name: string, roomTypeIds: string[] }} input
 * @param {string | null} exceptId
 */
async function assertPromotionInput(tx, hotelId, input, exceptId) {
  const known = new Set((await getActiveRoomTypes(hotelId)).map((type) => type.id));
  if (input.roomTypeIds.some((id) => !known.has(id))) {
    throw new ValidationError('Seçilen oda tiplerinden biri bulunamadı ya da silinmiş', { field: 'roomTypeIds' });
  }
  const same = await tx.promotion.findFirst({
    where: { hotelId, name: { equals: input.name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (same) throw new ValidationError('Bu adla bir promosyon zaten var', { field: 'name' });
}

/** @param {any} input */
const promotionData = (input) => ({
  name: input.name,
  notes: input.notes ?? null,
  requiresCoupon: input.requiresCoupon,
  discountType: input.discountType,
  discountValue: input.discountValue,
  stayNights: input.stayNights,
  payNights: input.payNights,
  bookFrom: dateOnly(input.bookFrom),
  bookTo: dateOnly(input.bookTo),
  stayFrom: dateOnly(input.stayFrom),
  stayTo: dateOnly(input.stayTo),
  minNights: input.minNights,
  maxNights: input.maxNights,
  minLeadDays: input.minLeadDays,
  maxLeadDays: input.maxLeadDays,
  roomTypeIds: input.roomTypeIds,
  boardTypes: input.boardTypes,
  sources: input.sources,
});

/**
 * Promosyon açar (taslak).
 * @param {string} hotelId
 * @param {object} input `createPromotionSchema` çıktısı
 */
export async function createPromotion(hotelId, input) {
  const actor = currentActor();
  let promotionId;
  try {
    promotionId = await writeWithEvents(async (tx, stage) => {
      await assertPromotionInput(tx, hotelId, input, null);
      const row = await tx.promotion.create({ data: { hotelId, ...promotionData(input), createdBy: actor }, select: PROMOTION_SELECT });
      await recordAudit(tx, { hotelId, entity: 'Promotion', entityId: row.id, action: 'CREATE', after: promotionSnapshot(row) });
      await stage('promotion.changed', { hotelId, promotionId: row.id, change: 'CREATED' });
      return row.id;
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir promosyon zaten var' });
  }
  return getPromotion(hotelId, promotionId);
}

/**
 * Kilitli promosyonu yükler; sürüm eskiyse 409.
 * @param {any} tx
 * @param {string} hotelId
 * @param {string} promotionId
 * @param {Date} expectedUpdatedAt
 */
async function lockPromotion(tx, hotelId, promotionId, expectedUpdatedAt) {
  if (!(await lockPromotions(tx, hotelId, [promotionId])).has(promotionId)) throw new NotFoundError('Promosyon bulunamadı');
  const row = await tx.promotion.findFirst({ where: { id: promotionId, hotelId }, select: PROMOTION_SELECT });
  if (row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
  return row;
}

/**
 * Promosyonu günceller (sürüm kontrolüyle). Yayındaysa yalnızca sonradan açılan
 * rezervasyonları etkiler; açılmışlar kopyalarını taşır (denetim izi farkı tutar).
 *
 * @param {string} hotelId
 * @param {string} promotionId
 * @param {object} input `updatePromotionSchema` çıktısı
 */
export async function updatePromotion(hotelId, promotionId, input) {
  const { expectedUpdatedAt, ...fields } = input;
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await lockPromotion(tx, hotelId, promotionId, expectedUpdatedAt);
      await assertPromotionInput(tx, hotelId, fields, promotionId);
      if (before.requiresCoupon && !fields.requiresCoupon && (await tx.coupon.count({ where: { hotelId, promotionId } })) > 0) {
        throw new ValidationError('Kuponu olan promosyon kuponsuz (kendiliğinden) yapılamaz; yeni bir promosyon açın', { field: 'requiresCoupon' });
      }
      const after = await tx.promotion.update({ where: { id: promotionId }, data: promotionData(fields), select: PROMOTION_SELECT });
      await recordAudit(tx, { hotelId, entity: 'Promotion', entityId: promotionId, action: 'UPDATE', before: promotionSnapshot(before), after: promotionSnapshot(after) });
      await stage('promotion.changed', { hotelId, promotionId, change: 'UPDATED' });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu adla bir promosyon zaten var' });
  }
  return getPromotion(hotelId, promotionId);
}

/**
 * Yayına al / durdur. Yayına almada satış ve konaklama dönemi geçmemiş, oda
 * tiplerinden en az biri duruyor olmalı.
 *
 * @param {string} hotelId
 * @param {string} promotionId
 * @param {{ expectedUpdatedAt: Date, status: 'ACTIVE' | 'PAUSED' }} input
 */
export async function setPromotionStatus(hotelId, promotionId, { expectedUpdatedAt, status }) {
  const [businessDate, roomTypes] = await Promise.all([getBusinessDate(hotelId), getActiveRoomTypes(hotelId)]);
  await writeWithEvents(async (tx, stage) => {
    const before = await lockPromotion(tx, hotelId, promotionId, expectedUpdatedAt);
    if (before.status === status) return;
    if (status === 'PAUSED' && before.status !== 'ACTIVE') {
      throw new AppError('Yalnızca yayındaki promosyon durdurulur', { statusCode: 409, code: 'INVALID_STATUS' });
    }
    if (status === 'ACTIVE') {
      const { blockers } = readiness(before, { today: toIsoDay(businessDate), typeIds: new Set(roomTypes.map((type) => type.id)), activeCoupons: 1 });
      if (blockers.length) throw new AppError(blockers.join(' '), { statusCode: 422, code: 'PROMOTION_NOT_READY', details: { blockers } });
    }
    const after = await tx.promotion.update({
      where: { id: promotionId },
      data: status === 'ACTIVE' ? { status, activatedAt: new Date(), activatedBy: currentActor() } : { status },
      select: PROMOTION_SELECT,
    });
    await recordAudit(tx, { hotelId, entity: 'Promotion', entityId: promotionId, action: 'UPDATE', before: promotionSnapshot(before), after: promotionSnapshot(after) });
    await stage('promotion.changed', { hotelId, promotionId, change: status === 'ACTIVE' ? 'ACTIVATED' : 'PAUSED' });
  });
  return getPromotion(hotelId, promotionId);
}

/**
 * Hiç kullanılmamış promosyonu (kuponlarıyla) siler. Bir rezervasyona — iptal
 * edilmiş olsa bile — düşmüşse silinmez, durdurulur (raporlar ve denetim izi ona bağlı).
 *
 * @param {string} hotelId
 * @param {string} promotionId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function deletePromotion(hotelId, promotionId, { expectedUpdatedAt }) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await lockPromotion(tx, hotelId, promotionId, expectedUpdatedAt);
      const used = await tx.reservation.count({ where: { hotelId, promotionId } });
      if (used > 0) {
        throw new InUseError(`Bu promosyon ${used} rezervasyonda kullanıldı; silinemez. Yeni satışı durdurmak için "Durdur"u kullanın.`, {
          reservations: used,
        });
      }
      const coupons = await tx.coupon.count({ where: { hotelId, promotionId } });
      await tx.promotion.delete({ where: { id: promotionId } });
      await recordAudit(tx, { hotelId, entity: 'Promotion', entityId: promotionId, action: 'DELETE', before: { ...promotionSnapshot(before), coupons } });
      await stage('promotion.changed', { hotelId, promotionId, change: 'DELETED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return { id: promotionId, deleted: true };
}

/* ══════════════════ Kupon ══════════════════ */

/**
 * Promosyona kupon üretir: `count` rastgele kod (isteğe bağlı önekle) ya da tek
 * elle verilen kod. Aynı seferin kodları bir üretim kimliğiyle bağlanır (dağıtım
 * için dışa aktarma). Denetim izine üretim başına tek kayıt düşer.
 *
 * @param {string} hotelId
 * @param {string} promotionId
 * @param {object} input `createCouponsSchema` çıktısı
 */
export async function createCoupons(hotelId, promotionId, input) {
  const actor = currentActor();
  const batchId = randomUUID();
  let created;
  try {
    created = await writeWithEvents(
      async (tx, stage) => {
        if (!(await lockPromotions(tx, hotelId, [promotionId])).has(promotionId)) throw new NotFoundError('Promosyon bulunamadı');
        const promotion = await tx.promotion.findFirst({ where: { id: promotionId, hotelId }, select: { id: true, requiresCoupon: true } });
        if (!promotion.requiresCoupon) {
          throw new ValidationError('Bu promosyon kendiliğinden uygulanıyor; kupon yalnızca "kuponla" promosyona üretilir', { field: 'mode' });
        }

        const codes = input.mode === 'CUSTOM' ? [input.code] : await uniqueCouponCodes(tx, hotelId, input.prefix ?? null, input.count);
        if (input.mode === 'CUSTOM' && (await tx.coupon.findFirst({ where: { hotelId, code: input.code }, select: { id: true } }))) {
          throw new ValidationError('Bu kupon kodu zaten kullanılıyor', { field: 'code' });
        }
        await tx.coupon.createMany({
          data: codes.map((code) => ({ hotelId, promotionId, code, maxUses: input.maxUses, batchId, createdBy: actor })),
        });
        await recordAudit(tx, {
          hotelId,
          entity: 'Coupon',
          entityId: batchId,
          action: 'CREATE',
          after: {
            promotionId,
            count: codes.length,
            maxUses: input.maxUses,
            ...(input.mode === 'CUSTOM' ? { code: input.code } : { prefix: input.prefix ?? null }),
          },
        });
        await stage('promotion.coupons.changed', { hotelId, promotionId, change: 'GENERATED', count: codes.length });
        return codes.length;
      },
      { timeout: COUPON_TRANSACTION_TIMEOUT_MS },
    );
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kupon kodu zaten kullanılıyor' });
  }
  return { batchId, count: created };
}

/**
 * Otelde kullanılmayan `count` kod. Kod uzayı çok büyük (22^8); çakışan kodlar
 * yeniden üretilir.
 *
 * @param {any} tx
 * @param {string} hotelId
 * @param {string | null} prefix
 * @param {number} count
 */
async function uniqueCouponCodes(tx, hotelId, prefix, count) {
  const codes = new Set();
  for (let attempt = 0; attempt < CODE_ATTEMPTS && codes.size < count; attempt += 1) {
    const fresh = new Set();
    while (codes.size + fresh.size < count) {
      const code = generateCouponCode(prefix, randomBytes);
      if (!codes.has(code)) fresh.add(code);
    }
    const taken = await tx.coupon.findMany({ where: { hotelId, code: { in: [...fresh] } }, select: { code: true } });
    const takenSet = new Set(taken.map((row) => row.code));
    for (const code of fresh) if (!takenSet.has(code)) codes.add(code);
  }
  if (codes.size < count) throw new AppError('Kupon kodu üretilemedi; lütfen tekrar deneyin', { statusCode: 503, code: 'CODE_EXHAUSTED' });
  return [...codes];
}

/**
 * Promosyonun kuponları (sayfalı): kod araması, açık / kapalı, kullanılmış /
 * kullanılmamış, üretim süzgeci. Kullanım sayıları sayfa için tek sorguyla.
 *
 * @param {string} hotelId
 * @param {string} promotionId
 * @param {{ page: number, pageSize: number, search?: string, usage?: 'USED' | 'UNUSED', active?: 'true' | 'false', batchId?: string }} query
 */
export async function listCoupons(hotelId, promotionId, query) {
  const exists = await prisma.promotion.findFirst({ where: { id: promotionId, hotelId }, select: { id: true } });
  if (!exists) throw new NotFoundError('Promosyon bulunamadı');
  const where = /** @type {Record<string, unknown>} */ ({ hotelId, promotionId });
  if (query.batchId) where.batchId = query.batchId;
  if (query.active) where.isActive = query.active === 'true';
  const search = query.search?.trim();
  if (search) where.code = containsText(search.toLocaleUpperCase('en-US'));
  if (query.usage) {
    const used = { some: { status: { in: COUPON_USE_STATUSES } } };
    where.reservations = query.usage === 'USED' ? used : { none: { status: { in: COUPON_USE_STATUSES } } };
  }
  const [rows, total] = await Promise.all([
    prisma.coupon.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...toSkipTake(query), select: COUPON_SELECT }),
    prisma.coupon.count({ where }),
  ]);
  const usage = await couponUsage(hotelId, rows.map((row) => row.id));
  return buildPage(
    rows.map((row) => toCouponDto(row, usage.get(row.id) ?? 0)),
    total,
    query,
  );
}

/**
 * Kuponu kapatır ya da yeniden açar (sürüm kontrolüyle). Kapalı kupon yeni
 * rezervasyonda kullanılamaz; açılmış rezervasyonlar etkilenmez.
 *
 * @param {string} hotelId
 * @param {string} promotionId
 * @param {string} couponId
 * @param {{ expectedUpdatedAt: Date, isActive: boolean }} input
 */
export async function setCouponStatus(hotelId, promotionId, couponId, { expectedUpdatedAt, isActive }) {
  const coupon = await writeWithEvents(async (tx, stage) => {
    if (!(await lockCoupons(tx, hotelId, [couponId])).has(couponId)) throw new NotFoundError('Kupon bulunamadı');
    const before = await tx.coupon.findFirst({ where: { id: couponId, hotelId, promotionId }, select: COUPON_SELECT });
    if (!before) throw new NotFoundError('Kupon bulunamadı');
    if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
    if (before.isActive === isActive) return before;
    const after = await tx.coupon.update({ where: { id: couponId }, data: { isActive }, select: COUPON_SELECT });
    await recordAudit(tx, {
      hotelId,
      entity: 'Coupon',
      entityId: couponId,
      action: 'UPDATE',
      before: { code: before.code, isActive: before.isActive },
      after: { code: after.code, isActive: after.isActive },
    });
    await stage('promotion.coupons.changed', { hotelId, promotionId, change: isActive ? 'ENABLED' : 'DISABLED', count: 1 });
    return after;
  });
  const usage = await couponUsage(hotelId, [couponId]);
  return toCouponDto(coupon, usage.get(couponId) ?? 0);
}

/**
 * Bir üretimin kodları (dağıtım için; üretim en fazla `MAX_COUPON_BATCH` kod).
 * @param {string} hotelId
 * @param {string} promotionId
 * @param {string} batchId
 */
export async function exportCoupons(hotelId, promotionId, batchId) {
  const promotion = await prisma.promotion.findFirst({ where: { id: promotionId, hotelId }, select: { id: true, name: true } });
  if (!promotion) throw new NotFoundError('Promosyon bulunamadı');
  const rows = await prisma.coupon.findMany({
    where: { hotelId, promotionId, batchId },
    orderBy: [{ code: 'asc' }],
    take: MAX_COUPON_BATCH,
    select: COUPON_SELECT,
  });
  if (rows.length === 0) throw new NotFoundError('Bu üretime ait kupon yok');
  const usage = await couponUsage(hotelId, rows.map((row) => row.id));
  return { promotion, items: rows.map((row) => toCouponDto(row, usage.get(row.id) ?? 0)) };
}

/* ══════════════════ Kullanım raporu ══════════════════ */

/**
 * Rapor dönemi: satış günü otelin saat dilimiyle (gece yarısı yerel saat),
 * giriş günü gün başıyla. Bitiş günü dahil.
 *
 * @param {{ from: Date, to: Date, basis: 'BOOKED' | 'STAY' }} query
 * @param {string} timezone
 */
function reportWindow(query, timezone) {
  const fromDay = toIsoDay(query.from);
  const afterDay = toIsoDay(new Date(Date.parse(`${toIsoDay(query.to)}T00:00:00.000Z`) + 86_400_000));
  if (query.basis === 'STAY') {
    return { column: 'checkIn', from: new Date(`${fromDay}T00:00:00.000Z`), before: new Date(`${afterDay}T00:00:00.000Z`) };
  }
  return { column: 'createdAt', from: zonedWallTimeToUtc(`${fromDay}T00:00`, timezone), before: zonedWallTimeToUtc(`${afterDay}T00:00`, timezone) };
}

/**
 * Promosyon başına kullanım (sayfalı, en çok indirim verenden): geçerli
 * rezervasyon, iptal / gelmedi, gece, liste tutarı, indirim, net tutar ve
 * kullanılan kupon sayısı. Dönemin toplamı ayrıca.
 *
 * Index: `Reservation_promo_booked_idx` / `Reservation_promo_stay_idx` (yalnızca
 * promosyonlu satırlar).
 *
 * @param {string} hotelId
 * @param {{ from: Date, to: Date, basis: 'BOOKED' | 'STAY', promotionId?: string, page: number, pageSize: number }} query
 */
export async function getPromotionReport(hotelId, query) {
  const hotel = await getHotelSettings(hotelId);
  const window = reportWindow(query, hotel.timezone);
  const column = window.column === 'checkIn' ? 'r."checkIn"' : 'r."createdAt"';
  const active = `r.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT')`;
  const params = [hotelId, window.from, window.before];
  let scope = `r."hotelId" = $1 AND r."promotionId" IS NOT NULL AND r."deletedAt" IS NULL AND ${column} >= $2 AND ${column} < $3`;
  if (query.promotionId) {
    params.push(query.promotionId);
    scope += ` AND r."promotionId" = $${params.length}`;
  }
  const measures = `
      COUNT(*) FILTER (WHERE ${active})::int AS "reservations",
      COUNT(*) FILTER (WHERE NOT (${active}))::int AS "cancelled",
      COALESCE(SUM(r."checkOut"::date - r."checkIn"::date) FILTER (WHERE ${active}), 0)::int AS "nights",
      COALESCE(SUM(r."totalPrice") FILTER (WHERE ${active}), 0)::text AS "netTotal",
      COALESCE(SUM(r."discountTotal") FILTER (WHERE ${active}), 0)::text AS "discountTotal",
      COUNT(DISTINCT r."couponId") FILTER (WHERE ${active})::int AS "coupons"`;
  const { skip, take } = toSkipTake(query);

  // Sabit SQL parçaları bu dosyadan; değerler parametreli.
  const [rows, [{ count }], [totals]] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT r."promotionId" AS "promotionId", ${measures}
         FROM "Reservation" r
        WHERE ${scope}
        GROUP BY r."promotionId"
        ORDER BY SUM(r."discountTotal") FILTER (WHERE ${active}) DESC NULLS LAST, r."promotionId"
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      ...params,
      take,
      skip,
    ),
    prisma.$queryRawUnsafe(`SELECT COUNT(DISTINCT r."promotionId")::int AS count FROM "Reservation" r WHERE ${scope}`, ...params),
    prisma.$queryRawUnsafe(`SELECT ${measures} FROM "Reservation" r WHERE ${scope}`, ...params),
  ]);

  const promotions = rows.length
    ? await prisma.promotion.findMany({ where: { hotelId, id: { in: rows.map((row) => row.promotionId) } }, select: PROMOTION_SELECT })
    : [];
  const byId = new Map(promotions.map((row) => [row.id, row]));
  const context = { today: toIsoDay(await getBusinessDate(hotelId)), currency: hotel.currency };
  const shape = (row) => ({
    reservations: row.reservations,
    cancelled: row.cancelled,
    nights: row.nights,
    discountTotal: money(row.discountTotal),
    netTotal: money(row.netTotal),
    listTotal: toMoneyString(toDecimal(row.netTotal).plus(toDecimal(row.discountTotal))),
    coupons: row.coupons,
  });

  return {
    ...buildPage(
      rows.map((row) => {
        const promotion = byId.get(row.promotionId);
        return {
          id: row.promotionId,
          promotion: promotion
            ? { id: promotion.id, name: promotion.name, status: promotion.status, requiresCoupon: promotion.requiresCoupon, label: toPromotionDto(promotion, context).label }
            : null,
          ...shape(row),
        };
      }),
      count,
      query,
    ),
    totals: shape(totals),
    currency: hotel.currency,
    basis: query.basis,
  };
}

/**
 * Bir promosyonun rezervasyonları (sayfalı, yeniden eskiye): kod, misafir,
 * konaklama, kupon, indirim ve net tutar. Arama rezervasyon listesinin aramasıyla
 * aynı (kod, misafir adı, telefon).
 *
 * @param {string} hotelId
 * @param {string} promotionId
 * @param {{ from: Date, to: Date, basis: 'BOOKED' | 'STAY', status?: string, couponId?: string, search?: string, page: number, pageSize: number }} query
 */
export async function listPromotionReservations(hotelId, promotionId, query) {
  const [hotel, promotion] = await Promise.all([
    getHotelSettings(hotelId),
    prisma.promotion.findFirst({ where: { id: promotionId, hotelId }, select: { id: true } }),
  ]);
  if (!promotion) throw new NotFoundError('Promosyon bulunamadı');
  const window = reportWindow(query, hotel.timezone);
  const where = /** @type {Record<string, unknown>} */ ({
    hotelId,
    promotionId,
    [window.column]: { gte: window.from, lt: window.before },
  });
  if (query.status) where.status = query.status;
  if (query.couponId) where.couponId = query.couponId;
  if (query.search?.trim()) where.AND = await reservationSearchConditions(hotelId, query.search, hotel);
  const orderBy = [{ [window.column]: 'desc' }, { id: 'desc' }];

  const [rows, counted] = await Promise.all([
    prisma.reservation.findMany({
      where,
      orderBy,
      ...toSkipTake(query),
      select: {
        id: true,
        confirmationCode: true,
        status: true,
        checkIn: true,
        checkOut: true,
        totalPrice: true,
        discountTotal: true,
        currency: true,
        createdAt: true,
        source: true,
        guest: { select: { firstName: true, lastName: true } },
        roomType: { select: { code: true, name: true } },
        coupon: { select: { id: true, code: true } },
      },
    }),
    // Sınırlı sayım: bütün promosyonlu satışları saymak yerine "2000+".
    prisma.reservation.count({ where, orderBy, take: RESERVATION_COUNT_CAP + 1 }),
  ]);
  const totalCapped = counted > RESERVATION_COUNT_CAP;
  const page = buildPage(
    rows.map((row) => ({
      id: row.id,
      confirmationCode: row.confirmationCode,
      status: row.status,
      source: row.source,
      guestName: row.guest ? guestFullName(row.guest) : null,
      roomType: row.roomType,
      checkIn: toIsoDay(row.checkIn),
      checkOut: toIsoDay(row.checkOut),
      coupon: row.coupon,
      discountTotal: money(row.discountTotal),
      totalPrice: money(row.totalPrice),
      listTotal: toMoneyString(toDecimal(String(row.totalPrice)).plus(toDecimal(String(row.discountTotal)))),
      currency: row.currency,
      createdAt: iso(row.createdAt),
    })),
    totalCapped ? RESERVATION_COUNT_CAP : counted,
    query,
  );
  return { ...page, meta: { ...page.meta, totalCapped, currency: hotel.currency } };
}
