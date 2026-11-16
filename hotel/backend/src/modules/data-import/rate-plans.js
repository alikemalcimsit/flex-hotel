import { rangesOverlapClosed, toIsoDay } from '@hotelos/core';
import { BOARD_TYPE_LABELS, ratePlanImportRowSchema } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { dedupeErrors } from './guests.js';

/**
 * Fiyat planı içe aktarma (modül 26). Oda tipi kodla ya da adla bulunur. Aynı oda tipi + pansiyonda tarihi çakışan plan
 * (sistemde — kapalı planlar dahil, M28'in EXCLUDE kuralı — ya da dosyada) satırı **reddeder**; mevcut fiyat habersiz
 * değişmez (kullanıcı kararı).
 */

const key = (text) => String(text).trim().toLocaleLowerCase('tr-TR');
const dayDate = (day) => new Date(`${day}T00:00:00.000Z`);
const DAY_LABEL = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** @param {{ startDate: string | Date, endDate: string | Date }} plan */
const rangeText = (plan) => `${DAY_LABEL.format(new Date(plan.startDate))} – ${DAY_LABEL.format(new Date(plan.endDate))}`;

/**
 * @param {string} hotelId @param {Array<Record<string, unknown>>} rows
 */
export async function checkRatePlans(hotelId, rows) {
  const roomTypes = await prisma.roomType.findMany({ where: { hotelId, deletedAt: null }, select: { id: true, code: true, name: true } });
  const byKey = new Map([...roomTypes.map((type) => [key(type.code), type]), ...roomTypes.map((type) => [key(type.name), type])]);
  const existing = await prisma.ratePlan.findMany({
    where: { hotelId, deletedAt: null },
    select: { id: true, name: true, roomTypeId: true, boardType: true, startDate: true, endDate: true },
  });

  const accepted = [];
  return rows.map((raw, index) => {
    const parsed = ratePlanImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      return { index, status: 'ERROR', errors: dedupeErrors(parsed.error.issues.map((issue) => ({ field: String(issue.path[0] ?? ''), message: issue.message }))), note: null, preview: null, data: null };
    }
    const row = parsed.data;
    const roomType = byKey.get(key(row.roomType));
    const preview = { roomTypeName: roomType?.name ?? row.roomType, name: row.name, boardType: row.boardType, startDate: row.startDate, endDate: row.endDate, price: row.price };
    if (!roomType) return { index, status: 'ERROR', errors: [{ field: 'roomType', message: `"${row.roomType}" adlı / kodlu oda tipi yok` }], note: null, preview, data: null };

    const candidate = { roomTypeId: roomType.id, boardType: row.boardType, startDate: dayDate(row.startDate), endDate: dayDate(row.endDate) };
    const sameSlot = (plan) => plan.roomTypeId === candidate.roomTypeId && plan.boardType === candidate.boardType && rangesOverlapClosed(plan, candidate);
    const board = BOARD_TYPE_LABELS[row.boardType] ?? row.boardType;
    const clash = existing.find(sameSlot);
    if (clash) {
      return { index, status: 'ERROR', errors: [{ field: 'startDate', message: `Mevcut "${clash.name}" planıyla (${rangeText(clash)}, ${board}) çakışıyor` }], note: null, preview, data: null };
    }
    const fileClash = accepted.find((entry) => sameSlot(entry.candidate));
    if (fileClash) {
      return { index, status: 'ERROR', errors: [{ field: 'startDate', message: `Dosyadaki ${fileClash.index + 2}. satırla (${board}) çakışıyor` }], note: null, preview, data: null };
    }
    accepted.push({ index, candidate });
    return { index, status: 'OK', errors: [], note: null, preview, data: { ...row, roomTypeId: roomType.id, roomTypeName: roomType.name } };
  });
}

/**
 * Planları yazar; her plan için ayar olayı (fiyat önbelleği tazelensin) ve tek bir `rate.changed`.
 * @param {any} tx @param {(name: string, payload: object) => Promise<void>} stage @param {string} hotelId @param {any[]} rows
 */
export async function writeRatePlans(tx, stage, hotelId, rows) {
  const created = [];
  for (const row of rows) {
    const plan = await tx.ratePlan.create({
      data: {
        hotelId,
        roomTypeId: row.roomTypeId,
        name: row.name,
        boardType: row.boardType,
        startDate: dayDate(row.startDate),
        endDate: dayDate(row.endDate),
        price: row.price,
        baseOccupancy: row.baseOccupancy ?? 2,
        extraAdultRate: row.extraAdultRate ?? '0',
        childRate: row.childRate ?? '0',
        minStay: row.minStay,
      },
    });
    await recordAudit(tx, { hotelId, entity: 'RatePlan', entityId: plan.id, action: 'CREATE', after: { name: row.name, roomType: row.roomTypeName, boardType: row.boardType, startDate: row.startDate, endDate: row.endDate, price: row.price, source: 'Excel' } });
    await stage('settings.rate_plan.created', { hotelId, id: plan.id, label: row.name });
    created.push(plan);
  }
  if (created.length > 0) {
    await stage('rate.changed', {
      hotelId,
      roomTypeIds: [...new Set(created.map((plan) => plan.roomTypeId))],
      from: created.map((plan) => toIsoDay(plan.startDate)).sort()[0],
      to: created.map((plan) => toIsoDay(plan.endDate)).sort().at(-1),
      reason: `Excel ile ${created.length} fiyat planı yüklendi`,
    });
  }
  return created.length;
}
