import { Prisma } from '@prisma/client';
import { currentActor } from '@hotelos/core';
import { GL_ACCOUNT_CLASS_LABELS, MAX_GL_DEPTH, fromCents, glClassOfCode, glDepthOf, parentCodeOf, toCents } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { cursorTime, decodeStatementCursor, encodeStatementCursor } from '../accounting/shared.js';
import { dateOnly, day, ensureChart, iso, ledgerContext, money, prisma, sortByCode } from './shared.js';

/**
 * Hesap planı (modül 48): liste / ağaç, seçici, hesap açma ve düzenleme, Tek Düzen tamamlama, hesap ekstresi (kebir).
 * Kod hesabın yerini belirler: "100.01" 100'ün altına açılır; üst hesap yoksa açılamaz, satırı olan hesaba alt hesap
 * açılamaz (satırlar alt hesaba taşınmaz). Alt hesabı olan hesap satır almaz.
 */

const ACCOUNT_SELECT = Object.freeze({ id: true, code: true, name: true, parentId: true, depth: true, class: true, department: true, isPostable: true, isSystem: true, isActive: true, updatedAt: true });
const PICKER_LIMIT = 30;

/** @param {any} row @param {Set<string>} [withLines] */
const accountView = (row, withLines) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  parentId: row.parentId,
  depth: row.depth,
  class: row.class,
  classLabel: GL_ACCOUNT_CLASS_LABELS[row.class],
  department: row.department,
  isPostable: row.isPostable,
  isSystem: row.isSystem,
  isActive: row.isActive,
  hasLines: withLines ? withLines.has(row.id) : undefined,
  updatedAt: iso(row.updatedAt),
});

/** Satırı olan hesaplar (hesap planı ekranı: alt hesap açılamaz göstergesi). @param {string} hotelId */
async function accountsWithLines(hotelId) {
  const rows = /** @type {Array<{ accountId: string }>} */ (await prisma.$queryRaw`SELECT DISTINCT "accountId" FROM "JournalLine" WHERE "hotelId" = ${hotelId}`);
  return new Set(rows.map((row) => row.accountId));
}

/** @param {string} hotelId @param {{ search?: string, onlyActive?: boolean, postable?: boolean }} query */
export async function listChart(hotelId, query = {}) {
  await ensureChart(hotelId);
  const context = await ledgerContext(hotelId);
  const [rows, withLines] = await Promise.all([
    prisma.glAccount.findMany({ where: { hotelId, ...(query.onlyActive ? { isActive: true } : {}), ...(query.postable ? { isPostable: true } : {}) }, select: ACCOUNT_SELECT }),
    accountsWithLines(hotelId),
  ]);
  const needle = query.search?.trim().toLocaleLowerCase('tr-TR');
  const filtered = needle ? rows.filter((row) => row.code.startsWith(needle) || row.name.toLocaleLowerCase('tr-TR').includes(needle)) : rows;
  return { accounts: sortByCode(filtered).map((row) => accountView(row, withLines)), seededAt: context.chartSeededAt, currency: context.currency, today: context.today };
}

/**
 * Hesap seçici: yaprak ve etkin hesaplar; arama kod öneki ya da ad; boş aramada en çok satır alanlar önce.
 * @param {string} hotelId @param {{ search?: string }} query
 */
export async function pickAccounts(hotelId, query = {}) {
  await ensureChart(hotelId);
  const needle = query.search?.trim();
  if (needle) {
    const rows = await prisma.glAccount.findMany({
      where: { hotelId, isPostable: true, isActive: true, OR: [{ code: { startsWith: needle } }, { name: { contains: needle, mode: 'insensitive' } }] },
      select: { id: true, code: true, name: true, class: true, department: true },
      take: 200,
    });
    return { items: sortByCode(rows).slice(0, PICKER_LIMIT) };
  }
  const popular = /** @type {Array<{ id: string, code: string, name: string, class: string, department: string | null }>} */ (
    await prisma.$queryRaw`
      SELECT a."id", a."code", a."name", a."class"::text AS "class", a."department"::text AS "department"
      FROM "GlAccount" a LEFT JOIN LATERAL (SELECT count(*) AS "n" FROM "JournalLine" l WHERE l."accountId" = a."id") u ON true
      WHERE a."hotelId" = ${hotelId} AND a."isPostable" = true AND a."isActive" = true
      ORDER BY u."n" DESC, a."code" LIMIT ${PICKER_LIMIT}`
  );
  return { items: popular };
}

/**
 * Hesap aç. Kod üst hesabı belirler; sınıf koddan.
 * @param {string} hotelId @param {{ code: string, name: string, department: string | null }} input
 */
export async function createAccount(hotelId, input) {
  await ensureChart(hotelId);
  const parentCode = parentCodeOf(input.code);
  const depth = glDepthOf(input.code);
  if (depth > MAX_GL_DEPTH) throw new ValidationError('Hesap çok derin', { fields: { code: `En fazla ${MAX_GL_DEPTH} seviye` } });
  const parent = parentCode ? await prisma.glAccount.findFirst({ where: { hotelId, code: parentCode }, select: { id: true, code: true, name: true } }) : null;
  if (parentCode && !parent) throw new ValidationError(`Üst hesap yok: önce ${parentCode} hesabını açın`, { fields: { code: `Üst hesap ${parentCode} yok` } });
  if (parent) {
    const used = await prisma.journalLine.findFirst({ where: { hotelId, accountId: parent.id }, select: { id: true } });
    if (used) throw new ConflictError(`${parent.code} ${parent.name} hesabının fiş satırları var; altına hesap açılamaz (yeni bir ana hesap kullanın)`, 'GL_PARENT_HAS_LINES');
  }
  const actor = currentActor();
  try {
    const created = await writeWithEvents(async (tx, stage) => {
      const account = await tx.glAccount.create({
        data: { hotelId, code: input.code, name: input.name, parentId: parent?.id ?? null, depth, class: /** @type {any} */ (glClassOfCode(input.code)), department: /** @type {any} */ (input.department), isPostable: true, isSystem: false, createdBy: actor },
        select: ACCOUNT_SELECT,
      });
      if (parent) await tx.glAccount.updateMany({ where: { id: parent.id, isPostable: true }, data: { isPostable: false } });
      await recordAudit(tx, { hotelId, entity: 'GlAccount', entityId: account.id, action: 'CREATE', after: { code: input.code, name: input.name, department: input.department } });
      await stage('ledger.changed', { hotelId, change: 'CHART', journalIds: [] });
      return account;
    });
    return { account: accountView(created) };
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `${input.code} kodlu hesap zaten var` });
  }
}

/**
 * Hesap düzenle: ad, departman, etkinlik. Kod ve üst değişmez.
 * @param {string} hotelId @param {string} accountId @param {{ expectedUpdatedAt: Date, name: string, department: string | null, isActive: boolean }} input
 */
export async function updateAccount(hotelId, accountId, input) {
  const current = await prisma.glAccount.findFirst({ where: { id: accountId, hotelId }, select: ACCOUNT_SELECT });
  if (!current) throw new NotFoundError('Hesap bulunamadı');
  if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError('Hesap bu arada değişti; yenileyip tekrar deneyin');
  if (!input.isActive && current.isActive) {
    const activeChild = await prisma.glAccount.findFirst({ where: { hotelId, parentId: accountId, isActive: true }, select: { code: true } });
    if (activeChild) throw new ConflictError(`Önce alt hesapları pasife alın (${activeChild.code})`, 'GL_ACTIVE_CHILDREN');
  }
  const updated = await writeWithEvents(async (tx, stage) => {
    const account = await tx.glAccount.update({ where: { id: accountId }, data: { name: input.name, department: /** @type {any} */ (input.department), isActive: input.isActive }, select: ACCOUNT_SELECT });
    await recordAudit(tx, {
      hotelId,
      entity: 'GlAccount',
      entityId: accountId,
      action: 'UPDATE',
      before: { name: current.name, department: current.department, isActive: current.isActive },
      after: { name: input.name, department: input.department, isActive: input.isActive },
    });
    await stage('ledger.changed', { hotelId, change: 'CHART', journalIds: [] });
    return account;
  });
  return { account: accountView(updated) };
}

/** Tek Düzen'i ve varsayılan kuralları tamamlar (eksikleri ekler). @param {string} hotelId */
export async function seedChart(hotelId) {
  const result = await ensureChart(hotelId, { force: true });
  await writeWithEvents(async (tx, stage) => {
    await recordAudit(tx, { hotelId, entity: 'GlAccount', entityId: hotelId, action: 'CREATE', after: { seed: true, created: result.created, rules: result.rules } });
    await stage('ledger.changed', { hotelId, change: 'CHART', journalIds: [] });
  });
  return { created: result.created, rules: result.rules };
}

/** Hesap ve altındakilerin kimlikleri (özyinelemeli). @param {string} hotelId @param {string} accountId */
async function subtreeIds(hotelId, accountId) {
  const rows = /** @type {Array<{ id: string }>} */ (
    await prisma.$queryRaw`
      WITH RECURSIVE tree AS (
        SELECT "id" FROM "GlAccount" WHERE "id" = ${accountId} AND "hotelId" = ${hotelId}
        UNION ALL
        SELECT a."id" FROM "GlAccount" a JOIN tree t ON a."parentId" = t."id"
      ) SELECT "id" FROM tree`
  );
  return rows.map((row) => row.id);
}

/**
 * Hesap ekstresi (kebir): devir, satırlar (yürüyen bakiye), dönem toplamı; imleçle sayfa. Üst hesapta alt hesapların
 * satırları da listelenir (hangi hesap olduğu satırda).
 * @param {string} hotelId @param {string} accountId @param {{ from?: string, to?: string, cursor?: string, limit: number }} query
 */
export async function accountLines(hotelId, accountId, query) {
  const context = await ledgerContext(hotelId);
  const account = await prisma.glAccount.findFirst({ where: { id: accountId, hotelId }, select: ACCOUNT_SELECT });
  if (!account) throw new NotFoundError('Hesap bulunamadı');
  const from = query.from ?? `${context.today.slice(0, 4)}-01-01`;
  const to = query.to ?? context.today;
  const ids = await subtreeIds(hotelId, accountId);
  const cursor = decodeStatementCursor(query.cursor);
  const scope = Prisma.sql`l."hotelId" = ${hotelId} AND l."accountId" = ANY(${ids}::text[])`;
  const [sums] = /** @type {Array<{ opening: string, debit: string, credit: string }>} */ (
    await prisma.$queryRaw`
      SELECT COALESCE(SUM(CASE WHEN l."date" < ${from}::date THEN l."debit" - l."credit" ELSE 0 END), 0)::text AS "opening",
             COALESCE(SUM(CASE WHEN l."date" BETWEEN ${from}::date AND ${to}::date THEN l."debit" ELSE 0 END), 0)::text AS "debit",
             COALESCE(SUM(CASE WHEN l."date" BETWEEN ${from}::date AND ${to}::date THEN l."credit" ELSE 0 END), 0)::text AS "credit"
      FROM "JournalLine" l WHERE ${scope} AND l."date" <= ${to}::date`
  );
  const after = cursor ? Prisma.sql`AND (l."date", j."createdAt", l."id") > (${cursor.date}::date, ${cursorTime(cursor.createdAt)}, ${cursor.id})` : Prisma.empty;
  const [{ before }] = cursor
    ? /** @type {Array<{ before: string }>} */ (
        await prisma.$queryRaw`
          SELECT COALESCE(SUM(l."debit" - l."credit"), 0)::text AS "before"
          FROM "JournalLine" l JOIN "JournalEntry" j ON j."id" = l."entryId"
          WHERE ${scope} AND l."date" BETWEEN ${from}::date AND ${to}::date AND (l."date", j."createdAt", l."id") <= (${cursor.date}::date, ${cursorTime(cursor.createdAt)}, ${cursor.id})`
      )
    : [{ before: '0' }];
  const rows = /** @type {any[]} */ (
    await prisma.$queryRaw`
      SELECT l."id", l."entryId", l."date", l."debit"::text AS "debit", l."credit"::text AS "credit", l."description", l."ledgerAccountId", l."treasuryAccountId", l."accountId",
             j."number", j."description" AS "entryDescription", j."source"::text AS "source", j."status"::text AS "status", j."createdAt",
             a."code", a."name", la."name" AS "ledgerName", ta."name" AS "treasuryName"
      FROM "JournalLine" l JOIN "JournalEntry" j ON j."id" = l."entryId" JOIN "GlAccount" a ON a."id" = l."accountId"
      LEFT JOIN "LedgerAccount" la ON la."id" = l."ledgerAccountId" LEFT JOIN "TreasuryAccount" ta ON ta."id" = l."treasuryAccountId"
      WHERE ${scope} AND l."date" BETWEEN ${from}::date AND ${to}::date ${after}
      ORDER BY l."date", j."createdAt", l."id" LIMIT ${query.limit + 1}`
  );
  const page = rows.slice(0, query.limit);
  let running = toCents(money(sums.opening)) + toCents(money(before));
  const items = page.map((row) => {
    running += toCents(money(row.debit)) - toCents(money(row.credit));
    return {
      id: row.id,
      entryId: row.entryId,
      number: row.number,
      date: day(row.date),
      description: row.description ?? row.entryDescription,
      debit: money(row.debit),
      credit: money(row.credit),
      balance: fromCents(running),
      source: row.source,
      status: row.status,
      ledgerAccount: row.ledgerAccountId ? { id: row.ledgerAccountId, name: row.ledgerName } : null,
      treasuryAccount: row.treasuryAccountId ? { id: row.treasuryAccountId, name: row.treasuryName } : null,
      account: { id: row.accountId, code: row.code, name: row.name },
    };
  });
  const last = page.at(-1);
  const opening = money(sums.opening);
  const closing = fromCents(toCents(opening) + toCents(money(sums.debit)) - toCents(money(sums.credit)));
  return {
    account: accountView(account),
    from,
    to,
    currency: context.currency,
    opening,
    items,
    nextCursor: rows.length > query.limit && last ? encodeStatementCursor({ date: dateOnly(/** @type {string} */ (day(last.date))), createdAt: last.createdAt, id: last.id }) : null,
    totals: { debit: money(sums.debit), credit: money(sums.credit), closing },
  };
}
