import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVENT_CATALOG } from '@hotelos/core';
import { STAFF_ALERT_KINDS } from '@hotelos/hotel-contracts';

/**
 * Zil türleri iki yerde yazılı: sözleşmede (`STAFF_ALERT_KINDS`, ekran ve
 * süzgeç) ve olay kataloğunda (`staff.alert.raised` gövdesi). Biri eksik
 * kalırsa uyarı yazan transaction olay doğrulamasında düşer — modül 15'in
 * `FOLIO_ATTENTION`'ı böyle kaçtı (çıkıştan sonra bakiye uyarısı atılamıyordu).
 */
describe('zil türleri', () => {
  it('olay kataloğu sözleşmedeki bütün türleri kabul eder', () => {
    const catalogKinds = EVENT_CATALOG['staff.alert.raised'].shape.kind.options;
    assert.deepEqual([...catalogKinds].sort(), [...STAFF_ALERT_KINDS].sort());
  });
});
