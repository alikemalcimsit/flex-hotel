import { randomUUID } from 'node:crypto';
import { currentActor, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import { LEDGER_ACCOUNT_CODE_PREFIXES } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { sqlTimestamp } from '../../lib/sql-time.js';

export { prisma };
export { hotelContext } from '../banquet/shared.js';

/**
 * Ön muhasebenin ortak parçaları (modül 47): ayar, numara / kod sırası, bağlı kart için cari açma ve
 * hareket yazıcıları. Bakiye her zaman hareketle **aynı işlemde** artırılır (ham SQL: kartın sürüm damgası
 * ilerlemez, açık düzenleme formu bozulmaz); çağıran cari / kasa-banka satırını önceden kilitlemiş olmalı
 * (`lockLedgerAccounts` / `lockTreasuryAccounts`). Aynı kaynak anahtarı ikinci kez yazılmaz (otel başına
 * tekil kısıt son savunmadır).
 */

/** Ayar satırı yoksa geçerli eşik (Prisma varsayılanıyla aynı). */
export const DEFAULT_PAYMENT_APPROVAL_AMOUNT = '50000.00';

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {Date | null | undefined} value */
export const day = (value) => (value ? toIsoDay(value) : null);
/** @param {string} text */
export const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);
/** @param {unknown} value */
export const money = (value) => toMoneyString(String(value ?? 0));
/** @param {string} text @param {number} days */
export const addDays = (text, days) => toIsoDay(new Date(dateOnly(text).getTime() + days * 86_400_000));

const trMoney = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Onay / uyarı metni için: "12.345,60 TRY". @param {unknown} amount @param {string} currency */
export const priced = (amount, currency) => `${trMoney.format(Number(money(amount)))} ${currency}`;
/** "2026-10-30" → "30.10.2026" @param {string} text */
export const dotted = (text) => text.split('-').reverse().join('.');

/* ─────────────── Ayar ─────────────── */

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId
 * @returns {Promise<{ startDate: string, paymentApprovalAmount: string, updatedAt: string | null, updatedBy: string | null } | null>}
 */
export async function loadSettings(client, hotelId) {
  const row = await client.accountingSettings.findFirst({ where: { hotelId } });
  if (!row) return null;
  return { startDate: day(row.startDate), paymentApprovalAmount: money(row.paymentApprovalAmount), updatedAt: iso(row.updatedAt), updatedBy: row.updatedBy };
}

/**
 * Ayar yoksa açar (başlangıç günü = otelin bugünü) ve acente / tedarikçi kartlarının carilerini açar —
 * ilk otomatik kayıtta ya da ilk muhasebe ekranında bir kez. Eşzamanlı iki çağrı çakışmaz: ayar ve kart
 * bağları tekil (ON CONFLICT DO NOTHING).
 *
 * @param {string} hotelId @param {string} today "YYYY-AA-GG"
 */
export async function ensureSettings(hotelId, today) {
  const existing = await loadSettings(prisma, hotelId);
  if (existing) return existing;
  await prisma.$executeRaw`
    INSERT INTO "AccountingSettings" ("hotelId", "startDate", "paymentApprovalAmount", "updatedBy", "createdAt", "updatedAt")
    VALUES (${hotelId}, ${today}::date, ${DEFAULT_PAYMENT_APPROVAL_AMOUNT}::numeric, 'system', now(), now())
    ON CONFLICT ("hotelId") DO NOTHING`;
  await openPartnerAccounts(hotelId);
  return /** @type {NonNullable<Awaited<ReturnType<typeof loadSettings>>>} */ (await loadSettings(prisma, hotelId));
}

/**
 * Carisi olmayan bütün acente ve tedarikçi kartları için cari açar (kod sırası tek seferde ayrılır).
 * @param {string} hotelId
 */
export async function openPartnerAccounts(hotelId) {
  const [agencies, suppliers] = await Promise.all([
    prisma.agency.findMany({ where: { hotelId, ledgerAccount: { is: null } }, select: PARTNER_SELECT.agency, orderBy: { name: 'asc' } }),
    prisma.supplier.findMany({ where: { hotelId, ledgerAccount: { is: null } }, select: PARTNER_SELECT.supplier, orderBy: { name: 'asc' } }),
  ]);
  for (const [type, rows] of /** @type {const} */ ([
    ['AGENCY', agencies],
    ['SUPPLIER', suppliers],
  ])) {
    if (rows.length === 0) continue;
    await prisma.$transaction(async (tx) => {
      const last = await nextSequence(tx, hotelId, LEDGER_ACCOUNT_CODE_PREFIXES[type], 0, rows.length);
      await tx.ledgerAccount.createMany({
        data: rows.map((row, index) => ({
          hotelId,
          code: accountCode(LEDGER_ACCOUNT_CODE_PREFIXES[type], last - rows.length + 1 + index),
          type,
          ...partnerFields(type, row),
          createdBy: 'system',
        })),
        skipDuplicates: true,
      });
    });
  }
}

/* ─────────────── Numara ve kod ─────────────── */

/**
 * Sıranın son değerini `count` kadar ilerletir (tek ifade: eşzamanlı iki belge aynı numarayı alamaz).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} kind @param {number} year @param {number} [count]
 * @returns {Promise<number>} ayrılan son değer
 */
export async function nextSequence(tx, hotelId, kind, year, count = 1) {
  const [row] = await tx.$queryRaw`
    INSERT INTO "AccountingSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, ${kind}, ${year}, ${count})
    ON CONFLICT ("hotelId", "kind", "year") DO UPDATE SET "last" = "AccountingSequence"."last" + ${count}
    RETURNING "last"`;
  return Number(row.last);
}

/** "ACN-0007" @param {string} prefix @param {number} value */
export const accountCode = (prefix, value) => `${prefix}-${String(value).padStart(4, '0')}`;

/** Fiş numarası: "TAH-2026-00042" @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} prefix @param {string} date */
export async function nextVoucherNumber(tx, hotelId, prefix, date) {
  const year = Number(date.slice(0, 4));
  return `${prefix}-${year}-${String(await nextSequence(tx, hotelId, prefix, year)).padStart(5, '0')}`;
}

/* ─────────────── Bağlı kart carisi ─────────────── */

const PARTNER_SELECT = Object.freeze({
  agency: { id: true, name: true, taxOffice: true, taxNumber: true, contactName: true, phone: true, email: true, address: true, paymentTermDays: true },
  supplier: { id: true, name: true, taxOffice: true, taxNumber: true, contactName: true, phone: true, email: true, address: true, paymentTermDays: true },
  eventClient: { id: true, type: true, name: true, taxOffice: true, taxNumber: true, contactName: true, phone: true, email: true, address: true },
});

/** Bağlı kartın cariye kopyalanan alanları (ünvan, vergi, iletişim, vade). @param {string} type @param {any} row */
function partnerFields(type, row) {
  return {
    name: row.name,
    taxOffice: row.taxOffice ?? null,
    taxNumber: row.taxNumber ?? null,
    contactName: row.contactName ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    paymentTermDays: Math.min(365, Math.max(0, row.paymentTermDays ?? 0)),
    ...(type === 'AGENCY' ? { agencyId: row.id } : type === 'SUPPLIER' ? { supplierId: row.id } : { eventClientId: row.id }),
  };
}

/**
 * Acente, tedarikçi ya da etkinlik müşterisinin carisi: yoksa açılır. Eşzamanlı iki işlem aynı kart için
 * iki cari açamaz (bağ tekil; ikinci işlem ilkini okur). Kart başka otelinse bulunamadı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId
 * @param {{ agencyId?: string | null, supplierId?: string | null, eventClientId?: string | null }} link
 * @returns {Promise<{ id: string, name: string, isActive: boolean, paymentTermDays: number }>}
 */
export async function ensurePartnerAccount(tx, hotelId, link) {
  const key = link.agencyId ? 'agencyId' : link.supplierId ? 'supplierId' : 'eventClientId';
  const value = link[key];
  if (!value) throw new ValidationError('Kart seçin');
  const select = { id: true, name: true, isActive: true, paymentTermDays: true };
  const existing = await tx.ledgerAccount.findFirst({ where: { hotelId, [key]: value }, select });
  if (existing) return existing;
  const source =
    key === 'agencyId'
      ? await tx.agency.findFirst({ where: { id: value, hotelId }, select: PARTNER_SELECT.agency })
      : key === 'supplierId'
        ? await tx.supplier.findFirst({ where: { id: value, hotelId }, select: PARTNER_SELECT.supplier })
        : await tx.eventClient.findFirst({ where: { id: value, hotelId }, select: PARTNER_SELECT.eventClient });
  if (!source) throw new NotFoundError(key === 'agencyId' ? 'Acente bulunamadı' : key === 'supplierId' ? 'Tedarikçi bulunamadı' : 'Etkinlik müşterisi bulunamadı');
  const type = key === 'agencyId' ? 'AGENCY' : key === 'supplierId' ? 'SUPPLIER' : /** @type {any} */ (source).type === 'PERSON' ? 'PERSON' : 'COMPANY';
  const prefix = LEDGER_ACCOUNT_CODE_PREFIXES[type];
  const code = accountCode(prefix, await nextSequence(tx, hotelId, prefix, 0));
  const fields = partnerFields(type, source);
  // Bağ tekil: eşzamanlı ikinci işlem satır eklemez, ilkinin carisini okur (işlem iptal olmaz).
  await tx.$executeRaw`
    INSERT INTO "LedgerAccount" ("id", "hotelId", "code", "name", "type", "agencyId", "supplierId", "eventClientId", "taxOffice", "taxNumber",
      "contactName", "phone", "email", "address", "paymentTermDays", "createdBy", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${hotelId}, ${code}, ${fields.name}, ${type}::"LedgerAccountType", ${fields.agencyId ?? null}, ${fields.supplierId ?? null},
      ${fields.eventClientId ?? null}, ${fields.taxOffice}, ${fields.taxNumber}, ${fields.contactName}, ${fields.phone}, ${fields.email}, ${fields.address},
      ${fields.paymentTermDays}, ${currentActor()}, now(), now())
    ON CONFLICT DO NOTHING`;
  const created = await tx.ledgerAccount.findFirst({ where: { hotelId, [key]: value }, select });
  if (!created) throw new ConflictError('Cari açılamadı; yeniden deneyin', 'LEDGER_ACCOUNT_RACE');
  return created;
}

/**
 * Yeni acente / tedarikçi kartının carisi: muhasebe başlamışsa hemen açılır (başlamamışsa ilk açılışta toplu).
 * @param {string} hotelId @param {{ agencyId?: string, supplierId?: string }} link
 */
export async function openPartnerAccount(hotelId, link) {
  if (!(await loadSettings(prisma, hotelId))) return { opened: false };
  const account = await prisma.$transaction((tx) => ensurePartnerAccount(tx, hotelId, link));
  return { opened: true, accountId: account.id };
}

/**
 * Bağlı kart değişince carinin ünvan / vergi / iletişim / vadesini eşitler (kart yoksa bir şey yapmaz).
 * @param {string} hotelId @param {{ agencyId?: string, supplierId?: string, eventClientId?: string }} link
 */
export async function syncPartnerAccount(hotelId, link) {
  const key = link.agencyId ? 'agencyId' : link.supplierId ? 'supplierId' : 'eventClientId';
  const value = link[key];
  const account = await prisma.ledgerAccount.findFirst({ where: { hotelId, [key]: value }, select: { id: true, type: true } });
  if (!account) return { synced: false };
  const source =
    key === 'agencyId'
      ? await prisma.agency.findFirst({ where: { id: value, hotelId }, select: PARTNER_SELECT.agency })
      : key === 'supplierId'
        ? await prisma.supplier.findFirst({ where: { id: value, hotelId }, select: PARTNER_SELECT.supplier })
        : await prisma.eventClient.findFirst({ where: { id: value, hotelId }, select: PARTNER_SELECT.eventClient });
  if (!source) return { synced: false };
  const fields = partnerFields(account.type, source);
  // Etkinlik müşterisi kartında vade yok: carinin kendi vadesi korunur.
  const term = key === 'eventClientId' ? null : fields.paymentTermDays;
  // Ham SQL: sürüm damgası ilerlemez (cari kartı açık olan muhasebecinin formu bozulmaz).
  await prisma.$executeRaw`
    UPDATE "LedgerAccount" SET "name" = ${fields.name}, "taxOffice" = ${fields.taxOffice}, "taxNumber" = ${fields.taxNumber}, "contactName" = ${fields.contactName},
      "phone" = ${fields.phone}, "email" = ${fields.email}, "address" = ${fields.address},
      "paymentTermDays" = COALESCE(${term}::int, "paymentTermDays")
    WHERE "id" = ${account.id} AND "hotelId" = ${hotelId}`;
  return { synced: true, accountId: account.id };
}

/* ─────────────── Hareket yazıcıları ─────────────── */

/**
 * Cari hareket + bakiye. Kaynak anahtarı zaten yazılmışsa bir şey yapmaz (tekrar işleme).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ hotelId: string, accountId: string, date: string, dueDate?: string | null, debit?: string, credit?: string, description: string,
 *   reference?: string | null, sourceType: string, sourceId: string, sourceKey: string, voucherId?: string | null, instrumentId?: string | null,
 *   reversalOfId?: string | null, createdBy?: string }} input
 * @returns {Promise<{ created: boolean, id: string }>}
 */
export async function postLedger(tx, input) {
  const existing = await tx.ledgerEntry.findFirst({ where: { hotelId: input.hotelId, sourceKey: input.sourceKey }, select: { id: true } });
  if (existing) return { created: false, id: existing.id };
  const debit = money(input.debit ?? 0);
  const credit = money(input.credit ?? 0);
  if (toDecimal(debit).isZero() === toDecimal(credit).isZero()) throw new ValidationError('Cari hareketin tek tarafı dolu olmalı');
  const entry = await tx.ledgerEntry.create({
    data: {
      hotelId: input.hotelId,
      accountId: input.accountId,
      date: dateOnly(input.date),
      dueDate: input.dueDate ? dateOnly(input.dueDate) : null,
      debit,
      credit,
      description: input.description.slice(0, 300),
      reference: input.reference?.slice(0, 60) ?? null,
      sourceType: /** @type {any} */ (input.sourceType),
      sourceId: input.sourceId,
      sourceKey: input.sourceKey,
      voucherId: input.voucherId ?? null,
      instrumentId: input.instrumentId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      createdBy: input.createdBy ?? currentActor(),
    },
    select: { id: true },
  });
  const changed = await tx.$executeRaw`
    UPDATE "LedgerAccount"
    SET "balance" = "balance" + ${debit}::numeric - ${credit}::numeric,
        "debitTotal" = "debitTotal" + ${debit}::numeric,
        "creditTotal" = "creditTotal" + ${credit}::numeric,
        "lastEntryOn" = GREATEST(COALESCE("lastEntryOn", ${input.date}::date), ${input.date}::date)
    WHERE "id" = ${input.accountId} AND "hotelId" = ${input.hotelId}`;
  if (changed !== 1) throw new NotFoundError('Cari bulunamadı');
  return { created: true, id: entry.id };
}

/**
 * Kasa / banka hareketi + bakiye (tutar işaretli: + giriş, − çıkış). Kaynak anahtarı tekrar işlenmez.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ hotelId: string, treasuryAccountId: string, date: string, amount: string, description: string, reference?: string | null,
 *   ledgerAccountId?: string | null, originalAmount?: string | null, originalCurrency?: string | null, exchangeRate?: string | null,
 *   sourceType: string, sourceId: string, sourceKey: string, voucherId?: string | null, instrumentId?: string | null,
 *   reversalOfId?: string | null, createdBy?: string }} input
 * @returns {Promise<{ created: boolean, id: string }>}
 */
export async function postTreasury(tx, input) {
  const existing = await tx.treasuryMovement.findFirst({ where: { hotelId: input.hotelId, sourceKey: input.sourceKey }, select: { id: true } });
  if (existing) return { created: false, id: existing.id };
  const amount = money(input.amount);
  if (toDecimal(amount).isZero()) throw new ValidationError('Kasa / banka hareketi sıfır olamaz');
  const movement = await tx.treasuryMovement.create({
    data: {
      hotelId: input.hotelId,
      treasuryAccountId: input.treasuryAccountId,
      date: dateOnly(input.date),
      amount,
      description: input.description.slice(0, 300),
      reference: input.reference?.slice(0, 60) ?? null,
      ledgerAccountId: input.ledgerAccountId ?? null,
      originalAmount: input.originalAmount ?? null,
      originalCurrency: input.originalCurrency ?? null,
      exchangeRate: input.exchangeRate ?? null,
      sourceType: /** @type {any} */ (input.sourceType),
      sourceId: input.sourceId,
      sourceKey: input.sourceKey,
      voucherId: input.voucherId ?? null,
      instrumentId: input.instrumentId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      createdBy: input.createdBy ?? currentActor(),
    },
    select: { id: true },
  });
  const changed = await tx.$executeRaw`
    UPDATE "TreasuryAccount"
    SET "balance" = "balance" + ${amount}::numeric,
        "lastMovementOn" = GREATEST(COALESCE("lastMovementOn", ${input.date}::date), ${input.date}::date)
    WHERE "id" = ${input.treasuryAccountId} AND "hotelId" = ${input.hotelId}`;
  if (changed !== 1) throw new NotFoundError('Kasa / banka hesabı bulunamadı');
  return { created: true, id: movement.id };
}

/**
 * Kayıtların ters kaydı (fiş / çek iptali): borç ↔ alacak, tutar ↔ eksi tutar; anahtar "REVERSAL:<id>".
 * Zaten ters kaydı olan satır atlanır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId
 * @param {{ ledgerEntryIds?: string[], treasuryMovementIds?: string[], date: string, note: string }} input
 */
export async function reverseRecords(tx, hotelId, { ledgerEntryIds = [], treasuryMovementIds = [], date, note }) {
  const [entries, movements] = await Promise.all([
    ledgerEntryIds.length ? tx.ledgerEntry.findMany({ where: { hotelId, id: { in: ledgerEntryIds }, reversal: null, reversalOfId: null } }) : [],
    treasuryMovementIds.length ? tx.treasuryMovement.findMany({ where: { hotelId, id: { in: treasuryMovementIds }, reversal: null, reversalOfId: null } }) : [],
  ]);
  for (const entry of entries) {
    await postLedger(tx, {
      hotelId,
      accountId: entry.accountId,
      date,
      dueDate: null,
      debit: money(entry.credit),
      credit: money(entry.debit),
      description: `İptal: ${entry.description} — ${note}`,
      reference: entry.reference,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      sourceKey: `REVERSAL:${entry.id}`,
      voucherId: entry.voucherId,
      instrumentId: entry.instrumentId,
      reversalOfId: entry.id,
    });
  }
  for (const movement of movements) {
    await postTreasury(tx, {
      hotelId,
      treasuryAccountId: movement.treasuryAccountId,
      date,
      amount: toMoneyString(toDecimal(String(movement.amount)).negated()),
      description: `İptal: ${movement.description} — ${note}`,
      reference: movement.reference,
      ledgerAccountId: movement.ledgerAccountId,
      originalAmount: movement.originalAmount === null ? null : toMoneyString(toDecimal(String(movement.originalAmount)).negated()),
      originalCurrency: movement.originalCurrency,
      exchangeRate: movement.exchangeRate === null ? null : String(movement.exchangeRate),
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      sourceKey: `REVERSAL:${movement.id}`,
      voucherId: movement.voucherId,
      instrumentId: movement.instrumentId,
      reversalOfId: movement.id,
    });
  }
  return { ledger: entries.length, treasury: movements.length, ledgerAccountIds: [...new Set(entries.map((entry) => entry.accountId))], treasuryAccountIds: [...new Set(movements.map((movement) => movement.treasuryAccountId))] };
}

/**
 * Kasa eksiye düşmez (elle fiş ve iptal): kilitli hesabın bakiyesi çıkışı karşılamalı. Banka eksiye düşebilir
 * (kredili mevduat). Otomatik tahsilat / iade kaydı bu denetimden geçmez — para zaten kasada el değiştirdi.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} treasuryAccountId @param {string} outflow pozitif
 */
export async function assertCashCovers(tx, hotelId, treasuryAccountId, outflow) {
  const account = await tx.treasuryAccount.findFirst({ where: { id: treasuryAccountId, hotelId }, select: { kind: true, name: true, balance: true, currency: true } });
  if (!account) throw new NotFoundError('Kasa / banka hesabı bulunamadı');
  if (account.kind !== 'CASH') return;
  if (toDecimal(String(account.balance)).minus(toDecimal(outflow)).isNegative()) {
    throw new ConflictError(`${account.name} kasasında yeterli bakiye yok (bakiye ${priced(account.balance, account.currency)}, çıkış ${priced(outflow, account.currency)})`, 'CASH_INSUFFICIENT');
  }
}

/* ─────────────── İmleç (belge günü + kayıt anı + kimlik) ─────────────── */

/** @param {{ date: Date, createdAt: Date, id: string }} row */
export const encodeStatementCursor = (row) => Buffer.from(`${day(row.date)}|${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');

/** @param {string | undefined} value @returns {{ date: string, createdAt: Date, id: string } | null} */
export function decodeStatementCursor(value) {
  if (!value) return null;
  const [date, createdAt, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const at = new Date(createdAt ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? '')) throw new ValidationError('Geçersiz imleç');
  return { date, createdAt: at, id };
}

/** İmleç koşulu için zaman parametresi (oturum saat diliminden bağımsız). @param {Date} value */
export const cursorTime = (value) => sqlTimestamp(value);
