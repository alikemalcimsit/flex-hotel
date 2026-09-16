import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createReadCache } from './read-cache.js';

/**
 * Canlı ekran önbelleği. Bu yanlış çalışırsa ya binlerce panel aynı sorguyu
 * tekrar tekrar çalıştırır ya da bir panel başkasının eski cevabını görür.
 */

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('createReadCache', () => {
  it('aynı anahtarla eşzamanlı istekler tek hesaplama başlatır', async () => {
    const cache = createReadCache({ ttlMs: 1000, maxEntries: 10 });
    const gate = deferred();
    let calls = 0;
    const compute = () => {
      calls += 1;
      return gate.promise;
    };

    const waiting = Array.from({ length: 50 }, () => cache.get('otel:v1:bugün', compute));
    gate.resolve({ rows: 20 });
    const results = await Promise.all(waiting);

    assert.equal(calls, 1);
    assert.ok(results.every((result) => result.rows === 20));
  });

  it('farklı sürüm farklı anahtardır: değişiklikten sonra yeniden hesaplanır', async () => {
    const cache = createReadCache({ ttlMs: 60_000, maxEntries: 10 });
    let calls = 0;
    const compute = async () => ++calls;

    assert.equal(await cache.get('otel:v1', compute), 1);
    assert.equal(await cache.get('otel:v1', compute), 1);
    assert.equal(await cache.get('otel:v2', compute), 2);
  });

  it('süresi dolan kayıt yeniden hesaplanır', async () => {
    let clock = 0;
    const cache = createReadCache({ ttlMs: 100, maxEntries: 10, now: () => clock });
    let calls = 0;
    const compute = async () => ++calls;

    await cache.get('k', compute);
    clock = 99;
    await cache.get('k', compute);
    clock = 100;
    await cache.get('k', compute);
    assert.equal(calls, 2);
  });

  it('hata önbelleğe alınmaz, sonraki istek yeniden dener', async () => {
    const cache = createReadCache({ ttlMs: 60_000, maxEntries: 10 });
    let calls = 0;
    const compute = async () => {
      calls += 1;
      if (calls === 1) throw new Error('veritabanı meşgul');
      return 'ok';
    };

    await assert.rejects(() => cache.get('k', compute), /meşgul/);
    assert.equal(await cache.get('k', compute), 'ok');
  });

  it('kayıt sınırı aşılınca en eski kayıt düşer', async () => {
    const cache = createReadCache({ ttlMs: 60_000, maxEntries: 2 });
    let calls = 0;
    const compute = async () => ++calls;

    await cache.get('a', compute);
    await cache.get('b', compute);
    await cache.get('c', compute);
    assert.equal(cache.stats().entries, 2);
    await cache.get('a', compute);
    assert.equal(calls, 4, '"a" düşmüştü, yeniden hesaplandı');
  });
});
