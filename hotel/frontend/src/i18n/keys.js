/**
 * Sözlük yardımcıları (saf; node testinden de kullanılır).
 */

/**
 * Sözleşmedeki Türkçe etiket tablosundan sözlük parçası: `fromLabels('cash.rateKind.', { FOREX_BUYING: 'Döviz alış' })`
 * → `{ 'cash.rateKind.FOREX_BUYING': 'Döviz alış' }`. Türkçe metin tek yerde (contracts) kalır.
 * @param {string} prefix @param {Record<string, string>} labels @returns {Record<string, string>}
 */
export function fromLabels(prefix, labels) {
  return Object.fromEntries(Object.entries(labels).map(([code, label]) => [`${prefix}${code}`, label]));
}

/**
 * Alan dosyalarını tek sözlükte birleştirir; aynı anahtar iki dosyada olursa hata (sessiz ezilme olmasın).
 * @param {Record<string, Record<string, string>>} areas alan adı → sözlük parçası @returns {Record<string, string>}
 */
export function mergeAreas(areas) {
  const merged = {};
  for (const [area, entries] of Object.entries(areas)) {
    for (const [key, text] of Object.entries(entries)) {
      if (key in merged) throw new Error(`i18n: "${key}" iki kez tanımlı (${area})`);
      merged[key] = text;
    }
  }
  return Object.freeze(merged);
}

/** Menü bölüm anahtarı. @param {{ id: string }} section */
export const navSectionKey = (section) => `nav.section.${section.id}`;

/**
 * Menü maddesi / alt sayfa anahtarı: yolun kendisi (`nav./kasa/kurlar`). Alt sayfa üst maddeyle aynı yoldaysa
 * (ör. "Teknik servis" › "Arızalar", ikisi de `/teknik-servis`) `#index` eklenir.
 * @param {{ to: string }} entry @param {{ to: string } | null} [parent]
 */
export const navKey = (entry, parent = null) => (parent && parent.to === entry.to ? `nav.${entry.to}#index` : `nav.${entry.to}`);
