/**
 * CRM'in saf hesapları (modül 22). Veritabanı yok: birim testlenir.
 */

/**
 * İki etiket listesini birleştirir: sıra korunur, tekrarlar (büyük/küçük harf
 * duyarsız) atılır. Hedefin etiketleri önce gelir.
 *
 * @param {string[]} targetTags @param {string[]} sourceTags
 * @returns {string[]}
 */
export function mergeTags(targetTags = [], sourceTags = []) {
  const seen = new Set();
  const result = [];
  for (const tag of [...targetTags, ...sourceTags]) {
    // Düz toLowerCase: "VIP" gibi kısaltmalarda Türkçe I→ı ("vıp") eşleşmeyi bozardı.
    const key = tag.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(tag.trim());
  }
  return result;
}
