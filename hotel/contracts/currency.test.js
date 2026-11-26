import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { convertFromHotelCurrency, exchangeRateSettingsSchema, tcmbCandidateDays, tcmbRate, userPreferencesSchema } from './currency.js';

describe('kur kuralları', () => {
  it('bülten günleri: iş gününden önceki iş günleri (hafta sonu atlanır)', () => {
    assert.deepEqual(tcmbCandidateDays('2026-11-30').slice(0, 3), ['2026-11-27', '2026-11-26', '2026-11-25'], 'pazartesi → cuma');
    assert.equal(tcmbCandidateDays('2026-11-27')[0], '2026-11-26');
  });

  it('kur: birime bölünür, tür seçilir, yoksa null', () => {
    const bulletin = { currencies: { USD: { unit: 1, rates: { FOREX_BUYING: '50.5531', FOREX_SELLING: '50.6441' } }, JPY: { unit: 100, rates: { FOREX_BUYING: '32.4012' } } } };
    assert.deepEqual([tcmbRate(bulletin, 'USD', 'FOREX_SELLING'), tcmbRate(bulletin, 'JPY', 'FOREX_BUYING'), tcmbRate(bulletin, 'EUR', 'FOREX_BUYING'), tcmbRate(bulletin, 'USD', 'BANKNOTE_BUYING')], ['50.644100', '0.324012', null, null]);
  });

  it('yaklaşık karşılık ve şemalar', () => {
    assert.equal(convertFromHotelCurrency('2480.00', '50.6441'), '48.97');
    assert.equal(convertFromHotelCurrency('100', null), null);
    assert.equal(exchangeRateSettingsSchema.safeParse({ autoFetch: true, currencies: ['usd', 'USD'] }).success, false);
    assert.deepEqual(userPreferencesSchema.parse({ locale: 'en', displayCurrency: 'eur' }), { locale: 'en', displayCurrency: 'EUR' });
    assert.equal(userPreferencesSchema.safeParse({ locale: 'de' }).success, false);
  });
});
