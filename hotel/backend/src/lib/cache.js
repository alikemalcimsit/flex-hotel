/**
 * Süreç içi TTL cache.
 *
 * Neden var: oda tipleri, vergiler ve sezonlar nadiren değişir ama fiyat hesabı
 * bunları her rezervasyonda okur. Dolu bir otelde bu, saniyede onlarca gereksiz
 * sorgu demektir. Yazma işlemleri ilgili öneki (prefix) geçersiz kılar, yani
 * cache bayat veri servis etmez.
 *
 * Bilinçli sınır: tek süreç içindir. Backend çok örnekli (multi-instance)
 * çalıştırılacaksa bu katmanın Redis'e taşınması gerekir — o güne kadar
 * arayüz aynı kalacak şekilde yazıldı.
 */

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 5_000;

export class TtlCache {
  #store = new Map();
  #maxEntries;
  #hits = 0;
  #misses = 0;

  /** @param {{ maxEntries?: number }} [options] */
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
    this.#maxEntries = maxEntries;
  }

  /**
   * @param {string} key
   * @returns {unknown | undefined} Süresi dolmuşsa undefined
   */
  get(key) {
    const entry = this.#store.get(key);
    if (!entry) {
      this.#misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.#store.delete(key);
      this.#misses += 1;
      return undefined;
    }
    this.#hits += 1;
    return entry.value;
  }

  /**
   * @param {string} key
   * @param {unknown} value
   * @param {number} [ttlMs]
   */
  set(key, value, ttlMs = DEFAULT_TTL_MS) {
    // Map ekleme sırasını korur; kapasite dolunca en eski giren atılır.
    if (this.#store.size >= this.#maxEntries && !this.#store.has(key)) {
      const oldestKey = this.#store.keys().next().value;
      if (oldestKey !== undefined) this.#store.delete(oldestKey);
    }
    this.#store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Cache'te varsa döner, yoksa üretici fonksiyonu çalıştırıp saklar.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} producer
   * @param {number} [ttlMs]
   * @returns {Promise<T>}
   */
  async getOrSet(key, producer, ttlMs = DEFAULT_TTL_MS) {
    const cached = this.get(key);
    if (cached !== undefined) return /** @type {T} */ (cached);
    const value = await producer();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Önekle eşleşen tüm anahtarları siler. Yazma işlemleri bunu çağırır.
   * @param {string} prefix
   * @returns {number} Silinen anahtar sayısı
   */
  invalidatePrefix(prefix) {
    let removed = 0;
    for (const key of this.#store.keys()) {
      if (key.startsWith(prefix)) {
        this.#store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear() {
    this.#store.clear();
  }

  /** Sağlık ekranı / Activity Feed için ölçüm. */
  stats() {
    const total = this.#hits + this.#misses;
    return {
      entries: this.#store.size,
      hits: this.#hits,
      misses: this.#misses,
      hitRate: total === 0 ? 0 : Number((this.#hits / total).toFixed(4)),
    };
  }
}

/** Uygulama genelinde tek cache. Anahtar formatı: `<alan>:<hotelId>:<detay>`. */
export const cache = new TtlCache();

/**
 * Bir otelin ayar verisini komple geçersiz kılar.
 * @param {string} hotelId
 */
export function invalidateHotelSettings(hotelId) {
  return cache.invalidatePrefix(`settings:${hotelId}:`);
}
