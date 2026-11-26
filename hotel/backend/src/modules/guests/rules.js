/**
 * CRM'in saf hesapları (modül 22). Veritabanı yok: birim testlenir.
 */

/**
 * guestId taşıyan ve `mergeGuests`'in basitçe (çakışmasız) taşıyacağı tablolar. `ReservationGuest` ayrı ele alınır
 * (aynı rezervasyonda iki satır çakışır). Yeni bir tablo `guestId` alırsa buraya eklenmeli — birim testi şemadan
 * denetler; eksik kalırsa birleştirmeden sonra o kayıtlar silinen karta bağlı kalır (misafir geçmişinden kaybolur).
 */
export const GUEST_REASSIGN_MODELS = Object.freeze([
  'reservation', 'conversation', 'guestRequest', 'folio', 'lostItem', 'invoice', 'waitlistEntry', 'notification',
  'guestPreference', 'guestNote', 'lead', 'surveyInvitation', 'surveyResponse', 'spaAppointment',
]);
/** `mergeGuests`'in ayrıca (çakışma temizliğiyle) taşıdığı tablolar; sadakat hesabı birleştirilir (modül 56). */
export const GUEST_MERGE_SPECIAL_MODELS = Object.freeze(['reservationGuest', 'loyaltyAccount']);

/**
 * İki etiket listesini birleştirir: sıra korunur, tekrarlar (büyük/küçük harf
 * duyarsız) atılır. Hedefin etiketleri önce gelir.
 *
 * @param {string[]} targetTags @param {string[]} sourceTags
 * @returns {string[]}
 */
export function mergeTags(targetTags = [], sourceTags = []) {
  const seen = new Set();
  const result = [];
  for (const tag of [...targetTags, ...sourceTags]) {
    // Düz toLowerCase: "VIP" gibi kısaltmalarda Türkçe I→ı ("vıp") eşleşmeyi bozardı.
    const key = tag.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(tag.trim());
  }
  return result;
}
