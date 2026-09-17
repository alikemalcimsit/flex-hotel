import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isEqual, isZero, multiply, percentOf, subtract, sum, toDecimal, toMoneyString } from './money.js';

/**
 * Bu fonksiyonların varlık sebebi tek bir cümle: `0.1 + 0.2 !== 0.3`.
 * Testler o cümlenin sistemde hiçbir yerde geçerli olmadığını doğruluyor.
 */

describe('float sorunu', () => {
  it('0.1 + 0.2 tam olarak 0.3 eder', () => {
    assert.equal(toMoneyString(sum('0.1', '0.2')), '0.30');
    // Karşılaştırma: düz JavaScript bunu yapamıyor.
    assert.notEqual(0.1 + 0.2, 0.3);
  });

  it('kuruşlu tutarların toplamı sapmaz', () => {
    const values = Array.from({ length: 1000 }, () => '0.01');
    assert.equal(toMoneyString(sum(...values)), '10.00');
  });
});

describe('multiply', () => {
  it('oda ücreti × sezon çarpanı × gece', () => {
    // 2500 TL taban, 1.3 sezon çarpanı, 3 gece
    assert.equal(toMoneyString(multiply('2500', '1.3', 3)), '9750.00');
  });

  it('ara adımlarda yuvarlamaz', () => {
    // Her adımda yuvarlansaydı 3 × 33.34 = 100.02 çıkardı.
    assert.equal(toMoneyString(multiply('100', '0.3333', 3)), '99.99');
  });

  it('argümansız çağrıda 1 döner (çarpma birimi)', () => {
    assert.equal(multiply().toString(), '1');
  });
});

describe('percentOf', () => {
  it('%18 KDV hesaplar', () => {
    assert.equal(toMoneyString(percentOf('1000', '18')), '180.00');
  });

  it('ondalıklı oranı doğru uygular', () => {
    assert.equal(toMoneyString(percentOf('2500', '8.5')), '212.50');
  });

  it('sıfır oran sıfır verir', () => {
    assert.ok(isZero(percentOf('2500', '0')));
  });
});

describe('toMoneyString', () => {
  it('her zaman 2 basamak döner', () => {
    assert.equal(toMoneyString('7'), '7.00');
  });

  it('yarımı yukarı yuvarlar', () => {
    assert.equal(toMoneyString('2.345'), '2.35');
  });

  it('istenen basamak sayısına uyar', () => {
    assert.equal(toMoneyString('1.23456', 3), '1.235');
  });
});

describe('subtract ve isEqual', () => {
  it('bakiye sıfırlandığında tam sıfır olur', () => {
    const balance = subtract(sum('100.10', '200.20'), '300.30');
    assert.ok(isZero(balance), `beklenen 0, gelen ${balance.toString()}`);
  });

  it('string ve sayı aynı değeri temsil ediyorsa eşittir', () => {
    assert.ok(isEqual('2500.00', 2500));
  });
});

describe('toDecimal', () => {
  it('sayıyı string üzerinden alır (float bozulmasın diye)', () => {
    assert.equal(toDecimal(0.1).toString(), '0.1');
  });

  it('sayı olmayanı reddeder', () => {
    assert.throws(() => toDecimal('bin lira'), /çevrilemedi/);
  });
});
