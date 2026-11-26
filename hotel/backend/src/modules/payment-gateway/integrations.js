import { runWithContext } from '@hotelos/core';
import { widgetPrepaymentAmount } from '@hotelos/hotel-contracts';
import { randomUUID } from 'node:crypto';
import { ConflictError } from '../../lib/errors.js';
import { stayBalances } from '../front-desk/folio.js';
import { resolvePortalToken } from '../guest-portal/links.js';
import { createPaymentLink } from './links.js';
import { loadGatewaySettings, money, payPageUrl, prisma } from './shared.js';

/**
 * Sanal POS'un portal (53) ve rezervasyon widget'ı (32) bağlantıları (modül 50).
 * - Portal: misafir "Kartla öde" der → konaklamanın açık bakiyesi (folyo yoksa konaklama tutarı, önceki ödemeler düşülmüş) için
 *   link; aynı tutarda açık bir portal linki varsa o kullanılır.
 * - Widget: ayardaki ön ödeme (ilk gece / tamamı) için rezervasyon isteğinden hemen sonra link; widget misafiri yönlendirir.
 */

const PORTAL_PAYABLE = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN']);

/** Portalda kartla ödeme açık mı? @param {string} hotelId @param {string} status */
export async function portalPayOnline(hotelId, status) {
  const settings = await loadGatewaySettings(prisma, hotelId);
  const ready = settings.provider !== 'IYZICO' || Boolean(settings.credentialsSealed);
  return settings.isEnabled && ready && settings.allowPortalPayment && Boolean(settings.apiPublicUrl) && PORTAL_PAYABLE.includes(status);
}

/** @param {string} hotelId @param {{ id: string, totalPrice: unknown }} reservation */
async function amountDue(hotelId, reservation) {
  const balance = (await stayBalances(prisma, hotelId, [reservation.id])).get(reservation.id);
  if (balance) return Number(balance.balance) > 0 ? money(balance.balance) : null;
  return Number(reservation.totalPrice) > 0 ? money(reservation.totalPrice) : null;
}

/** Portaldan ödeme: yönlenecek ödeme sayfası. @param {string} token */
export async function portalPayment(token) {
  const { link: portalLink, reservation } = await resolvePortalToken(prisma, token);
  const hotelId = portalLink.hotelId;
  if (!(await portalPayOnline(hotelId, reservation.status))) throw new ConflictError('Online ödeme şu an kapalı', 'GATEWAY_DISABLED');
  const stay = await prisma.reservation.findFirst({ where: { id: reservation.id, hotelId }, select: { id: true, totalPrice: true } });
  const amount = await amountDue(hotelId, stay);
  if (!amount) throw new ConflictError('Ödenecek bakiye yok', 'NOTHING_DUE');
  const reusable = await prisma.paymentLink.findFirst({ where: { hotelId, reservationId: stay.id, origin: 'PORTAL', status: 'OPEN', amount, expiresAt: { gt: new Date(Date.now() + 10 * 60_000) } }, orderBy: { createdAt: 'desc' } });
  const code =
    reusable?.code ??
    (await runWithContext({ correlationId: randomUUID(), actor: 'guest:portal' }, () => createPaymentLink(hotelId, stay.id, { requestId: randomUUID(), amount, purpose: 'BALANCE', description: null }, { origin: 'PORTAL' }))).link.code;
  return { url: await payPageUrl(hotelId, code), code, amount };
}

/**
 * Widget rezervasyonunun ön ödeme linki (ayarda kapalıysa ya da hazır değilse null; rezervasyon yine açılmış olur).
 * @param {string} hotelId @param {string} reservationId
 */
export async function widgetPrepaymentLink(hotelId, reservationId) {
  try {
    return await widgetPrepaymentLinkUnsafe(hotelId, reservationId);
  } catch {
    // Rezervasyon isteği açıldı; ön ödeme linki açılamadıysa personel gönderir (widget 500 görüp yeniden denemesin).
    return null;
  }
}

/** @param {string} hotelId @param {string} reservationId */
async function widgetPrepaymentLinkUnsafe(hotelId, reservationId) {
  const settings = await loadGatewaySettings(prisma, hotelId);
  if (!settings.isEnabled || settings.widgetPrepayment === 'NONE' || !settings.apiPublicUrl) return null;
  const stay = await prisma.reservation.findFirst({ where: { id: reservationId, hotelId }, select: { totalPrice: true, nights: { orderBy: { date: 'asc' }, select: { amount: true } } } });
  const amount = widgetPrepaymentAmount(settings.widgetPrepayment, { nights: stay.nights.map((night) => ({ amount: String(night.amount) })), total: String(stay.totalPrice) });
  if (!amount) return null;
  try {
    const created = await runWithContext({ correlationId: randomUUID(), actor: 'guest:widget' }, () => createPaymentLink(hotelId, reservationId, { requestId: randomUUID(), amount, purpose: 'PREPAYMENT', description: null }, { origin: 'WIDGET' }));
    return { url: created.link.url, amount, currency: created.link.currency };
  } catch {
    // Portal adresi / sağlayıcı hazır değil: rezervasyon isteği yine geçerli, ön ödeme personelle.
    return null;
  }
}
