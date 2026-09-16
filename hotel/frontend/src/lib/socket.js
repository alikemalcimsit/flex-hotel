import { io } from 'socket.io-client';
import { API_URL } from './api.js';

/**
 * Tek socket bağlantısı — canlı ekranlar (oda planı, ileride Activity Feed)
 * bunu paylaşır.
 *
 * Yeniden bağlanma açık ve üstel geri çekilmeli: sunucu yeniden başlatıldığında
 * ya da ağ bir an koptuğunda panel kendiliğinden toparlanmalı, ama kapalı bir
 * sunucuya saniyede onlarca kez vurmamalı.
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

export const socket = io(apiOrigin, {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10_000,
});

/** Backend'in canlı değişiklik kanalı (bkz. `lib/realtime.js`). */
export const INVENTORY_CHANNEL = 'inventory.changed';
