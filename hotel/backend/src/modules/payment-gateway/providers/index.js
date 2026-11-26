import { iyzicoProvider } from './iyzico.js';
import { testGatewayProvider } from './test.js';

export { GatewayProviderError } from './errors.js';

/**
 * Ödeme sağlayıcıları (modül 50). Link / geri dönüş / iade akışı yalnız bu arayüzü bilir. 84 (provizyon, kart token'ı, ters
 * ibraz) aynı arayüze yeni işler olarak eklenir.
 *
 * @typedef {{ hotelId: string, settings: any, environment: 'SANDBOX' | 'LIVE', credentials: { apiKey: string, secretKey: string } | null }} GatewayContext
 * @typedef {{ state: 'PAID' | 'FAILED' | 'PENDING' | 'ABANDONED', code: string | null, message: string | null, paymentId?: string | null,
 *   paidPrice?: string | null, currency?: string | null, basketId?: string | null, conversationId?: string | null,
 *   items?: Array<{ itemId: string, paymentTransactionId: string, paidPrice: string }>, cardBrand?: string | null, last4?: string | null,
 *   installment?: number | null, signatureValid?: boolean }} GatewayResult
 * @typedef {{
 *   name: string,
 *   label: string,
 *   testConnection: (context: GatewayContext) => Promise<{ ok: boolean, message: string }>,
 *   initialize: (context: GatewayContext, request: any) => Promise<{ token: string, redirectUrl: string, expiresInSeconds: number | null }>,
 *   retrieve: (context: GatewayContext, request: { token: string, conversationId: string, expected: { amount: string, currency: string, basketId: string }, callbackFields?: Record<string, string> }) => Promise<GatewayResult>,
 *   refund: (context: GatewayContext, request: { items: Array<{ paymentTransactionId: string }>, amount: string, currency: string, conversationId: string, ip?: string | null }) => Promise<{ ref: string, message: string }>,
 * }} GatewayProvider
 */

/** @type {Record<string, GatewayProvider>} */
const PROVIDERS = Object.freeze({ TEST: testGatewayProvider, IYZICO: iyzicoProvider });

/** @param {string} name @returns {GatewayProvider | null} */
export function gatewayProviderFor(name) {
  return PROVIDERS[name] ?? null;
}
