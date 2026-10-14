import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Kanal yönetiminin büyük veride süresi (modül 33; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-channels.mjs
 *
 * Veri (yoksa kurulur): senkronda bir Channex kanalı — otelin bütün oda
 * tipleri eşleşmiş, her tipe iki fiyat planı —, 100 bin senkron log satırı ve
 * 20 bin kanal rezervasyonu. Channex çağrısı yapılmaz: `fetch` anında cevap veren
 * yerel bir taklitle değiştirilir (ağ süresi ölçüme girmez; ölçülen, bizim hesap
 * ve veritabanı yükümüz). Her ölçüm birkaç tur çalışır; ilk tur ısınma.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 5);
const LOGS = 100_000;
const BOOKINGS = 20_000;
// Ölçüm süreci için geçici şifreleme anahtarı (kanalın anahtarı bununla saklanır; sunucunun anahtarından bağımsız).
process.env.SETTINGS_SECRET_KEY = process.env.PERF_SECRET_KEY ?? randomBytes(32).toString('base64');

const core = await import('@hotelos/core');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const { sealSecret } = await import('../src/lib/secret-box.js');
const ari = await import('../src/modules/channel-manager/ari.js');
const sync = await import('../src/modules/channel-manager/sync.js');
const service = await import('../src/modules/channel-manager/service.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });

// Channex taklidi: her çağrı anında başarılı (görev kimliğiyle).
let calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ data: [{ id: `task-${calls}`, type: 'task' }], meta: { warnings: [] } }) };
};

/* ── Veri ── */
const started = performance.now();
let channel = await prisma.channel.findFirst({ where: { hotelId, name: 'Perf Channex' } });
const types = await prisma.roomType.findMany({ where: { hotelId }, orderBy: { code: 'asc' }, select: { id: true, code: true } });
if (!channel) {
  channel = await prisma.channel.create({
    data: {
      hotelId,
      type: 'CHANNEX',
      name: 'Perf Channex',
      status: 'ACTIVE',
      environment: 'STAGING',
      propertyId: '00000000-0000-4000-8000-00000000c0de',
      apiKey: 'yer-tutucu',
      priceMarkupPercent: '12.50',
      horizonDays: 500,
      externalName: 'Perf',
      externalCurrency: hotel.currency,
      activatedAt: new Date(),
      activatedBy: 'perf',
      createdBy: 'perf',
      state: { create: { hotelId } },
    },
  });
  for (const type of types) {
    const mapping = await prisma.channelRoomMapping.create({ data: { hotelId, channelId: channel.id, roomTypeId: type.id, externalRoomTypeId: `cx-${type.code}`, externalName: type.code } });
    await prisma.channelRateMapping.createMany({
      data: [
        { hotelId, channelId: channel.id, roomMappingId: mapping.id, externalRatePlanId: `cx-${type.code}-ro`, boardType: 'RO' },
        { hotelId, channelId: channel.id, roomMappingId: mapping.id, externalRatePlanId: `cx-${type.code}-bb`, boardType: 'BB' },
      ],
    });
  }
}
if ((await prisma.channelSyncLog.count({ where: { channelId: channel.id } })) < LOGS) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ChannelSyncLog" ("id","hotelId","channelId","kind","status","trigger","summary","details","durationMs","createdAt")
     SELECT gen_random_uuid(), $1, $2,
            (ARRAY['DELTA','DELTA','DELTA','BOOKINGS','FULL']::"ChannelSyncKind"[])[1 + (n % 5)],
            (ARRAY['SUCCESS','SUCCESS','SUCCESS','SUCCESS','FAILED']::"ChannelSyncStatus"[])[1 + (n % 5)],
            'CHANGE', 'Değişiklik — müsaitlik: 1 oda tipi, 2 gün', '{}'::jsonb, 120, (now() AT TIME ZONE 'UTC') - (n || ' minutes')::interval
     FROM generate_series(1, ${LOGS}) AS n`,
    hotelId,
    channel.id,
  );
}
if ((await prisma.channelBooking.count({ where: { channelId: channel.id } })) < BOOKINGS) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ChannelBooking" ("id","hotelId","channelId","externalBookingId","externalCode","otaName","status","state","guestName","checkIn","checkOut","roomCount","amount","currency","createdAt","updatedAt")
     SELECT gen_random_uuid(), $1, $2, 'perf-' || n, (1000000000 + n)::text, 'Booking.com',
            (CASE WHEN n % 10 = 0 THEN 'CANCELLED' ELSE 'ACTIVE' END)::"ChannelBookingStatus",
            (ARRAY['PROCESSED','PROCESSED','PROCESSED','REVIEW','ATTENTION']::"ChannelBookingState"[])[1 + (n % 5)],
            'Misafir ' || n, current_date + (n % 300), current_date + (n % 300) + 2, 1, 3000, $3, (now() AT TIME ZONE 'UTC') - (n || ' minutes')::interval, (now() AT TIME ZONE 'UTC')
     FROM generate_series(1, ${BOOKINGS}) AS n`,
    hotelId,
    channel.id,
    hotel.currency,
  );
  console.log(`Veri kuruldu: ${types.length} oda tipi × 2 fiyat planı, ${LOGS} log, ${BOOKINGS} kanal rezervasyonu (${((performance.now() - started) / 1000).toFixed(1)} sn).`);
}
// Anahtar bu sürecin geçici anahtarıyla yeniden saklanır (gönderim taklide gider).
await prisma.channel.update({ where: { id: channel.id }, data: { apiKey: sealSecret('perf-anahtari-1234567890') } });
const reservationsInHorizon = await prisma.reservation.count({
  where: { hotelId, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] }, checkOut: { gt: new Date() }, checkIn: { lt: core.addDays(new Date(), 500) } },
});

/* ── Ölçüm ── */
const results = [];
async function measure(name, fn, rounds = ROUNDS) {
  const times = [];
  for (let round = 0; round < rounds; round += 1) {
    const begin = performance.now();
    await fn(round);
    times.push(performance.now() - begin);
  }
  const sorted = times.slice(1).sort((a, b) => a - b);
  results.push({ name, best: sorted[0], median: sorted[Math.floor(sorted.length / 2)], worst: sorted.at(-1) });
}

const rooms = await prisma.channelRoomMapping.findMany({
  where: { channelId: channel.id },
  select: { id: true, roomTypeId: true, externalRoomTypeId: true, rates: { select: { externalRatePlanId: true, boardType: true } } },
});
const today = ari.channelToday(hotel);
const horizon = ari.horizonWindow(today, 500);
const rateTargets = rooms.reduce((sum, room) => sum + room.rates.length, 0);

await measure(`500 günlük değer hesabı (${rooms.length} tip, ${reservationsInHorizon} rezervasyon ufukta)`, () =>
  ari.computeRoomTypeValues({ hotelId, channel, rooms, window: horizon }),
);
await measure(`tam eşitleme (2 çağrı, ${rooms.length} + ${rateTargets} hedef, durum yazımı dahil)`, async () => {
  await prisma.channelState.update({ where: { channelId: channel.id }, data: { fullSyncRequestedAt: new Date(), pausedUntil: null } });
  const outcome = await sync.syncChannel(channel.id, { full: true });
  if (outcome !== 'SUCCESS') throw new Error(`tam eşitleme: ${outcome}`);
});
await measure('işaretleme (aktörün olay başına işi)', () => sync.markChannelsDirty(hotelId, { from: core.toIsoDay(core.addDays(new Date(), 30)), to: core.toIsoDay(core.addDays(new Date(), 33)) }), 10);
await measure('fark gönderimi (3 gecelik pencere, değişiklik yok)', async () => {
  await sync.markChannelsDirty(hotelId, { from: core.toIsoDay(core.addDays(new Date(), 30)), to: core.toIsoDay(core.addDays(new Date(), 33)) });
  await sync.syncChannel(channel.id, { full: false });
});
await measure('fark gönderimi (bütün ufuk: oda ataması / düzenleme)', async () => {
  await sync.markChannelsDirty(hotelId, null);
  await sync.syncChannel(channel.id, { full: false });
});
await measure('kanal listesi', () => service.listChannels(hotelId, { page: 1, pageSize: 20 }));
await measure('kanal kartı', () => service.getChannel(hotelId, channel.id));
await measure(`senkron logu (sayfa 1, ${LOGS} satır)`, () => service.listChannelLogs(hotelId, channel.id, { page: 1, pageSize: 30 }));
await measure('senkron logu (hata süzgeci)', () => service.listChannelLogs(hotelId, channel.id, { page: 1, pageSize: 30, status: 'FAILED' }));
await measure('senkron logu (sayfa 100)', () => service.listChannelLogs(hotelId, channel.id, { page: 100, pageSize: 30 }));
await measure(`kanal rezervasyonları (sayfa 1, ${BOOKINGS})`, () => service.listChannelBookings(hotelId, channel.id, { page: 1, pageSize: 20 }));
await measure('kanal rezervasyonları (elle işlenmeli)', () => service.listChannelBookings(hotelId, channel.id, { page: 1, pageSize: 20, state: 'ATTENTION' }));
await measure('kanal rezervasyonları (kod araması)', () => service.listChannelBookings(hotelId, channel.id, { page: 1, pageSize: 20, search: '100001234' }));

const pad = (text, size) => String(text).padEnd(size);
console.log(`\n${pad('ölçüm', 72)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) {
  console.log(`${pad(row.name, 72)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
}
console.log(`\nChannex taklidine giden çağrı: ${calls}`);
await prisma.$disconnect();
