import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setFormatLocale } from './format.js';
import { formatApprox, formatMoneyWithDisplay, resolveDisplay } from './displayMoney.js';

const CURRENT = {
  hotelCurrency: 'TRY',
  rates: [
    { currency: 'EUR', rate: '51.0500', date: '2026-11-26', usable: true },
    { currency: 'GBP', rate: '58.1000', date: '2026-11-10', usable: false },
  ],
};

describe('gösterim para birimi', () => {
  it('seçim, kur ve kullanılabilirliğe göre çözülür', () => {
    assert.deepEqual(resolveDisplay('EUR', CURRENT), { currency: 'EUR', hotelCurrency: 'TRY', rate: '51.0500', date: '2026-11-26' });
    assert.equal(resolveDisplay(null, CURRENT), null);
    assert.equal(resolveDisplay('GBP', CURRENT), null, 'eski kur gösterilmez');
    assert.equal(resolveDisplay('USD', CURRENT), null, 'kur yok');
    assert.equal(resolveDisplay('TRY', CURRENT), null, 'otelin kendi parası');
    assert.equal(resolveDisplay('EUR', undefined), null);
  });

  it('yaklaşık karşılık yalnız otelin para birimindeki tutara', () => {
    const display = resolveDisplay('EUR', CURRENT);
    assert.equal(formatApprox('2500', 'TRY', display), '48,97 EUR');
    assert.equal(formatApprox('2500', '', display), '48,97 EUR');
    assert.equal(formatApprox('100', 'USD', display), null);
    assert.equal(formatApprox(null, 'TRY', display), null);
    assert.equal(formatApprox('2500', 'TRY', null), null);
    assert.equal(formatMoneyWithDisplay('2500', 'TRY', display), '2.500,00 TRY (≈ 48,97 EUR)');
    assert.equal(formatMoneyWithDisplay('2500', 'TRY', null), '2.500,00 TRY');
  });

  it('İngilizcede ayraçlar değişir, imza aynı', () => {
    try {
      setFormatLocale('en');
      assert.equal(formatMoneyWithDisplay('2500', 'TRY', resolveDisplay('EUR', CURRENT)), '2,500.00 TRY (≈ 48.97 EUR)');
    } finally {
      setFormatLocale('tr');
    }
  });
});
