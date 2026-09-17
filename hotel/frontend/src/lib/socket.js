import { io } from 'socket.io-client';
import { API_URL } from './api.js';
import { useAuthStore } from '../store/auth.js';

/**
 * Tek socket bağlantısı — canlı ekranlar (oda planı, gelen kutusu, istekler,
 * zil) bunu paylaşır.
 *
 * Yeniden bağlanma açık ve üstel geri çekilmeli: sunucu yeniden başlatıldığında
 * ya da ağ bir an koptuğunda panel kendiliğinden toparlanmalı, ama kapalı bir
 * sunucuya saniyede onlarca kez vurmamalı. Bekleme rastgele saptırılır:
 * sunucu açılırken 2500 panel aynı saniyede kapıya yığılmasın.
 */
/**
 * ⚠️ Adresin yalnızca kökü verilir, yolu değil.
 *
 * `io('https://hotel.flexai.tr/api')` çağrısında socket.io `/api` kısmını
 * **namespace** sayar ve sunucuda olmayan bir namespace'e bağlanmaya çalışır;
 * bağlantı sessizce kurulmaz (panel "canlı değil"de kalır, üretimde tam olarak
 * bu oldu). Taşıma yolu her iki ortamda da kökteki `/socket.io`: üretimde
 * nginx'in websocket yükseltmesi tanımlı olan konumu burasıdır.
 */
const apiOrigin = new URL(API_URL, globalThis.location?.origin ?? 'http://localhost').origin;

const currentActor = () => useAuthStore.getState().user?.email ?? null;

export const socket = io(apiOrigin, {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10_000,
  randomizationFactor: 0.5,
  // Sunucu kişiyi bununla tanır ve zili yalnızca ona yollar (bkz. backend
  // `lib/realtime.js`). Her bağlantı denemesinde güncel kimlik okunur.
  auth: (callback) => callback({ actor: currentActor() }),
});

/** Backend'in canlı değişiklik kanalları (bkz. backend `lib/realtime.js`). */
export const INVENTORY_CHANNEL = 'inventory.changed';
export const MESSAGING_CHANNEL = 'messaging.changed';
export const REQUESTS_CHANNEL = 'requests.changed';
export const NOTIFICATIONS_CHANNEL = 'notifications.changed';
export const STAFF_ALERTS_CHANNEL = 'staff.alerts';
export const APPROVALS_CHANNEL = 'approvals.changed';

/**
 * Kanal aboneliği sayacı. Aynı kanalı birden fazla bileşen dinleyebilir
 * (yan menü rozeti + açık sayfa); sunucuya abonelik ilk dinleyicide gider,
 * son dinleyici ayrılınca bırakılır. Yeniden bağlanınca hepsi tekrar istenir.
 * Zil kanalı abonelik istemez: sunucu onu kimliğe göre yollar.
 *
 * @type {Map<string, number>}
 */
const retained = new Map();

/** @param {string} channel */
export function retainChannel(channel) {
  const count = retained.get(channel) ?? 0;
  retained.set(channel, count + 1);
  if (count === 0 && socket.connected) socket.emit('subscribe', [channel]);
}

/** @param {string} channel */
export function releaseChannel(channel) {
  const count = retained.get(channel) ?? 0;
  if (count > 1) {
    retained.set(channel, count - 1);
    return;
  }
  retained.delete(channel);
  if (count === 1 && socket.connected) socket.emit('unsubscribe', [channel]);
}

socket.on('connect', () => {
  if (retained.size > 0) socket.emit('subscribe', [...retained.keys()]);
});

/**
 * Sunucunun son bildirdiği yayılma süresi (otelde kaç panel bağlı). Yeniden
 * bağlanınca yapılan tam tazeleme bu süreye rastgele yayılır.
 */
let readySpreadMs = 0;
socket.on('ready', (payload) => {
  readySpreadMs = Number(payload?.spreadMs) || 0;
});

/** @returns {number} */
export const connectSpreadMs = () => readySpreadMs;

/** Oturum açan kişi değişince zil odaları yeni kişiye göre kurulsun. */
let lastActor = currentActor();
useAuthStore.subscribe((state) => {
  const actor = state.user?.email ?? null;
  if (actor === lastActor) return;
  lastActor = actor;
  if (socket.connected || socket.active) {
    socket.disconnect();
    socket.connect();
  }
});
