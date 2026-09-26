import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { averageDailyRate, dayRow, revenueByDay, roomStates, weekWindow } from './rules.js';

/**
 * Günlük durum hesapları: yanlış olursa müdür yanlış geliri, yanlış ADR'yi
 * ya da farklı paraların toplamını görür ve kararını ona göre verir.
 */

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

describe('gece geliri', () => {
  it('gün gün toplanır; kuruş kaybı yok', () => {
    const byDay = revenueByDay(
      [
        { date: day('2026-09-26'), currency: 'TRY', amount: '1500.10', nights: 1, pendingNights: 0 },
        { date: day('2026-09-26'), currency: 'TRY', amount: '0.20', nights: 1, pendingNights: 1 },
        { date: day('2026-09-27'), currency: 'TRY', amount: '999.99', nights: 3, pendingNights: 2 },
      ],
      ['2026-09-26', '2026-09-27', '2026-09-28'],
      'TRY',
    );
    assert.equal(byDay.get('2026-09-26').revenue.toFixed(2), '1500.30');
    assert.equal(byDay.get('2026-09-26').nights, 2);
    assert.equal(byDay.get('2026-09-26').pendingNights, 1);
    assert.equal(byDay.get('2026-09-27').nights, 3);
    assert.equal(byDay.get('2026-09-28').revenue.toFixed(2), '0.00', 'geliri olmayan gün sıfır');
  });

  it('farklı para birimi otelin parasına karışmaz, ayrı listelenir', () => {
    const byDay = revenueByDay(
      [
        { date: day('2026-09-26'), currency: 'TRY', amount: '1000', nights: 1, pendingNights: 0 },
        { date: day('2026-09-26'), currency: 'EUR', amount: '80.5', nights: 1, pendingNights: 0 },
      ],
      ['2026-09-26'],
      'TRY',
    );
    const entry = byDay.get('2026-09-26');
    assert.equal(entry.revenue.toFixed(2), '1000.00');
    assert.equal(entry.nights, 1, 'EUR gecesi TRY ADR paydasına girmez');
    assert.deepEqual(entry.other, [{ currency: 'EUR', amount: '80.50' }]);
  });

  it('pencere dışındaki satır yok sayılır', () => {
    const byDay = revenueByDay([{ date: day('2026-10-01'), currency: 'TRY', amount: '5', nights: 1, pendingNights: 0 }], ['2026-09-26'], 'TRY');
    assert.equal(byDay.get('2026-09-26').nights, 0);
  });
});

describe('ADR', () => {
  it('gelir / gece, yarım kuruş yukarı yuvarlanır', () => {
    assert.equal(averageDailyRate('1000', 3), '333.33');
    assert.equal(averageDailyRate('0.05', 2), '0.03');
    assert.equal(averageDailyRate('4500.00', 3), '1500.00');
  });

  it('satılan gece yoksa tanımsız (sıfır yanıltır)', () => {
    assert.equal(averageDailyRate('0', 0), null);
    assert.equal(averageDailyRate('100', Number.NaN), null);
  });
});

describe('gün satırı', () => {
  const summary = {
    date: '2026-09-26',
    sold: 8,
    sellable: 10,
    occupancyPct: 80,
    arrivals: 3,
    departures: 2,
    stayovers: 5,
    unassigned: 1,
    outOfOrder: 2,
    outOfService: 1,
  };

  it('oda planı özeti + gelir', () => {
    const [entry] = revenueByDay(
      [{ date: day('2026-09-26'), currency: 'TRY', amount: '12000', nights: 8, pendingNights: 2 }],
      ['2026-09-26'],
      'TRY',
    ).values();
    const row = dayRow(summary, entry);
    assert.equal(row.occupancyPct, 80);
    assert.equal(row.sellable, 10);
    assert.equal(row.revenue, '12000.00');
    assert.equal(row.adr, '1500.00');
    assert.equal(row.pendingSold, 2);
    assert.deepEqual(row.otherCurrencies, []);
  });

  it('geliri olmayan gün: sıfır gelir, ADR yok', () => {
    const row = dayRow({ ...summary, sold: 0, occupancyPct: 0 }, undefined);
    assert.equal(row.revenue, '0.00');
    assert.equal(row.adr, null);
    assert.equal(row.pendingSold, 0);
  });
});

describe('anlık oda durumu', () => {
  it('SQL sayımları sayıya çevrilir; eksik alan sıfır', () => {
    assert.deepEqual(roomStates({ total: 12, occupied: '5', vacant: 7, vacantReady: 4, dirty: 3 }), {
      total: 12,
      occupied: 5,
      vacant: 7,
      vacantReady: 4,
      dirty: 3,
      cleaning: 0,
      clean: 0,
      inspected: 0,
    });
    assert.equal(roomStates(undefined).total, 0);
  });
});

describe('hafta penceresi', () => {
  const limits = { days: 7, maxOffsetDays: 366 };

  it('başlangıç verilmezse iş günü; bitiş 7 gün sonra (hariç)', () => {
    const window = weekWindow(undefined, day('2026-09-26'), limits);
    assert.equal(window.from.toISOString(), '2026-09-26T00:00:00.000Z');
    assert.equal(window.to.toISOString(), '2026-10-03T00:00:00.000Z');
  });

  it('saatli başlangıç gün başına iner', () => {
    const window = weekWindow(new Date('2026-09-20T17:45:00Z'), day('2026-09-26'), limits);
    assert.equal(window.from.toISOString(), '2026-09-20T00:00:00.000Z');
  });

  it('iş gününden çok uzak pencere reddedilir (geçmiş de gelecek de)', () => {
    assert.ok('error' in weekWindow(day('2025-09-01'), day('2026-09-26'), limits));
    assert.ok('error' in weekWindow(day('2027-10-01'), day('2026-09-26'), limits));
    assert.ok(!('error' in weekWindow(day('2025-09-25'), day('2026-09-26'), limits)), 'tam sınır kabul');
  });

  it('bozuk tarih hata döner, çökmez', () => {
    assert.ok('error' in weekWindow('bozuk', day('2026-09-26'), limits));
  });
});
