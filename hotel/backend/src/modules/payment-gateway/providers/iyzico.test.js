import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIyzicoProvider } from './iyzico.js';
import { authorizationHeader, formatPrice, normalizeAmount, responseSignature, retrieveSignatureFields } from './iyzico-sign.js';

/** iyzico imzaları resmî test vektörleriyle; adaptörün istek gövdesi ve cevap eşlemesi sahte `fetch` ile. */

describe('iyzico imzaları (resmî vektörler)', () => {
  it('IYZWSv2 istek başlığı — iyzipay-node test/unit/UtilsTest.js', () => {
    const header = authorizationHeader({ apiKey: 'api_key', secretKey: 'secret_key', path: 'uri', body: JSON.stringify('body'), randomKey: 'random_string' });
    assert.equal(header, 'IYZWSv2 YXBpS2V5OmFwaV9rZXkmcmFuZG9tS2V5OnJhbmRvbV9zdHJpbmcmc2lnbmF0dXJlOjAxNzUwODkyMWEyOWVlNTYwMWJjZDFmYmU4M2VmZDJlMmJlNDNhZjAyZWNlZmYzMGNmMmU5MWE1MzlhYWIzNTU=');
  });

  it('cevap imzası — docs.iyzico.com response-signature-validation örneği', () => {
    const signature = responseSignature('sandbox-qaIiLIxhjMgx3LSKIVvp6j17NunHOFtD', ['22416032', 'TRY', 'basketId', 'conversationId', normalizeAmount('10.50'), normalizeAmount('10.5')]);
    assert.equal(signature, '836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173');
  });

  it('tutar biçimleri', () => {
    assert.deepEqual([normalizeAmount('10.50'), normalizeAmount(5.2), normalizeAmount('10.0'), normalizeAmount('2480')], ['10.5', '5.2', '10', '2480']);
    assert.deepEqual([formatPrice('2480.00'), formatPrice('15.340000'), formatPrice('22')], ['2480.0', '15.34', '22.0']);
  });
});

describe('iyzico adaptörü (sahte fetch)', () => {
  const credentials = { apiKey: 'sandbox-key', secretKey: 'sandbox-secret' };
  const context = { hotelId: 'h', settings: {}, environment: 'SANDBOX', credentials };
  const link = { id: '7c1f3a52-9d0e-4f6b-8a21-3e5d7c9b1a40', amount: '2480.00', currency: 'TRY', description: 'Ön ödeme' };
  const guest = { id: 'g1', firstName: 'Anna', lastName: 'Schmidt', email: null, phone: '+49 151 2345678', idType: 'PASSPORT', idNumber: 'C01X00T47', nationality: 'DE' };
  const hotel = { name: 'Deniz Otel', address: null, city: 'Antalya', country: 'Turkey' };

  it('başlatma: imzalı istek, sanal kalem, yabancı misafirde yer tutucu TCKN, cevap imzası', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      const token = 'tok-1';
      return { status: 200, json: async () => ({ status: 'success', conversationId: 'conv-1', token, paymentPageUrl: 'https://sandbox-cpp.iyzipay.com?token=tok-1', tokenExpireTime: 1800, signature: responseSignature(credentials.secretKey, ['conv-1', token]) }) };
    };
    const provider = createIyzicoProvider(fetchImpl);
    const result = await provider.initialize(context, { link, guest, hotel, conversationId: 'conv-1', callbackUrl: 'https://otel.example.com/api/public/pay/kod/callback', maxInstallment: 3, fallbackEmail: 'odeme@otel.example.com', locale: 'tr', ip: '85.34.78.112' });
    assert.deepEqual(result, { token: 'tok-1', redirectUrl: 'https://sandbox-cpp.iyzipay.com?token=tok-1', expiresInSeconds: 1800 });
    const [{ url, options }] = calls;
    assert.equal(url, 'https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform/initialize/auth/ecom');
    const body = JSON.parse(options.body);
    assert.deepEqual([body.price, body.paidPrice, body.basketId, body.basketItems[0].itemType, body.basketItems[0].price], ['2480.0', '2480.0', link.id, 'VIRTUAL', '2480.0']);
    assert.deepEqual(body.enabledInstallments, [1, 2, 3], 'iyzico taksitleri: 1, 2, 3, 6, 9, 12 içinden en çok 3');
    assert.deepEqual([body.buyer.identityNumber, body.buyer.email, body.buyer.gsmNumber, body.buyer.city], ['11111111111', 'odeme@otel.example.com', '+491512345678', 'Antalya']);
    assert.equal(options.headers.authorization, authorizationHeader({ ...credentials, path: '/payment/iyzipos/checkoutform/initialize/auth/ecom', body: options.body, randomKey: options.headers['x-iyzi-rnd'] }));
    assert.equal(body.shippingAddress, undefined, 'sanal kalemde teslimat adresi yok');
  });

  it('sonuç: başarılı + imza; yarıda bırakılan (5122); dolandırıcılık incelemesi; imza tutmazsa işaret', async () => {
    const success = { status: 'success', paymentStatus: 'SUCCESS', fraudStatus: 1, paymentId: '22416032', currency: 'TRY', basketId: link.id, conversationId: 'conv-1', paidPrice: 2480.0, price: 2480.0, token: 'tok-1', installment: 1, cardAssociation: 'MASTER_CARD', lastFourDigits: '0008', itemTransactions: [{ itemId: link.id, paymentTransactionId: 11223344, paidPrice: 2480.0 }] };
    const respond = (data) => async () => ({ status: 200, json: async () => data });
    const signed = { ...success, signature: responseSignature(credentials.secretKey, retrieveSignatureFields(success)) };
    let result = await createIyzicoProvider(respond(signed)).retrieve(context, { token: 'tok-1', conversationId: 'conv-1', expected: link });
    assert.deepEqual([result.state, result.paidPrice, result.paymentId, result.items[0].paymentTransactionId, result.cardBrand, result.last4, result.signatureValid], ['PAID', '2480', '22416032', '11223344', 'MASTER_CARD', '0008', true]);
    result = await createIyzicoProvider(respond({ status: 'failure', errorCode: '5122', errorMessage: 'Ödeme bulunamadı' })).retrieve(context, { token: 'tok-1', conversationId: 'conv-1', expected: link });
    assert.equal(result.state, 'ABANDONED');
    result = await createIyzicoProvider(respond({ ...signed, fraudStatus: 0 })).retrieve(context, { token: 'tok-1', conversationId: 'conv-1', expected: link });
    assert.equal(result.state, 'PENDING');
    result = await createIyzicoProvider(respond({ ...signed, paidPrice: 1 })).retrieve(context, { token: 'tok-1', conversationId: 'conv-1', expected: link });
    assert.equal(result.signatureValid, false);
  });

  it('ağ hatası geçici, anahtar yoksa kalıcı', async () => {
    const down = createIyzicoProvider(async () => {
      throw new Error('ECONNRESET');
    });
    await assert.rejects(down.retrieve(context, { token: 't', conversationId: 'c', expected: link }), (error) => error.retryable === true && error.code === 'IYZICO_NETWORK');
    await assert.rejects(down.retrieve({ ...context, credentials: null }, { token: 't', conversationId: 'c', expected: link }), (error) => error.retryable === false && error.code === 'IYZICO_CREDENTIALS');
  });
});
