import { randomBytes } from 'node:crypto';
import { GatewayProviderError } from './errors.js';

/**
 * Test ortamı (modül 50): dışarı hiçbir şey göndermez. Misafir sunucunun kendi taklit ödeme sayfasına yönlenir
 * (`/public/pay/:code/test-checkout`), oradaki "Öde" düğmesi geri dönüşe gider. Sonuç ayardaki test davranışına göre:
 * Onaylar → ödendi (kart "TEST •••• 0008"), Reddeder → "Kart reddedildi". Sayfadan ödemeden ayrılan misafirin denemesi
 * "yarıda bırakıldı" sayılır, link yeniden ödenebilir. Kodlar `T-` önekli.
 */
export const testGatewayProvider = Object.freeze({
  name: 'TEST',
  label: 'Test ortamı',

  async testConnection() {
    return { ok: true, message: 'Test ortamı hazır (dışarı bir şey gönderilmez)' };
  },

  async initialize(_context, request) {
    const token = `test_${randomBytes(12).toString('hex')}`;
    return { token, redirectUrl: `${request.testCheckoutUrl}?token=${token}`, expiresInSeconds: 1800 };
  },

  async retrieve(context, { token, conversationId, expected, callbackFields }) {
    if (!token?.startsWith('test_')) return { state: 'FAILED', code: 'T-TOKEN', message: 'Geçersiz deneme (test ortamı)' };
    if (callbackFields?.testOutcome !== 'pay') return { state: 'ABANDONED', code: 'T-ABANDONED', message: 'Ödeme sayfasından ödemeden çıkıldı (test ortamı)' };
    const common = { paymentId: `TEST-${token.slice(5, 17).toUpperCase()}`, paidPrice: expected.amount, price: expected.amount, currency: expected.currency, basketId: expected.basketId, conversationId, items: [{ itemId: expected.basketId, paymentTransactionId: `TEST-TX-${token.slice(5, 13)}`, paidPrice: expected.amount }], cardBrand: 'TEST', last4: '0008', installment: 1, signatureValid: true };
    if (context.settings.testBehavior === 'DECLINE') return { ...common, state: 'FAILED', code: 'T-DECLINED', message: 'Kart reddedildi (test ortamı)' };
    return { ...common, state: 'PAID', code: 'T-APPROVED', message: 'Ödeme onaylandı (test ortamı)' };
  },

  async refund(_context, { items, amount }) {
    if (!items[0]?.paymentTransactionId) throw new GatewayProviderError('İşlem kimliği yok (test ortamı)', { code: 'T-NO-TRANSACTION' });
    return { ref: `TEST-RF-${randomBytes(4).toString('hex').toUpperCase()}`, message: `İade edildi: ${amount} (test ortamı)` };
  },
});
