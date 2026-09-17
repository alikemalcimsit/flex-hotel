import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { displayPhone, internationalPhone } from './phone.js';

/**
 * Misafire SMS giderken numara yanlış yorumlanırsa mesaj başka birine gider.
 */

describe('internationalPhone', () => {
  const TR = '90';

  it('yerel yazım otelin ülke koduyla tamamlanır', () => {
    assert.equal(internationalPhone('0532 111 00 01', TR), '905321110001');
    assert.equal(internationalPhone('532 111 00 01', TR), '905321110001');
  });

  it('+ ya da 00 ile yazılmış numaranın ülke kodu korunur', () => {
    assert.equal(internationalPhone('+44 7911 123456', TR), '447911123456');
    assert.equal(internationalPhone('0049 151 2345 6789', TR), '4915123456789');
  });

  it('ülke koduyla ama + olmadan yazılmış numara ikinci kez kodlanmaz', () => {
    assert.equal(internationalPhone('905321110001', TR), '905321110001');
  });

  it('ülke kodu bilinmiyorsa yerel yazım tahmin edilmez', () => {
    assert.equal(internationalPhone('0532 111 00 01', null), null);
    assert.equal(internationalPhone('+90 532 111 00 01', null), '905321110001');
  });

  it('numara olmayan ya da boyu tutmayan yazım reddedilir', () => {
    assert.equal(internationalPhone('', TR), null);
    assert.equal(internationalPhone('yok', TR), null);
    assert.equal(internationalPhone('+12', TR), null);
    assert.equal(internationalPhone('+1234567890123456', TR), null);
  });

  it('gösterimde + eklenir', () => {
    assert.equal(displayPhone('905321110001'), '+905321110001');
    assert.equal(displayPhone(null), '');
  });
});
