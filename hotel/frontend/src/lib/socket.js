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
export const socket = io(API_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10_000,
});

/** Backend'in canlı değişiklik kanalı (bkz. `lib/realtime.js`). */
export const INVENTORY_CHANNEL = 'inventory.changed';
