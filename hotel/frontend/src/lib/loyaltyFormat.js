/**
 * Sadakat programı (modül 56) saf yardımcıları: puan metni, işaretli puan, seviye rozet tonu, ilerleme oranı.
 * Sorgu / canlı kanal içermez; node testiyle denenir (`loyaltyFormat.test.js`).
 */

const pointsFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** Rozet tonları seviye sırasına göre (en düşük seviye nötr). */
const TIER_TONES = Object.freeze(['neutral', 'sky', 'warning', 'violet', 'success', 'info']);
/** Seviye listesi elde yoksa bilinen varsayılan kodların tonu. */
const KNOWN_TIER_TONES = Object.freeze({ CLASSIC: 'neutral', MEMBER: 'neutral', SILVER: 'sky', GOLD: 'warning', PLATINUM: 'violet' });

/** Puan sayısı: 1250 → "1.250". @param {number | string | null | undefined} points */
export const pointsNumber = (points) => pointsFormatter.format(Math.trunc(Number(points ?? 0)) || 0);

/** Puan metni: 1250 → "1.250 puan". @param {number | string | null | undefined} points */
export const pointsText = (points) => `${pointsNumber(points)} puan`;

/** İşaretli puan: 120 → "+120", -50 → "−50", 0 → "0". @param {number} points */
export function signedPoints(points) {
  const value = Math.trunc(Number(points ?? 0)) || 0;
  if (value > 0) return `+${pointsNumber(value)}`;
  if (value < 0) return `−${pointsNumber(-value)}`;
  return '0';
}

/** Hareket puanının yazı rengi (artı yeşil, eksi kırmızı). @param {number} points */
export const pointsTone = (points) => (points > 0 ? 'text-success-ink' : points < 0 ? 'text-sec-strong' : 'text-ink-muted');

/**
 * Seviye rozetinin tonu: seviye listesi verilirse sırasına göre, yoksa bilinen koda göre.
 * @param {string | null | undefined} code
 * @param {Array<{ code: string, minPoints: number }>} [tiers]
 */
export function tierTone(code, tiers = []) {
  if (!code) return 'neutral';
  const ordered = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
  const index = ordered.findIndex((tier) => tier.code === code);
  if (index >= 0) return TIER_TONES[Math.min(index, TIER_TONES.length - 1)];
  return KNOWN_TIER_TONES[code] ?? 'info';
}

/**
 * Sonraki seviyeye ilerleme yüzdesi (0–100): bu seviyede geçen puan / iki eşik arası.
 * @param {number} qualifyingPoints @param {number} toNext sonraki seviyeye kalan
 * @param {number} [currentMin] bulunduğu seviyenin eşiği (bilinmiyorsa 0)
 */
export function tierProgress(qualifyingPoints, toNext, currentMin = 0) {
  if (!toNext || toNext <= 0) return 100;
  const span = qualifyingPoints - currentMin + toNext;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((qualifyingPoints - currentMin) / span) * 100)));
}
