import { INVENTORY_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

/**
 * Canlı envanter (oda planı, oda listesi): oda ve rezervasyon değişikliğinde
 * verilen sorguları tazeler. Davranış `useLiveChannel`'da.
 *
 * @param {unknown[][]} queryKeys Tazelenecek react-query anahtar önekleri
 * @returns {{ isLive: boolean, lastChangeAt: string | null }}
 */
export function useLiveInventory(queryKeys) {
  return useLiveChannel(INVENTORY_CHANNEL, { queryKeys });
}
