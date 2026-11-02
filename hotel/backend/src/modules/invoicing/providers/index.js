import { testProvider } from './test.js';

export { EdocProviderError } from './errors.js';

/**
 * e-belge entegratörleri (modül 49). Her entegratör aynı arayüzü uygular; fatura servisi ve gönderici yalnız
 * bu arayüzü bilir. Gerçek entegratör (Uyumsoft, İzibiz, QNB eFinans…) eklemek: bu klasöre adaptör + burada
 * kayıt + sözleşmedeki `EDOC_PROVIDERS` listesi; ayar ekranında seçilir, canlı ortam onunla açılır.
 *
 * @typedef {{ client: any, hotelId: string, settings: any }} EdocContext
 * @typedef {{
 *   name: string,
 *   label: string,
 *   checkTaxpayer: (context: EdocContext, taxNumber: string) => Promise<{ registered: boolean, title: string | null, aliases: string[] }>,
 *   send: (context: EdocContext, document: { documentType: 'E_FATURA' | 'E_ARSIV', number: string, uuid: string, xml: string, receiverTaxNumber: string | null, receiverAlias: string | null, buyerEmail: string | null }) => Promise<{ ref: string, code: string | null, message: string | null }>,
 *   status: (context: EdocContext, document: { documentType: 'E_FATURA' | 'E_ARSIV', uuid: string, ref: string | null, checks: number, receiverTaxNumber: string | null }) => Promise<{ state: 'PROCESSING' | 'DELIVERED' | 'REJECTED', code: string | null, message: string | null }>,
 *   cancel: (context: EdocContext, document: { documentType: 'E_FATURA' | 'E_ARSIV', uuid: string, ref: string | null, reason: string }) => Promise<{ code: string | null, message: string | null }>,
 * }} EdocProvider
 *
 * Hata: `EdocProviderError` — `retryable` geçici (ağ, hız sınırı; gönderici artan aralıkla yeniden dener),
 * değilse kalıcı (belge reddedildi; personel düzeltir).
 */

/** @type {Record<string, EdocProvider>} */
const PROVIDERS = Object.freeze({ TEST: testProvider });

/** @param {string} name @returns {EdocProvider | null} */
export function providerFor(name) {
  return PROVIDERS[name] ?? null;
}
