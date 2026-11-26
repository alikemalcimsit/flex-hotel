import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardText, gatewayMode, linkRefundable, linkWarning, linkStatusTone, originLabel, pendingRefundTotal, refundStatusTone } from './paymentGatewayFormat.js';

describe('Sanal POS yazımı', () => {
  it('link ve iade durum rozet tonu', () => {
    assert.equal(linkStatusTone('PAID'), 'success');
    assert.equal(linkStatusTone('OPEN'), 'info');
    assert.equal(linkStatusTone('FAILED'), 'danger');
    assert.equal(linkStatusTone('XYZ'), 'neutral');
    assert.equal(refundStatusTone('PENDING_APPROVAL'), 'warning');
    assert.equal(refundStatusTone('DONE'), 'success');
    assert.equal(refundStatusTone(null), 'neutral');
  });

  it('kart metni marka ve son dört hane', () => {
    assert.equal(cardText({ cardBrand: 'MASTER_CARD', cardLast4: '0008' }), 'MASTER_CARD •••• 0008');
    assert.equal(cardText({ cardBrand: null, cardLast4: '0008' }), '•••• 0008');
    assert.equal(cardText({ cardBrand: 'VISA', cardLast4: null }), '—');
    assert.equal(cardText(null), '—');
  });

  it('kaynak etiketi', () => {
    assert.equal(originLabel('STAFF'), 'Personel');
    assert.equal(originLabel('PORTAL'), 'Misafir portalı');
    assert.equal(originLabel('OTHER'), 'OTHER');
    assert.equal(originLabel(null), '—');
  });

  it('iade edilebilir: ödenen − iade edilen − onayda bekleyen', () => {
    const refunds = [
      { amount: '100.00', status: 'PENDING_APPROVAL' },
      { amount: '50.00', status: 'DONE' },
      { amount: '20.00', status: 'REJECTED' },
      { amount: '10.50', status: 'PROCESSING' },
    ];
    assert.equal(pendingRefundTotal(refunds), '110.50');
    assert.equal(linkRefundable({ status: 'PAID', paidAmount: '500.00', refundedAmount: '50.00' }, refunds), '339.50');
    assert.equal(linkRefundable({ status: 'PAID', paidAmount: '100.00', refundedAmount: '0.00' }, refunds), '0.00');
    assert.equal(linkRefundable({ status: 'OPEN', paidAmount: null, refundedAmount: '0.00' }, []), '0.00');
  });

  it('çalışma kipi şeridi', () => {
    assert.equal(gatewayMode({ isEnabled: false, provider: 'IYZICO', environment: 'LIVE' }).kind, 'off');
    assert.equal(gatewayMode({ isEnabled: true, provider: 'TEST', environment: 'SANDBOX' }).title, 'Test ortamı — gerçek para çekilmez');
    assert.equal(gatewayMode({ isEnabled: true, provider: 'IYZICO', environment: 'SANDBOX' }).kind, 'sandbox');
    assert.equal(gatewayMode({ isEnabled: true, provider: 'IYZICO', environment: 'LIVE' }).title, 'iyzico canlı');
  });

  it('dikkat uyarısı: folyoya yazılamadı, doğrulanamadı, son deneme', () => {
    assert.equal(linkWarning({ status: 'PAID', paymentId: null, failureCode: 'NOT_POSTED', failureMessage: 'Folyo kapalı' }).title, 'Folyoya yazılmayı bekliyor');
    assert.equal(linkWarning({ status: 'PAID', paymentId: 'p1', failureCode: null }), null);
    assert.equal(linkWarning({ status: 'PROCESSING', failureCode: 'UNVERIFIED' }).tone, 'danger');
    assert.equal(linkWarning({ status: 'OPEN', failureCode: 'DECLINED', failureMessage: 'Kart reddedildi' }).title, 'Son deneme başarısız');
    assert.equal(linkWarning({ status: 'OPEN', failureMessage: null }), null);
  });
});
