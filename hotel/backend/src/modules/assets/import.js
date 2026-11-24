import { randomUUID } from 'node:crypto';
import { currentActor } from '@hotelos/core';
import { assetCode, assetImportRowSchema, fromCents, toCents } from '@hotelos/hotel-contracts';
import { ValidationError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { assetFinancialData } from './assets.js';
import { businessToday, employeeLabel, nextSequence, prisma, roomLabel } from './shared.js';

/**
 * Excel ile toplu demirbaş yükleme (modül 46; açılışta yüzlerce kart). Tarayıcı dosyayı okur, satırları metin olarak
 * gönderir; sunucu her satırı sözleşmenin sıkı şemasıyla doğrular ve adları kayda çevirir: kategori (ad), konum (oda
 * no — "Oda 101" de olur — ya da alan adı), zimmet (sicil no).
 *
 * - **Önizleme** (`dryRun`) yazmaz; satır satır hata ve çözülmüş adları döner.
 * - **Yükleme** ya hep ya hiç: tek hatalı satırda hiçbir kart açılmaz. Kartların `requestId`'si "yükleme:satır" —
 *   aynı yükleme ikinci kez gönderilirse yeni kart açılmaz, önceki sonuç döner.
 */

/** "Oda 101" / "oda101" → "101". @param {string} text */
const roomNumberOf = (text) => text.replace(/^oda\s*/i, '').trim();
const key = (text) => text.trim().toLocaleLowerCase('tr-TR');

/** Satırların çözüleceği sözlükler. @param {string} hotelId */
async function loadLookups(hotelId) {
  const [categories, areas, rooms, employees] = await Promise.all([
    prisma.assetCategory.findMany({ where: { hotelId, isActive: true }, select: { id: true, name: true, usefulLifeYears: true } }),
    prisma.assetArea.findMany({ where: { hotelId, isActive: true }, select: { id: true, name: true } }),
    prisma.room.findMany({ where: { hotelId, deletedAt: null }, select: { id: true, number: true } }),
    prisma.employee.findMany({ where: { hotelId, status: 'ACTIVE' }, select: { id: true, code: true, firstName: true, lastName: true } }),
  ]);
  return {
    categories: new Map(categories.map((row) => [key(row.name), row])),
    areas: new Map(areas.map((row) => [key(row.name), row])),
    rooms: new Map(rooms.map((row) => [key(row.number), row])),
    employees: new Map(employees.map((row) => [key(row.code), row])),
  };
}

/**
 * Tek satırın doğrulaması + adların çözümü.
 * @param {Record<string, string>} raw
 * @param {Awaited<ReturnType<typeof loadLookups>>} lookups
 * @param {{ day: string, year: number }} today
 */
function checkRow(raw, lookups, today) {
  const parsed = assetImportRowSchema.safeParse(raw);
  if (!parsed.success) {
    const seen = new Set();
    const errors = parsed.error.issues
      .map((issue) => ({ field: String(issue.path[0] ?? ''), message: issue.message }))
      .filter((error) => !seen.has(error.field) && seen.add(error.field));
    return { errors, row: null };
  }
  const row = parsed.data;
  const errors = [];
  const category = lookups.categories.get(key(row.category));
  if (!category) errors.push({ field: 'category', message: `"${row.category}" adlı etkin kategori yok` });
  const room = lookups.rooms.get(key(roomNumberOf(row.location)));
  const area = room ? null : lookups.areas.get(key(row.location));
  if (!room && !area) errors.push({ field: 'location', message: `"${row.location}" ne bir oda numarası ne de tanımlı bir alan` });
  const employee = row.employeeCode ? lookups.employees.get(key(row.employeeCode)) : null;
  if (row.employeeCode && !employee) errors.push({ field: 'employeeCode', message: `"${row.employeeCode}" sicil nolu çalışan personel yok` });
  if (row.purchaseDate > today.day) errors.push({ field: 'purchaseDate', message: 'Alış tarihi bugünden sonra olamaz' });
  if (row.openingThroughYear != null && row.openingThroughYear > today.year) errors.push({ field: 'openingThroughYear', message: 'Önceki amortisman yılı bu yıldan sonra olamaz' });
  if (errors.length > 0) return { errors, row: null };
  return {
    errors,
    row: {
      ...row,
      category,
      roomId: room?.id ?? null,
      areaId: area?.id ?? null,
      locationLabel: room ? roomLabel(room) : area.name,
      employee,
      usefulLifeYears: row.usefulLifeYears ?? category.usefulLifeYears,
    },
  };
}

/** @param {any} row çözülmüş satır */
const previewOf = (row) => ({
  name: row.name,
  categoryName: row.category.name,
  locationLabel: row.locationLabel,
  employeeName: row.employee ? employeeLabel(row.employee) : null,
  cost: row.cost,
  purchaseDate: row.purchaseDate,
  usefulLifeYears: row.usefulLifeYears,
});

/**
 * @param {string} hotelId
 * @param {{ requestId: string, dryRun: boolean, rows: Record<string, string>[] }} input `importAssetsSchema`
 */
export async function importAssets(hotelId, input) {
  const [lookups, today] = await Promise.all([loadLookups(hotelId), businessToday(hotelId)]);
  const checked = input.rows.map((raw) => checkRow(raw, lookups, today));
  const valid = checked.filter((entry) => entry.row);
  const report = {
    dryRun: input.dryRun,
    created: 0,
    rows: checked.map((entry, index) => ({ index, ok: Boolean(entry.row), errors: entry.errors, preview: entry.row ? previewOf(entry.row) : null })),
    summary: {
      total: checked.length,
      valid: valid.length,
      invalid: checked.length - valid.length,
      totalCost: fromCents(valid.reduce((sum, entry) => sum + toCents(entry.row.cost), 0n)),
    },
  };
  if (input.dryRun) return report;
  if (report.summary.invalid > 0) throw new ValidationError(`${report.summary.invalid} satırda hata var; önizlemedeki hataları düzeltip yeniden yükleyin`);

  const prefix = `${input.requestId}:`;
  const already = await prisma.asset.count({ where: { hotelId, requestId: { startsWith: prefix } } });
  if (already > 0) return { ...report, created: already };

  const actor = currentActor();
  const created = await writeWithEvents(async (tx, stage) => {
    const first = await nextSequence(tx, hotelId, 'ASSET', 0, valid.length);
    const assets = valid.map(({ row }, index) => ({
      id: randomUUID(),
      hotelId,
      code: assetCode(first + index),
      requestId: `${prefix}${index}`,
      name: row.name,
      categoryId: row.category.id,
      brand: row.brand,
      model: row.model,
      serialNumber: row.serialNumber,
      supplierName: row.supplierName,
      invoiceNumber: row.invoiceNumber,
      note: row.note,
      roomId: row.roomId,
      areaId: row.areaId,
      employeeId: row.employee?.id ?? null,
      assignedAt: row.employee ? new Date() : null,
      createdBy: actor,
      ...assetFinancialData(row, row.usefulLifeYears),
    }));
    await tx.asset.createMany({ data: assets });
    const movement = (asset, kind, toLabel) => ({ id: randomUUID(), hotelId, assetId: asset.id, kind, toLabel, note: 'Excel ile yüklendi', actor });
    await tx.assetMovement.createMany({
      data: assets.flatMap((asset, index) => {
        const { row } = valid[index];
        return [movement(asset, 'CREATED', row.locationLabel), ...(row.employee ? [movement(asset, 'ASSIGNED', employeeLabel(row.employee))] : [])];
      }),
    });
    await stage('asset.changed', { hotelId, change: 'IMPORTED', assetIds: assets.map((asset) => asset.id) });
    return assets.length;
  });
  return { ...report, created };
}
