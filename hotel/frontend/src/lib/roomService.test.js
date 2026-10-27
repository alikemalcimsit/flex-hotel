import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cartFromItems, clockText, dayClockText, deliverAtShortcuts, deliveryPreview, dueState, durationText, orderActions } from './roomService.js';

describe('oda servisi ekran yardımcıları', () => {
  it('saat otelin saat dilimiyle', () => {
    assert.equal(clockText('2026-10-26T04:30:00.000Z', 'Europe/Istanbul'), '07:30');
    assert.equal(dayClockText('2026-10-26T04:30:00.000Z', 'Europe/Istanbul'), '26.10 07:30');
    assert.equal(clockText(null, 'Europe/Istanbul'), '—');
  });

  it('süre yazısı: dakika, saat, gün', () => {
    assert.equal(durationText(0), '0 dk');
    assert.equal(durationText(65), '1 sa 05 dk');
    assert.equal(durationText(9350), '6 gün 11 sa');
    assert.equal(durationText(2880), '2 gün');
  });

  it('teslim hedefi: kalan / gecikti ve renk', () => {
    const now = Date.parse('2026-10-25T20:00:00Z');
    assert.deepEqual(dueState('2026-10-25T20:20:00Z', now), { text: '20 dk kaldı', tone: 'neutral', late: false });
    assert.deepEqual(dueState('2026-10-25T20:05:00Z', now), { text: '5 dk kaldı', tone: 'warning', late: false });
    assert.deepEqual(dueState('2026-10-25T20:00:20Z', now), { text: 'şimdi', tone: 'warning', late: false });
    assert.deepEqual(dueState('2026-10-25T18:55:00Z', now), { text: '1 sa 05 dk gecikti', tone: 'danger', late: true });
  });

  it('işlemler durum ve yetkiyle: mutfak başladıysa iptal yalnızca şef garson; yetkisize hiç', () => {
    const operate = { canOperate: true, canSupervise: false };
    const supervise = { canOperate: true, canSupervise: true };
    assert.deepEqual(orderActions({ status: 'REQUESTED' }, operate), ['accept', 'reject']);
    assert.deepEqual(orderActions({ status: 'SCHEDULED' }, operate), ['release', 'cancel']);
    assert.deepEqual(orderActions({ status: 'RECEIVED' }, operate), ['preparing', 'ready', 'dispatch', 'deliver', 'cancel']);
    assert.deepEqual(orderActions({ status: 'PREPARING' }, operate), ['ready', 'dispatch', 'deliver']);
    assert.deepEqual(orderActions({ status: 'PREPARING' }, supervise), ['ready', 'dispatch', 'deliver', 'cancel']);
    assert.deepEqual(orderActions({ status: 'ON_THE_WAY' }, operate), ['deliver', 'back']);
    assert.deepEqual(orderActions({ status: 'DELIVERED' }, supervise), []);
    assert.deepEqual(orderActions({ status: 'RECEIVED' }, { canOperate: false, canSupervise: true }), []);
  });

  it('teslim önizlemesi: kalan odaya; fazla ve ödenmemiş kalan hata; kuruş hatasız', () => {
    assert.deepEqual(deliveryPreview({ balance: '500.00', payments: [], chargeRemainder: true }), { paid: '0.00', remainder: '500.00', error: null });
    assert.deepEqual(deliveryPreview({ balance: '500.00', payments: [{ amount: '150' }, { amount: '250,10' }], chargeRemainder: true }), { paid: '400.10', remainder: '99.90', error: null });
    assert.match(deliveryPreview({ balance: '500.00', payments: [{ amount: '500.01' }], chargeRemainder: true }).error, /aşıyor/);
    assert.match(deliveryPreview({ balance: '500.00', payments: [{ amount: '400' }], chargeRemainder: false }).error, /Kalan 100\.00/);
    assert.deepEqual(deliveryPreview({ balance: '0.30', payments: [{ amount: '0.1' }, { amount: '0.2' }], chargeRemainder: false }), { paid: '0.30', remainder: '0.00', error: null });
    assert.equal(deliveryPreview({ balance: '10', payments: [{ amount: 'abc' }], chargeRemainder: true }).error, 'Tutar geçersiz');
  });

  it('kalem kopyası düzenlenebilir sepete', () => {
    const cart = cartFromItems([{ menuItemId: 'a', name: 'Omlet', unitPrice: '180.00', quantity: 2, note: null }]);
    assert.deepEqual(cart, [{ key: 'a:copy:0', menuItemId: 'a', name: 'Omlet', price: '180.00', quantity: 2, note: '' }]);
  });

  it('teslim saati kısayolları otelin duvar saatiyle (yarın sabah)', () => {
    const now = Date.parse('2026-10-25T20:10:00Z'); // İstanbul 23:10
    const options = deliverAtShortcuts(now, 'Europe/Istanbul', ['07:00', '07:30']);
    assert.deepEqual(options.map((option) => option.value), ['2026-10-26T00:10', '2026-10-26T07:00', '2026-10-26T07:30']);
    assert.equal(options[0].label, '1 saat sonra (00:10)');
  });
});
