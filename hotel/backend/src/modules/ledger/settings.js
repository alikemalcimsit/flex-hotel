import { currentActor } from '@hotelos/core';
import { DEFAULT_JOURNAL_RULES } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { NotFoundError, StaleWriteError, ValidationError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';
import { unpostedCounts } from './journalize.js';
import { dateOnly, ensureChart, ledgerContext, prisma } from './shared.js';

/**
 * Genel muhasebe ayarları ve kuralları (modül 48): dönem kilidi, fişlenmemiş hareket sayısı, otomatik fiş kuralları.
 */

/** @param {string} hotelId */
export async function getLedgerSettings(hotelId) {
  await ensureChart(hotelId);
  const context = await ledgerContext(hotelId);
  const unposted = await unpostedCounts(hotelId, context.startDate);
  return {
    settings: { startDate: context.startDate, glLockedThrough: context.lockedThrough, glChartSeededAt: context.chartSeededAt, updatedAt: context.updatedAt },
    today: context.today,
    currency: context.currency,
    unposted,
  };
}

/**
 * Dönem kilidi: bu güne (dahil) kadar fiş girilemez / iptal edilemez. Bugünden sonra olamaz.
 * @param {string} hotelId @param {{ expectedUpdatedAt: Date | null, glLockedThrough: string | null }} input
 */
export async function saveLedgerSettings(hotelId, input) {
  const context = await ledgerContext(hotelId);
  if (input.expectedUpdatedAt && context.updatedAt && new Date(context.updatedAt).getTime() !== input.expectedUpdatedAt.getTime()) {
    throw new StaleWriteError('Ayar bu arada değişti; yenileyip tekrar deneyin');
  }
  // Bugün kilitlenemez: kilitli güne düşen otomatik fiş kilit sonrası ilk güne (en geç bugüne) yazılır; yarına fiş yazılmaz.
  if (input.glLockedThrough && input.glLockedThrough >= context.today) throw new ValidationError('Dönem kilidi en geç dünü kapsayabilir', { fields: { glLockedThrough: 'Bugün ve sonrası kilitlenemez' } });
  await writeWithEvents(async (tx, stage) => {
    const changed = await tx.accountingSettings.updateMany({ where: { hotelId }, data: { glLockedThrough: input.glLockedThrough ? dateOnly(input.glLockedThrough) : null, updatedBy: currentActor() } });
    if (changed.count !== 1) throw new NotFoundError('Muhasebe ayarı bulunamadı');
    await recordAudit(tx, { hotelId, entity: 'AccountingSettings', entityId: hotelId, action: 'UPDATE', before: { glLockedThrough: context.lockedThrough }, after: { glLockedThrough: input.glLockedThrough } });
    await stage('ledger.changed', { hotelId, change: 'SETTINGS', journalIds: [] });
  });
  return getLedgerSettings(hotelId);
}

/** @param {string} hotelId */
export async function getRules(hotelId) {
  await ensureChart(hotelId);
  const [rules, accounts, treasuryAccounts, departments] = await Promise.all([
    prisma.journalRule.findMany({ where: { hotelId }, select: { source: true, key: true, accountId: true, updatedAt: true, account: { select: { id: true, code: true, name: true } } }, orderBy: [{ source: 'asc' }, { key: 'asc' }] }),
    prisma.glAccount.findMany({ where: { hotelId }, select: { id: true, code: true, name: true } }),
    prisma.treasuryAccount.findMany({ where: { hotelId, isActive: true }, select: { id: true, name: true, kind: true, currency: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }], take: 200 }),
    prisma.department.findMany({ where: { hotelId, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  // Belirli cari kurallarının adı (ekranda ham kimlik görünmesin).
  const ledgerIds = rules.filter((rule) => rule.source === 'LEDGER_ACCOUNT').map((rule) => rule.key);
  const ledgerNames = ledgerIds.length ? new Map((await prisma.ledgerAccount.findMany({ where: { hotelId, id: { in: ledgerIds } }, select: { id: true, name: true, code: true } })).map((row) => [row.id, `${row.code} · ${row.name}`])) : new Map();
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const written = new Set(rules.map((rule) => `${rule.source}|${rule.key}`));
  const list = rules.map((rule) => ({ source: rule.source, key: rule.key, keyLabel: rule.source === 'LEDGER_ACCOUNT' ? (ledgerNames.get(rule.key) ?? null) : null, accountId: rule.accountId, account: rule.account, isDefault: false }));
  for (const rule of DEFAULT_JOURNAL_RULES) {
    if (written.has(`${rule.source}|${rule.key}`)) continue;
    const account = byCode.get(rule.code);
    if (account) list.push({ source: rule.source, key: rule.key, keyLabel: null, accountId: account.id, account, isDefault: true });
  }
  const updatedAt = rules.reduce((latest, rule) => (!latest || rule.updatedAt > latest ? rule.updatedAt : latest), /** @type {Date | null} */ (null));
  return { rules: list, defaults: DEFAULT_JOURNAL_RULES, treasuryAccounts, departments, updatedAt: updatedAt ? updatedAt.toISOString() : null };
}

/**
 * Kuralları kaydeder: hesap verilen satır yazılır / güncellenir (hesap yaprak ve etkin olmalı), hesap boş satır silinir
 * (varsayılana döner). Yalnız gönderilen satırlar değişir.
 * @param {string} hotelId @param {{ rows: Array<{ source: string, key: string, accountId: string | null }> }} input
 */
export async function saveRules(hotelId, input) {
  await ensureChart(hotelId);
  const accountIds = [...new Set(input.rows.map((row) => row.accountId).filter(Boolean))];
  const accounts = await prisma.glAccount.findMany({ where: { hotelId, id: { in: /** @type {string[]} */ (accountIds) } }, select: { id: true, code: true, name: true, isPostable: true, isActive: true } });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  input.rows.forEach((row, index) => {
    if (!row.accountId) return;
    const account = byId.get(row.accountId);
    if (!account) throw new ValidationError('Hesap bulunamadı', { fields: { [`rows.${index}.accountId`]: 'Geçersiz hesap' } });
    if (!account.isActive) throw new ValidationError(`${account.code} ${account.name} pasif`, { fields: { [`rows.${index}.accountId`]: 'Pasif hesap' } });
    if (!account.isPostable) throw new ValidationError(`${account.code} ${account.name} alt hesapları olan bir ana hesap; alt hesabını seçin`, { fields: { [`rows.${index}.accountId`]: 'Ana hesap seçilemez' } });
  });
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    for (const row of input.rows) {
      if (row.accountId) {
        await tx.journalRule.upsert({
          where: { hotelId_source_key: { hotelId, source: /** @type {any} */ (row.source), key: row.key } },
          create: { hotelId, source: /** @type {any} */ (row.source), key: row.key, accountId: row.accountId, updatedBy: actor },
          update: { accountId: row.accountId, updatedBy: actor },
        });
      } else {
        await tx.journalRule.deleteMany({ where: { hotelId, source: /** @type {any} */ (row.source), key: row.key } });
      }
    }
    await recordAudit(tx, {
      hotelId,
      entity: 'JournalRule',
      entityId: hotelId,
      action: 'UPDATE',
      after: { rows: input.rows.map((row) => `${row.source}|${row.key}=${row.accountId ? (byId.get(row.accountId)?.code ?? row.accountId) : '-'}`) },
    });
    await stage('ledger.changed', { hotelId, change: 'RULES', journalIds: [] });
  });
  return getRules(hotelId);
}
