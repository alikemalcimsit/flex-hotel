import { depreciationRatePct, depreciationSchedule, fromCents, toCents } from '@hotelos/hotel-contracts';
import { currentActor } from '@hotelos/core';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError } from '../../lib/errors.js';
import { lockAssets } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { businessToday, dayDate, isoDay, money, prisma, yearOf } from './shared.js';

/**
 * Yıllık amortisman tablosu ve yıl kaydı (modül 46; VUK, yıllık doğrusal).
 *
 * - **Tablo:** yıl içinde defterde olan her kart (o yıl ya da önce alınmış; elden çıkarılmamış ya da o yıl / sonra
 *   çıkarılmış): yıl başı birikmiş, yılın payı (kaydedilmişse kayıttan, değilse plandan), yıl sonu birikmiş ve net
 *   değer; kategori ve genel toplam. Gelecek yılın planı ara yılların planını da sayar.
 * - **Yıl kaydı:** yıllar ardışık kaydedilir (ilk kayıt herhangi bir geçmiş / bu yıl); kaydedilen yıl kilitlidir:
 *   kartın finansal alanları değişmez, o yıl ya da öncesine elden çıkarma tarihi yazılamaz. Yalnız son yıl geri alınır
 *   (o yıldan sonra elden çıkarılan kart varsa alınamaz — çıkarmanın dondurduğu net değer o kaydı içerir).
 * - Kayıt kartları kilitler: aynı anda gelen tutar düzeltmesi ya da elden çıkarma kayıtla yarışamaz.
 */

/** Yıl kaydı otel başına sıralı (aynı anda iki kayıt / geri alma olmaz). @param {any} tx @param {string} hotelId */
const lockDepreciation = (tx, hotelId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`asset-depreciation:${hotelId}`}, 0))`;

/** Yılın defterindeki kartlar. @param {string} hotelId @param {number} year */
const yearAssetsWhere = (hotelId, year) => ({
  hotelId,
  purchaseDate: { lt: dayDate(`${year + 1}-01-01`) },
  OR: [{ status: 'ACTIVE' }, { disposedOn: { gte: dayDate(`${year}-01-01`) } }],
});

/**
 * Kartın yıl satırı: yıl başı birikmiş, yılın payı ve kaynağı. Açılış her zaman yıl başına sayılır (açılışın kapsadığı
 * yılda pay yoktur); kaydedilmiş yılda kayıtsız kalan kart (sonradan eklenmiş, tamamen ayrılmış) o yıl pay almaz.
 */
function yearLine(asset, postedRows, year, isPostedYear) {
  const schedule = depreciationSchedule({
    cost: money(asset.cost),
    usefulLifeYears: asset.usefulLifeYears,
    purchaseYear: yearOf(asset.purchaseDate),
    openingAccumulated: money(asset.openingAccumulated),
    openingThroughYear: asset.openingThroughYear,
    posted: postedRows,
    disposedYear: asset.disposedOn ? yearOf(asset.disposedOn) : null,
  });
  let start = 0n;
  let amount = 0n;
  let source = 'NONE';
  for (const row of schedule) {
    if (row.source === 'OPENING' || row.year < year) start += toCents(row.amount);
    else if (row.year === year) {
      amount = toCents(row.amount);
      source = row.source;
    }
  }
  if (isPostedYear && source === 'PLANNED') {
    amount = 0n;
    source = 'NONE';
  }
  return { start, amount, source };
}

/**
 * Yılın tablosu (yazma işlemleri de aynı hesabı transaction içinde kullanır).
 * @param {any} client @param {string} hotelId @param {number} year
 */
async function computeYear(client, hotelId, year) {
  const [run, lastRun, assets, posted] = await Promise.all([
    client.assetDepreciationRun.findUnique({ where: { hotelId_year: { hotelId, year } } }),
    client.assetDepreciationRun.findFirst({ where: { hotelId }, orderBy: { year: 'desc' }, select: { year: true } }),
    client.asset.findMany({
      where: yearAssetsWhere(hotelId, year),
      select: {
        id: true,
        code: true,
        name: true,
        purchaseDate: true,
        cost: true,
        usefulLifeYears: true,
        openingAccumulated: true,
        openingThroughYear: true,
        disposedOn: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { code: 'asc' },
    }),
    client.assetDepreciation.findMany({ where: { hotelId, year: { lte: year } }, select: { assetId: true, year: true, amount: true } }),
  ]);
  const postedByAsset = Map.groupBy(posted, (row) => row.assetId);
  const rows = assets.map((asset) => {
    const postedRows = (postedByAsset.get(asset.id) ?? []).map((row) => ({ year: row.year, amount: money(row.amount) }));
    const line = yearLine(asset, postedRows, year, Boolean(run));
    const cost = toCents(String(asset.cost));
    return { asset, cost, ...line, end: line.start + line.amount };
  });
  return { run, lastPostedYear: lastRun?.year ?? null, rows };
}

/** @param {{ cost: bigint, start: bigint, amount: bigint, end: bigint }[]} rows */
function sumRows(rows) {
  const total = rows.reduce(
    (sum, row) => ({ cost: sum.cost + row.cost, start: sum.start + row.start, amount: sum.amount + row.amount, end: sum.end + row.end }),
    { cost: 0n, start: 0n, amount: 0n, end: 0n },
  );
  return {
    cost: fromCents(total.cost),
    accumulatedStart: fromCents(total.start),
    amount: fromCents(total.amount),
    accumulatedEnd: fromCents(total.end),
    bookValueEnd: fromCents(total.cost - total.end),
  };
}

/** Kaydedilebilir mi; değilse neden. */
function postBlock({ run, lastPostedYear }, year, businessYear) {
  if (run) return `${year} amortismanı kaydedildi`;
  if (year > businessYear) return `${year} henüz gelmedi; gelecek yılın amortismanı kaydedilemez`;
  if (lastPostedYear != null && year < lastPostedYear) return `${lastPostedYear} kaydedilmiş; önceki bir yıl sonradan kaydedilemez`;
  if (lastPostedYear != null && year !== lastPostedYear + 1) return `Önce ${lastPostedYear + 1} amortismanını kaydedin (yıllar sırayla kaydedilir)`;
  return null;
}

/**
 * @param {string} hotelId
 * @param {number} year
 */
export async function getDepreciationTable(hotelId, year) {
  const [table, today] = await Promise.all([computeYear(prisma, hotelId, year), businessToday(hotelId)]);
  const reason = postBlock(table, year, today.year);
  const byCategory = Map.groupBy(table.rows, (row) => row.asset.category.id);
  return {
    year,
    status: table.run ? 'POSTED' : 'OPEN',
    run: table.run ? { postedAt: table.run.postedAt.toISOString(), postedBy: table.run.postedBy, total: money(table.run.total), assetCount: table.run.assetCount } : null,
    lastPostedYear: table.lastPostedYear,
    canPost: reason === null,
    postBlockReason: reason,
    canReverse: Boolean(table.run) && table.lastPostedYear === year,
    totals: sumRows(table.rows),
    categories: [...byCategory.values()]
      .map((rows) => {
        const sums = sumRows(rows);
        return { categoryId: rows[0].asset.category.id, name: rows[0].asset.category.name, count: rows.length, cost: sums.cost, amount: sums.amount, accumulatedEnd: sums.accumulatedEnd, bookValueEnd: sums.bookValueEnd };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    rows: table.rows.map(({ asset, cost, start, amount, end, source }) => ({
      assetId: asset.id,
      code: asset.code,
      name: asset.name,
      categoryName: asset.category.name,
      purchaseDate: isoDay(asset.purchaseDate),
      cost: fromCents(cost),
      usefulLifeYears: asset.usefulLifeYears,
      ratePct: depreciationRatePct(asset.usefulLifeYears),
      accumulatedStart: fromCents(start),
      amount: fromCents(amount),
      accumulatedEnd: fromCents(end),
      bookValueEnd: fromCents(cost - end),
      source,
      disposedOn: isoDay(asset.disposedOn),
    })),
  };
}

/**
 * Yılın amortismanını kaydet: plandaki her pay kart başına satır olur; yıl kilitlenir.
 * @param {string} hotelId @param {{ year: number }} input
 */
export async function postDepreciation(hotelId, { year }) {
  const today = await businessToday(hotelId);
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await lockDepreciation(tx, hotelId);
    const candidates = await tx.asset.findMany({ where: yearAssetsWhere(hotelId, year), select: { id: true } });
    await lockAssets(tx, hotelId, candidates.map((asset) => asset.id));
    const table = await computeYear(tx, hotelId, year);
    const reason = postBlock(table, year, today.year);
    if (reason) throw new ConflictError(reason, 'DEPRECIATION_NOT_POSTABLE');
    const lines = table.rows.filter((row) => row.source === 'PLANNED' && row.amount > 0n);
    const total = fromCents(lines.reduce((sum, row) => sum + row.amount, 0n));
    const run = await tx.assetDepreciationRun.create({ data: { hotelId, year, total, assetCount: lines.length, postedBy: actor }, select: { id: true } });
    await tx.assetDepreciation.createMany({
      data: lines.map((row) => ({ hotelId, runId: run.id, assetId: row.asset.id, year, amount: fromCents(row.amount), accumulatedAfter: fromCents(row.end) })),
    });
    await recordAudit(tx, { hotelId, entity: 'AssetDepreciationRun', entityId: run.id, action: 'CREATE', after: { year, total, assetCount: lines.length } });
    await stage('asset.depreciation.changed', { hotelId, year, change: 'POSTED', total });
  });
  return getDepreciationTable(hotelId, year);
}

/**
 * Son kaydedilen yılı geri al (düzeltme için). O yıldan sonra elden çıkarılmış kart varsa alınamaz.
 * @param {string} hotelId @param {{ year: number }} input
 */
export async function reverseDepreciation(hotelId, { year }) {
  await writeWithEvents(async (tx, stage) => {
    await lockDepreciation(tx, hotelId);
    const run = await tx.assetDepreciationRun.findUnique({ where: { hotelId_year: { hotelId, year } }, select: { id: true, total: true, assetCount: true } });
    if (!run) throw new ConflictError(`${year} amortismanı kaydedilmemiş`, 'DEPRECIATION_NOT_POSTED');
    const last = await tx.assetDepreciationRun.findFirst({ where: { hotelId }, orderBy: { year: 'desc' }, select: { year: true } });
    if (last.year !== year) throw new ConflictError(`Yalnız son kaydedilen yıl (${last.year}) geri alınır`, 'NOT_LAST_YEAR');
    const rows = await tx.assetDepreciation.findMany({ where: { runId: run.id }, select: { assetId: true } });
    await lockAssets(tx, hotelId, rows.map((row) => row.assetId));
    const disposed = await tx.asset.findFirst({ where: { id: { in: rows.map((row) => row.assetId) }, status: 'DISPOSED' }, select: { code: true } });
    if (disposed) {
      throw new ConflictError(`${disposed.code} bu kayıttan sonra elden çıkarıldı (net değeri bu yılın amortismanını içeriyor); ${year} geri alınamaz`, 'DISPOSED_AFTER_POST');
    }
    await tx.assetDepreciationRun.delete({ where: { id: run.id } });
    await recordAudit(tx, { hotelId, entity: 'AssetDepreciationRun', entityId: run.id, action: 'DELETE', before: { year, total: money(run.total), assetCount: run.assetCount } });
    await stage('asset.depreciation.changed', { hotelId, year, change: 'REVERSED', total: money(run.total) });
  });
  return getDepreciationTable(hotelId, year);
}
