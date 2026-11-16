import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultDoorPayments, deliveryActions, doorPreview, doorSummary, orderPaymentPreview } from './delivery.js';

/**
 * Paket servis ekranının saf kuralları: kart işlemleri (durum ve yetkiyle), kapı özeti, teslimde kapı ödemesinin
 * önizlemesi (açık hesap kalmaz), formdaki ödeme önizlemesi (ücret, en az tutar, ön ödeme).
 */

const operate = { canOperate: true, canSupervise: false };
const supervise = { canOperate: true, canSupervise: true };

describe('kart işlemleri', () => {
  it('durumla: mutfakta adımlar ve kurye; yolda teslim ve geri', () => {
    assert.deepEqual(deliveryActions({ status: 'RECEIVED' }, operate), ['preparing', 'ready', 'assign', 'dispatch', 'cancel']);
    assert.deepEqual(deliveryActions({ status: 'READY' }, supervise), ['assign', 'dispatch', 'cancel']);
    assert.deepEqual(deliveryActions({ status: 'ON_THE_WAY' }, supervise), ['deliver', 'back', 'cancel']);
    assert.deepEqual(deliveryActions({ status: 'DELIVERED' }, supervise), []);
  });

  it('mutfak başladıysa iptal yalnızca şef garson; yetkisize hiç işlem yok', () => {
    assert.deepEqual(deliveryActions({ status: 'PREPARING' }, operate), ['ready', 'assign', 'dispatch']);
    assert.deepEqual(deliveryActions({ status: 'ON_THE_WAY' }, operate), ['deliver', 'back']);
    assert.deepEqual(deliveryActions({ status: 'RECEIVED' }, { canOperate: false, canSupervise: true }), []);
  });
});

describe('kapı özeti', () => {
  const format = (value) => `${value} TL`;

  it('kalan yoksa ödendi; nakitte bozuk tutarı; kartta yalnız tutar', () => {
    assert.equal(doorSummary({ balance: '0.00', doorMethod: null, changeFor: null }, format), 'Ödendi');
    assert.equal(doorSummary({ balance: '450.00', doorMethod: 'CASH', changeFor: '500.00' }, format), 'Kapıda nakit 450.00 TL · 500.00 TL bozuk');
    assert.equal(doorSummary({ balance: '450.00', doorMethod: 'CARD', changeFor: null }, format), 'Kapıda kart 450.00 TL');
  });

  it('yöntem yazılmamış kalan kapıda alınır', () => {
    assert.equal(doorSummary({ balance: '50.00', doorMethod: null, changeFor: null }, format), 'Kapıda 50.00 TL');
  });
});

describe('teslimde kapı ödemesi', () => {
  it('varsayılan: kalanın tamamı beklenen yöntemle; kalan yoksa ödeme yok', () => {
    assert.deepEqual(
      defaultDoorPayments({ balance: '450.00', doorMethod: 'CARD' }).map(({ method, amount }) => ({ method, amount })),
      [{ method: 'CARD', amount: '450.00' }],
    );
    assert.equal(defaultDoorPayments({ balance: '450.00', doorMethod: null })[0].method, 'CASH');
    assert.deepEqual(defaultDoorPayments({ balance: '0.00', doorMethod: 'CASH' }), []);
  });

  it('kalanı tam kapatmalı (eksik / fazla hata); kuruş hatasız', () => {
    assert.deepEqual(doorPreview({ balance: '0.30', payments: [{ amount: '0.1' }, { amount: '0.2' }] }), { paid: '0.30', remainder: '0.00', error: null });
    assert.match(doorPreview({ balance: '450.00', payments: [{ amount: '400' }] }).error, /Kalan 50\.00/);
    assert.match(doorPreview({ balance: '450.00', payments: [{ amount: '450,01' }] }).error, /aşıyor/);
    assert.equal(doorPreview({ balance: '10', payments: [{ amount: 'abc' }] }).error, 'Tutar geçersiz');
    assert.deepEqual(doorPreview({ balance: '0.00', payments: [] }), { paid: '0.00', remainder: '0.00', error: null });
  });
});

describe('formdaki ödeme önizlemesi', () => {
  it('toplam = ürünler + ücret; ön ödeme düşülünce kapıda kalan', () => {
    assert.deepEqual(orderPaymentPreview({ itemsTotal: '400.00', fee: '25.00', minOrder: '150.00', prepayments: [{ amount: '100' }] }), {
      total: '425.00',
      prepaid: '100.00',
      remainder: '325.00',
      shortfall: null,
      error: null,
    });
  });

  it('en az tutarın altı eksikle döner; ön ödeme toplamı aşamaz', () => {
    assert.equal(orderPaymentPreview({ itemsTotal: '100.00', fee: '0', minOrder: '150', prepayments: [] }).shortfall, '50.00');
    assert.match(orderPaymentPreview({ itemsTotal: '100.00', fee: '20', minOrder: '0', prepayments: [{ amount: '130' }] }).error, /aşıyor/);
  });
});
