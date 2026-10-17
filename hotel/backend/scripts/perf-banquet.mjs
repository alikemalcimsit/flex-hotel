import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Banket / etkinlik uçlarının ve zamanlanmış işinin büyük veride süresi (modül 37; ölçüm
 * aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-banquet.mjs
 *
 * Kurulum (yoksa; yeniden çalıştırmada tekrar kurmaz) yoğun bir kongre otelinin ~5,5 yılı:
 * - 12 bölünebilir salon × 3 parça + 20 toplantı odası (56 atomik salon), 200 ekipman,
 *   20.000 müşteri.
 * - Her gün × atomik salon × 3 dilim (sabah / öğleden sonra / akşam) için olasılıkla
 *   rezervasyon: ≈30.000 etkinlik, %20'si iki oturumlu; bütün salon rezervasyonu üç
 *   parçayı birden tutar. Geçmiş: gerçekleşti / iptal / kayıp; gelecek: kesin / opsiyon /
 *   talep / kayıp. Gelecek dolu dilimlere ayrıca 2.000 sırada bekleyen opsiyon.
 * - Etkinlik başına 6 kalem, kesin / gerçekleşmişe ödeme planı ve ödemeler; 500 opsiyonun
 *   son günü geçmiş (iş turu için).
 *
 * Ölçülen: liste (sıralı, durum, arama, derin sayfa, tarih aralığı), etkinlik ekranı,
 * takvim (7 / 31 gün), salon uygunluğu, özet paneli, gecikmiş taksit, ödeme listesi,
 * kasa özeti / hareketleri (folyo + etkinlik birleşimi), dosya → opsiyon → kesin yolu
 * (sıralı opsiyonlu salonda), iş turu; sonunda takvim ve liste sorgularının planı.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 5);
const PAST_DAYS = 1500;
const FUTURE_DAYS = 540;
const BOOKING_CHANCE = 0.09;
const WAITLIST = 2000;
const EXPIRED_OPTIONS = 500;
const CHUNK = 2000;
const ACTOR = 'perf';

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const events = await import('../src/modules/banquet/events.js');
const payments = await import('../src/modules/banquet/payments.js');
const jobs = await import('../src/modules/banquet/jobs.js');
const cash = await import('../src/modules/payments/service.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
const zone = hotel.timezone;
const today = core.toIsoDay(core.calendarDateInTimeZone(zone));
const day = (offset) => core.toIsoDay(core.addDays(new Date(`${today}T00:00:00.000Z`), offset));
const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'perf@test.local' }, fn);
const utc = (dayText, time) => contracts.zonedWallTimeToUtc(`${dayText}T${time}`, zone);

// Sabit tohumlu rastgele (mulberry32): her kurulum aynı veriyi üretir.
let seed = 37_2026;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

/** Dilimler: 30 dk hazırlıkla birbirine değmez (yarı açık aralık). */
const SLOTS = [
  ['08:00', '12:00'],
  ['13:00', '17:00'],
  ['19:00', '23:00'],
];
const BUFFER = 30;

async function insertChunks(model, rows) {
  for (let index = 0; index < rows.length; index += CHUNK) await prisma[model].createMany({ data: rows.slice(index, index + CHUNK) });
}

/* ══════════════════ Kurulum ══════════════════ */

const started = performance.now();
if ((await prisma.venue.count({ where: { hotelId, createdBy: ACTOR } })) === 0) {
  const venueRows = [];
  const atoms = [];
  const wholes = [];
  for (let index = 1; index <= 12; index += 1) {
    const id = randomUUID();
    venueRows.push({ id, hotelId, code: `PB${index}`, name: `Perf Balo ${index}`, dayRate: '90000', setupMinutes: BUFFER, teardownMinutes: BUFFER, createdBy: ACTOR });
    const parts = [];
    for (const letter of ['A', 'B', 'C']) {
      const partId = randomUUID();
      venueRows.push({ id: partId, hotelId, parentId: id, code: `PB${index}-${letter}`, name: `Perf Balo ${index}${letter}`, dayRate: '35000', setupMinutes: BUFFER, teardownMinutes: BUFFER, createdBy: ACTOR });
      parts.push(partId);
      atoms.push(partId);
    }
    wholes.push({ id, parts });
  }
  for (let index = 1; index <= 20; index += 1) {
    const id = randomUUID();
    venueRows.push({ id, hotelId, code: `PT${index}`, name: `Perf Toplantı ${index}`, hourlyRate: '2000', setupMinutes: BUFFER, teardownMinutes: BUFFER, createdBy: ACTOR });
    atoms.push(id);
  }
  // Önce bütünler (parça bütüne bağlı).
  await prisma.venue.createMany({ data: venueRows.filter((row) => !row.parentId) });
  await prisma.venue.createMany({ data: venueRows.filter((row) => row.parentId) });
  await prisma.venueCapacity.createMany({
    data: venueRows.flatMap((row) => [
      { venueId: row.id, layout: 'BANQUET', capacity: row.parentId ? 200 : row.code.startsWith('PT') ? 40 : 600 },
      { venueId: row.id, layout: 'THEATER', capacity: row.parentId ? 300 : row.code.startsWith('PT') ? 60 : 900 },
    ]),
  });
  const equipmentRows = Array.from({ length: 200 }, (_, index) => ({ id: randomUUID(), hotelId, code: `PE${index + 1}`, name: `Perf ekipman ${index + 1}`, unitPrice: '500', stockQuantity: 100, createdBy: ACTOR }));
  await prisma.eventEquipment.createMany({ data: equipmentRows });
  const clientRows = Array.from({ length: 20_000 }, (_, index) => ({
    id: randomUUID(),
    hotelId,
    type: index % 3 ? 'COMPANY' : 'PERSON',
    name: `Perf Müşteri ${index + 1}`,
    contactName: `Yetkili ${index + 1}`,
    phone: `+90532${String(1_000_000 + index).padStart(7, '0')}`,
    createdBy: ACTOR,
  }));
  await insertChunks('eventClient', clientRows);

  /* Rezervasyon planı: dilim × atomik salon tek sahipli (kesin tutmalar çakışmaz). */
  const taken = new Set();
  const key = (offset, slot, venueId) => `${offset}:${slot}:${venueId}`;
  const bookings = [];
  for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset += 1) {
    for (let slot = 0; slot < SLOTS.length; slot += 1) {
      for (const whole of wholes) {
        if (rand() < BOOKING_CHANCE / 3 && whole.parts.every((part) => !taken.has(key(offset, slot, part)))) {
          for (const part of whole.parts) taken.add(key(offset, slot, part));
          bookings.push({ offset, slot, venueId: whole.id, atoms: whole.parts, whole: true });
        }
      }
      for (const atom of atoms) {
        if (!taken.has(key(offset, slot, atom)) && rand() < BOOKING_CHANCE) {
          taken.add(key(offset, slot, atom));
          bookings.push({ offset, slot, venueId: atom, atoms: [atom], whole: false });
        }
      }
    }
  }

  const eventRows = [];
  const sessionRows = [];
  const holdRows = [];
  const itemRows = [];
  const installmentRows = [];
  const paymentRows = [];
  const now = new Date();
  let number = 0;
  const statusFor = (offset) => {
    const roll = rand();
    if (offset < 0) return roll < 0.85 ? 'COMPLETED' : roll < 0.93 ? 'CANCELLED' : 'LOST';
    return roll < 0.5 ? 'DEFINITE' : roll < 0.75 ? 'TENTATIVE' : roll < 0.95 ? 'INQUIRY' : 'LOST';
  };
  const addEvent = (booking, status, extra = {}) => {
    number += 1;
    const id = randomUUID();
    const pax = booking.whole ? 450 : 120;
    const sessions = [booking];
    // %20'si aynı salonda sonraki dilimde ikinci oturum (aynı etkinlik: hazırlık süreleri üst üste binebilir).
    if (!extra.waitlist && booking.slot < 2 && rand() < 0.2 && booking.atoms.every((atom) => !taken.has(key(booking.offset, booking.slot + 1, atom)))) {
      for (const atom of booking.atoms) taken.add(key(booking.offset, booking.slot + 1, atom));
      sessions.push({ ...booking, slot: booking.slot + 1 });
    }
    const holding = ['TENTATIVE', 'DEFINITE', 'COMPLETED'].includes(status);
    const spans = sessions.map((entry) => ({ entry, startAt: utc(day(entry.offset), SLOTS[entry.slot][0]), endAt: utc(day(entry.offset), SLOTS[entry.slot][1]) }));
    const heldAt = new Date(now.getTime() - Math.floor(rand() * 86_400_000 * 30) - (extra.waitlist ? 0 : 86_400_000 * 31));
    const sessionIds = [];
    for (const span of spans) {
      const sessionId = randomUUID();
      sessionIds.push(sessionId);
      sessionRows.push({ id: sessionId, hotelId, eventId: id, title: 'Oturum', venueId: span.entry.venueId, layout: 'BANQUET', pax, startAt: span.startAt, endAt: span.endAt, setupMinutes: BUFFER, teardownMinutes: BUFFER });
      if (holding) {
        for (const atom of span.entry.atoms) {
          holdRows.push({
            hotelId,
            eventId: id,
            sessionId,
            venueId: atom,
            startAt: new Date(span.startAt.getTime() - BUFFER * 60_000),
            endAt: new Date(span.endAt.getTime() + BUFFER * 60_000),
            status: status === 'TENTATIVE' ? 'TENTATIVE' : 'DEFINITE',
            heldAt,
          });
        }
      }
    }
    // Kalemler: kişi başı menü (KDV %10 dahil), içecek, kira, iki hizmet, ekipman (KDV %20 dahil).
    const lines = [
      { category: 'FNB', perPerson: true, quantity: 1, unit: 'PERSON', unitPrice: 1500, taxCategory: 'FNB', rate: 10, billed: pax },
      { category: 'BEVERAGE', perPerson: true, quantity: 1, unit: 'PERSON', unitPrice: 400, taxCategory: 'FNB', rate: 10, billed: pax },
      { category: 'VENUE', perPerson: false, quantity: 1, unit: 'DAY', unitPrice: booking.whole ? 90000 : 35000, taxCategory: 'OTHER', rate: 20, billed: 1 },
      { category: 'SERVICE', perPerson: false, quantity: 1, unit: 'PACKAGE', unitPrice: 15000, taxCategory: 'OTHER', rate: 20, billed: 1 },
      { category: 'SERVICE', perPerson: false, quantity: 1, unit: 'PACKAGE', unitPrice: 8000, taxCategory: 'OTHER', rate: 20, billed: 1 },
      { category: 'EQUIPMENT', perPerson: false, quantity: 2, unit: 'PIECE', unitPrice: 500, taxCategory: 'OTHER', rate: 20, billed: 2, equipment: true },
    ];
    let net = 0;
    let tax = 0;
    lines.forEach((line, index) => {
      const total = Math.round(line.unitPrice * line.billed * 100);
      const lineNet = Math.round(total / (1 + line.rate / 100));
      net += lineNet;
      tax += total - lineNet;
      itemRows.push({
        hotelId,
        eventId: id,
        sessionId: line.equipment ? sessionIds[0] : null,
        equipmentId: line.equipment ? equipment[Math.floor(rand() * equipment.length)].id : null,
        category: line.category,
        description: `${line.category} kalemi`,
        perPerson: line.perPerson,
        quantity: String(line.quantity),
        billedQuantity: String(line.billed),
        unit: line.unit,
        unitPrice: String(line.unitPrice),
        discountPct: '0',
        taxCategory: line.taxCategory,
        netAmount: (lineNet / 100).toFixed(2),
        taxAmount: ((total - lineNet) / 100).toFixed(2),
        total: (total / 100).toFixed(2),
        taxLines: [{ name: 'KDV', rate: String(line.rate), included: true, amount: ((total - lineNet) / 100).toFixed(2) }],
        sortOrder: index,
      });
    });
    const grand = (net + tax) / 100;
    const firstDay = day(booking.offset);
    const data = {
      id,
      hotelId,
      code: `ETK-PERF-${String(number).padStart(6, '0')}`,
      name: `Perf etkinlik ${number}`,
      type: pick(['WEDDING', 'MEETING', 'CONFERENCE', 'GALA']),
      clientId: clients[Math.floor(rand() * clients.length)].id,
      ownerEmail: pick(['satis1@perf.local', 'satis2@perf.local', 'satis3@perf.local']),
      status,
      expectedPax: pax,
      guaranteedPax: pax,
      billablePax: pax,
      firstStartAt: spans[0].startAt,
      lastEndAt: spans.at(-1).endAt,
      currency: hotel.currency,
      netTotal: (net / 100).toFixed(2),
      taxTotal: (tax / 100).toFixed(2),
      grandTotal: grand.toFixed(2),
      createdBy: ACTOR,
      createdAt: new Date(spans[0].startAt.getTime() - 86_400_000 * 60),
      ...(status === 'TENTATIVE' ? { optionUntil: new Date(`${extra.optionUntil ?? day(Math.min(booking.offset, 7))}T00:00:00.000Z`), optionedAt: heldAt } : {}),
      ...(['DEFINITE', 'COMPLETED', 'CANCELLED'].includes(status) ? { definiteAt: heldAt, definiteBy: ACTOR, cancellationTiers: [{ daysBefore: 30, feePct: '50' }, { daysBefore: 0, feePct: '100' }] } : {}),
      ...(status === 'COMPLETED' ? { completedAt: spans.at(-1).endAt, completedBy: ACTOR, actualPax: pax } : {}),
      ...(status === 'CANCELLED' ? { cancelledAt: heldAt, cancelledBy: ACTOR, cancelReason: 'Perf iptali', cancellationFee: (grand / 2).toFixed(2) } : {}),
      ...(status === 'LOST' ? { lostAt: heldAt, lostBy: ACTOR, lostReason: 'Perf kaybı' } : {}),
    };
    let paid = 0;
    if (['DEFINITE', 'COMPLETED', 'CANCELLED'].includes(status)) {
      const deposit = Math.round(grand * 0.3 * 100) / 100;
      installmentRows.push({ hotelId, eventId: id, label: 'Depozito', dueDate: new Date(`${day(booking.offset - 60)}T00:00:00.000Z`), amount: deposit.toFixed(2), sortOrder: 0 });
      installmentRows.push({ hotelId, eventId: id, label: 'Kalan', dueDate: new Date(`${day(booking.offset - 7)}T00:00:00.000Z`), amount: (grand - deposit).toFixed(2), sortOrder: 1 });
      const amounts = status === 'COMPLETED' ? [deposit, grand - deposit] : [deposit];
      // Gelecek kesin etkinliklerin bir kısmında depozito ödenmemiş (gecikmiş taksit).
      if (!(status === 'DEFINITE' && rand() < 0.1)) {
        amounts.forEach((amount, index) => {
          const paidDay = day(Math.min(booking.offset - (index ? 7 : 60), 0));
          const at = new Date(`${paidDay}T09:00:00.000Z`);
          paymentRows.push({
            hotelId,
            eventId: id,
            kind: 'PAYMENT',
            status: 'POSTED',
            method: pick(['CARD', 'TRANSFER', 'CASH']),
            amount: amount.toFixed(2),
            currency: hotel.currency,
            businessDate: new Date(`${paidDay}T00:00:00.000Z`),
            reference: `PERF-${number}-${index}`,
            sourceKey: `perf:${id}:${index}`,
            receivedBy: pick(['onburo1@perf.local', 'onburo2@perf.local']),
            receivedAt: at,
            postedAt: at,
          });
          paid += amount;
        });
      }
    }
    eventRows.push({ ...data, paidTotal: paid.toFixed(2) });
  };

  const equipment = equipmentRows;
  const clients = clientRows;
  for (const booking of bookings) addEvent(booking, statusFor(booking.offset));
  // Gelecek dolu dilimlere sırada bekleyen opsiyonlar (sıra hesabı yükü).
  const futureHeld = bookings.filter((booking) => booking.offset > 0);
  for (let index = 0; index < WAITLIST && futureHeld.length; index += 1) addEvent(pick(futureHeld), 'TENTATIVE', { waitlist: true });
  // Son günü geçmiş opsiyonlar (iş turu bunları düşürür): yalnızca boş dilimlere (kesin tutmalarla çakışmasın diye sırada da olabilir).
  for (let index = 0; index < EXPIRED_OPTIONS && futureHeld.length; index += 1) addEvent(pick(futureHeld), 'TENTATIVE', { waitlist: true, optionUntil: day(-1 - (index % 5)) });

  await insertChunks('event', eventRows);
  await insertChunks('eventSession', sessionRows);
  await insertChunks('eventVenueHold', holdRows);
  await insertChunks('eventItem', itemRows);
  await insertChunks('eventInstallment', installmentRows);
  await insertChunks('eventPayment', paymentRows);
  await prisma.$executeRaw`INSERT INTO "EventSequence" ("hotelId", "kind", "year", "last") VALUES (${hotelId}, 'EVENT', ${Number(today.slice(0, 4))}, 1)
    ON CONFLICT ("hotelId", "kind", "year") DO NOTHING`;
  for (const table of ['Event', 'EventSession', 'EventVenueHold', 'EventItem', 'EventInstallment', 'EventPayment', 'EventClient']) await prisma.$executeRawUnsafe(`ANALYZE "${table}"`);
  console.log(
    `Veri kuruldu: ${eventRows.length} etkinlik, ${sessionRows.length} oturum, ${holdRows.length} tutma, ${itemRows.length} kalem, ` +
      `${paymentRows.length} ödeme, ${clientRows.length} müşteri (${((performance.now() - started) / 1000).toFixed(1)} sn).`,
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
const list = (query) => events.listEvents(hotelId, contracts.eventListQuerySchema.parse(query));
const counts = await prisma.event.groupBy({ by: ['status'], where: { hotelId }, _count: { _all: true } });
const busiest = (
  await prisma.$queryRaw`SELECT "eventId", COUNT(*)::int AS n FROM "EventItem" WHERE "hotelId" = ${hotelId} GROUP BY 1 ORDER BY 2 DESC LIMIT 1`
)[0];
const ranked = await prisma.event.findFirst({ where: { hotelId, status: 'TENTATIVE', firstStartAt: { gt: new Date() } }, orderBy: { firstStartAt: 'asc' }, select: { id: true } });
const bigVenue = await prisma.venue.findFirst({ where: { hotelId, code: 'PB1' }, select: { id: true } });

await measure('liste (ilk oturum sırası, sayfa 1)', () => list({}));
await measure('liste (kesin, sayfa 1)', () => list({ status: 'DEFINITE' }));
await measure('liste (opsiyonlu + sıra hesabı)', () => list({ status: 'TENTATIVE', pageSize: 100 }));
await measure('liste (müşteri araması)', () => list({ search: 'Müşteri 1234' }));
await measure('liste (derin sayfa 500)', () => list({ page: 500 }));
await measure('liste (önümüzdeki 30 gün)', () => list({ from: day(0), to: day(30) }));
await measure('etkinlik ekranı', () => events.getEvent(hotelId, busiest.eventId));
await measure('etkinlik ekranı (opsiyonlu, sıralı)', () => events.getEvent(hotelId, ranked.id));
await measure('takvim (7 gün)', () => events.getCalendar(hotelId, contracts.banquetCalendarQuerySchema.parse({ from: day(10), to: day(16) })));
await measure('takvim (31 gün)', () => events.getCalendar(hotelId, contracts.banquetCalendarQuerySchema.parse({ from: day(10), to: day(40) })));
await measure('salon uygunluğu (bütün salon)', () =>
  events.venueAvailability(hotelId, contracts.venueAvailabilityQuerySchema.parse({ venueId: bigVenue.id, startAt: `${day(20)}T19:00`, endAt: `${day(20)}T23:00` })),
);
await measure('özet paneli', () => events.getBanquetSummary(hotelId));
await measure('gecikmiş taksitler (500)', () => events.overdueInstallments(prisma, hotelId, today, 500));
await measure('ödeme listesi', () => payments.listEventPayments(hotelId, busiest.eventId, { limit: 50 }));
await measure('kasa özeti (bugün, folyo + etkinlik)', () => as(() => cash.getCashSummary(hotelId, { mine: false })));
await measure('kasa hareketleri (bugün, 50)', () => as(() => cash.listCashMovements(hotelId, { mine: false, limit: 50 })));

// Yazma yolu: boş bir gelecek dilimde dosya → oturum → kalem → opsiyon → kesin (opsiyonlu salonlar arasında).
const freeRoom = await prisma.venue.findFirst({ where: { hotelId, code: 'PT20' }, select: { id: true } });
const anyClient = await prisma.eventClient.findFirst({ where: { hotelId, createdBy: ACTOR }, select: { id: true } });
let flowDay = FUTURE_DAYS + 30;
await measure(
  'dosya → oturum → kalem → opsiyon → kesin',
  () =>
    as(async () => {
      flowDay += 1;
      let event = await events.createEvent(hotelId, contracts.createEventSchema.parse({ name: 'Perf akış', type: 'MEETING', clientId: anyClient.id, expectedPax: 30 }));
      event = await events.saveSession(
        hotelId,
        event.id,
        null,
        contracts.createSessionSchema.parse({ expectedUpdatedAt: event.updatedAt, title: 'Toplantı', venueId: freeRoom.id, layout: 'THEATER', pax: 30, startAt: `${day(flowDay)}T09:00`, endAt: `${day(flowDay)}T12:00` }),
      );
      event = await events.saveItems(
        hotelId,
        event.id,
        contracts.saveEventItemsSchema.parse({ expectedUpdatedAt: event.updatedAt, items: [{ category: 'FNB', description: 'Paket', perPerson: true, quantity: '1', unit: 'PERSON', unitPrice: '900', taxCategory: 'FNB' }] }),
      );
      event = await events.setTentative(hotelId, event.id, contracts.tentativeEventSchema.parse({ expectedUpdatedAt: event.updatedAt, optionUntil: day(5) }));
      await prisma.eventSettings.upsert({ where: { hotelId }, create: { hotelId, requireSignedContract: false }, update: { requireSignedContract: false } });
      return events.confirmEvent(hotelId, event.id, { expectedUpdatedAt: new Date(event.updatedAt) });
    }),
  3,
);
const sweep = await measure('iş turu (opsiyon dolumu + hatırlatmalar)', () => as(() => jobs.sweepHotel(hotelId, { info() {}, warn() {} })), 2);

/* ══════════════════ Plan ══════════════════ */

const plans = {};
const capture = async (name, sql) => {
  const explained = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  plans[name] = explained.map((row) => row['QUERY PLAN']).filter((text) => /Index|Execution Time|Seq Scan|Bitmap/.test(text));
};
await capture(
  'takvim tutmaları (31 gün)',
  Prisma.sql`SELECT * FROM "EventVenueHold" WHERE "hotelId" = ${hotelId} AND "startAt" < ${utc(day(41), '00:00')} AND "endAt" > ${utc(day(10), '00:00')} ORDER BY "startAt", "id" LIMIT 5000`,
);
await capture('liste (ilk oturum sırası)', Prisma.sql`SELECT "id" FROM "Event" WHERE "hotelId" = ${hotelId} ORDER BY "firstStartAt" ASC NULLS LAST, "id" LIMIT 25 OFFSET 12475`);

const pad = (text, width) => String(text).padEnd(width);
console.log(`\nDurumlar: ${counts.map((row) => `${row.status} ${row._count._all}`).join(' · ')} · iş turu: ${JSON.stringify(sweep)}`);
console.log(`\n${pad('ölçüm', 52)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) console.log(`${pad(row.name, 52)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
for (const [name, lines] of Object.entries(plans)) {
  console.log(`\nPlan — ${name}:`);
  for (const line of lines) console.log(`  ${line.trim()}`);
}
await prisma.$disconnect();
