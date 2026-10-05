import { currentActor, toDecimal, toIsoDay } from '@hotelos/core';
import {
  BUDGET_DEFAULT_EXPENSES,
  BUDGET_MAX_EXPENSE_ITEMS,
  BUDGET_MONTHS,
  BUDGET_REASON_MIN,
  BUDGET_SYSTEM_CODES,
  BUDGET_SYSTEM_ITEMS,
  budgetYearError,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { getHotelSettings } from '../settings/service.js';
import { emptyMonths, yearTotal } from './rules.js';

/**
 * Bütçe (modül 27): yılın sürümleri, satırları, gider kalemleri ve elle
 * girilen gider gerçekleşenleri. Sapma raporu ve AI yorumu `variance.js`'te.
 *
 * ### Sürümler
 *
 * Yılın ilk bütçesi taslak açılır (\`budget.manage\`). Taslak düzenlenir;
 * onaylanınca (\`budget.approve\`) kilitlenir. Değişiklik için revize taslağı
 * açılır (onaylı satırlar kopyalanır, gerekçe zorunlu); revize onaylanınca
 * önceki onaylı "eski sürüm" olur. Yıl başına en fazla bir taslak ve bir
 * onaylı — servis denetler, veritabanının kısmi tekil index'leri son savunma.
 * Her değişiklik sürüm damgalı (\`expectedUpdatedAt\`): iki kişi aynı taslağı
 * kaydederse ikincisi ilkini ezmez.
 *
 * ### Ölçek
 *
 * Bir bütçe en fazla (sistem kalemi + 40 gider) × 12 satır; yıl görünümü tek
 * sorguda iki sürüm (taslak + onaylı) ve satırları. Gider kalemleri otel
 * başına en fazla \`BUDGET_MAX_EXPENSE_ITEMS\`.
 */

const VERSION_SELECT = {
  id: true,
  year: true,
  version: true,
  status: true,
  reason: true,
  createdBy: true,
  createdAt: true,
  approvedAt: true,
  approvedBy: true,
  supersededAt: true,
  updatedAt: true,
};

const SYSTEM_BY_CODE = new Map(BUDGET_SYSTEM_ITEMS.map((item) => [item.code, item]));

/** @param {string} hotelId @param {Date} [at] */
async function businessYear(hotelId, at = new Date()) {
  const day = toIsoDay(await getBusinessDate(hotelId, at));
  return { businessDate: day, year: Number(day.slice(0, 4)) };
}

/** @param {Date | null} value */
const iso = (value) => (value ? value.toISOString() : null);

/** @param {object} row */
function toVersionDto(row) {
  return {
    id: row.id,
    year: row.year,
    version: row.version,
    status: row.status,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    approvedAt: iso(row.approvedAt),
    approvedBy: row.approvedBy,
    supersededAt: iso(row.supersededAt),
    updatedAt: iso(row.updatedAt),
  };
}

/**
 * Satırları kalem → 12 ay dizisine çevirir.
 * @param {Array<{ item: string, month: number, amount: import('@prisma/client').Prisma.Decimal }>} rows
 * @returns {Map<string, Array<string | null>>}
 */
export function linesByItem(rows) {
  /** @type {Map<string, Array<string | null>>} */
  const byItem = new Map();
  for (const row of rows) {
    if (!byItem.has(row.item)) byItem.set(row.item, emptyMonths());
    byItem.get(row.item)[row.month - 1] = toDecimal(String(row.amount)).toString();
  }
  return byItem;
}

/**
 * Otelin gider kalemleri (etkin olanlar sırasıyla; arşivlenenlerden
 * istenenler de — eski sürümde satırı olan).
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string[]} [includeArchived] arşivlense de gösterilecek kimlikler
 */
export async function loadExpenseItems(client, hotelId, includeArchived = []) {
  return client.budgetExpenseItem.findMany({
    where: { hotelId, OR: [{ archivedAt: null }, ...(includeArchived.length ? [{ id: { in: includeArchived } }] : [])] },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, label: true, sortOrder: true, archivedAt: true, updatedAt: true },
  });
}

/**
 * Kalem listesi (ızgara, Excel şablonu, sapma raporu): sistem kalemleri ve
 * gider kalemleri, ekrandaki sırayla.
 * @param {Array<{ id: string, label: string, archivedAt: Date | null, updatedAt: Date }>} expenses
 */
export function itemList(expenses) {
  return [
    ...BUDGET_SYSTEM_ITEMS.map((item) => ({ item: item.code, kind: item.kind, unit: item.unit, label: item.label, system: true, archived: false, updatedAt: null })),
    ...expenses.map((row) => ({
      item: row.id,
      kind: 'EXPENSE',
      unit: 'MONEY',
      label: row.label,
      system: false,
      archived: row.archivedAt !== null,
      updatedAt: iso(row.updatedAt),
    })),
  ];
}

/**
 * Sürümün ayrıntısı (satırlar kalem kalem).
 * @param {object} version
 * @param {Map<string, Array<string | null>>} lines
 */
function toDetail(version, lines) {
  return {
    ...toVersionDto(version),
    lines: [...lines.entries()].map(([item, months]) => ({ item, months, total: SYSTEM_BY_CODE.get(item)?.unit === 'PCT' ? null : yearTotal(months) })),
  };
}

/**
 * Yılın bütçe görünümü: sürümler (en yeni önce), taslak ve onaylı sürümün
 * satırları, kalemler.
 * @param {string} hotelId
 * @param {number} year
 */
export async function getBudgetYear(hotelId, year) {
  const [{ businessDate }, hotel, versions] = await Promise.all([
    businessYear(hotelId),
    getHotelSettings(hotelId),
    prisma.budget.findMany({ where: { hotelId, year }, orderBy: [{ version: 'desc' }], select: VERSION_SELECT }),
  ]);
  const shown = versions.filter((row) => row.status === 'DRAFT' || row.status === 'APPROVED');
  const rows = shown.length
    ? await prisma.budgetLine.findMany({
        where: { hotelId, budgetId: { in: shown.map((row) => row.id) } },
        select: { budgetId: true, item: true, month: true, amount: true },
      })
    : [];
  const linesOf = (id) => linesByItem(rows.filter((row) => row.budgetId === id));
  const referenced = [...new Set(rows.filter((row) => !SYSTEM_BY_CODE.has(row.item)).map((row) => row.item))];
  const expenses = await loadExpenseItems(prisma, hotelId, referenced);
  const draft = shown.find((row) => row.status === 'DRAFT') ?? null;
  const approved = shown.find((row) => row.status === 'APPROVED') ?? null;
  return {
    year,
    businessDate,
    currency: hotel.currency,
    versions: versions.map(toVersionDto),
    draft: draft ? toDetail(draft, linesOf(draft.id)) : null,
    approved: approved ? toDetail(approved, linesOf(approved.id)) : null,
    items: itemList(expenses),
  };
}

/**
 * Yılın ilk bütçesini taslak açar. İlk bütçede otelin gider kalemi yoksa
 * önerilen kalemler eklenir (otel değiştirir).
 * @param {string} hotelId
 * @param {{ year: number }} input
 */
export async function createBudget(hotelId, { year }) {
  const { year: current } = await businessYear(hotelId);
  const yearError = budgetYearError(year, current);
  if (yearError) throw new ValidationError(yearError, { field: 'year' });
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const existing = await tx.budget.findFirst({ where: { hotelId, year }, select: { id: true, status: true } });
      if (existing) {
        throw new ConflictError(`${year} bütçesi zaten var; onaylıysa değişiklik için revize açın.`, 'BUDGET_EXISTS');
      }
      const budget = await tx.budget.create({ data: { hotelId, year, version: 1, status: 'DRAFT', createdBy: actor }, select: { id: true } });
      if ((await tx.budgetExpenseItem.count({ where: { hotelId } })) === 0) {
        await tx.budgetExpenseItem.createMany({
          data: BUDGET_DEFAULT_EXPENSES.map((label, index) => ({ hotelId, label, sortOrder: index + 1, createdBy: actor })),
        });
        await stage('budget.expense_items.changed', { hotelId });
      }
      await recordAudit(tx, { hotelId, entity: 'Budget', entityId: budget.id, action: 'CREATE', after: { year, version: 1, status: 'DRAFT' } });
      await stage('budget.changed', { hotelId, budgetId: budget.id, year, change: 'CREATED' });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `${year} bütçesi az önce başkası tarafından açıldı; sayfayı yenileyin.` });
  }
  return getBudgetYear(hotelId, year);
}

/**
 * Onaylı bütçenin revize taslağını açar: onaylı satırlar kopyalanır, gerekçe
 * zorunlu. Onaylı sürüm revize onaylanana kadar geçerli kalır.
 * @param {string} hotelId
 * @param {number} year
 * @param {{ reason?: string }} input
 */
export async function reviseBudget(hotelId, year, { reason }) {
  const text = (reason ?? '').trim();
  if (text.length < BUDGET_REASON_MIN) throw new ValidationError(`Revize gerekçesi en az ${BUDGET_REASON_MIN} karakter olmalı`, { field: 'reason' });
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const versions = await tx.budget.findMany({ where: { hotelId, year }, select: { id: true, version: true, status: true }, orderBy: [{ version: 'desc' }] });
      const approved = versions.find((row) => row.status === 'APPROVED');
      if (!approved) throw new ConflictError(`${year} için onaylı bütçe yok; taslağı düzenleyin.`, 'BUDGET_NOT_APPROVED');
      if (versions.some((row) => row.status === 'DRAFT')) throw new ConflictError(`${year} için açık bir revize taslağı zaten var.`, 'BUDGET_DRAFT_EXISTS');
      const version = versions[0].version + 1;
      const budget = await tx.budget.create({ data: { hotelId, year, version, status: 'DRAFT', reason: text, createdBy: actor }, select: { id: true } });
      const lines = await tx.budgetLine.findMany({ where: { budgetId: approved.id }, select: { item: true, expenseItemId: true, month: true, amount: true } });
      // Arşivlenmiş gider kaleminin satırı revizeye taşınmaz (kalem artık planlanmıyor).
      const archived = new Set(
        (await tx.budgetExpenseItem.findMany({ where: { hotelId, archivedAt: { not: null } }, select: { id: true } })).map((row) => row.id),
      );
      const copied = lines.filter((line) => !archived.has(line.item));
      if (copied.length) await tx.budgetLine.createMany({ data: copied.map((line) => ({ ...line, hotelId, budgetId: budget.id })) });
      await recordAudit(tx, {
        hotelId,
        entity: 'Budget',
        entityId: budget.id,
        action: 'CREATE',
        after: { year, version, status: 'DRAFT', reason: text, revisionOf: approved.id },
      });
      await stage('budget.changed', { hotelId, budgetId: budget.id, year, change: 'REVISED' });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `${year} için revize az önce başkası tarafından açıldı; sayfayı yenileyin.` });
  }
  return getBudgetYear(hotelId, year);
}

/**
 * Taslağı kilitli (onaylı değilse) olarak yükler.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} budgetId
 */
async function loadDraft(tx, hotelId, budgetId) {
  const budget = await tx.budget.findFirst({ where: { id: budgetId, hotelId }, select: { id: true, year: true, status: true } });
  if (!budget) throw new NotFoundError('Bütçe bulunamadı');
  if (budget.status !== 'DRAFT') throw new ConflictError('Onaylı bütçe kilitli; değişiklik için revize açın.', 'BUDGET_LOCKED');
  return budget;
}

/**
 * Taslağın satırlarını kaydeder (ızgaranın tamamı ya da Excel'den yüklenen
 * tablo; verilmeyen kalem silinir). Sürüm damgalı.
 *
 * @param {string} hotelId
 * @param {string} budgetId
 * @param {{ expectedUpdatedAt: Date, lines: Array<{ item: string, months: Array<string | null> }> }} input
 */
export async function saveBudgetLines(hotelId, budgetId, { expectedUpdatedAt, lines }) {
  const year = await writeWithEvents(async (tx, stage) => {
    const budget = await loadDraft(tx, hotelId, budgetId);
    const active = new Map((await loadExpenseItems(tx, hotelId)).filter((row) => row.archivedAt === null).map((row) => [row.id, row]));
    const unknown = lines.filter((line) => !SYSTEM_BY_CODE.has(line.item) && !active.has(line.item));
    if (unknown.length) {
      throw new ValidationError('Tabloda tanınmayan ya da kaldırılmış kalem var; sayfayı yenileyip tekrar deneyin.', { field: 'lines', items: unknown.map((line) => line.item) });
    }

    const before = linesByItem(await tx.budgetLine.findMany({ where: { budgetId }, select: { item: true, month: true, amount: true } }));
    // Önce sürüm: başkası bu arada kaydettiyse satırlara dokunulmaz.
    await updateWithVersionCheck(tx, 'budget', { id: budgetId, hotelId }, expectedUpdatedAt, { updatedAt: new Date() }, 'Bütçe bulunamadı');
    await tx.budgetLine.deleteMany({ where: { budgetId } });
    const data = lines.flatMap((line) =>
      line.months.flatMap((amount, index) =>
        amount === null ? [] : [{ hotelId, budgetId, item: line.item, expenseItemId: SYSTEM_BY_CODE.has(line.item) ? null : line.item, month: index + 1, amount }],
      ),
    );
    if (data.length) await tx.budgetLine.createMany({ data });

    // Denetim: kalem kalem yıllık toplam (doluluk için ayların dizisi) — hücre hücre değil.
    const summary = (byItem) => Object.fromEntries([...byItem.entries()].map(([item, months]) => [item, SYSTEM_BY_CODE.get(item)?.unit === 'PCT' ? months.join('|') : yearTotal(months)]));
    const after = linesByItem(data.map((row) => ({ ...row, amount: toDecimal(row.amount) })));
    await recordAudit(tx, { hotelId, entity: 'Budget', entityId: budgetId, action: 'UPDATE', before: summary(before), after: summary(after) });
    await stage('budget.changed', { hotelId, budgetId, year: budget.year, change: 'LINES_SAVED' });
    return budget.year;
  });
  return getBudgetYear(hotelId, year);
}

/**
 * Taslağı onaylar (kilit); yılın önceki onaylı sürümü "eski sürüm" olur.
 * Boş bütçe onaylanmaz.
 * @param {string} hotelId
 * @param {string} budgetId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function approveBudget(hotelId, budgetId, { expectedUpdatedAt }) {
  const actor = currentActor();
  let year;
  try {
    year = await writeWithEvents(async (tx, stage) => {
      const budget = await loadDraft(tx, hotelId, budgetId);
      if ((await tx.budgetLine.count({ where: { budgetId } })) === 0) {
        throw new ValidationError('Boş bütçe onaylanamaz; önce plan değerlerini girin.');
      }
      const now = new Date();
      const previous = await tx.budget.findFirst({ where: { hotelId, year: budget.year, status: 'APPROVED' }, select: { id: true, version: true } });
      // Önce eski onaylı geri çekilir (yılın tek onaylısı kuralı), sonra taslak onaylanır.
      if (previous) await tx.budget.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED', supersededAt: now } });
      await updateWithVersionCheck(tx, 'budget', { id: budgetId, hotelId, status: 'DRAFT' }, expectedUpdatedAt, { status: 'APPROVED', approvedAt: now, approvedBy: actor }, 'Bütçe bulunamadı');
      await recordAudit(tx, {
        hotelId,
        entity: 'Budget',
        entityId: budgetId,
        action: 'UPDATE',
        before: { status: 'DRAFT' },
        after: { status: 'APPROVED', approvedBy: actor, supersedes: previous?.id ?? null },
      });
      await stage('budget.changed', { hotelId, budgetId, year: budget.year, change: 'APPROVED' });
      return budget.year;
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bütçe az önce başkası tarafından onaylandı; sayfayı yenileyin.' });
  }
  return getBudgetYear(hotelId, year);
}

/* ─────────────── Gider kalemleri ─────────────── */

/**
 * Otelin etkin gider kalemleri (sırasıyla).
 * @param {string} hotelId
 */
export async function listExpenseItems(hotelId) {
  return itemList(await loadExpenseItems(prisma, hotelId)).filter((item) => !item.system);
}

/**
 * Gider kalemi ekler (sona).
 * @param {string} hotelId
 * @param {{ label: string }} input
 */
export async function addExpenseItem(hotelId, { label }) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      const count = await tx.budgetExpenseItem.count({ where: { hotelId, archivedAt: null } });
      if (count >= BUDGET_MAX_EXPENSE_ITEMS) throw new ValidationError(`En fazla ${BUDGET_MAX_EXPENSE_ITEMS} gider kalemi tanımlanabilir`, { field: 'label' });
      const last = await tx.budgetExpenseItem.aggregate({ where: { hotelId }, _max: { sortOrder: true } });
      const item = await tx.budgetExpenseItem.create({ data: { hotelId, label, sortOrder: (last._max.sortOrder ?? 0) + 1, createdBy: actor }, select: { id: true } });
      await recordAudit(tx, { hotelId, entity: 'BudgetExpenseItem', entityId: item.id, action: 'CREATE', after: { label } });
      await stage('budget.expense_items.changed', { hotelId });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `"${label}" adlı bir gider kalemi zaten var` });
  }
  return listExpenseItems(hotelId);
}

/**
 * Gider kaleminin adını değiştirir (sürüm damgalı).
 * @param {string} hotelId
 * @param {string} itemId
 * @param {{ label: string, expectedUpdatedAt: Date }} input
 */
export async function renameExpenseItem(hotelId, itemId, { label, expectedUpdatedAt }) {
  try {
    await writeWithEvents(async (tx, stage) => {
      const before = await tx.budgetExpenseItem.findFirst({ where: { id: itemId, hotelId, archivedAt: null }, select: { label: true } });
      if (!before) throw new NotFoundError('Gider kalemi bulunamadı');
      await updateWithVersionCheck(tx, 'budgetExpenseItem', { id: itemId, hotelId }, expectedUpdatedAt, { label }, 'Gider kalemi bulunamadı');
      await recordAudit(tx, { hotelId, entity: 'BudgetExpenseItem', entityId: itemId, action: 'UPDATE', before, after: { label } });
      await stage('budget.expense_items.changed', { hotelId });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: `"${label}" adlı bir gider kalemi zaten var` });
  }
  return listExpenseItems(hotelId);
}

/**
 * Gider kalemini arşivler: yeni bütçelerde ve taslaklarda yer almaz (açık
 * taslaklardaki satırları silinir); onaylı ve eski sürümlerde ve
 * gerçekleşenlerde kalır (geçmiş değişmez).
 * @param {string} hotelId
 * @param {string} itemId
 */
export async function archiveExpenseItem(hotelId, itemId) {
  await writeWithEvents(async (tx, stage) => {
    const item = await tx.budgetExpenseItem.findFirst({ where: { id: itemId, hotelId, archivedAt: null }, select: { label: true } });
    if (!item) throw new NotFoundError('Gider kalemi bulunamadı');
    await tx.budgetExpenseItem.update({ where: { id: itemId }, data: { archivedAt: new Date() } });
    const drafts = await tx.budget.findMany({ where: { hotelId, status: 'DRAFT' }, select: { id: true, year: true } });
    if (drafts.length) {
      const removed = await tx.budgetLine.deleteMany({ where: { item: itemId, budgetId: { in: drafts.map((row) => row.id) } } });
      if (removed.count) {
        for (const draft of drafts) {
          // Taslağın sürümü ilerler: açık ızgara eski satırla kaydedemesin.
          await tx.budget.update({ where: { id: draft.id }, data: { updatedAt: new Date() } });
          await stage('budget.changed', { hotelId, budgetId: draft.id, year: draft.year, change: 'LINES_SAVED' });
        }
      }
    }
    await recordAudit(tx, { hotelId, entity: 'BudgetExpenseItem', entityId: itemId, action: 'DELETE', before: { label: item.label } });
    await stage('budget.expense_items.changed', { hotelId });
  });
  return listExpenseItems(hotelId);
}

/* ─────────────── Gerçekleşen giderler ─────────────── */

/**
 * Yılın elle girilen gider gerçekleşenleri ve girilebilecek son ay.
 * @param {string} hotelId
 * @param {number} year
 */
export async function getExpenseActuals(hotelId, year) {
  const [{ businessDate, year: current }, rows] = await Promise.all([
    businessYear(hotelId),
    prisma.budgetExpenseActual.findMany({
      where: { hotelId, year },
      select: { expenseItemId: true, month: true, amount: true, updatedAt: true },
    }),
  ]);
  const items = await loadExpenseItems(prisma, hotelId, [...new Set(rows.map((row) => row.expenseItemId))]);
  return {
    year,
    businessDate,
    lastOpenMonth: lastOpenMonth(year, current, businessDate),
    items: itemList(items).filter((item) => !item.system),
    entries: rows.map((row) => ({ itemId: row.expenseItemId, month: row.month, amount: toDecimal(String(row.amount)).toString(), updatedAt: iso(row.updatedAt) })),
  };
}

/**
 * Gerçekleşen girilebilecek son ay: geçmiş yıl 12, bu yıl içinde bulunulan ay,
 * gelecek yıl 0 (gelecek ayın gideri olmaz).
 * @param {number} year
 * @param {number} current
 * @param {string} businessDate
 */
export function lastOpenMonth(year, current, businessDate) {
  if (year < current) return BUDGET_MONTHS;
  if (year > current) return 0;
  return Number(businessDate.slice(5, 7));
}

/**
 * Gider gerçekleşenlerini kaydeder (hücre hücre sürüm damgalı; boş = sil).
 * @param {string} hotelId
 * @param {{ year: number, entries: Array<{ itemId: string, month: number, amount: string | null, expectedUpdatedAt?: Date | null }> }} input
 */
export async function saveExpenseActuals(hotelId, { year, entries }) {
  const { businessDate, year: current } = await businessYear(hotelId);
  const last = lastOpenMonth(year, current, businessDate);
  const future = entries.find((entry) => entry.month > last);
  if (future) throw new ValidationError('Gelecek ayların gerçekleşeni girilemez.', { field: 'entries' });
  const actor = currentActor();

  await writeWithEvents(async (tx, stage) => {
    const ids = [...new Set(entries.map((entry) => entry.itemId))];
    const items = await tx.budgetExpenseItem.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, label: true } });
    if (items.length !== ids.length) throw new ValidationError('Tanınmayan gider kalemi var; sayfayı yenileyin.', { field: 'entries' });
    const label = new Map(items.map((row) => [row.id, row.label]));
    const existing = await tx.budgetExpenseActual.findMany({
      where: { hotelId, year, expenseItemId: { in: ids } },
      select: { id: true, expenseItemId: true, month: true, amount: true, updatedAt: true },
    });
    const byKey = new Map(existing.map((row) => [`${row.expenseItemId}|${row.month}`, row]));
    /** @type {Map<string, { before: Record<string, string>, after: Record<string, string> }>} */
    const changes = new Map();
    const track = (itemId, month, before, after) => {
      if (!changes.has(itemId)) changes.set(itemId, { before: {}, after: {} });
      changes.get(itemId).before[month] = before;
      changes.get(itemId).after[month] = after;
    };

    for (const entry of entries) {
      const row = byKey.get(`${entry.itemId}|${entry.month}`);
      const stale = () => {
        throw new StaleWriteError(`"${label.get(entry.itemId)}" ${entry.month}. ay bu arada başkası tarafından değiştirildi; sayfayı yenileyip tekrar deneyin.`);
      };
      if (!row) {
        if (entry.expectedUpdatedAt) stale(); // okunan hücre bu arada silinmiş
        if (entry.amount === null) continue;
        await tx.budgetExpenseActual.create({ data: { hotelId, expenseItemId: entry.itemId, year, month: entry.month, amount: entry.amount, enteredBy: actor } });
        track(entry.itemId, entry.month, null, entry.amount);
        continue;
      }
      if (!entry.expectedUpdatedAt || row.updatedAt.getTime() !== entry.expectedUpdatedAt.getTime()) stale();
      const before = toDecimal(String(row.amount)).toString();
      if (entry.amount === null) {
        await tx.budgetExpenseActual.delete({ where: { id: row.id } });
        track(entry.itemId, entry.month, before, null);
      } else if (!toDecimal(entry.amount).eq(toDecimal(before))) {
        const updated = await tx.budgetExpenseActual.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { amount: entry.amount, enteredBy: actor } });
        if (updated.count === 0) stale();
        track(entry.itemId, entry.month, before, entry.amount);
      }
    }
    for (const [itemId, change] of changes) {
      await recordAudit(tx, { hotelId, entity: 'BudgetExpenseActual', entityId: itemId, action: 'UPDATE', before: { year, ...change.before }, after: { year, ...change.after } });
    }
    if (changes.size) await stage('budget.actuals.changed', { hotelId, year });
  });
  return getExpenseActuals(hotelId, year);
}

/** Sistem kalemi mi. @param {string} item */
export const isSystemItem = (item) => BUDGET_SYSTEM_CODES.includes(item);
