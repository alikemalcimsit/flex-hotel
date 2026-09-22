import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { eachNight } from '@hotelos/core';
import { distributeTotal } from '../src/modules/reservations/rules.js';

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
        createdBy: 'seed',
        confirmedAt: p.status === 'PENDING' ? null : checkIn,
      },
    });

    // Gece gece fiyat (modül 4): gelir raporları ve rezervasyon detayı buradan okur.
    if ((await prisma.reservationNight.count({ where: { reservationId: reservation.id } })) === 0) {
      await prisma.reservationNight.createMany({
        data: distributeTotal(String(totalPrice), eachNight(checkIn, checkOut)).map((night) => ({
          hotelId,
          reservationId: reservation.id,
          date: new Date(`${night.date}T00:00:00.000Z`),
          amount: night.amount,
          baseRate: String(roomType.basePrice),
          multiplier: '1',
        })),
      });
    }

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

  const { conversations, requests } = await seedMessaging(hotelId, guests, roomByNumber);

  // Bildirim şablonları (modül 9): var olan (otelin düzenlediği) şablona dokunulmaz.
  // Kanal ayarı yazılmaz: SMTP / Netgsm bilgisi otelin kendi hesabıdır, panelden girilir.
  const { ensureDefaultTemplates } = await import('../src/modules/notifications/service.js');
  const templates = await ensureDefaultTemplates(hotelId, prisma);

  console.log(
    `Seed tamam: 1 otel, ${users.length} kullanıcı, ${ROOM_TYPES.length} oda tipi, ${ROOMS.length} oda, ` +
      `${GUESTS.length} misafir, ${reservationPlans.length} rezervasyon, ${conversations} konuşma, ${requests} istek, ` +
      `${templates} yeni bildirim şablonu.`,
  );
}

const MINUTE_MS = 60_000;

/** Şu andan `minutes` dakika önce. */
const minutesAgo = (minutes) => new Date(Date.now() - minutes * MINUTE_MS);

/**
 * Demo konuşmalar (modül 7).
 *
 * Kanal geçidi (modül 8) olmadığı için personelin giden mesajları dürüstçe
 * "gönderim bekliyor" durumundadır — gönderilmiş gibi yazılmaz. Sayaçlar
 * (okunmamış, cevap bekleme, son mesaj özeti) mesajlardan hesaplanır; servis
 * aynı kuralı uygular.
 */
const CONVERSATION_PLANS = [
  {
    channel: 'WHATSAPP',
    address: '905321110001',
    displayName: 'Ayşe',
    guest: 0,
    stay: 'DEMO-0006',
    messages: [
      { key: 'ayse-1', author: 'GUEST', text: 'Merhaba, odaya iki havlu daha alabilir miyiz?', at: 42 },
      {
        key: 'ayse-2',
        author: 'STAFF',
        actor: 'Resepsiyon',
        text: 'Merhaba Ayşe Hanım, kat görevlimiz 15 dakika içinde getirecek.',
        at: 38,
      },
      { key: 'ayse-3', author: 'NOTE', actor: 'Resepsiyon', text: 'Misafir ikinci kez havlu istedi, kat şefine iletildi.', at: 37 },
      { key: 'ayse-4', author: 'GUEST', text: 'Teşekkürler! Bir de klima gece biraz ses yapıyor.', at: 7 },
    ],
  },
  {
    channel: 'WHATSAPP',
    address: '905321110002',
    displayName: 'Mehmet K.',
    guest: 1,
    stay: 'DEMO-0007',
    messages: [{ key: 'mehmet-1', author: 'GUEST', text: 'Yarın sabah 06:30 için uyandırma rica ediyorum.', at: 18 }],
  },
  {
    channel: 'WEBCHAT',
    address: 'webchat-demo-oturum-1',
    displayName: 'Web sitesi ziyaretçisi',
    guest: null,
    stay: null,
    messages: [
      { key: 'web-1', author: 'GUEST', text: 'Ekim sonunda iki kişilik oda fiyatınız nedir? Kahvaltı dahil mi?', at: 95 },
      { key: 'web-2', author: 'STAFF', actor: 'Resepsiyon', text: 'Merhaba, giriş ve çıkış tarihlerinizi paylaşır mısınız?', at: 90 },
      { key: 'web-3', author: 'GUEST', text: '28-31 Ekim, iki yetişkin.', at: 74 },
    ],
  },
  {
    channel: 'WHATSAPP',
    address: '441234567890',
    displayName: 'John',
    guest: 2,
    stay: 'DEMO-0003',
    closed: true,
    messages: [
      { key: 'john-1', author: 'GUEST', text: 'Is a late checkout possible on my last day?', at: 300 },
      { key: 'john-2', author: 'STAFF', actor: 'Resepsiyon', text: 'Yes, you can stay until 14:00 at no extra charge.', at: 290 },
    ],
  },
];

/**
 * Demo istekler (modül 7). Zamanlar göreli: bir kısmı gecikmiş görünür.
 * Konuşmaya bağlı isteklerde `room` yalnızca yedek; oda konaklamadan gelir.
 */
const REQUEST_PLANS = [
  {
    title: '2 ek havlu',
    category: 'AMENITY',
    room: '101',
    conversation: '905321110001',
    message: 'ayse-1',
    status: 'IN_PROGRESS',
    createdMinutesAgo: 38,
    assignee: 'resepsiyon@hotel.local',
  },
  {
    title: 'Klima gece ses yapıyor',
    category: 'MAINTENANCE',
    room: '101',
    conversation: '905321110001',
    message: 'ayse-4',
    status: 'OPEN',
    createdMinutesAgo: 5,
  },
  {
    title: 'Uyandırma',
    category: 'WAKE_UP',
    room: '103',
    conversation: '905321110002',
    message: 'mehmet-1',
    status: 'OPEN',
    createdMinutesAgo: 16,
    wakeUpTomorrowAt: { hour: 6, minute: 30 },
  },
  {
    title: 'Ekstra oda temizliği',
    category: 'HOUSEKEEPING',
    room: '202',
    status: 'OPEN',
    source: 'PHONE',
    createdMinutesAgo: 95,
  },
  {
    title: 'Koridorda gürültü şikâyeti',
    category: 'COMPLAINT',
    room: '203',
    status: 'OPEN',
    source: 'PHONE',
    createdMinutesAgo: 4,
    description: 'Yan odadan gece yarısı yüksek ses geldiği bildirildi.',
  },
  {
    title: 'Oda servisi menüsü',
    category: 'ROOM_SERVICE',
    room: '301',
    status: 'DONE',
    source: 'FRONT_DESK',
    createdMinutesAgo: 180,
    completedMinutesAgo: 160,
    resolutionNote: 'Menü odaya bırakıldı.',
  },
];

/**
 * Otelin saat dilimine göre "yarın HH:MM" anı.
 * @param {string} timeZone
 * @param {{ hour: number, minute: number }} time
 * @param {(wallTime: string, timeZone: string) => Date | null} toUtc
 */
function tomorrowAtInTimeZone(timeZone, { hour, minute }, toUtc) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
  const [year, month, day] = today.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  const pad = (value) => String(value).padStart(2, '0');
  return toUtc(`${tomorrow}T${pad(hour)}:${pad(minute)}`, timeZone);
}

async function seedMessaging(hotelId, guests, roomByNumber) {
  const { guestRequestDueAt, defaultGuestRequestPriority, zonedWallTimeToUtc } = await import('@hotelos/hotel-contracts');
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId }, select: { timezone: true } });
  const conversationByAddress = {};
  const messageByKey = {};

  for (const plan of CONVERSATION_PLANS) {
    const stay = plan.stay
      ? await prisma.reservation.findFirst({ where: { confirmationCode: plan.stay }, select: { id: true } })
      : null;
    const existing = await prisma.conversation.findFirst({
      where: { hotelId, channel: plan.channel, externalId: plan.address },
    });
    const conversation =
      existing ??
      (await prisma.conversation.create({
        data: {
          hotelId,
          channel: plan.channel,
          externalId: plan.address,
          displayName: plan.displayName,
          guestId: plan.guest === null ? null : guests[plan.guest].id,
          reservationId: stay?.id ?? null,
          mode: 'MANUAL',
        },
      }));
    conversationByAddress[plan.address] = conversation;

    for (const entry of plan.messages) {
      const externalId = `demo:${entry.key}`;
      const found = await prisma.message.findFirst({ where: { conversationId: conversation.id, meta: { path: ['demoKey'], equals: entry.key } } });
      if (found) {
        messageByKey[entry.key] = found;
        continue;
      }
      // Var olan konuşmanın geçmişine sonradan mesaj eklenmez (özet bozulurdu).
      if (existing) continue;
      const inbound = entry.author === 'GUEST';
      const note = entry.author === 'NOTE';
      messageByKey[entry.key] = await prisma.message.create({
        data: {
          hotelId,
          conversationId: conversation.id,
          direction: inbound ? 'IN' : 'OUT',
          author: inbound ? 'GUEST' : 'STAFF',
          text: entry.text,
          actorName: inbound ? plan.displayName : entry.actor,
          internal: note,
          // Kanal yok: giden cevap gönderilmeyi bekliyor; iç not kanala gitmez.
          delivery: inbound ? 'RECEIVED' : note ? 'SENT' : 'PENDING',
          externalId: inbound ? externalId : null,
          createdAt: minutesAgo(entry.at),
          meta: { demoKey: entry.key },
        },
      });
    }

    // Var olan konuşmaya dokunulmaz: seed tekrar çalıştığında personelin
    // gerçek işlemleri (cevap, kapatma, okundu) ezilmesin.
    if (existing) continue;

    // Sayaçlar kaydedilen mesajlardan: son görünür mesaj, son cevaptan sonraki misafir mesajları.
    const visible = plan.messages.filter((entry) => entry.author !== 'NOTE');
    const last = visible.at(-1);
    const lastAt = messageByKey[last.key].createdAt;
    const lastReplyIndex = visible.map((entry) => entry.author).lastIndexOf('STAFF');
    const waiting = visible.slice(lastReplyIndex + 1).filter((entry) => entry.author === 'GUEST');
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: lastAt,
        lastMessagePreview: last.text.slice(0, 160),
        lastMessageAuthor: last.author === 'GUEST' ? 'GUEST' : 'STAFF',
        unreadCount: plan.closed ? 0 : waiting.length,
        awaitingReplySince:
          plan.closed || waiting.length === 0 ? null : messageByKey[waiting[0].key].createdAt,
        status: plan.closed ? 'CLOSED' : 'OPEN',
        closedAt: plan.closed ? new Date(lastAt.getTime() + 5 * MINUTE_MS) : null,
        closedBy: plan.closed ? 'resepsiyon@hotel.local' : null,
      },
    });
  }

  let requests = 0;
  for (const plan of REQUEST_PLANS) {
    const conversation = plan.conversation ? conversationByAddress[plan.conversation] : null;
    const existing = await prisma.guestRequest.findFirst({ where: { hotelId, title: plan.title } });
    if (existing) {
      requests += 1;
      continue;
    }
    // Konuşmadan açılan istek konuşmanın konaklamasına ve o konaklamanın
    // bugünkü odasına bağlanır (servis de böyle yapar); diğerleri odadaki
    // içerideki misafire.
    const stay = conversation?.reservationId
      ? await prisma.reservation.findFirst({
          where: { id: conversation.reservationId },
          select: { id: true, guestId: true, roomId: true },
        })
      : await prisma.reservation.findFirst({
          where: { hotelId, roomId: roomByNumber[plan.room].id, status: 'CHECKED_IN' },
          select: { id: true, guestId: true, roomId: true },
        });
    const roomId = stay?.roomId ?? roomByNumber[plan.room].id;
    const assignee = plan.assignee
      ? await prisma.user.findFirst({ where: { email: plan.assignee }, select: { id: true } })
      : null;
    const createdAt = minutesAgo(plan.createdMinutesAgo);
    const priority = defaultGuestRequestPriority(plan.category);
    const scheduledFor = plan.wakeUpTomorrowAt
      ? tomorrowAtInTimeZone(hotel.timezone, plan.wakeUpTomorrowAt, zonedWallTimeToUtc)
      : null;

    await prisma.guestRequest.create({
      data: {
        hotelId,
        category: plan.category,
        title: plan.title,
        description: plan.description ?? null,
        priority,
        status: plan.status,
        source: conversation ? 'CONVERSATION' : plan.source,
        dueAt: guestRequestDueAt({ priority, createdAt, scheduledFor }),
        scheduledFor,
        roomId,
        reservationId: stay?.id ?? null,
        guestId: stay?.guestId ?? conversation?.guestId ?? null,
        conversationId: conversation?.id ?? null,
        messageId: plan.message ? messageByKey[plan.message]?.id ?? null : null,
        assignedToId: assignee?.id ?? null,
        createdBy: 'seed',
        createdAt,
        startedAt: plan.status === 'IN_PROGRESS' ? minutesAgo(plan.createdMinutesAgo - 3) : null,
        completedAt: plan.completedMinutesAgo ? minutesAgo(plan.completedMinutesAgo) : null,
        completedBy: plan.completedMinutesAgo ? 'resepsiyon@hotel.local' : null,
        resolutionNote: plan.resolutionNote ?? null,
      },
    });
    requests += 1;
  }

  return { conversations: CONVERSATION_PLANS.length, requests };
}

main()
  .catch((error) => {
    console.error('Seed hatası:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
