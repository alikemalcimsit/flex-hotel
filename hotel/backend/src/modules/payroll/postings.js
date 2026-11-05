import { randomUUID } from 'node:crypto';
import { currentActor, toDecimal } from '@hotelos/core';
import { LEDGER_ACCOUNT_CODE_PREFIXES, employeeFullName, payrollMonthBounds } from '@hotelos/hotel-contracts';
import { ConflictError } from '../../lib/errors.js';
import { lockLedgerAccounts, lockTreasuryAccounts } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { accountCode, loadSettings, money, nextSequence, postLedger, postLedgerBatch, postTreasury } from '../accounting/shared.js';
import { periodLabel, prisma } from './shared.js';

/**
 * Bordronun ön muhasebe kayıtları (modül 51 → 47). Muhasebe aktörü çağırır (bordro onaylandı / ödendi) ve
 * Muhasebe → Eşitle aynı fonksiyonları tarar. Hepsi **idempotent**: kaynak anahtarı tekil, ikinci çağrı yazmaz.
 *
 * - Tahakkuk (ay sonu tarihli): personel carisine net ücret borcumuz (alacak) — avans mahsubu dahil, çünkü avans
 *   ödendiği gün aynı cariye borç yazılmıştı; SGK carisine işçi + işveren payları − indirimler; vergi dairesi
 *   carisine gelir + damga vergisi; BES şirketine katkılar; icra / nafaka dosyasının carisine kesinti. Fark
 *   bordrosunda tutar eksi olabilir: o zaman ters taraf yazılır.
 * - Ödeme: kasadan / bankadan tek çıkış, her personelin carisine borç (cari kapanır).
 * - Gider tarafı (personel gideri hesapları) genel muhasebede (modül 48).
 *
 * Muhasebe başlamamışsa ya da belge başlangıç gününden önceyse işlenmez (açılış bakiyesiyle gelir).
 */

/** Tahakkuk tek işlemde en fazla bu kadar personel yazar (büyük otelde iş kesilirse kalan, yeniden çağrıda yazılır). */
const ACCRUAL_CHUNK = 250;

/* ─────────────── Cariler ─────────────── */

/**
 * Personelin carisi (yoksa açılır; bağ tekil, eşzamanlı ikinci işlem satır eklemez).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} employeeId
 */
export async function ensureEmployeeAccount(tx, hotelId, employeeId) {
  const existing = await tx.ledgerAccount.findFirst({ where: { hotelId, employeeId }, select: { id: true, name: true } });
  if (existing) return existing;
  const employee = await tx.employee.findFirst({ where: { id: employeeId, hotelId }, select: { firstName: true, lastName: true, nationalId: true, phone: true, email: true, address: true } });
  if (!employee) throw new ConflictError('Personel bulunamadı', 'EMPLOYEE_MISSING');
  const prefix = LEDGER_ACCOUNT_CODE_PREFIXES.EMPLOYEE;
  const code = accountCode(prefix, await nextSequence(tx, hotelId, prefix, 0));
  await tx.$executeRaw`
    INSERT INTO "LedgerAccount" ("id", "hotelId", "code", "name", "type", "employeeId", "taxNumber", "phone", "email", "address", "paymentTermDays", "createdBy", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${hotelId}, ${code}, ${employeeFullName(employee)}, 'EMPLOYEE'::"LedgerAccountType", ${employeeId}, ${employee.nationalId}, ${employee.phone}, ${employee.email}, ${employee.address}, 0, ${currentActor()}, now(), now())
    ON CONFLICT DO NOTHING`;
  const created = await tx.ledgerAccount.findFirst({ where: { hotelId, employeeId }, select: { id: true, name: true } });
  if (!created) throw new ConflictError('Personel carisi açılamadı; yeniden deneyin', 'LEDGER_ACCOUNT_RACE');
  return created;
}

/**
 * Çok personelin carisi (bordro tahakkuku / ödemesi): eksikler tek sıra numarası ayırmayla toplu açılır.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string[]} employeeIds
 * @returns {Promise<Map<string, string>>} personel → cari
 */
async function ensureEmployeeAccounts(tx, hotelId, employeeIds) {
  const wanted = [...new Set(employeeIds)];
  const read = async () => new Map((await tx.ledgerAccount.findMany({ where: { hotelId, employeeId: { in: wanted } }, select: { id: true, employeeId: true } })).map((row) => [row.employeeId, row.id]));
  const accounts = await read();
  const missing = wanted.filter((id) => !accounts.has(id));
  if (missing.length === 0) return accounts;
  const employees = await tx.employee.findMany({ where: { hotelId, id: { in: missing } }, select: { id: true, firstName: true, lastName: true, nationalId: true, phone: true, email: true, address: true } });
  if (employees.length !== missing.length) throw new ConflictError('Personel bulunamadı', 'EMPLOYEE_MISSING');
  const prefix = LEDGER_ACCOUNT_CODE_PREFIXES.EMPLOYEE;
  const last = await nextSequence(tx, hotelId, prefix, 0, employees.length);
  const actor = currentActor();
  await tx.ledgerAccount.createMany({
    data: employees.map((employee, index) => ({
      hotelId,
      code: accountCode(prefix, last - employees.length + 1 + index),
      name: employeeFullName(employee),
      type: 'EMPLOYEE',
      employeeId: employee.id,
      taxNumber: employee.nationalId,
      phone: employee.phone,
      email: employee.email,
      address: employee.address,
      paymentTermDays: 0,
      createdBy: actor,
    })),
    // Eşzamanlı ikinci işlem aynı personelin carisini açtıysa satır eklenmez (bağ tekil).
    skipDuplicates: true,
  });
  const all = await read();
  if (all.size !== wanted.length) throw new ConflictError('Personel carisi açılamadı; yeniden deneyin', 'LEDGER_ACCOUNT_RACE');
  return all;
}

/**
 * Kart değişince personel carisinin ad / iletişimi eşitlenir (cari yoksa bir şey yapmaz).
 * @param {string} hotelId @param {string} employeeId
 */
export async function syncEmployeeAccount(hotelId, employeeId) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, hotelId }, select: { firstName: true, lastName: true, nationalId: true, phone: true, email: true, address: true } });
  if (!employee) return { synced: false };
  const changed = await prisma.$executeRaw`
    UPDATE "LedgerAccount" SET "name" = ${employeeFullName(employee)}, "taxNumber" = ${employee.nationalId}, "phone" = ${employee.phone}, "email" = ${employee.email}, "address" = ${employee.address}
    WHERE "hotelId" = ${hotelId} AND "employeeId" = ${employeeId}`;
  return { synced: changed > 0 };
}

const SYSTEM_ACCOUNTS = Object.freeze({
  sgkLedgerAccountId: 'SGK (prim borcu)',
  taxLedgerAccountId: 'Vergi dairesi (muhtasar ve damga)',
  besLedgerAccountId: 'BES katkı payları',
});

/**
 * Bordro ayarındaki SGK / vergi / BES carisi (yoksa "Diğer" türünde açılıp ayara bağlanır).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {keyof typeof SYSTEM_ACCOUNTS} field
 */
async function ensureSettingsAccount(tx, hotelId, field) {
  const settings = await tx.payrollSettings.findFirst({ where: { hotelId }, select: { [field]: true } });
  const linked = settings?.[field] ? await tx.ledgerAccount.findFirst({ where: { id: settings[field], hotelId }, select: { id: true } }) : null;
  if (linked) return linked.id;
  const prefix = LEDGER_ACCOUNT_CODE_PREFIXES.OTHER;
  const account = await tx.ledgerAccount.create({ data: { hotelId, code: accountCode(prefix, await nextSequence(tx, hotelId, prefix, 0)), name: SYSTEM_ACCOUNTS[field], type: 'OTHER', createdBy: currentActor() }, select: { id: true } });
  await tx.payrollSettings.upsert({ where: { hotelId }, create: { hotelId, [field]: account.id }, update: { [field]: account.id } });
  return account.id;
}

/**
 * İcra / nafaka dosyasının carisi (yoksa açılıp dosyaya bağlanır).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} garnishmentId
 */
async function ensureGarnishmentAccount(tx, hotelId, garnishmentId) {
  const garnishment = await tx.garnishment.findFirst({ where: { id: garnishmentId, hotelId }, select: { id: true, type: true, fileNumber: true, authority: true, creditor: true, ledgerAccountId: true } });
  if (!garnishment) throw new ConflictError('İcra / nafaka kaydı bulunamadı', 'GARNISHMENT_MISSING');
  if (garnishment.ledgerAccountId) return garnishment.ledgerAccountId;
  const prefix = LEDGER_ACCOUNT_CODE_PREFIXES.OTHER;
  const name = garnishment.type === 'ICRA' ? `İcra: ${garnishment.authority} ${garnishment.fileNumber}` : `Nafaka: ${garnishment.creditor} (${garnishment.fileNumber})`;
  const account = await tx.ledgerAccount.create({ data: { hotelId, code: accountCode(prefix, await nextSequence(tx, hotelId, prefix, 0)), name: name.slice(0, 160), type: 'OTHER', createdBy: currentActor() }, select: { id: true } });
  await tx.garnishment.update({ where: { id: garnishment.id }, data: { ledgerAccountId: account.id } });
  return account.id;
}

/* ─────────────── Yardımcılar ─────────────── */

/** Tutarın işaretine göre alacak / borç. @param {string} amount */
const sided = (amount) => (toDecimal(amount).isNegative() ? { debit: money(toDecimal(amount).abs().toString()) } : { credit: money(amount) });

/* ─────────────── Tahakkuk ve ödeme ─────────────── */

/**
 * Bordronun tahakkuku + yapılmış ödemeleri (eksik olanlar). Onaylı değilse ya da muhasebe başlamamışsa işlemez.
 * @param {string} hotelId @param {string} runId
 * @returns {Promise<{ posted: boolean, skipped?: string, message?: string | null }>}
 */
export async function syncPayrollRun(hotelId, runId) {
  const settings = await loadSettings(prisma, hotelId);
  if (!settings) return { posted: false, skipped: 'Ön muhasebe başlamamış' };
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, hotelId }, select: { id: true, number: true, year: true, month: true, status: true, kind: true } });
  if (!run) return { posted: false, skipped: 'Bordro bulunamadı' };
  if (run.status !== 'APPROVED') return { posted: false, skipped: 'Bordro onaylı değil' };
  const accrualDay = payrollMonthBounds(run.year, run.month).last;
  let posted = false;
  if (accrualDay >= settings.startDate) posted = (await postAccrual(hotelId, run, accrualDay)) || posted;
  const payments = await prisma.payrollPayment.findMany({ where: { hotelId, runId }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  for (const payment of payments) posted = (await postPayment(hotelId, payment.id, settings.startDate)) || posted;
  return { posted, message: posted ? `${run.number} muhasebeye işlendi` : `${run.number} zaten işlenmiş` };
}

/** Maaş ödemesinin kaydı (Eşitle taraması ödeme satırından gelir). @param {string} hotelId @param {string} paymentId */
export async function syncPayrollPayment(hotelId, paymentId) {
  const payment = await prisma.payrollPayment.findFirst({ where: { id: paymentId, hotelId }, select: { runId: true } });
  if (!payment) return { posted: false, skipped: 'Ödeme bulunamadı' };
  return syncPayrollRun(hotelId, payment.runId);
}

/**
 * @param {string} hotelId @param {{ id: string, number: string, year: number, month: number, kind: string }} run @param {string} accrualDay
 */
async function postAccrual(hotelId, run, accrualDay) {
  const label = `${periodLabel(run.year, run.month)} ${run.kind === 'SUPPLEMENTARY' ? 'fark bordrosu' : 'bordrosu'} (${run.number})`;
  let posted = false;
  // Personel satırları parça parça (büyük otel): her parça kendi işlemi; yarıda kalırsa kalan sonraki çağrıda.
  let cursor = null;
  for (;;) {
    const entries = await prisma.payrollEntry.findMany({
      where: { runId: run.id, hotelId, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, employeeId: true, payable: true, lines: { where: { code: 'ADVANCE' }, select: { amount: true } } },
      orderBy: { id: 'asc' },
      take: ACCRUAL_CHUNK,
    });
    if (entries.length === 0) break;
    cursor = entries.at(-1).id;
    const todo = [];
    const keys = entries.map((entry) => `PAYROLL:${run.id}:${entry.employeeId}`);
    const done = new Set((await prisma.ledgerEntry.findMany({ where: { hotelId, sourceKey: { in: keys } }, select: { sourceKey: true } })).map((row) => row.sourceKey));
    for (const entry of entries) {
      const amount = toDecimal(String(entry.payable)).plus(entry.lines.reduce((acc, line) => acc.plus(String(line.amount)), toDecimal('0')));
      if (!done.has(`PAYROLL:${run.id}:${entry.employeeId}`) && !amount.isZero()) todo.push({ entry, amount: money(amount.toString()) });
    }
    if (todo.length === 0) continue;
    const created = await writeWithEvents(async (tx, stage) => {
      const accounts = await ensureEmployeeAccounts(tx, hotelId, todo.map(({ entry }) => entry.employeeId));
      await lockLedgerAccounts(tx, hotelId, [...accounts.values()]);
      const result = await postLedgerBatch(
        tx,
        hotelId,
        todo.map(({ entry, amount }) => ({ accountId: accounts.get(entry.employeeId), date: accrualDay, ...sided(amount), description: `${label}: net ücret`, reference: run.number, sourceType: 'PAYROLL', sourceId: run.id, sourceKey: `PAYROLL:${run.id}:${entry.employeeId}` })),
      );
      if (result.created > 0) await stage('accounting.posted', { hotelId, source: 'PAYROLL', ledgerAccountIds: [...accounts.values()].slice(0, 50), treasuryAccountIds: [] });
      return result.created;
    });
    posted = posted || created > 0;
  }

  // Toplamlar: SGK, vergi, BES, icra / nafaka
  const [totals] = /** @type {Array<any>} */ (
    await prisma.$queryRaw`
      SELECT COALESCE(SUM("employeeSgk" + "employeeUnemployment" + "employerSgk" + "employerUnemployment" - "treasuryDiscount" - "incentiveDiscount"), 0)::text AS "sgk",
             COALESCE(SUM("gvPayable" + "dvPayable"), 0)::text AS "tax"
      FROM "PayrollEntry" WHERE "runId" = ${run.id} AND "hotelId" = ${hotelId}`
  );
  const deductions = /** @type {Array<{ code: string, refId: string | null, amount: string }>} */ (
    await prisma.$queryRaw`
      SELECT l."code", l."refId", SUM(l."amount")::text AS "amount"
      FROM "PayrollLine" l JOIN "PayrollEntry" e ON e."id" = l."entryId"
      WHERE e."runId" = ${run.id} AND e."hotelId" = ${hotelId} AND l."code" IN ('BES', 'ICRA', 'NAFAKA')
      GROUP BY l."code", l."refId"`
  );
  const wrote = await writeWithEvents(async (tx, stage) => {
    const rows = [];
    if (!toDecimal(totals.sgk).isZero()) rows.push({ accountId: await ensureSettingsAccount(tx, hotelId, 'sgkLedgerAccountId'), amount: totals.sgk, text: 'SGK primleri (işçi + işveren − indirim)', key: 'SGK' });
    if (!toDecimal(totals.tax).isZero()) rows.push({ accountId: await ensureSettingsAccount(tx, hotelId, 'taxLedgerAccountId'), amount: totals.tax, text: 'gelir vergisi + damga vergisi', key: 'TAX' });
    const bes = deductions.filter((row) => row.code === 'BES').reduce((acc, row) => acc.plus(row.amount), toDecimal('0'));
    if (!bes.isZero()) rows.push({ accountId: await ensureSettingsAccount(tx, hotelId, 'besLedgerAccountId'), amount: bes.toString(), text: 'BES katkı payları', key: 'BES' });
    for (const row of deductions.filter((item) => item.code !== 'BES' && item.refId)) {
      rows.push({ accountId: await ensureGarnishmentAccount(tx, hotelId, row.refId), amount: row.amount, text: row.code === 'ICRA' ? 'icra kesintisi' : 'nafaka kesintisi', key: `GARN:${row.refId}` });
    }
    await lockLedgerAccounts(tx, hotelId, rows.map((row) => row.accountId));
    let created = false;
    for (const row of rows) {
      const result = await postLedger(tx, { hotelId, accountId: row.accountId, date: accrualDay, ...sided(money(row.amount)), description: `${label}: ${row.text}`, reference: run.number, sourceType: 'PAYROLL', sourceId: run.id, sourceKey: `PAYROLL:${run.id}:${row.key}` });
      created = created || result.created;
    }
    if (created) await stage('accounting.posted', { hotelId, source: 'PAYROLL', ledgerAccountIds: rows.map((row) => row.accountId).slice(0, 50), treasuryAccountIds: [] });
    return created;
  });
  return posted || wrote;
}

/**
 * Ödemenin kasa / banka çıkışı ve personel carilerine borç (cari kapanır).
 * @param {string} hotelId @param {string} paymentId @param {string} startDate
 */
async function postPayment(hotelId, paymentId, startDate) {
  const payment = await prisma.payrollPayment.findFirst({ where: { id: paymentId, hotelId }, include: { run: { select: { id: true, number: true, year: true, month: true } } } });
  if (!payment) return false;
  const date = payment.date.toISOString().slice(0, 10);
  if (date < startDate) return false;
  const already = await prisma.treasuryMovement.findFirst({ where: { hotelId, sourceKey: `PAYROLL_PAYMENT:${payment.id}` }, select: { id: true } });
  const entries = await prisma.payrollEntry.findMany({ where: { hotelId, runId: payment.runId, paymentId: payment.id }, select: { employeeId: true, payable: true }, orderBy: { id: 'asc' } });
  const keys = entries.map((entry) => `PAYROLL_PAYMENT:${payment.id}:${entry.employeeId}`);
  const done = new Set((await prisma.ledgerEntry.findMany({ where: { hotelId, sourceKey: { in: keys } }, select: { sourceKey: true } })).map((row) => row.sourceKey));
  const todo = entries.filter((entry) => !done.has(`PAYROLL_PAYMENT:${payment.id}:${entry.employeeId}`) && toDecimal(String(entry.payable)).greaterThan(0));
  if (already && todo.length === 0) return false;
  const label = `${periodLabel(payment.run.year, payment.run.month)} maaş ödemesi (${payment.run.number})`;
  for (let index = 0; index < Math.max(todo.length, 1); index += ACCRUAL_CHUNK) {
    const chunk = todo.slice(index, index + ACCRUAL_CHUNK);
    await writeWithEvents(async (tx, stage) => {
      const accounts = await ensureEmployeeAccounts(tx, hotelId, chunk.map((entry) => entry.employeeId));
      await lockTreasuryAccounts(tx, hotelId, [payment.treasuryAccountId]);
      await lockLedgerAccounts(tx, hotelId, [...accounts.values()]);
      if (index === 0) {
        await postTreasury(tx, { hotelId, treasuryAccountId: payment.treasuryAccountId, date, amount: money(toDecimal(String(payment.amount)).negated().toString()), description: `${label}: ${payment.count} personel`, reference: payment.run.number, sourceType: 'PAYROLL_PAYMENT', sourceId: payment.id, sourceKey: `PAYROLL_PAYMENT:${payment.id}` });
      }
      await postLedgerBatch(
        tx,
        hotelId,
        chunk.map((entry) => ({ accountId: accounts.get(entry.employeeId), date, debit: money(String(entry.payable)), description: label, reference: payment.run.number, sourceType: 'PAYROLL_PAYMENT', sourceId: payment.id, sourceKey: `PAYROLL_PAYMENT:${payment.id}:${entry.employeeId}` })),
      );
      await stage('accounting.posted', { hotelId, source: 'PAYROLL_PAYMENT', ledgerAccountIds: [...accounts.values()].slice(0, 50), treasuryAccountIds: [payment.treasuryAccountId] });
    });
  }
  return true;
}

/**
 * Avans ödemesi: kasadan / bankadan çıkış ve personel carisine borç (muhasebe başlamışsa ve ödeme hesabı
 * verildiyse; avansın kendi işleminde).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {Function} stage
 * @param {{ hotelId: string, advanceId: string, employeeId: string, treasuryAccountId: string, amount: string, paidOn: string, employeeName: string }} input
 */
export async function postAdvance(tx, stage, input) {
  const settings = await loadSettings(tx, input.hotelId);
  if (!settings || input.paidOn < settings.startDate) return { posted: false };
  const account = await ensureEmployeeAccount(tx, input.hotelId, input.employeeId);
  await lockTreasuryAccounts(tx, input.hotelId, [input.treasuryAccountId]);
  await lockLedgerAccounts(tx, input.hotelId, [account.id]);
  const text = `Maaş avansı: ${input.employeeName}`;
  const movement = await postTreasury(tx, { hotelId: input.hotelId, treasuryAccountId: input.treasuryAccountId, date: input.paidOn, amount: money(toDecimal(input.amount).negated().toString()), description: text, ledgerAccountId: account.id, sourceType: 'EMPLOYEE_ADVANCE', sourceId: input.advanceId, sourceKey: `EMPLOYEE_ADVANCE:${input.advanceId}` });
  const entry = await postLedger(tx, { hotelId: input.hotelId, accountId: account.id, date: input.paidOn, debit: input.amount, description: text, sourceType: 'EMPLOYEE_ADVANCE', sourceId: input.advanceId, sourceKey: `EMPLOYEE_ADVANCE:${input.advanceId}` });
  await stage('accounting.posted', { hotelId: input.hotelId, source: 'EMPLOYEE_ADVANCE', ledgerAccountIds: [account.id], treasuryAccountIds: [input.treasuryAccountId] });
  return { posted: true, ledgerEntryId: entry.id, treasuryMovementId: movement.id };
}
