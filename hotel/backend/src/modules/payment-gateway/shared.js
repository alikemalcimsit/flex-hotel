import { randomBytes } from 'node:crypto';
import { PAYMENT_LINK_CODE_LENGTH, PAYMENT_LINK_PATH } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { openSecret } from '../../lib/secret-box.js';
import { loadPortalSettings } from '../guest-portal/shared.js';
import { GatewayProviderError } from './providers/index.js';

/**
 * Sanal POS'un ortak parçaları (modül 50): ayar (satır yoksa kapalı), anahtarların açılması, link kodu ve adresleri, görünümler.
 * Anahtarlar hiçbir görünüme girmez (`hasCredentials`).
 */

export { prisma };

/** @param {Date | null | undefined} value */
export const iso = (value) => (value ? value.toISOString() : null);
/** @param {unknown} value */
export const money = (value) => (value === null || value === undefined ? null : Number(value).toFixed(2));

/** @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client @param {string} hotelId */
export async function loadGatewaySettings(client, hotelId) {
  const row = await client.paymentGatewaySettings.findUnique({ where: { hotelId } });
  return {
    isEnabled: row?.isEnabled ?? false,
    provider: row?.provider ?? 'TEST',
    environment: row?.environment ?? 'SANDBOX',
    credentialsSealed: row?.credentialsSealed ?? null,
    apiPublicUrl: row?.apiPublicUrl ?? null,
    linkTtlHours: row?.linkTtlHours ?? 72,
    maxInstallment: row?.maxInstallment ?? 1,
    allowPortalPayment: row?.allowPortalPayment ?? true,
    widgetPrepayment: row?.widgetPrepayment ?? 'NONE',
    testBehavior: row?.testBehavior ?? 'APPROVE',
    isDefault: !row,
    updatedAt: iso(row?.updatedAt),
    updatedBy: row?.updatedBy ?? null,
  };
}

/** @param {Awaited<ReturnType<typeof loadGatewaySettings>>} settings */
export function settingsView(settings) {
  const { credentialsSealed, ...rest } = settings;
  return { ...rest, hasCredentials: Boolean(credentialsSealed) };
}

/** Sağlayıcı bağlamı (anahtarlar açılmış). @param {string} hotelId @param {any} settings */
export function providerContext(hotelId, settings) {
  let credentials = null;
  if (settings.credentialsSealed) {
    try {
      credentials = JSON.parse(openSecret(settings.credentialsSealed));
    } catch {
      throw new GatewayProviderError('Kayıtlı sağlayıcı anahtarları çözülemedi (sunucu anahtarı değişmiş olabilir); ayarlardan yeniden girin', { code: 'GATEWAY_SECRET' });
    }
  }
  return { hotelId, settings, environment: settings.environment, credentials };
}

/** Tahmin edilemez link kodu (URL güvenli). */
export const newLinkCode = () => randomBytes(PAYMENT_LINK_CODE_LENGTH).toString('base64url').slice(0, PAYMENT_LINK_CODE_LENGTH);

/** Misafirin ödeme sayfası (misafir uygulaması, portal adresinin altında). @param {string} hotelId @param {string} code */
export async function payPageUrl(hotelId, code) {
  const portal = await loadPortalSettings(prisma, hotelId);
  return portal.publicBaseUrl ? `${portal.publicBaseUrl.replace(/\/+$/, '')}${PAYMENT_LINK_PATH}/${code}` : null;
}

/** Sağlayıcının döneceği sunucu adresi. @param {any} settings @param {string} code */
export const callbackUrl = (settings, code) => `${settings.apiPublicUrl}/public/pay/${code}/callback`;
/** Test ortamının taklit ödeme sayfası. @param {any} settings @param {string} code */
export const testCheckoutUrl = (settings, code) => `${settings.apiPublicUrl}/public/pay/${code}/test-checkout`;

/** @param {any} row */
export const linkView = (row) => ({
  id: row.id,
  reservationId: row.reservationId,
  confirmationCode: row.reservation?.confirmationCode ?? null,
  guestName: row.reservation?.guest ? `${row.reservation.guest.firstName} ${row.reservation.guest.lastName}` : null,
  folioId: row.folioId,
  code: row.code,
  purpose: row.purpose,
  origin: row.origin,
  amount: money(row.amount),
  currency: row.currency,
  description: row.description,
  status: row.status,
  expiresAt: iso(row.expiresAt),
  provider: row.provider,
  environment: row.environment,
  attempts: row.attempts,
  cardBrand: row.cardBrand,
  cardLast4: row.cardLast4,
  installment: row.installment,
  paidAmount: money(row.paidAmount),
  paidAt: iso(row.paidAt),
  paymentId: row.paymentId,
  providerPaymentId: row.providerPaymentId,
  refundedAmount: money(row.refundedAmount),
  failureCode: row.failureCode,
  failureMessage: row.failureMessage,
  sentAt: iso(row.sentAt),
  sentVia: row.sentVia,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

export const LINK_INCLUDE = Object.freeze({ reservation: { select: { confirmationCode: true, guest: { select: { firstName: true, lastName: true } } } } });

/**
 * Linkin izine satır + canlı haber.
 * @param {any} tx @param {Function} stage @param {any} link @param {{ kind: string, ok: boolean, code?: string | null, message?: string | null, actor: string, status?: string }} event
 */
export async function logLinkEvent(tx, stage, link, event) {
  await tx.paymentLinkEvent.create({ data: { hotelId: link.hotelId, linkId: link.id, kind: event.kind, ok: event.ok, code: event.code ?? null, message: event.message?.slice(0, 500) ?? null, actor: event.actor } });
  await stage('payment_gateway.link.changed', { hotelId: link.hotelId, linkId: link.id, reservationId: link.reservationId, status: event.status ?? link.status, change: event.kind });
}
