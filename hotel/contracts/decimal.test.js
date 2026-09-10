import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeDecimalString } from './decimal.js';

describe('normalizeDecimalString', () => {
  it('baştaki ve sondaki gereksiz sıfırları atar', () => {
    assert.equal(normalizeDecimalString('05.500'), '5.5');
  });

  it('tam sayıyı olduğu gibi bırakır', () => {
    assert.equal(normalizeDecimalString('7'), '7');
  });

  it('sadece sıfırlardan oluşan ondalığı tam sayıya indirger', () => {
    assert.equal(normalizeDecimalString('1.000'), '1');
  });

  it('başında rakam olmayan ondalığı tamamlar', () => {
    assert.equal(normalizeDecimalString('.5'), '0.5');
  });

  it('eksi işaretli sıfırı sadeleştirir', () => {
    assert.equal(normalizeDecimalString('-0.000'), '0');
  });

  it('sıfırı korur', () => {
    assert.equal(normalizeDecimalString('0'), '0');
  });

  it('hassasiyeti float yuvarlamasına kurban etmez', () => {
    // Number('0.1') + Number('0.2') !== 0.3 dünyasında bu değerin bozulmadan geçmesi şart.
    assert.equal(normalizeDecimalString('12345678901234.99'), '12345678901234.99');
  });

  it('sayı olmayanı reddeder', () => {
    assert.throws(() => normalizeDecimalString('abc'), /Geçersiz sayı/);
  });

  it('boş metni reddeder', () => {
    assert.throws(() => normalizeDecimalString(''), /Geçersiz sayı/);
  });
});
