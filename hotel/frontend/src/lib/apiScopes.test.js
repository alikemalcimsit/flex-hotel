import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apiKeyCreateSchema } from '@hotelos/hotel-contracts';
import { toggleScope } from './apiScopes.js';

describe('anahtar kapsam seçimi', () => {
  it('yazma seçilince okuma ve müsaitlik eklenir; gereksinim kaldırılınca yazma da kalkar; sıra katalogdaki', () => {
    assert.deepEqual(toggleScope([], 'reservations:write', true), ['availability:read', 'reservations:read', 'reservations:write']);
    assert.deepEqual(toggleScope(['availability:read', 'reservations:read', 'reservations:write'], 'reservations:read', false), ['availability:read']);
    assert.deepEqual(toggleScope(['guests:read'], 'availability:read', true), ['availability:read', 'guests:read']);
    assert.deepEqual(toggleScope(['availability:read', 'guests:read'], 'guests:read', false), ['availability:read']);
  });

  it('formun ürettiği her seçim sunucu şemasından geçer', () => {
    let scopes = [];
    for (const [scope, on] of [['reservations:write', true], ['guests:read', true], ['availability:read', false], ['reservations:read', true]]) {
      scopes = toggleScope(scopes, scope, on);
      if (scopes.length) assert.equal(apiKeyCreateSchema.safeParse({ name: 'k', scopes }).success, true, scopes.join(','));
    }
  });
});
