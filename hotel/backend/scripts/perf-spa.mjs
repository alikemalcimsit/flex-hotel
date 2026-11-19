import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Spa ve spor salonu uçlarının büyük veride süresi (modül 57; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-spa.mjs
 *
 * Kurulum (yoksa; tamsa tekrar kurmaz) 2500 kişilik bir resort otelin büyük spa'sının ~2 yıllık hareketi:
 * - 50 bakım odası + 4 stüdyo, 50 terapist + 6 eğitmen (haftanın her günü 08:00–22:00), 110 birebir hizmet (her
 *   biri bütün terapist ve odalara bağlı: boş saat hesabının en kötü hâli) + 10 grup dersi.
 * - 730 gün geçmiş + 60 gün ileri: terapist başına günde 8 dilimin ~%70'i dolu (günde ≈280 randevu, ≈220.000),
 *   %88 tamamlanan, %6 iptal, %3 gelmedi; tamamlananların yarısı kasada (ödeme satırı), kalanı odaya. Günde 8 grup
 *   dersi, derste ≈8 kayıt (≈50.000). Toplam ≈270.000 randevu, ≈500.000 tutma.
 *
 * Ölçülen: tanımlar, boş saat (bugün / yoğun ileri gün, cinsiyet tercihi), günün takvimi, randevu listesi (ilk
 * sayfa, 30 gün, ad araması, açık bakiye, durum, derin sayfa), randevu ekranı, ders listesi ve ekranı, rapor
 * (31 / 365 gün), kasa özeti ve spa hareketleri, hatırlatma turu; yazma yolu: otomatik yerleştirmeyle aç →
 * tamamla → kasada öde; sonunda liste / takvim / rapor sorgularının planı.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 5);
const PAST_DAYS = 730;
const FUTURE_DAYS = 60;
const THERAPISTS = 50;
const INSTRUCTORS = 6;
const ROOMS = 50;
const STUDIOS = 4;
const PRIVATE_SERVICES = 110;
const GROUP_SERVICES = 10;
const SLOTS = 8;
const FILL = 0.7;
const CHUNK = 5000;
const ACTOR = 'perf';
const MANAGER = 'perf-mudur@test.local';

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { Prisma } = await import('@prisma/client');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const setup = await import('../src/modules/spa/setup.js');
const schedule = await import('../src/modules/spa/schedule.js');
const appointments = await import('../src/modules/spa/appointments.js');
const sessions = await import('../src/modules/spa/sessions.js');
const payments = await import('../src/modules/spa/payments.js');
const report = await import('../src/modules/spa/report.js');
const jobs = await import('../src/modules/spa/jobs.js');
const cash = await import('../src/modules/payments/service.js');

const hotelId = await resolveHotelId();
const hotel = await prisma.hotel.findFirst({ where: { id: hotelId } });
const zone = hotel.timezone;
const today = core.toIsoDay(core.calendarDateInTimeZone(zone));
const day = (offset) => core.toIsoDay(core.addDays(new Date(`${today}T00:00:00.000Z`), offset));
const wall = (localDay, minute) => contracts.zonedWallTimeToUtc(`${localDay}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`, zone);
const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
const quiet = { error: () => {}, warn: () => {}, info: () => {} };

let seed = 57_2026;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const FIRST = ['Ayşe', 'Mehmet', 'Elif', 'Can', 'Zeynep', 'Burak', 'Selin', 'Emre', 'Deniz', 'Hakan', 'Anna', 'John', 'Olga', 'Hans', 'Maria'];
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Aydın', 'Öztürk', 'Arslan', 'Müller', 'Smith', 'Ivanova', 'Schmidt', 'Rossi'];

async function insertChunks(model, rows) {
  for (let index = 0; index < rows.length; index += CHUNK) await prisma[model].createMany({ data: rows.slice(index, index + CHUNK) });
}

/* ══════════════════ Kurulum ══════════════════ */

const started = performance.now();
if ((await prisma.spaTherapist.count({ where: { hotelId, createdBy: ACTOR } })) === 0) {
  // Önceki yarım kurulum: perf verisinin hepsi silinip baştan.
  for (const table of ['SpaPayment', 'SpaRoomCharge', 'SpaHold', 'SpaAppointment', 'SpaSession', 'SpaBlock', 'SpaServiceTherapist', 'SpaServiceRoom', 'SpaTherapistHour', 'SpaService', 'SpaTherapist', 'SpaRoom', 'SpaSequence', 'SpaSettings']) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "hotelId" = $1`, hotelId);
  }
  await prisma.spaSettings.create({ data: { hotelId, openMinute: 480, closeMinute: 1320, slotMinutes: 15, portalEnabled: true, updatedBy: ACTOR } });
  const rooms = Array.from({ length: ROOMS }, (_, index) => ({ id: randomUUID(), hotelId, name: `Perf oda ${index + 1}`, kind: 'TREATMENT', sortOrder: index, createdBy: ACTOR }));
  const studios = Array.from({ length: STUDIOS }, (_, index) => ({ id: randomUUID(), hotelId, name: `Perf stüdyo ${index + 1}`, kind: 'STUDIO', sortOrder: ROOMS + index, createdBy: ACTOR }));
  await prisma.spaRoom.createMany({ data: [...rooms, ...studios] });
  const therapists = Array.from({ length: THERAPISTS }, (_, index) => ({ id: randomUUID(), hotelId, name: `Perf terapist ${index + 1}`, gender: index % 2 ? 'MALE' : 'FEMALE', sortOrder: index, createdBy: ACTOR }));
  const instructors = Array.from({ length: INSTRUCTORS }, (_, index) => ({ id: randomUUID(), hotelId, name: `Perf eğitmen ${index + 1}`, gender: 'FEMALE', sortOrder: THERAPISTS + index, createdBy: ACTOR }));
  await prisma.spaTherapist.createMany({ data: [...therapists, ...instructors] });
  await prisma.spaTherapistHour.createMany({
    data: [...therapists, ...instructors].flatMap((row) => [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hotelId, therapistId: row.id, weekday, startMinute: 480, endMinute: 1320 }))),
  });
  const privateRows = Array.from({ length: PRIVATE_SERVICES }, (_, index) => ({
    id: randomUUID(), hotelId, name: `Perf hizmet ${index + 1}`, category: 'MASSAGE', kind: 'PRIVATE', durationMinutes: 60, bufferMinutes: 15, price: '3000', sortOrder: index, createdBy: ACTOR,
  }));
  const groupRows = Array.from({ length: GROUP_SERVICES }, (_, index) => ({
    id: randomUUID(), hotelId, name: `Perf ders ${index + 1}`, category: 'WELLNESS', kind: 'GROUP', durationMinutes: 60, bufferMinutes: 0, price: '450', capacity: 12, sortOrder: PRIVATE_SERVICES + index, createdBy: ACTOR,
  }));
  await prisma.spaService.createMany({ data: [...privateRows, ...groupRows] });
  await insertChunks('spaServiceTherapist', [
    ...privateRows.flatMap((service) => therapists.map((row) => ({ hotelId, serviceId: service.id, therapistId: row.id }))),
    ...groupRows.flatMap((service) => instructors.map((row) => ({ hotelId, serviceId: service.id, therapistId: row.id }))),
  ]);
  await insertChunks('spaServiceRoom', [
    ...privateRows.flatMap((service) => rooms.map((row) => ({ hotelId, serviceId: service.id, roomId: row.id }))),
    ...groupRows.flatMap((service) => studios.map((row) => ({ hotelId, serviceId: service.id, roomId: row.id }))),
  ]);

  const stays = await prisma.reservation.findMany({ where: { hotelId, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] }, roomId: { not: null } }, take: 5000, select: { id: true, guestId: true, room: { select: { number: true } } } });
  const sequence = new Map();
  const codeOf = (localDay) => {
    const year = Number(localDay.slice(0, 4));
    const next = (sequence.get(year) ?? 0) + 1;
    sequence.set(year, next);
    return `SPA-${year}-${String(next).padStart(5, '0')}`;
  };
  const nowMs = Date.now();
  let apptRows = [];
  let holdRows = [];
  let paymentRows = [];
  const flush = async () => {
    await insertChunks('spaAppointment', apptRows);
    await insertChunks('spaHold', holdRows);
    await insertChunks('spaPayment', paymentRows);
    apptRows = [];
    holdRows = [];
    paymentRows = [];
  };
  const customer = () => {
    const stay = stays.length && rand() < 0.5 ? pick(stays) : null;
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    return stay ? { reservationId: stay.id, guestId: stay.guestId, customerName: name, roomNumber: stay.room.number } : { reservationId: null, guestId: null, customerName: name, customerPhone: '+905320000000' };
  };
  /** Kapanış: geçmişte çoğu tamamlandı; gelecekte açık. */
  const closing = (startsAt, endsAt, inHouse, price) => {
    if (startsAt.getTime() > nowMs) return { status: 'BOOKED' };
    const roll = rand();
    if (roll < 0.06) return { status: 'CANCELLED', cancelledAt: new Date(startsAt.getTime() - 86_400_000), cancelledBy: ACTOR, cancelReason: 'Perf iptal', feePct: '0' };
    if (roll < 0.09) return { status: 'NO_SHOW', cancelledAt: new Date(startsAt.getTime() + 1_800_000), cancelledBy: ACTOR, cancelReason: 'Perf gelmedi', feePct: '100', amountDue: price, totalDue: price, ...(inHouse ? { roomChargeTotal: price } : { balance: price }) };
    const desk = !inHouse || rand() < 0.5;
    return { status: 'COMPLETED', completedAt: endsAt, completedBy: ACTOR, amountDue: price, totalDue: price, ...(desk ? { paidTotal: price } : { roomChargeTotal: price }), desk };
  };
  for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset += 1) {
    const localDay = day(offset);
    // Birebir: terapist gün boyu tek odada (oda sırası her gün kayar), 90 dakikalık dilimler.
    for (let index = 0; index < THERAPISTS; index += 1) {
      const roomId = rooms[(index + offset + PAST_DAYS) % ROOMS].id;
      for (let slot = 0; slot < SLOTS; slot += 1) {
        if (rand() > FILL) continue;
        const service = privateRows[Math.floor(rand() * PRIVATE_SERVICES)];
        const startsAt = wall(localDay, 540 + slot * 90);
        const endsAt = new Date(startsAt.getTime() + 3_600_000);
        const busyUntil = new Date(endsAt.getTime() + 900_000);
        const who = customer();
        const close = closing(startsAt, endsAt, Boolean(who.reservationId), '3000.00');
        const { desk, ...state } = close;
        const id = randomUUID();
        apptRows.push({ id, hotelId, code: codeOf(localDay), serviceId: service.id, serviceName: service.name, category: 'MASSAGE', kind: 'PRIVATE', startsAt, endsAt, busyUntil, ...who, listPrice: '3000', price: '3000', createdBy: ACTOR, createdAt: new Date(startsAt.getTime() - 86_400_000), ...state });
        const active = !['CANCELLED', 'NO_SHOW'].includes(close.status);
        holdRows.push({ hotelId, therapistId: therapists[index].id, appointmentId: id, startsAt, endsAt: busyUntil, active }, { hotelId, roomId, appointmentId: id, startsAt, endsAt: busyUntil, active });
        if (desk) paymentRows.push({ hotelId, appointmentId: id, kind: 'PAYMENT', status: 'POSTED', method: rand() < 0.7 ? 'CARD' : 'CASH', amount: '3000', currency: hotel.currency, businessDate: new Date(`${localDay}T00:00:00.000Z`), receivedBy: ACTOR, receivedAt: endsAt, postedAt: endsAt, sourceKey: `perf:${id}` });
      }
    }
    // Grup: dört stüdyoda sabah ve akşam, derste ≈8 kayıt.
    for (const minute of [480, 1080]) {
      for (let studio = 0; studio < STUDIOS; studio += 1) {
        const service = groupRows[(studio + offset + PAST_DAYS) % GROUP_SERVICES];
        const startsAt = wall(localDay, minute);
        const endsAt = new Date(startsAt.getTime() + 3_600_000);
        const sessionId = randomUUID();
        const past = endsAt.getTime() < nowMs;
        const enrolled = 4 + Math.floor(rand() * 9);
        await prisma.spaSession.create({ data: { id: sessionId, hotelId, serviceId: service.id, serviceName: service.name, startsAt, endsAt, capacity: 12, price: '450', status: past ? 'COMPLETED' : 'SCHEDULED', completedAt: past ? endsAt : null, bookedCount: past ? 0 : enrolled, createdBy: ACTOR } });
        holdRows.push({ hotelId, therapistId: instructors[studio].id, sessionId, startsAt, endsAt }, { hotelId, roomId: studios[studio].id, sessionId, startsAt, endsAt });
        for (let seat = 0; seat < enrolled; seat += 1) {
          const who = customer();
          const close = past ? { status: 'COMPLETED', completedAt: endsAt, completedBy: ACTOR, amountDue: '450.00', totalDue: '450.00', ...(who.reservationId ? { roomChargeTotal: '450.00' } : { paidTotal: '450.00' }) } : { status: 'BOOKED' };
          apptRows.push({ id: randomUUID(), hotelId, code: codeOf(localDay), serviceId: service.id, sessionId, serviceName: service.name, category: 'WELLNESS', kind: 'GROUP', startsAt, endsAt, busyUntil: endsAt, ...who, listPrice: '450', price: '450', createdBy: ACTOR, createdAt: new Date(startsAt.getTime() - 3_600_000 * (seat + 1)), ...close });
        }
      }
    }
    if (apptRows.length >= 20_000) await flush();
  }
  await flush();
  await prisma.spaSequence.createMany({ data: [...sequence].map(([year, last]) => ({ hotelId, year, last })) });
  await prisma.$executeRawUnsafe('ANALYZE "SpaAppointment"');
  await prisma.$executeRawUnsafe('ANALYZE "SpaHold"');
  await prisma.$executeRawUnsafe('ANALYZE "SpaPayment"');
  await prisma.$executeRawUnsafe('ANALYZE "SpaSession"');
}
const setupSeconds = ((performance.now() - started) / 1000).toFixed(0);

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

const counts = await prisma.spaAppointment.groupBy({ by: ['status'], where: { hotelId }, _count: { _all: true } });
const holds = await prisma.spaHold.count({ where: { hotelId } });
const service = await prisma.spaService.findFirst({ where: { hotelId, createdBy: ACTOR, kind: 'PRIVATE' }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
const group = await prisma.spaService.findFirst({ where: { hotelId, createdBy: ACTOR, kind: 'GROUP' }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
const sample = await prisma.spaAppointment.findFirst({ where: { hotelId, sessionId: null, status: 'COMPLETED' }, orderBy: { startsAt: 'desc' }, select: { id: true, customerName: true } });
const busySession = await prisma.spaSession.findFirst({ where: { hotelId, status: 'SCHEDULED' }, orderBy: [{ bookedCount: 'desc' }, { startsAt: 'asc' }], select: { id: true } });
const list = (query) => appointments.listSpaAppointments(hotelId, contracts.spaAppointmentListQuerySchema.parse({ from: day(-30), to: day(0), ...query }));

await measure('tanımlar (110 hizmet, 56 kişi, 54 oda)', () => setup.getSpaSetup(hotelId));
await measure('boş saat (bugün, 50 terapist × 50 oda)', () => schedule.spaAvailability(hotelId, contracts.spaAvailabilityQuerySchema.parse({ serviceId: service.id, day: today })));
await measure('boş saat (yarın, kadın terapist)', () => schedule.spaAvailability(hotelId, contracts.spaAvailabilityQuerySchema.parse({ serviceId: service.id, day: day(1), gender: 'FEMALE' })));
await measure('boş saat (portal, 7 gün sonra)', () => schedule.spaAvailability(hotelId, contracts.spaAvailabilityQuerySchema.parse({ serviceId: service.id, day: day(7) }), { leadMinutes: 120, portal: true }));
await measure('günün takvimi (bugün, ≈310 kayıt)', () => schedule.getSpaCalendar(hotelId, { day: today }));
await measure('randevu listesi (30 gün, ilk sayfa)', () => list({}));
await measure('randevu listesi (bugün)', () => list({ from: today, to: today }));
await measure('randevu listesi (ad araması)', () => list({ search: sample.customerName.split(' ')[1] }));
await measure('randevu listesi (kod araması)', () => list({ search: 'SPA-' }));
await measure('randevu listesi (açık bakiye, 366 gün)', () => list({ from: day(-365), to: day(0), view: 'OPEN_BALANCE' }));
await measure('randevu listesi (gelmedi, 366 gün)', () => list({ from: day(-365), to: day(0), status: 'NO_SHOW' }));
await measure('randevu listesi (derin sayfa 150)', () => list({ page: 150 }));
await measure('randevu ekranı', () => appointments.getSpaAppointment(hotelId, sample.id));
await measure('ders listesi (30 gün)', () => sessions.listSpaSessions(hotelId, contracts.spaSessionListQuerySchema.parse({ from: day(0), to: day(30) })));
await measure('ders ekranı (en kalabalık)', () => sessions.getSpaSession(hotelId, busySession.id));
await measure('rapor (31 gün)', () => report.spaReport(hotelId, { from: day(-30), to: day(0) }));
await measure('rapor (365 gün)', () => report.spaReport(hotelId, { from: day(-364), to: day(0) }), 3);
await measure('kasa özeti (bugün, dört kaynak)', () => as(MANAGER, () => cash.getCashSummary(hotelId, { mine: false })));
await measure('kasa hareketleri (spa, 50)', () => as(MANAGER, () => cash.listCashMovements(hotelId, { mine: false, limit: 50, origin: 'SPA' })));
await measure('hatırlatma turu', () => jobs.sendDueSpaReminders(hotelId, { logger: quiet }), 2);

// Yazma yolu: 20 gün sonrası (en yoğun ileri gün kadar dolu): ekranın yaptığı gibi boş saat → otomatik yerleştirmeyle
// aç → ön ödeme. Her turda ilk boş saat (önceki çalıştırmaların randevuları da günü doldurur).
const flowDay = day(20);
await measure(
  'boş saat → aç (otomatik yerleştirme) → ön ödeme',
  () =>
    as(MANAGER, async () => {
      const free = await schedule.spaAvailability(hotelId, contracts.spaAvailabilityQuerySchema.parse({ serviceId: service.id, day: flowDay }));
      const time = free.slots.find((slot) => slot.available)?.time;
      if (!time) throw new Error(`${flowDay} günü dolu; ölçüm için başka gün seçin`);
      const created = await appointments.createSpaAppointment(hotelId, contracts.spaAppointmentCreateSchema.parse({ requestId: randomUUID(), serviceId: service.id, startsAt: `${flowDay}T${time}`, customerName: 'Perf Misafir', customerPhone: '+905320000000' }), { logger: quiet });
      return payments.receiveSpaPayment(hotelId, created.appointment.id, contracts.spaPaymentSchema.parse({ requestId: randomUUID(), kind: 'PAYMENT', method: 'CARD', amount: created.appointment.priceTotal, reference: 'PERF' }));
    }),
  5,
);
const enrollSession = await prisma.spaSession.findFirst({ where: { hotelId, status: 'SCHEDULED', serviceId: group.id, startsAt: { gt: wall(day(14), 0) } }, orderBy: { startsAt: 'asc' }, select: { id: true } });
await measure('derse kayıt', () => as(MANAGER, () => sessions.enrollSpaSession(hotelId, enrollSession.id, contracts.spaEnrollSchema.parse({ requestId: randomUUID(), customerName: 'Perf Üye', waitlist: true }), { logger: quiet })), 5);

/* ══════════════════ Plan ══════════════════ */

const plans = {};
const capture = async (name, sql) => {
  const explained = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  plans[name] = explained.map((row) => row['QUERY PLAN']).filter((text) => /Index|Execution Time|Seq Scan|Bitmap/.test(text));
};
const from30 = wall(day(-30), 0);
const until = wall(day(1), 0);
await capture('liste (30 gün, sayfa)', Prisma.sql`SELECT "id" FROM "SpaAppointment" WHERE "hotelId" = ${hotelId} AND "startsAt" >= ${from30} AND "startsAt" < ${until} ORDER BY "startsAt" ASC, "id" ASC LIMIT 50`);
await capture(
  'açık bakiye (366 gün)',
  Prisma.sql`SELECT "id" FROM "SpaAppointment" WHERE "hotelId" = ${hotelId} AND "startsAt" >= ${wall(day(-365), 0)} AND "startsAt" < ${until} AND "status" IN ('COMPLETED','CANCELLED','NO_SHOW') AND "balance" <> 0 ORDER BY "startsAt" ASC, "id" ASC LIMIT 50`,
);
await capture('takvim tutmaları (bugün)', Prisma.sql`SELECT "id" FROM "SpaHold" WHERE "hotelId" = ${hotelId} AND "active" AND "startsAt" >= ${wall(today, 0)} AND "startsAt" < ${until}`);
await capture('ad araması', Prisma.sql`SELECT "id" FROM "SpaAppointment" WHERE "hotelId" = ${hotelId} AND "customerName" ILIKE ${`%${sample.customerName.split(' ')[1]}%`} AND "startsAt" >= ${from30} ORDER BY "startsAt" ASC LIMIT 50`);

const pad = (text, width) => String(text).padEnd(width);
console.log(`\nKurulum ${setupSeconds} sn · randevular: ${counts.map((row) => `${row.status} ${row._count._all}`).join(' · ')} · tutma ${holds}`);
console.log(`\n${pad('ölçüm', 52)}${pad('en iyi', 10)}${pad('ortanca', 10)}en kötü`);
for (const row of results) console.log(`${pad(row.name, 52)}${pad(`${row.best.toFixed(0)} ms`, 10)}${pad(`${row.median.toFixed(0)} ms`, 10)}${row.worst.toFixed(0)} ms`);
for (const [name, lines] of Object.entries(plans)) {
  console.log(`\nPlan — ${name}:`);
  for (const line of lines) console.log(`  ${line.trim()}`);
}
await prisma.$disconnect();
