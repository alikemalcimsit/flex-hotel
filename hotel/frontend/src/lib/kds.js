import { KDS_LATE_MINUTES, KDS_WARN_MINUTES } from '@hotelos/hotel-contracts';

/**
 * Mutfak ekranı / KDS (modül 40): yol, kart rengi, kart düğmeleri ve sayaçlar.
 * Saf kurallar burada (tarayıcısız test edilir); sorgu kancaları `kdsQueries.js`'te.
 *
 * Süre turun mutfağa düştüğü andan (`sentAt`) sayılır; eşikler sözleşmede
 * (`KDS_WARN_MINUTES` / `KDS_LATE_MINUTES`). Hazır tur süreden bağımsız yeşildir:
 * mutfağın işi bitmiştir, bekleyen garsondur.
 */

export const KDS_PATH = '/pos/mutfak-ekrani';

/** @param {string} sentAt ISO @param {number} now ms */
export const waitedMinutes = (sentAt, now) => Math.max(0, Math.floor((now - Date.parse(sentAt)) / 60_000));

/**
 * @param {{ status: string, sentAt: string }} card
 * @param {number} now ms
 * @returns {'new' | 'preparing' | 'warn' | 'late' | 'ready'}
 */
export function cardTone(card, now) {
  if (card.status === 'READY') return 'ready';
  const minutes = waitedMinutes(card.sentAt, now);
  if (minutes >= KDS_LATE_MINUTES) return 'late';
  if (minutes >= KDS_WARN_MINUTES) return 'warn';
  return card.status === 'PREPARING' ? 'preparing' : 'new';
}

const START = Object.freeze({ status: 'PREPARING', label: 'Başla', icon: 'play', variant: 'outline' });
const READY = Object.freeze({ status: 'READY', label: 'Hazır', icon: 'checkCircle', variant: 'primary' });
const SERVED = Object.freeze({ status: 'SERVED', label: 'Servis edildi', icon: 'checkCheck', variant: 'outline' });

/**
 * Teslimli tur: oda servisi (modül 41) ya da paket servis (modül 42) — mutfakta
 * "hazır"da biter, teslim kendi panosunun işidir.
 * @param {{ roomService?: object | null, delivery?: object | null }} card
 */
const isHandoffCard = (card) => Boolean(card.roomService || card.delivery);

/**
 * Kartın düğmeleri (sunucu kuralının karşılığı; sunucu yine denetler). Oda
 * servisi ve paket turu hazırda biter: teslim kendi panosunun işidir.
 * @param {{ status: string, roomService: object | null, delivery?: object | null }} card
 */
export function kdsActions(card) {
  if (card.status === 'NEW') return [START, READY];
  if (card.status === 'PREPARING') return [READY];
  if (card.status === 'READY' && !isHandoffCard(card)) return [SERVED];
  return [];
}

/**
 * Üst sayaçlar: durum başına tur sayısı ve geciken (hazır olmayan) turlar.
 * @param {Array<{ status: string, sentAt: string }>} cards @param {number} now ms
 */
export function boardSummary(cards, now) {
  return cards.reduce(
    (summary, card) => ({
      ...summary,
      [card.status]: (summary[card.status] ?? 0) + 1,
      late: summary.late + (cardTone(card, now) === 'late' ? 1 : 0),
    }),
    { NEW: 0, PREPARING: 0, READY: 0, late: 0 },
  );
}
