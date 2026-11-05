import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { currentActor, getContext, toIsoDay } from '@hotelos/core';
import { GUEST_PORTAL_PATH, guestPortalOpen } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, rethrowPrismaError } from '../../lib/errors.js';
import { resolveJwtSecret } from '../../lib/http-security.js';
import { lockReservations } from '../../lib/locks.js';
import { writeWithEvents } from '../../lib/write.js';
import { absoluteUrl, iso, loadPortalSettings, portalContext, prisma } from './shared.js';

/**
 * Misafir portalı bağlantısı (modül 53).
 *
 * Bağlantı rezervasyona bağlıdır: `/misafir/p/<kimlik>.<imza>`. İmza sunucunun JWT sırrından türetilen anahtarla
 * (41'in oda servisi bağlantısından **ayrı bağlamla**) bağlantı kimliği + rastgele değerin HMAC'idir; veritabanı
 * okunsa da bağlantı üretilemez. Rezervasyonda tek geçerli bağlantı vardır (kısmi tekil index); yenilemek eskisini
 * öldürür. Bağlantı rezervasyon iptal / gelmedi olunca ve çıkıştan `GUEST_PORTAL_AFTER_CHECKOUT_DAYS` gün sonra
 * kendiliğinden kapanır (kayıt durur, çözümleme reddeder).
 */

/** Bağlantının rastgele değeri (bayt). */
const NONCE_BYTES = 24;
/** "Son kullanım" damgası en fazla bu sıklıkla yazılır. */
const TOUCH_INTERVAL_MS = 5 * 60_000;

let signingKey = null;
/** İmza anahtarı (JWT sırrından türetilir; JWT sırrı değişirse bütün bağlantılar yenilenir). */
function linkKey() {
  signingKey ??= createHmac('sha256', resolveJwtSecret({ warn: () => {} })).update('hotelos:guest-portal-link:v1').digest();
  return signingKey;
}

/** @param {string} linkId @param {string} nonce */
const signature = (linkId, nonce) => createHmac('sha256', linkKey()).update(`${linkId}.${nonce}`).digest('base64url');

/** @param {{ id: string, nonce: string }} link */
export const portalToken = (link) => `${link.id}.${signature(link.id, link.nonce)}`;
/** @param {{ id: string, nonce: string }} link */
export const portalPath = (link) => `${GUEST_PORTAL_PATH}/${portalToken(link)}`;

const LINK_FIELDS = Object.freeze({ id: true, nonce: true, createdAt: true, createdBy: true, lastUsedAt: true, invitedAt: true });

/* ══════════════════ Personel ══════════════════ */

/**
 * Rezervasyonun geçerli bağlantısı (yoksa boş), portalın açık olup olmadığı ve davetin gönderilebilirliği.
 * @param {string} hotelId @param {string} reservationId
 */
export async function getPortalLink(hotelId, reservationId) {
  const [reservation, link, settings, { today }] = await Promise.all([
    prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { id: true, status: true, checkIn: true, checkOut: true, guest: { select: { email: true, phone: true } } } }),
    prisma.guestPortalLink.findFirst({ where: { hotelId, reservationId, revokedAt: null }, select: LINK_FIELDS }),
    loadPortalSettings(prisma, hotelId),
    portalContext(hotelId),
  ]);
  if (!reservation) throw new NotFoundError('Rezervasyon bulunamadı');
  const open = guestPortalOpen({ status: reservation.status, checkOut: toIsoDay(reservation.checkOut) }, today);
  return {
    enabled: settings.enabled,
    open,
    closedReason: !settings.enabled ? 'Misafir portalı ayarlarda kapalı' : open ? null : ['CANCELLED', 'NO_SHOW'].includes(reservation.status) ? 'Rezervasyon iptal / gelmedi' : 'Konaklama sona ereli uzun süre oldu',
    hasContact: Boolean(reservation.guest?.email || reservation.guest?.phone),
    link: link
      ? { path: portalPath(link), url: absoluteUrl(settings.publicBaseUrl, portalPath(link)), createdAt: iso(link.createdAt), createdBy: link.createdBy, lastUsedAt: iso(link.lastUsedAt), invitedAt: iso(link.invitedAt) }
      : null,
  };
}

/**
 * Bağlantının çağıranın işleminde var olmasını sağlar (yoksa açar; varsa dokunmaz). Rezervasyon kilitli olmalı.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} hotelId @param {string} reservationId
 * @returns {Promise<{ id: string, nonce: string, created: boolean }>}
 */
export async function ensurePortalLinkInTx(tx, hotelId, reservationId) {
  const existing = await tx.guestPortalLink.findFirst({ where: { hotelId, reservationId, revokedAt: null }, select: { id: true, nonce: true } });
  if (existing) return { ...existing, created: false };
  const link = await tx.guestPortalLink.create({
    data: { hotelId, reservationId, nonce: randomBytes(NONCE_BYTES).toString('base64url'), createdBy: currentActor() },
    select: { id: true, nonce: true },
  });
  await recordAudit(tx, { hotelId, entity: 'GuestPortalLink', entityId: link.id, action: 'CREATE', after: { reservationId } });
  return { ...link, created: true };
}

/**
 * Bağlantı verir / yeniler: varsa eskisi iptal edilir (eski bağlantı ve davet artık çalışmaz).
 * @param {string} hotelId @param {string} reservationId
 */
export async function issuePortalLink(hotelId, reservationId) {
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      if (!(await lockReservations(tx, hotelId, [reservationId])).has(reservationId)) throw new NotFoundError('Rezervasyon bulunamadı');
      const reservation = await tx.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { status: true, checkOut: true } });
      const { today } = await portalContext(hotelId);
      if (!guestPortalOpen({ status: reservation.status, checkOut: toIsoDay(reservation.checkOut) }, today)) {
        throw new ConflictError('Bu rezervasyon için portal açılamaz (iptal, gelmedi ya da konaklama çoktan bitti).', 'PORTAL_CLOSED');
      }
      const revoked = await tx.guestPortalLink.updateMany({ where: { hotelId, reservationId, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: actor } });
      const link = await tx.guestPortalLink.create({ data: { hotelId, reservationId, nonce: randomBytes(NONCE_BYTES).toString('base64url'), createdBy: actor }, select: { id: true } });
      await recordAudit(tx, { hotelId, entity: 'GuestPortalLink', entityId: link.id, action: 'CREATE', after: { reservationId, replaced: revoked.count } });
      await stage('guest_portal.link.changed', { hotelId, reservationId, change: 'ISSUED' });
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bağlantı az önce yenilendi; ekranı yenileyin.' });
  }
  return getPortalLink(hotelId, reservationId);
}

/** Bağlantıyı iptal eder (yanlış kişiye gitti, misafir istemiyor). @param {string} hotelId @param {string} reservationId */
export async function revokePortalLink(hotelId, reservationId) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    await lockReservations(tx, hotelId, [reservationId]);
    const links = await tx.guestPortalLink.findMany({ where: { hotelId, reservationId, revokedAt: null }, select: { id: true } });
    if (!links.length) throw new NotFoundError('Geçerli bağlantı yok');
    await tx.guestPortalLink.updateMany({ where: { id: { in: links.map((link) => link.id) } }, data: { revokedAt: new Date(), revokedBy: actor } });
    for (const link of links) await recordAudit(tx, { hotelId, entity: 'GuestPortalLink', entityId: link.id, action: 'UPDATE', after: { revoked: true, by: actor } });
    await stage('guest_portal.link.changed', { hotelId, reservationId, change: 'REVOKED' });
  });
  return getPortalLink(hotelId, reservationId);
}

/* ══════════════════ Misafir: belirtecin çözülmesi ══════════════════ */

export const PORTAL_RESERVATION_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  confirmationCode: true,
  status: true,
  checkIn: true,
  checkOut: true,
  adults: true,
  children: true,
  boardType: true,
  roomId: true,
  room: { select: { number: true } },
  roomType: { select: { name: true } },
  guest: { select: { id: true, firstName: true, lastName: true, nationality: true } },
});

/**
 * Belirteci doğrular: imza (sabit zamanlı), bağlantı iptal edilmemiş, portal bu rezervasyon için açık. Kimlik hatasında
 * ne olduğu söylenmez (bulunamadı). İşlem kaydına misafir ("misafir · DMO-0012") yazılır — başlıktaki kimliğe güvenilmez.
 *
 * @param {any} client @param {string} token biçimi şemada denetlendi
 */
export async function resolvePortalToken(client, token) {
  const [linkId, given] = token.split('.');
  const link = await client.guestPortalLink.findFirst({
    where: { id: linkId },
    select: { id: true, hotelId: true, reservationId: true, nonce: true, revokedAt: true, lastUsedAt: true, reservation: { select: PORTAL_RESERVATION_SELECT } },
  });
  const expected = link ? Buffer.from(signature(link.id, link.nonce)) : null;
  if (!link || !expected || expected.length !== Buffer.byteLength(given) || !timingSafeEqual(expected, Buffer.from(given))) throw new NotFoundError('Bağlantı bulunamadı');
  if (link.revokedAt) throw new ConflictError('Bu bağlantı artık geçerli değil; otelden yenisini isteyin.', 'LINK_EXPIRED');
  const [{ today }, settings] = await Promise.all([portalContext(link.hotelId), loadPortalSettings(client, link.hotelId)]);
  if (!settings.enabled) throw new ConflictError('Misafir portalı şu an kapalı.', 'PORTAL_DISABLED');
  const reservation = link.reservation;
  if (!guestPortalOpen({ status: reservation.status, checkOut: toIsoDay(reservation.checkOut) }, today)) {
    throw new ConflictError('Bu rezervasyonun portalı kapandı.', 'PORTAL_CLOSED');
  }
  const context = getContext();
  if (context) context.actor = `misafir · ${reservation.confirmationCode}`;
  return { link, reservation, settings, today };
}

/** Son kullanım damgası (seyrek yazılır). @param {{ id: string, lastUsedAt: Date | null }} link */
export async function touchPortalLink(link) {
  if (link.lastUsedAt && Date.now() - link.lastUsedAt.getTime() < TOUCH_INTERVAL_MS) return;
  await prisma.guestPortalLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
}
