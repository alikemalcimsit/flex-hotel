import { randomUUID } from 'node:crypto';
import { KbsProviderError } from './errors.js';

/**
 * Test ortamı: KBS'yi taklit eder, dışarı hiçbir şey göndermez (modül 58; gerçek servis tesis yetkisi ve dokümanla bağlanır).
 * Kuyruğun bütün yolculuğu (sıra, yeniden deneme, hata, elle bildirim) uçtan uca denenebilsin diye:
 *
 * - Tesis kodu ya da kullanıcı yoksa kalıcı hata (`T-AUTH`).
 * - Ayardaki **test davranışı**: Kabul eder → referans numarası; Reddeder → kalıcı hata (`T-REJECTED`); Ulaşılamaz → geçici
 *   hata (`T-UNAVAILABLE`, gönderici yeniden dener).
 * - Çıkış / oda değişikliği girişin referansını ister (gerçek servisler de girişin kaydına bağlanır).
 *
 * Kodlar `T-` önekli: gerçek KBS kodu gibi görünmesin.
 */

/** @param {{ settings: any }} context */
function assertCredentials({ settings }) {
  if (!settings.facilityCode || !settings.username) throw new KbsProviderError('Tesis kodu ya da kullanıcı adı tanımlı değil (test ortamı)', { code: 'T-AUTH' });
}

/** @type {import('./index.js').KbsProvider} */
export const testProvider = Object.freeze({
  name: 'TEST',
  label: 'Test ortamı',

  async testConnection(context) {
    assertCredentials(context);
    if (context.settings.testBehavior === 'UNAVAILABLE') return { ok: false, message: 'Servise ulaşılamadı (test ortamı: ulaşılamaz davranışı seçili)' };
    return { ok: true, message: `Bağlantı başarılı — tesis ${context.settings.facilityCode} (test ortamı; dışarı bir şey gönderilmedi)` };
  },

  async send(context, notification) {
    assertCredentials(context);
    if (notification.kind !== 'CHECK_IN' && !notification.checkInRef) {
      throw new KbsProviderError('Girişin KBS referansı yok; önce giriş bildirilmeli (test ortamı)', { code: 'T-NO-REF' });
    }
    if (context.settings.testBehavior === 'UNAVAILABLE') throw new KbsProviderError('KBS servisine ulaşılamadı (test ortamı: geçici hata)', { code: 'T-UNAVAILABLE', retryable: true });
    if (context.settings.testBehavior === 'REJECT') throw new KbsProviderError('Kimlik bilgisi doğrulanamadı (test ortamı: ret davranışı seçili)', { code: 'T-REJECTED' });
    return { ref: `TKBS-${randomUUID().slice(0, 8).toUpperCase()}`, code: 'T-ACCEPTED', message: 'Bildirim alındı (test ortamı)' };
  },
});
