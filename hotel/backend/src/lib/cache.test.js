import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TtlCache } from './cache.js';

/**
 * Süreç içi TTL önbelleği: 2500 eşzamanlı istekte tek sorgu ve yazma
 * sonrasında bayat kopya kalmaması.
 */

/** Dışarıdan çözülen söz. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('TtlCache', () => {
  it('süresi dolmuş anahtarı eşzamanlı isteyenler tek üretimi bekler', async () => {
    const cache = new TtlCache();
    const gate = deferred();
    let calls = 0;
    const producer = async () => {
      calls += 1;
      await gate.promise;
      return 'otel';
    };

    const waiting = Array.from({ length: 2500 }, () => cache.getOrSet('tenant', producer));
    gate.resolve();
    assert.deepEqual(new Set(await Promise.all(waiting)), new Set(['otel']));
    assert.equal(calls, 1);
    assert.equal(await cache.getOrSet('tenant', producer), 'otel');
    assert.equal(calls, 1);
  });

  it('üretim sürerken geçersiz kılınan anahtar eski değerle doldurulmaz', async () => {
    const cache = new TtlCache();
    const gate = deferred();
    const firstRead = deferred();
    let version = 'eski';
    const producer = async () => {
      const read = version;
      firstRead.resolve();
      await gate.promise;
      return read;
    };

    const early = cache.getOrSet('settings:h1:hotel', producer);
    await firstRead.promise;
    // Yazma commit oldu, olay önbelleği temizledi; okuma hâlâ sürüyor.
    version = 'yeni';
    cache.invalidatePrefix('settings:h1:');
    gate.resolve();

    assert.equal(await early, 'eski', 'yazmadan önce başlayan okuma eski veriyi görebilir');
    assert.equal(await cache.getOrSet('settings:h1:hotel', producer), 'yeni', 'ama önbelleğe yazamaz');
  });

  it('hata önbelleğe alınmaz, sonraki istek yeniden dener', async () => {
    const cache = new TtlCache();
    let calls = 0;
    const producer = async () => {
      calls += 1;
      if (calls === 1) throw new Error('bağlantı koptu');
      return 42;
    };
    await assert.rejects(() => cache.getOrSet('k', producer), /bağlantı/);
    assert.equal(await cache.getOrSet('k', producer), 42);
  });
});
