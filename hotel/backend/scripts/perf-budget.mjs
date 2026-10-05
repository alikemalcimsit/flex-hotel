import { performance } from 'node:perf_hooks';

/**
 * Sapma raporunun büyük veride süresi (modül 27; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-budget.mjs
 *
 * Önbellek her turda temizlenir (soğuk hesap); yılbaşından bu yana (en ağır)
 * ve tek ay. İlk tur ısınma.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 4);
const core = await import('@hotelos/core');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const variance = await import('../src/modules/budget/variance.js');
const reports = await import('../src/modules/reports/service.js');

const hotelId = await resolveHotelId();
const today = core.toIsoDay(new Date());
const year = Number(today.slice(0, 4));
const month = Number(today.slice(5, 7));

for (const scope of ['YTD', 'MONTH']) {
  const times = [];
  let result;
  for (let round = 0; round < ROUNDS; round += 1) {
    variance.clearBudgetCache();
    reports.clearReportCache();
    const started = performance.now();
    result = await variance.getVarianceReport(hotelId, { year, month, scope });
    times.push(performance.now() - started);
  }
  const sorted = times.slice(1).sort((a, b) => a - b);
  const room = result.rows.find((row) => row.item === 'ROOM_REVENUE');
  console.log(`${scope.padEnd(5)} en iyi ${sorted[0].toFixed(0)} ms · ortanca ${sorted[Math.floor(sorted.length / 2)].toFixed(0)} ms · ${result.period.months.length} ay · oda geliri ${room.actual} · gece ${result.nights.sold}`);
}
await prisma.$disconnect();
