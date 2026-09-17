import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Büyük veri üzerinde sıcak uçların süresini ölçer (ölçüm aracı, üretimde çalışmaz).
 *
 * Kullanım (yalnızca ölçüm veritabanında):
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-scenarios.mjs
 *
 * Her senaryo birkaç kez çalıştırılır; ilk tur ısınmadır, raporda en iyi ve
 * ortanca süre görünür. Önbellekli uçlar önbellek temizlenerek ölçülür
 * (soğuk hesap), yoksa ölçülen şey önbellek olurdu.
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 4);

const core = await import('@hotelos/core');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const messaging = await import('../src/modules/messaging/service.js');
const requests = await import('../src/modules/guest-requests/service.js');
const rooms = await import('../src/modules/rooms/service.js');
const plan = await import('../src/modules/plan/service.js');
const notifications = await import('../src/modules/notifications/service.js');
const alerts = await import('../src/modules/notifications/staff-alerts.js');
const dispatcher = await import('../src/modules/notifications/dispatcher.js');
const { bumpLiveVersion, LIVE_SCOPES } = await import('../src/lib/live-version.js');

const hotelId = await resolveHotelId();
const as = (actor, fn) => core.runWithContext({ correlationId: randomUUID(), actor }, fn);

/** Önbellekli okumaları soğuk ölçmek için sürümleri her turda artır. */
const bumpAll = () => {
  for (const scope of Object.values(LIVE_SCOPES)) bumpLiveVersion(scope, hotelId);
};

const results = [];

async function scenario(name, fn) {
  const times = [];
  let error = null;
  for (let round = 0; round < ROUNDS; round += 1) {
    bumpAll();
    const started = performance.now();
    try {
      await fn();
    } catch (caught) {
      error = caught;
      break;
    }
    times.push(performance.now() - started);
  }
  const measured = times.slice(1).sort((a, b) => a - b);
  results.push({
    senaryo: name,
    en_iyi_ms: measured.length ? Math.round(measured[0]) : null,
    ortanca_ms: measured.length ? Math.round(measured[Math.floor(measured.length / 2)]) : null,
    hata: error ? String(error.message ?? error).slice(0, 80) : '',
  });
}

const unassigned = await prisma.reservation.findFirst({ where: { hotelId, roomId: null }, select: { id: true } });
const inHouseRoom = await prisma.reservation.findFirst({
  where: { hotelId, status: 'CHECKED_IN' },
  select: { roomId: true },
});
const someNotification = await prisma.notification.findFirst({
  where: { hotelId, status: 'SENT' },
  orderBy: { createdAt: 'asc' },
  select: { id: true },
});
const knownGuest = await prisma.guest.findFirst({ where: { hotelId }, orderBy: { firstName: 'desc' }, select: { phone: true, email: true } });
const conversation = await prisma.conversation.findFirst({ where: { hotelId, status: 'OPEN' }, select: { id: true } });

// ── Gelen kutusu ──
await scenario('inbox ilk sayfa', () => messaging.listConversations(hotelId, { view: 'OPEN', limit: 30 }));
await scenario('inbox tüm konuşmalar ilk sayfa', () => messaging.listConversations(hotelId, { view: 'ALL', limit: 30 }));
{
  let cursor = null;
  const first = await messaging.listConversations(hotelId, { view: 'ALL', limit: 100 });
  cursor = first.nextCursor;
  for (let i = 0; i < 300 && cursor; i += 1) {
    const page = await messaging.listConversations(hotelId, { view: 'ALL', limit: 100, cursor });
    cursor = page.nextCursor;
  }
  await scenario('inbox derin imleç (~30k)', () => messaging.listConversations(hotelId, { view: 'ALL', limit: 30, cursor }));
}
await scenario('inbox arama', () => messaging.listConversations(hotelId, { view: 'ALL', limit: 30, search: 'Misafir 7777' }));
await scenario('inbox özeti (personel)', () => as('personel10@perf.local', () => messaging.getInboxSummary(hotelId)));
await scenario('gelen mesaj (telefonla eşleşen)', () =>
  messaging.receiveInboundMessage(hotelId, {
    channel: 'WHATSAPP',
    externalId: `90${knownGuest.phone.slice(1)}`,
    externalMessageId: randomUUID(),
    text: 'Merhaba',
  }),
);
await scenario('gelen e-posta (e-postayla eşleşen)', () =>
  messaging.receiveInboundMessage(hotelId, {
    channel: 'EMAIL',
    externalId: knownGuest.email.toUpperCase(),
    externalMessageId: randomUUID(),
    text: 'Merhaba',
  }),
);
await scenario('personel cevabı (tekrar kontrolüyle)', () =>
  as('personel10@perf.local', () =>
    messaging.sendStaffMessage(hotelId, conversation.id, { text: 'Tamam', internal: false, clientMessageId: randomUUID() }),
  ),
);

// ── İstekler ──
await scenario('istekler açık', () => requests.listRequests(hotelId, { view: 'ACTIVE', page: 1, pageSize: 20 }));
await scenario('istekler tamamlanan s1', () => requests.listRequests(hotelId, { view: 'DONE', page: 1, pageSize: 20 }));
await scenario('istekler tamamlanan s500', () => requests.listRequests(hotelId, { view: 'DONE', page: 500, pageSize: 20 }));
await scenario('istekler tümü + arama', () => requests.listRequests(hotelId, { view: 'ALL', page: 1, pageSize: 20, search: 'İstek 99999' }));
await scenario('istek özeti', () => as('personel10@perf.local', () => requests.getRequestSummary(hotelId)));
await scenario('atanabilir personel', () => requests.listAssignees(hotelId));
await scenario('oda bağlamı', () => requests.getRoomContext(hotelId, inHouseRoom.roomId));

// ── Odalar / plan ──
await scenario('oda listesi s1', () => rooms.listRooms(hotelId, { page: 1, pageSize: 25 }));
await scenario('oda planı 14 gün', () =>
  plan.getRoomPlan(hotelId, { from: new Date('2026-09-17'), days: 14, page: 1, pageSize: 40 }),
);
await scenario('oda planı arama', () =>
  plan.getRoomPlan(hotelId, { from: new Date('2026-09-17'), days: 14, page: 1, pageSize: 40, search: 'Ad123' }),
);
await scenario('müsaitlik 90 gün', () =>
  rooms.getAvailabilityCalendar(hotelId, { from: new Date('2026-09-17'), to: new Date('2026-12-16') }),
);
await scenario('atanabilir odalar', () => rooms.getAssignableRooms(hotelId, unassigned.id, { page: 1, pageSize: 25 }));
await scenario('oda bekleyenler', () => rooms.listUnassignedReservations(hotelId, { page: 1, pageSize: 25 }));

// ── Bildirimler ──
await scenario('bildirim geçmişi s1', () => notifications.listNotifications(hotelId, { limit: 30 }));
{
  let cursor = null;
  for (let i = 0; i < 100; i += 1) {
    const page = await notifications.listNotifications(hotelId, { limit: 100, cursor: cursor ?? undefined });
    cursor = page.nextCursor;
  }
  await scenario('bildirim derin imleç (~10k)', () => notifications.listNotifications(hotelId, { limit: 30, cursor }));
}
await scenario('bildirim arama', () => notifications.listNotifications(hotelId, { limit: 30, search: 'misafir77777' }));
await scenario('bildirim özeti', () => notifications.getNotificationSummary(hotelId));
await scenario('bildirim detayı', () => notifications.getNotification(hotelId, someNotification.id));
await scenario('teslim raporu taraması (ağsız)', () => dispatcher.pollDeliveryReports(undefined));

// ── Zil ──
await scenario('zil özeti (yönetici)', () => as('admin@hotel.local', () => alerts.getStaffAlertSummary(hotelId)));
await scenario('zil özeti (resepsiyon)', () => as('personel10@perf.local', () => alerts.getStaffAlertSummary(hotelId)));
await scenario('zil özeti (kat)', () => as('personel11@perf.local', () => alerts.getStaffAlertSummary(hotelId)));
await scenario('zil listesi (yönetici)', () => as('admin@hotel.local', () => alerts.listStaffAlerts(hotelId, { limit: 20 })));
await scenario('zil listesi (kat)', () => as('personel11@perf.local', () => alerts.listStaffAlerts(hotelId, { limit: 20 })));

console.table(results);
await prisma.$disconnect();
