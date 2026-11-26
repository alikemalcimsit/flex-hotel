import { GatewayProviderError } from './errors.js';
import { authorizationHeader, formatPrice, normalizeAmount, randomKey, responseSignature, retrieveSignatureFields } from './iyzico-sign.js';

/**
 * iyzico Checkout Form adaptörü (modül 50) — barındırılan ödeme sayfası; kart bilgisi otele gelmez, 3D Secure iyzico'da.
 * Kaynaklar: docs.iyzico.com (cf-initialize, cf-retrieve, refund-and-cancel, response-signature-validation) ve iyzipay-node.
 *
 * - Başlat: `POST /payment/iyzipos/checkoutform/initialize/auth/ecom` → `paymentPageUrl` (misafir oraya yönlenir).
 * - Sonuç: iyzico `callbackUrl`'e yalnız `token` POST eder; sunucu `POST /payment/iyzipos/checkoutform/auth/ecom/detail` ile
 *   kendisi sorar, cevap imzasını (`signature`) doğrular. Tarayıcıdan gelen hiçbir şeye güvenilmez.
 * - İade: `POST /payment/refund` (kalem işlem kimliğiyle; sepette tek kalem var). Aynı gün tam tutar için iptal de mümkün ama iade
 *   her durumda çalıştığı için tek yol iade.
 */

export const IYZICO_BASE_URLS = Object.freeze({ SANDBOX: 'https://sandbox-api.iyzipay.com', LIVE: 'https://api.iyzipay.com' });
const TIMEOUT_MS = 20_000;
/** "Ödeme bulunamadı": misafir formu açıp ödemeden ayrıldı. */
const NO_PAYMENT_FOR_TOKEN = '5122';
/** iyzico'nun kabul ettiği taksit sayıları. */
const IYZICO_INSTALLMENTS = Object.freeze([1, 2, 3, 6, 9, 12]);

/** @param {any} context @param {string} path @param {object} payload @param {typeof fetch} fetchImpl */
async function call(context, path, payload, fetchImpl) {
  const { apiKey, secretKey } = context.credentials ?? {};
  if (!apiKey || !secretKey) throw new GatewayProviderError('iyzico API anahtarı / gizli anahtarı tanımlı değil', { code: 'IYZICO_CREDENTIALS' });
  const body = JSON.stringify(payload);
  const rnd = randomKey();
  let response;
  try {
    response = await fetchImpl(`${IYZICO_BASE_URLS[context.environment] ?? IYZICO_BASE_URLS.SANDBOX}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-iyzi-rnd': rnd, authorization: authorizationHeader({ apiKey, secretKey, path, body, randomKey: rnd }) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new GatewayProviderError(`iyzico'ya ulaşılamadı: ${/** @type {Error} */ (error).message}`, { code: 'IYZICO_NETWORK', retryable: true });
  }
  if (response.status >= 500) throw new GatewayProviderError(`iyzico geçici hata verdi (HTTP ${response.status})`, { code: 'IYZICO_HTTP', retryable: true });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new GatewayProviderError(`iyzico cevabı okunamadı (HTTP ${response.status})`, { code: 'IYZICO_RESPONSE', retryable: true });
  }
  return data;
}

/** @param {any} data */
const failure = (data) => new GatewayProviderError(`iyzico: ${data.errorMessage ?? 'istek reddedildi'}${data.errorCode ? ` (${data.errorCode})` : ''}`, { code: `IYZICO_${data.errorCode ?? 'FAILURE'}` });

/** "+90 532 111 22 33" → "+905321112233"; yoksa null. @param {string | null} phone */
const gsm = (phone) => {
  const digits = String(phone ?? '').replace(/[^\d+]/g, '');
  if (digits.length < 10) return null;
  if (digits.startsWith('+')) return digits;
  // Yurt içi biçim: "0532…" → "+90532…", "532…" → "+90532…".
  if (digits.startsWith('0')) return `+9${digits}`;
  return digits.length === 10 ? `+90${digits}` : `+${digits}`;
};

/**
 * @param {typeof fetch} [fetchImpl] test için
 * @returns {import('./index.js').GatewayProvider}
 */
export function createIyzicoProvider(fetchImpl = globalThis.fetch) {
  return Object.freeze({
    name: 'IYZICO',
    label: 'iyzico',

    async testConnection(context) {
      // Anahtarı doğrulamanın yan etkisiz yolu: olmayan bir token'ın sonucunu sormak. Kimlik hatası 1000 / 1001 döner.
      const data = await call(context, '/payment/iyzipos/checkoutform/auth/ecom/detail', { locale: 'tr', conversationId: 'baglanti-denemesi', token: 'baglanti-denemesi' }, fetchImpl);
      if (data.status === 'success' || String(data.errorCode) === NO_PAYMENT_FOR_TOKEN || /token/i.test(data.errorMessage ?? '')) return { ok: true, message: `iyzico'ya bağlanıldı (${context.environment === 'LIVE' ? 'canlı' : 'sandbox'}); anahtarlar kabul edildi` };
      return { ok: false, message: `iyzico: ${data.errorMessage ?? 'kimlik doğrulanamadı'}${data.errorCode ? ` (${data.errorCode})` : ''}` };
    },

    async initialize(context, request) {
      const { link, guest, hotel } = request;
      const identityNumber = guest.idType === 'NATIONAL_ID' && guest.nationality === 'TR' && guest.idNumber ? guest.idNumber : '11111111111';
      const address = hotel.address || hotel.name;
      const city = hotel.city || 'Istanbul';
      const contactName = `${guest.firstName} ${guest.lastName}`.trim();
      const price = formatPrice(link.amount);
      const payload = {
        locale: request.locale === 'en' ? 'en' : 'tr',
        conversationId: request.conversationId,
        price,
        paidPrice: price,
        currency: link.currency,
        basketId: link.id,
        paymentGroup: 'PRODUCT',
        callbackUrl: request.callbackUrl,
        ...(request.maxInstallment > 1 ? { enabledInstallments: IYZICO_INSTALLMENTS.filter((count) => count <= request.maxInstallment) } : {}),
        buyer: {
          id: guest.id,
          name: guest.firstName || 'Misafir',
          surname: guest.lastName || 'Misafir',
          identityNumber,
          email: guest.email || request.fallbackEmail,
          gsmNumber: gsm(guest.phone) ?? '+905000000000',
          registrationAddress: address,
          city,
          country: hotel.country || 'Turkey',
          ...(request.ip ? { ip: request.ip } : {}),
        },
        billingAddress: { contactName, city, country: hotel.country || 'Turkey', address },
        basketItems: [{ id: link.id, name: (link.description || 'Konaklama ödemesi').slice(0, 100), category1: 'Konaklama', itemType: 'VIRTUAL', price }],
      };
      const data = await call(context, '/payment/iyzipos/checkoutform/initialize/auth/ecom', payload, fetchImpl);
      if (data.status !== 'success' || !data.token || !data.paymentPageUrl) throw failure(data);
      if (data.signature && data.signature !== responseSignature(context.credentials.secretKey, [data.conversationId, data.token])) {
        throw new GatewayProviderError('iyzico cevabının imzası tutmadı; ödeme başlatılmadı', { code: 'IYZICO_SIGNATURE' });
      }
      return { token: data.token, redirectUrl: data.paymentPageUrl, expiresInSeconds: Number(data.tokenExpireTime) || null };
    },

    async retrieve(context, { token, conversationId }) {
      const data = await call(context, '/payment/iyzipos/checkoutform/auth/ecom/detail', { locale: 'tr', conversationId, token }, fetchImpl);
      if (data.status !== 'success') {
        if (String(data.errorCode) === NO_PAYMENT_FOR_TOKEN) return { state: 'ABANDONED', code: data.errorCode, message: data.errorMessage ?? 'Ödeme yapılmadı' };
        return { state: 'FAILED', code: data.errorCode ? `IYZICO_${data.errorCode}` : 'IYZICO_FAILURE', message: data.errorMessage ?? 'Ödeme başarısız' };
      }
      const signed = !data.signature || data.signature === responseSignature(context.credentials.secretKey, retrieveSignatureFields(data));
      const common = {
        paymentId: data.paymentId ? String(data.paymentId) : null,
        paidPrice: data.paidPrice !== undefined ? normalizeAmount(data.paidPrice) : null,
        // Taksitte vade farkı müşteriye yansırsa paidPrice > price olur; linkle karşılaştırılan price'tır.
        price: data.price !== undefined ? normalizeAmount(data.price) : null,
        currency: data.currency ?? null,
        basketId: data.basketId ?? null,
        conversationId: data.conversationId ?? null,
        items: (data.itemTransactions ?? []).map((item) => ({ itemId: item.itemId, paymentTransactionId: String(item.paymentTransactionId), paidPrice: normalizeAmount(item.paidPrice) })),
        cardBrand: data.cardAssociation ?? null,
        last4: data.lastFourDigits ?? null,
        installment: data.installment ? Number(data.installment) : null,
        signatureValid: signed,
      };
      if (data.paymentStatus !== 'SUCCESS') return { ...common, state: 'FAILED', code: data.errorCode ? `IYZICO_${data.errorCode}` : `IYZICO_${data.paymentStatus ?? 'FAILURE'}`, message: data.errorMessage ?? 'Ödeme onaylanmadı' };
      if (Number(data.fraudStatus) === -1) return { ...common, state: 'FAILED', code: 'IYZICO_FRAUD', message: 'iyzico ödemeyi dolandırıcılık denetiminde reddetti' };
      if (Number(data.fraudStatus) === 0) return { ...common, state: 'PENDING', code: 'IYZICO_FRAUD_REVIEW', message: 'iyzico ödemeyi incelemede tutuyor' };
      return { ...common, state: 'PAID', code: 'IYZICO_SUCCESS', message: 'Ödeme onaylandı' };
    },

    async refund(context, { items, amount, currency, conversationId, ip }) {
      const item = items[0];
      if (!item?.paymentTransactionId) throw new GatewayProviderError('Ödemenin iyzico işlem kimliği yok; iadeyi iyzico panelinden yapın', { code: 'IYZICO_NO_TRANSACTION' });
      const data = await call(context, '/payment/refund', { locale: 'tr', conversationId, paymentTransactionId: item.paymentTransactionId, price: formatPrice(amount), currency, ip: ip || '127.0.0.1' }, fetchImpl);
      if (data.status !== 'success') throw failure(data);
      return { ref: String(data.paymentTransactionId ?? data.paymentId ?? ''), message: `iyzico iade etti (${normalizeAmount(data.price ?? amount)} ${data.currency ?? currency})` };
    },
  });
}

export const iyzicoProvider = createIyzicoProvider();
