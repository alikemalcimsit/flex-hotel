import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Misafir portalı ve online check-in'in büyük veride süresi (modül 53; ölçüm aracı, üretimde çalışmaz).
 *
 *   DATABASE_URL=postgresql://.../hotelos_perf node scripts/perf-guest-portal.mjs
 *
 * Ölçüm otelinin rezervasyonlarından en fazla 30.000'ine bağlantı, %60'ına online check-in (inceleme bekleyen,
 * onaylı, düzeltme istenmiş, tamamlanmış) ve yetişkin başına belge satırı her çalıştırmada baştan kurulur (dosyalar
 * yalnız ölçülen gönderim için yazılır). Ölçülen: personel listesi (gelecek girişler, tümü, durum, arama, derin sayfa),
 * ayrıntı ve giriş penceresinin ön dolumu, misafir uçları (ana sayfa, form, folyo), fotoğraf yükleme + gönderim,
 * davet turu (otel başına 100) ve silme turu (200 belge).
 */

const url = process.env.DATABASE_URL ?? '';
if (!/hotelos_perf/.test(url)) {
  console.error('Bu betik yalnızca hotelos_perf veritabanında çalışır.');
  process.exit(1);
}

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 3);
const ACTOR = 'perf-portal@hotel.local';
const MAX_LINKS = 30_000;
const CHUNK = 2_000;

const core = await import('@hotelos/core');
const { prisma } = await import('../src/db.js');
const { resolveHotelId } = await import('../src/lib/tenant.js');
const service = await import('../src/modules/guest-portal/service.js');
const guest = await import('../src/modules/guest-portal/public.js');
const documents = await import('../src/modules/guest-portal/documents.js');
const invites = await import('../src/modules/guest-portal/invites.js');
const { portalToken } = await import('../src/modules/guest-portal/links.js');

const hotelId = await resolveHotelId();
const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: ACTOR }, fn);
let seed = 53_2500;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];

async function measure(name, fn, rounds = ROUNDS) {
  const times = [];
  let result;
  for (let round = 0; round < rounds; round += 1) {
    const at = performance.now();
    result = await fn();
    times.push(performance.now() - at);
  }
  times.sort((a, b) => a - b);
  console.log(`${name.padEnd(58)} medyan ${String(Math.round(times[Math.floor(times.length / 2)])).padStart(6)} ms   en kötü ${String(Math.round(times.at(-1))).padStart(6)} ms`);
  return result;
}

/* ══════════════════ Kurulum ══════════════════ */

const started = performance.now();
console.log('Kurulum: önceki portal verisi siliniyor…');
await prisma.onlineCheckinDocument.deleteMany({ where: { hotelId } });
await prisma.onlineCheckin.deleteMany({ where: { hotelId } });
await prisma.guestPortalLink.deleteMany({ where: { hotelId } });
await prisma.guestPortalSettings.upsert({
  where: { hotelId },
  create: { hotelId, enabled: true, inviteDaysBefore: 3, checkinOpenDays: 30, documentRetentionDays: 7, publicBaseUrl: 'https://perf.example.com', updatedBy: ACTOR },
  update: { enabled: true, inviteDaysBefore: 3, checkinOpenDays: 30, publicBaseUrl: 'https://perf.example.com' },
});
const reservations = await prisma.reservation.findMany({
  where: { hotelId, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] } },
  orderBy: [{ checkIn: 'desc' }, { id: 'asc' }],
  take: MAX_LINKS,
  select: { id: true, confirmationCode: true, status: true, adults: true, children: true, checkIn: true, guest: { select: { firstName: true, lastName: true } } },
});
const now = new Date();
const links = reservations.map((row) => ({ id: randomUUID(), hotelId, reservationId: row.id, nonce: randomBytes(24).toString('base64url'), createdBy: ACTOR, invitedAt: rand() < 0.7 ? now : null }));
const checkins = [];
const docs = [];
for (const row of reservations) {
  if (rand() >= 0.6) continue;
  const id = randomUUID();
  const status = row.status === 'CHECKED_IN' || row.status === 'CHECKED_OUT' ? 'COMPLETED' : pick(['SUBMITTED', 'SUBMITTED', 'APPROVED', 'APPROVED', 'REJECTED']);
  checkins.push({
    id,
    hotelId,
    reservationId: row.id,
    status,
    arrivalDate: new Date(core.toUtcDayStart(row.checkIn)),
    searchText: `${row.confirmationCode} ${row.guest.firstName} ${row.guest.lastName}`,
    guest: { firstName: row.guest.firstName, lastName: row.guest.lastName, idType: 'PASSPORT', idNumber: `P${String(Math.floor(rand() * 1e8)).padStart(8, '0')}`, nationality: 'DE', birthDate: '1980-01-01' },
    companions: Array.from({ length: Math.max(0, row.adults - 1) }, () => ({ firstName: 'Gast', lastName: row.guest.lastName, isChild: false, idType: 'PASSPORT', idNumber: 'P12345678', nationality: 'DE', birthDate: '1982-02-02' })),
    paymentPreference: 'CARD_AT_DESK',
    language: 'de',
    consents: { privacyAt: now.toISOString(), rulesAt: now.toISOString(), documentPhotosAt: now.toISOString(), marketing: false },
    signatureKey: `online-checkin/${hotelId}/${id}.1.signature.png`,
    submittedAt: new Date(row.checkIn.getTime() - 2 * 86_400_000),
    rejectReason: status === 'REJECTED' ? 'Fotoğraf okunmuyor' : null,
  });
  for (let person = 0; person < Math.max(1, row.adults); person += 1) {
    docs.push({ id: randomUUID(), hotelId, reservationId: row.id, onlineCheckinId: id, person, contentType: 'image/jpeg', sizeBytes: 30_000, thumbBytes: 7_000 });
  }
}
for (let index = 0; index < links.length; index += CHUNK) await prisma.guestPortalLink.createMany({ data: links.slice(index, index + CHUNK) });
for (let index = 0; index < checkins.length; index += CHUNK) await prisma.onlineCheckin.createMany({ data: checkins.slice(index, index + CHUNK) });
for (let index = 0; index < docs.length; index += CHUNK) await prisma.onlineCheckinDocument.createMany({ data: docs.slice(index, index + CHUNK) });
await prisma.$executeRawUnsafe('ANALYZE "GuestPortalLink", "OnlineCheckin", "OnlineCheckinDocument"');
console.log(`Kurulum ${Math.round((performance.now() - started) / 1000)} sn: ${links.length} bağlantı, ${checkins.length} online check-in, ${docs.length} belge satırı`);

/* ══════════════════ Ölçüm ══════════════════ */

const today = core.toIsoDay(core.calendarDateInTimeZone((await prisma.hotel.findUnique({ where: { id: hotelId } })).timezone));
const page = (extra = {}) => ({ page: 1, pageSize: 25, ...extra });
const someone = checkins[Math.floor(checkins.length / 2)];
const sampleCode = (await prisma.reservation.findUnique({ where: { id: someone.reservationId }, select: { confirmationCode: true } })).confirmationCode;
await measure('Liste: gelecek girişler (varsayılan)', () => service.listOnlineCheckins(hotelId, page({ from: today })));
await measure('Liste: tümü, ilk sayfa', () => service.listOnlineCheckins(hotelId, page()));
await measure('Liste: inceleme bekleyenler', () => service.listOnlineCheckins(hotelId, page({ status: 'SUBMITTED' })));
await measure(`Liste: arama (onay kodu "${sampleCode.slice(0, 7)}")`, () => service.listOnlineCheckins(hotelId, page({ search: sampleCode.slice(0, 7) })));
await measure('Liste: arama (ad)', () => service.listOnlineCheckins(hotelId, page({ search: someone.guest.lastName.slice(0, 4) })));
await measure('Liste: derin sayfa (300.)', () => service.listOnlineCheckins(hotelId, page({ page: 300 })));
await measure('Ayrıntı', () => service.getOnlineCheckin(hotelId, someone.id));
await measure('Giriş penceresinin ön dolumu (rezervasyondan)', () => service.getOnlineCheckinByReservation(hotelId, someone.reservationId));

const linkOf = (reservationId) => links.find((row) => row.reservationId === reservationId);
/** Örneklemin dışındaki rezervasyona ölçüm için bağlantı. @param {any} where */
const linkFor = async (where) => {
  const row = await prisma.reservation.findFirst({ where: { hotelId, ...where, onlineCheckin: null }, orderBy: { checkIn: 'asc' }, select: { id: true } });
  if (!row) return null;
  const existing = await prisma.guestPortalLink.findFirst({ where: { reservationId: row.id, revokedAt: null }, select: { id: true, nonce: true } });
  return existing ?? prisma.guestPortalLink.create({ data: { hotelId, reservationId: row.id, nonce: randomBytes(24).toString('base64url'), createdBy: ACTOR }, select: { id: true, nonce: true } });
};
await measure('Misafir: ana sayfa', () => as(() => guest.portalOverview(portalToken(linkOf(someone.reservationId)))));
const inHouseLink = await linkFor({ status: 'CHECKED_IN', checkOut: { gte: new Date(`${today}T00:00:00Z`) } });
if (inHouseLink) await measure('Misafir: folyo (içeride)', () => as(() => guest.portalFolio(portalToken(inHouseLink))));
else console.log('İçeride konaklama yok: folyo ölçülmedi.');
const arrivingLink = await linkFor({ status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: { gte: new Date(`${today}T00:00:00Z`), lt: new Date(Date.parse(`${today}T00:00:00Z`) + 25 * 86_400_000) } });
if (arrivingLink) {
  const token = portalToken(arrivingLink);
  await measure('Misafir: online check-in formu', () => as(() => guest.checkinForm(token)));
  const [full, thumb, signature] = await Promise.all(['ornek-belge.jpg', 'ornek-belge-kucuk.jpg', 'ornek-imza.png'].map((name) => readFile(path.join(import.meta.dirname, 'assets', name))));
  const photo = { contentType: 'image/jpeg', image: full.toString('base64'), thumbnail: thumb.toString('base64') };
  const ids = [];
  await measure('Misafir: belge fotoğrafı yükleme', async () => ids.push((await as(() => documents.uploadDocumentPhoto(token, photo))).id), 3);
  const body = {
    primary: { identity: { idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE', birthDate: new Date('1985-04-12') }, documentIds: [ids[0]] },
    companions: [],
    vehiclePlate: null,
    arrivalTime: '16:00',
    paymentPreference: 'CARD_AT_DESK',
    note: null,
    consents: { privacy: true, rules: true, documentPhotos: true, marketing: false },
    signature: { contentType: 'image/png', image: signature.toString('base64') },
    language: 'de',
  };
  await measure('Misafir: gönderim (imza + bağlama + zil)', () => as(() => guest.submitCheckin(token, body)), 1);
} else {
  console.log('Önümüzdeki 30 günde online check-in yapmamış rezervasyon yok: form / gönderim ölçülmedi.');
}

await prisma.guestPortalLink.updateMany({ where: { hotelId }, data: { invitedAt: null } });
await prisma.guestPortalLink.deleteMany({ where: { hotelId, reservation: { checkIn: { gte: new Date(`${today}T00:00:00Z`) } } } });
// Davet ancak açık kanal + iletişim varken gider: ölçüm için e-posta kanalı açılır, sonra eski hâline döner.
const previousEmail = await prisma.notificationChannelConfig.findFirst({ where: { hotelId, channel: 'EMAIL' } });
if (previousEmail) await prisma.notificationChannelConfig.update({ where: { id: previousEmail.id }, data: { enabled: true } });
else await prisma.notificationChannelConfig.create({ data: { hotelId, channel: 'EMAIL', enabled: true, settings: { fromAddress: 'olcum@example.com' } } });
const reachableArrivals = await prisma.reservation.count({
  where: { hotelId, status: 'CONFIRMED', checkIn: { gte: new Date(`${today}T00:00:00Z`), lt: new Date(new Date(`${today}T00:00:00Z`).getTime() + 4 * 86_400_000) }, guest: { email: { not: null } } },
});
const invited = await measure('Davet turu (3 gün içindeki bütün varışlar, 60 sn bütçe)', () => as(() => invites.inviteUpcomingArrivals(hotelId, { inviteDaysBefore: 3, publicBaseUrl: 'https://perf.example.com' })), 1);
console.log(`  davet edilen: ${invited} (e-postası olan onaylı varış: ${reachableArrivals})`);
await prisma.notification.deleteMany({ where: { hotelId, source: 'CHECKIN_INVITE' } });
if (previousEmail) await prisma.notificationChannelConfig.update({ where: { id: previousEmail.id }, data: { enabled: previousEmail.enabled } });
else await prisma.notificationChannelConfig.deleteMany({ where: { hotelId, channel: 'EMAIL' } });
await prisma.onlineCheckinDocument.updateMany({ where: { id: { in: docs.slice(0, 400).map((row) => row.id) } }, data: { onlineCheckinId: null, createdAt: new Date(Date.now() - 49 * 3_600_000) } });
await measure('Silme turu (200 belge)', () => documents.purgeExpiredDocuments(new Date(), console), 1);

await prisma.$disconnect();
