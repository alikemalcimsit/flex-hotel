const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Hex rengi saydamlığıyla yazar: `withAlpha('#EF4444', 0.2)` → `'#EF444433'`.
 *
 * Sektör renkleri veride hex olarak duruyor; kart önizlemesindeki ışıma,
 * rozet zemini ve anahtar izi aynı rengin saydam hâlini istiyor. Tailwind'in
 * `/20` yazımı derleme anında çözüldüğü için veriden gelen renge uygulanamıyor.
 *
 * Saydamlık 0–1 aralığına sıkıştırılır. Geçersiz renk sessizce yutulmaz:
 * veri statik, hatası testte yakalansın.
 *
 * @param {string} hex `#RGB` ya da `#RRGGBB`
 * @param {number} alpha 0 (tam saydam) – 1 (tam opak)
 * @returns {string} `#RRGGBBAA`
 */
export function withAlpha(hex, alpha) {
  const match = HEX_PATTERN.exec(hex ?? '')
  if (!match) throw new Error(`geçersiz hex renk: ${hex}`)

  const digits = match[1].length === 3 ? match[1].replace(/./g, (digit) => digit + digit) : match[1]
  const clamped = Math.min(1, Math.max(0, Number(alpha) || 0))
  const channel = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0')

  return `#${digits}${channel}`.toUpperCase()
}
