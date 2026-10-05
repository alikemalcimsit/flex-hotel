import { randomUUID } from 'node:crypto';

/**
 * Kalabalık demo veri (tanıtım / deneme için; gerçek otel verisi değildir).
 *
 *   DATABASE_URL=postgresql://... DEMO_CONFIRM=DEMO node scripts/demo-data.mjs [--reset]
 *
 * - Yalnızca kodu DEMO olan otelde çalışır (önce `npm run seed`).
 * - Eklenen her şey tanınır: rezervasyon kodu `DMO-...`, misafir etiketi `demo`.
 *   `--reset` yalnızca bunları siler, başka veriye dokunmaz. Yeniden çalıştırmak
 *   önce `--reset` ister (çifte veri oluşmaz).
 * - Aynı çalıştırma aynı veriyi üretir (sabit tohum); tarihler bugüne göre kayar.
 * - Kapsam: ~52 oda, 1000 misafir, 13 ay geçmiş + 75 gün ileri rezervasyon
 *   (mevsimli doluluk ve fiyat), folyo kalemleri, ödemeler, iptal / gelmeyen,
 *   onaylı bütçe + kapanmış aylar için gerçekleşen giderler.
 */

if (process.env.DEMO_CONFIRM !== 'DEMO') {
  console.error('Güvenlik: DEMO_CONFIRM=DEMO verilmeden çalışmaz.');
  process.exit(1);
}

const core = await import('@hotelos/core');
const { prisma } = await import('../src/db.js');
const budget = await import('../src/modules/budget/service.js');

const HISTORY_DAYS = 400;
const FUTURE_DAYS = 75;
const CODE_PREFIX = 'DMO-';
const ACTOR = 'demo@hotel.local';
const TAX_DIVISOR = 1.1;
const CHUNK = 2000;
const GUEST_COUNT = 1000;

const hotel = await prisma.hotel.findFirst({ where: { code: 'DEMO', deletedAt: null } });
if (!hotel) {
  console.error('DEMO oteli yok; önce `npm run seed`.');
  process.exit(1);
}
const hotelId = hotel.id;
const today = core.toIsoDay(core.calendarDateInTimeZone(hotel.timezone));

const dayMs = 86_400_000;
const midnight = (iso) => new Date(`${iso}T00:00:00.000Z`);
const addDays = (iso, n) => core.toIsoDay(new Date(midnight(iso).getTime() + n * dayMs));
const at = (iso, hourUtc) => new Date(`${iso}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`);
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

const existingDemo = await prisma.reservation.count({ where: { hotelId, confirmationCode: { startsWith: CODE_PREFIX } } });
if (process.argv.includes('--reset')) {
  await prisma.$transaction(
    async (tx) => {
      const ids = `(SELECT id FROM "Reservation" WHERE "hotelId" = $1 AND "confirmationCode" LIKE '${CODE_PREFIX}%')`;
      for (const table of ['Payment', 'FolioItem', 'Folio', 'ReservationNight']) {
        await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "reservationId" IN ${ids}`, hotelId);
      }
      await tx.$executeRawUnsafe(`DELETE FROM "Reservation" WHERE "hotelId" = $1 AND "confirmationCode" LIKE '${CODE_PREFIX}%'`, hotelId);
      await tx.$executeRawUnsafe(
        `DELETE FROM "Guest" g WHERE g."hotelId" = $1 AND 'demo' = ANY(g."tags") AND NOT EXISTS (SELECT 1 FROM "Reservation" r WHERE r."guestId" = g."id")`,
        hotelId,
      );
    },
    { timeout: 120_000 },
  );
  console.log('Önceki demo veri silindi.');
} else if (existingDemo > 0) {
  console.error('Demo veri zaten var; silip yeniden üretmek için --reset ile çalıştırın.');
  process.exit(1);
}

// Sabit tohumlu rastgele sayı üreteci (mulberry32).
let state = 20261005;
const rand = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (entries) => {
  let roll = rand() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[0][0];
};

// ── Odalar ──────────────────────────────────────────────────────────────
const types = {};
for (const row of await prisma.roomType.findMany({ where: { hotelId, deletedAt: null } })) types[row.code] = row;
const layout = [
  { floor: 1, type: 'STD', from: 101, to: 120 },
  { floor: 2, type: 'DLX', from: 201, to: 220 },
  { floor: 3, type: 'SUIT', from: 301, to: 312 },
];
const have = new Set((await prisma.room.findMany({ where: { hotelId, deletedAt: null } })).map((room) => room.number));
const newRooms = [];
for (const { floor, type, from, to } of layout) {
  for (let number = from; number <= to; number += 1) {
    if (!have.has(String(number))) newRooms.push({ hotelId, number: String(number), floor, roomTypeId: types[type].id, createdAt: at(addDays(today, -HISTORY_DAYS - 30), 0) });
  }
}
if (newRooms.length) await prisma.room.createMany({ data: newRooms });
// Satılabilir oda sayısı odanın açılış tarihine bağlıdır: tüm odalar geçmiş döneme de ait olsun.
await prisma.room.updateMany({ where: { hotelId, createdAt: { gt: at(addDays(today, -HISTORY_DAYS - 30), 0) } }, data: { createdAt: at(addDays(today, -HISTORY_DAYS - 30), 0) } });
const rooms = await prisma.room.findMany({ where: { hotelId, deletedAt: null }, include: { roomType: true } });

// ── Misafirler ──────────────────────────────────────────────────────────
const FIRST = ['Ahmet', 'Mehmet', 'Ayşe', 'Fatma', 'Mustafa', 'Zeynep', 'Elif', 'Emre', 'Burak', 'Selin', 'Deniz', 'Can', 'Ece', 'Cem', 'Merve', 'Oğuz', 'Defne', 'Kerem', 'Aslı', 'Tolga', 'Gizem', 'Barış', 'Seda', 'Onur', 'İrem'];
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Erdoğan'];
const FOREIGN = [
  ['Hans', 'Müller', 'DE'], ['Anna', 'Schmidt', 'DE'], ['John', 'Smith', 'GB'], ['Emma', 'Brown', 'GB'], ['Ivan', 'Petrov', 'RU'],
  ['Olga', 'Ivanova', 'RU'], ['Pierre', 'Dubois', 'FR'], ['Marie', 'Laurent', 'FR'], ['Jan', 'de Vries', 'NL'], ['Sofia', 'Rossi', 'IT'],
  ['Lars', 'Nilsson', 'SE'], ['Mia', 'Kowalski', 'PL'],
];
const guestRows = [];
for (let index = 0; index < GUEST_COUNT; index += 1) {
  const foreign = rand() < 0.3;
  const [first, last, nationality] = foreign ? pick(FOREIGN) : [pick(FIRST), pick(LAST), 'TR'];
  guestRows.push({
    id: randomUUID(),
    hotelId,
    firstName: first,
    lastName: last,
    nationality,
    phone: `+90555${String(1000000 + index * 7).slice(0, 7)}`,
    email: `misafir${index + 1}@example.com`,
    tags: ['demo', ...(rand() < 0.08 ? ['VIP'] : [])],
  });
}
for (let from = 0; from < guestRows.length; from += CHUNK) await prisma.guest.createMany({ data: guestRows.slice(from, from + CHUNK) });

// ── Rezervasyonlar ──────────────────────────────────────────────────────
// Ay bazında doluluk ve fiyat çarpanı (Akdeniz yazlık otel mevsimselliği).
const OCCUPANCY = [0.42, 0.44, 0.52, 0.64, 0.74, 0.86, 0.95, 0.96, 0.88, 0.75, 0.54, 0.5];
const PRICE = [0.8, 0.8, 0.85, 0.95, 1.0, 1.2, 1.4, 1.4, 1.2, 1.0, 0.85, 0.95];
const SOURCES = [['OTA', 35], ['UI', 14], ['PHONE', 10], ['WIDGET', 10], ['AGENCY', 12], ['WEBCHAT', 8], ['EMAIL', 6], ['WHATSAPP', 5]];
const BOARDS = [['BB', 50], ['HB', 25], ['AI', 15], ['RO', 10]];
const monthOf = (iso) => Number(iso.slice(5, 7)) - 1;
const nightAmount = (room, iso) => {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const weekend = weekday === 5 || weekday === 6 ? 1.15 : 1;
  return Math.round(Number(room.roomType.basePrice) * PRICE[monthOf(iso)] * weekend * (0.94 + rand() * 0.12));
};

const firstDay = addDays(today, -HISTORY_DAYS);
const lastDay = addDays(today, FUTURE_DAYS);
const busy = new Map();
for (const row of await prisma.reservation.findMany({
  where: { hotelId, roomId: { not: null }, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] }, deletedAt: null, confirmationCode: { not: { startsWith: CODE_PREFIX } } },
  select: { roomId: true, checkIn: true, checkOut: true },
})) {
  const list = busy.get(row.roomId) ?? [];
  list.push([core.toIsoDay(row.checkIn), core.toIsoDay(row.checkOut)]);
  busy.set(row.roomId, list);
}

// Odası verilmemiş eski rezervasyonlar da bir oda tutar: aynı tipten bir odaya yaz.
for (const row of await prisma.reservation.findMany({
  where: { hotelId, roomId: null, status: { in: ['PENDING', 'CONFIRMED'] }, deletedAt: null, confirmationCode: { not: { startsWith: CODE_PREFIX } } },
  select: { roomTypeId: true, checkIn: true, checkOut: true },
})) {
  const from = core.toIsoDay(row.checkIn);
  const to = core.toIsoDay(row.checkOut);
  const room = rooms.find((candidate) => candidate.roomTypeId === row.roomTypeId && !(busy.get(candidate.id) ?? []).some(([a, b]) => from < b && a < to));
  if (room) busy.set(room.id, [...(busy.get(room.id) ?? []), [from, to]]);
}

const stays = [];
for (const room of rooms) {
  let cursor = firstDay;
  const blocked = busy.get(room.id) ?? [];
  while (cursor < lastDay) {
    const occupancy = OCCUPANCY[monthOf(cursor)];
    const length = weighted([[1, 8], [2, 22], [3, 26], [4, 16], [5, 12], [7, 12], [10, 4]]);
    const gap = rand() < occupancy ? int(0, 1) : int(1, Math.max(2, Math.round((length * (1 - occupancy)) / occupancy)));
    const checkIn = addDays(cursor, gap);
    const checkOut = addDays(checkIn, length);
    cursor = checkOut;
    if (checkIn >= lastDay) break;
    if (blocked.some(([from, to]) => checkIn < to && from < checkOut)) continue;
    const lead = Math.max(0, Math.round(-Math.log(1 - rand()) * 22));
    const ahead = Math.round((midnight(checkIn).getTime() - midnight(today).getTime()) / dayMs);
    // Ileri tarihler henüz tam dolmamıştır: ufuk uzadıkça satılan pay azalır.
    if (ahead > 0 && rand() > Math.max(0.05, 0.95 - ahead / 90) * (occupancy + 0.15)) continue;
    stays.push({ room, checkIn, checkOut, lead });
  }
}

let sequence = 0;
const reservations = [];
const nights = [];
for (const { room, checkIn, checkOut, lead } of stays) {
  const capacity = room.roomType.capacityAdults;
  const guest = guestRows[Math.floor(Math.pow(rand(), 1.4) * guestRows.length)];
  const adults = Math.min(capacity, weighted([[1, 2], [2, 7], [3, 2], [4, 1]]));
  const createdDay = addDays(checkIn, -lead);
  const createdAt = createdDay > today ? at(today, 6) : at(createdDay, int(6, 18));
  let status;
  if (checkOut < today) status = 'CHECKED_OUT';
  else if (checkIn < today || (checkIn === today && rand() < 0.5)) status = 'CHECKED_IN';
  else status = rand() < 0.86 ? 'CONFIRMED' : 'PENDING';
  const id = randomUUID();
  sequence += 1;
  const nightRows = [];
  for (let day = checkIn; day < checkOut; day = addDays(day, 1)) {
    nightRows.push({ id: randomUUID(), hotelId, reservationId: id, date: midnight(day), amount: nightAmount(room, day) });
  }
  nights.push(...nightRows);
  const stayed = status === 'CHECKED_IN' || status === 'CHECKED_OUT';
  const row = {
    id,
    hotelId,
    guestId: guest.id,
    roomTypeId: room.roomTypeId,
    // Gelecekte bazı rezervasyonlar henüz odaya atanmamıştır.
    roomId: stayed || (status === 'CONFIRMED' && rand() > 0.35) ? room.id : null,
    checkIn: at(checkIn, 11),
    checkOut: at(checkOut, 9),
    adults,
    children: adults < capacity && rand() < 0.15 ? 1 : 0,
    status,
    source: weighted(SOURCES),
    boardType: weighted(BOARDS),
    totalPrice: money(nightRows.reduce((sum, night) => sum + night.amount, 0)),
    currency: 'TRY',
    confirmationCode: `${CODE_PREFIX}${String(sequence).padStart(6, '0')}`,
    createdBy: ACTOR,
    createdAt,
    confirmedAt: status === 'PENDING' ? null : createdAt,
  };
  if (stayed) {
    row.checkedInAt = at(checkIn, 12);
    row.checkedInBy = ACTOR;
  }
  if (status === 'CHECKED_OUT') {
    row.checkedOutAt = at(checkOut, 9);
    row.checkedOutBy = ACTOR;
  }
  reservations.push({ row, nightRows, checkIn, checkOut });
}

// İptaller ve gelmeyenler (oda tutmaz, gecesi yok; ücretli olanın folyosu var).
const lost = [];
const lostCount = Math.round(reservations.length * 0.09);
for (let index = 0; index < lostCount; index += 1) {
  const room = pick(rooms);
  const checkIn = addDays(today, int(-HISTORY_DAYS + 10, FUTURE_DAYS - 10));
  const length = int(2, 5);
  const noShow = checkIn < today && rand() < 0.15;
  const nightly = nightAmount(room, checkIn);
  const fee = rand() < 0.35 || noShow ? Math.round(nightly * (noShow ? 1 : 0.5)) : null;
  const createdDay = addDays(checkIn, -int(5, 40));
  const createdAt = at(createdDay > today ? today : createdDay, 10);
  sequence += 1;
  lost.push({
    id: randomUUID(),
    hotelId,
    guestId: pick(guestRows).id,
    roomTypeId: room.roomTypeId,
    checkIn: at(checkIn, 11),
    checkOut: at(addDays(checkIn, length), 9),
    adults: 2,
    status: noShow ? 'NO_SHOW' : 'CANCELLED',
    source: weighted(SOURCES),
    boardType: 'BB',
    totalPrice: money(nightly * length),
    confirmationCode: `${CODE_PREFIX}${String(sequence).padStart(6, '0')}`,
    createdBy: ACTOR,
    createdAt,
    confirmedAt: createdAt,
    cancelledAt: noShow ? null : new Date(Math.min(Date.now(), createdAt.getTime() + int(1, 20) * dayMs)),
    cancelledBy: noShow ? null : ACTOR,
    cancelReason: noShow ? null : pick(['Plan değişikliği', 'Daha uygun fiyat bulundu', 'Hastalık', 'Uçuş iptali']),
    cancellationFee: !noShow && fee !== null ? money(fee) : null,
    noShowAt: noShow ? at(addDays(checkIn, 1), 3) : null,
    noShowFee: noShow && fee !== null ? money(fee) : null,
    meta: { fee, checkIn },
  });
}

// ── Folyo, kalemler, ödemeler ───────────────────────────────────────────
const folios = [];
const items = [];
const payments = [];
const addItem = (folio, reservationId, fields) => {
  const amount = Number(fields.amount);
  const net = Math.round((amount / TAX_DIVISOR) * 100) / 100;
  items.push({
    id: randomUUID(),
    hotelId,
    folioId: folio.id,
    reservationId,
    quantity: 1,
    postedBy: ACTOR,
    postedAt: at(fields.serviceDate, 3),
    sourceKey: `demo:${randomUUID()}`,
    ...fields,
    amount: money(amount),
    netAmount: money(net),
    taxAmount: money(amount - net),
    total: money(amount),
    serviceDate: midnight(fields.serviceDate),
  });
  folio.charges += amount;
};
const METHODS = [['CARD', 52], ['CASH', 16], ['TRANSFER', 10], ['VIRTUAL_POS', 12], ['AGENCY', 10]];
const pay = (folio, reservationId, amount, day, method) => {
  payments.push({
    id: randomUUID(),
    hotelId,
    folioId: folio.id,
    reservationId,
    method,
    amount: money(amount),
    folioAmount: money(amount),
    businessDate: midnight(day),
    receivedBy: ACTOR,
    receivedAt: at(day, 9),
    postedAt: at(day, 9),
    sourceKey: `demo:${randomUUID()}`,
  });
  folio.paid += amount;
};

for (const { row, nightRows, checkIn, checkOut } of reservations) {
  if (row.status !== 'CHECKED_IN' && row.status !== 'CHECKED_OUT') continue;
  const folio = { id: randomUUID(), charges: 0, paid: 0 };
  const allInclusive = row.boardType === 'AI';
  for (const night of nightRows) {
    const day = core.toIsoDay(night.date);
    if (day >= today) continue;
    addItem(folio, row.id, { type: 'ROOM', source: 'ROOM_NIGHT', description: 'Oda ücreti', amount: night.amount, taxCategory: 'ROOM', serviceDate: day });
    if (!allInclusive && rand() < 0.5) addItem(folio, row.id, { type: 'FNB', source: 'FNB_ORDER', description: pick(['Restoran', 'Bar', 'Oda servisi', 'Plaj bar']), amount: int(250, 1800), taxCategory: 'FNB', serviceDate: day });
    if (rand() < 0.12) addItem(folio, row.id, { type: 'MINIBAR', source: 'MINIBAR', description: 'Minibar', amount: int(80, 420), taxCategory: 'MINIBAR', serviceDate: day });
    if (rand() < 0.04) addItem(folio, row.id, { type: 'LAUNDRY', source: 'LAUNDRY', description: 'Çamaşırhane', amount: int(150, 700), taxCategory: 'LAUNDRY', serviceDate: day });
    if (rand() < 0.06) addItem(folio, row.id, { type: 'SPA', source: 'MANUAL', description: 'Spa', amount: int(800, 2600), taxCategory: 'SPA', serviceDate: day });
  }
  const method = row.source === 'AGENCY' ? 'AGENCY' : weighted(METHODS);
  const closed = row.status === 'CHECKED_OUT';
  if (closed) {
    if (rand() < 0.4 && folio.charges > 1000) pay(folio, row.id, Math.round(folio.charges * 0.3), checkIn, 'CARD');
    pay(folio, row.id, Math.round((folio.charges - folio.paid) * 100) / 100, checkOut, method);
  } else if (folio.charges > 0 && rand() < 0.6) {
    pay(folio, row.id, Math.round(folio.charges * 0.4), checkIn, method);
  }
  folios.push({
    id: folio.id,
    hotelId,
    reservationId: row.id,
    guestId: row.guestId,
    status: closed ? 'CLOSED' : 'OPEN',
    chargesTotal: money(folio.charges),
    paymentsTotal: money(folio.paid),
    balance: money(folio.charges - folio.paid),
    openedBy: ACTOR,
    closedAt: closed ? at(checkOut, 9) : null,
    closedBy: closed ? ACTOR : null,
  });
}
for (const entry of lost) {
  const { fee, checkIn } = entry.meta;
  delete entry.meta;
  if (fee === null) continue;
  const day = entry.status === 'NO_SHOW' ? addDays(checkIn, 1) : core.toIsoDay(entry.cancelledAt);
  if (day >= today) continue;
  const folio = { id: randomUUID(), charges: 0, paid: 0 };
  addItem(folio, entry.id, { type: 'ROOM', source: entry.status === 'NO_SHOW' ? 'NO_SHOW' : 'CANCELLATION', description: entry.status === 'NO_SHOW' ? 'Gelmeme bedeli' : 'İptal bedeli', amount: fee, taxCategory: 'ROOM', serviceDate: day });
  pay(folio, entry.id, fee, day, 'CARD');
  folios.push({ id: folio.id, hotelId, reservationId: entry.id, guestId: entry.guestId, status: 'CLOSED', chargesTotal: money(folio.charges), paymentsTotal: money(folio.paid), balance: '0.00', openedBy: ACTOR, closedAt: at(day, 9), closedBy: ACTOR });
}
for (const entry of lost) delete entry.meta;

const insertChunks = async (model, data) => {
  for (let from = 0; from < data.length; from += CHUNK) await prisma[model].createMany({ data: data.slice(from, from + CHUNK) });
};
await insertChunks('reservation', reservations.map((entry) => entry.row));
await insertChunks('reservation', lost);
await insertChunks('reservationNight', nights);
await insertChunks('folio', folios);
await insertChunks('folioItem', items);
await insertChunks('payment', payments);

// Toplu yazım gelir özet tablosunu geçersiz kılar; rapor ilk istekte yeniden hesaplar.
await prisma.$executeRawUnsafe('DELETE FROM "RevenueStatDay" WHERE "hotelId" = $1', hotelId);
await prisma.$executeRawUnsafe('DELETE FROM "RevenueDayStat" WHERE "hotelId" = $1', hotelId);

// Odaların anlık durumu: içeride kimse varsa dolu, boşların bir kısmı kirli.
const inHouse = new Set(reservations.filter((entry) => entry.row.status === 'CHECKED_IN').map((entry) => entry.row.roomId));
await prisma.room.updateMany({ where: { hotelId, id: { in: [...inHouse] } }, data: { occupancy: 'OCCUPIED' } });
const dirty = rooms.filter((room) => !inHouse.has(room.id) && rand() < 0.2).map((room) => room.id);
await prisma.room.updateMany({ where: { id: { in: dirty } }, data: { housekeepingStatus: 'DIRTY' } });

// ── Bütçe: onaylı yıllık bütçe + kapanmış aylar için gerçekleşen gider ────
const year = Number(today.slice(0, 4));
const asManager = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: ACTOR }, fn);
const monthsOf = (fn) => Array.from({ length: 12 }, (_, index) => String(Math.round(fn(index))));
const daysIn = (index) => new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
const avgRate = rooms.reduce((sum, room) => sum + Number(room.roomType.basePrice), 0) / rooms.length;
const plannedRoom = (index) => rooms.length * daysIn(index) * OCCUPANCY[index] * avgRate * PRICE[index] * 0.93;
const SHARE = [0.3, 0.12, 0.1, 0.08, 0.07, 0.06, 0.05];
const expenseOf = (index, month) => plannedRoom(month) * 1.3 * (SHARE[index] ?? 0.04) * 0.9;
try {
  let view = await asManager(() => budget.getBudgetYear(hotelId, year));
  if (!view.draft && !view.approved) view = await asManager(() => budget.createBudget(hotelId, { year }));
  if (view.draft) {
    const lines = [
      { item: 'ROOM_REVENUE', months: monthsOf((i) => plannedRoom(i)) },
      { item: 'FNB_REVENUE', months: monthsOf((i) => plannedRoom(i) * 0.095) },
      { item: 'MINIBAR_REVENUE', months: monthsOf((i) => plannedRoom(i) * 0.0065) },
      { item: 'LAUNDRY_REVENUE', months: monthsOf((i) => plannedRoom(i) * 0.004) },
      { item: 'OTHER_REVENUE', months: monthsOf((i) => plannedRoom(i) * 0.021) },
      { item: 'OCCUPANCY', months: monthsOf((i) => OCCUPANCY[i] * 100) },
      { item: 'ADR', months: monthsOf((i) => avgRate * PRICE[i] * 0.95) },
      ...view.items.filter((item) => !item.system).map((item, index) => ({ item: item.item, months: monthsOf((i) => expenseOf(index, i)) })),
    ];
    const saved = await asManager(() => budget.saveBudgetLines(hotelId, view.draft.id, { expectedUpdatedAt: new Date(view.draft.updatedAt), lines }));
    await asManager(() => budget.approveBudget(hotelId, saved.draft.id, { expectedUpdatedAt: new Date(saved.draft.updatedAt) }));
  }
  const expenses = view.items.filter((item) => !item.system);
  const filled = new Set((await asManager(() => budget.getExpenseActuals(hotelId, year))).entries.map((entry) => `${entry.itemId}:${entry.month}`));
  const entries = [];
  for (let month = 1; month < Number(today.slice(5, 7)); month += 1) {
    expenses.forEach((item, index) => {
      if (filled.has(`${item.item}:${month}`)) return;
      entries.push({ itemId: item.item, month, amount: String(Math.round(expenseOf(index, month - 1) * (0.92 + rand() * 0.2))), expectedUpdatedAt: null });
    });
  }
  if (entries.length) await asManager(() => budget.saveExpenseActuals(hotelId, { year, entries }));
  console.log(`Bütçe ${year}: onaylı, ${entries.length} gider gerçekleşeni.`);
} catch (error) {
  console.error(`Bütçe adımı atlandı: ${error.message}`);
}

console.log(
  `Demo veri hazır: ${rooms.length} oda, ${guestRows.length} misafir, ${reservations.length + lost.length} rezervasyon ` +
    `(${lost.length} iptal / gelmeyen), ${nights.length} gece, ${items.length} folyo kalemi, ${payments.length} ödeme.`,
);
await prisma.$disconnect();
