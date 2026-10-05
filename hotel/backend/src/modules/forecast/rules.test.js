import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDecimal } from '@hotelos/core';
import { alertFor, chooseBasis, forecastDay, forecastTotals, pickupRate, referencePoints, windowAdr } from './rules.js';

/**
 * Tahminin çekirdeği (modül 25). Yanlış olursa müdür boş günü dolu, dolu
 * günü boş sanar: fiyat ve kampanya kararı yanlış verilir — sessizce.
 */

const NOW = new Date('2026-10-05T09:30:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS = '2026-10-05';

describe('karşılaştırma noktaları', () => {
  const longAgo = new Date('2020-01-01T00:00:00.000Z');

  it('geçen yıl: haftanın aynı günü 364 gün önce ± 1 hafta; "o gün kala" anı aynı fark kadar önce', () => {
    const { lead, lastYear } = referencePoints({ day: '2026-10-15', businessDate: BUSINESS, now: NOW, dataStart: longAgo });
    assert.equal(lead, 10);
    assert.deepEqual(lastYear.map((point) => point.day), ['2025-10-23', '2025-10-16', '2025-10-09']);
    // 2026-10-15 (perşembe) → 2025-10-16 (perşembe)
    assert.equal(new Date('2025-10-16T00:00:00Z').getUTCDay(), new Date('2026-10-15T00:00:00Z').getUTCDay());
    assert.equal(lastYear[1].asOf.getTime(), NOW.getTime() - 364 * DAY_MS, 'aynı gün kala, günün aynı saati');
  });

  it('son haftalar: geçmişteki en yakın aynı günden başlar (gün kalası kadar geriye), 8 hafta', () => {
    const today = referencePoints({ day: BUSINESS, businessDate: BUSINESS, now: NOW, dataStart: longAgo });
    assert.equal(today.recent[0].day, '2026-09-28', 'bugün için bir hafta önce');
    assert.equal(today.recent.length, 8);

    const in20 = referencePoints({ day: '2026-10-25', businessDate: BUSINESS, now: NOW, dataStart: longAgo });
    assert.equal(in20.lead, 20);
    assert.equal(in20.recent[0].day, '2026-10-04', '20 gün sonrası için 21 gün önce (dün): sonucu belli en yakın aynı gün');
    assert.ok(in20.recent.every((point) => point.day < BUSINESS));
    assert.equal(in20.recent[0].asOf.getTime(), NOW.getTime() - 21 * DAY_MS);

    const in7 = referencePoints({ day: '2026-10-12', businessDate: BUSINESS, now: NOW, dataStart: longAgo });
    assert.equal(in7.recent[0].day, '2026-09-28', '7 gün kala: 14 gün önce (7 gün önce bugün, sonucu belli değil)');
  });

  it('sistemde kaydın olmadığı an karşılaştırılmaz (o gün kala eldeki sıfır sanılırdı)', () => {
    // Otelin ilk rezervasyon kaydı 6 hafta önce: geçen yıl yok, son haftaların yalnızca bir kısmı var.
    const dataStart = new Date(NOW.getTime() - 42 * DAY_MS);
    const points = referencePoints({ day: '2026-10-08', businessDate: BUSINESS, now: NOW, dataStart });
    assert.deepEqual(points.lastYear, []);
    assert.deepEqual(points.recent.map((point) => point.day), ['2026-10-01', '2026-09-24', '2026-09-17', '2026-09-10', '2026-09-03', '2026-08-27']);
    assert.deepEqual(referencePoints({ day: '2026-10-08', businessDate: BUSINESS, now: NOW, dataStart: null }), { lead: 3, lastYear: [], recent: [] });
  });
});

describe('pickup ve kaynak seçimi', () => {
  it('pickup oranı satılabilir odaya göre; eksi olabilir (iptal / gelmeyen yeni satıştan fazla)', () => {
    assert.equal(pickupRate({ onBooks: 40, final: 55, sellable: 100 }), 0.15);
    assert.equal(pickupRate({ onBooks: 60, final: 54, sellable: 100 }), -0.06);
    assert.equal(pickupRate({ onBooks: 0, final: 0, sellable: 0 }), null, 'satılabilir oda yoksa örnek değil');
  });

  it('geçen yılın en az 2 örneği varsa o; yoksa son haftalar; o da yoksa pickup yok', () => {
    assert.deepEqual(chooseBasis({ lastYear: [0.1, 0.2, null], recent: [0.5, 0.5] }), { basis: 'LAST_YEAR', rate: 0.15000000000000002, samples: 2 });
    assert.deepEqual(chooseBasis({ lastYear: [0.1], recent: [0.2, 0.4, null] }), { basis: 'RECENT', rate: 0.30000000000000004, samples: 2 });
    assert.deepEqual(chooseBasis({ lastYear: [], recent: [0.3] }), { basis: 'NONE', rate: 0, samples: 0 });
  });
});

describe('günün tahmini', () => {
  const adr = toDecimal('1000');

  it('eldeki + oran × satılabilir; gelir eldeki ADR ile', () => {
    const day = forecastDay({ sold: 40, sellable: 100, revenue: '36000', rate: 0.15, fallbackAdr: adr });
    assert.equal(day.nights, 55);
    assert.equal(day.pickup, 15);
    assert.equal(day.occupancyPct, 55);
    assert.equal(day.revenue.toFixed(2), '49500.00', '36000 + 15 × 900 (günün eldeki ADR’si)');
  });

  it('artı pickup satılabilir odayı aşmaz; eldeki zaten fazlaysa artırmaz', () => {
    assert.equal(forecastDay({ sold: 95, sellable: 100, revenue: '95000', rate: 0.2, fallbackAdr: adr }).nights, 100);
    const over = forecastDay({ sold: 103, sellable: 100, revenue: '103000', rate: 0.1, fallbackAdr: adr });
    assert.equal(over.nights, 103);
    assert.equal(over.pickup, 0);
  });

  it('eksi pickup eldekinin altına indirir ama sıfırın altına indirmez; geliri de düşürür', () => {
    const wash = forecastDay({ sold: 50, sellable: 100, revenue: '50000', rate: -0.04, fallbackAdr: adr });
    assert.equal(wash.nights, 46);
    assert.equal(wash.revenue.toFixed(2), '46000.00');
    const empty = forecastDay({ sold: 2, sellable: 100, revenue: '2000', rate: -0.1, fallbackAdr: adr });
    assert.equal(empty.nights, 0);
    assert.equal(empty.revenue.toFixed(2), '0.00');
  });

  it('o gün satış yoksa pickup geliri pencerenin ADR’siyle; ADR bilinmiyorsa eklenmez', () => {
    assert.equal(forecastDay({ sold: 0, sellable: 100, revenue: '0', rate: 0.1, fallbackAdr: adr }).revenue.toFixed(2), '10000.00');
    const unknown = forecastDay({ sold: 0, sellable: 100, revenue: '0', rate: 0.1, fallbackAdr: null });
    assert.equal(unknown.nights, 10);
    assert.equal(unknown.revenue.toFixed(2), '0.00');
  });

  it('beklenen gece bir ondalıkla; satılabilir oda yoksa doluluk tanımsız', () => {
    assert.equal(forecastDay({ sold: 3, sellable: 7, revenue: '3000', rate: 0.05, fallbackAdr: adr }).nights, 3.4);
    assert.equal(forecastDay({ sold: 0, sellable: 0, revenue: '0', rate: 0, fallbackAdr: adr }).occupancyPct, null);
  });
});

describe('kritik gün', () => {
  const limits = { lowPct: 30, highPct: 95, basis: 'LAST_YEAR' };

  it('fazla satış önce; sonra yüksek ve düşük eşik (eşiğin kendisi kritik değil)', () => {
    assert.equal(alertFor({ sold: 101, sellable: 100, forecastPct: 99, ...limits }), 'OVERBOOKED');
    assert.equal(alertFor({ sold: 90, sellable: 100, forecastPct: 96, ...limits }), 'HIGH');
    assert.equal(alertFor({ sold: 90, sellable: 100, forecastPct: 95, ...limits }), null);
    assert.equal(alertFor({ sold: 10, sellable: 100, forecastPct: 29.9, ...limits }), 'LOW');
    assert.equal(alertFor({ sold: 10, sellable: 100, forecastPct: 30, ...limits }), null);
  });

  it('düşük doluluk tahmin ister: karşılaştırma verisi yokken uzak günün az eldekisi riskli sayılmaz', () => {
    const none = { ...limits, basis: 'NONE' };
    assert.equal(alertFor({ sold: 2, sellable: 100, forecastPct: 2, ...none }), null);
    assert.equal(alertFor({ sold: 2, sellable: 100, forecastPct: 2, ...limits, basis: 'RECENT' }), 'LOW');
    // Satılmış oda gerçektir: yüksek doluluk ve fazla satış veri olmadan da işaretlenir.
    assert.equal(alertFor({ sold: 97, sellable: 100, forecastPct: 97, ...none }), 'HIGH');
    assert.equal(alertFor({ sold: 101, sellable: 100, forecastPct: 101, ...none }), 'OVERBOOKED');
  });

  it('satılabilir oda yoksa yalnızca fazla satış', () => {
    assert.equal(alertFor({ sold: 0, sellable: 0, forecastPct: null, ...limits }), null);
    assert.equal(alertFor({ sold: 1, sellable: 0, forecastPct: null, ...limits }), 'OVERBOOKED');
  });
});

describe('pencere toplamı', () => {
  it('ADR pencerenin eldekinden; toplam oranlar toplamlardan, geçen yılla değişim', () => {
    assert.equal(windowAdr([{ sold: 0, revenue: '0' }]), null);
    assert.equal(windowAdr([{ sold: 2, revenue: '1800' }, { sold: 1, revenue: '1200' }]).toFixed(2), '1000.00');

    const totals = forecastTotals([
      { sellable: 100, onBooks: { sold: 40, revenue: '40000.00' }, forecast: { nights: 55, revenue: '55000.00' }, lastYear: { sold: 50, sellable: 100, revenue: '45000.00' } },
      { sellable: 100, onBooks: { sold: 60, revenue: '66000.00' }, forecast: { nights: 64.5, revenue: '70950.00' }, lastYear: { sold: 70, sellable: 100, revenue: '70000.00' } },
    ]);
    assert.deepEqual(totals.onBooks, { sold: 100, occupancyPct: 50, revenue: '106000.00' });
    assert.equal(totals.forecast.nights, 119.5);
    assert.equal(totals.forecast.pickup, 19.5);
    assert.equal(totals.forecast.occupancyPct, 59.8);
    assert.equal(totals.forecast.revenue, '125950.00');
    assert.equal(totals.forecast.pickupRevenue, '19950.00');
    assert.equal(totals.forecast.adr, '1053.97');
    assert.equal(totals.lastYear.occupancyPct, 60);
    assert.equal(totals.change.occupancyPts, -0.2);
    assert.equal(totals.change.revenue, 9.5);
  });
});
