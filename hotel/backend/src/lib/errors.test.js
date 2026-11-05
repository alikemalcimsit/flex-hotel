import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError, asBusyError, bulkItemFailure, BusyError, ConflictError, isRetryableTransactionError, NotFoundError, rethrowPrismaError, ValidationError } from './errors.js';

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

describe('iş kuralı doğrulama hatası', () => {
  it('tek alan ya da alan → mesaj sözlüğü formun alanına bağlanır', () => {
    assert.deepEqual(new ValidationError('Tarih geçmiş', { field: 'date' }).fields, { date: 'Tarih geçmiş' });
    assert.deepEqual(new ValidationError('Hatalı', { fields: { pax: 'Kapasite 120', layout: 'Tanımsız' } }).fields, { pax: 'Kapasite 120', layout: 'Tanımsız' });
    assert.deepEqual(new ValidationError('Hatalı', { fields: { pax: 'Kapasite', bad: 3 } }).fields, { pax: 'Kapasite' });
    assert.equal(new ValidationError('Hatalı', { fields: ['pax'] }).fields, undefined);
    assert.equal(new ValidationError('Hatalı', { issues: ['a'] }).fields, undefined);
    assert.equal(new ValidationError('Hatalı').fields, undefined);
  });
});

describe('toplu işlemde kayıt hatası', () => {
  it('alan hatası ve "yoğun" kaydın sonucuna yazılır', () => {
    assert.deepEqual(bulkItemFailure('a', new ConflictError('Bakiye açık', 'BALANCE_DUE')), { id: 'a', ok: false, message: 'Bakiye açık', code: 'BALANCE_DUE' });
    assert.equal(bulkItemFailure('b', new NotFoundError('Yok')).code, 'NOT_FOUND');
    assert.equal(bulkItemFailure('c', new BusyError()).code, 'BUSY');
  });

  it('beklenmeyen hata fırlatılır: iç metin kayıt sonucuna sızmaz', () => {
    const internal = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    assert.throws(() => bulkItemFailure('a', internal), (error) => error === internal);
    assert.throws(() => bulkItemFailure('a', new AppError('İç hata')), { code: 'INTERNAL' });
  });
});
