import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deliverySettlement, minimumOrderError, prepaymentPlan } from './delivery-rules.js';

/**
 * Paket servisin (modül 42) para kuralları: teslimde açık hesap kalmaz, ön ödeme toplamı aşamaz ve kalan için kapı
 * yöntemi gerekir, en az sipariş tutarı ücret hariç ürün toplamına bakar.
 */

describe('teslimde tahsilat', () => {
  it('kapıda alınan kalanı tam kapatır', () => {
    assert.deepEqual(deliverySettlement({ balance: '450.00', payments: [{ amount: '200' }, { amount: '250.00' }] }), { error: null, field: null, paid: '450.00' });
  });

  it('eksik ya da fazla alınamaz; ödenecek yokken ödeme alınmaz', () => {
    assert.match(deliverySettlement({ balance: '450.00', payments: [{ amount: '400' }] }).error, /Kalan 50\.00 ödenmedi/);
    assert.match(deliverySettlement({ balance: '450.00', payments: [{ amount: '500' }] }).error, /aşıyor/);
    assert.match(deliverySettlement({ balance: '0.00', payments: [{ amount: '10' }] }).error, /ödenecek tutarı yok/);
    assert.equal(deliverySettlement({ balance: '0.00', payments: [] }).error, null);
  });
});

describe('ön ödeme', () => {
  it('kısmi ön ödemede kalan kapıda; kapı yöntemi şart', () => {
    assert.deepEqual(prepaymentPlan({ grandTotal: '500.00', prepayments: [{ amount: '200' }], doorMethod: 'CARD', changeFor: null }), { error: null, field: null, prepaid: '200.00', remainder: '300.00' });
    assert.match(prepaymentPlan({ grandTotal: '500.00', prepayments: [{ amount: '200' }], doorMethod: null, changeFor: null }).error, /Kalan 300\.00 kapıda/);
  });

  it('tamamı önceden ödendiyse kapı yöntemi ve bozuk para yazılmaz; toplamı aşamaz', () => {
    assert.equal(prepaymentPlan({ grandTotal: '500.00', prepayments: [{ amount: '500' }], doorMethod: null, changeFor: null }).error, null);
    assert.match(prepaymentPlan({ grandTotal: '500.00', prepayments: [{ amount: '500' }], doorMethod: 'CASH', changeFor: null }).error, /tamamı önceden ödendi/);
    assert.match(prepaymentPlan({ grandTotal: '500.00', prepayments: [{ amount: '600' }], doorMethod: null, changeFor: null }).error, /aşıyor/);
  });

  it('bozuk para kapıda alınacak tutardan az olamaz', () => {
    assert.match(prepaymentPlan({ grandTotal: '500.00', prepayments: [], doorMethod: 'CASH', changeFor: '200' }).error, /bozuk/);
    assert.equal(prepaymentPlan({ grandTotal: '500.00', prepayments: [], doorMethod: 'CASH', changeFor: '1000' }).error, null);
  });
});

describe('en az sipariş', () => {
  it('ürün toplamı en az tutarın altındaysa reddedilir; sınır 0 ise yok', () => {
    assert.match(minimumOrderError('149.99', '150.00'), /En az sipariş tutarı 150\.00/);
    assert.equal(minimumOrderError('150.00', '150.00'), null);
    assert.equal(minimumOrderError('10.00', '0.00'), null);
  });
});
