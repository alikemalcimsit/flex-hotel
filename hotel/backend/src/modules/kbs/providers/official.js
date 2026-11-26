import { KbsProviderError } from './errors.js';

/**
 * Gerçek KBS (Emniyet Genel Müdürlüğü) ve JKBS (Jandarma) iskeleti (modül 58).
 *
 * **Bağlı değil.** Bu servisler herkese açık değildir: otelin il emniyet müdürlüğünden / jandarmadan aldığı tesis kodu, kullanıcı
 * ve parolası ile yazılım firmasına verilen servis dokümanı (adres, SOAP / XML şeması, hata kodları) gerekir. Doküman gelince
 * yalnız bu dosya yazılır — gönderilecek alanlar `notification.person` içinde hazırdır:
 *
 * - `person`: firstName, lastName, idType, idNumber, nationality, birthDate ("YYYY-AA-GG"), gender, birthPlace, fatherName, motherName
 * - `kind` (CHECK_IN / CHECK_OUT / ROOM_CHANGE), `roomNumber`, `previousRoomNumber`, `occurredAt`, `checkInRef` (girişin referansı)
 * - `context.settings`: facilityCode, username, `password` (açılmış), provider
 *
 * Yapılacaklar: istek gövdesi, kimlik doğrulama (oturum / imza), cevap kodlarının geçici / kalıcı ayrımı (`KbsProviderError`
 * `retryable`), zaman aşımı; ardından sözleşmedeki `KBS_PROVIDER_READY` bu sağlayıcı için `true` yapılır.
 */

/** @param {'EGM' | 'JANDARMA'} name @param {string} label @returns {import('./index.js').KbsProvider} */
function notConnected(name, label) {
  const message = `${label} bağlantısı henüz kurulmadı: tesis yetkisi ve servis dokümanı gerekiyor. Bildirimi KBS ekranından elle yapıp "Elle bildirildi" işaretleyin.`;
  return Object.freeze({
    name,
    label,
    async testConnection() {
      return { ok: false, message };
    },
    async send() {
      throw new KbsProviderError(message, { code: 'NOT_CONNECTED' });
    },
  });
}

export const egmProvider = notConnected('EGM', 'Emniyet KBS');
export const jandarmaProvider = notConnected('JANDARMA', 'Jandarma JKBS');
