import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { approvalSelfDecisionError } from './approvals.js';
import { folioActionError } from './folios.js';
import {
  PAYMENT_REFERENCE_REQUIRED_METHODS,
  REFUND_METHODS,
  exchangeRatesInputSchema,
  paymentCurrencyError,
  paymentQuoteSchema,
  paymentVoidError,
  paymentVoidSchema,
  receivePaymentSchema,
  refundRequestSchema,
  stayPaymentSchema,
} from './payments.js';

const ID = '6f1c1f1e-2b8a-4c1e-9a8e-1a2b3c4d5e6f';

const payment = (overrides = {}) => ({ requestId: ID, method: 'CASH', amount: '2500,00', ...overrides });

describe('receivePaymentSchema', () => {
  it('virgüllü tutarı normalleştirir; para birimi büyük harfe, boş referans null', () => {
    const parsed = receivePaymentSchema.parse(payment({ currency: 'eur', reference: '  ' }));
    assert.equal(parsed.amount, '2500');
    assert.equal(parsed.currency, 'EUR');
    assert.equal(parsed.reference, null);
  });

  it('sıfır, eksi, üç ondalık, binlik ayırıcı ve yazım hatası büyüklüğü reddedilir', () => {
    for (const amount of ['0', '-5', '1.234', '1.250,00', 'abc', '', '50000001']) {
      assert.equal(receivePaymentSchema.safeParse(payment({ amount })).success, false, amount);
    }
  });

  it('nakit dışı yöntemlerde referans (slip / dekont / voucher) zorunlu', () => {
    assert.ok(!PAYMENT_REFERENCE_REQUIRED_METHODS.includes('CASH'));
    for (const method of PAYMENT_REFERENCE_REQUIRED_METHODS) {
      const missing = receivePaymentSchema.safeParse(payment({ method }));
      assert.equal(missing.success, false, method);
      assert.deepEqual(missing.error.issues[0].path, ['reference']);
      assert.equal(receivePaymentSchema.safeParse(payment({ method, reference: 'SLIP-0042' })).success, true, method);
    }
  });

  it('kart numarası referansa ve nota yazılamaz (PCI DSS)', () => {
    const card = '4111 1111 1111 1111';
    assert.equal(receivePaymentSchema.safeParse(payment({ method: 'CARD', reference: card })).success, false);
    assert.equal(receivePaymentSchema.safeParse(payment({ note: `kart ${card}` })).success, false);
  });

  it('istek kimliği zorunlu (çift gönderim koruması)', () => {
    assert.equal(receivePaymentSchema.safeParse(payment({ requestId: undefined })).success, false);
  });

  it('konaklamaya ödemede folyo isteğe bağlı', () => {
    assert.equal(stayPaymentSchema.safeParse(payment()).success, true);
    assert.equal(stayPaymentSchema.safeParse(payment({ folioId: 'x' })).success, false);
  });
});

describe('iade ve iptal', () => {
  it('iade gerekçe ister; voucher iade edilmez', () => {
    assert.ok(!REFUND_METHODS.includes('VOUCHER'));
    assert.equal(refundRequestSchema.safeParse(payment()).success, false, 'gerekçe yok');
    assert.equal(refundRequestSchema.safeParse(payment({ reason: 'Teminat iadesi' })).success, true);
    assert.equal(refundRequestSchema.safeParse(payment({ method: 'VOUCHER', reference: 'V1', reason: 'Teminat iadesi' })).success, false);
  });

  it('iptal gerekçesi en az 3 karakter', () => {
    assert.equal(paymentVoidSchema.safeParse({ reason: 'ab' }).success, false);
    assert.equal(paymentVoidSchema.safeParse({ reason: 'Çift giriş' }).success, true);
  });

  it('yalnızca işlenmiş, iptal edilmemiş tahsilat / iade iptal edilir', () => {
    const posted = { kind: 'PAYMENT', status: 'POSTED' };
    assert.equal(paymentVoidError(posted), null);
    assert.equal(paymentVoidError({ ...posted, kind: 'REFUND' }), null);
    assert.match(paymentVoidError({ ...posted, kind: 'REVERSAL' }), /İptal kaydı/);
    assert.match(paymentVoidError({ ...posted, status: 'PENDING' }), /onay kuyruğunda reddedin/);
    assert.match(paymentVoidError({ ...posted, status: 'DECLINED' }), /işlenmedi/);
    assert.match(paymentVoidError({ ...posted, voidedAt: new Date() }), /zaten iptal/);
    assert.match(paymentVoidError({ ...posted, voidPending: true }), /zaten bekliyor/);
  });

  it('dört göz: büyük ödeme, iade ve ödeme iptalini isteyen onaylayamaz (reddedebilir)', () => {
    for (const type of ['LARGE_PAYMENT', 'REFUND', 'PAYMENT_VOID']) {
      const approval = { type, requestedBy: 'resepsiyon@otel.com' };
      assert.match(approvalSelfDecisionError(approval, 'RESEPSIYON@otel.com'), /Kendi isteğinizi/, type);
      assert.equal(approvalSelfDecisionError(approval, 'resepsiyon@otel.com', 'DENIED'), null, type);
      assert.equal(approvalSelfDecisionError(approval, 'mudur@otel.com'), null, type);
    }
  });
});

describe('döviz', () => {
  it('döviz yalnızca nakit ve havaleyle; kart folyonun parasıyla', () => {
    assert.equal(paymentCurrencyError('CASH', 'EUR', 'TRY'), null);
    assert.equal(paymentCurrencyError('TRANSFER', 'USD', 'TRY'), null);
    assert.match(paymentCurrencyError('CARD', 'EUR', 'TRY'), /yalnızca nakit ya da havaleyle/);
    assert.equal(paymentCurrencyError('CARD', 'TRY', 'TRY'), null);
    assert.equal(paymentCurrencyError('CARD', null, 'TRY'), null);
  });

  it('kur girişi: 6 ondalık, pozitif, aynı döviz iki kez yok', () => {
    const parsed = exchangeRatesInputSchema.parse({ rates: [{ currency: 'eur', rate: '38,512345' }] });
    assert.deepEqual(parsed.rates, [{ currency: 'EUR', rate: '38.512345' }]);
    for (const rate of ['0', '-1', '38.1234567', 'abc', '2000000']) {
      assert.equal(exchangeRatesInputSchema.safeParse({ rates: [{ currency: 'EUR', rate }] }).success, false, rate);
    }
    assert.equal(
      exchangeRatesInputSchema.safeParse({ rates: [{ currency: 'EUR', rate: '38' }, { currency: 'eur', rate: '39' }] }).success,
      false,
    );
    assert.equal(exchangeRatesInputSchema.safeParse({ rates: [{ currency: 'EURO', rate: '38' }] }).success, false);
  });

  it('önizleme varsayılanı tahsilat', () => {
    assert.equal(paymentQuoteSchema.parse({ amount: '100' }).kind, 'PAYMENT');
  });
});

describe('folyo kapatma', () => {
  it('onay bekleyen ödeme / iade varken folyo kapanmaz', () => {
    const open = { status: 'OPEN' };
    assert.match(folioActionError(open, 'close', { balanceZero: true, pendingPayments: 1 }), /onay bekleyen ödeme ya da iade/);
    assert.equal(folioActionError(open, 'close', { balanceZero: true, pendingPayments: 0 }), null);
  });
});
