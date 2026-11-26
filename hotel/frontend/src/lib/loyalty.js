import { LOYALTY_CHANNEL } from './socket.js';
import { useLiveChannel } from './useLiveChannel.js';

export { pointsNumber, pointsText, pointsTone, signedPoints, tierProgress, tierTone } from './loyaltyFormat.js';

/**
 * Sadakat programı (modül 56): sorgu anahtarları ve canlı tazeleme. Hepsi `loyalty` kökünde: puan / seviye / ayar
 * haberi tek anahtarla üye listesini, hesap sayfasını, misafir kartı kutusunu ve rezervasyon kartını yeniler.
 */
export const loyaltyKeys = Object.freeze({
  all: ['loyalty'],
  settings: ['loyalty', 'settings'],
  /** @param {object} filters */
  accounts: (filters) => ['loyalty', 'accounts', filters],
  /** @param {string} accountId */
  account: (accountId) => ['loyalty', 'account', accountId],
  /** @param {string} accountId @param {number} page */
  transactions: (accountId, page) => ['loyalty', 'account', accountId, 'transactions', page],
  /** @param {string} guestId */
  guest: (guestId) => ['loyalty', 'guest', guestId],
  /** @param {string} reservationId */
  reservation: (reservationId) => ['loyalty', 'reservation', reservationId],
});

/** Liste sayfa boyutu (üyeler, hareketler). */
export const LOYALTY_PAGE_SIZE = 25;

/** İki tazeleme arası en kısa süre: gün sonu süre işinde art arda haber gelebilir. */
const LIVE_MIN_REFRESH_MS = 1_500;

/** Sadakat ekranı / kutusu açıkken puan, seviye ve ayar değişince tazelenir. */
export function useLoyaltyLive() {
  return useLiveChannel(LOYALTY_CHANNEL, { minIntervalMs: LIVE_MIN_REFRESH_MS, queryKeys: [loyaltyKeys.all] });
}
