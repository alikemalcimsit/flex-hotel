import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MIN_PASSWORD_LENGTH, resetPasswordSchema, updateUserSchema, userInputSchema } from './users.js';

describe('userInputSchema', () => {
  it('geçerli girdiyi kabul eder, e-postayı küçük harfe çevirir, aktif varsayılanı true', () => {
    const result = userInputSchema.parse({ email: 'A@B.CO', name: ' Ali ', role: 'FRONT_DESK', password: 'parola12' });
    assert.equal(result.email, 'a@b.co');
    assert.equal(result.name, 'Ali');
    assert.equal(result.isActive, true);
  });

  it(`${MIN_PASSWORD_LENGTH} karakterden kısa şifreyi reddeder`, () => {
    const result = userInputSchema.safeParse({ email: 'a@b.co', name: 'X', role: 'ADMIN', password: 'kisa' });
    assert.equal(result.success, false);
  });

  it('geçersiz rolü reddeder', () => {
    const result = userInputSchema.safeParse({ email: 'a@b.co', name: 'X', role: 'KRAL', password: 'parola12' });
    assert.equal(result.success, false);
  });
});

describe('updateUserSchema', () => {
  it('isActive ve expectedUpdatedAt olmadan reddedilir', () => {
    assert.equal(updateUserSchema.safeParse({ email: 'a@b.co', name: 'X', role: 'ADMIN' }).success, false);
  });

  it('tam girdiyi kabul eder', () => {
    const result = updateUserSchema.safeParse({
      email: 'a@b.co',
      name: 'X',
      role: 'ADMIN',
      isActive: true,
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(result.success, true);
  });
});

describe('resetPasswordSchema', () => {
  it('kısa şifreyi reddeder, uzun şifreyi kabul eder', () => {
    assert.equal(resetPasswordSchema.safeParse({ password: 'x' }).success, false);
    assert.equal(resetPasswordSchema.safeParse({ password: 'uzunparola' }).success, true);
  });
});
