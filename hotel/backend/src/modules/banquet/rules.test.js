import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allocateInstallments,
  amountDue,
  atomicVenueIds,
  billablePax,
  cancellationFee,
  documentDecisionError,
  documentIssueError,
  documentNumber,
  eventPaymentIssue,
  eventPaymentState,
  eventRefundLimit,
  eventRank,
  eventTotals,
  holdRank,
  itemLine,
  occupiedRange,
  offerValidUntil,
  peakUsage,
  suggestInstallments,
  suggestVenuePrice,
} from './rules.js';

/**
 * Banket saf kuralları (modül 37): salon fiyat önerisi, bölünebilir salon,
 * kurulum / söküm aralığı, sıralı opsiyon, ekipman tepe kullanımı, kişi başı
 * kalem ve vergi, toplamlar, iptal bedeli, ödeme planı dağıtımı.
 */

const at = (time) => new Date(`2026-11-20T${time}:00.000Z`);
const hold = (id, eventId, start, end, status = 'TENTATIVE', heldAt = '2026-10-01T10:00:00.000Z', venueId = 'A') => ({
  id,
  eventId,
  venueId,
  startAt: at(start),
  endAt: at(end),
  status,
  heldAt: new Date(heldAt),
});

const KDV = { id: 't1', name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['OTHER'] };
const KDV_FNB = { id: 't2', name: 'KDV', rate: '10', isIncluded: true, appliesTo: ['FNB'] };
const SERVICE = { id: 't3', name: 'Servis', rate: '5', isIncluded: false, appliesTo: ['FNB'] };

describe('salon fiyat önerisi', () => {
  const venue = { hourlyRate: '2000', halfDayRate: '6000', dayRate: '10000' };

  it('kısa oturum saatlik, 4 saate kadar yarım gün, uzun oturum tam gün — en ucuzu', () => {
    assert.deepEqual(suggestVenuePrice(venue, 90), { basis: 'HOUR', quantity: '2', unitPrice: '2000.00', total: '4000.00' });
    assert.deepEqual(suggestVenuePrice(venue, 240), { basis: 'HALF_DAY', quantity: '1', unitPrice: '6000.00', total: '6000.00' });
    assert.deepEqual(suggestVenuePrice(venue, 300), { basis: 'DAY', quantity: '1', unitPrice: '10000.00', total: '10000.00' });
  });

  it('çok günlü oturum gün sayısı kadar; başlamış saat yukarı yuvarlanır', () => {
    assert.equal(suggestVenuePrice(venue, 25 * 60).quantity, '3', '25 saat = 10 saatlik 3 gün');
    assert.deepEqual(suggestVenuePrice({ hourlyRate: '1500', halfDayRate: null, dayRate: null }, 61), { basis: 'HOUR', quantity: '2', unitPrice: '1500.00', total: '3000.00' });
  });

  it('fiyatı olmayan salon ya da sıfır süre için öneri yok; eşitlikte gün önce', () => {
    assert.equal(suggestVenuePrice({ hourlyRate: null, halfDayRate: null, dayRate: null }, 120), null);
    assert.equal(suggestVenuePrice(venue, 0), null);
    assert.equal(suggestVenuePrice({ hourlyRate: '2500', halfDayRate: null, dayRate: '10000' }, 240).basis, 'DAY');
  });
});

describe('bölünebilir salon ve aralık', () => {
  const venues = [
    { id: 'BALO', parentId: null },
    { id: 'BALO-B', parentId: 'BALO' },
    { id: 'BALO-A', parentId: 'BALO' },
    { id: 'TERAS', parentId: null },
  ];

  it('bütün parçalarını kaplar, parça kendini, tekil salon kendini', () => {
    assert.deepEqual(atomicVenueIds('BALO', venues), ['BALO-A', 'BALO-B']);
    assert.deepEqual(atomicVenueIds('BALO-A', venues), ['BALO-A']);
    assert.deepEqual(atomicVenueIds('TERAS', venues), ['TERAS']);
  });

  it('salon kurulum öncesi ve söküm sonrası da dolu', () => {
    const range = occupiedRange({ startAt: at('19:00'), endAt: at('23:00'), setupMinutes: 120, teardownMinutes: 60 });
    assert.deepEqual([range.startAt.toISOString(), range.endAt.toISOString()], ['2026-11-20T17:00:00.000Z', '2026-11-21T00:00:00.000Z']);
  });
});

describe('sıralı opsiyon', () => {
  it('önce tutan 1., sonra gelen 2.; kesin tutma her zaman önde', () => {
    const first = hold('h1', 'E1', '18:00', '23:00', 'TENTATIVE', '2026-10-01T10:00:00.000Z');
    const second = hold('h2', 'E2', '20:00', '23:30', 'TENTATIVE', '2026-10-02T10:00:00.000Z');
    const all = [first, second];
    assert.equal(holdRank(first, all), 1);
    assert.equal(holdRank(second, all), 2);
    const definite = hold('h3', 'E3', '21:00', '22:00', 'DEFINITE', '2026-10-05T10:00:00.000Z');
    assert.equal(holdRank(first, [...all, definite]), 2, 'sonradan kesinleşen de önde');
    assert.equal(holdRank(definite, [...all, definite]), 1);
  });

  it('ardışık aralıklar, başka salon ve aynı etkinliğin tutmaları sayılmaz', () => {
    const mine = hold('h1', 'E1', '18:00', '20:00', 'TENTATIVE', '2026-10-05T10:00:00.000Z');
    const others = [
      hold('h2', 'E2', '20:00', '22:00', 'TENTATIVE', '2026-10-01T10:00:00.000Z'),
      hold('h3', 'E3', '18:00', '20:00', 'TENTATIVE', '2026-10-01T10:00:00.000Z', 'B'),
      hold('h4', 'E1', '18:00', '20:00', 'TENTATIVE', '2026-10-01T10:00:00.000Z'),
    ];
    assert.equal(holdRank(mine, [mine, ...others]), 1);
  });

  it('aynı anda tutulanlar kimliğe göre sıralanır (kararlı)', () => {
    const a = hold('aa', 'E1', '18:00', '20:00');
    const b = hold('bb', 'E2', '18:00', '20:00');
    assert.deepEqual([holdRank(a, [a, b]), holdRank(b, [a, b])], [1, 2]);
  });

  it('etkinliğin sırası en kötü tutması; önündeki etkinlikler listelenir', () => {
    const own = [hold('h1', 'E1', '10:00', '12:00', 'TENTATIVE', '2026-10-03T10:00:00.000Z'), hold('h2', 'E1', '14:00', '16:00', 'TENTATIVE', '2026-10-03T10:00:00.000Z', 'B')];
    const others = [hold('x1', 'E7', '11:00', '13:00', 'TENTATIVE', '2026-10-01T10:00:00.000Z'), hold('x2', 'E9', '15:00', '17:00', 'DEFINITE', '2026-10-04T10:00:00.000Z', 'B')];
    assert.deepEqual(eventRank(own, [...own, ...others]), { rank: 2, blockedBy: ['E7', 'E9'] });
    assert.equal(eventRank([], others), null);
  });
});

describe('ekipman tepe kullanımı', () => {
  it('çakışanlar toplanır, ardışıklar toplanmaz', () => {
    assert.equal(
      peakUsage([
        { startAt: at('09:00'), endAt: at('12:00'), quantity: 2 },
        { startAt: at('11:00'), endAt: at('14:00'), quantity: 3 },
        { startAt: at('14:00'), endAt: at('16:00'), quantity: 4 },
      ]),
      5,
    );
    assert.equal(peakUsage([]), 0);
  });
});

describe('kişi ve tutar', () => {
  it('faturalanacak kişi: önce garanti (yoksa tahmini), gerçekleşince garantinin altına inmez', () => {
    assert.equal(billablePax({ status: 'TENTATIVE', expectedPax: 150, guaranteedPax: null, actualPax: null }), 150);
    assert.equal(billablePax({ status: 'DEFINITE', expectedPax: 150, guaranteedPax: 120, actualPax: null }), 120);
    assert.equal(billablePax({ status: 'COMPLETED', expectedPax: 150, guaranteedPax: 120, actualPax: 110 }), 120);
    assert.equal(billablePax({ status: 'COMPLETED', expectedPax: 150, guaranteedPax: 120, actualPax: 134 }), 134);
    assert.equal(billablePax({ status: 'COMPLETED', expectedPax: 150, guaranteedPax: null, actualPax: 90 }), 90);
  });

  it('kişi başı kalem faturalanacak kişiyle çarpılır; indirim ve dahil / hariç vergi', () => {
    const menu = itemLine({ perPerson: true, quantity: '1', unitPrice: '1100.00', discountPct: '10', taxCategory: 'FNB' }, 100, [KDV_FNB, SERVICE]);
    // 1100 × 100 × %90 = 99.000 brüt (KDV dahil) → net 90.000; servis %5 hariç = 4.500.
    assert.deepEqual([menu.billedQuantity, menu.netAmount, menu.taxAmount, menu.total], ['100.00', '90000.00', '13500.00', '103500.00']);
    const rent = itemLine({ perPerson: false, quantity: '1.5', unitPrice: '12000', discountPct: '0', taxCategory: 'OTHER' }, 100, [KDV]);
    assert.deepEqual([rent.billedQuantity, rent.netAmount, rent.taxAmount, rent.total], ['1.50', '15000.00', '3000.00', '18000.00']);
  });

  it('toplamlar ve vergi dökümü kalemlerin toplamı', () => {
    const lines = [
      itemLine({ perPerson: true, quantity: '1', unitPrice: '1100', discountPct: '0', taxCategory: 'FNB' }, 10, [KDV_FNB]),
      itemLine({ perPerson: false, quantity: '1', unitPrice: '1200', discountPct: '0', taxCategory: 'OTHER' }, 10, [KDV]),
    ];
    const totals = eventTotals(lines);
    assert.deepEqual([totals.netTotal, totals.taxTotal, totals.grandTotal], ['11000.00', '1200.00', '12200.00']);
    assert.deepEqual(totals.taxes.map((tax) => [tax.name, tax.rate, tax.amount]), [['KDV', '10', '1000.00'], ['KDV', '20', '200.00']]);
  });
});

describe('iptal ve ödeme planı', () => {
  const tiers = [
    { daysBefore: 90, feePct: '10' },
    { daysBefore: 30, feePct: '50' },
    { daysBefore: 0, feePct: '100' },
  ];

  it('iptal bedeli kalan güne göre kademeden', () => {
    assert.deepEqual(cancellationFee({ grandTotal: '200000', tiers, daysBefore: 120 }), { feePct: '10', fee: '20000.00' });
    assert.deepEqual(cancellationFee({ grandTotal: '200000', tiers, daysBefore: 45 }), { feePct: '50', fee: '100000.00' });
    assert.deepEqual(cancellationFee({ grandTotal: '200000', tiers, daysBefore: -3 }), { feePct: '100', fee: '200000.00' });
    assert.deepEqual(cancellationFee({ grandTotal: '200000', tiers: [], daysBefore: 5 }), { feePct: '0', fee: '0.00' });
    assert.equal(amountDue({ status: 'CANCELLED', grandTotal: '200000', cancellationFee: '100000' }), '100000.00');
    assert.equal(amountDue({ status: 'DEFINITE', grandTotal: '200000', cancellationFee: null }), '200000.00');
    assert.equal(amountDue({ status: 'LOST', grandTotal: '200000', cancellationFee: null }), '0.00');
  });

  it('ödenen tutar vadesi eskiden yeniye dağılır; geçmiş vadede kalan borç gecikmiştir', () => {
    const plan = allocateInstallments(
      [
        { label: 'Kalan', dueDate: '2026-11-10', amount: '70000' },
        { label: 'Depozito', dueDate: '2026-10-01', amount: '30000' },
      ],
      '40000',
      '2026-10-16',
    );
    assert.deepEqual(plan.map((row) => [row.label, row.paid, row.remaining, row.status]), [
      ['Depozito', '30000.00', '0.00', 'PAID'],
      ['Kalan', '10000.00', '60000.00', 'PARTIAL'],
    ]);
    const late = allocateInstallments([{ label: 'Depozito', dueDate: '2026-10-01', amount: '30000' }], '0', '2026-10-16');
    assert.equal(late[0].status, 'OVERDUE');
  });

  it('önerilen plan: depozito bugün, kalan etkinlikten önce; kuruş farkı kalana', () => {
    assert.deepEqual(suggestInstallments({ grandTotal: '100000.01', depositPct: '30', today: '2026-10-16', eventDay: '2026-12-20', balanceDaysBefore: 7 }), [
      { label: 'Depozito', dueDate: '2026-10-16', amount: '30000.00' },
      { label: 'Kalan ödeme', dueDate: '2026-12-13', amount: '70000.01' },
    ]);
    assert.equal(suggestInstallments({ grandTotal: '5000', depositPct: '30', today: '2026-12-18', eventDay: '2026-12-20', balanceDaysBefore: 7 })[1].dueDate, '2026-12-18');
    assert.deepEqual(suggestInstallments({ grandTotal: '0', depositPct: '30', today: '2026-10-16', eventDay: '2026-12-20', balanceDaysBefore: 7 }), []);
  });
});

describe('etkinlik ödemesi', () => {
  const state = (postedNet, pendingPayments = '0.00', pendingRefunds = '0.00') => ({ postedNet, pendingPayments, pendingRefunds });

  it('özet: işlenmiş net (iade ve iptal kaydı dahil), bekleyen tahsilat ve iade ayrı', () => {
    assert.deepEqual(
      eventPaymentState([
        { status: 'POSTED', kind: 'PAYMENT', amount: '30000' },
        { status: 'POSTED', kind: 'REFUND', amount: '-5000' },
        { status: 'POSTED', kind: 'REVERSAL', amount: '-1000' },
        { status: 'PENDING', kind: 'PAYMENT', amount: '80000' },
        { status: 'PENDING', kind: 'REFUND', amount: '-2000' },
        { status: 'DECLINED', kind: 'PAYMENT', amount: '999' },
      ]),
      { postedNet: '24000.00', pendingPayments: '80000.00', pendingRefunds: '-2000.00' },
    );
    assert.deepEqual(eventPaymentState([]), { postedNet: '0.00', pendingPayments: '0.00', pendingRefunds: '0.00' });
  });

  it('açık etkinlikte depozito ve ara ödeme serbest; kaybedilene tahsilat yok', () => {
    for (const status of ['INQUIRY', 'TENTATIVE', 'DEFINITE']) {
      assert.equal(eventPaymentIssue({ kind: 'PAYMENT', status, amount: '500000', amountDue: '100000', state: state('0.00') }), null);
    }
    assert.match(eventPaymentIssue({ kind: 'PAYMENT', status: 'LOST', amount: '1', amountDue: '0', state: state('0.00') }).message, /Kaybedilen/);
  });

  it('gerçekleşmiş / iptal etkinlikte kalan borçtan fazlası alınmaz (bekleyen tahsilat düşülür)', () => {
    const due = { kind: 'PAYMENT', status: 'COMPLETED', amountDue: '120000.00', state: state('30000.00', '50000.00') };
    assert.equal(eventPaymentIssue({ ...due, amount: '40000' }), null);
    const over = eventPaymentIssue({ ...due, amount: '40000.01' });
    assert.equal(over.limit, '40000.00');
    assert.match(over.message, /etkinlik borcu/);
    const cancelled = eventPaymentIssue({ kind: 'PAYMENT', status: 'CANCELLED', amount: '1', amountDue: '15000.00', state: state('30000.00') });
    assert.equal(cancelled.limit, '0.00');
    assert.match(cancelled.message, /iptal bedeli kalmadı/);
  });

  it('açık dosyada iade alınan paradan (bekleyen iadeler düşülmüş) fazla olamaz', () => {
    const base = { kind: 'REFUND', status: 'DEFINITE', amountDue: '150000.00' };
    assert.equal(eventPaymentIssue({ ...base, amount: '13000', state: state('30000.00', '0.00', '-17000.00') }), null);
    const over = eventPaymentIssue({ ...base, amount: '13000.01', state: state('30000.00', '0.00', '-17000.00') });
    assert.equal(over.limit, '13000.00');
    assert.match(eventPaymentIssue({ ...base, amount: '1', state: state('0.00') }).message, /iade edilecek ödeme yok/);
    // Bekleyen tahsilat iade edilemez (henüz alınmadı).
    assert.match(eventPaymentIssue({ ...base, amount: '1', state: state('0.00', '50000.00') }).message, /iade edilecek ödeme yok/);
    // Kaybedilen dosya borçsuz: alınan paranın tamamı iade edilebilir.
    assert.equal(eventRefundLimit({ status: 'LOST', amountDue: '0.00', state: state('30000.00') }), '30000.00');
  });

  it('kapanmış dosyada yalnızca borcun üstündeki fazla iade edilir', () => {
    // 300.000 ödendi, iptal bedeli 265.000: en fazla 35.000; bekleyen 10.000 iade düşülür.
    assert.equal(eventRefundLimit({ status: 'CANCELLED', amountDue: '265000.00', state: state('300000.00') }), '35000.00');
    assert.equal(eventRefundLimit({ status: 'CANCELLED', amountDue: '265000.00', state: state('300000.00', '0.00', '-10000.00') }), '25000.00');
    const cancelled = { kind: 'REFUND', status: 'CANCELLED', amountDue: '265000.00', state: state('300000.00') };
    assert.equal(eventPaymentIssue({ ...cancelled, amount: '35000' }), null);
    assert.match(eventPaymentIssue({ ...cancelled, amount: '35000.01' }).message, /borcun üstündeki fazla/);
    assert.match(eventPaymentIssue({ ...cancelled, amountDue: '300000.00', amount: '1' }).message, /Fazla ödeme yok/);
    assert.equal(eventRefundLimit({ status: 'COMPLETED', amountDue: '563000.00', state: state('500000.00') }), '0.00');
  });
});

describe('etkinlik belgeleri', () => {
  const ready = { sessionCount: 2, itemCount: 5, cancellationFee: null };

  it('teklif satışta, sözleşme kesine kadar, proforma borç kesinleşince', () => {
    assert.equal(documentIssueError({ kind: 'OFFER', status: 'INQUIRY', ...ready }), null);
    assert.equal(documentIssueError({ kind: 'OFFER', status: 'TENTATIVE', ...ready }), null);
    assert.match(documentIssueError({ kind: 'OFFER', status: 'DEFINITE', ...ready }), /sözleşme sürümü/);
    for (const status of ['INQUIRY', 'TENTATIVE', 'DEFINITE']) assert.equal(documentIssueError({ kind: 'CONTRACT', status, ...ready }), null);
    assert.match(documentIssueError({ kind: 'CONTRACT', status: 'COMPLETED', ...ready }), /gerçekleşmiş/);
    assert.match(documentIssueError({ kind: 'PROFORMA', status: 'DEFINITE', ...ready }), /gerçekleşince/);
    assert.equal(documentIssueError({ kind: 'PROFORMA', status: 'COMPLETED', ...ready }), null);
    assert.equal(documentIssueError({ kind: 'PROFORMA', status: 'CANCELLED', ...ready, cancellationFee: '15000.00' }), null);
    assert.match(documentIssueError({ kind: 'PROFORMA', status: 'CANCELLED', ...ready, cancellationFee: '0.00' }), /İptal bedeli olmayan/);
    assert.match(documentIssueError({ kind: 'OFFER', status: 'LOST', ...ready }), /Kaybedilen/);
  });

  it('programı ya da kalemi olmayan dosyaya teklif / sözleşme çıkmaz', () => {
    assert.match(documentIssueError({ kind: 'OFFER', status: 'INQUIRY', ...ready, sessionCount: 0 }), /oturum/);
    assert.match(documentIssueError({ kind: 'CONTRACT', status: 'TENTATIVE', ...ready, itemCount: 0 }), /fiyat kalemlerini/);
  });

  it('karar: tür / durum / tarih / geçerlilik', () => {
    const base = { kind: 'OFFER', status: 'ISSUED', decision: 'ACCEPTED', date: '2026-10-16', issuedDay: '2026-10-10', validUntil: '2026-10-24', today: '2026-10-16' };
    assert.equal(documentDecisionError(base), null);
    assert.equal(documentDecisionError({ ...base, decision: 'DECLINED', date: '2026-10-30', today: '2026-10-30' }), null);
    assert.match(documentDecisionError({ ...base, date: '2026-10-25', today: '2026-10-25' }).message, /geçerliliği/);
    assert.deepEqual(documentDecisionError({ ...base, date: '2026-10-17' }), { message: 'Karar günü ileri bir tarih olamaz.', field: 'date' });
    assert.equal(documentDecisionError({ ...base, date: '2026-10-09' }).field, 'date');
    assert.match(documentDecisionError({ ...base, decision: 'SIGNED' }).message, /imza sözleşmeye/);
    assert.match(documentDecisionError({ ...base, kind: 'CONTRACT' }).message, /imzalandı/);
    assert.equal(documentDecisionError({ ...base, kind: 'CONTRACT', decision: 'SIGNED', validUntil: null }), null);
    assert.match(documentDecisionError({ ...base, status: 'SUPERSEDED' }).message, /yeni sürümü/);
    assert.match(documentDecisionError({ ...base, status: 'ACCEPTED' }).message, /zaten/);
    assert.match(documentDecisionError({ ...base, kind: 'PROFORMA' }).message, /Proforma/);
  });

  it('teklif geçerliliği politikadan; etkinliğin ilk gününü geçmez', () => {
    assert.equal(offerValidUntil({ today: '2026-10-16', validityDays: 14, firstDay: '2026-12-20' }), '2026-10-30');
    assert.equal(offerValidUntil({ today: '2026-10-16', validityDays: 14, firstDay: '2026-10-20' }), '2026-10-20');
    assert.equal(offerValidUntil({ today: '2026-10-16', validityDays: 14, firstDay: null }), '2026-10-30');
    assert.equal(offerValidUntil({ today: '2026-10-16', validityDays: 14, firstDay: '2026-10-10' }), '2026-10-16');
  });

  it('belge numarası: ilk sürüm seriden, sonrakiler aynı numara + sürüm', async () => {
    let calls = 0;
    const freshNumber = async () => {
      calls += 1;
      return 'TKL-2026-0007';
    };
    assert.equal(await documentNumber({ previousNumber: null, version: 1, freshNumber }), 'TKL-2026-0007');
    assert.equal(await documentNumber({ previousNumber: 'TKL-2026-0007', version: 2, freshNumber }), 'TKL-2026-0007/2');
    assert.equal(await documentNumber({ previousNumber: 'TKL-2026-0007/2', version: 3, freshNumber }), 'TKL-2026-0007/3');
    assert.equal(calls, 1);
  });
});
