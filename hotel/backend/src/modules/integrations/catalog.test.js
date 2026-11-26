import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVENT_CATALOG } from '@hotelos/core';
import { PUBLIC_API_ROUTES, WEBHOOK_SOURCE_EVENTS } from '@hotelos/hotel-contracts';
import { assertPublicApiHandlers } from '../public-api/routes.js';

/**
 * Webhook olaylarının kaynağı iç olay kataloğudur: katalogda adı değişen / kalkan bir olay dışarıya sessizce
 * gitmemeye başlardı. Açık API tablosundaki her ucun işleyicisi olmalı (yoksa sunucu açılmaz).
 */
describe('webhook ve açık API kataloğu', () => {
  it('dinlenen her iç olay olay kataloğunda var', () => {
    for (const name of WEBHOOK_SOURCE_EVENTS) assert.ok(EVENT_CATALOG[name], `${name} katalogda yok`);
  });

  it('açık API tablosu ile işleyiciler birebir; eksik / fazla işleyici açılışı durdurur', () => {
    assert.doesNotThrow(() => assertPublicApiHandlers());
    assert.throws(() => assertPublicApiHandlers([...PUBLIC_API_ROUTES, { id: 'yeniUc' }]), /eksik: yeniUc/);
    assert.throws(() => assertPublicApiHandlers(PUBLIC_API_ROUTES.slice(1)), /fazla: getHotel/);
  });
});
