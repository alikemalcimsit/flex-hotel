import { randomUUID } from 'node:crypto';

/**
 * Ön muhasebe demo verisi (modül 47). `demo-data.mjs` satın almadan (45) sonra çağırır: demo ödemeleri, etkinlik
 * ve restoran tahsilatları, mal kabuller ve primler eşitlemeyle cariye / kasaya işlenir.
 *
 * Kurulan hikâye (hepsi gerçek servislerden — kilit, bakiye, olay ve denetim izi dahil):
 * - Başlangıç günü 30 gün önce; öncesi için kasa / banka ve bazı carilerin açılış bakiyesi (vadesi geçmiş
 *   acente alacağı ve tedarikçi borcu: yaşlandırma dolu).
 * - Kasalar: ön büro, restoran, EUR ve USD döviz kasası; bankalar: Ziraat (havale), İş Bankası (kart / sanal POS),
 *   Garanti EUR. Eşleme: nakit ön büro / restoran kasasına, döviz nakit döviz kasasına, kart ve sanal POS İş
 *   Bankası'na, havale Ziraat'e.
 * - Kurumsal misafir cariler (şirket): acentesiz rezervasyonda "Acente / cari" ile kapatılan folyolar bunlara yazılır.
 * - Fişler: acentelerden havale ve çekle tahsilat, tedarikçilere banka / ciro / verilen çekle ödeme, kasa → banka
 *   virmanı, kasa masrafı; eşik üstü bir ödeme fişi onay bekliyor (demo sırasında canlı onaylanır).
 * - Çekler: biri tedarikçiye ciro edildi, biri tahsile verildi, vadesi geçen tahsil edildi; verilen bir çek ödenecek.
 */

const COMPANIES = Object.freeze([
  { name: 'Demir Holding A.Ş.', taxNumber: '4810011111', taxOffice: 'Çankaya', contactName: 'Selin Demir', phone: '+903124550101', paymentTermDays: 30 },
  { name: 'Başkent Enerji Ltd.', taxNumber: '4810022222', taxOffice: 'Kavaklıdere', contactName: 'Murat Er', phone: '+903124550202', paymentTermDays: 15 },
  { name: 'Anka Savunma Sanayi A.Ş.', taxNumber: '4810033333', taxOffice: 'Ostim', contactName: 'Elif Kaya', phone: '+903124550303', paymentTermDays: 45 },
  { name: 'Yıldız Danışmanlık', taxNumber: '4810044444', taxOffice: 'Maltepe', contactName: 'Can Yıldız', phone: '+903124550404', paymentTermDays: 0 },
]);

/** Geçerli TR IBAN (denetim haneleri hesaplanır). @param {string} bban 22 hane */
function ibanOf(bban) {
  let remainder = 0;
  for (const digit of `${bban}292700`) remainder = (remainder * 10 + Number(digit)) % 97;
  return `TR${String(98 - remainder).padStart(2, '0')}${bban}`;
}

const TREASURY = Object.freeze([
  { key: 'onburo', kind: 'CASH', name: 'Ön büro kasası', currency: 'TRY', opening: '45000' },
  { key: 'restoran', kind: 'CASH', name: 'Restoran kasası', currency: 'TRY', opening: '12000' },
  { key: 'eur', kind: 'CASH', name: 'Döviz kasası EUR', currency: 'EUR', opening: '3500' },
  { key: 'usd', kind: 'CASH', name: 'Döviz kasası USD', currency: 'USD', opening: '1200' },
  { key: 'ziraat', kind: 'BANK', name: 'Ziraat Bankası TL', currency: 'TRY', bankName: 'Ziraat Bankası', branch: 'Kızılay', iban: ibanOf('0001000001234567890123'), opening: '1850000' },
  { key: 'is', kind: 'BANK', name: 'İş Bankası TL (POS)', currency: 'TRY', bankName: 'Türkiye İş Bankası', branch: 'Ulus', iban: ibanOf('0006400000123456789012'), opening: '640000' },
  { key: 'garanti', kind: 'BANK', name: 'Garanti BBVA EUR', currency: 'EUR', bankName: 'Garanti BBVA', branch: 'Tunalı', iban: ibanOf('0006200001234567890123'), opening: '28000' },
]);

/**
 * Demo otelinin bütün ön muhasebe kayıtları (kaynak belgeleri — ödemeler, mal kabuller, etkinlikler — demoyla
 * birlikte silindiği için kayıtlar da gider). Acente / tedarikçi / etkinlik müşterisi silinmeden ÖNCE çağrılır
 * (cari onlara kısıtlı bağlı).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId
 */
export async function resetAccountingDemo(tx, hotelId) {
  const run = (sql) => tx.$executeRawUnsafe(sql, hotelId);
  const voucherApprovals = `SELECT "id" FROM "Approval" WHERE "hotelId" = $1 AND "entityType" = 'AccountingVoucher'`;
  await run(`DELETE FROM "StaffAlert" WHERE "hotelId" = $1 AND "entityType" = 'Approval' AND "entityId" IN (${voucherApprovals})`);
  await run(`UPDATE "Payment" SET "ledgerAccountId" = NULL WHERE "hotelId" = $1 AND "ledgerAccountId" IS NOT NULL`);
  await run(`DELETE FROM "AccountingVoucherLine" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "InstrumentMovement" WHERE "hotelId" = $1`);
  // Ters kayıtlar asıllarına kısıtlı bağlı: önce onlar.
  await run(`DELETE FROM "LedgerEntry" WHERE "hotelId" = $1 AND "reversalOfId" IS NOT NULL`);
  await run(`DELETE FROM "LedgerEntry" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "TreasuryMovement" WHERE "hotelId" = $1 AND "reversalOfId" IS NOT NULL`);
  await run(`DELETE FROM "TreasuryMovement" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "Instrument" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "AccountingVoucher" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "PendingAction" WHERE "approvalId" IN (${voucherApprovals})`);
  await run(`DELETE FROM "Approval" WHERE "id" IN (${voucherApprovals})`);
  await run(`DELETE FROM "TreasuryMapping" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "TreasuryAccount" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "LedgerAccount" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "AccountingSettings" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "AccountingSequence" WHERE "hotelId" = $1`);
  await run(`DELETE FROM "ManualTask" WHERE "hotelId" = $1 AND "module" = 'Ön muhasebe'`);
}

/**
 * @param {{ prisma: any, core: any, contracts: any, hotelId: string, today: string, actor: string, addDays: (day: string, n: number) => string }} input
 */
export async function seedAccountingDemo({ prisma, core, contracts, hotelId, today, actor, addDays }) {
  const accounts = await import('../src/modules/accounting/accounts.js');
  const treasury = await import('../src/modules/accounting/treasury.js');
  const vouchers = await import('../src/modules/accounting/vouchers.js');
  const instruments = await import('../src/modules/accounting/instruments.js');
  const postings = await import('../src/modules/accounting/postings.js');
  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
  const startDate = addDays(today, -30);

  // Ayar: başlangıç 30 gün önce, ödeme fişi onay eşiği 75.000 TRY.
  const initial = await as(() => treasury.getSettings(hotelId));
  await as(() =>
    treasury.saveSettings(hotelId, contracts.accountingSettingsSchema.parse({ expectedUpdatedAt: initial.settings.updatedAt, startDate, paymentApprovalAmount: '75000' })),
  );

  // Kasa ve banka hesapları + açılış bakiyeleri.
  /** @type {Record<string, string>} */
  const ids = {};
  for (const row of TREASURY) {
    const { key, opening, ...input } = row;
    const created = await as(() => treasury.createTreasuryAccount(hotelId, contracts.treasuryAccountCreateSchema.parse(input)));
    ids[key] = created.account.id;
    await as(() => vouchers.createOpening(hotelId, contracts.openingBalanceSchema.parse({ requestId: randomUUID(), treasuryAccountId: ids[key], amount: opening })));
  }

  // Eşleme.
  const settings = await as(() => treasury.getSettings(hotelId));
  await as(() =>
    treasury.saveMappings(
      hotelId,
      contracts.treasuryMappingSchema.parse({
        expectedUpdatedAt: settings.mappingUpdatedAt,
        rows: [
          { channel: 'FRONT_DESK', method: 'CASH', currency: '', treasuryAccountId: ids.onburo },
          { channel: 'FRONT_DESK', method: 'CASH', currency: 'EUR', treasuryAccountId: ids.eur },
          { channel: 'FRONT_DESK', method: 'CASH', currency: 'USD', treasuryAccountId: ids.usd },
          { channel: 'FRONT_DESK', method: 'CARD', currency: '', treasuryAccountId: ids.is },
          { channel: 'FRONT_DESK', method: 'VIRTUAL_POS', currency: '', treasuryAccountId: ids.is },
          { channel: 'FRONT_DESK', method: 'TRANSFER', currency: '', treasuryAccountId: ids.ziraat },
          { channel: 'FRONT_DESK', method: 'TRANSFER', currency: 'EUR', treasuryAccountId: ids.garanti },
          { channel: 'BANQUET', method: 'CASH', currency: '', treasuryAccountId: ids.onburo },
          { channel: 'BANQUET', method: 'CARD', currency: '', treasuryAccountId: ids.is },
          { channel: 'BANQUET', method: 'VIRTUAL_POS', currency: '', treasuryAccountId: ids.is },
          { channel: 'BANQUET', method: 'TRANSFER', currency: '', treasuryAccountId: ids.ziraat },
          { channel: 'POS', method: 'CASH', currency: '', treasuryAccountId: ids.restoran },
          { channel: 'POS', method: 'CARD', currency: '', treasuryAccountId: ids.is },
        ],
      }),
    ),
  );

  // Kurumsal misafir carileri; acentesiz "Acente / cari" ödemeleri bunlara bağlanır (şirket misafiri).
  const companies = [];
  for (const company of COMPANIES) {
    companies.push((await as(() => accounts.createAccount(hotelId, contracts.ledgerAccountCreateSchema.parse({ type: 'COMPANY', ...company })))).account);
  }
  const loose = await prisma.$queryRaw`
    SELECT p."id" FROM "Payment" p JOIN "Reservation" r ON r."id" = p."reservationId"
    WHERE p."hotelId" = ${hotelId} AND p."method" IN ('AGENCY', 'VOUCHER') AND r."agencyId" IS NULL AND p."ledgerAccountId" IS NULL`;
  for (const [index, row] of loose.entries()) {
    await prisma.payment.update({ where: { id: row.id }, data: { ledgerAccountId: companies[index % companies.length].id } });
  }

  // Açılış: iki acenteye vadesi geçmiş alacak, iki tedarikçiye borcumuz (yaşlandırma dolsun).
  const [agencyAccounts, supplierAccounts] = await Promise.all([
    prisma.ledgerAccount.findMany({ where: { hotelId, type: 'AGENCY' }, orderBy: { name: 'asc' }, take: 3 }),
    prisma.ledgerAccount.findMany({ where: { hotelId, type: 'SUPPLIER', isActive: true }, orderBy: { name: 'asc' }, take: 3 }),
  ]);
  const openings = [
    ...agencyAccounts.slice(0, 2).map((account, index) => ({ ledgerAccountId: account.id, side: 'DEBIT', amount: index ? '86500' : '142300', dueDate: addDays(startDate, index ? -75 : -40) })),
    { ledgerAccountId: companies[0].id, side: 'DEBIT', amount: '38900', dueDate: addDays(startDate, -100) },
    ...supplierAccounts.slice(0, 2).map((account, index) => ({ ledgerAccountId: account.id, side: 'CREDIT', amount: index ? '54700' : '96200' })),
  ];
  for (const opening of openings) {
    await as(() => vouchers.createOpening(hotelId, contracts.openingBalanceSchema.parse({ requestId: randomUUID(), ...opening })));
  }

  // Dönemin otomatik kayıtları: ödemeler, etkinlik / restoran tahsilatları, mal kabuller, primler, etkinlik bedelleri.
  // Eşitleme süre sınırlı (istek başına); demo kalan kalmayana kadar tekrar çalıştırır. Hatalı belgeler her turda
  // yeniden seçildiğinden yeni kayıt yazmayan tur ilerleme sayılmaz (durur); hata sayısı son turunki.
  const sync = { posted: 0, failed: 0 };
  for (;;) {
    const round = await as(() => postings.syncPeriod(hotelId, { from: startDate, to: today }));
    sync.posted += round.posted;
    sync.failed = round.failed;
    if (!round.remaining || round.posted === 0) break;
  }

  // Fişler.
  const voucher = (input) => as(() => vouchers.createVoucher(hotelId, contracts.voucherCreateSchema.parse({ requestId: randomUUID(), date: today, ...input })));
  const [firstAgency, secondAgency] = agencyAccounts;
  const [firstSupplier, secondSupplier] = supplierAccounts;
  let made = 0;
  if (firstAgency) {
    await voucher({ type: 'COLLECTION', date: addDays(today, -12), ledgerAccountId: firstAgency.id, description: 'Eylül konaklamaları ödemesi', reference: 'HVL-2209', lines: [{ kind: 'TREASURY', amount: '60000', treasuryAccountId: ids.ziraat }] });
    await voucher({
      type: 'COLLECTION',
      date: addDays(today, -6),
      ledgerAccountId: firstAgency.id,
      description: 'Ekim ödemesi: çekle',
      lines: [
        { kind: 'CHEQUE_IN', amount: '45000', instrumentKind: 'CHEQUE', number: '7400151', bankName: 'Akbank', branch: 'Kızılay', drawer: firstAgency.name, dueDate: addDays(today, 25) },
        { kind: 'CHEQUE_IN', amount: '30000', instrumentKind: 'CHEQUE', number: '7400152', bankName: 'Akbank', branch: 'Kızılay', drawer: firstAgency.name, dueDate: addDays(today, 3) },
      ],
    });
    made += 2;
  }
  if (secondAgency) {
    await voucher({
      type: 'COLLECTION',
      date: addDays(today, -20),
      ledgerAccountId: secondAgency.id,
      description: 'Ağustos kalan bakiye',
      lines: [{ kind: 'CHEQUE_IN', amount: '18500', instrumentKind: 'CHEQUE', number: '3100877', bankName: 'Yapı Kredi', drawer: secondAgency.name, dueDate: addDays(today, -2) }],
    });
    await voucher({ type: 'COLLECTION', date: addDays(today, -3), ledgerAccountId: companies[0].id, description: 'Kurumsal konaklama ödemesi', lines: [{ kind: 'TREASURY', amount: '25000', treasuryAccountId: ids.ziraat }] });
    made += 2;
  }
  if (firstSupplier) {
    const cheque = await prisma.instrument.findFirst({ where: { hotelId, number: '7400151' } });
    await voucher({
      type: 'PAYMENT',
      date: addDays(today, -4),
      ledgerAccountId: firstSupplier.id,
      description: 'Ekim faturaları ödemesi',
      lines: [
        { kind: 'TREASURY', amount: '20000', treasuryAccountId: ids.ziraat },
        ...(cheque ? [{ kind: 'ENDORSE', amount: '45000', instrumentId: cheque.id }] : []),
      ],
    });
    // Eşik üstü: onay bekliyor (demo sırasında canlı onaylanır).
    await voucher({ type: 'PAYMENT', ledgerAccountId: firstSupplier.id, description: 'Kasım avans ödemesi', reference: 'TLP-1101', lines: [{ kind: 'TREASURY', amount: '82500', treasuryAccountId: ids.ziraat }] });
    made += 2;
  }
  if (secondSupplier) {
    await voucher({
      type: 'PAYMENT',
      date: addDays(today, -2),
      ledgerAccountId: secondSupplier.id,
      description: 'Vadeli ödeme: firma çeki',
      lines: [{ kind: 'CHEQUE_OUT', amount: '32000', instrumentKind: 'CHEQUE', number: 'ZRT-000412', bankName: 'Ziraat Bankası', branch: 'Kızılay', dueDate: addDays(today, 30), treasuryAccountId: ids.ziraat }],
    });
    made += 1;
  }
  await voucher({ type: 'TRANSFER', date: addDays(today, -1), treasuryAccountId: ids.onburo, targetTreasuryAccountId: ids.ziraat, amount: '30000', description: 'Kasa fazlası bankaya yatırıldı' });
  await voucher({ type: 'TREASURY_OUT', date: addDays(today, -1), treasuryAccountId: ids.onburo, amount: '1850', description: 'Kırtasiye ve kargo masrafı' });
  await voucher({ type: 'TREASURY_OUT', treasuryAccountId: ids.is, amount: '2740.50', description: 'POS komisyonu (Ekim)' });
  made += 3;

  // Çeklerin yolculuğu: biri tahsile verildi, vadesi geçen tahsil edildi (biri yukarıda tedarikçiye ciro edildi).
  const act = async (number, action, extra = {}) => {
    const row = await prisma.instrument.findFirst({ where: { hotelId, number } });
    if (!row) return;
    await as(() => instruments.applyInstrumentAction(hotelId, row.id, contracts.instrumentActionSchema.parse({ expectedUpdatedAt: row.updatedAt, action, date: today, ...extra })));
  };
  await act('7400152', 'DEPOSIT', { treasuryAccountId: ids.ziraat });
  await act('3100877', 'DEPOSIT', { treasuryAccountId: ids.ziraat });
  await act('3100877', 'COLLECT');

  const [instrumentCount, voucherCount, accountCount] = await Promise.all([
    prisma.instrument.count({ where: { hotelId } }),
    prisma.accountingVoucher.count({ where: { hotelId } }),
    prisma.ledgerAccount.count({ where: { hotelId } }),
  ]);
  return { accounts: accountCount, treasury: TREASURY.length, vouchers: voucherCount, manualVouchers: made, instruments: instrumentCount, posted: sync.posted, failed: sync.failed, startDate };
}
