import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Acente bonusu uçlarının ve zamanlanmış işinin büyük veride süresi (modül 35; ölçüm aracı,
 * üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-agency-bonus.mjs
 *
 * Önce `perf-agencies.mjs` çalışmış olmalı (3000 acente, 600 kontratlı acente, rezervasyonların
 * %15'i acenteli). Bu betik üstüne kurar (yoksa; yeniden çalıştırmada tekrar kurmaz):
 * - "Dev tur operatörü" (PMEGA): son bir yılın çıkış yapmış, folyosu işlenmiş acentesiz
 *   rezervasyonlarından 25.000'i ona bağlanır (büyük TO'nun bir yıllık üretimi).
 * - 600 kontratlı acente + PMEGA için: geçen sezon (biten, gece ölçütlü, tüm üretime) ve bu
 *   sezon (süren, ciro ölçütlü, dilimli) kuralı yürürlükte; 600 taslak gelecek sezon kuralı.
 *
 * Ölçülen: ilerleme işi (otelin bütün yürürlükteki kuralları, tek sorgu), kural listesi
 * (sıralamalar, arama), kural ekranı (canlı), önizleme, dev acentenin hak edişi (hesap +
 * yeniden hesap, 25 bin satır), döküm sayfası / arama / Excel, rapor, özet; sonunda üretim
 * sorgusunun planı (acente index'i kullanılıyor mu).
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 5);
const MEGA_CODE = 'PMEGA';
const MEGA_RESERVATIONS = 25_000;
const RULE_AGENCIES = 600;

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const rules = await import('../src/modules/agency-bonus/service.js');
const settlement = await import('../src/modules/agency-bonus/settlement.js');
const progress = await import('../src/modules/agency-bonus/progress.js');
const queries = await import('../src/modules/agency-bonus/queries.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
const today = core.calendarDateInTimeZone(hotel.timezone);
const day = (offset) => core.toIsoDay(core.addDays(today, offset));
const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'perf@test.local' }, fn);
const PAST = { from: -400, to: -35 };
const SEASON = { from: -30, to: 150 };

/* ── Veri ── */
// Kurulum adım adım tekrarlanabilir: yarıda kalan çalıştırma kaldığı yerden devam eder.
const started = performance.now();
const mega =
  (await prisma.agency.findFirst({ where: { hotelId, code: MEGA_CODE }, select: { id: true } })) ??
  (await prisma.agency.create({
    data: { hotelId, code: MEGA_CODE, name: 'Perf Dev Tur Operatörü', commissionPct: '12', paymentTermDays: 45, createdBy: 'perf' },
    select: { id: true },
  }));
if ((await prisma.reservation.count({ where: { hotelId, agencyId: mega.id } })) === 0) {
  // Promosyonlu ve kanaldan gelen rezervasyon acenteye bağlanamaz (veritabanı kısıtı).
  const linked = await prisma.$executeRawUnsafe(
    `UPDATE "Reservation" r SET "agencyId" = $2, "agencyCommissionPct" = 12, "source" = 'AGENCY'
     WHERE r."id" IN (
       SELECT r2."id" FROM "Reservation" r2
       WHERE r2."hotelId" = $1 AND r2."agencyId" IS NULL AND r2."status" = 'CHECKED_OUT' AND r2."deletedAt" IS NULL
         AND r2."promotionId" IS NULL AND r2."channelBookingId" IS NULL
         AND r2."checkIn" >= $3::date::timestamp AND r2."checkIn" < $4::date::timestamp
         AND EXISTS (SELECT 1 FROM "FolioItem" i WHERE i."reservationId" = r2."id" AND i."source" = 'ROOM_NIGHT')
       ORDER BY r2."id"
       LIMIT ${MEGA_RESERVATIONS})`,
    hotelId,
    mega.id,
    day(PAST.from),
    day(PAST.to),
  );
  await prisma.$executeRawUnsafe('ANALYZE "Reservation"');
  console.log(`Dev acenteye ${linked} rezervasyon bağlandı.`);
}
if ((await prisma.agencyBonusRule.count({ where: { hotelId, createdBy: 'perf' } })) === 0) {
  const agencyIds = [
    mega.id,
    ...(
      await prisma.agency.findMany({
        where: { hotelId, status: 'ACTIVE', code: { startsWith: 'P0' }, contracts: { some: { status: 'ACTIVE' } } },
        orderBy: { code: 'asc' },
        take: RULE_AGENCIES,
        select: { id: true },
      })
    ).map((row) => row.id),
  ];
  const now = new Date();
  const ruleRows = agencyIds.flatMap((agencyId, index) => [
    {
      hotelId,
      agencyId,
      name: `Perf geçen sezon ${index}`,
      startDate: new Date(day(PAST.from)),
      endDate: new Date(day(PAST.to)),
      metric: 'NIGHTS',
      mode: 'WHOLE',
      target: String(agencyId === mega.id ? 60_000 : 300),
      tiers: agencyId === mega.id
        ? [{ threshold: '50000', ratePct: '1' }, { threshold: '60000', ratePct: '2' }, { threshold: '70000', ratePct: '3' }]
        : [{ threshold: '200', ratePct: '1' }, { threshold: '300', ratePct: '2' }, { threshold: '400', ratePct: '3' }],
      roomTypeIds: [],
      currency: hotel.currency,
      status: 'ACTIVE',
      createdBy: 'perf',
      activatedAt: now,
      activatedBy: 'perf',
    },
    {
      hotelId,
      agencyId,
      name: `Perf bu sezon ${index}`,
      startDate: new Date(day(SEASON.from)),
      endDate: new Date(day(SEASON.to)),
      metric: 'REVENUE',
      mode: 'EXCESS',
      target: '500000',
      tiers: [{ threshold: '250000', ratePct: '1' }, { threshold: '500000', ratePct: '2.5' }],
      roomTypeIds: [],
      maxBonus: '50000',
      currency: hotel.currency,
      status: 'ACTIVE',
      createdBy: 'perf',
      activatedAt: now,
      activatedBy: 'perf',
    },
    {
      hotelId,
      agencyId,
      name: `Perf gelecek sezon ${index}`,
      startDate: new Date(day(200)),
      endDate: new Date(day(380)),
      metric: 'REVENUE',
      mode: 'WHOLE',
      target: '800000',
      tiers: [{ threshold: '600000', ratePct: '1.5' }],
      roomTypeIds: [],
      currency: hotel.currency,
      status: 'DRAFT',
      createdBy: 'perf',
    },
  ]);
  for (let start = 0; start < ruleRows.length; start += 1000) {
    await prisma.agencyBonusRule.createMany({ data: ruleRows.slice(start, start + 1000) });
  }
  await prisma.$executeRawUnsafe('ANALYZE "AgencyBonusRule"');
  console.log(`Veri kuruldu: ${ruleRows.length} kural (${((performance.now() - started) / 1000).toFixed(1)} sn).`);
}

/* ── Ölçüm ── */
const results = [];
async function measure(name, fn, rounds = ROUNDS) {
  const times = [];
  let last;
  for (let round = 0; round < rounds; round += 1) {
    const started = performance.now();
    last = await fn(round);
    times.push(performance.now() - started);
  }
  const sorted = (rounds > 1 ? times.slice(1) : times).sort((a, b) => a - b);
  results.push({ name, best: sorted[0], median: sorted[Math.floor(sorted.length / 2)], worst: sorted.at(-1) });
  return last;
}

const businessDate = core.toIsoDay(today);
const activeRules = await prisma.agencyBonusRule.count({ where: { hotelId, status: 'ACTIVE' } });
const megaRules = await prisma.agencyBonusRule.findMany({ where: { hotelId, agencyId: mega.id, status: 'ACTIVE' }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } });
const megaReservations = await prisma.reservation.count({ where: { hotelId, agencyId: mega.id } });

const refreshed = await measure(`ilerleme işi (${activeRules} yürürlükteki kural)`, () => progress.refreshProgress(hotelId, { announce: false, businessDate }), 3);
await measure('kural listesi (dönem sonu, sayfa 1)', () => rules.listRules(hotelId, contracts.agencyBonusRuleListQuerySchema.parse({})));
await measure('kural listesi (hedefe ulaşma ↓, sayfa 20)', () => rules.listRules(hotelId, contracts.agencyBonusRuleListQuerySchema.parse({ sort: 'SCORE_DESC', page: 20 })));
await measure('kural listesi (süren, arama)', () => rules.listRules(hotelId, contracts.agencyBonusRuleListQuerySchema.parse({ phase: 'RUNNING', search: 'Perf Acente 12' })));
await measure('panel özeti', () => rules.getBonusSummary(hotelId));
await measure(`kural ekranı (dev acente, geçen sezon, canlı)`, () => rules.getRule(hotelId, megaRules[0].id));
await measure(`kural ekranı (dev acente, bu sezon, canlı)`, () => rules.getRule(hotelId, megaRules[1].id));
await measure('önizleme (dev acente, 1 yıl)', () =>
  rules.previewRule(hotelId, {
    agencyId: mega.id,
    startDate: new Date(day(PAST.from)),
    endDate: new Date(day(PAST.to)),
    metric: 'REVENUE',
    mode: 'EXCESS',
    target: '10000000',
    tiers: [{ threshold: '5000000', ratePct: '1' }, { threshold: '10000000', ratePct: '2' }],
    roomTypeIds: [],
    maxBonus: null,
  }),
);

// Hak ediş: ilk hesap + yeniden hesap (satırlar silinip yeniden yazılır). Önceki çalıştırmadan kalan
// onaya gitmemiş hak ediş yeniden hesaplanır.
const bonus = await measure(`hak ediş hesabı (dev acente, ${megaReservations} rezervasyon)`, () => as(() => settlement.calculateBonus(hotelId, megaRules[0].id)), 3);
await measure('hak ediş ekranı (fark denetimiyle)', () => settlement.getBonus(hotelId, bonus.id));
await measure('döküm (ciro ↓, sayfa 1)', () => settlement.listBonusLines(hotelId, bonus.id, contracts.agencyBonusLinesQuerySchema.parse({})));
await measure('döküm (giriş tarihi, sayfa 200)', () => settlement.listBonusLines(hotelId, bonus.id, contracts.agencyBonusLinesQuerySchema.parse({ sort: 'CHECK_IN', page: 200 })));
await measure('döküm (misafir araması)', () => settlement.listBonusLines(hotelId, bonus.id, contracts.agencyBonusLinesQuerySchema.parse({ search: 'Perf' })));
let exportNote = '';
try {
  await measure('Excel dökümü (bütün parçalar)', async () => {
    const first = await settlement.exportBonusLines(hotelId, bonus.id, { part: 1 });
    for (let part = 2; part <= first.parts; part += 1) await settlement.exportBonusLines(hotelId, bonus.id, { part });
  }, 2);
} catch (error) {
  exportNote = `Excel dökümü: ${error.message}`;
}
await measure('hak ediş raporu (sayfa 1)', () => settlement.listBonuses(hotelId, contracts.agencyBonusListQuerySchema.parse({})));

// Üretim sorgusunun planı: otelin bütün yürürlükteki kuralları tek sorguda.
const specs = (
  await prisma.agencyBonusRule.findMany({ where: { hotelId, status: 'ACTIVE' }, select: { id: true, agencyId: true, startDate: true, endDate: true, roomTypeIds: true } })
).map((row) => ({ id: row.id, agencyId: row.agencyId, startDate: core.toIsoDay(row.startDate), endDate: core.toIsoDay(row.endDate), roomTypeIds: row.roomTypeIds }));
let plan = [];
try {
  // Sorgu, aynı parametrelerle yakalanıp EXPLAIN'e sarılır (sorgu metni iki yerde yazılmasın).
  const { Prisma } = await import('@prisma/client');
  let captured = null;
  const capture = { $queryRaw: (strings, ...values) => ((captured = Prisma.sql(strings, ...values)), Promise.resolve([])) };
  await queries.loadProductionTotals(capture, hotelId, specs, businessDate);
  const explained = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${captured}`);
  plan = explained.map((row) => row['QUERY PLAN']);
} catch (error) {
  plan = [`Plan alınamadı: ${error.message}`];
}

const pad = (text, size) => String(text).padEnd(size);
console.log(`\nİlerleme turu: ${JSON.stringify(refreshed)} · dev acente hak edişi: ${bonus.nights} gece, ${bonus.revenue} ${bonus.currency}, ${bonus.reservationCount} satır, prim ${bonus.amount}`);
if (exportNote) console.log(exportNote);
console.log(`\n${pad('ölçüm', 56)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) {
  console.log(`${pad(row.name, 56)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
}
console.log('\nÜretim sorgusu planı (index satırları ve süre):');
for (const line of plan.filter((text) => /Index|Execution Time|Planning Time|Seq Scan/.test(text))) console.log(`  ${line.trim()}`);
await prisma.$disconnect();
