/**
 * AI asistanı ve mesaj kanalları (modül 8) — sorgu anahtarları tek yerde.
 * Ayar kaydı ilgili anahtarları tazeler; gelen kutusu "AI açık mı" bilgisini
 * konuşmanın kendisinden okur.
 */
export const aiKeys = Object.freeze({
  settings: ['ai', 'settings'],
  /** @param {number} days */
  usage: (days) => ['ai', 'usage', days],
  usageAll: ['ai', 'usage'],
});

export const messagingChannelKeys = Object.freeze({
  all: ['messaging-channels'],
});

/**
 * Otelin sitesine yapıştırılacak balon kodu.
 * @param {string} apiUrl backend'in adresi (`VITE_API_URL`)
 * @param {string} publicKey balonun genel anahtarı
 */
export function widgetSnippet(apiUrl, publicKey) {
  return `<script src="${apiUrl.replace(/\/$/, '')}/webchat/widget.js" data-key="${publicKey}" async></script>`;
}

/**
 * Webhook'un tam adresi (Meta paneline girilir).
 * @param {string} apiUrl
 * @param {string} path sunucunun verdiği yol (`/webhooks/whatsapp/:id`)
 */
export function webhookUrl(apiUrl, path) {
  return `${apiUrl.replace(/\/$/, '')}${path}`;
}
