/**
 * Mesaj kanallarının ve AI asistanının varlık kaydı.
 *
 * Modül 7 (gelen kutusu) kanaldan bağımsızdır; mesajı gerçekten gönderen
 * WhatsApp / web chat geçitleri ve cevap yazan concierge ajanı modül 8'de.
 * Bu dosya ikisi arasındaki **tek bağlantı noktası**: geçit açılırken
 * kendini kaydeder, ekran da "bu kanal bağlı mı" sorusunun cevabını buradan
 * alır.
 *
 * ### Bugün boş olması kasıtlı
 *
 * Modül 8 henüz yok. Kayıt defteri boşken:
 * - Personelin cevabı "gönderim bekliyor" olarak yazılır ve `guest.message.reply`
 *   event'i yayınlanır; geçit geldiğinde bekleyenleri de gönderir
 *   (`Message.delivery = PENDING` sorgusu, `hotelId + delivery` index'li).
 * - Yeni konuşmalar **personel** modunda başlar: cevap verecek bir asistan
 *   yokken konuşmayı "AI"ya bırakmak misafiri cevapsız bırakmak olurdu.
 * - Ekran bunu açıkça söyler; gönderilmiş gibi göstermez.
 *
 * ### Modül 8 ne yapacak
 *
 * ```js
 * registerChannel('WHATSAPP', { name: 'whatsapp-gateway' });
 * registerAutoResponder({ name: 'concierge-agent' });
 * ```
 * Geçit `guest.message.reply` event'ini dinler, gönderir, sonucu
 * `messaging/service.js → markMessageDelivery` ile bildirir.
 *
 * Kayıt süreç içidir (event bus gibi); çok örnekli kuruluma geçildiğinde bu
 * bilgi paylaşılan bir yere taşınır.
 */

/** @type {Map<string, { name: string, registeredAt: string }>} */
const channels = new Map();

/** @type {Map<string, { name: string, registeredAt: string }>} */
const autoResponders = new Map();

/**
 * @param {string} channel `CONVERSATION_CHANNELS` içinden
 * @param {{ name: string }} info
 * @returns {() => void} kaydı siler (geçit kapanırken)
 */
export function registerChannel(channel, { name }) {
  channels.set(channel, { name, registeredAt: new Date().toISOString() });
  return () => {
    if (channels.get(channel)?.name === name) channels.delete(channel);
  };
}

/** @param {string} channel */
export function isChannelConnected(channel) {
  return channels.has(channel);
}

/**
 * @param {{ name: string }} info
 * @returns {() => void}
 */
export function registerAutoResponder({ name }) {
  autoResponders.set(name, { name, registeredAt: new Date().toISOString() });
  return () => autoResponders.delete(name);
}

/** Konuşmalara cevap verebilecek bir AI asistanı çalışıyor mu? */
export function hasAutoResponder() {
  return autoResponders.size > 0;
}

/** Ekran ve sağlık ucu için durum özeti. */
export function channelStatus() {
  return {
    channels: [...channels.entries()].map(([channel, info]) => ({ channel, ...info })),
    autoResponders: [...autoResponders.values()],
  };
}
