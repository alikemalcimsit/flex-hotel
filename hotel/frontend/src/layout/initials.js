/**
 * Addan iki harflik baş harf ("Demo Otel" → "DO"): ilk ve son kelimenin ilk
 * harfi. Fotoğraf/logo yoksa avatar böyle dolar.
 *
 * Büyük harfe çevirme Türkçe kuralıyla ("irem" → "İ"); varsayılan
 * `toUpperCase` "i"yi "I" yapardı.
 *
 * @param {string | null | undefined} name
 * @returns {string} boş adda '?'
 */
export function initialsFor(name) {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]][0];
  const last = words.length > 1 ? [...words[words.length - 1]][0] : '';
  return `${first}${last}`.toLocaleUpperCase('tr-TR');
}
