import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spaBalance, spaFee, spaListPrice, spaPayableLimit, spaPaymentIssue, spaPaymentState, spaRefundLimit, spaRestoreBlock, spaRoomChargeBlock, spaTotal } from './rules.js';

/** KDV %20 dahil (Türkiye'de spa): fiyat misafirin ödediği. */
const INCLUDED = [{ id: 'kdv', name: 'KDV', rate: '20', isIncluded: true, appliesTo: ['SPA', 'OTHER'] }];
/** Vergisi fiyatın üstüne eklenen otel. */
const EXCLUDED = [{ id: 'vat', name: 'VAT', rate: '10', isIncluded: false, appliesTo: ['SPA'] }];
const NONE = { postedNet: '0.00', pendingPayments: '0.00', pendingRefunds: '0.00' };
const settings = { freeCancelHours: 4, lateCancelFeePct: '50.00', noShowFeePct: '100.00' };
const startsAt = new Date('2026-11-16T12:00:00.000Z');
const hoursBefore = (hours) => new Date(startsAt.getTime() - hours * 3_600_000);

describe('toplam', () => {
  it('dahil vergide toplam fiyatın kendisi; hariç vergide vergi eklenir; spa dışı vergi karışmaz', () => {
    assert.equal(spaTotal('2500.00', INCLUDED), '2500.00');
    assert.equal(spaTotal('2500.00', EXCLUDED), '2750.00');
    assert.equal(spaTotal('2500.00', [{ id: 'k', name: 'Konaklama', rate: '2', isIncluded: false, appliesTo: ['ROOM'] }]), '2500.00');
    assert.equal(spaTotal('0', EXCLUDED), '0.00');
  });

  it('liste fiyatı kişi başı × kişi (çift masajı, aileyle ders kaydı)', () => {
    assert.equal(spaListPrice('2500.00', 2), '5000.00');
    assert.equal(spaListPrice('333.33', 3), '999.99');
  });
});

describe('iptal / gelmedi bedeli', () => {
  it('süresinde iptal bedelsiz; geç iptal %50; gelmedi %100', () => {
    assert.deepEqual(spaFee({ price: '2500.00', startsAt, at: hoursBefore(5), outcome: 'CANCELLED', settings }), { pct: '0', amount: '0.00', late: false });
    assert.deepEqual(spaFee({ price: '2500.00', startsAt, at: hoursBefore(1), outcome: 'CANCELLED', settings }), { pct: '50', amount: '1250.00', late: true });
    assert.deepEqual(spaFee({ price: '2500.00', startsAt, at: hoursBefore(-1), outcome: 'NO_SHOW', settings }), { pct: '100', amount: '2500.00', late: true });
  });

  it('bedel elle belirlenen fiyat üzerinden; kuruşa yuvarlanır; silinen bedel sıfırdır', () => {
    assert.equal(spaFee({ price: '1999.99', startsAt, at: hoursBefore(1), outcome: 'CANCELLED', settings }).amount, '1000.00');
    assert.equal(spaFee({ price: '0.00', startsAt, at: hoursBefore(1), outcome: 'NO_SHOW', settings }).amount, '0.00');
    assert.deepEqual(spaFee({ price: '2500.00', startsAt, at: hoursBefore(1), outcome: 'CANCELLED', settings, waived: true }), { pct: '0', amount: '0.00', late: true });
  });
});

describe('ödeme özeti ve bakiye', () => {
  it('işlenen net, bekleyen tahsilat ve bekleyen iade ayrı toplanır', () => {
    const state = spaPaymentState([
      { status: 'POSTED', kind: 'PAYMENT', amount: '3000.00' },
      { status: 'POSTED', kind: 'REFUND', amount: '-500.00' },
      { status: 'POSTED', kind: 'REVERSAL', amount: '-1000.00' },
      { status: 'PENDING', kind: 'PAYMENT', amount: '200.00' },
      { status: 'PENDING', kind: 'REFUND', amount: '-300.00' },
    ]);
    assert.deepEqual(state, { postedNet: '1500.00', pendingPayments: '200.00', pendingRefunds: '-300.00' });
  });

  it('bakiye = ödenecek − kasada alınan − odaya yazılan (fazla ödemede eksi)', () => {
    assert.equal(spaBalance({ totalDue: '2500.00', paidTotal: '1000.00', roomChargeTotal: '0.00' }), '1500.00');
    assert.equal(spaBalance({ totalDue: '2500.00', paidTotal: '0.00', roomChargeTotal: '2500.00' }), '0.00');
    assert.equal(spaBalance({ totalDue: '1250.00', paidTotal: '2500.00', roomChargeTotal: '0.00' }), '-1250.00');
  });
});

describe('tahsilat sınırı', () => {
  const closed = { status: 'COMPLETED', priceTotal: '2500.00', totalDue: '2500.00', roomChargeTotal: '0.00' };

  it('açık randevuda fiyat kadar ön ödeme; onay bekleyen tahsilat sınırdan düşer', () => {
    const open = { status: 'BOOKED', priceTotal: '2750.00', totalDue: '0.00', roomChargeTotal: '0.00' };
    assert.equal(spaPayableLimit({ ...open, state: NONE }), '2750.00');
    assert.equal(spaPayableLimit({ ...open, state: { ...NONE, postedNet: '1000.00', pendingPayments: '750.00' } }), '1000.00');
    assert.equal(spaPaymentIssue({ kind: 'PAYMENT', amount: '2750.00', ...open, state: NONE }), null);
    assert.match(spaPaymentIssue({ kind: 'PAYMENT', amount: '2750.01', ...open, state: NONE }).message, /En fazla 2750\.00/);
  });

  it('kapanmış randevuda kalan bakiye; odaya yazılan borca tahsilat alınmaz', () => {
    assert.equal(spaPayableLimit({ ...closed, state: { ...NONE, postedNet: '1000.00' } }), '1500.00');
    assert.equal(spaPayableLimit({ ...closed, roomChargeTotal: '2500.00', state: NONE }), '0.00');
    assert.match(spaPaymentIssue({ kind: 'PAYMENT', amount: '1.00', ...closed, roomChargeTotal: '2500.00', state: NONE }).message, /ödenecek bakiyesi yok/);
    assert.match(spaPaymentIssue({ kind: 'PAYMENT', amount: '1.00', ...closed, state: { ...NONE, pendingPayments: '2500.00' } }).message, /onay bekleyen ödemeyle/);
  });

  it('bedelsiz kapanan randevuya ve yedek kayda tahsilat alınmaz', () => {
    assert.ok(spaPaymentIssue({ kind: 'PAYMENT', amount: '100.00', status: 'CANCELLED', priceTotal: '2500.00', totalDue: '0.00', roomChargeTotal: '0.00', state: NONE }));
    assert.match(spaPaymentIssue({ kind: 'PAYMENT', amount: '100.00', status: 'WAITLISTED', priceTotal: '400.00', totalDue: '0.00', roomChargeTotal: '0.00', state: NONE }).message, /Yedek listedeki/);
  });
});

describe('iade sınırı', () => {
  it('açık randevuda alınan ön ödemenin tamamı; bekleyen iade düşülür', () => {
    assert.equal(spaRefundLimit({ status: 'BOOKED', totalDue: '0.00', roomChargeTotal: '0.00', state: { postedNet: '2500.00', pendingRefunds: '-1000.00' } }), '1500.00');
    assert.match(spaPaymentIssue({ kind: 'REFUND', amount: '100.00', status: 'BOOKED', priceTotal: '2500.00', totalDue: '0.00', roomChargeTotal: '0.00', state: NONE }).message, /alınmamış para iade edilemez/);
  });

  it('kapanmışta yalnız borcun üstündeki fazla: iptal bedelini karşılayan para iade edilmez', () => {
    const cancelled = { status: 'CANCELLED', totalDue: '1250.00', roomChargeTotal: '0.00' };
    assert.equal(spaRefundLimit({ ...cancelled, state: { postedNet: '2500.00', pendingRefunds: '0.00' } }), '1250.00');
    assert.equal(spaRefundLimit({ ...cancelled, state: { postedNet: '1000.00', pendingRefunds: '0.00' } }), '0.00');
    assert.match(spaPaymentIssue({ kind: 'REFUND', amount: '1300.00', priceTotal: '2500.00', ...cancelled, state: { ...NONE, postedNet: '2500.00' } }).message, /En fazla 1250\.00/);
    assert.equal(spaPaymentIssue({ kind: 'REFUND', amount: '1250.00', priceTotal: '2500.00', ...cancelled, state: { ...NONE, postedNet: '2500.00' } }), null);
  });

  it('bedeli odaya yazılmış randevuda kasada alınan paranın tamamı fazladır', () => {
    assert.equal(spaRefundLimit({ status: 'NO_SHOW', totalDue: '2500.00', roomChargeTotal: '2500.00', state: { postedNet: '500.00', pendingRefunds: '0.00' } }), '500.00');
  });
});

describe('odaya yazma ve geri alma', () => {
  it('yalnız kapanmış, borçlu, kasada hiç parası olmayan randevu odaya yazılır', () => {
    assert.equal(spaRoomChargeBlock({ status: 'COMPLETED', amountDue: '2500.00', roomChargeTotal: '0.00', state: NONE }), null);
    assert.match(spaRoomChargeBlock({ status: 'BOOKED', amountDue: '0.00', roomChargeTotal: '0.00', state: NONE }), /tamamlanmadan/);
    assert.match(spaRoomChargeBlock({ status: 'CANCELLED', amountDue: '0.00', roomChargeTotal: '0.00', state: NONE }), /borcu yok/);
    assert.match(spaRoomChargeBlock({ status: 'COMPLETED', amountDue: '2500.00', roomChargeTotal: '2500.00', state: NONE }), /zaten yazıldı/);
    assert.match(spaRoomChargeBlock({ status: 'COMPLETED', amountDue: '2500.00', roomChargeTotal: '0.00', state: { ...NONE, postedNet: '500.00' } }), /kasada ödeme alınmış/);
    assert.match(spaRoomChargeBlock({ status: 'COMPLETED', amountDue: '2500.00', roomChargeTotal: '0.00', state: { ...NONE, pendingPayments: '500.00' } }), /kasada ödeme alınmış/);
  });

  it('para hareketi olan kapanış geri alınmaz; ön ödemeli iptal geri alınır (ön ödeme durur)', () => {
    assert.equal(spaRestoreBlock({ status: 'COMPLETED', roomChargeTotal: '0.00', state: NONE }), null);
    assert.match(spaRestoreBlock({ status: 'BOOKED', roomChargeTotal: '0.00', state: NONE }), /Yalnız tamamlanmış/);
    assert.match(spaRestoreBlock({ status: 'COMPLETED', roomChargeTotal: '2500.00', state: NONE }), /odaya yazılmış/);
    assert.match(spaRestoreBlock({ status: 'NO_SHOW', roomChargeTotal: '0.00', state: { ...NONE, postedNet: '2500.00' } }), /ödemesi alınmış/);
    assert.equal(spaRestoreBlock({ status: 'CANCELLED', roomChargeTotal: '0.00', state: { ...NONE, postedNet: '2500.00' } }), null);
  });
});
