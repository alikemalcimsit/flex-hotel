import { Fragment } from 'react';

/**
 * Oda planı ve odalar ekranlarının metin yardımcıları (modül 60).
 *
 * Sayılar: sözlükte `<anahtar>` (çoğul) ve `<anahtar>One` (tekil) eşi var — Türkçede ikisi aynı,
 * İngilizcede "1 night" / "2 nights".
 */

/**
 * @param {(key: string, vars?: object) => string} t @param {string} key ör. `roomPlan.shared.nights`
 * @param {number} count
 */
export function countText(t, key, count) {
  return t(count === 1 ? `${key}One` : key, { count });
}

/**
 * "2 yetişkin + 1 çocuk" (çocuk yoksa yalnız yetişkin).
 * @param {(key: string, vars?: object) => string} t @param {number} adults @param {number} children
 */
export function guestsText(t, adults, children) {
  const adultText = countText(t, 'roomPlan.shared.adults', adults);
  return children > 0 ? `${adultText} + ${countText(t, 'roomPlan.shared.children', children)}` : adultText;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Çevrilmiş cümlede kalan `{ad}` yer tutucularını React öğesiyle değiştirir (cümle bölünmeden kalın yazı vb.).
 * Düz değişkenleri önce `t(key, vars)` doldurur; burada yalnız `nodes`'taki adlar yerleşir.
 * @param {string} text @param {Record<string, import('react').ReactNode>} nodes
 */
export function richText(text, nodes) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const [token, name] = match;
    if (!(name in nodes)) continue;
    parts.push(text.slice(last, match.index), <Fragment key={`${name}-${match.index}`}>{nodes[name]}</Fragment>);
    last = match.index + token.length;
  }
  parts.push(text.slice(last));
  return parts;
}
