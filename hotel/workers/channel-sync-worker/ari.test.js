import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addIsoDays,
  availabilityValues,
  changedDays,
  channelAvailability,
  channelRate,
  clampWindow,
  compressRanges,
  decodeRestriction,
  encodeRestriction,
  mergeSent,
  planTarget,
  restrictionValues,
  unionWindow,
  windowDays,
} from './ari.js';

/**
 * Kanala giden değerlerin saf hesabı. Yanlışsa ya kanal eski fiyatla satar ya
 * da dolu günde satış açık kalır (overbooking) — ikisi de kimse bakmadan olur.
 */

describe('kanal fiyatı', () => {
  it('liste fiyatına fark yüzdesi eklenir, kuruşa yuvarlanır', () => {
    assert.equal(channelRate('1000.00', '15.00'), '1150.00');
    assert.equal(channelRate('999.99', '12.50'), '1124.99', '1124.98875 → 1124.99');
    assert.equal(channelRate('1000', '0'), '1000.00');
    assert.equal(channelRate('1000', '-10'), '900.00', 'eksi fark kanalda daha ucuz');
  });

  it('kanal 0 fiyat kabul etmez: en az 0.01', () => {
    assert.equal(channelRate('0', '0'), '0.01');
    assert.equal(channelRate('0.004', '0'), '0.01');
  });

  it('müsaitlik: overbooking (eksi) kanala 0 gider', () => {
    assert.equal(channelAvailability(3), 3);
    assert.equal(channelAvailability(-2), 0);
    assert.equal(channelAvailability(0), 0);
  });

  it('fiyat + stop-sale tek metin olarak saklanır ve geri okunur', () => {
    const value = encodeRestriction({ rate: '1150.00', stopSell: true });
    assert.equal(value, '1150.00|1');
    assert.deepEqual(decodeRestriction(value), { rate: '1150.00', stopSell: true });
    assert.deepEqual(decodeRestriction('900.00|0'), { rate: '900.00', stopSell: false });
  });
});

describe('fark ve aralık', () => {
  it('yalnızca değişen ya da hiç gönderilmemiş günler gider', () => {
    const desired = { '2027-06-01': 3, '2027-06-02': 2, '2027-06-03': 2, '2027-06-04': 5 };
    const sent = { '2027-06-01': 3, '2027-06-02': 4, '2027-06-04': 5 };
    assert.deepEqual(changedDays(desired, sent), [
      ['2027-06-02', 2],
      ['2027-06-03', 2],
    ]);
  });

  it('ardışık aynı değerler tek aralık; boşluk ya da farklı değer yeni aralık', () => {
    const ranges = compressRanges([
      ['2027-06-01', 2],
      ['2027-06-02', 2],
      ['2027-06-03', 1],
      ['2027-06-05', 1],
      ['2027-06-06', 1],
    ]);
    assert.deepEqual(ranges, [
      { from: '2027-06-01', to: '2027-06-02', value: 2 },
      { from: '2027-06-03', to: '2027-06-03', value: 1 },
      { from: '2027-06-05', to: '2027-06-06', value: 1 },
    ]);
  });

  it('ay ve yıl sınırında aralık bölünmez (gün aritmetiği UTC)', () => {
    assert.equal(addIsoDays('2027-12-31', 1), '2028-01-01');
    assert.equal(addIsoDays('2028-02-28', 1), '2028-02-29', 'artık yıl');
    const ranges = compressRanges([
      ['2027-12-31', 4],
      ['2028-01-01', 4],
    ]);
    assert.equal(ranges.length, 1);
  });

  it('tam eşitleme pencerenin tamamını gönderir, fark yalnızca değişeni', () => {
    const desired = { '2027-06-01': '100.00|0', '2027-06-02': '100.00|0' };
    const sent = { '2027-06-01': '100.00|0', '2027-06-02': '100.00|0' };
    assert.equal(planTarget({ desired, sent, full: false }).ranges.length, 0, 'değişiklik yoksa hiçbir şey gitmez');
    const full = planTarget({ desired, sent, full: true });
    assert.equal(full.days.length, 2);
    assert.deepEqual(full.ranges, [{ from: '2027-06-01', to: '2027-06-02', value: '100.00|0' }]);
  });

  it('gönderilenler yazılır, geçmiş günler atılır', () => {
    const next = mergeSent({ '2027-05-30': 1, '2027-06-01': 2 }, [['2027-06-02', 5]], '2027-06-01');
    assert.deepEqual(next, { '2027-06-01': 2, '2027-06-02': 5 });
  });

  it('kirli pencere birikir ve kanalın ufkuna kırpılır', () => {
    assert.deepEqual(unionWindow({ from: '2027-06-05', to: '2027-06-08' }, { from: '2027-06-01', to: '2027-06-03' }), {
      from: '2027-06-01',
      to: '2027-06-08',
    });
    assert.deepEqual(unionWindow(null, { from: '2027-06-01', to: '2027-06-03' }), { from: '2027-06-01', to: '2027-06-03' });
    // Bugünden önceki günler ve ufkun ötesi gönderilmez.
    assert.deepEqual(clampWindow({ from: '2027-05-20', to: '2028-01-01' }, '2027-06-01', 30), { from: '2027-06-01', to: '2027-07-01' });
    assert.equal(clampWindow({ from: '2027-05-01', to: '2027-05-10' }, '2027-06-01', 30), null, 'tamamen geçmiş');
    assert.deepEqual(windowDays('2027-06-29', '2027-07-02'), ['2027-06-29', '2027-06-30', '2027-07-01']);
  });
});

describe('Channex gövdeleri', () => {
  it('müsaitlik oda tipine, fiyat ve stop-sale fiyat planına; tarih aralığıyla', () => {
    assert.deepEqual(availabilityValues('P', 'RT', [{ from: '2027-06-01', to: '2027-06-03', value: 4 }]), [
      { property_id: 'P', room_type_id: 'RT', date_from: '2027-06-01', date_to: '2027-06-03', availability: 4 },
    ]);
    assert.deepEqual(restrictionValues('P', 'RP', [{ from: '2027-06-01', to: '2027-06-01', value: '1150.00|1' }]), [
      { property_id: 'P', rate_plan_id: 'RP', date_from: '2027-06-01', date_to: '2027-06-01', rate: '1150.00', stop_sell: true },
    ]);
  });
});
