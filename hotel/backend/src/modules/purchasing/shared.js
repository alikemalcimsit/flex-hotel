import { toDecimal, toMoneyString } from '@hotelos/core';
import { prisma } from '../../db.js';
import { lockPurchaseRequests } from '../../lib/locks.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { requestStatusOf, roundStatusOf } from './rules.js';

export { prisma };
export { hotelContext } from '../banquet/shared.js';

/**
 * Satın almanın ortak parçaları (modül 45): belge numarası, politika, metin biçimleri ve zincirin
 * durum tazelemeleri — talep durumu satırlarından, tur durumu satırlarından türetilir; reddedilen /
 * iptal edilen siparişin satırları tura geri döner.
 */

/** Politika satırı yoksa geçerli değerler (Prisma varsayılanlarıyla aynı). */
export const DEFAULT_PURCHASE_SETTINGS = Object.freeze({ orderApprovalAmount: '50000.00', defaultTaxRatePct: '10' });

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
export const dayText = (value) => (value ? value.toISOString().slice(0, 10) : null);
/** @param {string} text */
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);
/** @param {unknown} value */
export const money = (value) => toMoneyString(String(value ?? 0));
/** Miktar / fiyat / oran: sondaki sıfırlar atılmış metin. @param {unknown} value */
export const plain = (value) => toDecimal(String(value ?? 0)).toString();
/** @param {unknown} value */
export const optionalPlain = (value) => (value === null || value === undefined ? null : plain(value));

const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Onay kuyruğu / uyarı metni için: "12.345,60 TRY". @param {unknown} amount @param {string} currency */
export const priced = (amount, currency) => `${trMoney.format(Number(money(amount)))} ${currency}`;

/**
 * Sıradaki belge numarası (otel × önek × yıl): tek ifadede artırılır, eşzamanlı iki belge aynı numarayı alamaz.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} prefix @param {number} year
 */
export async function nextNumber(tx, hotelId, prefix, year) {
  const [row] = await tx.$queryRaw`
    INSERT INTO "PurchaseSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, ${prefix}, ${year}, 1)
    ON CONFLICT ("hotelId", "kind", "year") DO UPDATE SET "last" = "PurchaseSequence"."last" + 1
    RETURNING "last"`;
  return `${prefix}-${year}-${String(row.last).padStart(4, '0')}`;
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId
 * @returns {Promise<{ orderApprovalAmount: string, defaultTaxRatePct: string, updatedAt: string | null }>}
 */
export async function loadPurchaseSettings(client, hotelId) {
  const row = await client.purchaseSettings.findUnique({ where: { hotelId } });
  if (!row) return { ...DEFAULT_PURCHASE_SETTINGS, updatedAt: null };
  return { orderApprovalAmount: money(row.orderApprovalAmount), defaultTaxRatePct: plain(row.defaultTaxRatePct), updatedAt: iso(row.updatedAt) };
}

/**
 * Taleplerin durumunu satırlarından yeniden türetir (açık / teklif-siparişte / siparişe döndü) ve
 * değişenleri tek ifadede yazar. Talepler kimlik sırasıyla kilitlenir; iptal edilmiş talebe dokunulmaz.
 *
 * Talep başına olay yayınlanmaz: durum tur / sipariş işleminin sonucudur ve o işlem kendi olayını
 * (`purchase.round.changed` / `purchase.order.changed`, aynı canlı kanal) ve denetim izini bırakır.
 * Bir tur binlerce banket talebini birleştirebilir; talep başına güncelleme + olay ölçekte saniyeler sürerdi.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId @param {string[]} requestIds
 * @returns {Promise<number>} durumu değişen talep sayısı
 */
export async function refreshRequestStatuses(tx, hotelId, requestIds) {
  const ids = [...new Set(requestIds)];
  if (ids.length === 0) return 0;
  await lockPurchaseRequests(tx, hotelId, ids);
  const rows = await tx.$queryRaw`
    SELECT r."id", r."status"::text AS "status",
           COUNT(l."id")::int AS "lines", COUNT(l."roundLineId")::int AS "inRound", COUNT(rl."orderLineId")::int AS "ordered"
    FROM "PurchaseRequest" r
    LEFT JOIN "PurchaseRequestLine" l ON l."requestId" = r."id"
    LEFT JOIN "PurchaseRoundLine" rl ON rl."id" = l."roundLineId"
    WHERE r."hotelId" = ${hotelId} AND r."id" = ANY(${ids}::text[])
    GROUP BY r."id"
    ORDER BY r."id"`;
  const changed = rows
    .filter((row) => row.status !== 'CANCELLED')
    .map((row) => ({ id: row.id, status: requestStatusOf({ lines: row.lines, inRound: row.inRound, ordered: row.ordered }), before: row.status }))
    .filter((row) => row.status !== row.before);
  if (changed.length === 0) return 0;
  await tx.$executeRaw`
    UPDATE "PurchaseRequest" AS r SET "status" = v."status"::"PurchaseRequestStatus", "updatedAt" = ${sqlTimestamp(new Date())}
    FROM unnest(${changed.map((row) => row.id)}::text[], ${changed.map((row) => row.status)}::text[]) AS v("id", "status")
    WHERE r."id" = v."id" AND r."hotelId" = ${hotelId}`;
  return changed.length;
}

/**
 * Turun durumunu satırlarından yeniden türetir; değiştiyse yazar (ilk kez "siparişe döndü" olunca an).
 * Tur kilitli olmalı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} roundId
 * @returns {Promise<{ before: string, after: string }>}
 */
export async function refreshRoundStatus(tx, roundId) {
  const round = await tx.purchaseRound.findUnique({
    where: { id: roundId },
    select: { status: true, awardedAt: true, lines: { select: { orderLineId: true, releasedAt: true } } },
  });
  const after = roundStatusOf(round.lines.map((line) => ({ ordered: line.orderLineId !== null, released: line.releasedAt !== null })));
  if (after !== round.status) {
    await tx.purchaseRound.update({ where: { id: roundId }, data: { status: after, ...(after === 'AWARDED' && !round.awardedAt ? { awardedAt: new Date() } : {}) } });
  }
  return { before: round.status, after };
}

/**
 * Reddedilen / iptal edilen siparişin satırlarını tura geri bırakır: tur satırı kazananını ve sipariş
 * bağını kaybeder (yeniden seçilebilir), tur açık durumuna döner, talepler "teklif / siparişte" olur.
 * Tur (varsa) çağıran tarafından **siparişten önce** kilitlenmiş olmalı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage
 * @param {{ hotelId: string, orderId: string, roundId: string | null }} input
 */
export async function releaseOrderLines(tx, stage, { hotelId, orderId, roundId }) {
  if (!roundId) return;
  const lines = await tx.purchaseRoundLine.findMany({
    where: { roundId, orderLine: { orderId } },
    select: { id: true, requestLines: { select: { requestId: true } } },
  });
  if (lines.length === 0) return;
  await tx.purchaseRoundLine.updateMany({ where: { id: { in: lines.map((line) => line.id) } }, data: { orderLineId: null, awardedQuoteLineId: null, awardReason: null } });
  await refreshRoundStatus(tx, roundId);
  // Karşılaştırma ekranındaki sürüm damgası eskisin: kazanan yeniden seçilecek.
  await tx.purchaseRound.update({ where: { id: roundId }, data: { updatedAt: new Date() } });
  await stage('purchase.round.changed', { hotelId, roundId, change: 'REOPENED' });
  await refreshRequestStatuses(tx, hotelId, lines.flatMap((line) => line.requestLines.map((requestLine) => requestLine.requestId)));
}
