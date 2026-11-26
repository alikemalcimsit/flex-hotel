/** KBS sağlayıcı hatası: `retryable` geçici (ağ, servis kapalı; yeniden denenir), değilse kalıcı (bildirim reddedildi; personel düzeltir). */
export class KbsProviderError extends Error {
  /** @param {string} message @param {{ code?: string, retryable?: boolean }} [options] */
  constructor(message, { code = 'KBS_PROVIDER', retryable = false } = {}) {
    super(message);
    this.name = 'KbsProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}
