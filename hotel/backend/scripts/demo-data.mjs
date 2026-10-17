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
 *   onaylı bütçe + kapanmış aylar için gerçekleşen giderler, 10 acente
 *   (9 satıştaki kontrat, stop-sale; biri pasif / kontratı sonlanmış) ve
 *   acente rezervasyonları kontrat fiyatıyla, cariye aktarılan ödemeleriyle.
 * - Acenteler `createdBy = demo@hotel.local` ile tanınır; `--reset` onları da siler.
 * - Promosyonlar (modül 31): erken rezervasyon, "7 kal 6 öde", son dakika
 *   online, hoş geldin kuponu (çok kullanımlık), sadık misafir kuponları (tek
 *   kullanımlık), bir durdurulmuş ve bir taslak promosyon. Doğrudan satışlara
 *   kural motoru (her rezervasyonun kendi satış günüyle) uygulanır; acente ve
 *   OTA satışına uygulanmaz. Aynı `createdBy` ile tanınır, `--reset` siler.
 * - Kanal (modül 33): senkronda bir "Airbnb (demo)" iCal kanalı — bütün oda
 *   tipleri eşleşmiş, dışa aktarma takvimi gerçek müsaitlikten; içe aktarma
 *   adresi yok (sunucu dışarıya istek atmaz). Gelecekteki OTA
 *   rezervasyonlarının bir kısmı bu kanalın kayıtlarına bağlı (çoğu işlenmiş,
 *   birkaçı "doğrulanmalı"). Aynı `createdBy` ile tanınır, `--reset` siler.
 * - Banket (modül 37, `demo-banquet.mjs`): bölünebilir balo salonu, teras, toplantı
 *   odaları, ekipman, müşteriler, politika ve her durumda etkinlik (gerçekleşmiş +
 *   proforma, iptal + onay bekleyen iade, kongre, sıralı opsiyon, gecikmiş taksit,
 *   teklif bekleyen talepler, kaybedilen). `--reset` belge dosyalarıyla siler.
 */

if (process.env.DEMO_CONFIRM !== 'DEMO') {
  console.error('Güvenlik: DEMO_CONFIRM=DEMO verilmeden çalışmaz.');
  process.exit(1);
}

const core = await import('@hotelos/core');
const contracts = await import('@hotelos/hotel-contracts');
const { prisma } = await import('../src/db.js');
const budget = await import('../src/modules/budget/service.js');
const { removeFiles } = await import('../src/lib/file-storage.js');
const { resetBanquetDemo, seedBanquetDemo } = await import('./demo-banquet.mjs');

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

const existingDemo =
  (await prisma.reservation.count({ where: { hotelId, confirmationCode: { startsWith: CODE_PREFIX } } })) +
  (await prisma.agency.count({ where: { hotelId, createdBy: ACTOR } })) +
  (await prisma.promotion.count({ where: { hotelId, createdBy: ACTOR } })) +
  (await prisma.channel.count({ where: { hotelId, createdBy: ACTOR } })) +
  (await prisma.agencyBonusRule.count({ where: { hotelId, createdBy: ACTOR } })) +
  (await prisma.venue.count({ where: { hotelId, createdBy: ACTOR } }));
if (process.argv.includes('--reset')) {
  let banquetFiles = [];
  await prisma.$transaction(
    async (tx) => {
      // Demo banket (modül 37): etkinlikler ödemeleri, onayları, belgeleriyle; salon, ekipman, müşteri.
      banquetFiles = await resetBanquetDemo(tx, hotelId, ACTOR);
      // Demo prim kuralları (modül 35): demo acentelere bağlı bütün kurallar (personelin demo acenteye
      // açtığı da — acente silinecek). Hak ediş satırları rezervasyona bağlı: önce hak edişler (satırlar
      // onlarla gider), onların onay istekleri ve zil uyarıları, sonra kurallar.
      const ruleIds = (
        await tx.$queryRawUnsafe(
          `SELECT "id" FROM "AgencyBonusRule" WHERE "hotelId" = $1
             AND ("createdBy" = $2 OR "agencyId" IN (SELECT "id" FROM "Agency" WHERE "hotelId" = $1 AND "createdBy" = $2))`,
          hotelId,
          ACTOR,
        )
      ).map((row) => row.id);
      const bonusIds = (await tx.$queryRawUnsafe(`SELECT "id" FROM "AgencyBonus" WHERE "ruleId" = ANY($1::text[])`, ruleIds)).map((row) => row.id);
      await tx.$executeRawUnsafe(`DELETE FROM "AgencyBonus" WHERE "id" = ANY($1::text[])`, bonusIds);
      const approvalIds = (
        await tx.$queryRawUnsafe(`SELECT "id" FROM "Approval" WHERE "hotelId" = $1 AND "entityType" = 'AgencyBonus' AND "entityId" = ANY($2::text[])`, hotelId, bonusIds)
      ).map((row) => row.id);
      await tx.$executeRawUnsafe(`DELETE FROM "PendingAction" WHERE "approvalId" = ANY($1::text[])`, approvalIds);
      await tx.$executeRawUnsafe(`DELETE FROM "Approval" WHERE "id" = ANY($1::text[])`, approvalIds);
      await tx.$executeRawUnsafe(
        `DELETE FROM "StaffAlert" WHERE "hotelId" = $1 AND "entityId" = ANY($2::text[])`,
        hotelId,
        [...bonusIds, ...ruleIds, ...approvalIds],
      );
      await tx.$executeRawUnsafe(`DELETE FROM "AgencyBonusRule" WHERE "id" = ANY($1::text[])`, ruleIds);

      const ids = `(SELECT id FROM "Reservation" WHERE "hotelId" = $1 AND "confirmationCode" LIKE '${CODE_PREFIX}%')`;
      for (const table of ['Payment', 'FolioItem', 'Folio', 'ReservationNight']) {
        await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "reservationId" IN ${ids}`, hotelId);
      }
      await tx.$executeRawUnsafe(`DELETE FROM "Reservation" WHERE "hotelId" = $1 AND "confirmationCode" LIKE '${CODE_PREFIX}%'`, hotelId);
      // Demo kanal (modül 33): kayıtları ve revizyonları, sonra kanal (eşleştirme, durum, log kanalla gider).
      const demoChannels = `(SELECT "id" FROM "Channel" WHERE "hotelId" = $1 AND "createdBy" = $2)`;
      await tx.$executeRawUnsafe(`UPDATE "Reservation" SET "channelBookingId" = NULL, "channelRoomIndex" = NULL WHERE "channelBookingId" IN (SELECT "id" FROM "ChannelBooking" WHERE "channelId" IN ${demoChannels})`, hotelId, ACTOR);
      await tx.$executeRawUnsafe(`DELETE FROM "ChannelBookingRevision" WHERE "channelId" IN ${demoChannels}`, hotelId, ACTOR);
      await tx.$executeRawUnsafe(`DELETE FROM "ChannelBooking" WHERE "channelId" IN ${demoChannels}`, hotelId, ACTOR);
      await tx.$executeRawUnsafe(`DELETE FROM "Channel" WHERE "id" IN ${demoChannels}`, hotelId, ACTOR);
      await tx.$executeRawUnsafe(
        `DELETE FROM "Guest" g WHERE g."hotelId" = $1 AND 'demo' = ANY(g."tags") AND NOT EXISTS (SELECT 1 FROM "Reservation" r WHERE r."guestId" = g."id")`,
        hotelId,
      );
      // Demo acenteler: başka rezervasyonu olmayanlar kontratlarıyla (fiyat ve stop-sale satırları kontratla gider) silinir.
      const orphan = `(SELECT a."id" FROM "Agency" a WHERE a."hotelId" = $1 AND a."createdBy" = $2 AND NOT EXISTS (SELECT 1 FROM "Reservation" r WHERE r."agencyId" = a."id"))`;
      await tx.$executeRawUnsafe(`DELETE FROM "Contract" WHERE "hotelId" = $1 AND "agencyId" IN ${orphan}`, hotelId, ACTOR);
      await tx.$executeRawUnsafe(`DELETE FROM "Agency" WHERE "id" IN ${orphan}`, hotelId, ACTOR);
      // Demo promosyonlar: başka rezervasyona düşmemişler kuponlarıyla (kupon promosyonla gider) silinir.
      await tx.$executeRawUnsafe(
        `DELETE FROM "Promotion" p WHERE p."hotelId" = $1 AND p."createdBy" = $2 AND NOT EXISTS (SELECT 1 FROM "Reservation" r WHERE r."promotionId" = p."id")`,
        hotelId,
        ACTOR,
      );
    },
    { timeout: 120_000 },
  );
  // Belge PDF'leri diskte: kayıtlar gittikten sonra silinir (silinemeyen yetim kalır, log'a yazılır).
  const leftover = await removeFiles(banquetFiles);
  if (leftover.length) console.error(`${leftover.length} banket belgesi diskten silinemedi`);
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

// ── Acenteler ve kontratlar (modül 29) ──────────────────────────────────
// Kontrat fiyatı: oda tipi taban fiyatı × ay çarpanı × pansiyon × acente indirimi (10 TL'ye yuvarlı).
// Acente rezervasyonlarının geceleri aynı formülle yazılır: kontratla rezervasyon hiç ayrışmaz.
const BOARD_FACTOR = { RO: 0.92, BB: 1, HB: 1.15, FB: 1.28, AI: 1.35, UAI: 1.5 };
const CONTRACT_BOARDS = ['BB', 'HB', 'AI'];
const agencyNightPrice = (seed, type, board, iso) => Math.round((Number(type.basePrice) * PRICE[monthOf(iso)] * BOARD_FACTOR[board] * seed.discount) / 10) * 10;

const AGENCY_SEEDS = [
  { code: 'ATLAS', name: 'Atlas Tur Seyahat', contactName: 'Selin Aksoy', commissionPct: '12', paymentTermDays: 30, discount: 0.82, weight: 24, stopSales: [{ from: 30, to: 33, reason: 'Kongre haftası: kontenjan yok' }] },
  { code: 'EGE', name: 'Ege Turizm ve Seyahat', contactName: 'Mert Yalçın', commissionPct: '10', paymentTermDays: 15, discount: 0.85, weight: 18, stopSales: [] },
  { code: 'AKDENIZ', name: 'Akdeniz Tatil Acentesi', contactName: 'Gül Demirtaş', commissionPct: '15', paymentTermDays: 45, discount: 0.8, weight: 16, stopSales: [{ from: 52, to: 54, reason: 'Toplu etkinlik' }] },
  { code: 'ROTA', name: 'Rota Travel', contactName: 'Kaan Özbek', commissionPct: '8', paymentTermDays: 30, discount: 0.88, weight: 10, stopSales: [] },
  { code: 'MAVIYOL', name: 'Mavi Yol Turizm', contactName: 'Hande Işık', commissionPct: '12.5', paymentTermDays: 30, discount: 0.83, weight: 10, stopSales: [] },
  { code: 'NORDIC', name: 'Nordic Sun Holidays (İsveç)', contactName: 'Anna Lindqvist', commissionPct: '18', paymentTermDays: 60, discount: 0.78, weight: 8, stopSales: [{ from: 40, to: 41, reason: 'Bakım: üst kat kapalı' }] },
  { code: 'SUNWAY', name: 'Sunway Reisen (Almanya)', contactName: 'Jonas Becker', commissionPct: '16', paymentTermDays: 60, discount: 0.8, weight: 8, stopSales: [] },
  { code: 'BALTIC', name: 'Baltic Trips (Polonya)', contactName: 'Marta Nowak', commissionPct: '15', paymentTermDays: 45, discount: 0.8, weight: 4, stopSales: [] },
  { code: 'KARDELEN', name: 'Kardelen Kurumsal Seyahat', contactName: 'Emre Kaplan', commissionPct: '5', paymentTermDays: 15, discount: 0.9, weight: 2, stopSales: [] },
  // Anlaşması bitmiş, pasif acente: durumların nasıl göründüğü için.
  { code: 'POYRAZ', name: 'Poyraz Turizm', contactName: 'Tuncay Ateş', commissionPct: '10', paymentTermDays: 30, discount: 0.86, weight: 0, stopSales: [], ended: true },
];

const agenciesService = await import('../src/modules/agencies/service.js');
const asActor = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: ACTOR }, fn);
const monthStartOf = (iso) => `${iso.slice(0, 7)}-01`;
const nextMonthStart = (iso) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 1)).toISOString().slice(0, 10);
const contractStart = addDays(firstDay, -10);
const contractEnd = addDays(lastDay, 60);
const CONTRACT_NAME = `Sezon ${contractStart.slice(0, 4)}–${contractEnd.slice(0, 4)}`;

/** Satışta olan, rezervasyon alabilen acenteler (stop-sale günleriyle). */
const sellableAgencies = [];
for (const seed of AGENCY_SEEDS) {
  const agency = await asActor(() =>
    agenciesService.createAgency(hotelId, {
      code: seed.code,
      name: seed.name,
      contactName: seed.contactName,
      phone: null,
      email: `rezervasyon@${seed.code.toLowerCase()}.example.com`,
      address: null,
      taxOffice: null,
      taxNumber: null,
      commissionPct: seed.commissionPct,
      paymentTermDays: seed.paymentTermDays,
      notes: null,
    }),
  );
  let contract = await asActor(() => agenciesService.createContract(hotelId, agency.id, { name: CONTRACT_NAME, startDate: midnight(contractStart), endDate: midnight(contractEnd), notes: null }));
  const rates = [];
  for (let monthStart = monthStartOf(contractStart); monthStart <= contractEnd; monthStart = nextMonthStart(monthStart)) {
    const blockStart = monthStart < contractStart ? contractStart : monthStart;
    const lastOfMonth = addDays(nextMonthStart(monthStart), -1);
    const blockEnd = lastOfMonth > contractEnd ? contractEnd : lastOfMonth;
    for (const type of Object.values(types)) {
      for (const board of CONTRACT_BOARDS) {
        rates.push({ roomTypeId: type.id, boardType: board, startDate: midnight(blockStart), endDate: midnight(blockEnd), price: String(agencyNightPrice(seed, type, board, blockStart)) });
      }
    }
  }
  contract = await asActor(() => agenciesService.saveContractRates(hotelId, contract.id, { expectedUpdatedAt: new Date(contract.updatedAt), rates }));
  contract = await asActor(() => agenciesService.activateContract(hotelId, contract.id, { expectedUpdatedAt: new Date(contract.updatedAt) }));
  const stopRanges = [];
  for (const stop of seed.stopSales) {
    const from = addDays(today, stop.from);
    const to = addDays(today, stop.to);
    contract = await asActor(() => agenciesService.addStopSale(hotelId, contract.id, { roomTypeId: null, startDate: midnight(from), endDate: midnight(to), reason: stop.reason }));
    stopRanges.push({ from, to });
  }
  if (seed.ended) {
    contract = await asActor(() => agenciesService.endContract(hotelId, contract.id, { expectedUpdatedAt: new Date(contract.updatedAt), reason: 'Anlaşma yenilenmedi' }));
    await asActor(() => agenciesService.setAgencyStatus(hotelId, agency.id, { expectedUpdatedAt: new Date(agency.updatedAt), status: 'PASSIVE' }));
    continue;
  }
  sellableAgencies.push({ id: agency.id, seed, commissionPct: seed.commissionPct, stopRanges });
}

/** Konaklamaya uyan, stop-sale'i olmayan bir acente (ağırlıklı); yoksa null. */
function pickAgency(checkIn, checkOut) {
  const fits = sellableAgencies.filter((agency) => !agency.stopRanges.some((stop) => checkIn <= stop.to && stop.from < checkOut));
  return fits.length ? weighted(fits.map((agency) => [agency, agency.seed.weight])) : null;
}

// ── Promosyonlar ve kuponlar (modül 31) ────────────────────────────────
// Satış dönemi demo geçmişinin başından: geçmiş satışlar da kendi günlerinde uygun sayılır.
const promotionsService = await import('../src/modules/promotions/service.js');
const promotionRules = await import('../src/modules/promotions/rules.js');
const DIRECT_SOURCES = contracts.DEFAULT_PROMOTION_SOURCES;
const winterYear = Number(today.slice(0, 4));
const PROMOTION_SEEDS = [
  { key: 'early', name: 'Erken Rezervasyon %15', discountType: 'PERCENT', discountValue: '15', minLeadDays: 45, minNights: 2, notes: 'Girişe 45 gün ve fazlası kala, en az 2 gece.' },
  { key: 'long', name: 'Uzun Konaklama: 7 Kal 6 Öde', discountType: 'FREE_NIGHTS', stayNights: 7, payNights: 6 },
  { key: 'lastMinute', name: 'Son Dakika Online %10', discountType: 'PERCENT', discountValue: '10', maxLeadDays: 3, sources: ['WIDGET', 'WEBCHAT', 'WHATSAPP'] },
  { key: 'welcome', name: 'Hoş Geldin Kuponu %20', requiresCoupon: true, discountType: 'PERCENT', discountValue: '20', coupons: { mode: 'CUSTOM', code: 'HOSGELDIN', maxUses: 500 } },
  { key: 'loyal', name: 'Sadık Misafir 750 TL', requiresCoupon: true, discountType: 'AMOUNT', discountValue: '750', minNights: 2, coupons: { mode: 'GENERATE', count: 150, prefix: 'SADIK', maxUses: 1 } },
  { key: 'spring', name: 'Bahar Fırsatı %8', discountType: 'PERCENT', discountValue: '8', status: 'PAUSED' },
  { key: 'winter', name: 'Kış Hafta Sonu %12', discountType: 'PERCENT', discountValue: '12', stayFrom: `${winterYear}-12-01`, stayTo: `${winterYear + 1}-02-28`, status: 'DRAFT' },
];
const promotionBookFrom = addDays(firstDay, -30);
/** @type {Record<string, { id: string, terms: any, coupons: Array<{ id: string, code: string }> }>} */
const demoPromotions = {};
for (const seed of PROMOTION_SEEDS) {
  const input = contracts.createPromotionSchema.parse({
    name: seed.name,
    notes: seed.notes ?? null,
    requiresCoupon: Boolean(seed.requiresCoupon),
    discountType: seed.discountType,
    discountValue: seed.discountValue ?? null,
    stayNights: seed.stayNights ?? null,
    payNights: seed.payNights ?? null,
    bookFrom: promotionBookFrom,
    stayFrom: seed.stayFrom ?? null,
    stayTo: seed.stayTo ?? null,
    minNights: seed.minNights ?? null,
    minLeadDays: seed.minLeadDays ?? null,
    maxLeadDays: seed.maxLeadDays ?? null,
    sources: seed.sources ?? DIRECT_SOURCES,
  });
  let promotion = await asActor(() => promotionsService.createPromotion(hotelId, input));
  if (seed.coupons) await asActor(() => promotionsService.createCoupons(hotelId, promotion.id, contracts.createCouponsSchema.parse(seed.coupons)));
  if (seed.status !== 'DRAFT') {
    promotion = await asActor(() => promotionsService.setPromotionStatus(hotelId, promotion.id, { expectedUpdatedAt: new Date(promotion.updatedAt), status: 'ACTIVE' }));
  }
  if (seed.status === 'PAUSED') {
    promotion = await asActor(() => promotionsService.setPromotionStatus(hotelId, promotion.id, { expectedUpdatedAt: new Date(promotion.updatedAt), status: 'PAUSED' }));
  }
  const row = await prisma.promotion.findFirst({ where: { id: promotion.id } });
  const coupons = await prisma.coupon.findMany({ where: { promotionId: promotion.id }, orderBy: { code: 'asc' }, select: { id: true, code: true } });
  demoPromotions[seed.key] = { id: promotion.id, status: row.status, terms: promotionRules.toTerms(row), coupons };
}
/** Satışta kendiliğinden değerlendirilenler (yayındaki, kuponsuz). */
const autoTerms = Object.values(demoPromotions).filter((entry) => entry.status === 'ACTIVE' && !entry.terms.requiresCoupon).map((entry) => entry.terms);
/** Tek kullanımlık sadık misafir kodları: her biri en fazla bir rezervasyonda. */
const loyalPool = [...demoPromotions.loyal.coupons];
const welcomeCoupon = demoPromotions.welcome.coupons[0];

/**
 * Doğrudan satışın teklifi (kural motoruyla, satış gününde): bazı misafirler
 * kupon da getirir; kupon daha avantajlı değilse kullanılmaz.
 */
function demoOffer({ bookedOn, checkIn, roomTypeId, boardType, source, nightRows }) {
  if (!DIRECT_SOURCES.includes(source)) return null;
  const roll = rand();
  let coupon = null;
  if (roll < 0.05 && loyalPool.length) coupon = { id: loyalPool[0].id, code: loyalPool[0].code, terms: demoPromotions.loyal.terms, issue: null };
  else if (roll < 0.13) coupon = { id: welcomeCoupon.id, code: welcomeCoupon.code, terms: demoPromotions.welcome.terms, issue: null };
  const { offer } = promotionRules.planOffer({
    autos: autoTerms,
    coupon,
    sale: { bookedOn, checkIn, days: nightRows.map((night) => core.toIsoDay(night.date)), roomTypeId, boardType, source },
    nights: nightRows.map((night) => ({ date: core.toIsoDay(night.date), gross: money(night.amount) })),
  });
  if (offer?.couponId && offer.couponId === loyalPool[0]?.id) loyalPool.shift();
  return offer;
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
  const sourceChoice = weighted(SOURCES);
  const agency = sourceChoice === 'AGENCY' ? pickAgency(checkIn, checkOut) : null;
  const boardChoice = agency ? weighted([['BB', 45], ['HB', 25], ['AI', 30]]) : weighted(BOARDS);
  const nightRows = [];
  for (let day = checkIn; day < checkOut; day = addDays(day, 1)) {
    const amount = agency ? agencyNightPrice(agency.seed, room.roomType, boardChoice, day) : nightAmount(room, day);
    nightRows.push({ id: randomUUID(), hotelId, reservationId: id, date: midnight(day), amount, ...(agency ? { baseRate: amount, seasonName: CONTRACT_NAME } : {}) });
  }
  const source = agency ? 'AGENCY' : sourceChoice === 'AGENCY' ? 'UI' : sourceChoice;
  // Promosyon (modül 31): gece tutarı indirimli, indirim gecede; kopya satış günüyle.
  const bookedOn = createdDay > today ? today : createdDay;
  const offer = demoOffer({ bookedOn, checkIn, roomTypeId: room.roomTypeId, boardType: boardChoice, source, nightRows });
  if (offer) {
    nightRows.forEach((night, index) => {
      night.discount = Number(offer.discounts[index]);
      night.amount = Number(core.toMoneyString(core.toDecimal(money(night.amount)).minus(core.toDecimal(offer.discounts[index]))));
    });
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
    // Kaynak "Acente" olan ama stop-sale yüzünden acente bulunamayan konaklama resepsiyondan sayılır.
    source,
    agencyId: agency?.id ?? null,
    agencyCommissionPct: agency?.commissionPct ?? null,
    ...(offer
      ? { promotionId: offer.terms.id, couponId: offer.couponId, promotionTerms: { ...offer.terms, bookedOn }, discountTotal: offer.total }
      : {}),
    boardType: boardChoice,
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
  const sourceChoice = weighted(SOURCES);
  const agency = sourceChoice === 'AGENCY' ? pickAgency(checkIn, addDays(checkIn, length)) : null;
  const nightly = agency ? agencyNightPrice(agency.seed, room.roomType, 'BB', checkIn) : nightAmount(room, checkIn);
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
    source: agency ? 'AGENCY' : sourceChoice === 'AGENCY' ? 'UI' : sourceChoice,
    agencyId: agency?.id ?? null,
    agencyCommissionPct: agency?.commissionPct ?? null,
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
    if (night.amount > 0) addItem(folio, row.id, { type: 'ROOM', source: 'ROOM_NIGHT', description: 'Oda ücreti', amount: night.amount, taxCategory: 'ROOM', serviceDate: day });
    if (!allInclusive && rand() < 0.5) addItem(folio, row.id, { type: 'FNB', source: 'FNB_ORDER', description: pick(['Restoran', 'Bar', 'Oda servisi', 'Plaj bar']), amount: int(250, 1800), taxCategory: 'FNB', serviceDate: day });
    if (rand() < 0.12) addItem(folio, row.id, { type: 'MINIBAR', source: 'MINIBAR', description: 'Minibar', amount: int(80, 420), taxCategory: 'MINIBAR', serviceDate: day });
    if (rand() < 0.04) addItem(folio, row.id, { type: 'LAUNDRY', source: 'LAUNDRY', description: 'Çamaşırhane', amount: int(150, 700), taxCategory: 'LAUNDRY', serviceDate: day });
    if (rand() < 0.06) addItem(folio, row.id, { type: 'SPA', source: 'MANUAL', description: 'Spa', amount: int(800, 2600), taxCategory: 'SPA', serviceDate: day });
  }
  const method = row.source === 'AGENCY' ? 'AGENCY' : weighted(METHODS);
  const closed = row.status === 'CHECKED_OUT';
  if (closed) {
    if (row.source !== 'AGENCY' && rand() < 0.4 && folio.charges > 1000) pay(folio, row.id, Math.round(folio.charges * 0.3), checkIn, 'CARD');
    pay(folio, row.id, Math.round((folio.charges - folio.paid) * 100) / 100, checkOut, method);
  } else if (row.source !== 'AGENCY' && folio.charges > 0 && rand() < 0.6) {
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

// ── Kanal (modül 33): Airbnb takvimi ve ona bağlı gelecek OTA rezervasyonları ──
const DEMO_CHANNEL_BOOKINGS = 30;
const DEMO_REVIEW_EVERY = 10;
const demoChannel = await prisma.channel.create({
  data: {
    hotelId,
    type: 'ICAL',
    name: 'Airbnb (demo)',
    status: 'ACTIVE',
    provider: 'AIRBNB',
    horizonDays: contracts.DEFAULT_ICAL_HORIZON_DAYS,
    activatedAt: new Date(),
    activatedBy: ACTOR,
    createdBy: ACTOR,
    state: { create: { hotelId } },
  },
});
const channelTypes = await prisma.roomType.findMany({ where: { hotelId }, select: { id: true } });
const mappingByType = new Map();
for (const type of channelTypes) {
  const mapping = await prisma.channelRoomMapping.create({
    data: { hotelId, channelId: demoChannel.id, roomTypeId: type.id, exportToken: randomUUID().replace(/-/g, '') },
  });
  mappingByType.set(type.id, mapping.id);
}
const otaUpcoming = await prisma.reservation.findMany({
  where: { hotelId, source: 'OTA', confirmationCode: { startsWith: CODE_PREFIX }, status: { in: ['CONFIRMED', 'PENDING'] }, checkIn: { gte: midnight(today) } },
  include: { guest: { select: { firstName: true, lastName: true } } },
  orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
  take: DEMO_CHANNEL_BOOKINGS,
});
for (const [index, row] of otaUpcoming.entries()) {
  const code = `HM${String(4_000_000 + index * 7919).slice(-7)}`;
  const review = index % DEMO_REVIEW_EVERY === 0;
  const booking = await prisma.channelBooking.create({
    data: {
      hotelId,
      channelId: demoChannel.id,
      externalBookingId: `${mappingByType.get(row.roomTypeId)}:demo-${row.id}@airbnb.com`,
      externalCode: code,
      otaName: 'Airbnb',
      state: review ? 'REVIEW' : 'PROCESSED',
      stateReason: review ? 'iCal fiyat ve kişi sayısı taşımaz: tutarı ve kişi sayısını kanaldaki rezervasyonla güncelleyin' : null,
      guestName: `${row.guest.firstName} ${row.guest.lastName}`,
      checkIn: midnight(core.toIsoDay(row.checkIn)),
      checkOut: midnight(core.toIsoDay(row.checkOut)),
      roomCount: 1,
      appliedRevisionAt: row.createdAt,
      ...(review ? {} : { resolvedAt: row.createdAt, resolvedBy: ACTOR, resolutionNote: 'Tutar Airbnb ödemesiyle doğrulandı' }),
      createdAt: row.createdAt,
    },
  });
  await prisma.$executeRaw`UPDATE "Reservation" SET "channelBookingId" = ${booking.id}, "channelRoomIndex" = 0 WHERE "id" = ${row.id}`;
}

// ── Acente primi (modül 35): her acenteye geçen sezon (bitti, hak edişi farklı durumlarda) ve bu sezon
// (sürüyor) kuralı; hedefler acentenin demo üretiminden türetilir (kimi geçer, kimi geride kalır) ──
const bonusRules = await import('../src/modules/agency-bonus/service.js');
const bonusSettlement = await import('../src/modules/agency-bonus/settlement.js');
const bonusProgress = await import('../src/modules/agency-bonus/progress.js');
const approvalsService = await import('../src/modules/approvals/service.js');
// Onay kararı hak edişe dinleyiciyle işlenir; betik uygulamayı başlatmadığı için dinleyici burada kaydedilir.
const { registerAgencyBonusSubscribers } = await import('../src/modules/agency-bonus/subscribers.js');
registerAgencyBonusSubscribers();
const DEMO_APPROVER = 'genel.mudur@hotel.local';
const DEMO_ACCOUNTANT = 'muhasebe@hotel.local';
const asUser = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);
/** Acente başına hedef çarpanı (geçen sezon / bu sezon): 1'in üstü hedefi zorlaştırır. */
const TARGET_FACTORS = [0.85, 0.95, 0.9, 1.4, 0.92, 1.1];
/** Geçen sezon hak edişinin varacağı durum (acente sırasıyla). */
const PAST_OUTCOMES = ['PAID', 'APPROVED', 'PENDING', 'DRAFT', 'REJECTED', 'PAID'];
const roundTo = (value, step) => Math.max(step, Math.round(value / step) * step);
/** Ölçüte göre hedef ve üç kademe (hedefin %85'i, kendisi, %115'i; oranlar 1 / 2 / 3). */
function demoTerms(metric, production, factor) {
  const base = metric === 'NIGHTS' ? production.nights : Number(production.revenue);
  const step = metric === 'NIGHTS' ? 5 : 10_000;
  const target = roundTo(base * factor, step);
  const tier = (share) => String(roundTo(target * share, step));
  return {
    target: String(target),
    tiers: [
      { threshold: tier(0.85), ratePct: '1' },
      { threshold: tier(1), ratePct: '2' },
      { threshold: tier(1.15), ratePct: '3' },
    ],
  };
}
const pastStart = addDays(today, -270);
const pastEnd = addDays(today, -91);
const seasonStart = addDays(today, -60);
const seasonEnd = addDays(today, 120);
let bonusCount = 0;
for (const [index, agency] of sellableAgencies.entries()) {
  const metric = index % 2 === 0 ? 'NIGHTS' : 'REVENUE';
  const mode = index % 3 === 1 ? 'EXCESS' : 'WHOLE';
  const factor = TARGET_FACTORS[index % TARGET_FACTORS.length];
  const probe = (startDate, endDate) =>
    asActor(() =>
      bonusRules.previewRule(hotelId, {
        agencyId: agency.id,
        startDate: midnight(startDate),
        endDate: midnight(endDate),
        metric,
        mode,
        target: '1',
        tiers: [{ threshold: '1', ratePct: '1' }],
        roomTypeIds: [],
        maxBonus: null,
      }),
    );
  const create = async (name, startDate, endDate, production, extra = {}) => {
    const draft = await asActor(() =>
      bonusRules.createRule(hotelId, {
        agencyId: agency.id,
        name,
        startDate: midnight(startDate),
        endDate: midnight(endDate),
        metric,
        mode,
        ...demoTerms(metric, production, factor),
        roomTypeIds: [],
        maxBonus: null,
        notes: 'Demo: sezon sonu hedef primi (sözleşme ek protokolü).',
        ...extra,
      }),
    );
    return asActor(() => bonusRules.activateRule(hotelId, draft.id, { expectedUpdatedAt: new Date(draft.updatedAt) }));
  };

  // Geçen sezon: dönem bitti → hak ediş hesaplanır, durum acenteye göre ilerletilir.
  const past = await probe(pastStart, pastEnd);
  if (past.realized.nights > 0) {
    const rule = await create(`Geçen sezon ${pastStart.slice(0, 4)} hedef primi`, pastStart, pastEnd, past.realized, index === 0 ? { maxBonus: '250000' } : {});
    let bonus = await asActor(() => bonusSettlement.calculateBonus(hotelId, rule.id));
    const outcome = PAST_OUTCOMES[index % PAST_OUTCOMES.length];
    if (outcome !== 'DRAFT') {
      bonus = await asActor(() => bonusSettlement.submitBonus(hotelId, bonus.id, { expectedUpdatedAt: new Date(bonus.updatedAt), note: 'Sezon kapanışı' }));
      if (bonus.status === 'PENDING_APPROVAL' && outcome === 'REJECTED') {
        await asUser(DEMO_APPROVER, () => approvalsService.decideApproval(hotelId, bonus.approvalId, 'DENIED', { note: 'Gelmeyen misafirler acenteyle mutabakat bekliyor' }));
      } else if (bonus.status === 'PENDING_APPROVAL' && outcome !== 'PENDING') {
        await asUser(DEMO_APPROVER, () => approvalsService.decideApproval(hotelId, bonus.approvalId, 'GRANTED', { note: 'Uygun' }));
        bonus = await asActor(() => bonusSettlement.getBonus(hotelId, bonus.id));
        if (outcome === 'PAID' && bonus.status === 'APPROVED' && Number(bonus.amount) > 0) {
          await asUser(DEMO_ACCOUNTANT, () =>
            bonusSettlement.markBonusPaid(hotelId, bonus.id, { expectedUpdatedAt: new Date(bonus.updatedAt), paidAt: midnight(today), paymentRef: `HVL-${index + 1}0${today.slice(5, 7)}`, note: 'Havale' }),
          );
        }
      }
    }
    bonusCount += 1;
  }

  // Bu sezon: sürüyor; hedef, şimdiye kadarki tempoyla dönem sonuna varılacak üretimden.
  const season = await probe(seasonStart, seasonEnd);
  const elapsed = Math.max(1, Math.round((midnight(today) - midnight(seasonStart)) / dayMs));
  const total = Math.round((midnight(seasonEnd) - midnight(seasonStart)) / dayMs) + 1;
  const pace = total / elapsed;
  await create(`Bu sezon ${seasonStart.slice(0, 4)}–${seasonEnd.slice(0, 4)} hedef primi`, seasonStart, seasonEnd, {
    nights: Math.max(1, Math.round(season.realized.nights * pace)),
    revenue: String(Math.max(1, Number(season.realized.revenue) * pace)),
  });
}
// Gelecek sezon: taslak (yürürlüğe alınmamış) örnek.
if (sellableAgencies.length) {
  await asActor(() =>
    bonusRules.createRule(hotelId, {
      agencyId: sellableAgencies[0].id,
      name: 'Gelecek sezon hedef primi (taslak)',
      startDate: midnight(addDays(today, 150)),
      endDate: midnight(addDays(today, 330)),
      metric: 'REVENUE',
      mode: 'EXCESS',
      target: '3000000',
      tiers: [
        { threshold: '2000000', ratePct: '1' },
        { threshold: '3000000', ratePct: '2.5' },
      ],
      roomTypeIds: [],
      maxBonus: null,
      notes: 'Görüşme sürüyor.',
    }),
  );
}
await asActor(() => bonusProgress.refreshProgress(hotelId, { announce: false }));

// ── Banket / etkinlik (modül 37): salonlar, ekipman, müşteriler, politika ve her durumda etkinlik ──
let banquetSummary = null;
try {
  banquetSummary = await seedBanquetDemo({ prisma, core, contracts, hotelId, today, actor: ACTOR, approver: DEMO_APPROVER, desk: DEMO_ACCOUNTANT, addDays });
} catch (error) {
  console.error(`Banket adımı tamamlanamadı: ${error.message}`);
}

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
    `(${lost.length} iptal / gelmeyen, ${reservations.filter((entry) => entry.row.agencyId).length + lost.filter((entry) => entry.agencyId).length} acenteli), ` +
    `${nights.length} gece, ${items.length} folyo kalemi, ${payments.length} ödeme, ${AGENCY_SEEDS.length} acente, ` +
    `${PROMOTION_SEEDS.length} promosyon (${reservations.filter((entry) => entry.row.promotionId).length} promosyonlu rezervasyon, ` +
    `${reservations.filter((entry) => entry.row.couponId).length} kuponlu), 1 kanal (${otaUpcoming.length} kanal rezervasyonu), ` +
    `${await prisma.agencyBonusRule.count({ where: { hotelId, createdBy: ACTOR } })} prim kuralı (${bonusCount} hak ediş)` +
    (banquetSummary
      ? `, ${banquetSummary.venues} salon, ${banquetSummary.events} etkinlik (${banquetSummary.documents} belge, ${banquetSummary.payments} ödeme).`
      : '.'),
);
await prisma.$disconnect();
