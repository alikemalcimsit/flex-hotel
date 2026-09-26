import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDecimal } from '@hotelos/core';
import {
  averageDailyRate,
  dayRow,
  guestMix,
  includedRoomTaxRate,
  netOfIncludedTax,
  revenueByDay,
  revenuePerAvailableRoom,
  roomStates,
  roomTypeRows,
  weekWindow,
} from './rules.js';

/**
 * Günlük durum hesapları: yanlış olursa müdür vergili geliri net sanır,
 * yanlış ADR / RevPAR görür, fazla satışı fark etmez ya da farklı paraların
 * toplamını görür ve kararını ona göre verir.
 */

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const NO_TAX = toDecimal(0);

describe('oda vergisi', () => {
  const taxes = [
    { name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['ROOM', 'FNB'] },
    { name: 'Konaklama vergisi', rate: '2', isIncluded: true, appliesTo: ['ROOM'] },
    { name: 'Servis', rate: '5', isIncluded: false, appliesTo: ['ROOM'] },
    { name: 'Alkol ÖTV', rate: '20', isIncluded: true, appliesTo: ['FNB'] },
  ];

  it('yalnızca oda kalemine uygulanan ve fiyatın içindeki vergiler toplanır', () => {
    assert.equal(includedRoomTaxRate(taxes).toString(), '12');
    assert.equal(includedRoomTaxRate([]).toString(), '0');
    assert.equal(includedRoomTaxRate(undefined).toString(), '0');
  });

  it('net = brüt ÷ (1 + oran); rezervasyon ekranının vergi dökümüyle aynı', () => {
    assert.equal(netOfIncludedTax('1120', toDecimal(12)).toFixed(2), '1000.00');
    assert.equal(netOfIncludedTax('4000', toDecimal(12)).toFixed(6), '3571.428571');
    assert.equal(netOfIncludedTax('999.99', NO_TAX).toFixed(2), '999.99', 'vergi dahil değilse fiyat nettir');
  });
});

describe('gece geliri', () => {
  it('gün gün toplanır; kuruş kaybı yok; opsiyonlu kısım ayrı', () => {
    const byDay = revenueByDay(
      [
        { date: day('2026-09-26'), currency: 'TRY', amount: '1500.10', pendingAmount: null, nights: 1, pendingNights: 0 },
        { date: day('2026-09-26'), currency: 'TRY', amount: '0.20', pendingAmount: '0.20', nights: 1, pendingNights: 1 },
        { date: day('2026-09-27'), currency: 'TRY', amount: '999.99', pendingAmount: '333.33', nights: 3, pendingNights: 2 },
      ],
      ['2026-09-26', '2026-09-27', '2026-09-28'],
      'TRY',
    );
    assert.equal(byDay.get('2026-09-26').revenue.toFixed(2), '1500.30');
    assert.equal(byDay.get('2026-09-26').pendingRevenue.toFixed(2), '0.20');
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

describe('ADR ve RevPAR', () => {
  it('ADR = gelir / gece, yarım kuruş yukarı yuvarlanır', () => {
    assert.equal(averageDailyRate('1000', 3), '333.33');
    assert.equal(averageDailyRate('0.05', 2), '0.03');
    assert.equal(averageDailyRate('4500.00', 3), '1500.00');
  });

  it('satılan gece yoksa ADR tanımsız (sıfır yanıltır)', () => {
    assert.equal(averageDailyRate('0', 0), null);
    assert.equal(averageDailyRate('100', Number.NaN), null);
  });

  it('RevPAR = gelir / satılabilir oda; satılabilir oda yoksa tanımsız', () => {
    assert.equal(revenuePerAvailableRoom('3571.428571', 9), '396.83');
    assert.equal(revenuePerAvailableRoom('1000', 0), null);
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
  const entryOf = (amount, nights, pendingAmount = '0', pendingNights = 0) =>
    revenueByDay(
      [{ date: day('2026-09-26'), currency: 'TRY', amount, pendingAmount, nights, pendingNights }],
      ['2026-09-26'],
      'TRY',
    ).get('2026-09-26');

  it('vergiler hariç gelir, ADR ve RevPAR; brüt ayrıca', () => {
    const row = dayRow(summary, entryOf('13440', 8, '3360', 2), toDecimal(12));
    assert.equal(row.grossRevenue, '13440.00');
    assert.equal(row.revenue, '12000.00');
    assert.equal(row.pendingRevenue, '3000.00');
    assert.equal(row.adr, '1500.00');
    assert.equal(row.revpar, '1200.00', '12000 / 10 satılabilir oda');
    assert.equal(row.pendingSold, 2);
    assert.equal(row.available, 2);
    assert.deepEqual(row.otherCurrencies, []);
  });

  it('fazla satış gizlenmez: kalan oda negatif', () => {
    const row = dayRow({ ...summary, sold: 12, occupancyPct: 120 }, undefined, NO_TAX);
    assert.equal(row.available, -2);
    assert.equal(row.occupancyPct, 120);
  });

  it('geliri olmayan gün: sıfır gelir, ADR yok, RevPAR sıfır', () => {
    const row = dayRow({ ...summary, sold: 0, occupancyPct: 0 }, undefined, toDecimal(12));
    assert.equal(row.revenue, '0.00');
    assert.equal(row.adr, null);
    assert.equal(row.revpar, '0.00');
    assert.equal(row.pendingSold, 0);
  });
});

describe('anlık oda durumu', () => {
  it('SQL sayımları sayıya çevrilir; eksik alan sıfır', () => {
    assert.deepEqual(roomStates({ total: 12, occupied: '5', vacant: 7, vacantReady: 4, vacantReadyFree: 3, dirty: 3 }), {
      total: 12,
      occupied: 5,
      vacant: 7,
      vacantReady: 4,
      vacantReadyFree: 3,
      dirty: 3,
      cleaning: 0,
      clean: 0,
      inspected: 0,
    });
    assert.equal(roomStates(undefined).total, 0);
  });
});

describe('bu gece konaklayanlar', () => {
  it('pansiyona göre toplanır, sabit sırada; kişi = yetişkin + çocuk', () => {
    const mix = guestMix([
      { boardType: 'AI', stays: 1, adults: 2, children: 0 },
      { boardType: 'BB', stays: 2, adults: 3, children: 0 },
      { boardType: 'HB', stays: 1, adults: 2, children: 1 },
    ]);
    assert.deepEqual(
      mix.byBoard.map((entry) => [entry.boardType, entry.stays, entry.guests]),
      [
        ['BB', 2, 3],
        ['HB', 1, 3],
        ['AI', 1, 2],
      ],
    );
    assert.equal(mix.stays, 4);
    assert.equal(mix.adults, 7);
    assert.equal(mix.children, 1);
    assert.equal(mix.guests, 8);
  });

  it('kimse yoksa sıfır', () => {
    assert.deepEqual(guestMix([]), { stays: 0, adults: 0, children: 0, guests: 0, byBoard: [] });
  });
});

describe('oda tipine göre bu gece', () => {
  const types = [
    {
      id: 't1',
      code: 'STD',
      name: 'Standart',
      total: 10,
      days: { '2026-09-26': { occupied: 2, outOfOrder: 1, outOfService: 1, unassigned: 2, free: 5 } },
    },
    { id: 't2', code: 'SUI', name: 'Suit', total: 2, days: { '2026-09-26': { occupied: 2, outOfOrder: 0, outOfService: 0, unassigned: 1, free: -1 } } },
    { id: 't3', code: 'NEW', name: 'Odası olmayan tip', total: 0, days: {} },
  ];

  it('satılan = atanmış + oda bekleyen; satılabilir = toplam − arızalı; fazla satış negatif', () => {
    const rows = roomTypeRows(types, '2026-09-26');
    assert.deepEqual(
      rows.map((row) => [row.code, row.sold, row.sellable, row.available, row.occupancyPct]),
      [
        ['STD', 4, 9, 5, 44],
        ['SUI', 3, 2, -1, 150],
      ],
    );
  });

  it('odası olmayan tip listelenmez; günü olmayan tip boş sayılır', () => {
    const rows = roomTypeRows([{ id: 't4', code: 'X', name: 'X', total: 3, days: {} }], '2026-09-26');
    assert.deepEqual([rows[0].sold, rows[0].available, rows[0].occupancyPct], [0, 3, 0]);
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
