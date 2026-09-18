import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeStayPrice, eachNight, generateConfirmationCode, splitGuestName } from './rules.js';

/**
 * Fiyat hesabı para-kritik: yanlış çarpım misafirden sessizce yanlış ücret
 * alır. Gece sayısı, sezon çarpanı ve toplam burada sabitlenir.
 */
describe('eachNight', () => {
  it('yarı-açık aralık: çıkış gecesi sayılmaz', () => {
    const nights = eachNight('2027-03-01', '2027-03-04');
    assert.equal(nights.length, 3);
    assert.deepEqual(
      nights.map((n) => n.toISOString().slice(0, 10)),
      ['2027-03-01', '2027-03-02', '2027-03-03'],
    );
  });

  it('tek gece', () => {
    assert.equal(eachNight('2027-03-01', '2027-03-02').length, 1);
  });
});

describe('computeStayPrice', () => {
  it('sezon yoksa her gece taban fiyat', () => {
    const price = computeStayPrice({ basePrice: '3500.00', seasons: [], checkIn: '2027-03-01', checkOut: '2027-03-04' });
    assert.equal(price.nights, 3);
    assert.equal(price.total, '10500.00');
    assert.deepEqual(price.perNight.map((n) => n.amount), ['3500.00', '3500.00', '3500.00']);
  });

  it('sezon çarpanı o geceye uygulanır', () => {
    const seasons = [{ startDate: '2027-03-02', endDate: '2027-03-02', multiplier: '1.5' }];
    const price = computeStayPrice({ basePrice: '3500.00', seasons, checkIn: '2027-03-01', checkOut: '2027-03-04' });
    // 3500 + (3500 × 1.5 = 5250) + 3500 = 12250
    assert.deepEqual(price.perNight.map((n) => n.amount), ['3500.00', '5250.00', '3500.00']);
    assert.equal(price.total, '12250.00');
  });

  it('ondalık çarpan doğru yuvarlanır (kayan nokta hatası olmadan)', () => {
    const seasons = [{ startDate: '2027-03-01', endDate: '2027-03-01', multiplier: '1.1' }];
    const price = computeStayPrice({ basePrice: '2500.10', seasons, checkIn: '2027-03-01', checkOut: '2027-03-02' });
    // 2500.10 × 1.1 = 2750.11
    assert.equal(price.perNight[0].amount, '2750.11');
    assert.equal(price.total, '2750.11');
  });
});

describe('splitGuestName', () => {
  it('tek kelime → soyad boş', () => {
    assert.deepEqual(splitGuestName('Ali'), { firstName: 'Ali', lastName: '' });
  });
  it('iki kelime', () => {
    assert.deepEqual(splitGuestName('Ali Veli'), { firstName: 'Ali', lastName: 'Veli' });
  });
  it('üç kelime → son kelime soyad', () => {
    assert.deepEqual(splitGuestName('  Ali  Kemal   Yılmaz '), { firstName: 'Ali Kemal', lastName: 'Yılmaz' });
  });
});

describe('generateConfirmationCode', () => {
  it('10 karakter, yalnızca güvenli alfabe', () => {
    const code = generateConfirmationCode();
    assert.equal(code.length, 10);
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
  });
  it('ardışık iki kod farklı', () => {
    assert.notEqual(generateConfirmationCode(), generateConfirmationCode());
  });
});
