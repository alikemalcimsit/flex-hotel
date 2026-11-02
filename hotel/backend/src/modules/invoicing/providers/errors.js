/** Entegratör hatası: `retryable` geçici (yeniden denenir), değilse kalıcı (belge reddedildi). */
export class EdocProviderError extends Error {
  /** @param {string} message @param {{ code?: string, retryable?: boolean }} [options] */
  constructor(message, { code = 'EDOC_PROVIDER', retryable = false } = {}) {
    super(message);
    this.name = 'EdocProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}
