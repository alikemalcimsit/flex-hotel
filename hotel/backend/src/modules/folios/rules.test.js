import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toDecimal } from '@hotelos/core';
import {
  balanceIsZero,
  chargeLine,
  linesTotal,
  nextWindow,
  nightSourceKey,
  planRoomPostings,
  resolvePostingFolio,
  reversalLine,
} from './rules.js';

const KDV_ROOM = { id: 'kdv', name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['ROOM', 'FNB'] };
const KONAKLAMA = { id: 'kv', name: 'Konaklama vergisi', rate: '2', isIncluded: true, appliesTo: ['ROOM'] };
const KONAKLAMA_EXCLUDED = { ...KONAKLAMA, isIncluded: false };
const KDV_MINIBAR = { id: 'kdv20', name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['MINIBAR'] };

/** Satırın iç tutarlılığı: net + vergi = toplam; döküm toplamı = vergi. */
function assertConsistent(line) {
  assert.equal(toDecimal(line.netAmount).plus(line.taxAmount).toFixed(2), toDecimal(line.total).toFixed(2), 'net + vergi = toplam');
  const lineTaxes = line.taxLines.reduce((acc, tax) => acc.plus(tax.amount), toDecimal(0));
  assert.equal(lineTaxes.toFixed(2), toDecimal(line.taxAmount).toFixed(2), 'döküm toplamı = vergi');
}

describe('chargeLine', () => {
  it('vergisiz kalem: net = toplam = tutar × adet', () => {
    const line = chargeLine({ amount: '45.5', quantity: 3, taxCategory: 'OTHER', taxes: [KDV_ROOM] });
    assert.deepEqual(
      { net: line.netAmount, tax: line.taxAmount, total: line.total, lines: line.taxLines.length },
      { net: '136.50', tax: '0.00', total: '136.50', lines: 0 },
    );
  });

  it('iki dahil vergi: toplam değişmez, dahil vergilerin toplamı brüt − net (kuruş kaybolmaz)', () => {
    const line = chargeLine({ amount: '1000', quantity: 1, taxCategory: 'ROOM', taxes: [KDV_ROOM, KONAKLAMA] });
    // net = 1000 / 1.12 = 892.857… → 892.86; KDV 89.29; konaklama vergisi farkı alır: 107.14 − 89.29.
    assert.equal(line.netAmount, '892.86');
    assert.equal(line.taxAmount, '107.14');
    assert.equal(line.total, '1000.00');
    assert.deepEqual(
      line.taxLines.map((tax) => [tax.name, tax.included, tax.amount]),
      [
        ['KDV', true, '89.29'],
        ['Konaklama vergisi', true, '17.85'],
      ],
    );
    assertConsistent(line);
  });

  it('hariç vergi net üzerine eklenir (rezervasyon ekranının dökümüyle aynı)', () => {
    const line = chargeLine({ amount: '1000', quantity: 1, taxCategory: 'ROOM', taxes: [KDV_ROOM, KONAKLAMA_EXCLUDED] });
    // net = 1000 / 1.10 = 909.09; hariç %2 = 18.18; toplam 1018.18.
    assert.equal(line.netAmount, '909.09');
    assert.equal(line.total, '1018.18');
    assert.equal(line.taxAmount, '109.09');
    assert.deepEqual(line.taxLines.find((tax) => !tax.included).amount, '18.18');
    assertConsistent(line);
  });

  it('vergi yalnızca kalemin kategorisine uygulanır', () => {
    const minibar = chargeLine({ amount: '60', quantity: 2, taxCategory: 'MINIBAR', taxes: [KDV_ROOM, KONAKLAMA, KDV_MINIBAR] });
    assert.deepEqual(minibar.taxLines.map((tax) => tax.rate), ['20']);
    assert.equal(minibar.netAmount, '100.00');
    assert.equal(minibar.taxAmount, '20.00');
    assertConsistent(minibar);
    const untaxed = chargeLine({ amount: '60', quantity: 1, taxCategory: null, taxes: [KDV_ROOM] });
    assert.equal(untaxed.taxLines.length, 0);
  });

  it('indirim (eksi) aynı formülle, simetrik yuvarlamayla eksi satır verir', () => {
    const plus = chargeLine({ amount: '333.33', quantity: 1, taxCategory: 'ROOM', taxes: [KDV_ROOM, KONAKLAMA_EXCLUDED] });
    const minus = chargeLine({ amount: '-333.33', quantity: 1, taxCategory: 'ROOM', taxes: [KDV_ROOM, KONAKLAMA_EXCLUDED] });
    assert.equal(minus.total, toDecimal(plus.total).negated().toFixed(2));
    assert.equal(minus.netAmount, toDecimal(plus.netAmount).negated().toFixed(2));
    assertConsistent(minus);
  });

  it('her tutarda satır tutarlı kalır (yuvarlama sınırları)', () => {
    for (const amount of ['0.01', '0.05', '1.99', '99.99', '1234.56', '99999.99']) {
      for (const quantity of [1, 3, 7]) {
        assertConsistent(chargeLine({ amount, quantity, taxCategory: 'ROOM', taxes: [KDV_ROOM, KONAKLAMA] }));
        assertConsistent(chargeLine({ amount, quantity, taxCategory: 'ROOM', taxes: [KDV_ROOM, KONAKLAMA_EXCLUDED] }));
      }
    }
  });
});

describe('reversalLine', () => {
  it('asıl satırın birebir eksisi (vergi dökümü dahil)', () => {
    const original = chargeLine({ amount: '1000', quantity: 2, taxCategory: 'ROOM', taxes: [KDV_ROOM, KONAKLAMA_EXCLUDED] });
    const reversal = reversalLine(original);
    assert.equal(reversal.amount, '-1000.00');
    assert.equal(reversal.quantity, 2);
    assert.equal(toDecimal(reversal.total).plus(original.total).toFixed(2), '0.00');
    assert.deepEqual(
      reversal.taxLines.map((tax) => tax.amount),
      original.taxLines.map((tax) => toDecimal(tax.amount).negated().toFixed(2)),
    );
  });

  it('indirimin iptali artı satırdır', () => {
    const discount = chargeLine({ amount: '-50', quantity: 1, taxCategory: null, taxes: [] });
    assert.equal(reversalLine(discount).total, '50.00');
  });
});

describe('planRoomPostings', () => {
  const nights = [
    { date: '2026-09-27', amount: '1000.00' },
    { date: '2026-09-28', amount: '1000.00' },
    { date: '2026-09-29', amount: '1200.00' },
  ];
  const posted = (serviceDate, amount, voided = false) => ({ serviceDate, amount, quantity: 1, voided });

  it('işlenmemiş geceler, verilen geceye kadar (dahil) işlenir', () => {
    assert.deepEqual(planRoomPostings({ nights, posted: [], throughNight: '2026-09-28' }), [
      { date: '2026-09-27', kind: 'NIGHT', amount: '1000.00', sequence: 0 },
      { date: '2026-09-28', kind: 'NIGHT', amount: '1000.00', sequence: 0 },
    ]);
  });

  it('işlenmiş gece tekrar işlenmez; sınır verilmezse bütün geceler', () => {
    const plan = planRoomPostings({ nights, posted: [posted('2026-09-27', '1000.00'), posted('2026-09-28', '1000.00')] });
    assert.deepEqual(plan, [{ date: '2026-09-29', kind: 'NIGHT', amount: '1200.00', sequence: 0 }]);
  });

  it('fiyat sonradan değiştiyse fark kalemi (artı / eksi)', () => {
    const plan = planRoomPostings({
      nights,
      posted: [posted('2026-09-27', '800.00'), posted('2026-09-28', '1100.00'), posted('2026-09-29', '1200.00')],
    });
    assert.deepEqual(plan, [
      { date: '2026-09-27', kind: 'ADJUSTMENT', amount: '200.00', sequence: 1 },
      { date: '2026-09-28', kind: 'ADJUSTMENT', amount: '-100.00', sequence: 1 },
    ]);
  });

  it('fark kalemleri toplama katılır (ikinci çalışma aynı farkı yeniden işlemez)', () => {
    const plan = planRoomPostings({
      nights,
      posted: [posted('2026-09-27', '800.00'), posted('2026-09-27', '200.00'), posted('2026-09-28', '1000.00'), posted('2026-09-29', '1200.00')],
    });
    assert.deepEqual(plan, []);
  });

  it('iptal edilmiş gece (ikram) sistemce yeniden işlenmez', () => {
    const plan = planRoomPostings({ nights, posted: [posted('2026-09-27', '1000.00', true)], throughNight: '2026-09-27' });
    assert.deepEqual(plan, []);
  });

  it('ücretsiz gece kalem üretmez', () => {
    const plan = planRoomPostings({ nights: [{ date: '2026-09-27', amount: '0.00' }], posted: [] });
    assert.deepEqual(plan, []);
  });

  it('konaklamadan çıkmış ama işlenmiş gece sıfırlanır', () => {
    const plan = planRoomPostings({ nights: nights.slice(1), posted: [posted('2026-09-27', '1000.00'), posted('2026-09-28', '1000.00')] });
    assert.deepEqual(plan, [
      { date: '2026-09-27', kind: 'ADJUSTMENT', amount: '-1000.00', sequence: 1 },
      { date: '2026-09-29', kind: 'NIGHT', amount: '1200.00', sequence: 0 },
    ]);
  });

  it('sınırdan sonraki işlenmiş kalemlere dokunmaz', () => {
    const plan = planRoomPostings({ nights: nights.slice(0, 1), posted: [posted('2026-09-29', '1200.00')], throughNight: '2026-09-28' });
    assert.deepEqual(plan, [{ date: '2026-09-27', kind: 'NIGHT', amount: '1000.00', sequence: 0 }]);
  });

  it('tekrar işleme anahtarı: gece ücreti ve fark kalemleri ayrışır', () => {
    assert.equal(nightSourceKey('r1', { date: '2026-09-27', sequence: 0 }), 'night:r1:2026-09-27');
    assert.equal(nightSourceKey('r1', { date: '2026-09-27', sequence: 2 }), 'night:r1:2026-09-27:2');
  });
});

describe('resolvePostingFolio', () => {
  const stayFolios = [
    { id: 'f2', window: 2, status: 'OPEN' },
    { id: 'f1', window: 1, status: 'OPEN' },
  ];

  it('yönlendirme açık folyoya gider (başka konaklamanınsa kimliği döner)', () => {
    const routes = [{ type: 'ROOM', folio: { id: 'master', status: 'OPEN', reservationId: 'grup' } }];
    assert.deepEqual(resolvePostingFolio({ type: 'ROOM', routes, stayFolios }), { folioId: 'master', routed: true, reservationId: 'grup' });
  });

  it('yönlendirme yoksa ya da hedef kapalıysa konaklamanın ilk açık folyosu', () => {
    const routes = [{ type: 'ROOM', folio: { id: 'master', status: 'CLOSED', reservationId: 'grup' } }];
    assert.deepEqual(resolvePostingFolio({ type: 'ROOM', routes, stayFolios }), { folioId: 'f1', routed: false, reservationId: null });
    assert.equal(resolvePostingFolio({ type: 'FNB', routes, stayFolios }).folioId, 'f1');
  });

  it('açık folyo yoksa null (yeni folyo açılmalı)', () => {
    assert.equal(resolvePostingFolio({ type: 'ROOM', routes: [], stayFolios: [{ id: 'f1', window: 1, status: 'TRANSFERRED' }] }), null);
  });
});

describe('yardımcılar', () => {
  it('pencere numarası en büyüğün bir fazlası', () => {
    assert.equal(nextWindow([]), 1);
    assert.equal(nextWindow([1, 3]), 4);
  });

  it('satır toplamı ve sıfır bakiye', () => {
    assert.equal(linesTotal([{ total: '10.10' }, { total: '-0.10' }]), '10.00');
    assert.equal(linesTotal([]), '0.00');
    assert.equal(balanceIsZero('-0.00'), true);
    assert.equal(balanceIsZero('0.01'), false);
  });
});
