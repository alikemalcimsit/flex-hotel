/**
 * Canlı ekranların okuma önbelleği: **sürüm anahtarlı + tek uçuş (single-flight)**.
 *
 * ### Çözdüğü sorun
 *
 * Oda planı canlı bir ekran: bir odanın durumu değişince açık olan her panel
 * aynı anda kendi sorgusunu yeniler. 2500 açık panelde tek bir değişiklik,
 * saniyenin altında binlerce aynı hesaplama (her biri ~9 SQL) demektir.
 * Panellerin çoğu da aynı şeye bakar: bugün, 14 gün, 1. sayfa, filtre yok.
 *
 * ### Nasıl
 *
 * - Anahtar, otelin **canlı görünüm sürümünü** içerir (bkz. `live-version.js`).
 *   Envanteri değiştiren her event sürümü artırır; eski anahtar bir daha
 *   okunmaz. Yani önbellek bayat veri döndürmez — yalnızca "hiçbir şey
 *   değişmediyse aynı cevabı tekrar hesaplama" der.
 * - Aynı anahtar için süren bir hesaplama varsa yeni istek **onu bekler**,
 *   ikinci kez başlatmaz (tek uçuş). 2500 eşzamanlı istek → 1 hesaplama.
 * - Hatalar önbelleğe alınmaz: bir sonraki istek tekrar dener.
 * - Süre (TTL) ve kayıt sınırı, event'siz değişikliklere (elle SQL, seed)
 *   karşı güvenlik ağı ve bellek sınırıdır.
 *
 * ### Sınır
 *
 * Süreç içidir. Birden fazla backend örneği çalıştırılırsa her örnek kendi
 * önbelleğini tutar; event bus da süreç içi olduğu için tutarlılık aynı
 * kalır. Kuyruğa (Redis vb.) geçildiğinde sürüm sayacı oraya taşınır.
 */

/**
 * @template T
 * @param {{ ttlMs: number, maxEntries: number, now?: () => number }} options
 */
export function createReadCache({ ttlMs, maxEntries, now = Date.now }) {
  /** @type {Map<string, { promise: Promise<T>, expiresAt: number }>} */
  const entries = new Map();
  let hits = 0;
  let misses = 0;

  function prune(current) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= current) entries.delete(key);
    }
    // Map ekleme sırasını korur: en eski kayıtlar önce gider.
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  return {
    /**
     * @param {string} key
     * @param {() => Promise<T>} compute
     * @returns {Promise<T>}
     */
    get(key, compute) {
      const current = now();
      const hit = entries.get(key);
      if (hit && hit.expiresAt > current) {
        hits += 1;
        return hit.promise;
      }

      misses += 1;
      const promise = Promise.resolve().then(compute);
      entries.set(key, { promise, expiresAt: current + ttlMs });
      promise.catch(() => {
        // Yalnızca kendi kaydını sil: bu arada aynı anahtar yenilenmiş olabilir.
        if (entries.get(key)?.promise === promise) entries.delete(key);
      });
      if (entries.size > maxEntries) prune(current);
      return promise;
    },

    clear() {
      entries.clear();
    },

    stats() {
      return { entries: entries.size, hits, misses };
    },
  };
}
