import { currentActor } from '@hotelos/core';
import { PAYMENT_GATEWAY_PROVIDERS, PAYMENT_GATEWAY_PROVIDER_LABELS } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { StaleWriteError, ValidationError } from '../../lib/errors.js';
import { sealSecret, secretKeyConfigured } from '../../lib/secret-box.js';
import { writeWithEvents } from '../../lib/write.js';
import { loadPortalSettings } from '../guest-portal/shared.js';
import { gatewayProviderFor } from './providers/index.js';
import { loadGatewaySettings, prisma, providerContext, settingsView } from './shared.js';

/** Sanal POS ayarı (modül 50): anahtarlar yalnız yazılır; açık iyzico ayarında anahtarlar zorunlu. */

/** @param {string} hotelId */
export async function getGatewaySettings(hotelId) {
  const [settings, portal] = await Promise.all([loadGatewaySettings(prisma, hotelId), loadPortalSettings(prisma, hotelId)]);
  return {
    settings: settingsView(settings),
    providers: PAYMENT_GATEWAY_PROVIDERS.map((code) => ({ code, label: PAYMENT_GATEWAY_PROVIDER_LABELS[code] })),
    secretKeyConfigured: secretKeyConfigured(),
    portalBaseUrl: portal.publicBaseUrl ?? null,
  };
}

/** @param {string} hotelId @param {any} input `paymentGatewaySettingsSchema` çıktısı */
export async function saveGatewaySettings(hotelId, input) {
  const current = await loadGatewaySettings(prisma, hotelId);
  if (input.expectedUpdatedAt && current.updatedAt && new Date(current.updatedAt).getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError('Ayar bu arada değişti; yenileyip tekrar deneyin');
  const { expectedUpdatedAt, apiKey, secretKey, clearCredentials, ...rest } = input;
  let credentialsSealed = current.credentialsSealed;
  if (clearCredentials) credentialsSealed = null;
  else if (apiKey || secretKey) {
    if (!apiKey || !secretKey) throw new ValidationError('API anahtarı ve gizli anahtar birlikte girilmeli', { fields: { [apiKey ? 'secretKey' : 'apiKey']: 'Zorunlu' } });
    credentialsSealed = sealSecret(JSON.stringify({ apiKey, secretKey }));
  }
  if (rest.isEnabled && rest.provider === 'IYZICO' && !credentialsSealed) throw new ValidationError('iyzico için API anahtarı ve gizli anahtar girin', { fields: { apiKey: 'Zorunlu', secretKey: 'Zorunlu' } });
  if (rest.isEnabled && rest.provider === 'IYZICO' && apiKey && rest.environment === 'LIVE' && apiKey.startsWith('sandbox-')) throw new ValidationError('Canlı ortamda sandbox anahtarı kullanılamaz', { field: 'apiKey' });
  const data = { ...rest, credentialsSealed, updatedBy: currentActor() };
  await writeWithEvents(async (tx, stage) => {
    await tx.paymentGatewaySettings.upsert({ where: { hotelId }, create: { hotelId, ...data }, update: data });
    await recordAudit(tx, { hotelId, entity: 'PaymentGatewaySettings', entityId: hotelId, action: 'UPDATE', after: { ...rest, credentialsChanged: Boolean(apiKey) || clearCredentials } });
    await stage('payment_gateway.settings.changed', { hotelId, isEnabled: rest.isEnabled, provider: rest.provider });
  });
  return getGatewaySettings(hotelId);
}

/** Kayıtlı ayarla bağlantı denemesi (ödeme açmaz). @param {string} hotelId */
export async function testGatewayConnection(hotelId) {
  const settings = await loadGatewaySettings(prisma, hotelId);
  const provider = gatewayProviderFor(settings.provider);
  if (!provider) return { ok: false, message: 'Sağlayıcı tanımsız' };
  try {
    return await provider.testConnection(providerContext(hotelId, settings));
  } catch (error) {
    return { ok: false, message: /** @type {Error} */ (error).message };
  }
}
