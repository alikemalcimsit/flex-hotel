import { GL_ACCOUNT_CLASS_LABELS, fromCents, rollUpTrialBalance, toCents } from '@hotelos/hotel-contracts';
import { unpostedCounts } from './journalize.js';
import { ensureChart, ledgerContext, money, prisma, sortByCode } from './shared.js';

/**
 * Mizan (modül 48): dönem için her hesabın devri (dönem başından önceki borç − alacak), dönem borç / alacak toplamı
 * ve kapanışı; üst hesaplar alt hesapların toplamı. İptal edilen fiş ve ters kaydı ikisi de sayılır (iz kalır,
 * net sıfır). Fişlenmemiş ön muhasebe hareketi varsa sayısı döner — mizan o kayıtları henüz içermez.
 *
 * @param {string} hotelId @param {{ from: string, to: string, onlyActive?: boolean, department?: string }} query
 */
export async function trialBalance(hotelId, query) {
  await ensureChart(hotelId);
  const context = await ledgerContext(hotelId);
  const [accounts, sums, unposted] = await Promise.all([
    prisma.glAccount.findMany({ where: { hotelId }, select: { id: true, code: true, name: true, parentId: true, depth: true, class: true, department: true, isPostable: true, isActive: true } }),
    /** @type {Promise<Array<{ accountId: string, opening: string, debit: string, credit: string }>>} */ (
      prisma.$queryRaw`
        SELECT l."accountId",
               COALESCE(SUM(CASE WHEN l."date" < ${query.from}::date THEN l."debit" - l."credit" ELSE 0 END), 0)::text AS "opening",
               COALESCE(SUM(CASE WHEN l."date" >= ${query.from}::date THEN l."debit" ELSE 0 END), 0)::text AS "debit",
               COALESCE(SUM(CASE WHEN l."date" >= ${query.from}::date THEN l."credit" ELSE 0 END), 0)::text AS "credit"
        FROM "JournalLine" l WHERE l."hotelId" = ${hotelId} AND l."date" <= ${query.to}::date
        GROUP BY l."accountId"`
    ),
    unpostedCounts(hotelId, context.startDate),
  ]);
  const leafSums = new Map(sums.map((row) => [row.accountId, { opening: money(row.opening), debit: money(row.debit), credit: money(row.credit) }]));
  const rolled = rollUpTrialBalance(accounts, leafSums);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  // Departman süzgeci: eşleşen hesaplar ve üstleri kalır.
  const keep = new Set();
  if (query.department) {
    for (const account of accounts) {
      if (account.department !== query.department) continue;
      let cursor = account;
      while (cursor) {
        keep.add(cursor.id);
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
    }
  }
  const rows = sortByCode(accounts)
    .filter((account) => (!query.department || keep.has(account.id)) && (!query.onlyActive || rolled.has(account.id)))
    .map((account) => {
      const sum = rolled.get(account.id) ?? { opening: '0.00', debit: '0.00', credit: '0.00', closing: '0.00' };
      return { ...account, classLabel: GL_ACCOUNT_CLASS_LABELS[account.class], ...sum, hasActivity: rolled.has(account.id) };
    });
  let opening = 0n;
  let debit = 0n;
  let credit = 0n;
  for (const sum of leafSums.values()) {
    opening += toCents(sum.opening);
    debit += toCents(sum.debit);
    credit += toCents(sum.credit);
  }
  return {
    from: query.from,
    to: query.to,
    currency: context.currency,
    rows,
    totals: { opening: fromCents(opening), debit: fromCents(debit), credit: fromCents(credit), closing: fromCents(opening + debit - credit) },
    balanced: opening === 0n && debit === credit,
    unposted,
    lockedThrough: context.lockedThrough,
  };
}
