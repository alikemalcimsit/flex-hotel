import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  amountDue,
  clockMinutes,
  departurePlan,
  earlyCheckInCharge,
  folioBalance,
  hotelClock,
  hotelDayRange,
  identityShortfall,
  lateCheckOutCharge,
  priceAfterRelease,
  roomReadiness,
  sameAmount,
  stayFeeAmount,
} from './rules.js';

/**
 * Check-in / check-out kuralları (modül 6). Ücret ve bırakılan geceler
 * misafirin ödeyeceği tutarı değiştirir; saat her zaman otelin saatidir.
 */

const ZONE = 'Europe/Istanbul';
const PERCENT_50 = { mode: 'PERCENT_OF_NIGHT', value: '50' };

describe('otel saati', () => {
  it('SS:DD dakikaya çevrilir', () => {
    assert.equal(clockMinutes('14:00'), 840);
    assert.equal(clockMinutes('00:05'), 5);
  });

  it('an otel diliminde okunur (sunucu UTC olsa da)', () => {
    // 10:30 UTC = 13:30 İstanbul.
    assert.deepEqual(hotelClock(ZONE, new Date('2026-10-10T10:30:00Z')), { day: '2026-10-10', minutes: 13 * 60 + 30 });
    // 22:30 UTC = ertesi gün 01:30 İstanbul.
    assert.deepEqual(hotelClock(ZONE, new Date('2026-10-10T22:30:00Z')), { day: '2026-10-11', minutes: 90 });
  });

  it('otelin günü UTC aralığına çevrilir', () => {
    const { start, end } = hotelDayRange('2026-10-10', ZONE);
    assert.equal(start.toISOString(), '2026-10-09T21:00:00.000Z');
    assert.equal(end.toISOString(), '2026-10-10T21:00:00.000Z');
  });
});

describe('ücret tutarı', () => {
  it('sabit, yüzde ve yok', () => {
    assert.equal(stayFeeAmount({ mode: 'FIXED', value: '300' }, '1000'), '300.00');
    assert.equal(stayFeeAmount(PERCENT_50, '1333.33'), '666.67');
    assert.equal(stayFeeAmount({ mode: 'NONE', value: '0' }, '1000'), null);
  });

  it('fiyatı sıfır gecede yüzde ücret çıkmaz (null)', () => {
    assert.equal(stayFeeAmount(PERCENT_50, '0.00'), null);
    assert.equal(stayFeeAmount(PERCENT_50, null), null);
  });
});

describe('erken giriş', () => {
  const at = (minutes, day = '2026-10-10') => ({ day, minutes });
  const input = (clock, policy = PERCENT_50) => ({ policy, checkInTime: '14:00', clock, arrivalDay: '2026-10-10', firstNightAmount: '2000.00' });

  it('giriş günü giriş saatinden önce: ilk gecenin yüzdesi', () => {
    assert.deepEqual(earlyCheckInCharge(input(at(9 * 60))), { applies: true, fee: '1000.00' });
  });

  it('giriş saatinde ve sonrasında erken değil', () => {
    assert.deepEqual(earlyCheckInCharge(input(at(14 * 60))), { applies: false, fee: null });
    assert.deepEqual(earlyCheckInCharge(input(at(20 * 60))), { applies: false, fee: null });
  });

  it('geç gelen (ertesi gün sabah) erken sayılmaz', () => {
    assert.deepEqual(earlyCheckInCharge(input(at(8 * 60, '2026-10-11'))), { applies: false, fee: null });
  });

  it('politika yoksa erkendir ama ücret yoktur', () => {
    assert.deepEqual(earlyCheckInCharge(input(at(9 * 60), { mode: 'NONE', value: '0' })), { applies: true, fee: null });
  });
});

describe('geç çıkış', () => {
  const input = (clock, policy = { mode: 'FIXED', value: '400' }) => ({
    policy,
    checkOutTime: '12:00',
    clock,
    departureDay: '2026-10-12',
    lastNightAmount: '1500.00',
  });

  it('çıkış günü çıkış saatinden sonra: ücret', () => {
    assert.deepEqual(lateCheckOutCharge(input({ day: '2026-10-12', minutes: 12 * 60 + 1 })), { applies: true, fee: '400.00' });
  });

  it('çıkış saatinde ve öncesinde ücret yok', () => {
    assert.deepEqual(lateCheckOutCharge(input({ day: '2026-10-12', minutes: 12 * 60 })), { applies: false, fee: null });
  });

  it('çıkış günü geçmişse (unutulmuş çıkış) otomatik ücret yok; erken ayrılışta da yok', () => {
    assert.deepEqual(lateCheckOutCharge(input({ day: '2026-10-14', minutes: 15 * 60 })), { applies: false, fee: null });
    assert.deepEqual(lateCheckOutCharge(input({ day: '2026-10-11', minutes: 15 * 60 })), { applies: false, fee: null });
  });
});

describe('çıkış planı', () => {
  it('çıkış günü: zamanında', () => {
    const plan = departurePlan({ checkIn: '2026-10-08', checkOut: '2026-10-12', businessDate: '2026-10-12' });
    assert.equal(plan.kind, 'ON_TIME');
    assert.deepEqual(plan.releasedNights, []);
  });

  it('erken ayrılış: bugünden sonraki geceler bırakılır', () => {
    const plan = departurePlan({ checkIn: '2026-10-08', checkOut: '2026-10-12', businessDate: '2026-10-10' });
    assert.equal(plan.kind, 'EARLY');
    assert.equal(plan.checkOut.toISOString().slice(0, 10), '2026-10-10');
    assert.deepEqual(plan.releasedNights, ['2026-10-10', '2026-10-11']);
  });

  it('giriş günü ayrılan misafir ilk geceyi öder (konaklama en az bir gece)', () => {
    const plan = departurePlan({ checkIn: '2026-10-10', checkOut: '2026-10-13', businessDate: '2026-10-10' });
    assert.equal(plan.kind, 'EARLY');
    assert.equal(plan.checkOut.toISOString().slice(0, 10), '2026-10-11');
    assert.deepEqual(plan.releasedNights, ['2026-10-11', '2026-10-12']);
    // Tek gecelikte bırakılacak gece yok: zamanında sayılır.
    assert.equal(departurePlan({ checkIn: '2026-10-10', checkOut: '2026-10-11', businessDate: '2026-10-10' }).kind, 'ON_TIME');
  });

  it('çıkış tarihi geçmiş: gecikmiş, tarih değişmez', () => {
    const plan = departurePlan({ checkIn: '2026-10-05', checkOut: '2026-10-08', businessDate: '2026-10-10' });
    assert.equal(plan.kind, 'OVERDUE');
    assert.equal(plan.overdueDays, 2);
    assert.equal(plan.checkOut.toISOString().slice(0, 10), '2026-10-08');
  });

  it('bırakılan gecelerin tutarı düşülür (kuruşu kuruşuna)', () => {
    const nights = [
      { date: '2026-10-08', amount: '1000.00' },
      { date: '2026-10-09', amount: '1500.50' },
      { date: '2026-10-10', amount: '1500.50' },
      { date: '2026-10-11', amount: '999.99' },
    ];
    assert.deepEqual(priceAfterRelease(nights, ['2026-10-10', '2026-10-11']), { total: '2500.50', released: '2500.49' });
    assert.deepEqual(priceAfterRelease(nights, []), { total: '5000.99', released: '0.00' });
  });
});

describe('bakiye', () => {
  it('kalemler − ödemeler', () => {
    assert.equal(folioBalance({ charges: '4500.00', paid: '4000.00' }), '500.00');
    assert.equal(folioBalance({ charges: '4500.00', paid: '5000.00' }), '-500.00');
  });

  it('ödenecek: bakiye + folyoya henüz işlenmemiş ücret; folyo yoksa denetlenemez', () => {
    assert.equal(amountDue({ balance: '0.00' }, ['400.00', null]), '400.00');
    assert.equal(amountDue({ balance: '-100.00' }, [null]), '-100.00');
    assert.equal(amountDue(null, ['400.00']), null);
  });

  it('tutar karşılaştırması biçimden bağımsız', () => {
    assert.equal(sameAmount('500.5', '500.50'), true);
    assert.equal(sameAmount('500.5', '500.51'), false);
    assert.equal(sameAmount(null, undefined), true);
    assert.equal(sameAmount(null, '0.00'), false);
  });
});

describe('kimlik politikası', () => {
  const adult = { isChild: false };
  const child = { isChild: true };

  it('yalnız sahibi: refakatçi isteğe bağlı', () => {
    assert.equal(identityShortfall({ policy: 'PRIMARY_GUEST', adults: 3, children: 1, companions: [] }), null);
  });

  it('bütün yetişkinler: eksik yetişkin sayısını söyler; çocuk sayılmaz', () => {
    assert.match(identityShortfall({ policy: 'ALL_ADULTS', adults: 3, children: 1, companions: [adult, child] }), /1 yetişkinin kimliği eksik/);
    assert.equal(identityShortfall({ policy: 'ALL_ADULTS', adults: 3, children: 1, companions: [adult, adult, child] }), null);
  });

  it('rezervasyondakinden fazla kişi girilemez', () => {
    assert.match(identityShortfall({ policy: 'PRIMARY_GUEST', adults: 2, children: 0, companions: [adult, adult] }), /en fazla 1 kişi/);
    assert.match(identityShortfall({ policy: 'PRIMARY_GUEST', adults: 1, children: 2, companions: [adult] }), /1 yetişkin var/);
  });
});

describe('oda hazırlığı', () => {
  it('doluluk ve arıza temizlikten önce gelir', () => {
    assert.equal(roomReadiness({ housekeepingStatus: 'CLEAN' }, { occupied: true, blocked: true }), 'OCCUPIED');
    assert.equal(roomReadiness({ housekeepingStatus: 'CLEAN' }, { occupied: false, blocked: true }), 'BLOCKED');
    assert.equal(roomReadiness({ housekeepingStatus: 'DIRTY' }, { occupied: false, blocked: false }), 'DIRTY');
    assert.equal(roomReadiness({ housekeepingStatus: 'CLEANING' }, { occupied: false, blocked: false }), 'CLEANING');
    assert.equal(roomReadiness({ housekeepingStatus: 'INSPECTED' }, { occupied: false, blocked: false }), 'READY');
  });
});
