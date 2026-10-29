import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bestQuoteLine } from '@hotelos/hotel-contracts';
import {
  addDays,
  consolidateRoundLines,
  lineAmounts,
  needsApproval,
  orderStatusAfterReceipt,
  planAward,
  receiptPlan,
  receivableQuantity,
  requestStatusOf,
  roundStatusOf,
  stockSuggestion,
  sumAmounts,
} from './rules.js';

const text = (amounts) => ({ net: amounts.net.toFixed(2), tax: amounts.tax.toFixed(2), total: amounts.total.toFixed(2) });

describe('lineAmounts / sumAmounts', () => {
  it('KDV hariç tutar ve KDV satırda kuruşa yuvarlanır', () => {
    // 12.345 kg × 187.6543 = 2316.5923… → 2316.59; %10 KDV 231.659 → 231.66
    assert.deepEqual(text(lineAmounts('12.345', '187.6543', '10')), { net: '2316.59', tax: '231.66', total: '2548.25' });
  });

  it('yarım kuruş yukarı yuvarlanır', () => {
    // 1 × 0.125 → 0.13 (net); %20 → 0.026 → 0.03
    assert.deepEqual(text(lineAmounts('1', '0.125', '20')), { net: '0.13', tax: '0.03', total: '0.16' });
  });

  it('%0 KDV', () => {
    assert.deepEqual(text(lineAmounts('3', '10', '0')), { net: '30.00', tax: '0.00', total: '30.00' });
  });

  it('belge toplamı satırların toplamı (yeniden yuvarlanmaz)', () => {
    const rows = [lineAmounts('1', '0.125', '20'), lineAmounts('1', '0.125', '20'), lineAmounts('1', '0.125', '20')];
    assert.deepEqual(text(sumAmounts(rows)), { net: '0.39', tax: '0.09', total: '0.48' });
  });
});

describe('needsApproval', () => {
  it('eşik ve üstü onaya gider', () => {
    assert.equal(needsApproval('50000.00', '50000'), true);
    assert.equal(needsApproval('49999.99', '50000'), false);
  });

  it('eşik 0 = onay yok', () => {
    assert.equal(needsApproval('999999', '0'), false);
  });
});

describe('consolidateRoundLines', () => {
  it('malzeme başına toplar, en erken ihtiyaç günü', () => {
    const { items, mismatched } = consolidateRoundLines(
      [
        { id: 'a', stockItemId: 's1', quantity: '2.5', unit: 'KG', neededBy: '2026-11-05' },
        { id: 'b', stockItemId: 's1', quantity: '1.25', unit: 'KG', neededBy: '2026-11-03' },
        { id: 'c', stockItemId: 's2', quantity: '12', unit: 'PIECE', neededBy: '2026-11-04' },
      ],
      new Map([
        ['s1', 'KG'],
        ['s2', 'PIECE'],
      ]),
    );
    assert.deepEqual(mismatched, []);
    const s1 = items.get('s1');
    assert.equal(s1.quantity.toString(), '3.75');
    assert.equal(s1.neededBy, '2026-11-03');
    assert.deepEqual(s1.requestLineIds, ['a', 'b']);
    assert.equal(items.get('s2').quantity.toString(), '12');
  });

  it('birimi sonradan değişmiş malzeme birleştirilmez', () => {
    const { items, mismatched } = consolidateRoundLines(
      [
        { id: 'a', stockItemId: 's1', quantity: '2', unit: 'KG', neededBy: '2026-11-05' },
        { id: 'b', stockItemId: 's1', quantity: '500', unit: 'G', neededBy: '2026-11-05' },
      ],
      new Map([['s1', 'G']]),
    );
    assert.deepEqual(mismatched, ['s1']);
    assert.equal(items.get('s1').quantity.toString(), '500');
  });
});

describe('planAward', () => {
  const lines = [
    { id: 'L1', name: 'Dana but', ordered: false, released: false },
    { id: 'L2', name: 'Domates', ordered: false, released: false },
    { id: 'L3', name: 'Süt', ordered: true, released: false },
  ];
  const quote = (id, supplierId, deliveryDays, createdAt, prices, extra = {}) => ({
    id,
    supplierId,
    supplierName: supplierId.toUpperCase(),
    supplierActive: true,
    deliveryDays,
    validUntil: null,
    createdAt,
    ...extra,
    lines: Object.entries(prices).map(([roundLineId, unitPrice]) => ({ id: `${id}-${roundLineId}`, roundLineId, unitPrice, taxRatePct: '10' })),
  });
  const quotes = [
    quote('QA', 'kasap', 2, '2026-10-29T08:00:00.000Z', { L1: '420', L2: null, L3: '30' }),
    quote('QB', 'hal', 1, '2026-10-29T09:00:00.000Z', { L1: '415.5', L2: '28.4', L3: '29' }),
    quote('QC', 'toptan', 1, '2026-10-29T10:00:00.000Z', { L1: '415.5', L2: '28.4' }),
  ];
  const today = '2026-10-29';

  it('en uygunlar gerekçesiz, tedarikçi başına gruplanır', () => {
    const { fields, groups } = planAward({
      lines,
      quotes,
      today,
      awards: [
        { roundLineId: 'L1', quoteLineId: 'QB-L1' },
        { roundLineId: 'L2', quoteLineId: 'QB-L2' },
      ],
    });
    assert.deepEqual(fields, {});
    assert.equal(groups.length, 1);
    assert.equal(groups[0].supplierId, 'hal');
    assert.deepEqual(
      groups[0].lines.map((line) => [line.roundLineId, line.best, line.reason]),
      [
        ['L1', true, null],
        ['L2', true, null],
      ],
    );
  });

  it('eşit fiyat ve terminde önce girilen en uygundur; diğeri gerekçe ister', () => {
    const { fields } = planAward({ lines, quotes, today, awards: [{ roundLineId: 'L2', quoteLineId: 'QC-L2' }] });
    assert.match(fields['awards.0.reason'], /gerekçe/);
    const ok = planAward({ lines, quotes, today, awards: [{ roundLineId: 'L2', quoteLineId: 'QC-L2', reason: 'Hal teslimatı güvenilmez' }] });
    assert.deepEqual(ok.fields, {});
    assert.equal(ok.groups[0].lines[0].reason, 'Hal teslimatı güvenilmez');
    assert.equal(ok.groups[0].lines[0].best, false);
  });

  it('pahalı seçim gerekçeyle iki ayrı siparişe döner', () => {
    const { fields, groups } = planAward({
      lines,
      quotes,
      today,
      awards: [
        { roundLineId: 'L2', quoteLineId: 'QB-L2' },
        { roundLineId: 'L1', quoteLineId: 'QA-L1', reason: 'Kasap kalitesi' },
      ],
    });
    assert.deepEqual(fields, {});
    assert.deepEqual(groups.map((group) => group.supplierId).sort(), ['hal', 'kasap']);
  });

  it('siparişe dönmüş satır, fiyatsız teklif ve başka satırın teklifi reddedilir', () => {
    const { fields, groups } = planAward({
      lines,
      quotes,
      today,
      awards: [
        { roundLineId: 'L3', quoteLineId: 'QB-L3' },
        { roundLineId: 'L2', quoteLineId: 'QA-L2', reason: 'deneme deneme' },
        { roundLineId: 'L1', quoteLineId: 'QB-L2' },
        { roundLineId: 'XX', quoteLineId: 'QB-L1' },
      ],
    });
    assert.match(fields['awards.0.roundLineId'], /zaten siparişe döndü/);
    assert.match(fields['awards.1.quoteLineId'], /fiyat vermedi/);
    assert.match(fields['awards.2.quoteLineId'], /bu satırın değil/);
    assert.equal(fields['awards.3.roundLineId'], 'Satır bu turda yok');
    assert.equal(groups.length, 0);
  });

  it('geçerliliği dolmuş teklif seçilemez ve en uygun hesabına girmez', () => {
    const expired = [quote('QB', 'hal', 1, '2026-10-29T09:00:00.000Z', { L1: '400' }, { validUntil: '2026-10-28' }), quotes[0]];
    const { fields } = planAward({ lines, quotes: expired, today, awards: [{ roundLineId: 'L1', quoteLineId: 'QB-L1' }] });
    assert.match(fields['awards.0.quoteLineId'], /28\.10\.2026/);
    // Süresi dolan ucuz teklif sayılmaz: kalan tek geçerli teklif (kasap) gerekçesiz seçilir.
    const ok = planAward({ lines, quotes: expired, today, awards: [{ roundLineId: 'L1', quoteLineId: 'QA-L1' }] });
    assert.deepEqual(ok.fields, {});
  });

  it('ihtiyaca yetişmeyen ucuz teklif önerilmez; seçmek gerekçe ister', () => {
    const timed = [{ id: 'L1', name: 'Kuzu incik', neededBy: '2026-11-01', ordered: false, released: false }];
    const offers = [
      quote('QS', 'sut', 4, '2026-10-29T08:00:00.000Z', { L1: '595' }), // 29 + 4 = 2 Kasım: geç
      quote('QK', 'kasap', 1, '2026-10-29T09:00:00.000Z', { L1: '620' }),
    ];
    const { fields } = planAward({ lines: timed, quotes: offers, today, awards: [{ roundLineId: 'L1', quoteLineId: 'QS-L1' }] });
    assert.match(fields['awards.0.reason'], /gerekçe/);
    const ok = planAward({ lines: timed, quotes: offers, today, awards: [{ roundLineId: 'L1', quoteLineId: 'QK-L1' }] });
    assert.deepEqual(ok.fields, {});
    assert.equal(ok.groups[0].lines[0].best, true);
    // Bir gün sonraki ihtiyaçta ikisi de yetişir: ucuz olan en uygun.
    const relaxed = planAward({ lines: [{ ...timed[0], neededBy: '2026-11-02' }], quotes: offers, today, awards: [{ roundLineId: 'L1', quoteLineId: 'QS-L1' }] });
    assert.deepEqual(relaxed.fields, {});
  });

  it('pasif tedarikçi seçilemez', () => {
    const inactive = [quote('QB', 'hal', 1, '2026-10-29T09:00:00.000Z', { L1: '400' }, { supplierActive: false })];
    const { fields } = planAward({ lines, quotes: inactive, today, awards: [{ roundLineId: 'L1', quoteLineId: 'QB-L1' }] });
    assert.match(fields['awards.0.quoteLineId'], /pasif/);
  });
});

describe('bestQuoteLine', () => {
  const at = (minute) => `2026-10-29T08:${String(minute).padStart(2, '0')}:00.000Z`;
  it('önce ihtiyaca yetişen, sonra fiyat, termin, önce girilen', () => {
    assert.equal(
      bestQuoteLine([
        { id: 'late-cheap', unitPrice: '10', deliveryDays: 5, createdAt: at(1), late: true },
        { id: 'on-time', unitPrice: '12.5', deliveryDays: 2, createdAt: at(2), late: false },
        { id: 'on-time-fast', unitPrice: '12.5000', deliveryDays: 1, createdAt: at(3), late: false },
      ]),
      'on-time-fast',
    );
    assert.equal(
      bestQuoteLine([
        { id: 'a', unitPrice: '7.0001', deliveryDays: 1, createdAt: at(1) },
        { id: 'b', unitPrice: '7', deliveryDays: 1, createdAt: at(2) },
      ]),
      'b',
    );
    assert.equal(
      bestQuoteLine([
        { id: 'first', unitPrice: '7', deliveryDays: 1, createdAt: at(1) },
        { id: 'second', unitPrice: '7', deliveryDays: 1, createdAt: at(2) },
      ]),
      'first',
    );
  });

  it('hepsi geçse en ucuzu; fiyatsız teklif sayılmaz', () => {
    assert.equal(
      bestQuoteLine([
        { id: 'x', unitPrice: '9', deliveryDays: 5, createdAt: at(1), late: true },
        { id: 'y', unitPrice: '8', deliveryDays: 6, createdAt: at(2), late: true },
        { id: 'z', unitPrice: null, deliveryDays: 0, createdAt: at(3), late: false },
      ]),
      'y',
    );
    assert.equal(bestQuoteLine([{ id: 'z', unitPrice: null, deliveryDays: 0, createdAt: at(3) }]), null);
  });
});

describe('receivableQuantity / receiptPlan', () => {
  const orderLines = [
    { id: 'o1', stockItemId: 's1', name: 'Dana but', unit: 'KG', quantity: '10', receivedQuantity: '0', unitPrice: '415.5', taxRatePct: '1' },
    { id: 'o2', stockItemId: 's2', name: 'Yumurta', unit: 'PIECE', quantity: '360', receivedQuantity: '180', unitPrice: '4.25', taxRatePct: '1' },
  ];

  it('tartılan malzemede %5 fazla, adette kalan kadar', () => {
    assert.equal(receivableQuantity(orderLines[0]).toString(), '10.5');
    assert.equal(receivableQuantity(orderLines[1]).toString(), '180');
    assert.equal(receivableQuantity({ unit: 'KG', quantity: '10', receivedQuantity: '10.5' }).toString(), '0');
  });

  it('kısmi kabul: tutarlar sipariş fiyatıyla, sipariş tam değil', () => {
    const plan = receiptPlan({ orderLines, inputLines: [{ orderLineId: 'o1', quantity: '10.2' }, { orderLineId: 'o2', quantity: '0' }] });
    assert.deepEqual(plan.fields, {});
    assert.equal(plan.lines.length, 1);
    // 10.2 × 415.5 = 4238.10; %1 = 42.381 → 42.38
    assert.deepEqual(text(plan.totals), { net: '4238.10', tax: '42.38', total: '4280.48' });
    assert.equal(plan.fullyReceived, false);
  });

  it('kalanların hepsi gelince sipariş tamdır', () => {
    const plan = receiptPlan({ orderLines, inputLines: [{ orderLineId: 'o1', quantity: '10' }, { orderLineId: 'o2', quantity: '180' }] });
    assert.equal(plan.fullyReceived, true);
  });

  it('sınır aşımı ve yabancı satır alan hatası', () => {
    const plan = receiptPlan({ orderLines, inputLines: [{ orderLineId: 'o1', quantity: '10.501' }, { orderLineId: 'o2', quantity: '181' }, { orderLineId: 'x', quantity: '1' }] });
    assert.match(plan.fields['lines.0.quantity'], /en fazla 10\.5 kg teslim alınabilir \(sipariş \+ %5\)/);
    assert.match(plan.fields['lines.1.quantity'], /en fazla 180 adet teslim alınabilir$/);
    assert.equal(plan.fields['lines.2.orderLineId'], 'Satır bu siparişte yok');
  });

  it('tamamı alınmış satıra yeni giriş', () => {
    const plan = receiptPlan({ orderLines: [{ ...orderLines[1], receivedQuantity: '360' }], inputLines: [{ orderLineId: 'o2', quantity: '1' }] });
    assert.match(plan.fields['lines.0.quantity'], /tamamen teslim alındı/);
  });
});

describe('durumlar', () => {
  it('sipariş: tam → teslim alındı, eksik kapat → kapandı, değilse kısmen', () => {
    assert.equal(orderStatusAfterReceipt({ fullyReceived: true, closeShort: true }), 'RECEIVED');
    assert.equal(orderStatusAfterReceipt({ fullyReceived: false, closeShort: true }), 'CLOSED');
    assert.equal(orderStatusAfterReceipt({ fullyReceived: false, closeShort: false }), 'PARTIALLY_RECEIVED');
  });

  it('talep: turda değil → açık; hepsi siparişte → siparişe döndü; arası işlemde', () => {
    assert.equal(requestStatusOf({ lines: 0, inRound: 0, ordered: 0 }), 'OPEN');
    assert.equal(requestStatusOf({ lines: 1, inRound: 0, ordered: 0 }), 'OPEN');
    assert.equal(requestStatusOf({ lines: 2, inRound: 1, ordered: 0 }), 'IN_PROGRESS');
    assert.equal(requestStatusOf({ lines: 2, inRound: 2, ordered: 1 }), 'IN_PROGRESS');
    assert.equal(requestStatusOf({ lines: 2, inRound: 2, ordered: 2 }), 'ORDERED');
  });

  it('tur: bekleyen satır → açık; siparişli → siparişe döndü; hepsi bırakıldı → iptal', () => {
    assert.equal(roundStatusOf([{ ordered: true, released: false }, { ordered: false, released: false }]), 'OPEN');
    assert.equal(roundStatusOf([{ ordered: true, released: false }, { ordered: false, released: true }]), 'AWARDED');
    assert.equal(roundStatusOf([{ ordered: false, released: true }]), 'CANCELLED');
  });
});

describe('stockSuggestion', () => {
  it('minimum − eldeki − yoldaki − talep edilen, yukarı yuvarlı', () => {
    assert.equal(stockSuggestion({ minLevel: '20', onHand: '4.2', onOrder: '5', requested: '2.5', unit: 'KG' }).toString(), '8.3');
    assert.equal(stockSuggestion({ minLevel: '100', onHand: '30.4', onOrder: '0', requested: '0', unit: 'PIECE' }).toString(), '70');
  });

  it('açık yoksa öneri yok', () => {
    assert.equal(stockSuggestion({ minLevel: '10', onHand: '6', onOrder: '4', requested: '0', unit: 'KG' }), null);
    assert.equal(stockSuggestion({ minLevel: '10', onHand: '12', onOrder: '0', requested: '0', unit: 'KG' }), null);
  });
});

describe('addDays', () => {
  it('ay ve yıl geçişi', () => {
    assert.equal(addDays('2026-10-29', 30), '2026-11-28');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-10-29', 0), '2026-10-29');
  });
});
