/**
 * Süreç içi jeton kovası (web chat: bağlantı ve mesaj sınırı).
 *
 * Herkese açık bir uçta (otelin web sitesi) tek bir kişinin sunucuyu ya da
 * AI bütçesini tüketmesi engellenir. Bellek sınırlı: izlenen anahtar sayısı
 * `maxKeys`'i aşınca en eski anahtar atılır (Map ekleme sırasını korur).
 *
 * @param {{ capacity: number, refillPerSecond: number, maxKeys?: number, now?: () => number }} options
 */
export function createRateLimiter({ capacity, refillPerSecond, maxKeys = 50_000, now = () => Date.now() }) {
  /** @type {Map<string, { tokens: number, at: number }>} */
  const buckets = new Map();

  return {
    /**
     * Bir jeton harcar; kalmadıysa false.
     * @param {string} key
     */
    take(key) {
      const time = now();
      let bucket = buckets.get(key);
      if (bucket) {
        buckets.delete(key); // en sona taşı (en son kullanılan)
        const refill = ((time - bucket.at) / 1000) * refillPerSecond;
        bucket = { tokens: Math.min(capacity, bucket.tokens + refill), at: time };
      } else {
        bucket = { tokens: capacity, at: time };
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
      }
      const allowed = bucket.tokens >= 1;
      if (allowed) bucket.tokens -= 1;
      buckets.set(key, bucket);
      return allowed;
    },
    size: () => buckets.size,
  };
}
