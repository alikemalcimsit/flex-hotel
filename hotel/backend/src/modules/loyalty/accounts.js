import { currentActor } from '@hotelos/core';
import { LOYALTY_EXPIRY_WARN_DAYS, pointsValue, tierFor } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { accountForGuest, dateOnly, day, expiryFor, hotelContext, iso, loadLoyaltySettings, lockAccount, prisma, refreshTier, writeTransaction } from './shared.js';

/**
 * Sadakat hesapları ve ayar (modül 56): liste, hesap ayrıntısı ve hareketleri, misafir kartı özeti, üyelik, elle düzeltme,
 * süre dolumu ve seviye tazeleme (günlük iş), program ayarı, misafir kartları birleşince hesap birleştirme.
 */

/** @param {any} row @param {any} settings */
export function accountView(row, settings) {
  const tier = tierFor(settings.tiers, row.qualifyingPoints);
  return {
    id: row.id,
    number: row.number,
    guestId: row.guestId,
    guestName: row.guest ? `${row.guest.firstName} ${row.guest.lastName}` : null,
    status: row.status,
    balance: row.balance,
    balanceValue: pointsValue(Math.max(0, row.balance), settings.pointValue),
    lifetimePoints: row.lifetimePoints,
    qualifyingPoints: row.qualifyingPoints,
    tier: { code: tier.current.code, name: tier.current.name, multiplier: tier.current.multiplier, perks: tier.current.perks },
    nextTier: tier.next ? { code: tier.next.code, name: tier.next.name, toNext: tier.toNext } : null,
    enrolledAt: iso(row.enrolledAt),
    enrolledBy: row.enrolledBy,
    consentAt: iso(row.consentAt),
    lastActivityAt: iso(row.lastActivityAt),
  };
}

/** @param {string} hotelId @param {{ page: number, pageSize: number, search?: string, tier?: string, status?: string, sort: string }} query */
export async function listAccounts(hotelId, query) {
  const settings = await loadLoyaltySettings(prisma, hotelId);
  const where = {
    hotelId,
    ...(query.status ? { status: /** @type {any} */ (query.status) } : {}),
    ...(query.tier ? { tierCode: query.tier } : {}),
    ...(query.search
      ? { OR: [{ number: { contains: query.search, mode: 'insensitive' } }, { guest: { OR: [{ firstName: { contains: query.search, mode: 'insensitive' } }, { lastName: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }, { phone: { contains: query.search } }] } }] }
      : {}),
  };
  const orderBy = query.sort === 'balance' ? [{ balance: 'desc' }] : query.sort === 'name' ? [{ guest: { lastName: 'asc' } }] : [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
  const [rows, total, totals] = await Promise.all([
    prisma.loyaltyAccount.findMany({ where, include: { guest: { select: { firstName: true, lastName: true } } }, orderBy: /** @type {any} */ (orderBy), ...toSkipTake(query) }),
    prisma.loyaltyAccount.count({ where }),
    prisma.loyaltyAccount.aggregate({ where: { hotelId, status: 'ACTIVE' }, _sum: { balance: true }, _count: { _all: true } }),
  ]);
  const outstanding = Math.max(0, Number(totals._sum.balance ?? 0));
  return {
    ...buildPage(rows.map((row) => accountView(row, settings)), total, query),
    summary: { members: totals._count._all, outstandingPoints: outstanding, outstandingValue: pointsValue(outstanding, settings.pointValue) },
    tiers: settings.tiers,
  };
}

/** @param {string} hotelId @param {string} accountId */
export async function getAccount(hotelId, accountId) {
  const [settings, ctx] = await Promise.all([loadLoyaltySettings(prisma, hotelId), hotelContext(hotelId)]);
  const row = await prisma.loyaltyAccount.findFirst({ where: { id: accountId, hotelId }, include: { guest: { select: { firstName: true, lastName: true } } } });
  if (!row) throw new NotFoundError('Sadakat hesabı bulunamadı');
  return { account: accountView(row, settings), expiring: await expiringPoints(row.id, ctx.today), currency: ctx.currency };
}

/** Yakında süresi dolacak puan. @param {string} accountId @param {string} today */
async function expiringPoints(accountId, today) {
  const until = new Date(Date.parse(`${today}T00:00:00.000Z`) + LOYALTY_EXPIRY_WARN_DAYS * 86_400_000);
  const rows = await prisma.loyaltyTransaction.aggregate({ where: { accountId, remaining: { gt: 0 }, expiresOn: { lte: until } }, _sum: { remaining: true }, _min: { expiresOn: true } });
  return { points: rows._sum.remaining ?? 0, firstOn: day(rows._min.expiresOn) };
}

/** @param {string} hotelId @param {string} accountId @param {{ page: number, pageSize: number }} query */
export async function listTransactions(hotelId, accountId, query) {
  const account = await prisma.loyaltyAccount.findFirst({ where: { id: accountId, hotelId }, select: { id: true } });
  if (!account) throw new NotFoundError('Sadakat hesabı bulunamadı');
  const where = { hotelId, accountId };
  const [rows, total] = await Promise.all([prisma.loyaltyTransaction.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(query) }), prisma.loyaltyTransaction.count({ where })]);
  return buildPage(
    rows.map((row) => ({ id: row.id, kind: row.kind, points: row.points, remaining: row.remaining, expiresOn: day(row.expiresOn), amount: String(row.amount), description: row.description, sourceType: row.sourceType, reservationId: row.reservationId, folioId: row.folioId, createdBy: row.createdBy, createdAt: iso(row.createdAt) })),
    total,
    query,
  );
}

/** Misafir kartının sadakat kutusu. @param {string} hotelId @param {string} guestId */
export async function guestLoyalty(hotelId, guestId) {
  const [settings, ctx] = await Promise.all([loadLoyaltySettings(prisma, hotelId), hotelContext(hotelId)]);
  const guest = await prisma.guest.findFirst({ where: { id: guestId, hotelId, deletedAt: null }, select: { id: true } });
  if (!guest) throw new NotFoundError('Misafir kartı bulunamadı');
  const row = await prisma.loyaltyAccount.findUnique({ where: { guestId }, include: { guest: { select: { firstName: true, lastName: true } } } });
  return {
    program: { isEnabled: settings.isEnabled, programName: settings.programName, autoEnroll: settings.autoEnroll, pointValue: settings.pointValue },
    account: row ? accountView(row, settings) : null,
    expiring: row ? await expiringPoints(row.id, ctx.today) : null,
  };
}

/** Elle üyelik (açık rıza işaretli). @param {string} hotelId @param {string} guestId */
export async function enrollGuest(hotelId, guestId) {
  const guest = await prisma.guest.findFirst({ where: { id: guestId, hotelId, deletedAt: null }, select: { id: true } });
  if (!guest) throw new NotFoundError('Misafir kartı bulunamadı');
  await writeWithEvents(async (tx, stage) => {
    const existing = await tx.loyaltyAccount.findUnique({ where: { guestId } });
    if (existing?.status === 'ACTIVE') throw new ConflictError(`Misafir zaten üye (${existing.number})`, 'LOYALTY_ALREADY_MEMBER');
    if (existing) {
      await tx.loyaltyAccount.update({ where: { id: existing.id }, data: { status: 'ACTIVE', consentAt: new Date() } });
    } else {
      const account = await accountForGuest(tx, hotelId, guestId, { create: true, consent: true });
      await recordAudit(tx, { hotelId, entity: 'LoyaltyAccount', entityId: account.id, action: 'CREATE', after: { guestId, number: account.number, consent: true } });
    }
    await stage('loyalty.changed', { hotelId, area: 'ACCOUNT' });
  });
  return guestLoyalty(hotelId, guestId);
}

/**
 * Elle düzeltme: artı lot açar (süreli), eksi FIFO düşer (bakiyeden fazla düşülemez).
 * @param {string} hotelId @param {string} accountId @param {{ points: number, reason: string }} input
 */
export async function adjustAccount(hotelId, accountId, input) {
  const [settings, ctx] = await Promise.all([loadLoyaltySettings(prisma, hotelId), hotelContext(hotelId)]);
  await writeWithEvents(async (tx, stage) => {
    const exists = await tx.loyaltyAccount.findFirst({ where: { id: accountId, hotelId }, select: { id: true } });
    if (!exists) throw new NotFoundError('Sadakat hesabı bulunamadı');
    await lockAccount(tx, accountId);
    const account = await tx.loyaltyAccount.findUnique({ where: { id: accountId } });
    if (input.points < 0 && account.balance + input.points < 0) throw new ConflictError(`Bakiye ${account.balance} puan; daha fazlası düşülemez`, 'LOYALTY_BALANCE');
    const requestKey = `ADJUST:${accountId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await writeTransaction(tx, stage, { hotelId, account, kind: 'ADJUST', points: input.points, consume: input.points < 0, sourceType: 'MANUAL', sourceKey: requestKey, description: `Elle düzeltme: ${input.reason}`, expiresOn: input.points > 0 ? expiryFor(settings, ctx.today) : null, settings, today: ctx.today });
    await recordAudit(tx, { hotelId, entity: 'LoyaltyAccount', entityId: accountId, action: 'UPDATE', before: { balance: account.balance }, after: { balance: account.balance + input.points, points: input.points, reason: input.reason } });
  });
  return getAccount(hotelId, accountId);
}

/**
 * Misafir portalının sadakat kutusu (modül 53): program kapalıysa ya da üye değilse null.
 * @param {string} hotelId @param {string | null} guestId
 */
export async function portalLoyalty(hotelId, guestId) {
  if (!guestId) return null;
  const settings = await loadLoyaltySettings(prisma, hotelId);
  if (!settings.isEnabled) return null;
  const row = await prisma.loyaltyAccount.findUnique({ where: { guestId } });
  if (!row || row.hotelId !== hotelId || row.status !== 'ACTIVE') return null;
  const view = accountView(row, settings);
  return { programName: settings.programName, number: view.number, balance: view.balance, balanceValue: view.balanceValue, tier: { name: view.tier.name, perks: view.tier.perks }, nextTier: view.nextTier ? { name: view.nextTier.name, toNext: view.nextTier.toNext } : null };
}

/* ─────────────── Ayar ─────────────── */

/** @param {string} hotelId */
export async function getLoyaltySettings(hotelId) {
  const [settings, ctx] = await Promise.all([loadLoyaltySettings(prisma, hotelId), hotelContext(hotelId)]);
  return { settings, currency: ctx.currency };
}

/** @param {string} hotelId @param {any} input `loyaltySettingsSchema` */
export async function saveLoyaltySettings(hotelId, input) {
  const current = await loadLoyaltySettings(prisma, hotelId);
  if (input.expectedUpdatedAt && current.updatedAt && new Date(current.updatedAt).getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError('Ayar bu arada değişti; yenileyip tekrar deneyin');
  const { expectedUpdatedAt, ...rest } = input;
  const data = { ...rest, tiers: [...input.tiers].sort((a, b) => a.minPoints - b.minPoints), updatedBy: currentActor() };
  await writeWithEvents(async (tx, stage) => {
    await tx.loyaltySettings.upsert({ where: { hotelId }, create: { hotelId, ...data }, update: data });
    await recordAudit(tx, { hotelId, entity: 'LoyaltySettings', entityId: hotelId, action: 'UPDATE', after: { ...data, updatedBy: undefined } });
    await stage('loyalty.changed', { hotelId, area: 'SETTINGS' });
  });
  return getLoyaltySettings(hotelId);
}

/* ─────────────── Günlük iş ─────────────── */

/**
 * Süresi dolan lotları düşürür (EXPIRE), etkin hesapların seviyesini tazeler (pencere kayar). Otel başına.
 * @param {string} hotelId
 */
export async function expireAndRefresh(hotelId) {
  const [settings, ctx] = await Promise.all([loadLoyaltySettings(prisma, hotelId), hotelContext(hotelId)]);
  const due = await prisma.loyaltyTransaction.groupBy({ by: ['accountId'], where: { hotelId, remaining: { gt: 0 }, expiresOn: { lt: dateOnly(ctx.today) } }, _sum: { remaining: true } });
  let expired = 0;
  for (const row of due) {
    await writeWithEvents(async (tx, stage) => {
      await lockAccount(tx, row.accountId);
      const lots = await tx.loyaltyTransaction.findMany({ where: { accountId: row.accountId, remaining: { gt: 0 }, expiresOn: { lt: dateOnly(ctx.today) } }, select: { id: true, remaining: true } });
      const points = lots.reduce((sum, lot) => sum + lot.remaining, 0);
      if (points === 0) return;
      const account = await tx.loyaltyAccount.findUnique({ where: { id: row.accountId } });
      await writeTransaction(tx, stage, { hotelId, account, kind: 'EXPIRE', points: -points, consumed: lots.map((lot) => ({ lotId: lot.id, points: lot.remaining })), sourceType: 'EXPIRY', sourceKey: `EXPIRE:${row.accountId}:${ctx.today}`, description: `${points} puanın süresi doldu`, settings, today: ctx.today });
      expired += points;
    });
  }
  // Seviye penceresi her gün kayar: son 90 günde hareketi olmayan hesaplar da düşebilir; yalnız seviyesi olan hesaplar.
  const accounts = await prisma.loyaltyAccount.findMany({ where: { hotelId, status: 'ACTIVE', qualifyingPoints: { gt: 0 } }, select: { id: true }, take: 5000 });
  for (const account of accounts) await writeWithEvents((tx, stage) => refreshTier(tx, stage, { hotelId, accountId: account.id, settings, today: ctx.today }));
  return { expired, accounts: due.length, refreshed: accounts.length };
}

/* ─────────────── Misafir birleştirme ─────────────── */

/**
 * Kaynak misafirin hesabı hedefe: hedefte hesap yoksa taşınır; varsa hareketler ve bakiye hedefe aktarılır, kaynak kapanır.
 * `mergeGuests` işleminin içinde çağrılır.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} sourceGuestId @param {string} targetGuestId
 */
export async function mergeLoyaltyAccounts(tx, hotelId, sourceGuestId, targetGuestId) {
  const [source, target] = await Promise.all([tx.loyaltyAccount.findUnique({ where: { guestId: sourceGuestId } }), tx.loyaltyAccount.findUnique({ where: { guestId: targetGuestId } })]);
  if (!source || source.hotelId !== hotelId) return;
  if (!target) {
    await tx.loyaltyAccount.update({ where: { id: source.id }, data: { guestId: targetGuestId } });
    return;
  }
  await tx.$executeRaw`SELECT "id" FROM "LoyaltyAccount" WHERE "id" = ANY(${[source.id, target.id].sort()}::text[]) ORDER BY "id" FOR UPDATE`;
  await tx.loyaltyTransaction.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } });
  await tx.$executeRaw`
    UPDATE "LoyaltyAccount" SET "balance" = "balance" + ${source.balance}, "lifetimePoints" = "lifetimePoints" + ${source.lifetimePoints},
      "qualifyingPoints" = "qualifyingPoints" + ${source.qualifyingPoints}, "updatedAt" = now()
    WHERE "id" = ${target.id}`;
  await tx.loyaltyAccount.update({ where: { id: source.id }, data: { status: 'CLOSED', balance: 0, lifetimePoints: 0, qualifyingPoints: 0, guestId: sourceGuestId } });
}
