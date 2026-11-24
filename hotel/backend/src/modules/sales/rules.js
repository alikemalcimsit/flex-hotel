import { ValidationError } from '../../lib/errors.js';

/**
 * Satış CRM kuralları (modül 36) — veritabanı bilmez. Fırsat panosunun durum
 * geçişleri ve teklif yaşam döngüsü burada tek yerde: ekran da sunucu da aynı
 * kurala bakar.
 */

/** Teklif kodunda okunurken karışmayan harfler (onay koduyla aynı ilke). */
const QUOTE_CODE_ALPHABET = 'ACDEFHJKMNPQRTUVWXY347';
const QUOTE_CODE_LENGTH = 6;

/**
 * @param {(size: number) => Uint8Array} randomBytes kriptografik rastgele bayt üreticisi
 * @returns {string} ör. "TKF-K7QXNA"
 */
export function generateQuoteCode(randomBytes) {
  const limit = 256 - (256 % QUOTE_CODE_ALPHABET.length);
  let code = '';
  while (code.length < QUOTE_CODE_LENGTH) {
    for (const byte of randomBytes(QUOTE_CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      code += QUOTE_CODE_ALPHABET[byte % QUOTE_CODE_ALPHABET.length];
      if (code.length === QUOTE_CODE_LENGTH) break;
    }
  }
  return `TKF-${code}`;
}

/**
 * Pano durum geçişleri. WON elle verilmez (yalnız teklif kabulü), kapanmış
 * fırsat (WON/LOST) panoda taşınmaz — raporlar sonuçların elle oynanmamasına
 * güvenir.
 */
const LEAD_TRANSITIONS = Object.freeze({
  NEW: ['QUOTED', 'WAITING', 'LOST'],
  QUOTED: ['WAITING', 'LOST'],
  WAITING: ['QUOTED', 'LOST'],
  WON: [],
  LOST: [],
});

/**
 * @param {string} current
 * @param {string} next
 */
export function assertLeadTransition(current, next) {
  if (current === next) return;
  if (next === 'WON') {
    throw new ValidationError('Fırsat elle "kazanıldı" yapılamaz; teklifi kabul edin (rezervasyon açılır).', { field: 'status' });
  }
  if (!(LEAD_TRANSITIONS[current] ?? []).includes(next)) {
    throw new ValidationError(`"${current}" durumundan "${next}" durumuna geçilemez.`, { field: 'status' });
  }
}

/** Teklif yaşam döngüsü: taslak düzenlenir/gönderilir; gönderilen karar alır. */
const QUOTE_TRANSITIONS = Object.freeze({
  DRAFT: ['SENT'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
});

/**
 * @param {string} current
 * @param {string} next
 */
export function assertQuoteTransition(current, next) {
  if (!(QUOTE_TRANSITIONS[current] ?? []).includes(next)) {
    const messages = {
      DRAFT: 'Taslak teklif önce gönderilmeli.',
      ACCEPTED: 'Kabul edilmiş teklif değiştirilemez.',
      REJECTED: 'Reddedilmiş teklif değiştirilemez.',
      EXPIRED: 'Süresi dolmuş teklif değiştirilemez; yeni teklif hazırlayın.',
    };
    throw new ValidationError(messages[current] ?? `"${current}" → "${next}" geçişi geçersiz.`, { field: 'status' });
  }
}

/**
 * Fırsat adını misafir kartı alanlarına böler ("Ahmet Yılmaz" → ad + soyad;
 * tek kelime soyadsız kalmasın diye "—").
 * @param {string} name
 */
export function splitLeadName(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '—' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) };
}
