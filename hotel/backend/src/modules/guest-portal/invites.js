import { runWithContext } from '@hotelos/core';
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { lockReservations } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { enqueueTriggerNotifications, ensureTriggerTemplates } from '../notifications/service.js';
import { ensurePortalLinkInTx, getPortalLink, portalPath } from './links.js';
import { PORTAL_SYSTEM_ACTOR, absoluteUrl, loadPortalSettings, portalContext, prisma } from './shared.js';

/**
 * Online check-in daveti (modül 53): misafire portal bağlantısı, modül 9'un kanallarıyla (`CHECKIN_INVITE` şablonu).
 *
 * - Otomatik: girişten `inviteDaysBefore` gün önce, onaylı rezervasyona, online check-in yapılmamışsa, daha önce davet
 *   gitmemişse ve personel bağlantıya dokunmamışsa (iptal / yenileme: "misafir istemiyor", "yanlış kişiye gitti" —
 *   o rezervasyonda davet elle gider). Zamanlanmış iş (30 dakikada bir) otel başına `INVITE_BATCH`'lik parçalarla,
 *   `INVITE_TIME_BUDGET_MS` dolana dek işler (büyük otelde günün bütün varışları bir turda); kalan sonraki turda.
 *   Portal adresi (ayar) yoksa ya da davetin gidebileceği açık kanal + etkin şablon yoksa tur başlamaz.
 * - Elle: personel rezervasyondan "daveti gönder" (aynı bağlantı; `MANUAL_INVITE_GAP_MINUTES` içinde ikinci kez değil).
 * - Davet ancak bir kanala satır açılınca "gitti" sayılır: misafir kartında iletişim yoksa davet harcanmaz, bilgi
 *   sonradan eklenince otomatik tur yeniden dener.
 */

/** Davetler bu kadarlık parçalarla seçilir. */
const INVITE_BATCH = 100;
/** Bir otelin bir turdaki süre bütçesi (bir davet ~50 ms: 60 sn ≈ 1.000 davet). */
const INVITE_TIME_BUDGET_MS = 60_000;
/** Elle davetin tekrar sıklığı (misafire üst üste mesaj gitmesin). */
const MANUAL_INVITE_GAP_MINUTES = 10;
const DAY_MS = 86_400_000;

/**
 * Bağlantıyı garanti edip daveti kuyruğa koyar. Davet anı rezervasyon kilidi altında **önce** yazılır (aynı anda iki elle
 * gönderim ya da iş ile personel birbirini görür); hiçbir kanala satır açılmazsa (iletişim yok, kanal kapalı) ya da
 * kuyruğa yazma hata verirse eski değerine döner.
 * @param {string} hotelId @param {string} reservationId @param {{ baseUrl: string, manual: boolean }} options
 */
async function inviteReservation(hotelId, reservationId, { baseUrl, manual }) {
  const claimedAt = new Date();
  const { link, previous } = await writeWithEvents(async (tx, stage) => {
    if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Rezervasyon bulunamadı');
    const ensured = await ensurePortalLinkInTx(tx, hotelId, reservationId);
    const row = await tx.guestPortalLink.findUnique({ where: { id: ensured.id }, select: { invitedAt: true } });
    if (manual && row.invitedAt && claimedAt.getTime() - row.invitedAt.getTime() < MANUAL_INVITE_GAP_MINUTES * 60_000) {
      throw new ConflictError(`Davet az önce gönderildi; ${MANUAL_INVITE_GAP_MINUTES} dakika sonra yeniden gönderebilirsiniz.`, 'INVITE_TOO_SOON');
    }
    await tx.guestPortalLink.update({ where: { id: ensured.id }, data: { invitedAt: claimedAt } });
    if (ensured.created) await stage('guest_portal.link.changed', { hotelId, reservationId, change: 'ISSUED' });
    await stage('guest_portal.link.changed', { hotelId, reservationId, change: 'INVITED' });
    return { link: ensured, previous: row.invitedAt };
  });
  // Yalnız bu çağrının yazdığı değeri geri alır (arada başka bir davet yazdıysa ona dokunmaz).
  const release = () => prisma.guestPortalLink.updateMany({ where: { id: link.id, invitedAt: claimedAt }, data: { invitedAt: previous } });
  let result;
  try {
    result = await enqueueTriggerNotifications(hotelId, 'CHECKIN_INVITE', {
      reservationId,
      extraValues: { portalLinki: absoluteUrl(baseUrl, portalPath(link)) },
      dedupeSuffix: manual ? `manual:${randomUUID()}` : 'auto',
    });
  } catch (error) {
    await release();
    throw error;
  }
  if (!result.queued.length && !result.duplicates) await release();
  return result;
}

/**
 * Davetin gidebileceği kanallara göre misafir kartı denetimi (açık kanal + etkin `CHECKIN_INVITE` şablonu). Hiçbiri
 * yoksa boş: otomatik tur başlamaz, davet harcanmaz (kanal açılınca penceredeki bütün varışlara gider).
 * @param {string} hotelId
 * @returns {Promise<((guest: { email: string | null, phone: string | null }) => boolean) | null>}
 */
async function inviteReachable(hotelId) {
  const [configs, templates] = await Promise.all([
    prisma.notificationChannelConfig.findMany({ where: { hotelId, enabled: true }, select: { channel: true } }),
    prisma.notificationTemplate.findMany({ where: { hotelId, key: 'CHECKIN_INVITE', isActive: true }, select: { channel: true } }),
  ]);
  const withTemplate = new Set(templates.map((template) => template.channel));
  const open = new Set(configs.map((config) => config.channel).filter((channel) => withTemplate.has(channel)));
  const byEmail = open.has('EMAIL');
  const byPhone = open.has('SMS') || open.has('WHATSAPP');
  if (!byEmail && !byPhone) return null;
  return (guest) => Boolean((byEmail && guest.email?.trim()) || (byPhone && guest.phone?.trim()));
}

/**
 * Personelin elle gönderdiği davet.
 * @param {string} hotelId @param {string} reservationId
 */
export async function sendPortalInvite(hotelId, reservationId) {
  const settings = await loadPortalSettings(prisma, hotelId);
  if (!settings.enabled) throw new ConflictError('Misafir portalı ayarlarda kapalı.', 'PORTAL_DISABLED');
  if (!settings.publicBaseUrl) throw new ConflictError('Portal adresi tanımlı değil: Misafir portalı ayarlarından girin.', 'PORTAL_URL_MISSING');
  const reservation = await prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { status: true } });
  if (!reservation) throw new NotFoundError('Rezervasyon bulunamadı');
  if (!['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(reservation.status)) throw new ConflictError('İptal / gelmedi / çıkmış rezervasyona davet gönderilmez.', 'INVALID_STATUS');
  await ensureTriggerTemplates(hotelId, 'CHECKIN_INVITE');
  const result = await inviteReservation(hotelId, reservationId, { baseUrl: settings.publicBaseUrl, manual: true });
  return { ...(await getPortalLink(hotelId, reservationId)), result: { queued: result.queued.length, skipped: result.skipped } };
}

/**
 * Bir otelin otomatik davetleri (bir tur).
 * @param {string} hotelId @param {{ inviteDaysBefore: number, publicBaseUrl: string }} settings
 * Adaylar (otel, onaylı, giriş penceresinde) `[hotelId, status, checkIn, id]` indeksiyle imleçli seçilir; davetin
 * gidebileceği iletişimi olmayan, online check-in yapmış ve bağlantısına dokunulmuş olanlar parça içinde ayıklanır
 * (`reservationId IN (...)`) — ilişki süzgeci (`NOT IN (SELECT ...)`) bütün otellerin yıllar boyu biriken kayıtlarını
 * tarardı.
 *
 * @param {{ budgetMs?: number }} [options]
 * @returns {Promise<number>} daveti kuyruğa giren rezervasyon
 */
export async function inviteUpcomingArrivals(hotelId, settings, { budgetMs = INVITE_TIME_BUDGET_MS } = {}) {
  await ensureTriggerTemplates(hotelId, 'CHECKIN_INVITE');
  const reachable = await inviteReachable(hotelId);
  if (!reachable) return 0;
  const { today } = await portalContext(hotelId);
  const from = new Date(`${today}T00:00:00.000Z`);
  const until = new Date(from.getTime() + (settings.inviteDaysBefore + 1) * DAY_MS);
  const started = Date.now();
  let done = 0;
  /** @type {{ id: string, checkIn: Date } | null} */
  let cursor = null;
  for (;;) {
    const batch = await prisma.reservation.findMany({
      where: {
        hotelId,
        status: 'CONFIRMED',
        checkIn: { gte: from, lt: until },
        ...(cursor ? { OR: [{ checkIn: { gt: cursor.checkIn } }, { checkIn: cursor.checkIn, id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
      take: INVITE_BATCH,
      select: { id: true, checkIn: true, guest: { select: { email: true, phone: true } } },
    });
    if (!batch.length) return done;
    cursor = batch[batch.length - 1];
    const ids = batch.filter((row) => reachable(row.guest)).map((row) => row.id);
    const [submitted, touched] = ids.length
      ? await Promise.all([
          prisma.onlineCheckin.findMany({ where: { hotelId, reservationId: { in: ids } }, select: { reservationId: true } }),
          prisma.guestPortalLink.findMany({ where: { hotelId, reservationId: { in: ids }, OR: [{ invitedAt: { not: null } }, { revokedAt: { not: null } }] }, select: { reservationId: true } }),
        ])
      : [[], []];
    const skip = new Set([...submitted, ...touched].map((row) => row.reservationId));
    for (const id of ids) {
      if (skip.has(id)) continue;
      const result = await inviteReservation(hotelId, id, { baseUrl: settings.publicBaseUrl, manual: false });
      if (result.queued.length) done += 1;
    }
    if (batch.length < INVITE_BATCH || Date.now() - started > budgetMs) return done;
  }
}

/**
 * Bütün otellerin otomatik davet turu (zamanlanmış iş). Bir otelin hatası diğerlerini durdurmaz.
 * @param {{ warn?: Function, error?: Function }} [logger]
 */
export async function runInviteJob(logger = console) {
  const hotels = await prisma.guestPortalSettings.findMany({ where: { enabled: true, inviteDaysBefore: { gt: 0 }, publicBaseUrl: { not: null } }, select: { hotelId: true, inviteDaysBefore: true, publicBaseUrl: true } });
  let total = 0;
  for (const settings of hotels) {
    try {
      total += await runWithContext({ correlationId: randomUUID(), actor: PORTAL_SYSTEM_ACTOR }, () => inviteUpcomingArrivals(settings.hotelId, settings));
    } catch (error) {
      logger.error?.({ err: error, hotelId: settings.hotelId }, 'Online check-in davetleri gönderilemedi');
    }
  }
  return total;
}
