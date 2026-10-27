import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Oda servisi uçlarının büyük veride süresi (modül 41; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-room-service.mjs
 *
 * Önce restoranın ölçüm verisi kurulmuş olmalı (`perf-pos.mjs`: ~587.000 kapanmış adisyon). Kurulum (yoksa; tamsa
 * tekrar kurmaz) 2500 kişilik bir otelin ~2 yıllık oda servisi:
 * - Günde 300 sipariş (≈219.000): %93 teslim (her biri kapanmış bir adisyona bağlı), %4 iptal, %1 misafir siparişi
 *   reddi; kaynak %70 personel, %25 misafir QR, %5 misafir isteği; %20'si ileri saatli (kahvaltı); tepsilerin %97'si
 *   toplanmış.
 * - Bugün: panoda 110 açık sipariş (kabul bekleyen, mutfakta, hazır, yolda; bir kısmı gecikmiş), 120 toplanmamış tepsi;
 *   yarın 400 kahvaltı kartı.
 *
 * Ölçülen: pano, sipariş ekranı, geçmiş (ilk sayfa, durum, oda / numara / ad araması, derin sayfa, 31 gün), hazırlık
 * listesi (400 sipariş), tepsi listesi, rapor (bugün / 31 gün), dakikalık iş turu, misafir menüsü ve siparişi, yazma
 * yolu (sipariş → hazır → yolda → teslim + odaya yaz); sonunda sorgu planları.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 5);
const DAYS = 730;
const ORDERS_PER_DAY = 300;
const CHUNK = 5000;
const ACTOR = 'perf-rs';
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const setup = await import('../src/modules/pos/setup.js');
const shifts = await import('../src/modules/pos/shifts.js');
const rs = await import('../src/modules/pos/room-service.js');
const read = await import('../src/modules/pos/room-service-read.js');
const guest = await import('../src/modules/pos/room-service-guest.js');
const jobs = await import('../src/modules/pos/room-service-jobs.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
const today = core.toIsoDay(core.calendarDateInTimeZone(hotel.timezone));
const day = (offset) => core.toIsoDay(core.addDays(new Date(`${today}T00:00:00.000Z`), offset));
const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
const parse = (schema, input) => contracts[schema].parse(input);

let seed = 41_2026;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));

async function insertChunks(model, rows) {
  for (let index = 0; index < rows.length; index += CHUNK) await prisma[model].createMany({ data: rows.slice(index, index + CHUNK) });
}

/* ══════════════════ Kurulum ══════════════════ */

const started = performance.now();
let outlet = await prisma.posOutlet.findFirst({ where: { hotelId, code: 'PODA' }, select: { id: true } });
if (!outlet) {
  outlet = await as(ACTOR, () => setup.createOutlet(hotelId, parse('createPosOutletSchema', { code: 'PODA', name: 'Perf Oda Servisi', kind: 'ROOM_SERVICE', sortOrder: 9 })));
  const current = await setup.getSettings(hotelId);
  await as(ACTOR, () =>
    setup.updateSettings(
      hotelId,
      parse('updatePosSettingsSchema', {
        expectedUpdatedAt: current.updatedAt,
        adjustmentApprovalAmount: current.adjustmentApprovalAmount,
        cashVarianceAlert: current.cashVarianceAlert,
        trayCharge: '75',
        deliveryTargetMinutes: 30,
        prepLeadMinutes: 30,
        trayAlertMinutes: 90,
        guestOrderingEnabled: true,
      }),
    ),
  );
}
const outletId = outlet.id;

if ((await prisma.roomServiceOrder.count({ where: { hotelId } })) === 0) {
  const items = await prisma.menuItem.findMany({ where: { hotelId, system: null }, take: 120, select: { id: true, name: true, price: true, station: true, taxCategory: true } });
  const stays = await prisma.reservation.findMany({ where: { hotelId, roomId: { not: null } }, orderBy: { id: 'asc' }, take: 40_000, select: { id: true, roomId: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } } });
  const inHouse = await prisma.reservation.findMany({ where: { hotelId, status: 'CHECKED_IN', roomId: { not: null } }, take: 1_200, select: { id: true, roomId: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } } });
  const total = DAYS * ORDERS_PER_DAY;
  const checkIds = (await prisma.$queryRaw`SELECT "id" FROM "PosCheck" WHERE "hotelId" = ${hotelId} AND "status" = 'CLOSED' ORDER BY "openedAt" LIMIT ${total}`).map((row) => row.id);
  const requestIds = (await prisma.$queryRaw`SELECT "id" FROM "GuestRequest" WHERE "hotelId" = ${hotelId} ORDER BY "id" LIMIT ${Math.ceil(total * 0.06)}`).map((row) => row.id);
  // Misafir QR bağlantıları (geçmiştekiler iptal edilmiş; konaklamada tek geçerli bağlantı kuralı bozulmasın).
  const links = Array.from({ length: 2_000 }, () => {
    const stay = pick(stays);
    return { id: randomUUID(), hotelId, reservationId: stay.id, roomId: stay.roomId, nonce: randomBytes(24).toString('base64url'), createdBy: ACTOR, revokedAt: new Date(), revokedBy: ACTOR };
  });
  await insertChunks('roomServiceLink', links);
  const year = Number(today.slice(0, 4));
  const orderItems = () => {
    const picked = Array.from({ length: between(1, 4) }, () => pick(items));
    const rows = picked.map((item) => ({ menuItemId: item.id, name: item.name, unitPrice: String(item.price), quantity: between(1, 3), note: rand() < 0.1 ? 'Az pişmiş' : null, station: item.station, taxCategory: item.taxCategory }));
    return { items: rows, itemsTotal: rows.reduce((sum, row) => sum + Number(row.unitPrice) * row.quantity, 0).toFixed(2) };
  };
  const base = (stay, number, createdAt) => ({
    id: randomUUID(),
    hotelId,
    outletId,
    number: `OS-${year}-${String(number).padStart(6, '0')}`,
    reservationId: stay.id,
    roomId: stay.roomId,
    roomNumber: stay.room.number,
    guestName: `${stay.guest.firstName} ${stay.guest.lastName}`,
    covers: between(1, 3),
    sourceKey: `perf:${number}`,
    createdBy: ACTOR,
    createdAt,
    ...orderItems(),
  });

  let number = 0;
  let checkIndex = 0;
  let requestIndex = 0;
  const history = [];
  for (let offset = DAYS; offset >= 1; offset -= 1) {
    const midnight = Date.parse(`${day(-offset)}T00:00:00Z`) - 3 * 3_600_000;
    for (let index = 0; index < ORDERS_PER_DAY; index += 1) {
      number += 1;
      const createdAt = new Date(midnight + between(6 * 60, 23 * 60 + 50) * MINUTE_MS);
      const at = (minutes) => new Date(createdAt.getTime() + minutes * MINUTE_MS);
      const roll = rand();
      const source = roll < 0.7 ? 'STAFF' : roll < 0.95 ? 'GUEST' : 'REQUEST';
      const scheduled = rand() < 0.2;
      const deliverAt = scheduled ? at(between(120, 600)) : null;
      const start = scheduled ? new Date(deliverAt.getTime() - 30 * MINUTE_MS) : source === 'GUEST' ? at(between(1, 6)) : createdAt;
      const dueAt = scheduled ? deliverAt : at(30);
      const order = {
        ...base(pick(stays), number, createdAt),
        source,
        deliverAt,
        releaseAt: scheduled ? start : null,
        dueAt,
        linkId: source === 'GUEST' ? pick(links).id : null,
        guestRequestId: source === 'REQUEST' && requestIndex < requestIds.length ? requestIds[requestIndex++] : null,
        acceptedAt: source === 'GUEST' ? start : null,
        acceptedBy: source === 'GUEST' ? 'perf-garson1@test.local' : null,
      };
      if (order.source === 'REQUEST' && !order.guestRequestId) order.source = 'STAFF';
      const fate = rand();
      if (fate < 0.01 && source === 'GUEST') {
        history.push({ ...order, status: 'REJECTED', acceptedAt: null, acceptedBy: null, rejectedAt: at(4), rejectedBy: 'perf-garson1@test.local', rejectReason: 'Mutfak kapalı' });
      } else if (fate < 0.05) {
        history.push({ ...order, status: 'CANCELLED', cancelledAt: at(8), cancelledBy: 'perf-garson1@test.local', cancelReason: 'Misafir vazgeçti' });
      } else {
        const ready = between(9, 22);
        const out = ready + between(1, 5);
        const done = out + between(3, 10);
        const from = (minutes) => new Date(start.getTime() + minutes * MINUTE_MS);
        const tray = rand() < 0.9;
        history.push({
          ...order,
          status: 'DELIVERED',
          checkId: checkIds[checkIndex++],
          receivedAt: start,
          preparingAt: from(between(1, 5)),
          readyAt: from(ready),
          dispatchedAt: from(out),
          runnerEmail: `perf-garson${between(1, 40)}@test.local`,
          deliveredAt: from(done),
          deliveredBy: 'perf-garson2@test.local',
          trayExpected: tray,
          trayCollectedAt: tray && rand() < 0.97 ? from(done + between(30, 180)) : null,
          trayCollectedBy: tray ? 'perf-katgorevlisi@test.local' : null,
          lateAlertedAt: from(done),
          trayAlertedAt: tray ? from(done) : null,
        });
      }
      if (history.length >= CHUNK * 4) await insertChunks('roomServiceOrder', history.splice(0));
    }
  }
  await insertChunks('roomServiceOrder', history.splice(0));

  // Bugün: pano (kabul bekleyen, mutfakta, hazırlanıyor, hazır, yolda; bir kısmı gecikmiş) ve toplanmamış tepsiler;
  // yarın kahvaltı kartları. Mutfaktakiler de bir adisyona bağlı (kapanmış ölçüm adisyonu; ekran için yeterli).
  const now = Date.now();
  const back = (minutes) => new Date(now - minutes * MINUTE_MS);
  const live = [];
  const mix = [
    ['REQUESTED', 5],
    ['RECEIVED', 40],
    ['PREPARING', 30],
    ['READY', 15],
    ['ON_THE_WAY', 20],
  ];
  let stayIndex = 0;
  for (const [status, count] of mix) {
    for (let index = 0; index < count; index += 1) {
      number += 1;
      const age = between(2, 50);
      const stay = inHouse[stayIndex++ % inHouse.length];
      const fired = status !== 'REQUESTED';
      live.push({
        ...base(stay, number, back(age)),
        source: status === 'REQUESTED' ? 'GUEST' : 'STAFF',
        linkId: status === 'REQUESTED' ? pick(links).id : null,
        status,
        dueAt: back(age - 30),
        checkId: fired ? checkIds[checkIndex++] : null,
        receivedAt: fired ? back(age) : null,
        preparingAt: ['PREPARING', 'READY', 'ON_THE_WAY'].includes(status) ? back(age - 3) : null,
        readyAt: ['READY', 'ON_THE_WAY'].includes(status) ? back(Math.max(0, age - 15)) : null,
        dispatchedAt: status === 'ON_THE_WAY' ? back(Math.max(0, age - 18)) : null,
        runnerEmail: status === 'ON_THE_WAY' ? 'perf-garson3@test.local' : null,
      });
    }
  }
  for (let index = 0; index < 120; index += 1) {
    number += 1;
    const age = between(20, 400);
    live.push({ ...base(inHouse[stayIndex++ % inHouse.length], number, back(age + 30)), source: 'STAFF', status: 'DELIVERED', dueAt: back(age), checkId: checkIds[checkIndex++], receivedAt: back(age + 30), deliveredAt: back(age), deliveredBy: 'perf-garson2@test.local', runnerEmail: 'perf-garson2@test.local' });
  }
  const tomorrow = day(1);
  for (let index = 0; index < 400; index += 1) {
    number += 1;
    const deliverAt = new Date(Date.parse(`${tomorrow}T00:00:00Z`) - 3 * 3_600_000 + (7 * 60 + between(0, 8) * 15) * MINUTE_MS);
    live.push({ ...base(inHouse[stayIndex++ % inHouse.length], number, back(between(60, 600))), source: 'STAFF', status: 'SCHEDULED', deliverAt, releaseAt: new Date(deliverAt.getTime() - 30 * MINUTE_MS), dueAt: deliverAt });
  }
  await insertChunks('roomServiceOrder', live);
  await prisma.$executeRaw`
    INSERT INTO "PosSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, 'ROOM_SERVICE', ${year}, ${number})
    ON CONFLICT ("hotelId", "kind", "year") DO UPDATE SET "last" = GREATEST("PosSequence"."last", EXCLUDED."last")`;
  await prisma.$executeRawUnsafe('ANALYZE "RoomServiceOrder"');
  await prisma.$executeRawUnsafe('ANALYZE "RoomServiceLink"');
  console.log(`Kurulum: ${number} sipariş, ${((performance.now() - started) / 1000).toFixed(0)} sn`);
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

const counts = await prisma.roomServiceOrder.groupBy({ by: ['status'], where: { hotelId }, _count: { _all: true } });
const sample = await prisma.roomServiceOrder.findFirst({ where: { hotelId, status: 'DELIVERED' }, orderBy: { createdAt: 'asc' }, select: { id: true, number: true, roomNumber: true, guestName: true } });
const list = (query) => read.listOrders(hotelId, parse('roomServiceListQuerySchema', query));

await measure('pano (110 açık, 400 planlı, 120 tepsi)', () => read.getBoard(hotelId, {}));
await measure('pano (nokta süzgeçli)', () => read.getBoard(hotelId, { outletId }));
await measure('sipariş ekranı', () => read.getOrder(hotelId, sample.id));
await measure('geçmiş (ilk sayfa)', () => list({}));
await measure('geçmiş (teslim edilenler)', () => list({ state: 'DELIVERED' }));
await measure('geçmiş (oda numarası araması)', () => list({ search: sample.roomNumber }));
await measure('geçmiş (numara parçası)', () => list({ search: sample.number.slice(-6) }));
await measure('geçmiş (misafir adı)', () => list({ search: sample.guestName.split(' ').at(-1) }));
await measure('geçmiş (derin sayfa 3000)', () => list({ page: 3000 }));
await measure('geçmiş (31 gün + iptal)', () => list({ from: day(-30), to: today, state: 'CANCELLED' }));
await measure('hazırlık listesi (yarın, 400 sipariş)', () => read.prepList(hotelId, { date: day(1) }));
await measure('tepsi listesi (120)', () => read.listTrays(hotelId, {}));
await measure('rapor (bugün)', () => read.roomServiceReport(hotelId, {}));
await measure('rapor (31 gün, ≈9.300 sipariş)', () => read.roomServiceReport(hotelId, { from: day(-30), to: today }));
const sweep = await measure('dakikalık iş turu', () => as('system', () => jobs.sweepRoomService(hotelId)), 2);

// Misafir: bağlantı → menü → sipariş (sınır: konaklama başına 3 açık misafir siparişi).
const flowStays = await prisma.reservation.findMany({
  where: { hotelId, status: 'CHECKED_IN', roomId: { not: null }, roomServiceOrders: { none: { status: { in: ['REQUESTED', 'SCHEDULED', 'RECEIVED', 'PREPARING', 'READY', 'ON_THE_WAY'] } } } },
  take: 12,
  select: { id: true },
});
const menuItems = await prisma.menuItem.findMany({ where: { hotelId, system: null, isActive: true, soldOut: false }, take: 3, select: { id: true } });
const guestLink = await as('perf-onburo@test.local', () => guest.issueLink(hotelId, flowStays[0].id));
await measure('misafir menüsü (QR)', () => guest.publicMenu(guestLink.link.token));
await measure(
  'misafir siparişi (QR)',
  () => guest.publicCreateOrder(guestLink.link.token, parse('publicRoomServiceOrderSchema', { requestId: randomUUID(), outletId, lines: [{ menuItemId: menuItems[0].id, quantity: 1 }] })),
  3,
);

// Yazma yolu: vardiya → sipariş (adisyon + tur + tepsi ücreti) → hazır → yolda → teslim (kapıda + odaya yaz).
const flowWaiter = 'perf-oda-akis@test.local';
if (!(await prisma.posShift.findFirst({ where: { hotelId, waiterEmail: flowWaiter, status: 'OPEN' } }))) {
  await as(flowWaiter, () => shifts.openShift(hotelId, parse('openPosShiftSchema', { openingFloat: '500', outletId })));
}
await measure(
  'sipariş → hazır → yolda → teslim (kapıda + odaya)',
  (round) =>
    as(flowWaiter, async () => {
      let order = await rs.createOrder(hotelId, parse('createRoomServiceOrderSchema', { requestId: randomUUID(), outletId, reservationId: flowStays[1 + round].id, lines: menuItems.map((item) => ({ menuItemId: item.id, quantity: 2 })) }));
      order = await rs.advanceOrder(hotelId, order.id, parse('advanceRoomServiceOrderSchema', { expectedUpdatedAt: order.updatedAt, status: 'READY' }));
      order = await rs.advanceOrder(hotelId, order.id, parse('advanceRoomServiceOrderSchema', { expectedUpdatedAt: order.updatedAt, status: 'ON_THE_WAY' }));
      return rs.deliverOrder(hotelId, order.id, parse('deliverRoomServiceOrderSchema', { requestId: randomUUID(), expectedUpdatedAt: order.updatedAt, payments: [{ method: 'CASH', amount: '10' }] }));
    }),
  4,
);

/* ══════════════════ Plan ══════════════════ */

const plans = {};
const capture = async (name, sql) => {
  const explained = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  plans[name] = explained.map((row) => row['QUERY PLAN']).filter((text) => /Index|Execution Time|Seq Scan|Bitmap/.test(text));
};
await capture('pano sütunu (mutfakta)', Prisma.sql`SELECT "id" FROM "RoomServiceOrder" WHERE "hotelId" = ${hotelId} AND "status" IN ('RECEIVED', 'PREPARING') ORDER BY "dueAt", "id" LIMIT 200`);
await capture('geçmiş (derin sayfa)', Prisma.sql`SELECT "id" FROM "RoomServiceOrder" WHERE "hotelId" = ${hotelId} ORDER BY "createdAt" DESC, "id" DESC LIMIT 25 OFFSET 74975`);
await capture(
  'geçmiş araması (numara / oda / ad)',
  Prisma.sql`WITH hits AS MATERIALIZED (SELECT "id", "createdAt" FROM "RoomServiceOrder" WHERE "hotelId" = ${hotelId} AND ("roomNumber" = ${sample.roomNumber} OR "number" LIKE ${`%${sample.number.slice(-6)}%`})) SELECT "id" FROM hits ORDER BY "createdAt" DESC LIMIT 25`,
);
await capture('hazırlık listesi', Prisma.sql`SELECT "id" FROM "RoomServiceOrder" WHERE "hotelId" = ${hotelId} AND "deliverAt" >= ${`${day(1)}T00:00:00Z`}::timestamp - INTERVAL '3 hours' AND "deliverAt" < ${`${day(2)}T00:00:00Z`}::timestamp - INTERVAL '3 hours' AND "status" NOT IN ('CANCELLED', 'REJECTED') ORDER BY "deliverAt", "id" LIMIT 1501`);
await capture('toplanacak tepsiler', Prisma.sql`SELECT "id" FROM "RoomServiceOrder" WHERE "hotelId" = ${hotelId} AND "status" = 'DELIVERED' AND "trayExpected" AND "trayCollectedAt" IS NULL ORDER BY "deliveredAt", "id" LIMIT 300`);
await capture(
  'rapor özeti (31 gün)',
  Prisma.sql`SELECT COUNT(*), COUNT(*) FILTER (WHERE "status" = 'DELIVERED') FROM "RoomServiceOrder" o WHERE o."hotelId" = ${hotelId} AND o."createdAt" >= ${`${day(-30)}T00:00:00Z`}::timestamp - INTERVAL '3 hours' AND o."createdAt" < ${`${day(1)}T00:00:00Z`}::timestamp - INTERVAL '3 hours'`,
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
