import { currentActor, toIsoDay } from '@hotelos/core';
import { DEFAULT_LOYALTY_TIERS, LOYALTY_NUMBER_PREFIX, LOYALTY_TIER_WINDOW_MONTHS, consumeLots, normalizeTiers, tierFor } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { ConflictError } from '../../lib/errors.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { nextSequence } from '../accounting/shared.js';
import { hotelContext } from '../banquet/shared.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';

/**
 * Sadakatin ortak parçaları (modül 56): ayar (varsayılanlarla), hesap açma, hareket yazıcı (bakiye + lot + seviye aynı işlemde),
 * FIFO harcama ve iadesi. Bütün yazımlar hesap satırı kilitli (`FOR UPDATE`) yapılır; aynı kaynak anahtarı ikinci kez yazılmaz.
 */

export { prisma, hotelContext };

/** @param {Date | null | undefined} value */
export const day = (value) => (value ? toIsoDay(value) : null);
/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {string} text */
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);
/** "YYYY-AA-GG" + ay. @param {string} text @param {number} months */
export function addMonthsIso(text, months) {
  const date = new Date(`${text}T00:00:00.000Z`);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
  if (target.getUTCDate() !== date.getUTCDate()) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/**
 * Program ayarı (satır yoksa kapalı program ve varsayılanlar).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId
 */
export async function loadLoyaltySettings(client, hotelId) {
  const row = await client.loyaltySettings.findUnique({ where: { hotelId } });
  return {
    isEnabled: row?.isEnabled ?? false,
    programName: row?.programName ?? 'Sadakat programı',
    spendPerPoint: String(row?.spendPerPoint ?? '10'),
    pointValue: String(row?.pointValue ?? '0.5'),
    minRedeemPoints: row?.minRedeemPoints ?? 100,
    maxRedeemPct: row?.maxRedeemPct ?? 50,
    expiryMonths: row?.expiryMonths ?? 24,
    autoEnroll: row?.autoEnroll ?? true,
    excludeLedgerPaid: row?.excludeLedgerPaid ?? true,
    earnOnSpa: row?.earnOnSpa ?? true,
    tiers: normalizeTiers(Array.isArray(row?.tiers) && row.tiers.length ? /** @type {any[]} */ (row.tiers) : [...DEFAULT_LOYALTY_TIERS]),
    isDefault: !row,
    updatedAt: iso(row?.updatedAt),
    updatedBy: row?.updatedBy ?? null,
  };
}

/** Hesap satırını kilitler. @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} accountId */
export async function lockAccount(tx, accountId) {
  await tx.$executeRaw`SELECT "id" FROM "LoyaltyAccount" WHERE "id" = ${accountId} FOR UPDATE`;
}

/**
 * Misafirin hesabı; yoksa `create` doğruysa açılır (numara sırası; eşzamanlı ikinci açılış misafir tekilliğine takılır ve ilkini okur).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} guestId
 * @param {{ create?: boolean, consent?: boolean, actor?: string }} [options]
 */
export async function accountForGuest(tx, hotelId, guestId, { create = false, consent = false, actor = currentActor() } = {}) {
  const existing = await tx.loyaltyAccount.findUnique({ where: { guestId } });
  if (existing || !create) return existing && existing.hotelId === hotelId ? existing : null;
  const number = `${LOYALTY_NUMBER_PREFIX}-${String(await nextSequence(tx, hotelId, LOYALTY_NUMBER_PREFIX, 0)).padStart(6, '0')}`;
  await tx.$executeRaw`
    INSERT INTO "LoyaltyAccount" ("id", "hotelId", "guestId", "number", "status", "enrolledBy", "consentAt", "enrolledAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${hotelId}, ${guestId}, ${number}, 'ACTIVE', ${actor}, ${consent ? new Date() : null}, now(), now(), now())
    ON CONFLICT ("guestId") DO NOTHING`;
  const created = await tx.loyaltyAccount.findUnique({ where: { guestId } });
  if (!created) throw new ConflictError('Sadakat hesabı açılamadı; yeniden deneyin', 'LOYALTY_ACCOUNT_RACE');
  return created;
}

/**
 * Hareket yazar ve hesabı günceller (çağıran hesabı kilitlemiş olmalı). Artı harekette lot açılır (`remaining` = puan,
 * süre ayardan); eksi harekette `consume` verilmişse lotlardan düşer (FIFO), verilmemişse bakiye doğrudan düşer.
 * Aynı kaynak anahtarı yazılmışsa bir şey yapmaz.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage
 * @param {{ hotelId: string, account: any, kind: string, points: number, sourceType: string, sourceId?: string | null, sourceKey: string,
 *   description: string, amount?: string, reservationId?: string | null, folioId?: string | null, folioItemId?: string | null,
 *   expiresOn?: string | null, consume?: boolean, consumed?: Array<{ lotId: string, points: number }> | null, settings: any, today: string }} input
 * @returns {Promise<{ created: boolean, id: string | null, shortfall?: number }>}
 */
export async function writeTransaction(tx, stage, input) {
  const existing = await tx.loyaltyTransaction.findFirst({ where: { hotelId: input.hotelId, sourceKey: input.sourceKey }, select: { id: true } });
  if (existing) return { created: false, id: existing.id };
  if (input.points === 0) return { created: false, id: null };
  let consumed = input.consumed ?? [];
  let shortfall = 0;
  if (input.points < 0 && input.consume && !input.consumed) {
    const lots = await tx.loyaltyTransaction.findMany({
      where: { accountId: input.account.id, remaining: { gt: 0 } },
      orderBy: [{ expiresOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      select: { id: true, remaining: true },
    });
    const result = consumeLots(lots, -input.points);
    consumed = result.consumed;
    shortfall = result.shortfall;
  }
  for (const part of consumed) {
    await tx.$executeRaw`UPDATE "LoyaltyTransaction" SET "remaining" = "remaining" - ${part.points} WHERE "id" = ${part.lotId} AND "remaining" >= ${part.points}`;
  }
  const row = await tx.loyaltyTransaction.create({
    data: {
      hotelId: input.hotelId,
      accountId: input.account.id,
      kind: /** @type {any} */ (input.kind),
      points: input.points,
      remaining: input.points > 0 ? input.points : 0,
      expiresOn: input.points > 0 && input.expiresOn ? dateOnly(input.expiresOn) : null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceKey: input.sourceKey,
      amount: input.amount ?? '0',
      consumed,
      reservationId: input.reservationId ?? null,
      folioId: input.folioId ?? null,
      folioItemId: input.folioItemId ?? null,
      description: input.description.slice(0, 300),
      createdBy: currentActor(),
    },
    select: { id: true },
  });
  const earned = input.kind === 'EARN' ? input.points : input.kind === 'EARN_REVERSAL' ? input.points : 0;
  await tx.$executeRaw`
    UPDATE "LoyaltyAccount" SET "balance" = "balance" + ${input.points},
      "lifetimePoints" = "lifetimePoints" + ${earned > 0 ? earned : 0},
      "lastActivityAt" = now(), "updatedAt" = now()
    WHERE "id" = ${input.account.id}`;
  await stage('loyalty.points.changed', { hotelId: input.hotelId, accountId: input.account.id, guestId: input.account.guestId, kind: input.kind, points: input.points, balance: input.account.balance + input.points });
  await refreshTier(tx, stage, { hotelId: input.hotelId, accountId: input.account.id, settings: input.settings, today: input.today });
  return { created: true, id: row.id, shortfall };
}

/**
 * Harcama iadesi: harcamanın düştüğü lotlara geri yazılır (süresi dolmuş lota yazılan sonraki süre işinde yine düşer).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Array<{ lotId: string, points: number }>} consumed
 */
export async function restoreLots(tx, consumed) {
  for (const part of consumed ?? []) {
    await tx.$executeRaw`UPDATE "LoyaltyTransaction" SET "remaining" = LEAST("points", "remaining" + ${part.points}) WHERE "id" = ${part.lotId}`;
  }
}

/**
 * Son 12 ayda kazanılan puanı ve seviyeyi yeniden hesaplar; seviye yükseldiyse olay ve ön büroya zil.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage
 * @param {{ hotelId: string, accountId: string, settings: any, today: string }} input
 */
export async function refreshTier(tx, stage, { hotelId, accountId, settings, today }) {
  const since = addMonthsIso(today, -LOYALTY_TIER_WINDOW_MONTHS);
  const [{ points }] = /** @type {Array<{ points: number }>} */ (
    await tx.$queryRaw`
      SELECT COALESCE(SUM("points"), 0)::int AS "points" FROM "LoyaltyTransaction"
      WHERE "accountId" = ${accountId} AND "kind" IN ('EARN', 'EARN_REVERSAL') AND "createdAt" >= ${dateOnly(since)}`
  );
  const qualifying = Math.max(0, points);
  const account = await tx.loyaltyAccount.findUnique({ where: { id: accountId }, select: { tierCode: true, guestId: true, number: true, guest: { select: { firstName: true, lastName: true } } } });
  if (!account) return;
  const { current } = tierFor(settings.tiers, qualifying);
  await tx.loyaltyAccount.update({ where: { id: accountId }, data: { qualifyingPoints: qualifying, tierCode: current.code } });
  if (account.tierCode === current.code) return;
  await stage('loyalty.tier.changed', { hotelId, accountId, guestId: account.guestId, from: account.tierCode, to: current.code });
  const rank = (code) => settings.tiers.findIndex((tier) => tier.code === code);
  if (account.tierCode && rank(current.code) > rank(account.tierCode)) {
    await raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'LOYALTY',
      severity: 'INFO',
      title: `${account.guest.firstName} ${account.guest.lastName} ${current.name} seviyesine yükseldi`,
      body: `${account.number}: son 12 ayda ${qualifying} puan.${current.perks ? ` Avantajlar: ${current.perks}` : ''}`,
      link: `/misafirler/${account.guestId}`,
      permission: PERMISSIONS.LOYALTY_VIEW,
      dedupeKey: `loyalty-tier:${accountId}:${current.code}`,
    });
  }
}

/** Kazanılan puanın son kullanma günü (ayar ayı; 0 = süresiz). @param {any} settings @param {string} today */
export const expiryFor = (settings, today) => (settings.expiryMonths > 0 ? addMonthsIso(today, settings.expiryMonths) : null);
