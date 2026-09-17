/**
 * Sağlayıcıdan dönen gönderim hatası.
 *
 * `retryable`: geçici mi (ağ, hız sınırı, sağlayıcı arızası) yoksa kalıcı mı
 * (yanlış parola, tanımsız gönderici, geçersiz adres). Kalıcı hata yeniden
 * denenmez; personel uyarılır.
 */
export class ProviderError extends Error {
  /**
   * @param {string} message kullanıcıya gösterilen Türkçe açıklama
   * @param {{ code: string, retryable: boolean, configIssue?: boolean }} options
   *   `configIssue`: sorun alıcıda değil kanal ayarında (parola, başlık) —
   *   kanal ayarı ekranında "son hata" olarak da gösterilir.
   */
  constructor(message, { code, retryable, configIssue = false }) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
    this.configIssue = configIssue;
  }
}
