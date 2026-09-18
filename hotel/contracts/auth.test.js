import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loginSchema, refreshSchema } from './auth.js';

describe('loginSchema', () => {
  it('e-postayı küçük harfe çevirir ve kırpar', () => {
    const result = loginSchema.parse({ email: '  Admin@Hotel.Local ', password: 'gizli' });
    assert.equal(result.email, 'admin@hotel.local');
  });

  it('geçersiz e-postayı reddeder', () => {
    assert.equal(loginSchema.safeParse({ email: 'bozuk', password: 'x' }).success, false);
  });

  it('boş şifreyi reddeder', () => {
    assert.equal(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success, false);
  });
});

describe('refreshSchema', () => {
  it('boş token reddedilir', () => {
    assert.equal(refreshSchema.safeParse({ refreshToken: '' }).success, false);
  });

  it('dolu token kabul edilir', () => {
    assert.equal(refreshSchema.safeParse({ refreshToken: 'abc' }).success, true);
  });
});
