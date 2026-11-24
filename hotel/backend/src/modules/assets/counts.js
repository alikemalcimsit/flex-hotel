import { currentActor } from '@hotelos/core';
import { MAX_ASSET_COUNT_LIST, assetCountNumber, parseAssetCode } from '@hotelos/hotel-contracts';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { lockAssetCounts, lockAssets } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { businessToday, locationLabel, locationNamer, nextSequence, prisma, resolveLocation } from './shared.js';

/**
 * Demirbaş sayımı (modül 46).
 *
 * - **Açılış:** kapsamdaki (tüm otel, bir alan ya da bir oda) kullanımdaki kartlar o anki yerleriyle "beklenen" olarak
 *   dondurulur — sayım sürerken taşınan kart listeyi kaydırmaz.
 * - **Okutma:** sayımcı "şu an buradayım" der ve etiketleri okutur (el okuyucusu klavye gibi yazar; QR bağlantısı da
 *   kod da olur). Sonuç: yerinde, başka yerde, kapsam dışı (fazla), zaten okutulmuş, elden çıkarılmış ya da
 *   bilinmeyen kod. Birden çok sayımcı aynı anda okutur (sayım satırı paylaşımlı kilitlenir).
 * - **Kapanış:** başka yerde ya da kapsam dışında bulunanlar istenirse bulunduğu yere taşınır (hareket geçmişine
 *   sayım numarasıyla); eksikler listede kalır — elden çıkarma ayrı ve yetkili işlemdir.
 *
 * Kilit sırası: sayım → demirbaş.
 */

/** Satır durumu sıralaması: önce eksikler. */
const STATE_ORDER = Object.freeze({ MISSING: 0, MISPLACED: 1, EXTRA: 2, FOUND: 3 });
/** Bir olayda en fazla kart kimliği (katalog sınırı). */
const EVENT_ASSET_CHUNK = 1000;

/** @param {{ expected: boolean, foundAt: Date | null, expectedRoomId: string | null, expectedAreaId: string | null, foundRoomId: string | null, foundAreaId: string | null }} item */
function itemState(item) {
  if (!item.expected) return 'EXTRA';
  if (!item.foundAt) return 'MISSING';
  return item.foundRoomId === item.expectedRoomId && item.foundAreaId === item.expectedAreaId ? 'FOUND' : 'MISPLACED';
}

/** Sayımların satır özetleri. @param {any} client @param {string[]} countIds */
async function countTotals(client, countIds) {
  if (countIds.length === 0) return new Map();
  const rows = await client.$queryRaw`
    SELECT "countId",
           count(*) FILTER (WHERE "expected")::int AS "expected",
           count(*) FILTER (WHERE "expected" AND "foundAt" IS NOT NULL
             AND "foundRoomId" IS NOT DISTINCT FROM "expectedRoomId" AND "foundAreaId" IS NOT DISTINCT FROM "expectedAreaId")::int AS "found",
           count(*) FILTER (WHERE "expected" AND "foundAt" IS NOT NULL
             AND ("foundRoomId" IS DISTINCT FROM "expectedRoomId" OR "foundAreaId" IS DISTINCT FROM "expectedAreaId"))::int AS "misplaced",
           count(*) FILTER (WHERE "expected" AND "foundAt" IS NULL)::int AS "missing",
           count(*) FILTER (WHERE NOT "expected")::int AS "extra"
    FROM "AssetCountItem" WHERE "countId" = ANY(${countIds}::text[]) GROUP BY "countId"`;
  const byId = new Map(rows.map((row) => [row.countId, row]));
  return new Map(
    countIds.map((id) => {
      const row = byId.get(id);
      return [id, { expected: row?.expected ?? 0, found: row?.found ?? 0, misplaced: row?.misplaced ?? 0, missing: row?.missing ?? 0, extra: row?.extra ?? 0 }];
    }),
  );
}

const COUNT_SELECT = Object.freeze({
  id: true,
  number: true,
  title: true,
  roomId: true,
  areaId: true,
  status: true,
  expectedCount: true,
  openedBy: true,
  openedAt: true,
  closedBy: true,
  closedAt: true,
  transferredCount: true,
  cancelReason: true,
  note: true,
  updatedAt: true,
  room: { select: { number: true } },
  area: { select: { name: true } },
});

const scopeLabel = (count) => locationLabel(count) ?? 'Tüm otel';

/**
 * @param {string} hotelId
 * @param {{ status?: string, page: number, pageSize: number }} query
 */
export async function listCounts(hotelId, query) {
  const where = { hotelId, ...(query.status ? { status: query.status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.assetCount.findMany({ where, select: COUNT_SELECT, orderBy: { openedAt: 'desc' }, ...toSkipTake(query) }),
    prisma.assetCount.count({ where }),
  ]);
  const totals = await countTotals(prisma, rows.map((row) => row.id));
  const items = rows.map((row) => {
    const sums = totals.get(row.id);
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      scopeLabel: scopeLabel(row),
      status: row.status,
      expectedCount: row.expectedCount,
      foundCount: sums.found + sums.misplaced,
      missingCount: sums.missing,
      extraCount: sums.extra,
      openedBy: row.openedBy,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
  return buildPage(items, total, query);
}

/**
 * Sayım ekranı: özet + satırlar (önce eksikler; en fazla `MAX_ASSET_COUNT_LIST`).
 * @param {string} hotelId @param {string} countId
 */
export async function getCount(hotelId, countId) {
  const count = await prisma.assetCount.findFirst({ where: { id: countId, hotelId }, select: COUNT_SELECT });
  if (!count) throw new NotFoundError('Sayım bulunamadı');
  const items = await prisma.assetCountItem.findMany({
    where: { countId },
    select: {
      assetId: true,
      expected: true,
      expectedRoomId: true,
      expectedAreaId: true,
      foundRoomId: true,
      foundAreaId: true,
      foundAt: true,
      foundBy: true,
      asset: { select: { code: true, name: true, category: { select: { name: true } } } },
    },
  });
  const name = await locationNamer(prisma, hotelId, {
    roomIds: items.flatMap((item) => [item.expectedRoomId, item.foundRoomId]),
    areaIds: items.flatMap((item) => [item.expectedAreaId, item.foundAreaId]),
  });
  const rows = items
    .map((item) => ({
      assetId: item.assetId,
      code: item.asset.code,
      name: item.asset.name,
      categoryName: item.asset.category.name,
      expected: item.expected,
      expectedLabel: item.expected ? name(item.expectedRoomId, item.expectedAreaId) : null,
      foundLabel: item.foundAt ? name(item.foundRoomId, item.foundAreaId) : null,
      foundAt: item.foundAt?.toISOString() ?? null,
      foundBy: item.foundBy,
      state: itemState(item),
    }))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.code.localeCompare(b.code));
  const totals = (await countTotals(prisma, [countId])).get(countId);
  return {
    id: count.id,
    number: count.number,
    title: count.title,
    scope: { roomId: count.roomId, areaId: count.areaId, label: scopeLabel(count) },
    status: count.status,
    expectedCount: count.expectedCount,
    openedBy: count.openedBy,
    openedAt: count.openedAt.toISOString(),
    closedBy: count.closedBy,
    closedAt: count.closedAt?.toISOString() ?? null,
    transferredCount: count.transferredCount,
    cancelReason: count.cancelReason,
    note: count.note,
    updatedAt: count.updatedAt.toISOString(),
    totals,
    items: rows.slice(0, MAX_ASSET_COUNT_LIST),
    itemsTruncated: rows.length > MAX_ASSET_COUNT_LIST,
  };
}

/**
 * Sayım aç: kapsamdaki kullanımdaki kartlar beklenen olarak dondurulur.
 * @param {string} hotelId @param {{ title?: string | null, roomId?: string | null, areaId?: string | null }} input
 */
export async function createCount(hotelId, input) {
  const today = await businessToday(hotelId);
  const actor = currentActor();
  const id = await writeWithEvents(async (tx, stage) => {
    const scope = input.roomId || input.areaId ? await resolveLocation(tx, hotelId, input) : { roomId: null, areaId: null };
    const expected = await tx.asset.findMany({
      where: { hotelId, status: 'ACTIVE', ...(scope.roomId ? { roomId: scope.roomId } : {}), ...(scope.areaId ? { areaId: scope.areaId } : {}) },
      select: { id: true, roomId: true, areaId: true },
    });
    const number = assetCountNumber(today.year, await nextSequence(tx, hotelId, 'COUNT', today.year));
    const count = await tx.assetCount.create({
      data: { hotelId, number, title: input.title ?? null, roomId: scope.roomId, areaId: scope.areaId, expectedCount: expected.length, openedBy: actor },
      select: { id: true },
    });
    await tx.assetCountItem.createMany({
      data: expected.map((asset) => ({ hotelId, countId: count.id, assetId: asset.id, expected: true, expectedRoomId: asset.roomId, expectedAreaId: asset.areaId })),
    });
    await stage('asset.count.changed', { hotelId, countId: count.id, change: 'OPENED' });
    return count.id;
  });
  return getCount(hotelId, id);
}

/** Açık sayım (kilit çağıran tarafta). @param {any} tx */
async function openCount(tx, hotelId, countId) {
  const count = await tx.assetCount.findFirst({ where: { id: countId, hotelId }, select: { id: true, number: true, status: true } });
  if (!count) throw new NotFoundError('Sayım bulunamadı');
  if (count.status !== 'OPEN') throw new ConflictError('Sayım kapanmış; okutma ve değişiklik yapılamaz', 'COUNT_CLOSED');
  return count;
}

/**
 * Etiket okut. Bilinmeyen / elden çıkarılmış / zaten okutulmuş kod hata değil sonuçtur: okutma akışı durmaz.
 * @param {string} hotelId @param {string} countId
 * @param {{ code: string, roomId?: string | null, areaId?: string | null }} input
 */
export async function scanCount(hotelId, countId, input) {
  const code = parseAssetCode(input.code);
  const actor = currentActor();
  const outcome = await writeWithEvents(async (tx, stage) => {
    await lockAssetCounts(tx, hotelId, [countId], { shared: true });
    await openCount(tx, hotelId, countId);
    const here = await resolveLocation(tx, hotelId, input);
    if (!code) return { result: 'UNKNOWN', code: null, asset: null, message: 'Okutulan metinde demirbaş kodu yok' };
    const asset = await tx.asset.findFirst({ where: { hotelId, code }, select: { id: true, code: true, name: true, status: true } });
    if (!asset) return { result: 'UNKNOWN', code, asset: null, message: `${code} sistemde kayıtlı değil` };
    const brief = { id: asset.id, code: asset.code, name: asset.name, expectedLabel: null };
    if (asset.status !== 'ACTIVE') return { result: 'DISPOSED', code, asset: brief, message: `${code} elden çıkarılmış bir demirbaş` };

    const item = await tx.assetCountItem.findUnique({ where: { countId_assetId: { countId, assetId: asset.id } } });
    const name = await locationNamer(tx, hotelId, { roomIds: [item?.expectedRoomId, item?.foundRoomId], areaIds: [item?.expectedAreaId, item?.foundAreaId] });
    const expectedLabel = item?.expected ? name(item.expectedRoomId, item.expectedAreaId) : null;
    if (item?.foundAt) {
      return { result: 'DUPLICATE', code, asset: { ...brief, expectedLabel }, message: `${code} zaten okutuldu (${name(item.foundRoomId, item.foundAreaId)})` };
    }
    const found = { foundRoomId: here.roomId, foundAreaId: here.areaId, foundAt: new Date(), foundBy: actor };
    const duplicate = { result: 'DUPLICATE', code, asset: { ...brief, expectedLabel }, message: `${code} az önce başka bir okutmayla işaretlendi` };
    let result;
    if (item) {
      // Aynı anda iki sayımcı aynı etiketi okuttuysa ilki kazanır.
      const marked = await tx.assetCountItem.updateMany({ where: { id: item.id, foundAt: null }, data: found });
      if (marked.count === 0) return duplicate;
      result = here.roomId === item.expectedRoomId && here.areaId === item.expectedAreaId ? 'FOUND' : 'MISPLACED';
    } else {
      const inserted = await tx.assetCountItem.createMany({ data: [{ hotelId, countId, assetId: asset.id, expected: false, ...found }], skipDuplicates: true });
      if (inserted.count === 0) return duplicate;
      result = 'EXTRA';
    }
    await stage('asset.count.changed', { hotelId, countId, change: 'SCANNED' });
    const messages = {
      FOUND: `${code} yerinde`,
      MISPLACED: `${code} başka yerde bulundu (kayıtlı yeri: ${expectedLabel})`,
      EXTRA: `${code} bu sayımın kapsamı dışında kayıtlı`,
    };
    return { result, code, asset: { ...brief, expectedLabel }, message: messages[result] };
  });
  const totals = (await countTotals(prisma, [countId])).get(countId);
  return { ...outcome, totals };
}

/**
 * Sayımı kapat; istenirse başka yerde / kapsam dışında bulunan kullanımdaki kartları bulunduğu yere taşı.
 * @param {string} hotelId @param {string} countId
 * @param {{ expectedUpdatedAt: Date, applyTransfers: boolean, note?: string | null }} input
 */
export async function closeCount(hotelId, countId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await lockAssetCounts(tx, hotelId, [countId]);
    const count = await openCount(tx, hotelId, countId);
    const moved = input.applyTransfers ? await applyTransfers(tx, hotelId, count, actor) : [];
    await updateWithVersionCheck(
      tx,
      'assetCount',
      { id: countId, hotelId },
      input.expectedUpdatedAt,
      { status: 'CLOSED', closedAt: new Date(), closedBy: actor, transferredCount: moved.length, note: input.note ?? null },
      'Sayım bulunamadı',
    );
    await stage('asset.count.changed', { hotelId, countId, change: 'CLOSED' });
    for (let start = 0; start < moved.length; start += EVENT_ASSET_CHUNK) {
      await stage('asset.changed', { hotelId, change: 'TRANSFERRED', assetIds: moved.slice(start, start + EVENT_ASSET_CHUNK) });
    }
  });
  return getCount(hotelId, countId);
}

/**
 * Bulunduğu yer kartın şimdiki yerinden farklı olan kullanımdaki kartları taşır (kartlar kilitlenerek).
 * @param {any} tx @param {string} hotelId @param {{ id: string, number: string }} count @param {string} actor
 * @returns {Promise<string[]>} taşınan kart kimlikleri
 */
async function applyTransfers(tx, hotelId, count, actor) {
  const found = await tx.assetCountItem.findMany({
    where: { countId: count.id, foundAt: { not: null } },
    select: { assetId: true, foundRoomId: true, foundAreaId: true },
  });
  await lockAssets(tx, hotelId, found.map((item) => item.assetId));
  const assets = await tx.asset.findMany({
    where: { id: { in: found.map((item) => item.assetId) }, status: 'ACTIVE' },
    select: { id: true, roomId: true, areaId: true, room: { select: { number: true } }, area: { select: { name: true } } },
  });
  const current = new Map(assets.map((asset) => [asset.id, asset]));
  const moves = found.filter((item) => {
    const asset = current.get(item.assetId);
    return asset && (asset.roomId !== item.foundRoomId || asset.areaId !== item.foundAreaId);
  });
  if (moves.length === 0) return [];
  const name = await locationNamer(tx, hotelId, { roomIds: moves.map((item) => item.foundRoomId), areaIds: moves.map((item) => item.foundAreaId) });
  for (const item of moves) {
    await tx.asset.update({ where: { id: item.assetId }, data: { roomId: item.foundRoomId, areaId: item.foundAreaId } });
  }
  await tx.assetMovement.createMany({
    data: moves.map((item) => ({
      hotelId,
      assetId: item.assetId,
      kind: 'TRANSFERRED',
      fromLabel: locationLabel(current.get(item.assetId)),
      toLabel: name(item.foundRoomId, item.foundAreaId),
      note: `Sayım ${count.number}`,
      countId: count.id,
      actor,
    })),
  });
  return moves.map((item) => item.assetId);
}

/**
 * Sayımı iptal et (kartlara dokunulmaz).
 * @param {string} hotelId @param {string} countId @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function cancelCount(hotelId, countId, input) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await lockAssetCounts(tx, hotelId, [countId]);
    await openCount(tx, hotelId, countId);
    await updateWithVersionCheck(
      tx,
      'assetCount',
      { id: countId, hotelId },
      input.expectedUpdatedAt,
      { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: actor, cancelReason: input.reason },
      'Sayım bulunamadı',
    );
    await stage('asset.count.changed', { hotelId, countId, change: 'CANCELLED' });
  });
  return getCount(hotelId, countId);
}

