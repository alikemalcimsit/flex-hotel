import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { equalShares, tableState } from '@hotelos/hotel-contracts';
import {
  adjustmentNeedsApproval,
  adjustmentValue,
  allocate,
  checkBalance,
  checkNumber,
  checkTotals,
  discountValue,
  lineAmounts,
  lineFreeQuantity,
  roomChargeItems,
  shiftCash,
  splitPlan,
  varianceNeedsAlert,
} from './rules.js';
import { chargeLine } from '../folios/rules.js';

/**
 * Restoran POS saf kuralları (modül 39): kalem tutarı (iptal / ikram düşülür), indirim ve
 * kuruş dağıtımı, kalem kalem vergi (dahil + hariç), bakiye, düzeltme değeri ve onay eşiği,
 * bölme planı, vardiya kasası, hesap bölüşme, masa durumu.
 */

const KDV10 = { id: 'k10', name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['FNB'] };
const KDV20 = { id: 'k20', name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['OTHER'] };
const SERVICE = { id: 's', name: 'Servis', rate: '5', isIncluded: false, appliesTo: ['FNB'] };
const line = (overrides = {}) => ({ quantity: 2, voidedQuantity: 0, compedQuantity: 0, unitPrice: '110.00', taxCategory: 'FNB', ...overrides });

describe('kalem ve indirim', () => {
  it('faturalanan adet iptal ve ikram düşülerek; değerleri ayrıca', () => {
    assert.deepEqual(lineAmounts(line({ quantity: 5, voidedQuantity: 1, compedQuantity: 2 })), { billableQuantity: 2, gross: '220.00', compValue: '220.00', voidValue: '110.00' });
    assert.equal(lineFreeQuantity(line({ quantity: 5, voidedQuantity: 1, compedQuantity: 2 }), 1), 1);
  });

  it('indirim: yüzde kuruşa yuvarlanır, tutar ara toplamı aşamaz', () => {
    assert.equal(discountValue('333.33', { discountPct: '10', discountAmount: null }), '33.33');
    assert.equal(discountValue('100.00', { discountPct: null, discountAmount: '150' }), '100.00');
    assert.equal(discountValue('100.00', { discountPct: null, discountAmount: null }), '0.00');
  });

  it('kuruş dağıtımı: toplam birebir, en büyük kalan kazanır', () => {
    assert.deepEqual(allocate('10.00', ['100', '100', '100']), ['3.34', '3.33', '3.33']);
    assert.deepEqual(allocate('0.05', ['1', '3']), ['0.01', '0.04']);
    assert.deepEqual(allocate('5.00', ['0', '0']), ['0.00', '0.00']);
    const parts = allocate('123.45', ['17.10', '0.90', '250.00', '33.33']);
    assert.equal(parts.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0), 12345);
  });
});

describe('adisyon toplamı ve vergi', () => {
  it('kalem kalem vergi; indirim kalemlere orantılı; toplam = ara toplam − indirim (dahil vergide)', () => {
    const totals = checkTotals({
      lines: [line({ quantity: 2, unitPrice: '110.00' }), line({ quantity: 1, unitPrice: '120.00', taxCategory: 'OTHER' })],
      discountPct: '10',
      discountAmount: null,
      taxes: [KDV10, KDV20],
    });
    // Ara toplam 340; indirim 34 → 198 (FNB) + 108 (OTHER) = 306.
    assert.equal(totals.subtotal, '340.00');
    assert.equal(totals.discountTotal, '34.00');
    assert.equal(totals.grandTotal, '306.00');
    assert.equal(totals.netTotal, '270.00');
    assert.equal(totals.taxTotal, '36.00');
    assert.deepEqual(totals.taxes.map((tax) => [tax.rate, tax.amount]), [['10', '18.00'], ['20', '18.00']]);
  });

  it('hariç vergi toplamın üstüne eklenir; ikram ve iptal tutara girmez', () => {
    const totals = checkTotals({
      lines: [line({ quantity: 3, compedQuantity: 1, voidedQuantity: 1, unitPrice: '110.00' })],
      discountPct: null,
      discountAmount: null,
      taxes: [KDV10, SERVICE],
    });
    assert.equal(totals.subtotal, '110.00');
    assert.equal(totals.compTotal, '110.00');
    assert.equal(totals.voidTotal, '110.00');
    // Vergisiz 100, KDV 10 (dahil), servis 5 (hariç).
    assert.equal(totals.grandTotal, '115.00');
    assert.equal(totals.taxTotal, '15.00');
  });

  it('tamamı ikram adisyonu sıfırdır; bakiye', () => {
    const totals = checkTotals({ lines: [line({ quantity: 1, compedQuantity: 1 })], discountPct: null, discountAmount: null, taxes: [KDV10] });
    assert.equal(totals.grandTotal, '0.00');
    assert.equal(checkBalance({ grandTotal: '306.00', paidTotal: '200.00', roomChargeTotal: '50.00' }), '56.00');
  });
});

describe('odaya yaz: folyo kalemleri', () => {
  const folioTotal = (items, taxes) =>
    items.reduce((sum, item) => sum + Math.round(Number(chargeLine({ amount: item.gross, quantity: 1, taxCategory: item.taxCategory, taxes }).total) * 100), 0);
  const mixed = (taxes) =>
    checkTotals({
      lines: [line({ quantity: 3, unitPrice: '187.35' }), line({ quantity: 2, unitPrice: '64.90', taxCategory: 'OTHER' }), line({ quantity: 1, unitPrice: '0.45' })],
      discountPct: '7.5',
      discountAmount: null,
      taxes,
    });

  it('kategori toplamları adisyon toplamını verir; tamamı odaya yazılınca kalemler kategorilerdir', () => {
    const taxes = [KDV10, KDV20, SERVICE];
    const totals = mixed(taxes);
    assert.equal(totals.categories.length, 2);
    const sum = totals.categories.reduce((acc, category) => acc + Math.round(Number(category.total) * 100), 0);
    assert.equal(sum, Math.round(Number(totals.grandTotal) * 100));
    const plan = roomChargeItems({ categories: totals.categories, amount: totals.grandTotal, taxes });
    assert.deepEqual(plan.items, totals.categories.map(({ taxCategory, gross }) => ({ taxCategory, gross })));
    assert.equal(folioTotal(plan.items, taxes), Math.round(Number(totals.grandTotal) * 100));
  });

  it('yalnız dahil vergi: her kısmi tutar folyoya birebir yazılır, kategori brütü aşılmaz', () => {
    const taxes = [KDV10, KDV20];
    const totals = mixed(taxes);
    const grand = Math.round(Number(totals.grandTotal) * 100);
    for (let amount = 1; amount < grand; amount += 37) {
      const plan = roomChargeItems({ categories: totals.categories, amount: (amount / 100).toFixed(2), taxes });
      assert.equal(plan.error, undefined, `tutar ${amount}`);
      assert.equal(folioTotal(plan.items, taxes), amount);
      for (const item of plan.items) {
        const category = totals.categories.find((entry) => entry.taxCategory === item.taxCategory);
        assert.ok(Number(item.gross) <= Number(category.gross));
      }
    }
  });

  it('hariç vergi: ya birebir yazılır ya da reddedilip erişilebilir en yakın iki tutar önerilir', () => {
    const taxes = [KDV10, KDV20, SERVICE];
    const totals = mixed(taxes);
    const grand = Math.round(Number(totals.grandTotal) * 100);
    let exact = 0;
    let rejected = 0;
    // Baştan, ortadan ve sondan kuruş kuruş pencereler (kenarlar ve orantı ortası).
    const windows = [1, Math.floor(grand / 2) - 1500, grand - 3000].flatMap((start) => Array.from({ length: 3000 }, (_, index) => start + index));
    for (const amount of windows.filter((value) => value > 0 && value <= grand)) {
      const plan = roomChargeItems({ categories: totals.categories, amount: (amount / 100).toFixed(2), taxes });
      if (!plan.error) {
        exact += 1;
        assert.equal(folioTotal(plan.items, taxes), amount, `tutar ${amount}`);
        continue;
      }
      rejected += 1;
      assert.ok(plan.nearest.length >= 1);
      for (const near of plan.nearest) {
        const value = Math.round(Number(near) * 100);
        assert.notEqual(value, amount);
        assert.equal(roomChargeItems({ categories: totals.categories, amount: near, taxes }).error, undefined, `öneri ${near}`);
      }
    }
    // İki kategoriyle kuruş takası çoğu tutarı kurtarır; reddedilen azınlıktır.
    assert.ok(exact > rejected * 20, `${exact} / ${rejected}`);
  });

  it('tek kategori + servis ücreti: erişilemez tutar reddedilir, öneriler alt / üst komşu', () => {
    const taxes = [KDV10, SERVICE];
    const totals = checkTotals({ lines: [line({ quantity: 1, unitPrice: '1000.00' })], discountPct: null, discountAmount: null, taxes });
    const grand = Math.round(Number(totals.grandTotal) * 100);
    const unreachable = [];
    for (let amount = grand - 4000; amount < grand; amount += 1) {
      const plan = roomChargeItems({ categories: totals.categories, amount: (amount / 100).toFixed(2), taxes });
      if (plan.error) unreachable.push([amount, plan.nearest.map((near) => Math.round(Number(near) * 100))]);
    }
    assert.ok(unreachable.length > 0);
    for (const [amount, [lower, upper]] of unreachable) {
      assert.ok(lower < amount && amount < upper, `${lower} < ${amount} < ${upper}`);
    }
    assert.match(roomChargeItems({ categories: totals.categories, amount: '0', taxes }).error, /tutar yok/);
    assert.match(roomChargeItems({ categories: totals.categories, amount: '99999.00', taxes }).error, /aşıyor/);
  });
});

describe('düzeltme ve onay eşiği', () => {
  it('değer: ikram / iptal adet × fiyat, indirim ara toplamdan', () => {
    assert.equal(adjustmentValue({ kind: 'COMP', unitPrice: '450.00', quantity: 3 }), '1350.00');
    assert.equal(adjustmentValue({ kind: 'DISCOUNT', subtotal: '2000.00', discountPct: '15' }), '300.00');
  });

  it('eşik: eşit ve üstü onaya; 0 kapalı', () => {
    assert.equal(adjustmentNeedsApproval('1000.00', '1000.00'), true);
    assert.equal(adjustmentNeedsApproval('999.99', '1000.00'), false);
    assert.equal(adjustmentNeedsApproval('50000.00', '0.00'), false);
  });
});

describe('bölme', () => {
  const lines = [
    { id: 'a', quantity: 4, voidedQuantity: 0, compedQuantity: 0 },
    { id: 'b', quantity: 2, voidedQuantity: 0, compedQuantity: 1 },
    { id: 'c', quantity: 1, voidedQuantity: 0, compedQuantity: 0 },
  ];

  it('tam kalem taşınır, kısmi kalem bölünür; iptal / ikramlı kalemin yalnız serbest adedi', () => {
    const plan = splitPlan(lines, [{ lineId: 'a', quantity: 2 }, { lineId: 'c', quantity: 1 }, { lineId: 'b', quantity: 1 }]);
    assert.deepEqual(plan.errors, {});
    assert.deepEqual(plan.whole, ['c']);
    assert.deepEqual(plan.partial, [{ lineId: 'a', quantity: 2 }, { lineId: 'b', quantity: 1 }]);
    assert.equal(splitPlan(lines, [{ lineId: 'b', quantity: 2 }]).errors['lines.0.quantity'], 'En fazla 1 adet taşınır');
  });

  it('onay bekleyen kalem taşınmaz; hepsi taşınırsa bölme değil taşıma', () => {
    assert.match(splitPlan(lines, [{ lineId: 'a', quantity: 1 }], new Map([['a', 1]])).errors['lines.0.lineId'], /onay bekleyen/);
    const all = splitPlan(lines, [{ lineId: 'a', quantity: 4 }, { lineId: 'b', quantity: 1 }, { lineId: 'c', quantity: 1 }]);
    assert.match(all.errors.lines, /taşıyın/);
    assert.match(splitPlan(lines, [{ lineId: 'x', quantity: 1 }]).errors['lines.0.lineId'], /adisyonun değil/);
  });
});

describe('vardiya, bölüşme, masa, numara', () => {
  it('beklenen nakit ve fark', () => {
    assert.deepEqual(shiftCash({ openingFloat: '500.00', cashNet: '12340.50', countedCash: '12820.50' }), { expectedCash: '12840.50', variance: '-20.00' });
    assert.equal(shiftCash({ openingFloat: '500', cashNet: '0' }).variance, null);
    assert.equal(varianceNeedsAlert('-150.00', '100.00'), true);
    assert.equal(varianceNeedsAlert('100.00', '100.00'), false);
    assert.equal(varianceNeedsAlert('0.01', '0'), true);
  });

  it('hesap bölüşme kuruşu ilk paylara verir; masa durumu', () => {
    assert.deepEqual(equalShares('100.00', 3), ['33.34', '33.33', '33.33']);
    assert.deepEqual(equalShares('0', 3), []);
    assert.equal(tableState([]), 'FREE');
    assert.equal(tableState([{ billRequestedAt: null }]), 'OCCUPIED');
    assert.equal(tableState([{ billRequestedAt: null }, { billRequestedAt: '2026-10-18T20:00:00Z' }]), 'BILL');
    assert.equal(checkNumber(2026, 123), 'ADS-2026-000123');
  });
});
