import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as index from './index.js';

/**
 * `export *` aynı adı açan iki modülde o adı hata vermeden **dışarıda bırakır** (ya da index'teki açık
 * bir adla gölgeler): modül 43'te `MAX_LINE_QUANTITY` (rezervasyon / reçete) böyle kayboldu, talep
 * notunun sınırı istek notununkine düştü. Her yıldızla açılan modülün her adı index'ten aynı değerle
 * gelmeli.
 */
/**
 * Bilinen, zararsız tekrar: aynı şema iki modülde birebir aynı tanımlı, index açıkça `plan.js`'tekini verir.
 * Yeni ad buraya eklenmez — çakışan ad yeniden adlandırılır.
 */
const KNOWN_SHADOWED = Object.freeze({ 'reservations.js': ['reservationParamSchema'] });

describe('sözleşme dizini', () => {
  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const starred = [...source.matchAll(/export \* from '\.\/([\w-]+\.js)';/g)].map((match) => match[1]);

  it('yıldızla açılan modüller bulundu', () => {
    assert.ok(starred.length >= 20, `yalnız ${starred.length} modül`);
  });

  for (const file of starred) {
    it(`${file}: her ad index'ten aynı değerle gelir (çakışma / gölgeleme yok)`, async () => {
      const module = await import(`./${file}`);
      const lost = Object.entries(module)
        .filter(([name, value]) => index[name] !== value && !(KNOWN_SHADOWED[file] ?? []).includes(name))
        .map(([name]) => name);
      assert.deepEqual(lost, [], `${file}: ${lost.join(', ')} index'ten erişilemiyor ya da başka modülün değeri geliyor`);
    });
  }
});
