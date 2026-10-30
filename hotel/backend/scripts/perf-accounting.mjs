import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Ön muhasebe uçlarının büyük veride süresi (modül 47; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-accounting.mjs
 *
 * Ölçüm otelinde (perf-agencies / perf-banquet / perf-pos / perf-purchasing verisi: 3.001 acente, 200 tedarikçi,
 * 20.000 etkinlik müşterisi, ~737.000 restoran ödemesi, 8.000 mal kabul) 2.500 kişilik otelin üç yıllık ön
 * muhasebesi kurulur (yoksa; varsa tekrar kurmaz):
 * - ~25.200 cari (acente ve tedarikçi kartlarından, bütün etkinlik müşterileri, 2.000 şirket / şahıs).
 * - 600.000 cari hareket: üç yıla yayılmış; 20 "dev" acentede 10.000'er hareket (yaşlandırma ve ekstrenin en
 *   kötü hâli), kalanı carilere dağılmış; borçların vadesi var. Bakiyeler hareketlerden toplanır.
 * - 12 kasa / banka, 500.000 kasa / banka hareketi (günde ~450), 30.000 fiş, 8.000 çek / senet (bütün durumlar).
 * - Restoran eşlemesi (nakit / kart) ve başlangıç günü üç yıl önce.
 *
 * Ölçülen: cari listesi (ilk sayfa, bakiyeye göre, arama, tür, borçlu, derin sayfa), seçici, dev carinin kartı
 * (yaşlandırma dahil) ve ekstresi (yıl, üç yıl, imleçle 20. sayfa), yaşlandırma raporu (alacak, borç, tür, derin
 * sayfa), kasa / banka listesi ve hareketleri (ay, üç yıl, kaynak süzgeci, imleçle derin sayfa), fiş listesi
 * (ilk sayfa, arama, derin sayfa), çek / senet portföyü (açık, vade aralığı, arama), ayar; yazma yolu (tahsilat
 * fişi + iki çek, ödeme fişi, virman, fiş iptali, çek tahsile ver + tahsil, restoran ödemesinin kaydı, bir günün
 * restoran ödemelerinin eşitlemesi ve 30 günlük eşitleme — süre sınırına kadar işler, kalanı sayar); sonunda sorgu planları.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 5);
const ACTOR = 'perf-accounting';
const MANUAL_ACCOUNTS = 2000;
const ENTRIES = 600_000;
const HEAVY_ACCOUNTS = 20;
const HEAVY_ENTRIES = 10_000;
const TREASURY_ACCOUNTS = 12;
const MOVEMENTS = 500_000;
const VOUCHERS = 30_000;
const INSTRUMENTS = 8_000;
const HISTORY_DAYS = 3 * 365;
const CHUNK = 5000;

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const shared = await import('../src/modules/accounting/shared.js');
const accounts = await import('../src/modules/accounting/accounts.js');
const treasury = await import('../src/modules/accounting/treasury.js');
const vouchers = await import('../src/modules/accounting/vouchers.js');
const instruments = await import('../src/modules/accounting/instruments.js');
const postings = await import('../src/modules/accounting/postings.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
const today = core.toIsoDay(core.calendarDateInTimeZone(hotel.timezone));
const day = (offset) => core.toIsoDay(core.addDays(new Date(`${today}T00:00:00.000Z`), offset));
const dateOnly = (text) => new Date(`${text}T00:00:00.000Z`);
const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: ACTOR }, fn);
let seed = 47_2026;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));
const amount = (min, max) => (min + rand() * (max - min)).toFixed(2);
const insertChunks = async (model, rows) => {
  for (let index = 0; index < rows.length; index += CHUNK) await prisma[model].createMany({ data: rows.slice(index, index + CHUNK) });
};

/* ══════════════════ Kurulum ══════════════════ */

const ready = (await prisma.ledgerEntry.count({ where: { hotelId, createdBy: ACTOR } })) >= ENTRIES;
if (!ready) {
  console.log('Kurulum: cariler, hareketler, kasa / banka, fişler, çekler…');
  const started = performance.now();
  await shared.ensureSettings(hotelId, today);
  await prisma.accountingSettings.update({ where: { hotelId }, data: { startDate: dateOnly(day(-HISTORY_DAYS)), paymentApprovalAmount: '0' } });

  // Cariler: acente / tedarikçi (kartlardan), bütün etkinlik müşterileri, şirket / şahıs.
  await shared.openPartnerAccounts(hotelId);
  const clients = await prisma.eventClient.findMany({ where: { hotelId, ledgerAccount: { is: null } }, select: { id: true, type: true, name: true, taxNumber: true } });
  let clientNo = await prisma.$transaction((tx) => shared.nextSequence(tx, hotelId, 'PERFEC', 0, clients.length));
  await insertChunks(
    'ledgerAccount',
    clients.map((client) => ({ hotelId, code: `EC-${String(clientNo--).padStart(6, '0')}`, name: client.name, type: client.type === 'PERSON' ? 'PERSON' : 'COMPANY', eventClientId: client.id, taxNumber: client.taxNumber, createdBy: ACTOR })),
  );
  await insertChunks(
    'ledgerAccount',
    Array.from({ length: MANUAL_ACCOUNTS }, (_, index) => ({
      hotelId,
      code: `PF-${String(index + 1).padStart(5, '0')}`,
      name: `${pick(['Anadolu', 'Başkent', 'Ege', 'Karadeniz', 'Marmara', 'Toros'])} ${pick(['Holding', 'Danışmanlık', 'Enerji', 'İnşaat', 'Lojistik', 'Sağlık'])} ${String(index).padStart(4, '0')}`,
      type: index % 5 === 0 ? 'PERSON' : 'COMPANY',
      taxNumber: String(5_000_000_000 + index),
      paymentTermDays: pick([0, 15, 30, 45, 60]),
      createdBy: ACTOR,
    })),
  );
  const all = await prisma.ledgerAccount.findMany({ where: { hotelId }, select: { id: true, type: true, agencyId: true } });
  const agencies = all.filter((row) => row.agencyId);
  const heavy = agencies.slice(0, HEAVY_ACCOUNTS);
  const rest = all.filter((row) => !heavy.includes(row));

  // Cari hareketleri: dev acentelerde 10.000'er, kalanı rastgele carilere; borç / alacak karışık, borçların vadesi var.
  const entries = [];
  const entryOf = (account, index) => {
    const offset = between(0, HISTORY_DAYS);
    const date = day(-offset);
    const debit = rand() < 0.62;
    return {
      hotelId,
      accountId: account.id,
      date: dateOnly(date),
      dueDate: debit ? dateOnly(day(-offset + pick([0, 15, 30, 45]))) : null,
      debit: debit ? amount(800, 45_000) : '0',
      credit: debit ? '0' : amount(500, 60_000),
      description: debit ? 'Folyo cariye aktarıldı (ölçüm)' : 'Tahsilat (ölçüm)',
      sourceType: debit ? 'FOLIO_TRANSFER' : 'VOUCHER',
      sourceId: randomUUID(),
      sourceKey: `PERF:${index}`,
      createdBy: ACTOR,
      createdAt: new Date(dateOnly(date).getTime() + between(0, 86_399_000)),
    };
  };
  let index = 0;
  for (const account of heavy) for (let n = 0; n < HEAVY_ENTRIES; n += 1) entries.push(entryOf(account, index++));
  while (index < ENTRIES) entries.push(entryOf(pick(rest), index++));
  await insertChunks('ledgerEntry', entries);
  await prisma.$executeRaw`
    UPDATE "LedgerAccount" a SET "debitTotal" = s."d", "creditTotal" = s."c", "balance" = s."d" - s."c", "lastEntryOn" = s."last"
    FROM (SELECT "accountId", sum("debit") AS "d", sum("credit") AS "c", max("date") AS "last" FROM "LedgerEntry" WHERE "hotelId" = ${hotelId} GROUP BY "accountId") s
    WHERE a."id" = s."accountId"`;

  // Kasa / banka ve hareketleri.
  const treasuries = [];
  for (let n = 0; n < TREASURY_ACCOUNTS; n += 1) {
    const bank = n >= 4;
    treasuries.push(
      (
        await as(() =>
          treasury.createTreasuryAccount(
            hotelId,
            contracts.treasuryAccountCreateSchema.parse({ kind: bank ? 'BANK' : 'CASH', name: `${bank ? 'Banka' : 'Kasa'} ${n + 1}`, currency: 'TRY', ...(bank ? { bankName: `Banka ${n + 1}` } : {}) }),
          ),
        )
      ).account,
    );
  }
  const movements = Array.from({ length: MOVEMENTS }, (_, n) => {
    const offset = between(0, HISTORY_DAYS);
    const inflow = rand() < 0.7;
    return {
      hotelId,
      treasuryAccountId: pick(treasuries).id,
      date: dateOnly(day(-offset)),
      amount: inflow ? amount(100, 20_000) : `-${amount(100, 9_000)}`,
      description: inflow ? 'Tahsilat (ölçüm)' : 'Ödeme (ölçüm)',
      sourceType: pick(['FOLIO_PAYMENT', 'POS_PAYMENT', 'EVENT_PAYMENT', 'VOUCHER']),
      sourceId: randomUUID(),
      sourceKey: `PERFM:${n}`,
      createdBy: ACTOR,
      createdAt: new Date(dateOnly(day(-offset)).getTime() + between(0, 86_399_000)),
    };
  });
  await insertChunks('treasuryMovement', movements);
  await prisma.$executeRaw`
    UPDATE "TreasuryAccount" a SET "balance" = s."total", "lastMovementOn" = s."last"
    FROM (SELECT "treasuryAccountId", sum("amount") AS "total", max("date") AS "last" FROM "TreasuryMovement" WHERE "hotelId" = ${hotelId} GROUP BY "treasuryAccountId") s
    WHERE a."id" = s."treasuryAccountId"`;

  // Fişler (giriş / çıkış biçiminde) ve çekler (tahsilat fişlerine bağlı).
  const voucherRows = Array.from({ length: VOUCHERS }, (_, n) => {
    const offset = between(0, HISTORY_DAYS);
    const type = n % 2 ? 'TREASURY_IN' : 'TREASURY_OUT';
    return {
      hotelId,
      number: `${type === 'TREASURY_IN' ? 'GIR' : 'CIK'}-PF-${String(n).padStart(6, '0')}`,
      type,
      status: n % 97 === 0 ? 'VOIDED' : 'POSTED',
      date: dateOnly(day(-offset)),
      treasuryAccountId: pick(treasuries).id,
      amount: amount(100, 15_000),
      description: pick(['Banka faizi', 'Kırtasiye', 'POS komisyonu', 'Kargo', 'Elektrik', 'Kasa farkı']),
      requestId: randomUUID(),
      createdBy: ACTOR,
      postedAt: new Date(),
      ...(n % 97 === 0 ? { voidedAt: new Date(), voidedBy: ACTOR, voidReason: 'Ölçüm iptali' } : {}),
    };
  });
  await insertChunks('accountingVoucher', voucherRows);
  const holders = [];
  for (let n = 0; n < INSTRUMENTS / 50; n += 1) {
    holders.push({ id: randomUUID(), hotelId, number: `TAH-PF-${String(n).padStart(5, '0')}`, type: 'COLLECTION', status: 'POSTED', date: dateOnly(day(-between(0, 400))), ledgerAccountId: pick(agencies).id, amount: '1000', description: 'Çek tahsilatı (ölçüm)', requestId: randomUUID(), createdBy: ACTOR, postedAt: new Date() });
  }
  await insertChunks('accountingVoucher', holders);
  const STATUSES = [
    ['RECEIVED', 'PORTFOLIO'],
    ['RECEIVED', 'AT_BANK'],
    ['RECEIVED', 'COLLECTED'],
    ['RECEIVED', 'ENDORSED'],
    ['RECEIVED', 'BOUNCED'],
    ['ISSUED', 'OUTSTANDING'],
    ['ISSUED', 'PAID'],
  ];
  const banks = treasuries.filter((row) => row.kind === 'BANK');
  await insertChunks(
    'instrument',
    Array.from({ length: INSTRUMENTS }, (_, n) => {
      const [direction, status] = pick(STATUSES);
      const holder = holders[Math.floor(n / 50)];
      const issue = day(-between(0, 400));
      return {
        hotelId,
        kind: rand() < 0.85 ? 'CHEQUE' : 'NOTE',
        direction,
        status,
        number: `PF${String(n).padStart(7, '0')}`,
        bankName: pick(['Akbank', 'Garanti BBVA', 'Ziraat', 'Yapı Kredi', 'İş Bankası']),
        issueDate: dateOnly(issue),
        dueDate: dateOnly(core.toIsoDay(core.addDays(dateOnly(issue), between(0, 180)))),
        amount: amount(2000, 250_000),
        currency: 'TRY',
        ledgerAccountId: holder.ledgerAccountId,
        endorsedToAccountId: status === 'ENDORSED' ? pick(rest).id : null,
        treasuryAccountId: status === 'AT_BANK' || direction === 'ISSUED' ? pick(banks).id : null,
        voucherId: holder.id,
        createdBy: ACTOR,
      };
    }),
  );
  console.log(`Kurulum bitti: ${((performance.now() - started) / 1000).toFixed(1)} sn`);
}

// Restoran eşlemesi (ölçülen eşitleme için).
const treasuryRows = await prisma.treasuryAccount.findMany({ where: { hotelId }, orderBy: { code: 'asc' } });
const cash = treasuryRows.find((row) => row.kind === 'CASH');
const bank = treasuryRows.find((row) => row.kind === 'BANK');
const current = await treasury.getSettings(hotelId);
if (!current.mappings.some((row) => row.channel === 'POS')) {
  await as(() =>
    treasury.saveMappings(
      hotelId,
      contracts.treasuryMappingSchema.parse({
        expectedUpdatedAt: current.mappingUpdatedAt,
        rows: [
          { channel: 'POS', method: 'CASH', currency: '', treasuryAccountId: cash.id },
          { channel: 'POS', method: 'CARD', currency: '', treasuryAccountId: bank.id },
        ],
      }),
    ),
  );
}

/* ══════════════════ Ölçüm ══════════════════ */

const results = [];
async function measure(name, fn, rounds = ROUNDS) {
  const times = [];
  let last;
  for (let round = 0; round < rounds; round += 1) {
    const begin = performance.now();
    last = await fn(round);
    times.push(performance.now() - begin);
  }
  const sorted = (rounds > 1 ? times.slice(1) : times).sort((a, b) => a - b);
  results.push({ name, best: sorted[0], median: sorted[Math.floor(sorted.length / 2)], worst: sorted.at(-1) });
  return last;
}
const parse = (schema, input) => contracts[schema].parse(input);

const heavyAccount = (await prisma.$queryRaw`SELECT "accountId" AS id FROM "LedgerEntry" WHERE "hotelId" = ${hotelId} GROUP BY "accountId" ORDER BY count(*) DESC LIMIT 1`)[0];
const smallAccount = await prisma.ledgerAccount.findFirst({ where: { hotelId, type: 'COMPANY', createdBy: ACTOR }, select: { id: true } });
const busyTreasury = (await prisma.$queryRaw`SELECT "treasuryAccountId" AS id FROM "TreasuryMovement" WHERE "hotelId" = ${hotelId} GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`)[0];

const list = await measure('cariler (ilk sayfa)', () => accounts.listAccounts(hotelId, parse('ledgerAccountListQuerySchema', {})));
await measure('cariler (bakiyeye göre)', () => accounts.listAccounts(hotelId, parse('ledgerAccountListQuerySchema', { sort: 'balance' })));
await measure('cariler (arama)', () => accounts.listAccounts(hotelId, parse('ledgerAccountListQuerySchema', { search: 'Holding 004' })));
await measure('cariler (acente, borçlu)', () => accounts.listAccounts(hotelId, parse('ledgerAccountListQuerySchema', { type: 'AGENCY', balance: 'DEBIT' })));
await measure('cariler (derin sayfa 500)', () => accounts.listAccounts(hotelId, parse('ledgerAccountListQuerySchema', { page: 500 })));
await measure('cari seçici (boş / arama)', async () => {
  await accounts.pickAccounts(hotelId, parse('ledgerAccountPickerQuerySchema', {}));
  return accounts.pickAccounts(hotelId, parse('ledgerAccountPickerQuerySchema', { search: 'Ege' }));
});
await measure('dev cari kartı (yaşlandırma dahil)', () => accounts.getAccount(hotelId, heavyAccount.id));
await measure('ekstre dev cari (bu yıl)', () => accounts.getStatement(hotelId, heavyAccount.id, parse('statementQuerySchema', {})));
await measure('ekstre dev cari (3 yıl, ilk sayfa)', () => accounts.getStatement(hotelId, heavyAccount.id, parse('statementQuerySchema', { from: day(-HISTORY_DAYS), to: today })));
await measure('ekstre dev cari (imleçle 20. sayfa)', async () => {
  let cursor;
  let page;
  for (let n = 0; n < 20; n += 1) {
    page = await accounts.getStatement(hotelId, heavyAccount.id, parse('statementQuerySchema', { from: day(-HISTORY_DAYS), to: today, cursor }));
    cursor = page.nextCursor ?? undefined;
  }
  return page;
}, 2);
await measure('ekstre küçük cari', () => accounts.getStatement(hotelId, smallAccount.id, parse('statementQuerySchema', { from: day(-HISTORY_DAYS), to: today })));
const aging = await measure('yaşlandırma (alacak, ilk sayfa)', () => accounts.agingReport(hotelId, parse('agingQuerySchema', {})));
await measure('yaşlandırma (borç)', () => accounts.agingReport(hotelId, parse('agingQuerySchema', { side: 'CREDIT' })));
await measure('yaşlandırma (acente)', () => accounts.agingReport(hotelId, parse('agingQuerySchema', { type: 'AGENCY' })));
await measure('yaşlandırma (derin sayfa 100)', () => accounts.agingReport(hotelId, parse('agingQuerySchema', { page: 100 })));
await measure('kasa / banka listesi', () => treasury.listTreasuryAccounts(hotelId, {}));
await measure('hareketler (bu ay)', () => treasury.listMovements(hotelId, busyTreasury.id, parse('treasuryMovementsQuerySchema', {})));
await measure('hareketler (3 yıl, ilk sayfa)', () => treasury.listMovements(hotelId, busyTreasury.id, parse('treasuryMovementsQuerySchema', { from: day(-HISTORY_DAYS), to: today })));
await measure('hareketler (kaynak süzgeci)', () => treasury.listMovements(hotelId, busyTreasury.id, parse('treasuryMovementsQuerySchema', { from: day(-HISTORY_DAYS), to: today, source: 'POS_PAYMENT' })));
await measure('hareketler (imleçle 20. sayfa)', async () => {
  let cursor;
  let page;
  for (let n = 0; n < 20; n += 1) {
    page = await treasury.listMovements(hotelId, busyTreasury.id, parse('treasuryMovementsQuerySchema', { from: day(-HISTORY_DAYS), to: today, cursor }));
    cursor = page.nextCursor ?? undefined;
  }
  return page;
}, 2);
await measure('fişler (ilk sayfa)', () => vouchers.listVouchers(hotelId, parse('voucherListQuerySchema', {})));
await measure('fişler (arama)', () => vouchers.listVouchers(hotelId, parse('voucherListQuerySchema', { search: 'komisyon' })));
await measure('fişler (derin sayfa 500)', () => vouchers.listVouchers(hotelId, parse('voucherListQuerySchema', { page: 500 })));
await measure('çek / senet (açık)', () => instruments.listInstruments(hotelId, parse('instrumentListQuerySchema', { status: 'OPEN' })));
await measure('çek / senet (vade 30 gün)', () => instruments.listInstruments(hotelId, parse('instrumentListQuerySchema', { dueFrom: today, dueTo: day(30) })));
await measure('çek / senet (arama)', () => instruments.listInstruments(hotelId, parse('instrumentListQuerySchema', { search: 'PF00042' })));
await measure('ayar', () => treasury.getSettings(hotelId));

// Yazma yolu.
const agency = await prisma.ledgerAccount.findFirst({ where: { hotelId, id: heavyAccount.id } });
await measure(
  'tahsilat fişi (kasa + 2 çek)',
  (round) =>
    as(() =>
      vouchers.createVoucher(
        hotelId,
        parse('voucherCreateSchema', {
          requestId: randomUUID(),
          type: 'COLLECTION',
          date: today,
          ledgerAccountId: agency.id,
          description: 'Ölçüm tahsilatı',
          lines: [
            { kind: 'TREASURY', amount: '1500', treasuryAccountId: cash.id },
            { kind: 'CHEQUE_IN', amount: '7000', instrumentKind: 'CHEQUE', number: `PW-${Date.now()}-${round}-1`, bankName: 'Akbank', dueDate: day(30) },
            { kind: 'CHEQUE_IN', amount: '8000', instrumentKind: 'CHEQUE', number: `PW-${Date.now()}-${round}-2`, bankName: 'Akbank', dueDate: day(60) },
          ],
        }),
      ),
    ),
);
const payment = await measure('ödeme fişi (banka)', () =>
  as(() => vouchers.createVoucher(hotelId, parse('voucherCreateSchema', { requestId: randomUUID(), type: 'PAYMENT', date: today, ledgerAccountId: agency.id, description: 'Ölçüm ödemesi', lines: [{ kind: 'TREASURY', amount: '2500', treasuryAccountId: bank.id }] }))),
);
await measure('virman (kasa → banka)', () =>
  as(() => vouchers.createVoucher(hotelId, parse('voucherCreateSchema', { requestId: randomUUID(), type: 'TRANSFER', date: today, treasuryAccountId: cash.id, targetTreasuryAccountId: bank.id, amount: '100', description: 'Ölçüm virmanı' }))),
);
await measure('fiş iptali (ters kayıt)', () => as(() => vouchers.voidVoucher(hotelId, payment.voucher.id, { reason: 'Ölçüm iptali' })), 1);
const cheque = await prisma.instrument.findFirst({ where: { hotelId, status: 'PORTFOLIO', number: { startsWith: 'PW-' } } });
await measure(
  'çek tahsile ver + tahsil',
  async () => {
    const fresh = await prisma.instrument.findUnique({ where: { id: cheque.id } });
    await as(() => instruments.applyInstrumentAction(hotelId, cheque.id, parse('instrumentActionSchema', { expectedUpdatedAt: fresh.updatedAt, action: 'DEPOSIT', date: today, treasuryAccountId: bank.id })));
    const after = await prisma.instrument.findUnique({ where: { id: cheque.id } });
    return as(() => instruments.applyInstrumentAction(hotelId, cheque.id, parse('instrumentActionSchema', { expectedUpdatedAt: after.updatedAt, action: 'COLLECT', date: today })));
  },
  1,
);
// Restoran ödemeleri: başlangıç günü bir gün önceye çekilip son günün ödemeleri eşitlenir (ilk sefer gerçekten yazar).
const lastPosDay = (await prisma.$queryRaw`SELECT max("businessDate")::text AS d FROM "PosPayment" WHERE "hotelId" = ${hotelId} AND "status" = 'POSTED'`)[0].d;
const onePos = await prisma.posPayment.findFirst({ where: { hotelId, status: 'POSTED', businessDate: dateOnly(lastPosDay), kind: 'PAYMENT' }, select: { id: true } });
await measure('restoran ödemesinin kaydı (tek)', () => postings.syncPosPayment(hotelId, onePos.id), 1);
const sync = await measure('eşitleme: son günün restoran ödemeleri', () => as(() => postings.syncPeriod(hotelId, { from: lastPosDay, to: lastPosDay })), 1);
const month = await measure('eşitleme (30 gün, süre sınırlı)', () => as(() => postings.syncPeriod(hotelId, { from: core.toIsoDay(core.addDays(dateOnly(lastPosDay), -30)), to: lastPosDay })), 1);

const plans = {};
const capture = async (name, sql) => {
  const explained = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  plans[name] = explained.map((row) => row['QUERY PLAN']).filter((text) => /Index|Execution Time|Seq Scan|Bitmap|Sort Method/.test(text));
};
await capture(
  'ekstre sayfası (dev cari)',
  Prisma.sql`SELECT "id" FROM "LedgerEntry" WHERE "accountId" = ${heavyAccount.id} AND "hotelId" = ${hotelId} AND "date" BETWEEN ${day(-HISTORY_DAYS)}::date AND ${today}::date ORDER BY "date", "createdAt", "id" LIMIT 101`,
);
await capture('devir (dev cari)', Prisma.sql`SELECT COALESCE(sum("debit" - "credit"), 0) FROM "LedgerEntry" WHERE "accountId" = ${heavyAccount.id} AND "hotelId" = ${hotelId} AND "date" < ${day(-30)}::date`);
await capture(
  'yaşlandırma (alacak, cari başına kapsayan index)',
  Prisma.sql`SELECT count(*) FROM "LedgerAccount" a CROSS JOIN LATERAL (
    SELECT sum(e."debit") OVER (ORDER BY e."date" DESC, e."createdAt" DESC, e."id" DESC) - e."debit" AS "before"
    FROM "LedgerEntry" e WHERE e."accountId" = a."id" AND e."hotelId" = ${hotelId} AND e."debit" > 0) p
    WHERE a."hotelId" = ${hotelId} AND a."isActive" AND a."balance" > 0 AND p."before" < a."balance"`,
);
await capture('cari listesi (bakiyeye göre)', Prisma.sql`SELECT "id" FROM "LedgerAccount" WHERE "hotelId" = ${hotelId} AND "isActive" ORDER BY "balance" DESC, "id" LIMIT 25`);
await capture(
  'eşitleme taraması (restoran, 30 gün)',
  Prisma.sql`SELECT p."id" FROM "PosPayment" p WHERE p."hotelId" = ${hotelId} AND p."status" = 'POSTED' AND p."businessDate" BETWEEN ${core.toIsoDay(core.addDays(dateOnly(lastPosDay), -30))}::date AND ${lastPosDay}::date
    AND NOT EXISTS (SELECT 1 FROM "TreasuryMovement" m WHERE m."hotelId" = ${hotelId} AND m."sourceKey" = 'POS_PAYMENT:' || p."id") LIMIT 2001`,
);

const pad = (text, width) => String(text).padEnd(width);
const counts = await prisma.$queryRaw`
  SELECT (SELECT count(*) FROM "LedgerAccount" WHERE "hotelId" = ${hotelId})::int AS "accounts", (SELECT count(*) FROM "LedgerEntry" WHERE "hotelId" = ${hotelId})::int AS "entries",
         (SELECT count(*) FROM "TreasuryMovement" WHERE "hotelId" = ${hotelId})::int AS "movements", (SELECT count(*) FROM "AccountingVoucher" WHERE "hotelId" = ${hotelId})::int AS "vouchers",
         (SELECT count(*) FROM "Instrument" WHERE "hotelId" = ${hotelId})::int AS "instruments"`;
console.log(`\nÖlçüm verisi: ${JSON.stringify(counts[0])}; cari listesi ${list.meta.total}, yaşlandırmada ${aging.meta.total} borçlu cari; eşitleme ${JSON.stringify({ posted: sync.posted, skipped: sync.skipped, failed: sync.failed })}; 30 günlük eşitleme ${JSON.stringify({ posted: month.posted, skipped: month.skipped, failed: month.failed, remaining: month.remaining })}`);
console.log(`\n${pad('ölçüm', 52)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) console.log(`${pad(row.name, 52)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
for (const [name, lines] of Object.entries(plans)) {
  console.log(`\nPlan — ${name}:`);
  for (const line of lines) console.log(`  ${line.trim()}`);
}
await prisma.$disconnect();
