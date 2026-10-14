import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Acente ve kontrat uçlarının büyük veride süresi (modül 29; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-agencies.mjs
 *
 * Veri (yoksa kurulur, yeniden çalıştırmada tekrar kurulmaz): 3000 acente
 * (her 50'de biri pasif), ilk 600 aktif acentenin satıştaki kontratı (12 oda
 * tipi × 3 pansiyon × 3 dönem = 108 fiyat satırı, 2 stop-sale) ve mevcut
 * rezervasyonların %15'i bir acenteye bağlanır (komisyon %10). Her ölçüm birkaç
 * tur çalışır; ilk tur ısınma.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 6);
const AGENCIES = 3000;
const CONTRACTED = 600;
const BOARDS = ['BB', 'HB', 'AI'];
const BOARD_FACTOR = { BB: 1, HB: 1.15, AI: 1.35 };

const core = await import('@hotelos/core');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const agencies = await import('../src/modules/agencies/service.js');
const reservations = await import('../src/modules/reservations/service.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
const today = core.calendarDateInTimeZone(hotel.timezone);
const day = (offset) => core.toIsoDay(core.addDays(today, offset));
const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'perf@test.local' }, fn);

/* ── Veri ── */
if ((await prisma.agency.count({ where: { hotelId } })) < AGENCIES) {
  const started = performance.now();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Agency" ("id", "hotelId", "code", "name", "contactName", "commissionPct", "paymentTermDays", "status", "createdBy", "updatedAt")
     SELECT gen_random_uuid(), $1, 'P' || lpad(n::text, 5, '0'), 'Perf Acente ' || n, 'Yetkili ' || n, 5 + (n % 15), (n % 8) * 15,
            CASE WHEN n % 50 = 0 THEN 'PASSIVE'::"AgencyStatus" ELSE 'ACTIVE'::"AgencyStatus" END, 'perf', now()
     FROM generate_series(1, ${AGENCIES}) AS n
     ON CONFLICT DO NOTHING`,
    hotelId,
  );
  const picked = await prisma.agency.findMany({ where: { hotelId, status: 'ACTIVE', code: { startsWith: 'P' } }, orderBy: { code: 'asc' }, take: CONTRACTED, select: { id: true } });
  const types = await prisma.roomType.findMany({ where: { hotelId }, select: { id: true, basePrice: true } });
  const blocks = [[-30, 99], [100, 249], [250, 400]];
  for (const [index, agency] of picked.entries()) {
    const contract = await prisma.contract.create({
      data: { hotelId, agencyId: agency.id, name: 'Perf 2027', startDate: new Date(day(-30)), endDate: new Date(day(400)), status: 'ACTIVE', currency: hotel.currency, createdBy: 'perf', activatedAt: new Date(), activatedBy: 'perf' },
    });
    const rows = [];
    for (const type of types) {
      for (const board of BOARDS) {
        blocks.forEach(([from, to], blockIndex) => {
          rows.push({ hotelId, contractId: contract.id, roomTypeId: type.id, boardType: board, startDate: new Date(day(from)), endDate: new Date(day(to)), price: (Number(type.basePrice) * BOARD_FACTOR[board] * (0.8 + blockIndex * 0.1)).toFixed(2) });
        });
      }
    }
    await prisma.contractRate.createMany({ data: rows });
    await prisma.contractStopSale.createMany({
      data: [10, 200].map((offset) => ({ hotelId, contractId: contract.id, roomTypeId: null, startDate: new Date(day(offset + (index % 7))), endDate: new Date(day(offset + (index % 7) + 2)), createdBy: 'perf' })),
    });
  }
  await prisma.$executeRawUnsafe(
    `CREATE TEMP TABLE perf_agencies AS
       SELECT (row_number() OVER (ORDER BY "code") - 1)::int AS idx, "id" FROM "Agency" WHERE "hotelId" = $1 AND "status" = 'ACTIVE' AND "code" LIKE 'P%' ORDER BY "code" LIMIT ${CONTRACTED}`,
    hotelId,
  );
  const linked = await prisma.$executeRawUnsafe(
    `UPDATE "Reservation" r SET "agencyId" = pa."id", "agencyCommissionPct" = 10
     FROM perf_agencies pa
     WHERE r."hotelId" = $1 AND r."agencyId" IS NULL AND abs(hashtext(r."id")) % 100 < 15 AND pa."idx" = abs(hashtext(r."id" || 'g')) % ${CONTRACTED}`,
    hotelId,
  );
  await prisma.$executeRawUnsafe('ANALYZE "Agency"');
  await prisma.$executeRawUnsafe('ANALYZE "Contract"');
  await prisma.$executeRawUnsafe('ANALYZE "ContractRate"');
  await prisma.$executeRawUnsafe('ANALYZE "Reservation"');
  console.log(`Veri kuruldu: ${AGENCIES} acente, ${CONTRACTED} kontrat, ${linked} rezervasyon acenteye bağlandı (${((performance.now() - started) / 1000).toFixed(1)} sn).`);
}

/* ── Ölçüm ── */
const results = [];
async function measure(name, fn, rounds = ROUNDS) {
  const times = [];
  for (let round = 0; round < rounds; round += 1) {
    const started = performance.now();
    await fn(round);
    times.push(performance.now() - started);
  }
  const sorted = times.slice(1).sort((a, b) => a - b);
  results.push({ name, best: sorted[0], median: sorted[Math.floor(sorted.length / 2)], worst: sorted.at(-1) });
}

const sample = await prisma.agency.findFirst({ where: { hotelId, status: 'ACTIVE', code: 'P00007' }, select: { id: true } });
const contract = await prisma.contract.findFirst({ where: { hotelId, agencyId: sample.id, status: 'ACTIVE' }, select: { id: true } });
const linkedCount = await prisma.reservation.count({ where: { hotelId, agencyId: sample.id } });
const type = await prisma.roomType.findFirst({ where: { hotelId }, orderBy: { code: 'asc' }, select: { id: true, code: true } });

await measure('acente listesi (sayfa 1)', () => agencies.listAgencies(hotelId, { page: 1, pageSize: 20 }));
await measure('acente listesi (sayfa 100)', () => agencies.listAgencies(hotelId, { page: 100, pageSize: 20 }));
await measure('acente listesi (arama)', () => agencies.listAgencies(hotelId, { page: 1, pageSize: 20, search: 'Perf Acente 12' }));
await measure('seçici araması', () => agencies.searchAgencyOptions(hotelId, { q: 'acente 12' }));
await measure('acente kartı + kontratları', () => agencies.getAgency(hotelId, sample.id));
await measure(`kontrat ekranı (${108} fiyat satırı)`, () => agencies.getContract(hotelId, contract.id));
await measure(`cari özeti (${linkedCount} rezervasyon, 5 yıl)`, () => agencies.getAgencySummary(hotelId, sample.id, { from: new Date(day(-1500)), to: new Date(day(400)) }));
await measure('acente rezervasyonları (sayfa 1)', () => agencies.listAgencyReservations(hotelId, sample.id, { page: 1, pageSize: 20 }));
await measure('acente rezervasyonları (arama)', () => agencies.listAgencyReservations(hotelId, sample.id, { page: 1, pageSize: 20, search: 'a' }));

const quoteInput = (extra = {}) => ({ checkIn: new Date(day(20)), checkOut: new Date(day(24)), lines: [{ roomTypeId: type.id, quantity: 1, adults: 2, children: 0 }], excludeReservationId: null, ...extra });
await measure('fiyat önizlemesi (acentesiz)', () => reservations.quoteReservation(hotelId, quoteInput()));
await measure('fiyat önizlemesi (acente, 12 oda tipi)', () => reservations.quoteReservation(hotelId, quoteInput({ agencyId: sample.id, boardType: 'HB' })));

// Rezervasyon açma: veri dışında, ileri bir tarih (kontrat sonuna yakın, stop-sale yok).
const created = [];
let guestCounter = 0;
const create = (agencyId) =>
  as(async () => {
    guestCounter += 1;
    const result = await reservations.createReservation(
      hotelId,
      {
        guestId: null,
        guest: { firstName: 'Perf', lastName: `Misafir${guestCounter}`, phone: `+9055500${String(Date.now() % 1_000_000).padStart(6, '0')}${guestCounter}`.slice(0, 15), email: null, nationality: 'TR' },
        forceNewGuest: true,
        roomTypeId: type.id,
        adults: 2,
        children: 0,
        boardType: 'HB',
        checkIn: new Date(day(300 + (guestCounter % 40) * 2)),
        checkOut: new Date(day(302 + (guestCounter % 40) * 2)),
        status: 'CONFIRMED',
        source: agencyId ? 'AGENCY' : 'UI',
        notes: null,
        requestId: randomUUID(),
        waitlistId: null,
        roomId: null,
        manualTotal: null,
        priceNote: null,
        agencyId,
      },
      {},
    );
    created.push(result.reservation.id);
    return result;
  });
await measure('rezervasyon açma (acentesiz)', () => create(null), 8);
await measure('rezervasyon açma (acente kontratı)', () => create(sample.id), 8);

// Eşzamanlı acente rezervasyonları: aynı acenteye 8 istek birlikte.
await measure('8 eşzamanlı acente rezervasyonu (toplam)', () => Promise.all(Array.from({ length: 8 }, () => create(sample.id))), 4);

if (created.length) {
  await prisma.$executeRawUnsafe('DELETE FROM "ReservationNight" WHERE "reservationId" = ANY($1::text[])', created);
  await prisma.$executeRawUnsafe('DELETE FROM "Reservation" WHERE "id" = ANY($1::text[])', created);
}

const pad = (text, size) => String(text).padEnd(size);
console.log(`\n${pad('ölçüm', 48)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) {
  console.log(`${pad(row.name, 48)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
}
await prisma.$disconnect();
