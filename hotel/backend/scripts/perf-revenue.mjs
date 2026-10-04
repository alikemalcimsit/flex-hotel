import { performance } from 'node:perf_hooks';

/**
 * Gelir raporunun büyük veride süresi (modül 23; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-revenue.mjs
 *
 * Önbellek her turda temizlenir (soğuk hesap ölçülür). Bir yıllık günlük, aylık
 * ve bir aylık günlük rapor; ilk tur ısınma.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 4);
const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const reports = await import('../src/modules/reports/service.js');
const stats = await import('../src/modules/reports/stats.js');

const hotelId = await resolveHotelId();

// Özet turu: doldurulacak gün kalmayana kadar (ilk kurulumdaki gibi). Tur süresi de ölçülür.
if (process.env.PERF_SKIP_STATS !== '1') {
  for (let round = 1; ; round += 1) {
    const started = performance.now();
    const result = await stats.refreshHotelStats(hotelId);
    console.log(`özet turu ${round}: ${JSON.stringify(result)} · ${(performance.now() - started).toFixed(0)} ms`);
    if (result.backfilled === 0) break;
  }
}
const today = core.toIsoDay(new Date());
const scenarios = [
  { name: 'son 365 gün, günlük', query: { from: contracts.shiftDay(today, -365), to: contracts.shiftDay(today, -1), groupBy: 'DAY' } },
  { name: 'son 365 gün, aylık', query: { from: contracts.shiftDay(today, -365), to: contracts.shiftDay(today, -1), groupBy: 'MONTH' } },
  { name: 'bu ay ± 30 gün (geçmiş + eldeki)', query: { from: contracts.shiftDay(today, -30), to: contracts.shiftDay(today, 30), groupBy: 'DAY' } },
];

for (const scenario of scenarios) {
  const times = [];
  let result;
  for (let round = 0; round < ROUNDS; round += 1) {
    reports.clearReportCache();
    const started = performance.now();
    result = await reports.getRevenueReport(hotelId, scenario.query);
    times.push(performance.now() - started);
  }
  const sorted = times.slice(1).sort((a, b) => a - b);
  console.log(
    `${scenario.name.padEnd(36)} en iyi ${sorted[0].toFixed(0)} ms · ortanca ${sorted[Math.floor(sorted.length / 2)].toFixed(0)} ms · ` +
      `${result.totals.sold} gece, gelir ${result.totals.roomRevenue}, ${result.buckets.length} kova`,
  );
}
await prisma.$disconnect();
