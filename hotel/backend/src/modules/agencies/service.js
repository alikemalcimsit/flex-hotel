import { currentActor, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import {
  AGENCY_OPTIONS_LIMIT,
  MAX_CONTRACT_STOP_SALES,
  RESERVATION_COUNT_CAP,
  contractRateIssues,
  dayText,
  paymentDueDay,
  stopSalePeriodError,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { lockAgencies, lockRoomTypes } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { containsText } from '../../lib/search.js';
import { writeWithEvents } from '../../lib/write.js';
import { guestFullName } from '../reservations/guests.js';
import { reservationSearchConditions } from '../reservations/service.js';
import { getHotelSettings } from '../settings/service.js';
import { activationIssues, commissionAmount } from './rules.js';

/**
 * Acente ve kontrat servisi (modül 29).
 *
 * ### Kilit düzeni
 *
 * Acentenin kartını ya da kontratını (fiyat, stop-sale, durum, dönem) değiştiren
 * her işlem önce ilgili oda tiplerini, sonra acenteyi **özel** kilitler;
 * acenteye rezervasyon yazan işlem aynı sırayla acenteyi **paylaşımlı**
 * kilitler (bkz. `lib/locks.js`). Böylece stop-sale eklenirken aynı anda gelen
 * rezervasyon ya eski durumu tam görür ya da yeni durumu tam görür.
 *
 * ### Fiyatın ömrü
 *
 * Kontrat fiyatı değişince yalnızca **sonradan açılan** rezervasyonlar etkilenir:
 * açılmış rezervasyon gecelerini açıldığı günkü fiyatla taşır (denetim izi
 * fiyat değişikliğini ayrıca tutar).
 */

/** Kontrat detayında ve denetim izinde listelenen en fazla fiyat satırı farkı. */
const AUDIT_RATE_SAMPLE = 40;

const DAY_MS = 86_400_000;

/** Kontrat listesi: acente kartında en fazla bu kadar kontrat gösterilir. */
const CARD_CONTRACT_LIMIT = 200;

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);
const money = (value) => toMoneyString(String(value));

/* ══════════════════ Seçimler ve DTO'lar ══════════════════ */

const AGENCY_SELECT = Object.freeze({
  id: true,
  code: true,
  name: true,
  contactName: true,
  phone: true,
  email: true,
  address: true,
  taxOffice: true,
  taxNumber: true,
  commissionPct: true,
  paymentTermDays: true,
  status: true,
  notes: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

const CONTRACT_SELECT = Object.freeze({
  id: true,
  agencyId: true,
  name: true,
  startDate: true,
  endDate: true,
  status: true,
  currency: true,
  notes: true,
  createdBy: true,
  activatedAt: true,
  activatedBy: true,
  endedAt: true,
  endedBy: true,
  endReason: true,
  createdAt: true,
  updatedAt: true,
});

const RATE_SELECT = Object.freeze({ id: true, roomTypeId: true, boardType: true, startDate: true, endDate: true, price: true });
const STOP_SALE_SELECT = Object.freeze({ id: true, roomTypeId: true, startDate: true, endDate: true, reason: true, createdBy: true, createdAt: true });

/** @param {any} row */
function toAgencyDto(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    taxOffice: row.taxOffice,
    taxNumber: row.taxNumber,
    commissionPct: money(row.commissionPct),
    paymentTermDays: row.paymentTermDays,
    status: row.status,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Denetim izine yazılan alanlar. @param {any} row */
function agencySnapshot(row) {
  return {
    code: row.code,
    name: row.name,
    contactName: row.contactName ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    taxOffice: row.taxOffice ?? null,
    taxNumber: row.taxNumber ?? null,
    commissionPct: money(row.commissionPct),
    paymentTermDays: row.paymentTermDays,
    status: row.status,
    notes: row.notes ?? null,
  };
}

/** @param {any} row */
function toContractDto(row) {
  return {
    id: row.id,
    agencyId: row.agencyId,
    name: row.name,
    startDate: toIsoDay(row.startDate),
    endDate: toIsoDay(row.endDate),
    status: row.status,
    currency: row.currency,
    notes: row.notes,
    createdBy: row.createdBy,
    activatedAt: iso(row.activatedAt),
    activatedBy: row.activatedBy,
    endedAt: iso(row.endedAt),
    endedBy: row.endedBy,
    endReason: row.endReason,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** @param {any} row */
const contractSnapshot = (row) => ({
  name: row.name,
  startDate: toIsoDay(row.startDate),
  endDate: toIsoDay(row.endDate),
  status: row.status,
  currency: row.currency,
  notes: row.notes ?? null,
  endReason: row.endReason ?? null,
});

/** @param {any} row */
const toRateDto = (row) => ({
  id: row.id,
  roomTypeId: row.roomTypeId,
  boardType: row.boardType,
  startDate: toIsoDay(row.startDate),
  endDate: toIsoDay(row.endDate),
  price: money(row.price),
});

/** @param {any} row */
const toStopSaleDto = (row) => ({
  id: row.id,
  roomTypeId: row.roomTypeId,
  startDate: toIsoDay(row.startDate),
  endDate: toIsoDay(row.endDate),
  reason: row.reason,
  createdBy: row.createdBy,
  createdAt: iso(row.createdAt),
});

/** Gün metninden UTC gün başı. @param {string} text */
const dayStart = (text) => new Date(`${dayText(text)}T00:00:00.000Z`);

/* ══════════════════ Acente ══════════════════ */

/**
 * Acente listesi (sayfalı): ad, kod ya da yetkili adıyla arama, durum süzgeci.
 * Her acente için bugünü kapsayan (yoksa en yakın gelecek) satıştaki kontrat
 * tek ek sorguyla gelir.
 *
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string, status?: string }} query
 */
export async function listAgencies(hotelId, query) {
  const businessDate = await getBusinessDate(hotelId);
  const where = /** @type {Record<string, unknown>} */ ({ hotelId });
  if (query.status) where.status = query.status;
  const search = query.search?.trim();
  if (search) where.OR = [{ name: containsText(search) }, { code: containsText(search) }, { contactName: containsText(search) }];

  const [rows, total] = await Promise.all([
    prisma.agency.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...toSkipTake(query), select: AGENCY_SELECT }),
    prisma.agency.count({ where }),
  ]);

  const contracts = rows.length
    ? await prisma.contract.findMany({
        where: { hotelId, agencyId: { in: rows.map((row) => row.id) }, status: 'ACTIVE', endDate: { gte: businessDate } },
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
        select: { id: true, agencyId: true, name: true, startDate: true, endDate: true },
      })
    : [];
  const today = toIsoDay(businessDate);
  /** @type {Map<string, any>} */
  const current = new Map();
  for (const contract of contracts) {
    const covers = toIsoDay(contract.startDate) <= today;
    const known = current.get(contract.agencyId);
    // Bugünü kapsayan kontrat varsa o; yoksa en yakın gelecek kontrat.
    if (!known || (covers && !known.current)) {
      current.set(contract.agencyId, { id: contract.id, name: contract.name, startDate: toIsoDay(contract.startDate), endDate: toIsoDay(contract.endDate), current: covers });
    }
  }

  return buildPage(
    rows.map((row) => ({ ...toAgencyDto(row), activeContract: current.get(row.id) ?? null })),
    total,
    query,
  );
}

/**
 * Rezervasyon formundaki acente seçicisi: aktif acenteler, ada / koda göre arama
 * ya da seçili acente kimliğiyle. Komisyon, vergi gibi ticari alanlar dönmez
 * (resepsiyonun `agencies.view` izni yok).
 *
 * @param {string} hotelId
 * @param {{ q?: string, id?: string }} query
 */
export async function searchAgencyOptions(hotelId, query) {
  const where = /** @type {Record<string, unknown>} */ ({ hotelId });
  if (query.id) {
    where.id = query.id;
  } else {
    where.status = 'ACTIVE';
    const search = query.q?.trim();
    if (search) where.OR = [{ name: containsText(search) }, { code: containsText(search) }];
  }
  const rows = await prisma.agency.findMany({
    where,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: AGENCY_OPTIONS_LIMIT,
    select: { id: true, code: true, name: true, status: true },
  });
  return { items: rows };
}

/**
 * Acente kartı + kontratları.
 * @param {string} hotelId
 * @param {string} agencyId
 */
export async function getAgency(hotelId, agencyId) {
  const row = await prisma.agency.findFirst({
    where: { id: agencyId, hotelId },
    select: {
      ...AGENCY_SELECT,
      contracts: {
        orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
        take: CARD_CONTRACT_LIMIT,
        select: { ...CONTRACT_SELECT, _count: { select: { rates: true, stopSales: true } } },
      },
    },
  });
  if (!row) throw new NotFoundError('Acente bulunamadı');
  return {
    ...toAgencyDto(row),
    contracts: row.contracts.map((contract) => ({
      ...toContractDto(contract),
      rateCount: contract._count.rates,
      stopSaleCount: contract._count.stopSales,
    })),
  };
}

/**
 * Kod ve ad otel içinde tekil (ad büyük / küçük harf duyarsız). Veritabanı
 * index'leri son savunma; burada alanın altına yazılacak mesaj üretilir.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ code: string, name: string }} input
 * @param {string | null} exceptId
 */
async function assertAgencyUnique(tx, hotelId, input, exceptId) {
  const notSelf = exceptId ? { id: { not: exceptId } } : {};
  const sameCode = await tx.agency.findFirst({ where: { hotelId, code: input.code, ...notSelf }, select: { id: true } });
  if (sameCode) throw new ValidationError('Bu koda sahip bir acente zaten var', { field: 'code' });
  const sameName = await tx.agency.findFirst({ where: { hotelId, name: { equals: input.name, mode: 'insensitive' }, ...notSelf }, select: { id: true } });
  if (sameName) throw new ValidationError('Bu adla bir acente zaten kayıtlı', { field: 'name' });
}

/** @param {any} input */
const agencyData = (input) => ({
  code: input.code,
  name: input.name,
  contactName: input.contactName ?? null,
  phone: input.phone ?? null,
  email: input.email ?? null,
  address: input.address ?? null,
  taxOffice: input.taxOffice ?? null,
  taxNumber: input.taxNumber ?? null,
  commissionPct: input.commissionPct,
  paymentTermDays: input.paymentTermDays,
  notes: input.notes ?? null,
});

/**
 * Acente açar.
 * @param {string} hotelId
 * @param {object} input `createAgencySchema` çıktısı
 */
export async function createAgency(hotelId, input) {
  const actor = currentActor();
  let agencyId;
  try {
    agencyId = await writeWithEvents(async (tx, stage) => {
      await assertAgencyUnique(tx, hotelId, input, null);
      const row = await tx.agency.create({ data: { hotelId, ...agencyData(input), createdBy: actor }, select: AGENCY_SELECT });
      await recordAudit(tx, { hotelId, entity: 'Agency', entityId: row.id, action: 'CREATE', after: agencySnapshot(row) });
      await stage('agency.changed', { hotelId, agencyId: row.id, change: 'CREATED' });
      return row.id;
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu koda ya da adla bir acente zaten var' });
  }
  return getAgency(hotelId, agencyId);
}

/**
 * Acente kartını günceller (sürüm kontrolüyle). Komisyon değişince açılmış
 * rezervasyonlar etkilenmez: oran rezervasyon açılırken kopyalanmıştır.
 *
 * @param {string} hotelId
 * @param {string} agencyId
 * @param {object} input `updateAgencySchema` çıktısı
 */
export async function updateAgency(hotelId, agencyId, input) {
  const { expectedUpdatedAt, ...fields } = input;
  try {
    await writeWithEvents(async (tx, stage) => {
      if (!(await lockAgencies(tx, hotelId, [agencyId])).has(agencyId)) throw new NotFoundError('Acente bulunamadı');
      const before = await tx.agency.findFirst({ where: { id: agencyId, hotelId }, select: AGENCY_SELECT });
      if (!before) throw new NotFoundError('Acente bulunamadı');
      if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
      await assertAgencyUnique(tx, hotelId, fields, agencyId);
      const after = await tx.agency.update({ where: { id: agencyId }, data: agencyData(fields), select: AGENCY_SELECT });
      await recordAudit(tx, { hotelId, entity: 'Agency', entityId: agencyId, action: 'UPDATE', before: agencySnapshot(before), after: agencySnapshot(after) });
      await stage('agency.changed', { hotelId, agencyId, change: 'UPDATED' });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu koda ya da adla bir acente zaten var' });
  }
  return getAgency(hotelId, agencyId);
}

/**
 * Aktif ↔ pasif. Pasif acentede yeni rezervasyon açılmaz ve kontratı satışa
 * açılamaz; açılmış rezervasyonlar ve satıştaki kontratlar değişmez.
 *
 * @param {string} hotelId
 * @param {string} agencyId
 * @param {{ expectedUpdatedAt: Date, status: 'ACTIVE' | 'PASSIVE' }} input
 */
export async function setAgencyStatus(hotelId, agencyId, { expectedUpdatedAt, status }) {
  await writeWithEvents(async (tx, stage) => {
    if (!(await lockAgencies(tx, hotelId, [agencyId])).has(agencyId)) throw new NotFoundError('Acente bulunamadı');
    const before = await tx.agency.findFirst({ where: { id: agencyId, hotelId }, select: AGENCY_SELECT });
    if (!before) throw new NotFoundError('Acente bulunamadı');
    if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
    if (before.status === status) return;
    const after = await tx.agency.update({ where: { id: agencyId }, data: { status }, select: AGENCY_SELECT });
    await recordAudit(tx, { hotelId, entity: 'Agency', entityId: agencyId, action: 'UPDATE', before: agencySnapshot(before), after: agencySnapshot(after) });
    await stage('agency.changed', { hotelId, agencyId, change: status === 'ACTIVE' ? 'ACTIVATED' : 'DEACTIVATED' });
  });
  return getAgency(hotelId, agencyId);
}

/* ══════════════════ Kontrat ══════════════════ */

/**
 * Acentenin bu dönemle çakışan, satıştaki başka kontratı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} db
 * @param {string} hotelId
 * @param {string} agencyId
 * @param {{ startDate: Date | string, endDate: Date | string }} period
 * @param {string | null} exceptId
 */
function findOverlappingActive(db, hotelId, agencyId, period, exceptId) {
  return db.contract.findFirst({
    where: {
      hotelId,
      agencyId,
      status: 'ACTIVE',
      startDate: { lte: dayStart(dayText(period.endDate)) },
      endDate: { gte: dayStart(dayText(period.startDate)) },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
}

/** @param {{ name: string, startDate: Date, endDate: Date }} other */
const overlapMessage = (other) =>
  `"${other.name}" kontratı bu tarihlerde satışta (${toIsoDay(other.startDate)} – ${toIsoDay(other.endDate)}). Önce onu sonlandırın ya da tarihleri değiştirin.`;

/**
 * Kontrat ekranı: başlık, acente, fiyat satırları, stop-sale'ler ve (taslaksa)
 * satışa açmayı engelleyen eksikler.
 *
 * @param {string} hotelId
 * @param {string} contractId
 */
export async function getContract(hotelId, contractId) {
  const [row, businessDate, hotel] = await Promise.all([
    prisma.contract.findFirst({
      where: { id: contractId, hotelId },
      select: {
        ...CONTRACT_SELECT,
        agency: { select: { id: true, code: true, name: true, status: true } },
        rates: { orderBy: [{ startDate: 'asc' }, { boardType: 'asc' }, { roomTypeId: 'asc' }], select: RATE_SELECT },
        stopSales: { orderBy: [{ startDate: 'asc' }, { id: 'asc' }], select: STOP_SALE_SELECT },
      },
    }),
    getBusinessDate(hotelId),
    getHotelSettings(hotelId),
  ]);
  if (!row) throw new NotFoundError('Kontrat bulunamadı');

  let blockers = [];
  if (row.status === 'DRAFT') {
    blockers = activationIssues({
      agencyStatus: row.agency.status,
      contract: row,
      rateCount: row.rates.length,
      hotelCurrency: hotel.currency,
      businessDate: toIsoDay(businessDate),
    });
    const overlapping = await findOverlappingActive(prisma, hotelId, row.agencyId, row, null);
    if (overlapping) blockers.push(overlapMessage(overlapping));
  }

  return {
    ...toContractDto(row),
    agency: row.agency,
    rates: row.rates.map(toRateDto),
    stopSales: row.stopSales.map(toStopSaleDto),
    /** Taslak kontratın satışa açılmasını engelleyenler (boşsa açılabilir). */
    blockers,
    businessDate: toIsoDay(businessDate),
  };
}

/**
 * Kontratın acentesini bulur (kilit sırası için: kimlikler önce okunur, sonra
 * kilitler alınır; acente kontratın ömrü boyunca değişmez).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} contractId
 */
async function contractAgencyId(tx, hotelId, contractId) {
  const base = await tx.contract.findFirst({ where: { id: contractId, hotelId }, select: { agencyId: true } });
  if (!base) throw new NotFoundError('Kontrat bulunamadı');
  return base.agencyId;
}

/**
 * Acenteyi özel kilitler ve kontratı kilit altında yeniden okur.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} contractId
 * @param {string} agencyId
 */
async function lockedContract(tx, hotelId, contractId, agencyId) {
  if (!(await lockAgencies(tx, hotelId, [agencyId])).has(agencyId)) throw new NotFoundError('Acente bulunamadı');
  const contract = await tx.contract.findFirst({ where: { id: contractId, hotelId }, select: CONTRACT_SELECT });
  if (!contract) throw new NotFoundError('Kontrat bulunamadı');
  return contract;
}

/** @param {{ status: string }} contract @param {string} action */
function assertNotEnded(contract, action) {
  if (contract.status === 'ENDED') {
    throw new ConflictError(`Sonlandırılmış kontrat ${action}`, 'CONTRACT_ENDED');
  }
}

/** Sürüm eskiyse 409 (kilit altında karşılaştırılır). */
function assertFresh(contract, expectedUpdatedAt) {
  if (contract.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleWriteError();
}

/**
 * Taslak kontrat açar (satışa kapalı). Para birimi otelin parasıdır.
 *
 * @param {string} hotelId
 * @param {string} agencyId
 * @param {{ name: string, startDate: Date, endDate: Date, notes?: string | null }} input
 */
export async function createContract(hotelId, agencyId, input) {
  const actor = currentActor();
  const hotel = await getHotelSettings(hotelId);
  const contractId = await writeWithEvents(async (tx, stage) => {
    if (!(await lockAgencies(tx, hotelId, [agencyId], { shared: true })).has(agencyId)) throw new NotFoundError('Acente bulunamadı');
    const row = await tx.contract.create({
      data: { hotelId, agencyId, name: input.name, startDate: input.startDate, endDate: input.endDate, notes: input.notes ?? null, currency: hotel.currency, createdBy: actor },
      select: CONTRACT_SELECT,
    });
    await recordAudit(tx, { hotelId, entity: 'Contract', entityId: row.id, action: 'CREATE', after: { agencyId, ...contractSnapshot(row) } });
    await stage('agency.contract.changed', { hotelId, agencyId, contractId: row.id, change: 'CREATED' });
    return row.id;
  });
  return getContract(hotelId, contractId);
}

/**
 * Kontrat başlığı: ad, dönem, not. Dönem değişince fiyat ve stop-sale satırları
 * yeni dönemin içinde kalmalı; satıştaki kontratın dönemi acentenin başka
 * satıştaki kontratıyla çakışamaz.
 *
 * @param {string} hotelId
 * @param {string} contractId
 * @param {{ expectedUpdatedAt: Date, name: string, startDate: Date, endDate: Date, notes?: string | null }} input
 */
export async function updateContract(hotelId, contractId, input) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const agencyId = await contractAgencyId(tx, hotelId, contractId);
      const before = await lockedContract(tx, hotelId, contractId, agencyId);
      assertNotEnded(before, 'düzenlenemez');
      assertFresh(before, input.expectedUpdatedAt);

      const outside = { OR: [{ startDate: { lt: input.startDate } }, { endDate: { gt: input.endDate } }] };
      const [rates, stops] = await Promise.all([
        tx.contractRate.count({ where: { contractId, ...outside } }),
        tx.contractStopSale.count({ where: { contractId, ...outside } }),
      ]);
      if (rates + stops > 0) {
        throw new ValidationError(
          `Yeni dönemin dışında kalan ${rates} fiyat satırı ve ${stops} stop-sale var; önce onları düzenleyin ya da dönemi genişletin.`,
          { field: 'startDate' },
        );
      }
      if (before.status === 'ACTIVE') {
        const overlapping = await findOverlappingActive(tx, hotelId, agencyId, input, contractId);
        if (overlapping) throw new ConflictError(overlapMessage(overlapping), 'CONTRACT_OVERLAP');
      }

      const after = await tx.contract.update({
        where: { id: contractId },
        data: { name: input.name, startDate: input.startDate, endDate: input.endDate, notes: input.notes ?? null },
        select: CONTRACT_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'Contract', entityId: contractId, action: 'UPDATE', before: contractSnapshot(before), after: contractSnapshot(after) });
      await stage('agency.contract.changed', { hotelId, agencyId, contractId, change: 'UPDATED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getContract(hotelId, contractId);
}

/** @param {any[]} rows @param {Map<string, string>} codes */
function rateTexts(rows, codes) {
  /** @type {Map<string, string>} */
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.roomTypeId}|${row.boardType}|${toIsoDay(row.startDate)}|${toIsoDay(row.endDate)}`;
    byKey.set(key, `${codes.get(row.roomTypeId) ?? row.roomTypeId.slice(0, 8)} ${row.boardType} ${toIsoDay(row.startDate)}..${toIsoDay(row.endDate)}`);
  }
  return byKey;
}

/**
 * Fiyat satırlarının önceki ve sonraki hâli arasındaki fark (denetim izi için):
 * eklenen, kaldırılan ve fiyatı değişen satırlar (en fazla `AUDIT_RATE_SAMPLE`).
 *
 * @param {any[]} before
 * @param {any[]} after
 * @param {Map<string, string>} codes oda tipi kimliği → kod
 */
export function diffRates(before, after, codes) {
  const label = rateTexts([...before, ...after], codes);
  const keyOf = (row) => `${row.roomTypeId}|${row.boardType}|${toIsoDay(row.startDate)}|${toIsoDay(row.endDate)}`;
  const oldByKey = new Map(before.map((row) => [keyOf(row), money(row.price)]));
  const newByKey = new Map(after.map((row) => [keyOf(row), money(row.price)]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, price] of newByKey) {
    if (!oldByKey.has(key)) added.push(`${label.get(key)} = ${price}`);
    else if (oldByKey.get(key) !== price) changed.push(`${label.get(key)}: ${oldByKey.get(key)} → ${price}`);
  }
  for (const [key, price] of oldByKey) {
    if (!newByKey.has(key)) removed.push(`${label.get(key)} = ${price}`);
  }
  const cap = (list) => (list.length > AUDIT_RATE_SAMPLE ? [...list.slice(0, AUDIT_RATE_SAMPLE), `… +${list.length - AUDIT_RATE_SAMPLE} satır daha`] : list);
  return { added: cap(added), removed: cap(removed), changed: cap(changed), counts: { added: added.length, removed: removed.length, changed: changed.length } };
}

/**
 * Kontratın bütün fiyat satırlarını değiştirir (tablo bir bütün olarak kaydedilir).
 * Taslakta ve satıştaki kontratta yapılır; satıştakinde en az bir satır kalmalı.
 * Değişiklik yalnızca sonradan açılan rezervasyonları etkiler.
 *
 * @param {string} hotelId
 * @param {string} contractId
 * @param {{ expectedUpdatedAt: Date, rates: Array<{ roomTypeId: string, boardType: string, startDate: Date, endDate: Date, price: string }> }} input
 */
export async function saveContractRates(hotelId, contractId, { expectedUpdatedAt, rates }) {
  const typeIds = [...new Set(rates.map((rate) => rate.roomTypeId))];
  try {
    await writeWithEvents(async (tx, stage) => {
      const agencyId = await contractAgencyId(tx, hotelId, contractId);
      // Kilit sırası: oda tipleri → acente (rezervasyonla aynı).
      const locked = await lockRoomTypes(tx, hotelId, typeIds);
      const missing = typeIds.filter((id) => !locked.has(id));
      if (missing.length) {
        throw new ValidationError('Fiyat tablosunda bulunamayan ya da silinmiş bir oda tipi var; sayfayı yenileyip tekrar deneyin.', { field: 'rates', roomTypeIds: missing });
      }
      const contract = await lockedContract(tx, hotelId, contractId, agencyId);
      assertNotEnded(contract, 'düzenlenemez');
      assertFresh(contract, expectedUpdatedAt);
      if (contract.status === 'ACTIVE' && rates.length === 0) {
        throw new ValidationError('Satıştaki kontratın en az bir fiyat satırı olmalı. Satışı durdurmak için stop-sale ekleyin ya da kontratı sonlandırın.', { field: 'rates' });
      }
      const issues = contractRateIssues(rates, contract);
      if (issues.length) throw new ValidationError(issues[0].message, { field: `rates.${issues[0].index}.${issues[0].field}` });

      const before = await tx.contractRate.findMany({ where: { contractId }, select: RATE_SELECT });
      const types = await tx.roomType.findMany({ where: { hotelId, id: { in: [...new Set([...typeIds, ...before.map((row) => row.roomTypeId)])] } }, select: { id: true, code: true } });
      const diff = diffRates(before, rates, new Map(types.map((type) => [type.id, type.code])));
      if (diff.counts.added + diff.counts.removed + diff.counts.changed === 0) return;

      // Önce sürüm: aynı anda başkası kaydettiyse satırlara dokunulmaz.
      await tx.contract.update({ where: { id: contractId }, data: { updatedAt: new Date() } });
      await tx.contractRate.deleteMany({ where: { contractId } });
      if (rates.length) {
        await tx.contractRate.createMany({
          data: rates.map((rate) => ({ hotelId, contractId, roomTypeId: rate.roomTypeId, boardType: rate.boardType, startDate: rate.startDate, endDate: rate.endDate, price: rate.price })),
        });
      }
      await recordAudit(tx, {
        hotelId,
        entity: 'ContractRate',
        entityId: contractId,
        action: 'UPDATE',
        before: { rateCount: before.length },
        after: { rateCount: rates.length, status: contract.status, ...diff },
      });
      await stage('agency.contract.changed', { hotelId, agencyId, contractId, change: 'RATES_SAVED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getContract(hotelId, contractId);
}

/**
 * Taslağı satışa açar: bundan sonra acente adına açılan rezervasyonlar bu
 * kontratın fiyatını alır.
 *
 * @param {string} hotelId
 * @param {string} contractId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function activateContract(hotelId, contractId, { expectedUpdatedAt }) {
  const actor = currentActor();
  const [hotel, businessDate] = await Promise.all([getHotelSettings(hotelId), getBusinessDate(hotelId)]);
  try {
    await writeWithEvents(async (tx, stage) => {
      const agencyId = await contractAgencyId(tx, hotelId, contractId);
      const before = await lockedContract(tx, hotelId, contractId, agencyId);
      assertFresh(before, expectedUpdatedAt);
      if (before.status !== 'DRAFT') throw new ConflictError('Yalnızca taslak kontrat satışa açılır', 'INVALID_STATUS', { status: before.status });

      const agency = await tx.agency.findFirst({ where: { id: agencyId, hotelId }, select: { status: true } });
      const rateCount = await tx.contractRate.count({ where: { contractId } });
      const issues = activationIssues({ agencyStatus: agency?.status ?? 'PASSIVE', contract: before, rateCount, hotelCurrency: hotel.currency, businessDate: toIsoDay(businessDate) });
      if (issues.length) throw new ValidationError(issues.join('. '), { issues });
      const overlapping = await findOverlappingActive(tx, hotelId, agencyId, before, contractId);
      if (overlapping) throw new ConflictError(overlapMessage(overlapping), 'CONTRACT_OVERLAP');

      const after = await tx.contract.update({
        where: { id: contractId },
        data: { status: 'ACTIVE', activatedAt: new Date(), activatedBy: actor },
        select: CONTRACT_SELECT,
      });
      await recordAudit(tx, { hotelId, entity: 'Contract', entityId: contractId, action: 'UPDATE', before: contractSnapshot(before), after: { ...contractSnapshot(after), rateCount } });
      await stage('agency.contract.changed', { hotelId, agencyId, contractId, change: 'ACTIVATED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return getContract(hotelId, contractId);
}

/**
 * Satıştaki kontratı sonlandırır (geri açılmaz). Açılmış rezervasyonlar
 * fiyatını taşımaya devam eder; yeni rezervasyonlar bu kontratla açılamaz.
 *
 * @param {string} hotelId
 * @param {string} contractId
 * @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function endContract(hotelId, contractId, { expectedUpdatedAt, reason }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const agencyId = await contractAgencyId(tx, hotelId, contractId);
    const before = await lockedContract(tx, hotelId, contractId, agencyId);
    assertFresh(before, expectedUpdatedAt);
    if (before.status !== 'ACTIVE') throw new ConflictError('Yalnızca satıştaki kontrat sonlandırılır', 'INVALID_STATUS', { status: before.status });
    const after = await tx.contract.update({
      where: { id: contractId },
      data: { status: 'ENDED', endedAt: new Date(), endedBy: actor, endReason: reason },
      select: CONTRACT_SELECT,
    });
    await recordAudit(tx, { hotelId, entity: 'Contract', entityId: contractId, action: 'UPDATE', before: contractSnapshot(before), after: contractSnapshot(after) });
    await stage('agency.contract.changed', { hotelId, agencyId, contractId, change: 'ENDED' });
  });
  return getContract(hotelId, contractId);
}

/**
 * Taslak kontratı siler (fiyat ve stop-sale satırlarıyla). Satışa açılmış
 * kontrat silinmez, sonlandırılır.
 *
 * @param {string} hotelId
 * @param {string} contractId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function deleteContract(hotelId, contractId, { expectedUpdatedAt }) {
  await writeWithEvents(async (tx, stage) => {
    const agencyId = await contractAgencyId(tx, hotelId, contractId);
    const before = await lockedContract(tx, hotelId, contractId, agencyId);
    assertFresh(before, expectedUpdatedAt);
    if (before.status !== 'DRAFT') {
      throw new ConflictError('Satışa açılmış kontrat silinemez; sonlandırın', 'INVALID_STATUS', { status: before.status });
    }
    await tx.contract.delete({ where: { id: contractId } });
    await recordAudit(tx, { hotelId, entity: 'Contract', entityId: contractId, action: 'DELETE', before: { agencyId, ...contractSnapshot(before) } });
    await stage('agency.contract.changed', { hotelId, agencyId, contractId, change: 'DELETED' });
  });
  return { id: contractId, deleted: true };
}

/* ══════════════════ Stop-sale ══════════════════ */

/**
 * Kontrata stop-sale ekler: bu günlerde acente satamaz (oda tipi boşsa bütün
 * tipler). Açılmış rezervasyonları iptal etmez; kaç tanesi etkilenmediği
 * (bu günlerde acentenin mevcut rezervasyonu) cevapta bilgi olarak döner.
 *
 * @param {string} hotelId
 * @param {string} contractId
 * @param {{ roomTypeId?: string | null, startDate: Date, endDate: Date, reason?: string | null }} input
 */
export async function addStopSale(hotelId, contractId, input) {
  const actor = currentActor();
  let existingReservations = 0;
  try {
    await writeWithEvents(async (tx, stage) => {
      const agencyId = await contractAgencyId(tx, hotelId, contractId);
      if (input.roomTypeId) {
        const locked = await lockRoomTypes(tx, hotelId, [input.roomTypeId]);
        if (!locked.has(input.roomTypeId)) throw new ValidationError('Oda tipi bulunamadı ya da silinmiş', { field: 'roomTypeId' });
      }
      const contract = await lockedContract(tx, hotelId, contractId, agencyId);
      assertNotEnded(contract, 'için stop-sale eklenemez');
      const periodError = stopSalePeriodError(input, contract);
      if (periodError) throw new ValidationError(periodError, { field: 'startDate' });
      const count = await tx.contractStopSale.count({ where: { contractId } });
      if (count >= MAX_CONTRACT_STOP_SALES) {
        throw new ValidationError(`Bir kontratta en fazla ${MAX_CONTRACT_STOP_SALES} stop-sale olabilir; bitmiş olanları silin`, { field: 'startDate' });
      }

      const row = await tx.contractStopSale.create({
        data: { hotelId, contractId, roomTypeId: input.roomTypeId ?? null, startDate: input.startDate, endDate: input.endDate, reason: input.reason ?? null, createdBy: actor },
        select: STOP_SALE_SELECT,
      });
      existingReservations = await tx.reservation.count({
        where: {
          hotelId,
          agencyId,
          status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
          ...(input.roomTypeId ? { roomTypeId: input.roomTypeId } : {}),
          // Geceler [giriş günü, çıkış günü) aralığıdır; giriş / çıkış saatli olabilir: gün sınırları
          // ertesi günün başıyla karşılaştırılır (son stop-sale gecesinde giren sayılır, başlangıç günü çıkan sayılmaz).
          checkIn: { lt: new Date(input.endDate.getTime() + DAY_MS) },
          checkOut: { gte: new Date(input.startDate.getTime() + DAY_MS) },
        },
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'ContractStopSale',
        entityId: row.id,
        action: 'CREATE',
        after: { contractId, roomTypeId: row.roomTypeId, startDate: toIsoDay(row.startDate), endDate: toIsoDay(row.endDate), reason: row.reason ?? null },
      });
      await stage('agency.stop_sale.changed', { hotelId, agencyId, contractId, change: 'ADDED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return { ...(await getContract(hotelId, contractId)), existingReservations };
}

/**
 * Stop-sale'i kaldırır (satış yeniden açılır).
 *
 * @param {string} hotelId
 * @param {string} contractId
 * @param {string} stopSaleId
 */
export async function removeStopSale(hotelId, contractId, stopSaleId) {
  await writeWithEvents(async (tx, stage) => {
    const agencyId = await contractAgencyId(tx, hotelId, contractId);
    const contract = await lockedContract(tx, hotelId, contractId, agencyId);
    assertNotEnded(contract, 'için stop-sale kaldırılamaz');
    const row = await tx.contractStopSale.findFirst({ where: { id: stopSaleId, contractId, hotelId }, select: STOP_SALE_SELECT });
    if (!row) throw new NotFoundError('Stop-sale kaydı bulunamadı');
    await tx.contractStopSale.delete({ where: { id: stopSaleId } });
    await recordAudit(tx, {
      hotelId,
      entity: 'ContractStopSale',
      entityId: stopSaleId,
      action: 'DELETE',
      before: { contractId, roomTypeId: row.roomTypeId, startDate: toIsoDay(row.startDate), endDate: toIsoDay(row.endDate), reason: row.reason ?? null },
    });
    await stage('agency.stop_sale.changed', { hotelId, agencyId, contractId, change: 'REMOVED' });
  });
  return getContract(hotelId, contractId);
}

/* ══════════════════ Cari özeti ve rezervasyonlar ══════════════════ */

/** Satışa sayılan durumlar (iptal ve gelmedi hariç). */
const SOLD_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT']);

/**
 * Dönem varsayılanı: otelin bugününün yılı.
 * @param {Date | undefined} from
 * @param {Date | undefined} to
 * @param {Date} businessDate
 */
function summaryPeriod(from, to, businessDate) {
  const year = businessDate.getUTCFullYear();
  return {
    from: from ? toIsoDay(from) : `${year}-01-01`,
    to: to ? toIsoDay(to) : `${year}-12-31`,
  };
}

/**
 * Acentenin cari özeti: dönemde (girişi bu aralıkta) rezervasyon sayısı, gece,
 * tutar, komisyon (açılıştaki oranla) ve net; acente hesabına (cari) aktarılan
 * ödemeler ve bunun vadesi gelen kısmı.
 *
 * Tahsilat düşümü (acentenin bize yaptığı ödemeler) ön muhasebe (modül 47) ile
 * bağlanır: orada cari hesap kuruldukça "aktarılan" ile "tahsil edilen"
 * eşleşir. Şimdilik aktarılan, folyoda "Acente / cari" yöntemiyle kapatılan
 * tutardır.
 *
 * @param {string} hotelId
 * @param {string} agencyId
 * @param {{ from?: Date, to?: Date }} query
 */
export async function getAgencySummary(hotelId, agencyId, query) {
  const [agency, businessDate, hotel] = await Promise.all([
    prisma.agency.findFirst({ where: { id: agencyId, hotelId }, select: { id: true, code: true, name: true, commissionPct: true, paymentTermDays: true, status: true } }),
    getBusinessDate(hotelId),
    getHotelSettings(hotelId),
  ]);
  if (!agency) throw new NotFoundError('Acente bulunamadı');
  const period = summaryPeriod(query.from, query.to, businessDate);
  const fromDate = dayStart(period.from);
  const toExclusive = new Date(dayStart(period.to).getTime() + DAY_MS);
  const today = toIsoDay(businessDate);

  const [byStatus, account] = await Promise.all([
    prisma.$queryRaw`
      SELECT r."status"::text AS "status",
             count(*)::int AS "reservations",
             COALESCE(sum(r."checkOut"::date - r."checkIn"::date), 0)::int AS "nights",
             COALESCE(sum(r."totalPrice"), 0) AS "total",
             COALESCE(sum(round(r."totalPrice" * COALESCE(r."agencyCommissionPct", 0) / 100, 2)), 0) AS "commission",
             COALESCE(sum(r."cancellationFee"), 0) AS "cancellationFees",
             COALESCE(sum(r."noShowFee"), 0) AS "noShowFees"
      FROM "Reservation" r
      WHERE r."hotelId" = ${hotelId}
        AND r."agencyId" = ${agencyId}
        AND r."deletedAt" IS NULL
        AND r."checkIn" >= ${fromDate}
        AND r."checkIn" < ${toExclusive}
      GROUP BY r."status"`,
    prisma.$queryRaw`
      SELECT COALESCE(sum(p."folioAmount"), 0) AS "transferred",
             COALESCE(sum(p."folioAmount") FILTER (WHERE (r."checkOut"::date + ${agency.paymentTermDays}::int) <= ${today}::date), 0) AS "dueNow"
      FROM "Payment" p
      JOIN "Reservation" r ON r."id" = p."reservationId"
      WHERE p."hotelId" = ${hotelId}
        AND r."hotelId" = ${hotelId}
        AND r."agencyId" = ${agencyId}
        AND r."deletedAt" IS NULL
        AND p."deletedAt" IS NULL
        AND p."status" = 'POSTED'
        AND p."method" = 'AGENCY'
        AND r."checkIn" >= ${fromDate}
        AND r."checkIn" < ${toExclusive}`,
  ]);

  const rows = /** @type {any[]} */ (byStatus).map((row) => ({
    status: row.status,
    reservations: row.reservations,
    nights: row.nights,
    total: money(row.total),
    commission: money(row.commission),
    cancellationFees: money(row.cancellationFees),
    noShowFees: money(row.noShowFees),
  }));
  const sold = rows.filter((row) => SOLD_STATUSES.includes(row.status));
  const sum = (key) => toMoneyString(sold.reduce((acc, row) => acc.plus(toDecimal(row[key])), toDecimal(0)));
  const soldTotal = sum('total');
  const soldCommission = sum('commission');
  const [transferred, dueNow] = [money(/** @type {any[]} */ (account)[0]?.transferred ?? 0), money(/** @type {any[]} */ (account)[0]?.dueNow ?? 0)];

  return {
    agency: { id: agency.id, code: agency.code, name: agency.name, status: agency.status, commissionPct: money(agency.commissionPct), paymentTermDays: agency.paymentTermDays },
    currency: hotel.currency,
    businessDate: today,
    period,
    sold: {
      reservations: sold.reduce((acc, row) => acc + row.reservations, 0),
      nights: sold.reduce((acc, row) => acc + row.nights, 0),
      total: soldTotal,
      commission: soldCommission,
      net: toMoneyString(toDecimal(soldTotal).minus(toDecimal(soldCommission))),
    },
    byStatus: rows,
    fees: {
      cancellation: toMoneyString(rows.reduce((acc, row) => acc.plus(toDecimal(row.cancellationFees)), toDecimal(0))),
      noShow: toMoneyString(rows.reduce((acc, row) => acc.plus(toDecimal(row.noShowFees)), toDecimal(0))),
    },
    account: {
      transferred,
      dueNow,
      notDue: toMoneyString(toDecimal(transferred).minus(toDecimal(dueNow))),
    },
  };
}

/**
 * Acentenin rezervasyonları (sayfalı; en yeni giriş önce): cari ekranının
 * tablosu. Resepsiyonun rezervasyon listesi izni olmayan muhasebe de görür
 * (`agencies.view`); misafirin yalnızca adı gelir.
 *
 * @param {string} hotelId
 * @param {string} agencyId
 * @param {{ page: number, pageSize: number, status?: string, from?: Date, to?: Date, search?: string }} query
 */
export async function listAgencyReservations(hotelId, agencyId, query) {
  const [agency, hotel] = await Promise.all([
    prisma.agency.findFirst({ where: { id: agencyId, hotelId }, select: { id: true, paymentTermDays: true } }),
    getHotelSettings(hotelId),
  ]);
  if (!agency) throw new NotFoundError('Acente bulunamadı');

  const and = [];
  if (query.status) and.push({ status: query.status });
  if (query.from) and.push({ checkIn: { gte: query.from } });
  if (query.to) and.push({ checkIn: { lt: new Date(query.to.getTime() + DAY_MS) } });
  and.push(...(await reservationSearchConditions(hotelId, query.search, hotel)));
  const where = { hotelId, agencyId, ...(and.length ? { AND: and } : {}) };
  const orderBy = [{ checkIn: 'desc' }, { id: 'desc' }];

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
        boardType: true,
        totalPrice: true,
        agencyCommissionPct: true,
        createdAt: true,
        guest: { select: { id: true, firstName: true, lastName: true } },
        roomType: { select: { code: true, name: true } },
        room: { select: { number: true } },
      },
    }),
    // Sınırlı sayım: bütün tabloyu saymak yerine "2000+".
    prisma.reservation.count({ where, orderBy, take: RESERVATION_COUNT_CAP + 1 }),
  ]);
  const totalCapped = counted > RESERVATION_COUNT_CAP;
  const page = buildPage(
    rows.map((row) => ({
      id: row.id,
      confirmationCode: row.confirmationCode,
      status: row.status,
      guestName: guestFullName(row.guest),
      roomType: row.roomType,
      roomNumber: row.room?.number ?? null,
      boardType: row.boardType,
      checkIn: toIsoDay(row.checkIn),
      checkOut: toIsoDay(row.checkOut),
      nights: Math.round((Date.parse(toIsoDay(row.checkOut)) - Date.parse(toIsoDay(row.checkIn))) / DAY_MS),
      totalPrice: money(row.totalPrice),
      commission: commissionAmount(money(row.totalPrice), row.agencyCommissionPct ?? 0),
      // Vade: çıkış günü + acentenin vadesi (açılış anındaki vade değil, kartın güncel vadesi).
      dueDate: paymentDueDay(row.checkOut, agency.paymentTermDays),
      createdAt: iso(row.createdAt),
    })),
    totalCapped ? RESERVATION_COUNT_CAP : counted,
    query,
  );
  return { ...page, meta: { ...page.meta, totalCapped, currency: hotel.currency } };
}
