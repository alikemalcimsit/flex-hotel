import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asBusyError, BusyError, ConflictError, isRetryableTransactionError, rethrowPrismaError } from './errors.js';

/**
 * Yoğun saatte veritabanı hatalarının sınıflandırması: hangisi kullanıcıya
 * "yoğun" (503) olarak döner, hangisi sessizce yeniden denenir.
 */

describe('yoğunluk ve çakışma hataları', () => {
  it('havuz ve transaction zaman aşımı 503 "yoğun" olur', () => {
    for (const code of ['P2024', 'P2028']) {
      const busy = asBusyError(Object.assign(new Error('timeout'), { code }));
      assert.ok(busy instanceof BusyError, code);
      assert.equal(busy.statusCode, 503);
      assert.equal(busy.code, 'BUSY');
    }
    assert.equal(asBusyError(Object.assign(new Error('x'), { code: 'P2002' })), null);
    assert.throws(
      () => rethrowPrismaError(Object.assign(new Error('timeout'), { code: 'P2024' })),
      (error) => error instanceof BusyError,
    );
  });

  it('kilitlenme ve yazma çatışması yeniden denenir; iş kuralı hatası denenmez', () => {
    assert.equal(isRetryableTransactionError(Object.assign(new Error('x'), { code: 'P2034' })), true);
    assert.equal(
      isRetryableTransactionError(Object.assign(new Error('x'), { code: 'P2010', meta: { code: '40P01' } })),
      true,
    );
    assert.equal(isRetryableTransactionError(new Error('ERROR: deadlock detected')), true);
    assert.equal(isRetryableTransactionError(Object.assign(new Error('x'), { code: 'P2002' })), false);
    assert.equal(isRetryableTransactionError(new ConflictError('Oda dolu', 'ROOM_NOT_FREE')), false);
  });
});
