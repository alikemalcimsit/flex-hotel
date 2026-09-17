import { createNetgsmProvider } from './netgsm.js';
import { createSmtpProvider } from './smtp.js';

/**
 * Bildirim sağlayıcılarının kayıt defteri.
 *
 * - **E-posta:** SMTP (nodemailer) — yerleşik.
 * - **SMS:** Netgsm — yerleşik. Yeni sağlayıcı eklemek için bu klasöre
 *   `send`/`report` sunan bir adaptör yazılır, contracts `SMS_PROVIDERS`
 *   listesine eklenir ve aşağıda kaydedilir.
 * - **WhatsApp:** kasıtlı olarak boş. Meta'nın onaylı şablon mesajlarını
 *   gönderen geçit modül 8'in (whatsapp-gateway) işi; geçit açılırken
 *   `registerNotificationProvider({ channel: 'WHATSAPP', name, send })` ile
 *   kendini kaydeder. Kayıt yokken WhatsApp kanalı açılamaz ve ekran bunu söyler.
 *
 * Sağlayıcı arayüzü:
 * `send({ hotelId, settings, secret, to, toName, subject, text }) → { providerMessageId }`,
 * hata durumunda `ProviderError` (retryable / configIssue).
 */

/** @type {Map<string, object>} `${channel}:${name}` → sağlayıcı */
const providers = new Map();

const smtp = createSmtpProvider();
const netgsm = createNetgsmProvider();
providers.set('EMAIL:smtp', smtp);
providers.set('SMS:netgsm', netgsm);

/**
 * Harici sağlayıcı kaydı (modül 8'in WhatsApp geçidi).
 * @param {{ channel: string, name: string, send: Function }} provider
 * @returns {() => void} kaydı siler
 */
export function registerNotificationProvider(provider) {
  const key = `${provider.channel}:${provider.name}`;
  providers.set(key, provider);
  return () => {
    if (providers.get(key) === provider) providers.delete(key);
  };
}

/**
 * Kanalın ayarına göre sağlayıcı. WhatsApp'ta kayıtlı ilk geçit.
 * @param {string} channel
 * @param {{ provider?: string }} [settings]
 */
export function providerFor(channel, settings = {}) {
  if (channel === 'EMAIL') return providers.get('EMAIL:smtp') ?? null;
  if (channel === 'SMS') return providers.get(`SMS:${String(settings.provider ?? '').toLowerCase()}`) ?? null;
  for (const [key, provider] of providers) {
    if (key.startsWith(`${channel}:`)) return provider;
  }
  return null;
}

/** Kanal için sağlayıcı var mı (ekran: "WhatsApp geçidi bağlı değil"). @param {string} channel */
export function channelAvailable(channel) {
  if (channel === 'EMAIL' || channel === 'SMS') return true;
  return providerFor(channel) !== null;
}

/** Ayar değişince bağlantı havuzunu bırak. @param {string} hotelId @param {string} channel */
export function resetProviderConnections(hotelId, channel) {
  if (channel === 'EMAIL') smtp.reset(hotelId);
}

/** Sunucu kapanırken. */
export function closeProviders() {
  smtp.closeAll();
}
