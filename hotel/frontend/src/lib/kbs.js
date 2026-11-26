import { KBS_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

export { EMPTY_KBS_EXTRAS, KBS_EXTRA_KEYS, kbsExtrasBody, kbsExtrasForm, kbsRequiredExtras, kbsRoomText, kbsStateTone } from './kbsFormat.js';

/**
 * KBS kimlik bildirimi (modül 58): sorgu anahtarları ve canlı tazeleme. Hepsi `kbs` kökünde: bildirim / ayar haberi tek
 * anahtarla listeyi, ayrıntıyı, mutabakatı, ayarı ve rezervasyon kartını yeniler.
 */
export const kbsKeys = Object.freeze({
  all: ['kbs'],
  settings: ['kbs', 'settings'],
  summary: ['kbs', 'summary'],
  /** @param {object} filters */
  notifications: (filters) => ['kbs', 'notifications', filters],
  /** @param {string} notificationId */
  notification: (notificationId) => ['kbs', 'notification', notificationId],
  /** @param {string} reservationId */
  reservation: (reservationId) => ['kbs', 'reservation', reservationId],
});

/** Bildirim listesi sayfa boyutu. */
export const KBS_PAGE_SIZE = 25;

/** İki tazeleme arası en kısa süre: kuyruk art arda haber verebilir. */
const LIVE_MIN_REFRESH_MS = 1_500;

/** KBS ekranı / kartı açıkken bildirim ve ayar değişince tazelenir. */
export function useKbsLive() {
  return useLiveChannel(KBS_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [kbsKeys.all] });
}
