import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Restoran POS uçlarının büyük veride süresi (modül 39; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-pos.mjs
 *
 * Kurulum (yoksa; yarıda kesildiyse kaldığı günden sürer; tamsa tekrar kurmaz) 2500 kişilik bir otelin ~2 yıllık
 * yiyecek-içecek hareketi:
 * - 6 satış noktası, 420 masa, 30 menü grubu, 600 ürün, 40 garson.
 * - Günde ≈800 adisyon (≈585.000), adisyon başına 1–2 tur ve 2–6 kalem (≈2,3 milyon kalem),
 *   1–2 ödeme (nakit / kart; ≈700.000), %6 ikram / zayi iptal, %3 odaya yazılan; günde 30
 *   vardiya (≈22.000). Bugün: açık vardiyalar ve 300 açık adisyon (akşam yoğunluğu).
 *
 * Ölçülen: terminal açılışı, masa planı (en kalabalık nokta), adisyon ekranı (en büyük),
 * adisyon listesi (ilk sayfa, kapanmış, numara araması, derin sayfa, 30 gün + nokta),
 * vardiya raporu ve listesi, satış raporu (1 / 31 gün, noktalı), kasa özeti ve restoran
 * hareketleri, iş turu; yazma yolu: adisyon aç → 20 kalemli tur → böl → ödeme; sonunda
 * liste ve rapor sorgularının planı.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 5);
const DAYS = 730;
const CHECKS_PER_DAY = 800;
const OPEN_TODAY = 300;
const CHUNK = 5000;
const ACTOR = 'perf';
const WAITER_COUNT = 40;

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const setup = await import('../src/modules/pos/setup.js');
const checks = await import('../src/modules/pos/checks.js');
const payments = await import('../src/modules/pos/payments.js');
const shifts = await import('../src/modules/pos/shifts.js');
const reports = await import('../src/modules/pos/reports.js');
const jobs = await import('../src/modules/pos/jobs.js');
const cash = await import('../src/modules/payments/service.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
const today = core.toIsoDay(core.calendarDateInTimeZone(hotel.timezone));
const day = (offset) => core.toIsoDay(core.addDays(new Date(`${today}T00:00:00.000Z`), offset));
const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
const MANAGER = 'perf-mudur@test.local';

let seed = 39_2026;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const cents = (value) => Math.round(Number(value) * 100);
const money = (value) => (value / 100).toFixed(2);

async function insertChunks(model, rows) {
  for (let index = 0; index < rows.length; index += CHUNK) await prisma[model].createMany({ data: rows.slice(index, index + CHUNK) });
}

/* ══════════════════ Kurulum ══════════════════ */

const started = performance.now();
const waiters = Array.from({ length: WAITER_COUNT }, (_, index) => `perf-garson${index + 1}@test.local`);
if ((await prisma.posOutlet.count({ where: { hotelId, createdBy: ACTOR } })) === 0) {
  const outletRows = ['ANA', 'ITAL', 'SUSHI', 'LOBI', 'HAVUZ', 'TERAS'].map((code, index) => ({ id: randomUUID(), hotelId, code: `P${code}`, name: `Perf ${code}`, allowRoomCharge: index !== 4, sortOrder: index, createdBy: ACTOR }));
  await prisma.posOutlet.createMany({ data: outletRows });
  const tableCounts = [120, 60, 50, 60, 70, 60];
  await prisma.posTable.createMany({
    data: outletRows.flatMap((outlet, index) =>
      Array.from({ length: tableCounts[index] }, (_, number) => ({ id: randomUUID(), hotelId, outletId: outlet.id, name: String(number + 1), seats: 4, zone: number < tableCounts[index] / 2 ? 'İç' : 'Dış', sortOrder: number })),
    ),
  });
  const categoryRows = Array.from({ length: 30 }, (_, index) => ({ id: randomUUID(), hotelId, name: `Perf grup ${index + 1}`, sortOrder: index, outletIds: [], createdBy: ACTOR }));
  await prisma.menuCategory.createMany({ data: categoryRows });
  await prisma.menuItem.createMany({
    data: Array.from({ length: 600 }, (_, index) => ({
      id: randomUUID(),
      hotelId,
      categoryId: categoryRows[index % 30].id,
      code: `PI${index + 1}`,
      name: `Perf ürün ${index + 1}`,
      price: money(5_000 + Math.floor(rand() * 95_000)),
      taxCategory: index % 25 === 0 ? 'OTHER' : 'FNB',
      station: pick(['HOT', 'COLD', 'BAR', 'PASTRY', 'NONE']),
      sortOrder: index,
      createdBy: ACTOR,
    })),
  });
}

// Kurulum kaldığı yerden sürer (uzun süren yükleme yarıda kesilebilir): bugünün vardiyaları varsa veri tamdır.
const outletRows = await prisma.posOutlet.findMany({ where: { hotelId, createdBy: ACTOR }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
const outletIds = outletRows.map((row) => row.id);
const shiftScope = Prisma.sql`SELECT "id" FROM "PosShift" WHERE "hotelId" = ${hotelId} AND "waiterEmail" = ANY(${waiters}::text[])`;
const todayShifts = await prisma.posShift.count({ where: { hotelId, waiterEmail: { in: waiters }, businessDate: new Date(`${today}T00:00:00Z`) } });
if (todayShifts === 0) {
  const tableRows = await prisma.posTable.findMany({ where: { hotelId, outletId: { in: outletIds } }, orderBy: [{ outletId: 'asc' }, { sortOrder: 'asc' }], select: { id: true, outletId: true } });
  const itemRows = (await prisma.menuItem.findMany({ where: { hotelId, createdBy: ACTOR }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, price: true, taxCategory: true, station: true } })).map(
    (item) => ({ ...item, price: core.toMoneyString(String(item.price)) }),
  );
  const stays = await prisma.reservation.findMany({ where: { hotelId, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] }, roomId: { not: null } }, take: 5000, select: { id: true, room: { select: { number: true } } } });
  const tablesByOutlet = new Map(outletIds.map((id) => [id, tableRows.filter((row) => row.outletId === id)]));

  // Son (yarım kalmış olabilecek) gün silinip oradan yeniden üretilir.
  const last = (await prisma.$queryRaw`SELECT to_char(max("businessDate"), 'YYYY-MM-DD') AS "day" FROM "PosShift" WHERE "id" IN (${shiftScope})`)[0].day;
  let firstOffset = -DAYS;
  if (last) {
    const tail = Prisma.sql`SELECT "id" FROM "PosShift" WHERE "id" IN (${shiftScope}) AND "businessDate" >= ${last}::date`;
    const tailChecks = Prisma.sql`SELECT "id" FROM "PosCheck" WHERE "shiftId" IN (${tail})`;
    for (const table of ['PosPayment', 'PosRoomCharge', 'PosAdjustment', 'PosOrderLine', 'PosOrder']) {
      await prisma.$executeRaw`DELETE FROM ${Prisma.raw(`"${table}"`)} WHERE "checkId" IN (${tailChecks})`;
    }
    await prisma.$executeRaw`DELETE FROM "PosCheck" WHERE "id" IN (${tailChecks})`;
    await prisma.$executeRaw`DELETE FROM "PosShift" WHERE "id" IN (${tail})`;
    firstOffset = Math.max(-DAYS, -Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000));
    console.log(`Kurulum ${last} gününden sürüyor`);
  }

  let sequence = 0;
  // Yıl başına son numara: o yılın var olan perf adisyonları (numaralar boşluksuz).
  const yearSequences = new Map(
    (await prisma.$queryRaw`SELECT substring("number" FROM 5 FOR 4)::int AS "year", COUNT(*)::int AS "count" FROM "PosCheck" WHERE "hotelId" = ${hotelId} AND "number" LIKE 'PRF-%' GROUP BY 1`).map((row) => [row.year, row.count]),
  );
  for (let offset = firstOffset; offset <= 0; offset += 1) {
    const date = day(offset);
    const isToday = offset === 0;
    const shiftRows = [];
    const checkRows = [];
    const orderRows = [];
    const lineRows = [];
    const paymentRows = [];
    const adjustmentRows = [];
    const roomRows = [];
    // 30 vardiya: her noktada 5 garson.
    const dayWaiters = Array.from({ length: 30 }, (_, index) => waiters[(index + offset * 7 + DAYS * 40) % WAITER_COUNT]);
    for (const [index, waiterEmail] of dayWaiters.entries()) {
      const opened = new Date(`${date}T08:00:00Z`);
      const closed = isToday ? null : new Date(`${date}T23:30:00Z`);
      shiftRows.push({
        id: randomUUID(),
        hotelId,
        waiterEmail,
        outletId: outletRows[index % outletRows.length].id,
        status: isToday ? 'OPEN' : 'CLOSED',
        openingFloat: '500.00',
        businessDate: new Date(`${date}T00:00:00Z`),
        openedAt: opened,
        closedAt: closed,
        closedBy: isToday ? null : waiterEmail,
        countedCash: null,
        expectedCash: null,
        variance: null,
        cash: 50_000,
      });
    }
    const total = isToday ? CHECKS_PER_DAY / 2 + OPEN_TODAY : CHECKS_PER_DAY;
    for (let index = 0; index < total; index += 1) {
      const shift = shiftRows[index % shiftRows.length];
      const open = isToday && index >= CHECKS_PER_DAY / 2;
      const outletId = shift.outletId;
      const table = tablesByOutlet.get(outletId)[index % tablesByOutlet.get(outletId).length];
      const checkYear = Number(date.slice(0, 4));
      const seq = (yearSequences.get(checkYear) ?? 0) + 1;
      yearSequences.set(checkYear, seq);
      sequence += 1;
      const checkId = randomUUID();
      const openedAt = new Date(`${date}T${String(11 + Math.floor(rand() * 10)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00Z`);
      const rounds = 1 + Math.floor(rand() * 2);
      let subtotal = 0;
      let compTotal = 0;
      let voidTotal = 0;
      for (let round = 1; round <= rounds; round += 1) {
        const orderId = randomUUID();
        orderRows.push({ id: orderId, hotelId, checkId, outletId, seq: round, status: 'NEW', sourceKey: `perf-order:${orderId}`, sentAt: new Date(openedAt.getTime() + round * 600_000), sentBy: shift.waiterEmail });
        const count = 1 + Math.floor(rand() * 3);
        for (let line = 0; line < count; line += 1) {
          const item = pick(itemRows);
          const quantity = 1 + Math.floor(rand() * 3);
          const lineId = randomUUID();
          const adjust = !open && rand() < 0.06 ? (rand() < 0.5 ? 'COMP' : 'VOID') : null;
          lineRows.push({
            id: lineId,
            hotelId,
            checkId,
            orderId,
            menuItemId: item.id,
            name: item.name,
            station: item.station,
            taxCategory: item.taxCategory,
            unitPrice: item.price,
            quantity,
            voidedQuantity: adjust === 'VOID' ? 1 : 0,
            compedQuantity: adjust === 'COMP' ? 1 : 0,
            sortOrder: lineRows.length,
            businessDate: open ? null : new Date(`${date}T00:00:00Z`),
          });
          const price = cents(item.price);
          subtotal += price * (quantity - (adjust ? 1 : 0));
          if (adjust === 'COMP') compTotal += price;
          if (adjust === 'VOID') voidTotal += price;
          if (adjust) {
            adjustmentRows.push({ id: randomUUID(), hotelId, checkId, kind: adjust, lineId, quantity: 1, waste: adjust === 'VOID', value: item.price, reason: 'Perf düzeltme', status: 'APPLIED', requestedBy: MANAGER, requestedAt: openedAt });
          }
        }
      }
      const net = Math.round(subtotal / 1.1);
      const grand = subtotal;
      const room = !open && stays.length && rand() < 0.03 ? pick(stays) : null;
      const closedAt = open ? null : new Date(openedAt.getTime() + 75 * 60_000);
      checkRows.push({
        id: checkId,
        hotelId,
        outletId,
        tableId: table.id,
        number: `PRF-${checkYear}-${String(seq).padStart(7, '0')}`,
        status: open ? 'OPEN' : 'CLOSED',
        covers: 1 + Math.floor(rand() * 5),
        waiterEmail: shift.waiterEmail,
        shiftId: shift.id,
        openedAt,
        openedBy: shift.waiterEmail,
        billRequestedAt: open && rand() < 0.2 ? new Date() : null,
        closedAt,
        closedBy: open ? null : shift.waiterEmail,
        businessDate: open ? null : new Date(`${date}T00:00:00Z`),
        subtotal: money(subtotal),
        compTotal: money(compTotal),
        voidTotal: money(voidTotal),
        discountTotal: '0.00',
        netTotal: money(net),
        taxTotal: money(grand - net),
        grandTotal: money(grand),
        paidTotal: open || room ? '0.00' : money(grand),
        roomChargeTotal: room && !open ? money(grand) : '0.00',
      });
      if (open || grand === 0) continue;
      if (room) {
        roomRows.push({ id: randomUUID(), hotelId, checkId, reservationId: room.id, roomNumber: room.room.number, guestName: 'Perf misafir', amount: money(grand), eventId: randomUUID(), sourceKey: `perf-room:${checkId}`, chargedBy: shift.waiterEmail, chargedAt: closedAt, businessDate: new Date(`${date}T00:00:00Z`) });
        continue;
      }
      const split = grand > 1000 && rand() < 0.3;
      const parts = split ? [Math.floor(grand / 2), grand - Math.floor(grand / 2)] : [grand];
      for (const part of parts) {
        const method = rand() < 0.55 ? 'CARD' : 'CASH';
        if (method === 'CASH') shift.cash += part;
        paymentRows.push({
          id: randomUUID(),
          hotelId,
          checkId,
          shiftId: shift.id,
          kind: 'PAYMENT',
          status: 'POSTED',
          method,
          amount: money(part),
          currency: hotel.currency,
          businessDate: new Date(`${date}T00:00:00Z`),
          reference: method === 'CARD' ? `PERF${sequence}` : null,
          receivedBy: shift.waiterEmail,
          receivedAt: closedAt,
          postedAt: closedAt,
        });
      }
    }
    for (const shift of shiftRows) {
      if (shift.status === 'CLOSED') {
        const expected = shift.cash;
        const counted = expected - (rand() < 0.1 ? 1_000 : 0);
        Object.assign(shift, { countedCash: money(counted), expectedCash: money(expected), variance: money(counted - expected) });
      }
      delete shift.cash;
    }
    await insertChunks('posShift', shiftRows);
    await insertChunks('posCheck', checkRows);
    await insertChunks('posOrder', orderRows);
    await insertChunks('posOrderLine', lineRows);
    await insertChunks('posAdjustment', adjustmentRows);
    await insertChunks('posPayment', paymentRows);
    await insertChunks('posRoomCharge', roomRows);
    if (offset % 60 === 0) console.log(`… ${date} (${sequence} adisyon)`);
  }
  for (const [year, last] of yearSequences) {
    await prisma.$executeRaw`INSERT INTO "PosSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, 'CHECK', ${year}, ${last})
      ON CONFLICT ("hotelId", "kind", "year") DO UPDATE SET "last" = GREATEST("PosSequence"."last", EXCLUDED."last")`;
  }
  for (const table of ['PosShift', 'PosCheck', 'PosOrder', 'PosOrderLine', 'PosAdjustment', 'PosPayment', 'PosRoomCharge', 'MenuItem', 'PosTable']) await prisma.$executeRawUnsafe(`ANALYZE "${table}"`);
  console.log(`Veri kuruldu: ${sequence} adisyon (${((performance.now() - started) / 1000).toFixed(1)} sn).`);
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

const counts = await prisma.posCheck.groupBy({ by: ['status'], where: { hotelId }, _count: { _all: true } });
const busiestOutlet = (await prisma.$queryRaw`SELECT "outletId" FROM "PosCheck" WHERE "hotelId" = ${hotelId} AND "status" = 'OPEN' GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`)[0];
const biggest = (await prisma.$queryRaw`SELECT "checkId" FROM "PosOrderLine" WHERE "hotelId" = ${hotelId} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`)[0];
const busyShift = (await prisma.$queryRaw`SELECT "shiftId" FROM "PosCheck" WHERE "hotelId" = ${hotelId} AND "status" = 'CLOSED' GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`)[0];
const sampleNumber = (await prisma.posCheck.findFirst({ where: { hotelId, status: 'CLOSED' }, orderBy: { openedAt: 'asc' }, select: { number: true } })).number;
const list = (query) => checks.listChecks(hotelId, contracts.posCheckListQuerySchema.parse(query));

await measure('terminal açılışı (6 nokta, 420 masa, 600 ürün)', () => setup.getTerminal(hotelId));
await measure('masa planı (en kalabalık nokta)', () => checks.getFloor(hotelId, busiestOutlet.outletId));
await measure('adisyon ekranı (en büyük)', () => checks.getCheck(hotelId, biggest.checkId));
await measure('adisyon listesi (ilk sayfa)', () => list({}));
await measure('adisyon listesi (kapanmış)', () => list({ status: 'CLOSED' }));
await measure('adisyon listesi (numara araması)', () => list({ search: sampleNumber.slice(-6) }));
await measure('adisyon listesi (masa adı "12")', () => list({ search: '12' }));
await measure('adisyon listesi (derin sayfa 2000)', () => list({ page: 2000 }));
await measure('adisyon listesi (30 gün + nokta)', () => list({ from: day(-30), to: day(0), outletId: busiestOutlet.outletId }));
await measure('vardiya raporu (yoğun vardiya)', () => shifts.shiftReport(hotelId, busyShift.shiftId, { canSeeAll: true }));
await measure('vardiya listesi (sayfa 1, toplamlarla)', () => as(MANAGER, () => shifts.listShifts(hotelId, contracts.posShiftListQuerySchema.parse({}), { canSeeAll: true })));
await measure('satış raporu (bugün)', () => reports.salesReport(hotelId, { from: today, to: today }));
await measure('satış raporu (31 gün)', () => reports.salesReport(hotelId, { from: day(-30), to: today }));
await measure('satış raporu (31 gün, nokta)', () => reports.salesReport(hotelId, { from: day(-30), to: today, outletId: busiestOutlet.outletId }));
await measure('kasa özeti (bugün, üç kaynak)', () => as(MANAGER, () => cash.getCashSummary(hotelId, { mine: false })));
await measure('kasa hareketleri (restoran, 50)', () => as(MANAGER, () => cash.listCashMovements(hotelId, { mine: false, limit: 50, origin: 'POS' })));

// Yazma yolu: vardiya → adisyon aç → 20 kalemli tur → böl → kalanı öde.
const flowWaiter = 'perf-akis@test.local';
if (!(await prisma.posShift.findFirst({ where: { hotelId, waiterEmail: flowWaiter, status: 'OPEN' } }))) {
  await as(flowWaiter, () => shifts.openShift(hotelId, contracts.openPosShiftSchema.parse({ openingFloat: '500' })));
}
const menu = await prisma.menuItem.findMany({ where: { hotelId, createdBy: ACTOR }, take: 20, select: { id: true } });
await measure(
  'aç → 20 kalem → böl → öde',
  () =>
    as(flowWaiter, async () => {
      const opened = await checks.openCheck(hotelId, contracts.openPosCheckSchema.parse({ requestId: randomUUID(), outletId: busiestOutlet.outletId, covers: 4 }));
      const sent = await checks.sendOrder(hotelId, opened.id, contracts.sendPosOrderSchema.parse({ requestId: randomUUID(), lines: menu.map((item) => ({ menuItemId: item.id, quantity: 2 })) }));
      const { source } = await checks.splitCheck(hotelId, opened.id, contracts.splitPosCheckSchema.parse({ expectedUpdatedAt: sent.updatedAt, lines: sent.lines.slice(0, 5).map((line) => ({ lineId: line.id, quantity: 1 })) }));
      return payments.receivePayment(hotelId, opened.id, contracts.posPaymentSchema.parse({ requestId: randomUUID(), method: 'CARD', amount: source.balance, reference: 'PERF' }));
    }),
  4,
);
const sweep = await measure('iş turu (uzun açık vardiya / adisyon)', () => as('system', () => jobs.sweepHotel(hotelId)), 2);

/* ══════════════════ Plan ══════════════════ */

const plans = {};
const capture = async (name, sql) => {
  const explained = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  plans[name] = explained.map((row) => row['QUERY PLAN']).filter((text) => /Index|Execution Time|Seq Scan|Bitmap/.test(text));
};
await capture('adisyon listesi (derin sayfa)', Prisma.sql`SELECT "id" FROM "PosCheck" WHERE "hotelId" = ${hotelId} ORDER BY "openedAt" DESC, "id" DESC LIMIT 25 OFFSET 49975`);
await capture(
  'satış raporu: nokta kırılımı (31 gün)',
  Prisma.sql`SELECT c."outletId", COUNT(*), SUM(c."grandTotal") FROM "PosCheck" c WHERE c."hotelId" = ${hotelId} AND c."status" = 'CLOSED' AND c."businessDate" BETWEEN ${day(-30)}::date AND ${today}::date GROUP BY 1`,
);
await capture(
  'satış raporu: en çok satanlar (31 gün)',
  Prisma.sql`SELECT l."menuItemId", SUM(l."quantity") FROM "PosOrderLine" l WHERE l."hotelId" = ${hotelId} AND l."businessDate" BETWEEN ${day(-30)}::date AND ${today}::date GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
);
await capture('numara araması', Prisma.sql`SELECT "id" FROM "PosCheck" WHERE "hotelId" = ${hotelId} AND "number" LIKE ${`%${sampleNumber.slice(-6)}%`} ORDER BY "openedAt" DESC LIMIT 25`);
const sampleTable = await prisma.posTable.findFirst({ where: { hotelId, outletId: busiestOutlet.outletId, name: '12' }, select: { id: true } });
await capture(
  'numara ya da masa',
  Prisma.sql`WITH hits AS MATERIALIZED (SELECT "id", "openedAt" FROM "PosCheck" WHERE "hotelId" = ${hotelId} AND ("number" LIKE ${`%${sampleNumber.slice(-6)}%`} OR "tableId" = ANY(${[sampleTable.id]}::text[]))) SELECT "id" FROM hits ORDER BY "openedAt" DESC LIMIT 25`,
);

const pad = (text, width) => String(text).padEnd(width);
console.log(`\nDurumlar: ${counts.map((row) => `${row.status} ${row._count._all}`).join(' · ')} · iş turu: ${JSON.stringify(sweep)}`);
console.log(`\n${pad('ölçüm', 52)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) console.log(`${pad(row.name, 52)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
for (const [name, lines] of Object.entries(plans)) {
  console.log(`\nPlan — ${name}:`);
  for (const line of lines) console.log(`  ${line.trim()}`);
}
await prisma.$disconnect();
