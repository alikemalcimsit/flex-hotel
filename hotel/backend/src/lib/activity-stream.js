/**
 * Aktivite satırlarının süreç içi yayını (modül 10, canlı akış).
 *
 * Aktivite satırı bir iş olayı değildir: event bus'tan geçseydi her satır
 * `EventLog`'a bir satır daha yazdırır, o da yeni bir aktivite doğururdu.
 * Burası yalnızca "şu otelde şu kimlikli satır yazıldı" haberini socket
 * köprüsüne (`lib/realtime.js → registerActivityBridge`) taşır; içerik yok.
 *
 * Satır commit edildikten **sonra** yayınlanır (işlem içinde yazılan satır
 * `afterCommit` ile): panel haberi alıp satırı çektiğinde satır görünür olmalı.
 *
 * Süreç içidir (event bus gibi); çok örnekli kurulumda paylaşılan yayına taşınır.
 */

/** @typedef {{ id: string, hotelId: string, level: string }} ActivitySignal */

/** @type {Set<(signal: ActivitySignal) => void>} */
const listeners = new Set();

/**
 * @param {(signal: ActivitySignal) => void} listener
 * @returns {() => void} aboneliği kaldırır
 */
export function onActivity(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Yeni satır haberi. Dinleyici hatası yazanı etkilemez (akış bir izleme
 * aracıdır; aktörün işini düşürmemeli).
 * @param {ActivitySignal} signal
 */
export function publishActivity(signal) {
  for (const listener of listeners) {
    try {
      listener(signal);
    } catch {
      // Socket köprüsü hata verse de aktivite zaten yazıldı; panel bir sonraki
      // tazelemede görür.
    }
  }
}
