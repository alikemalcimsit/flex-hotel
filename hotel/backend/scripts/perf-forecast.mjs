import { performance } from 'node:perf_hooks';

/**
 * Tahminin büyük veride süresi (modül 25; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-forecast.mjs
 *
 * Önbellek her turda temizlenir (soğuk hesap ölçülür); ilk tur ısınma.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 5);
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const forecast = await import('../src/modules/forecast/service.js');

const hotelId = await resolveHotelId();
const times = [];
let result;
for (let round = 0; round < ROUNDS; round += 1) {
  forecast.clearForecastCache();
  const started = performance.now();
  result = await forecast.getForecast(hotelId, { days: 30 });
  times.push(performance.now() - started);
}
const sorted = times.slice(1).sort((a, b) => a - b);
console.log(
  `30 günlük tahmin: en iyi ${sorted[0].toFixed(0)} ms · ortanca ${sorted[Math.floor(sorted.length / 2)].toFixed(0)} ms · ` +
    `kaynak ${JSON.stringify(result.basisCounts)} · eldeki ${result.totals.onBooks.sold} gece · tahmin ${result.totals.forecast.nights} gece ` +
    `(%${result.totals.forecast.occupancyPct}) · kritik ${result.alerts.length} gün`,
);
await prisma.$disconnect();
