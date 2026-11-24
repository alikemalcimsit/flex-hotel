import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NAV_SECTIONS } from './navigation.js';

/**
 * Menü tanımı: her madde ve alt sayfa bir yola sahip — gruplu madde (alt sayfaları olan) de yolunu bölümün kökü olarak
 * taşır (kenar menü açık / etkin durumunu ve anahtarı ondan türetir; yoksa menü çizilemez).
 */

describe('menü', () => {
  it('her madde ve alt sayfanın yolu var; aynı bölümde yol tekrarlanmaz', () => {
    for (const section of NAV_SECTIONS) {
      const paths = section.items.map((item) => item.to);
      assert.ok(paths.every(Boolean), `${section.title}: yolu olmayan madde`);
      assert.equal(new Set(paths).size, paths.length, `${section.title}: aynı yol iki kez`);
      for (const item of section.items) assert.ok((item.children ?? []).every((child) => child.to), `${item.label}: yolu olmayan alt sayfa`);
    }
  });
});
