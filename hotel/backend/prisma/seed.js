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
      settings: { checkInTime: '14:00', checkOutTime: '12:00' },
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

  const roomTypeByCode = {};
  for (const rt of ROOM_TYPES) {
    const created = await prisma.roomType.upsert({
      where: { hotelId_code: { hotelId, code: rt.code } },
      update: {},
      create: { hotelId, ...rt },
    });
    roomTypeByCode[rt.code] = created;
  }

  const roomByNumber = {};
  for (const r of ROOMS) {
    const created = await prisma.room.upsert({
      where: { hotelId_number: { hotelId, number: r.number } },
      update: {},
      create: { hotelId, number: r.number, floor: r.floor, roomTypeId: roomTypeByCode[r.type].id },
    });
    roomByNumber[r.number] = created;
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

  const reservationPlans = [
    { code: 'DEMO-0001', guest: 0, type: 'STD', room: null, status: 'PENDING', inDay: 7, nights: 3 },
    { code: 'DEMO-0002', guest: 1, type: 'DLX', room: '201', status: 'CONFIRMED', inDay: 3, nights: 2 },
    { code: 'DEMO-0003', guest: 2, type: 'SUIT', room: '301', status: 'CHECKED_IN', inDay: -1, nights: 4 },
    { code: 'DEMO-0004', guest: 3, type: 'STD', room: '105', status: 'CHECKED_OUT', inDay: -6, nights: 3 },
    { code: 'DEMO-0005', guest: 4, type: 'DLX', room: null, status: 'CANCELLED', inDay: 10, nights: 5 },
  ];

  for (const p of reservationPlans) {
    const roomType = roomTypeByCode[p.type];
    const totalPrice = Number(roomType.basePrice) * p.nights;
    const reservation = await prisma.reservation.upsert({
      where: { confirmationCode: p.code },
      update: {},
      create: {
        hotelId,
        guestId: guests[p.guest].id,
        roomTypeId: roomType.id,
        roomId: p.room ? roomByNumber[p.room].id : null,
        checkIn: daysFromNow(p.inDay),
        checkOut: daysFromNow(p.inDay + p.nights),
        adults: 2,
        children: 0,
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
      if (p.room) {
        await prisma.room.update({
          where: { id: roomByNumber[p.room].id },
          data: { status: p.status === 'CHECKED_IN' ? 'OCCUPIED' : 'AVAILABLE' },
        });
      }
    }
  }

  console.log('Seed tamam: 1 otel, 2 kullanıcı, 3 oda tipi, 20 oda, 5 misafir, 5 rezervasyon, 2 folyo.');
}

main()
  .catch((error) => {
    console.error('Seed hatası:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
