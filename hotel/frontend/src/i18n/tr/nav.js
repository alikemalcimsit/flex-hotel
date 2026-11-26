import { NAV_SECTIONS } from '../../layout/navigation.js';
import { navKey, navSectionKey } from '../keys.js';

/**
 * Menü (Türkçe): `layout/navigation.js`'teki etiketlerden türetilir — Türkçe metin tek yerde. Yeni menü maddesi
 * eklenince yalnız `en/nav.js`'e İngilizcesi yazılır (anahtar eşitliği testi hatırlatır).
 */
function entries() {
  const pairs = [];
  for (const section of NAV_SECTIONS) {
    pairs.push([navSectionKey(section), section.title]);
    for (const item of section.items) {
      pairs.push([navKey(item), item.label]);
      for (const child of item.children ?? []) pairs.push([navKey(child, item), child.label]);
    }
  }
  return pairs;
}

export default Object.freeze(Object.fromEntries(entries()));
