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
  /** @type {Map<string, Promise<unknown>>} süren üretimler (tek uçuş) */
  #inflight = new Map();
  /**
   * Geçersiz kılma sayacı. Üretim başladığında okunur; bitene kadar herhangi
   * bir geçersiz kılma olduysa sonuç önbelleğe yazılmaz — üretim yazmadan
   * önceki veriyi okumuş olabilir ve bayat kopya TTL boyunca kalırdı.
   */
  #generation = 0;
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
   *
   * Aynı anahtar için süren bir üretim varsa yeni çağıran onu bekler (tek
   * uçuş): süresi dolan otel kaydını her istek ayrı ayrı sorgulamaz.
   *
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} producer
   * @param {number} [ttlMs]
   * @returns {Promise<T>}
   */
  async getOrSet(key, producer, ttlMs = DEFAULT_TTL_MS) {
    const cached = this.get(key);
    if (cached !== undefined) return /** @type {T} */ (cached);

    const running = this.#inflight.get(key);
    if (running) return /** @type {Promise<T>} */ (running);

    const generation = this.#generation;
    const promise = Promise.resolve()
      .then(producer)
      .then((value) => {
        if (generation === this.#generation) this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        if (this.#inflight.get(key) === promise) this.#inflight.delete(key);
      });
    this.#inflight.set(key, promise);
    return promise;
  }

  /**
   * Önekle eşleşen tüm anahtarları siler. Yazma işlemleri bunu çağırır.
   * Süren üretimler de bırakılır: sonraki okuma taze veriyle yeniden başlar.
   * @param {string} prefix
   * @returns {number} Silinen anahtar sayısı
   */
  invalidatePrefix(prefix) {
    this.#generation += 1;
    let removed = 0;
    for (const key of this.#store.keys()) {
      if (key.startsWith(prefix)) {
        this.#store.delete(key);
        removed += 1;
      }
    }
    for (const key of this.#inflight.keys()) {
      if (key.startsWith(prefix)) this.#inflight.delete(key);
    }
    return removed;
  }

  clear() {
    this.#generation += 1;
    this.#store.clear();
    this.#inflight.clear();
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
