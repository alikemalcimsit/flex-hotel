import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APP_LOCALES } from '@hotelos/hotel-contracts';
import { NAV_SECTIONS } from '../layout/navigation.js';
import { getCurrentLocale, normalizeLocale, setCurrentLocale } from './current.js';
import { AREAS, DICTIONARIES } from './dictionaries.js';
import { mergeAreas, navKey, navSectionKey } from './keys.js';
import { interpolate, tNow, translate } from './translate.js';

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (text) => [...text.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();

describe('i18n sözlükleri', () => {
  it('her dilin alan dosyaları aynı', () => {
    for (const locale of APP_LOCALES) assert.deepEqual(Object.keys(AREAS[locale]).sort(), Object.keys(AREAS.tr).sort(), locale);
  });

  it('TR ve EN anahtar kümesi alan alan eşit', () => {
    for (const area of Object.keys(AREAS.tr)) {
      const tr = Object.keys(AREAS.tr[area]);
      const en = Object.keys(AREAS.en[area]);
      const missingInEn = tr.filter((key) => !en.includes(key));
      const extraInEn = en.filter((key) => !tr.includes(key));
      assert.deepEqual({ missingInEn, extraInEn }, { missingInEn: [], extraInEn: [] }, `alan "${area}"`);
    }
  });

  it('her anahtar kendi alan adıyla başlar, metin boş değil', () => {
    for (const locale of APP_LOCALES) {
      for (const [area, entries] of Object.entries(AREAS[locale])) {
        for (const [key, text] of Object.entries(entries)) {
          assert.ok(key.startsWith(`${area}.`), `${locale}/${area}: "${key}" alan adıyla başlamıyor`);
          assert.ok(typeof text === 'string' && text.trim(), `${locale}: "${key}" boş`);
        }
      }
    }
  });

  it('yer tutucular iki dilde aynı', () => {
    for (const [key, text] of Object.entries(DICTIONARIES.tr)) {
      assert.deepEqual(placeholders(DICTIONARIES.en[key]), placeholders(text), key);
    }
  });

  it('menü: bölüm kimlikleri tekil, her madde / alt sayfa ayrı anahtar alır', () => {
    const ids = NAV_SECTIONS.map((section) => section.id);
    assert.ok(ids.every(Boolean), 'kimliksiz bölüm');
    assert.equal(new Set(ids).size, ids.length);
    const keys = NAV_SECTIONS.flatMap((section) => [
      navSectionKey(section),
      ...section.items.flatMap((item) => [navKey(item), ...(item.children ?? []).map((child) => navKey(child, item))]),
    ]);
    assert.equal(new Set(keys).size, keys.length, 'iki menü girdisi aynı anahtarı alıyor');
    for (const key of keys) assert.ok(DICTIONARIES.en[key], `en/nav.js'te yok: ${key}`);
  });

  it('aynı anahtar iki alanda tanımlanamaz', () => {
    assert.throws(() => mergeAreas({ a: { 'x.y': '1' }, b: { 'x.y': '2' } }), /iki kez/);
  });
});

describe('translate', () => {
  const dictionaries = { tr: { 'a.only': 'Yalnız Türkçe', 'a.both': 'Merhaba {name}' }, en: { 'a.both': 'Hello {name}' } };

  it('seçili dil → Türkçe → yedek metin → anahtar', () => {
    assert.equal(translate('en', 'a.both', { name: 'Ada' }, undefined, dictionaries), 'Hello Ada');
    assert.equal(translate('en', 'a.only', undefined, undefined, dictionaries), 'Yalnız Türkçe');
    assert.equal(translate('en', 'a.missing', 'Yedek {n}', { n: 2 }, dictionaries), 'Yedek 2');
    assert.equal(translate('en', 'a.missing', undefined, undefined, dictionaries), 'a.missing');
    assert.equal(translate('tr', 'a.both', 'Kullanılmaz', { name: 'Ada' }, dictionaries), 'Merhaba Ada');
  });

  it('verilmeyen yer tutucu olduğu gibi kalır', () => {
    assert.equal(interpolate('{a} ve {b}', { a: 1 }), '1 ve {b}');
    assert.equal(interpolate('{a}', { a: 0 }), '0');
  });

  it('tNow etkin dili kullanır; desteklenmeyen dil Türkçeye düşer', () => {
    try {
      setCurrentLocale('en');
      assert.equal(tNow('common.today'), 'Today');
      setCurrentLocale('de');
      assert.equal(getCurrentLocale(), 'tr');
      assert.equal(tNow('common.today'), 'Bugün');
    } finally {
      setCurrentLocale('tr');
    }
    assert.equal(normalizeLocale('en-US'), 'en');
    assert.equal(normalizeLocale('fr'), null);
  });
});
