import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Promosyon ve kupon uçlarının büyük veride süresi (modül 31; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-promotions.mjs
 *
 * Veri (yoksa kurulur, yeniden çalıştırmada tekrar kurulmaz): yayında 200
 * kendiliğinden promosyon (çoğu dar koşullu: bir oda tipi, bir pansiyon, bir
 * dönem — gerçek otelde de çoğu satışa uymaz) ve 50 kuponlu promosyon × 2000
 * kupon (100 bin kod). Acentesiz rezervasyonların %20'si bir promosyona bağlanır
 * (kuponlularda bir kupon; indirim tutarın %10'u). Her ölçüm birkaç tur
 * çalışır; ilk tur ısınma.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 6);
const AUTO = 200;
const COUPON_PROMOTIONS = 50;
const COUPONS_EACH = 2000;
const DIRECT = `ARRAY['UI','PHONE','EMAIL','WEBCHAT','WHATSAPP','WIDGET']::"ReservationSource"[]`;

const core = await import('@hotelos/core');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const promotions = await import('../src/modules/promotions/service.js');
const reservations = await import('../src/modules/reservations/service.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
const today = core.calendarDateInTimeZone(hotel.timezone);
const day = (offset) => core.toIsoDay(core.addDays(today, offset));
const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'perf@test.local' }, fn);

/* ── Veri ── */
const started = performance.now();
if ((await prisma.promotion.count({ where: { hotelId, createdBy: 'perf' } })) < AUTO + COUPON_PROMOTIONS) {
  const types = await prisma.roomType.findMany({ where: { hotelId }, orderBy: { code: 'asc' }, select: { id: true } });
  const typeArray = `ARRAY[${types.map((type) => `'${type.id}'`).join(',')}]::text[]`;
  // Kendiliğinden: %5–%25; her 10'dan 9'u tek oda tipi + tek pansiyon + 60 günlük konaklama dönemiyle dar.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Promotion" ("id","hotelId","name","status","requiresCoupon","discountType","discountValue","stayFrom","stayTo","minNights","minLeadDays","roomTypeIds","boardTypes","sources","createdBy","activatedAt","activatedBy","updatedAt")
     SELECT gen_random_uuid(), $1, 'Perf Kendiliğinden ' || n, 'ACTIVE', false, 'PERCENT', 5 + (n % 21),
            CASE WHEN n % 10 = 0 THEN NULL ELSE $2::date + ((n % 12) * 30) END,
            CASE WHEN n % 10 = 0 THEN NULL ELSE $2::date + ((n % 12) * 30) + 59 END,
            CASE WHEN n % 3 = 0 THEN 3 ELSE NULL END,
            CASE WHEN n % 4 = 0 THEN 30 ELSE NULL END,
            CASE WHEN n % 10 = 0 THEN ARRAY[]::text[] ELSE ARRAY[(${typeArray})[1 + (n % ${types.length})]] END,
            CASE WHEN n % 10 = 0 THEN ARRAY[]::"BoardType"[] ELSE ARRAY[(ARRAY['BB','HB','AI']::"BoardType"[])[1 + (n % 3)]] END,
            ${DIRECT}, 'perf', now(), 'perf', now()
     FROM generate_series(1, ${AUTO}) AS n`,
    hotelId,
    new Date(day(-30)),
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Promotion" ("id","hotelId","name","status","requiresCoupon","discountType","discountValue","sources","createdBy","activatedAt","activatedBy","updatedAt")
     SELECT gen_random_uuid(), $1, 'Perf Kupon ' || n, 'ACTIVE', true, 'PERCENT', 10 + (n % 20), ${DIRECT}, 'perf', now(), 'perf', now()
     FROM generate_series(1, ${COUPON_PROMOTIONS}) AS n`,
    hotelId,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Coupon" ("id","hotelId","promotionId","code","maxUses","batchId","createdBy","updatedAt")
     SELECT gen_random_uuid(), p."hotelId", p."id", 'PK' || lpad(p.idx::text, 2, '0') || '-' || lpad(n::text, 6, '0'),
            CASE WHEN n % 20 = 0 THEN NULL ELSE 1 END, p."batchId", 'perf', now()
     FROM (SELECT "id", "hotelId", row_number() OVER (ORDER BY "name") AS idx, gen_random_uuid()::text AS "batchId"
             FROM "Promotion" WHERE "hotelId" = $1 AND "requiresCoupon" AND "createdBy" = 'perf') p
     CROSS JOIN generate_series(1, ${COUPONS_EACH}) AS n`,
    hotelId,
  );
}
// Bağlantı havuzunda geçici tablo başka bağlantıda görünmez: kalıcı ara tablo (sonda silinir).
if ((await prisma.reservation.count({ where: { hotelId, promotionId: { not: null } } })) === 0) {
  // Rezervasyonların %20'si promosyonlu: kopya JSON'da en az kimlik, ad ve satış günü (CHECK: kopya ↔ promosyon).
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS perf_promotions');
  await prisma.$executeRawUnsafe(
    `CREATE TABLE perf_promotions AS
       SELECT (row_number() OVER (ORDER BY "name") - 1)::int AS idx, "id", "name", "requiresCoupon" FROM "Promotion" WHERE "hotelId" = $1 AND "createdBy" = 'perf'`,
    hotelId,
  );
  const total = AUTO + COUPON_PROMOTIONS;
  const linked = await prisma.$executeRawUnsafe(
    `UPDATE "Reservation" r
        SET "promotionId" = pp."id",
            "promotionTerms" = jsonb_build_object('id', pp."id", 'name', pp."name", 'discountType', 'PERCENT', 'discountValue', '10.00', 'bookedOn', to_char(r."createdAt", 'YYYY-MM-DD')),
            "discountTotal" = round(r."totalPrice" * 0.1, 2)
       FROM perf_promotions pp
      WHERE r."hotelId" = $1 AND r."agencyId" IS NULL AND r."priceMode" = 'CALCULATED' AND r."promotionId" IS NULL
        AND abs(hashtext(r."id")) % 100 < 20 AND pp.idx = abs(hashtext(r."id" || 'p')) % ${total}`,
    hotelId,
  );
  // Kuponlu promosyona düşenlere kupon: promosyonun kuponlarından biri (tek kullanımlıklar tekrar etmesin diye satır sırasıyla).
  await prisma.$executeRawUnsafe(
    `WITH ranked AS (
       SELECT r."id", r."promotionId", row_number() OVER (PARTITION BY r."promotionId" ORDER BY r."id") AS k
         FROM "Reservation" r JOIN perf_promotions pp ON pp."id" = r."promotionId" AND pp."requiresCoupon"
        WHERE r."hotelId" = $1),
     coupons AS (
       SELECT c."id", c."promotionId", row_number() OVER (PARTITION BY c."promotionId" ORDER BY c."code") AS k FROM "Coupon" c WHERE c."hotelId" = $1)
     UPDATE "Reservation" r SET "couponId" = c."id"
       FROM ranked x JOIN coupons c ON c."promotionId" = x."promotionId" AND c.k = 1 + ((x.k - 1) % ${COUPONS_EACH})
      WHERE r."id" = x."id"`,
    hotelId,
  );
  await prisma.$executeRawUnsafe('DROP TABLE perf_promotions');
  for (const table of ['Promotion', 'Coupon', 'Reservation']) await prisma.$executeRawUnsafe(`ANALYZE "${table}"`);
  console.log(`Veri kuruldu: ${AUTO} + ${COUPON_PROMOTIONS} promosyon, ${COUPON_PROMOTIONS * COUPONS_EACH} kupon, ${linked} rezervasyon promosyona bağlandı (${((performance.now() - started) / 1000).toFixed(1)} sn).`);
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

const promoted = await prisma.reservation.count({ where: { hotelId, promotionId: { not: null } } });
const sample = await prisma.promotion.findFirst({ where: { hotelId, createdBy: 'perf', requiresCoupon: true }, orderBy: { name: 'asc' }, select: { id: true } });
const type = await prisma.roomType.findFirst({ where: { hotelId }, orderBy: { code: 'asc' }, select: { id: true } });
const multiUse = await prisma.coupon.findFirst({ where: { hotelId, promotionId: sample.id, maxUses: null }, select: { code: true } });

await measure('promosyon listesi (sayfa 1)', () => promotions.listPromotions(hotelId, { page: 1, pageSize: 20 }));
await measure('promosyon listesi (arama)', () => promotions.listPromotions(hotelId, { page: 1, pageSize: 20, search: 'Kupon 1' }));
await measure(`promosyon kartı (${COUPONS_EACH} kupon)`, () => promotions.getPromotion(hotelId, sample.id));
await measure('kupon listesi (sayfa 1)', () => promotions.listCoupons(hotelId, sample.id, { page: 1, pageSize: 50 }));
await measure('kupon listesi (kod araması)', () => promotions.listCoupons(hotelId, sample.id, { page: 1, pageSize: 50, search: '00123' }));
await measure('kupon listesi (kullanılmamış)', () => promotions.listCoupons(hotelId, sample.id, { page: 1, pageSize: 50, usage: 'UNUSED' }));
await measure(`kullanım raporu (${promoted} promosyonlu rezervasyon, 1 yıl satış)`, () =>
  promotions.getPromotionReport(hotelId, { from: new Date(day(-365)), to: new Date(day(0)), basis: 'BOOKED', page: 1, pageSize: 20 }),
);
await measure('kullanım raporu (giriş gününe göre, 1 yıl)', () =>
  promotions.getPromotionReport(hotelId, { from: new Date(day(-365)), to: new Date(day(0)), basis: 'STAY', page: 1, pageSize: 20 }),
);
await measure('promosyonun rezervasyonları (sayfa 1)', () =>
  promotions.listPromotionReservations(hotelId, sample.id, { from: new Date(day(-1500)), to: new Date(day(0)), basis: 'BOOKED', page: 1, pageSize: 20 }),
);

const quoteInput = (extra = {}) => ({ checkIn: new Date(day(40)), checkOut: new Date(day(44)), lines: [{ roomTypeId: type.id, quantity: 1, adults: 2, children: 0 }], excludeReservationId: null, ...extra });
await measure(`fiyat önizlemesi (${AUTO} yayında promosyon)`, () => reservations.quoteReservation(hotelId, quoteInput()));
await measure('fiyat önizlemesi (kuponla)', () => reservations.quoteReservation(hotelId, quoteInput({ couponCode: multiUse.code })));

const created = [];
let guestCounter = 0;
const create = (couponCode) =>
  as(async () => {
    guestCounter += 1;
    const result = await reservations.createReservation(hotelId, {
      guestId: null,
      guest: { firstName: 'Perf', lastName: `Promosyon${guestCounter}`, phone: `+9055510${String(Date.now() % 1_000_000).padStart(6, '0')}${guestCounter}`.slice(0, 15), email: null, nationality: 'TR' },
      forceNewGuest: true,
      roomTypeId: type.id,
      adults: 2,
      children: 0,
      boardType: 'BB',
      checkIn: new Date(day(320 + (guestCounter % 30) * 2)),
      checkOut: new Date(day(323 + (guestCounter % 30) * 2)),
      status: 'CONFIRMED',
      source: 'UI',
      notes: null,
      requestId: randomUUID(),
      waitlistId: null,
      roomId: null,
      manualTotal: null,
      priceNote: null,
      agencyId: null,
      couponCode,
    });
    created.push(result.reservation.id);
    return result;
  });
await measure('rezervasyon açma (kendiliğinden promosyon)', () => create(null), 8);
await measure('rezervasyon açma (çok kullanımlık kupon)', () => create(multiUse.code), 8);
await measure('8 eşzamanlı rezervasyon, aynı kupon (toplam)', () => Promise.all(Array.from({ length: 8 }, () => create(multiUse.code))), 4);

if (created.length) {
  await prisma.$executeRawUnsafe('DELETE FROM "ReservationNight" WHERE "reservationId" = ANY($1::text[])', created);
  await prisma.$executeRawUnsafe('DELETE FROM "Reservation" WHERE "id" = ANY($1::text[])', created);
}

const pad = (text, size) => String(text).padEnd(size);
console.log(`\n${pad('ölçüm', 56)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) {
  console.log(`${pad(row.name, 56)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
}
await prisma.$disconnect();
