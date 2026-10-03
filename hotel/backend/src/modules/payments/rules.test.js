import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  needsLargePaymentApproval,
  paymentSourceForStay,
  rateText,
  refundableAmount,
  resolvePaymentRate,
  sameRate,
  summarizeCash,
  toFolioAmount,
  voidLeavesRefundsCovered,
} from './rules.js';

/**
 * Ödemenin para kuralları (modül 17): kur çevirisi ve yuvarlama, kurun
 * seçimi / bayatlığı, eşik, iade sınırı, iptalin iadeyi karşılıksız
 * bırakmaması, kasa toplamı. Hata payı sıfır olmalı.
 */

describe('kur çevirisi', () => {
  it('folyoya giren tutar kuruşa, yarım yukarı (sıfırdan uzağa) yuvarlanır', () => {
    assert.equal(toFolioAmount('100', '36.125000'), '3612.50');
    assert.equal(toFolioAmount('0.01', '0.500000'), '0.01'); // 0.005 → 0.01
    assert.equal(toFolioAmount('-0.01', '0.500000'), '-0.01'); // iade / iptal: eksi taraf da sıfırdan uzağa
    assert.equal(toFolioAmount('33.33', '3.000003'), '99.99');
    assert.equal(toFolioAmount('2500.50', null), '2500.50');
  });

  it('iptal kaydı asıl satırın tam tersini yazar (kuruş kaybolmaz)', () => {
    const original = toFolioAmount('123.45', '35.987654');
    const reversal = toFolioAmount('-123.45', '35.987654');
    assert.equal(original, '4442.68');
    assert.equal(reversal, '-4442.68');
  });

  it('kur metni 6 ondalığa kanonik; biçim farkı kur farkı değildir', () => {
    assert.equal(rateText('36.1'), '36.100000');
    assert.equal(sameRate('36.1', '36.100000'), true);
    assert.equal(sameRate('36.1', '36.1001'), false);
    assert.equal(sameRate(null, null), true);
    assert.equal(sameRate(null, '36.1'), false);
  });
});

describe('kurun seçimi', () => {
  const base = { folioCurrency: 'TRY', hotelCurrency: 'TRY', businessDate: '2026-10-03' };

  it('aynı para biriminde kur yok', () => {
    assert.deepEqual(resolvePaymentRate({ ...base, currency: 'TRY', latest: null }), { rate: null, rateDate: null, error: null });
  });

  it('dövizde iş gününe kadarki son kur; birkaç günlük kur geçerli (hafta sonu)', () => {
    const today = resolvePaymentRate({ ...base, currency: 'EUR', latest: { rate: '38.5', date: '2026-10-03' } });
    assert.deepEqual(today, { rate: '38.500000', rateDate: '2026-10-03', error: null });
    const friday = resolvePaymentRate({ ...base, currency: 'EUR', latest: { rate: '38.5', date: '2026-09-30' } });
    assert.equal(friday.error, null);
  });

  it('kur yoksa, bayatsa ya da ileri tarihliyse ödeme alınmaz', () => {
    assert.match(resolvePaymentRate({ ...base, currency: 'USD', latest: null }).error, /kur girilmemiş/);
    const stale = resolvePaymentRate({ ...base, currency: 'EUR', latest: { rate: '38.5', date: '2026-09-29' } });
    assert.match(stale.error, /güncel değil \(son giriş 29\.09\.2026\)/);
    assert.match(resolvePaymentRate({ ...base, currency: 'EUR', latest: { rate: '38.5', date: '2026-10-04' } }).error, /ileri tarihli/);
  });

  it('otelin parasından farklı para birimli folyoya döviz alınmaz', () => {
    const result = resolvePaymentRate({ ...base, folioCurrency: 'EUR', currency: 'TRY', latest: null });
    assert.match(result.error, /yalnızca EUR/);
  });
});

describe('eşik ve iade sınırı', () => {
  it('eşik 0 ise onay yok; eşit ya da üstü onaya gider', () => {
    assert.equal(needsLargePaymentApproval('999999.00', '0'), false);
    assert.equal(needsLargePaymentApproval('49999.99', '50000.00'), false);
    assert.equal(needsLargePaymentApproval('50000.00', '50000.00'), true);
    assert.equal(needsLargePaymentApproval('-60000.00', '50000.00'), true);
  });

  it('iade edilebilir = işlenmiş net ödeme − bekleyen iadeler, eksiye düşmez', () => {
    assert.equal(refundableAmount({ postedNet: '3000.00', pendingRefunds: '0.00' }), '3000.00');
    assert.equal(refundableAmount({ postedNet: '3000.00', pendingRefunds: '-1000.00' }), '2000.00');
    assert.equal(refundableAmount({ postedNet: '500.00', pendingRefunds: '-800.00' }), '0.00');
  });

  it('ödeme iptali iade edilmiş / iade bekleyen parayı karşılıksız bırakamaz', () => {
    // 1000 alındı, 600 iade edildi (net 400): 1000'lik ödeme iptal edilirse net −600 → engel.
    assert.equal(voidLeavesRefundsCovered({ postedNet: '400.00', pendingRefunds: '0.00', paymentFolioAmount: '1000.00' }), false);
    // İki ayrı 1000'lik ödeme, iade yok: biri iptal edilebilir.
    assert.equal(voidLeavesRefundsCovered({ postedNet: '2000.00', pendingRefunds: '0.00', paymentFolioAmount: '1000.00' }), true);
    // 2000 alındı, 1500 iade bekliyor: 1000'lik iptal edilirse bekleyen iade karşılıksız kalır.
    assert.equal(voidLeavesRefundsCovered({ postedNet: '2000.00', pendingRefunds: '-1500.00', paymentFolioAmount: '1000.00' }), false);
  });

  it('girişten önce alınan ön ödemedir', () => {
    assert.equal(paymentSourceForStay('CONFIRMED'), 'ADVANCE');
    assert.equal(paymentSourceForStay('PENDING'), 'ADVANCE');
    assert.equal(paymentSourceForStay('CHECKED_IN'), 'DESK');
    assert.equal(paymentSourceForStay('CHECKED_OUT'), 'DESK');
  });
});

describe('kasa toplamı', () => {
  it('yöntem başına tahsilat / iade / iptal ve net; dövizde kendi para birimindeki net', () => {
    const rows = [
      { method: 'CASH', currency: 'TRY', kind: 'PAYMENT', count: 3, amount: '6000.00', folioAmount: '6000.00' },
      { method: 'CASH', currency: 'EUR', kind: 'PAYMENT', count: 1, amount: '100.00', folioAmount: '3850.00' },
      { method: 'CASH', currency: 'TRY', kind: 'REFUND', count: 1, amount: '-500.00', folioAmount: '-500.00' },
      { method: 'CARD', currency: 'TRY', kind: 'PAYMENT', count: 2, amount: '4200.00', folioAmount: '4200.00' },
      { method: 'CARD', currency: 'TRY', kind: 'REVERSAL', count: 1, amount: '-200.00', folioAmount: '-200.00' },
    ];
    const summary = summarizeCash(rows, ['CASH', 'CARD', 'TRANSFER']);
    assert.deepEqual(
      summary.methods.map((line) => [line.method, line.received, line.refunded, line.voided, line.net, line.count]),
      [
        ['CASH', '9850.00', '-500.00', '0.00', '9350.00', 5],
        ['CARD', '4200.00', '0.00', '-200.00', '4000.00', 3],
      ],
    );
    assert.deepEqual(summary.methods[0].currencies, [
      { currency: 'EUR', amount: '100.00', folioAmount: '3850.00' },
      { currency: 'TRY', amount: '5500.00', folioAmount: '5500.00' },
    ]);
    assert.deepEqual(summary.total, { received: '14050.00', refunded: '-500.00', voided: '-200.00', net: '13350.00' });
  });

  it('hareket yoksa sıfırlı toplam', () => {
    assert.deepEqual(summarizeCash([], ['CASH']), {
      methods: [],
      total: { received: '0.00', refunded: '0.00', voided: '0.00', net: '0.00' },
    });
  });
});
