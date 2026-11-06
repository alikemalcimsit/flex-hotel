import { EdocProviderError } from './errors.js';

/**
 * Test ortamı: GİB'i ve entegratörü taklit eder, dışarı hiçbir şey göndermez (modül 49; gerçek entegratör
 * henüz belli değil). Faturanın bütün yolculuğu uçtan uca denenebilsin diye:
 *
 * - **Mükellef sorgusu:** ayarlardaki "test mükellefleri" listesindeki vergi no kayıtlı e-Fatura mükellefidir
 *   (posta kutusu etiketiyle); listede olmayan herkes e-Arşiv alıcısıdır.
 * - **Gönderim:** belge numarası ve ETTN belgeyle uyuşmalı; alıcının davranışı "ulaşılamaz" ise geçici hata
 *   (gönderici yeniden dener, hak bitince "gönderilemedi").
 * - **Durum:** ilk sorguda "işleniyor"; sonrakinde e-Fatura alıcının davranışına göre tamamlanır ya da reddedilir
 *   (şema hatası / posta kutusu yok), e-Arşiv raporlanır.
 * - **İptal:** e-Arşiv iptal edilir; e-Fatura entegratörden iptal edilemez (GİB portalı).
 *
 * Kodlar `T-` önekli: gerçek GİB durum kodu gibi görünmesin.
 */

/** @param {any} client @param {string} hotelId @param {string | null} taxNumber */
async function behaviorOf(client, hotelId, taxNumber) {
  if (!taxNumber) return 'ACCEPT';
  const row = await client.testTaxpayer.findFirst({ where: { hotelId, taxNumber }, select: { behavior: true } });
  return row?.behavior ?? 'ACCEPT';
}

/** @type {import('./index.js').EdocProvider} */
export const testProvider = Object.freeze({
  name: 'TEST',
  label: 'Test ortamı (GİB benzetimi)',

  async checkTaxpayer({ client, hotelId }, taxNumber) {
    const row = await client.testTaxpayer.findFirst({ where: { hotelId, taxNumber }, select: { title: true, alias: true } });
    return row ? { registered: true, title: row.title, aliases: [row.alias] } : { registered: false, title: null, aliases: [] };
  },

  async send({ client, hotelId }, document) {
    if (!document.xml.includes(`<cbc:UUID>${document.uuid}</cbc:UUID>`) || !document.xml.includes(`<cbc:ID>${document.number}</cbc:ID>`)) {
      throw new EdocProviderError('Belgedeki numara / ETTN faturayla uyuşmuyor (test ortamı)', { code: 'T-INVALID' });
    }
    if (document.documentType === 'E_FATURA' && !document.receiverAlias) {
      throw new EdocProviderError('Alıcının posta kutusu etiketi yok (test ortamı)', { code: 'T-NO-ALIAS' });
    }
    if ((await behaviorOf(client, hotelId, document.receiverTaxNumber)) === 'UNAVAILABLE') {
      throw new EdocProviderError('Entegratöre ulaşılamadı (test ortamı: geçici hata)', { code: 'T-UNAVAILABLE', retryable: true });
    }
    return { ref: `TEST-${document.uuid}`, code: 'T-ACCEPTED', message: 'Entegratör belgeyi aldı (test ortamı)' };
  },

  async status({ client, hotelId }, document) {
    if (document.checks === 0) return { state: 'PROCESSING', code: 'T-PROCESSING', message: 'GİB işliyor (test ortamı)' };
    if (document.documentType === 'E_ARSIV') return { state: 'DELIVERED', code: 'T-REPORTED', message: "e-Arşiv GİB'e raporlandı (test ortamı)" };
    const behavior = await behaviorOf(client, hotelId, document.receiverTaxNumber);
    if (behavior === 'REJECT') return { state: 'REJECTED', code: 'T-SCHEMA', message: 'GİB reddetti: şema / şematron hatası (test ortamı)' };
    if (behavior === 'NO_MAILBOX') return { state: 'REJECTED', code: 'T-NO-MAILBOX', message: 'Alıcının posta kutusu bulunamadı (test ortamı)' };
    return { state: 'DELIVERED', code: 'T-DELIVERED', message: 'Alıcının posta kutusuna ulaştı (test ortamı)' };
  },

  async cancel(_context, document) {
    if (document.documentType !== 'E_ARSIV') {
      throw new EdocProviderError('e-Fatura entegratörden iptal edilemez: GİB portalında iptal edilir', { code: 'T-NOT-CANCELLABLE' });
    }
    return { code: 'T-CANCELLED', message: 'e-Arşiv iptal edildi (test ortamı)' };
  },
});
