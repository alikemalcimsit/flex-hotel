/** Ödeme sağlayıcısı hatası: `retryable` geçici (ağ, zaman aşımı; yeniden denenebilir), değilse kalıcı (istek reddedildi). */
export class GatewayProviderError extends Error {
  /** @param {string} message @param {{ code?: string, retryable?: boolean }} [options] */
  constructor(message, { code = 'GATEWAY_PROVIDER', retryable = false } = {}) {
    super(message);
    this.name = 'GatewayProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}
