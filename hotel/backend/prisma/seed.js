import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ROOM_TYPES = [
  { code: 'STD', name: 'Standart Oda', capacityAdults: 2, capacityChildren: 1, basePrice: 2500 },
  { code: 'DLX', name: 'Deluxe Oda', capacityAdults: 3, capacityChildren: 1, basePrice: 3500 },
  { code: 'SUIT', name: 'Suit', capacityAdults: 4, capacityChildren: 2, basePrice: 6000 },
];

const ROOMS = [
  ...Array.from({ length: 10 }, (_, i) => ({ number: String(101 + i), floor: 1, type: 'STD' })),
  ...Array.from({ length: 7 }, (_, i) => ({ number: String(201 + i), floor: 2, type: 'DLX' })),
  ...Array.from({ length: 3 }, (_, i) => ({ number: String(301 + i), floor: 3, type: 'SUIT' })),
];

const GUESTS = [
  { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905321110001', email: 'ayse@example.com', nationality: 'TR' },
  { firstName: 'Mehmet', lastName: 'Kaya', phone: '+905321110002', email: 'mehmet@example.com', nationality: 'TR' },
  { firstName: 'John', lastName: 'Smith', phone: '+441234567890', email: 'john@example.com', nationality: 'GB' },
  { firstName: 'Elif', lastName: 'Demir', phone: '+905321110004', email: 'elif@example.com', nationality: 'TR' },
  { firstName: 'Hans', lastName: 'Müller', phone: '+491701234567', email: 'hans@example.com', nationality: 'DE' },
];

/** Bugünden n gün sonrasını (saat 14:00) döner. */
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(14, 0, 0, 0);
  return d;
}

async function main() {
  console.log('Seed başlıyor...');

  const hotel = await prisma.hotel.upsert({
    where: { code: 'DEMO' },
    update: {},
    create: {
      name: 'Demo Otel',
      code: 'DEMO',
      timezone: 'Europe/Istanbul',
      currency: 'TRY',
      address: 'Demo Cad. No:1, Antalya',
      phone: '+902420000000',
      email: 'info@demootel.local',
      // Modül 1'den itibaren bu parametreler tipli kolonlarda tutuluyor;
      // `settings` JSON'u yalnızca henüz modellenmemiş serbest ayarlar için.
      checkInTime: '14:00',
      checkOutTime: '12:00',
      defaultBoardType: 'BB',
      cancellationPolicyDays: 3,
      cancellationPolicyPenaltyPct: 50,
    },
  });
  const hotelId = hotel.id;

  const users = [
    { email: 'admin@hotel.local', password: 'admin123', name: 'Admin', role: 'ADMIN' },
    { email: 'resepsiyon@hotel.local', password: '123456', name: 'Resepsiyon', role: 'FRONT_DESK' },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { hotelId, email: u.email, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 10) },
    });
  }

  // RoomType ve Room'da benzersizlik kısmi (partial) unique index ile tanımlı —
  // silinen bir kodun tekrar kullanılabilmesi için. Prisma kısmi index'i bileşik
  // anahtar olarak göremediğinden `upsert` yerine findFirst + create kullanılıyor.
  const roomTypeByCode = {};
  for (const rt of ROOM_TYPES) {
    const existing = await prisma.roomType.findFirst({ where: { hotelId, code: rt.code, deletedAt: null } });
    roomTypeByCode[rt.code] = existing ?? (await prisma.roomType.create({ data: { hotelId, ...rt } }));
  }

  const roomByNumber = {};
  for (const r of ROOMS) {
    const existing = await prisma.room.findFirst({ where: { hotelId, number: r.number, deletedAt: null } });
    roomByNumber[r.number] =
      existing ??
      (await prisma.room.create({
        data: { hotelId, number: r.number, floor: r.floor, roomTypeId: roomTypeByCode[r.type].id },
      }));
  }

  const seasonCount = await prisma.season.count({ where: { hotelId } });
  if (seasonCount === 0) {
    const year = new Date().getFullYear();
    await prisma.season.create({
      data: { hotelId, name: 'Yaz', startDate: new Date(`${year}-06-01`), endDate: new Date(`${year}-09-15`), multiplier: 1.3 },
    });
  }

  const taxCount = await prisma.tax.count({ where: { hotelId } });
  if (taxCount === 0) {
    await prisma.tax.create({ data: { hotelId, name: 'KDV', rate: 10, isIncluded: true, appliesTo: ['ROOM', 'FNB'] } });
  }

  const guests = [];
  for (const g of GUESTS) {
    const existing = await prisma.guest.findFirst({ where: { hotelId, email: g.email } });
    guests.push(existing ?? (await prisma.guest.create({ data: { hotelId, ...g } })));
  }

  /**
   * Demo konaklamalar.
   *
   * Oda planı (modül 5) ekranının anlamlı görünmesi için otelin her katından,
   * her durumdan ve pencerenin her yerinden kayıt var: içeride kalanlar,
   * bugün girecekler, bugün çıkacaklar, oda bekleyenler, ileri tarihli grup.
   */
  const reservationPlans = [
    { code: 'DEMO-0001', guest: 0, type: 'STD', room: null, status: 'PENDING', inDay: 7, nights: 3 },
    { code: 'DEMO-0002', guest: 1, type: 'DLX', room: '201', status: 'CONFIRMED', inDay: 3, nights: 2 },
    { code: 'DEMO-0003', guest: 2, type: 'SUIT', room: '301', status: 'CHECKED_IN', inDay: -1, nights: 4 },
    { code: 'DEMO-0004', guest: 3, type: 'STD', room: '105', status: 'CHECKED_OUT', inDay: -6, nights: 3 },
    { code: 'DEMO-0005', guest: 4, type: 'DLX', room: null, status: 'CANCELLED', inDay: 10, nights: 5 },

    // İçeride kalanlar (bugünün ızgarasını dolduran barlar)
    { code: 'DEMO-0006', guest: 0, type: 'STD', room: '101', status: 'CHECKED_IN', inDay: -2, nights: 5, adults: 2 },
    { code: 'DEMO-0007', guest: 1, type: 'STD', room: '103', status: 'CHECKED_IN', inDay: -1, nights: 3, adults: 1 },
    { code: 'DEMO-0008', guest: 2, type: 'DLX', room: '202', status: 'CHECKED_IN', inDay: -3, nights: 6, adults: 2, children: 1 },
    // Bugün çıkacak: çıkış günü ızgarada boyanmaz, sütun serbest görünür.
    { code: 'DEMO-0009', guest: 3, type: 'DLX', room: '203', status: 'CHECKED_IN', inDay: -2, nights: 2, adults: 2 },

    // Bugün ve yarın girecekler
    { code: 'DEMO-0010', guest: 4, type: 'STD', room: '106', status: 'CONFIRMED', inDay: 0, nights: 2, adults: 2 },
    { code: 'DEMO-0011', guest: 0, type: 'STD', room: '107', status: 'CONFIRMED', inDay: 1, nights: 4, adults: 2, children: 1 },
    { code: 'DEMO-0012', guest: 1, type: 'SUIT', room: '302', status: 'CONFIRMED', inDay: 1, nights: 3, adults: 3 },

    // Oda bekleyenler (ızgaranın üstündeki şerit)
    { code: 'DEMO-0013', guest: 2, type: 'STD', room: null, status: 'CONFIRMED', inDay: 0, nights: 1, adults: 1 },
    { code: 'DEMO-0014', guest: 3, type: 'DLX', room: null, status: 'CONFIRMED', inDay: 2, nights: 3, adults: 2 },
    { code: 'DEMO-0015', guest: 4, type: 'STD', room: null, status: 'PENDING', inDay: 4, nights: 2, adults: 2 },

    // İleri tarihli hareket
    { code: 'DEMO-0016', guest: 0, type: 'STD', room: '108', status: 'CONFIRMED', inDay: 5, nights: 3, adults: 2 },
    { code: 'DEMO-0017', guest: 1, type: 'STD', room: '109', status: 'CONFIRMED', inDay: 6, nights: 4, adults: 2 },
    { code: 'DEMO-0018', guest: 2, type: 'DLX', room: '204', status: 'CONFIRMED', inDay: 8, nights: 2, adults: 2 },
    { code: 'DEMO-0019', guest: 3, type: 'STD', room: '110', status: 'CONFIRMED', inDay: 9, nights: 5, adults: 2 },
    { code: 'DEMO-0020', guest: 4, type: 'SUIT', room: '303', status: 'CONFIRMED', inDay: 11, nights: 3, adults: 4, children: 2 },
  ];

  /**
   * Oda gerçekten boş mu?
   *
   * Seed tekrar tekrar çalıştırılabilir olmalı ve üzerinde çalışılan bir
   * veritabanında oda elle arızaya alınmış ya da başka bir konaklamaya
   * verilmiş olabilir. Böyle bir durumda kayıt **oda bekleyen** olarak
   * açılır: veritabanı kısıtına çarpıp seed'i yarıda kesmek yerine gerçekçi
   * bir duruma düşer.
   */
  async function resolveRoomId(number, checkIn, checkOut) {
    if (!number) return null;
    const room = roomByNumber[number];
    if (!room) return null;

    const [conflictingReservation, conflictingBlock] = await Promise.all([
      prisma.reservation.findFirst({
        where: {
          roomId: room.id,
          status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
          checkIn: { lt: checkOut },
          checkOut: { gt: checkIn },
        },
        select: { id: true },
      }),
      prisma.roomBlock.findFirst({
        where: {
          roomId: room.id,
          startDate: { lt: checkOut },
          OR: [{ endDate: null }, { endDate: { gt: checkIn } }],
        },
        select: { id: true },
      }),
    ]);

    if (conflictingReservation || conflictingBlock) {
      console.log(`  ${number} numaralı oda bu tarihlerde dolu/arızalı; kayıt oda bekleyen olarak açıldı.`);
      return null;
    }
    return room.id;
  }

  for (const p of reservationPlans) {
    const roomType = roomTypeByCode[p.type];
    const nights = p.nights;
    const totalPrice = Number(roomType.basePrice) * nights;
    const checkIn = daysFromNow(p.inDay);
    const checkOut = daysFromNow(p.inDay + nights);
    const existing = await prisma.reservation.findFirst({
      where: { confirmationCode: p.code },
      select: { id: true },
    });
    const roomId = existing ? undefined : await resolveRoomId(p.room, checkIn, checkOut);

    const reservation = await prisma.reservation.upsert({
      where: { confirmationCode: p.code },
      update: {},
      create: {
        hotelId,
        guestId: guests[p.guest].id,
        roomTypeId: roomType.id,
        roomId,
        checkIn,
        checkOut,
        adults: p.adults ?? 2,
        children: p.children ?? 0,
        status: p.status,
        source: 'UI',
        totalPrice,
        boardType: 'BB',
        confirmationCode: p.code,
      },
    });

    if (p.status === 'CHECKED_IN' || p.status === 'CHECKED_OUT') {
      const hasFolio = await prisma.folio.findFirst({ where: { reservationId: reservation.id } });
      if (!hasFolio) {
        const isClosed = p.status === 'CHECKED_OUT';
        await prisma.folio.create({
          data: {
            hotelId,
            reservationId: reservation.id,
            guestId: guests[p.guest].id,
            status: isClosed ? 'CLOSED' : 'OPEN',
            balance: isClosed ? 0 : totalPrice + 450,
            closedAt: isClosed ? daysFromNow(p.inDay + p.nights) : null,
            items: {
              create: [
                { hotelId, type: 'ROOM', description: `Oda ücreti (${p.nights} gece)`, amount: totalPrice, quantity: 1, postedBy: 'seed' },
                { hotelId, type: 'MINIBAR', description: 'Minibar', amount: 250, quantity: 1, postedBy: 'seed' },
                { hotelId, type: 'FNB', description: 'Restoran', amount: 200, quantity: 1, postedBy: 'seed' },
              ],
            },
          },
        });
      }
      // Oda durumu rezervasyonun **gerçek** odasına yazılır: çakışma yüzünden
      // oda verilememişse ortada dolu bir oda da yok.
      if (reservation.roomId) {
        await prisma.room.update({
          where: { id: reservation.roomId },
          data:
            p.status === 'CHECKED_IN'
              ? { occupancy: 'OCCUPIED' }
              : { occupancy: 'VACANT', housekeepingStatus: 'CLEAN' },
        });
      }
    }
  }

  console.log(
    `Seed tamam: 1 otel, ${users.length} kullanıcı, ${ROOM_TYPES.length} oda tipi, ${ROOMS.length} oda, ` +
      `${GUESTS.length} misafir, ${reservationPlans.length} rezervasyon.`,
  );
}

main()
  .catch((error) => {
    console.error('Seed hatası:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
