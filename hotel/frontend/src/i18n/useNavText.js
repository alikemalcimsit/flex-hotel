import { useMemo } from 'react';
import { navKey, navSectionKey } from './keys.js';
import { useT } from './index.jsx';

/**
 * Menü metinleri etkin dilde. `layout/navigation.js` etiketleri Türkçe kalır (kılavuz ve menü testleri onlara bakar);
 * gösterirken buradan geçer.
 *
 *   const nav = useNavText();
 *   nav.section(section)          → "Front office"
 *   nav.item(item)                → "Cash desk"
 *   nav.child(child, parentItem)  → "Exchange rates"
 *   nav.tabs('/kasa', childrenOf('/kasa', role, permissions)) → etiketleri çevrilmiş sekme listesi (TabNav için)
 */
export function useNavText() {
  const t = useT();
  return useMemo(() => {
    const item = (entry) => t(navKey(entry), entry.label);
    const child = (entry, parent) => t(navKey(entry, parent), entry.label);
    return {
      section: (section) => t(navSectionKey(section), section.title),
      item,
      child,
      tabs: (parentTo, list) => list.map((entry) => ({ ...entry, label: child(entry, { to: parentTo }) })),
    };
  }, [t]);
}
