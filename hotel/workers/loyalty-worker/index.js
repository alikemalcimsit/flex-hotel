import { BaseWorker } from '@hotelos/actor-kit';
import { loyaltyWorkerManifest } from './manifest.js';

/** 4xx iş kuralı hatası tekrar denemekle düzelmez: beklemeden manuel göreve. @param {unknown} error */
function markBusinessErrorsFinal(error) {
  const status = /** @type {{ statusCode?: number }} */ (error)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) /** @type {{ retryable?: boolean }} */ (error).retryable = false;
  return error;
}

/** @param {() => Promise<any>} work */
async function run(work) {
  try {
    return await work();
  } catch (error) {
    throw markBusinessErrorsFinal(error);
  }
}

/** Spa randevusunun puanını değiştiren haberler: tamamlandı, geri alındı (RESTORED), ücreti yeniden belirlendi. */
const SPA_CHANGES = Object.freeze(['COMPLETED', 'RESTORED', 'CHARGED', 'PRICED']);

/** @param {{ posted?: boolean, skipped?: string, message?: string | null }} result @param {string} fallback */
const said = (result, fallback) => ({ message: result.message ?? result.skipped ?? fallback, meta: { posted: Boolean(result.posted) } });

/**
 * Sadakat aktörü. Servisi dışarıdan alır (veritabanısız test edilir); kararlar (oran, seviye, sınırlar) serviste.
 */
class LoyaltyWorker extends BaseWorker {
  /**
   * @param {{
   *   syncFolioPoints: (hotelId: string, folioId: string) => Promise<{ posted?: boolean, skipped?: string, message?: string | null }>,
   *   syncSpaPoints: (hotelId: string, appointmentId: string) => Promise<{ posted?: boolean, skipped?: string, message?: string | null }>,
   *   onFolioItemVoided: (hotelId: string, itemId: string) => Promise<{ posted?: boolean, skipped?: string, message?: string | null }>,
   * }} service
   * @param {object} deps
   */
  constructor(service, deps) {
    super(
      loyaltyWorkerManifest,
      {
        /** Folyo kapandı: misafire puan. */
        'folio.closed': async (payload) => said(await run(() => service.syncFolioPoints(payload.hotelId, payload.folioId)), 'Folyo puanı işlendi'),
        /** Folyo yeniden açıldı: kazanılan geri alınır (yeniden kapanınca fark kazanılır). */
        'folio.reopened': async (payload) => said(await run(() => service.syncFolioPoints(payload.hotelId, payload.folioId)), 'Folyo puanı geri alındı'),
        /** Kalem iptal edildi: puan indirimiyse puan iade. */
        'folio.item.voided': async (payload) => said(await run(() => service.onFolioItemVoided(payload.hotelId, payload.itemId)), 'Puan indirimi iade edildi'),
        'spa.appointment.changed': async (payload) => {
          if (!SPA_CHANGES.includes(payload.change)) return { message: 'Sadakat etkisi yok' };
          return said(await run(() => service.syncSpaPoints(payload.hotelId, payload.appointmentId)), 'Spa puanı işlendi');
        },
      },
      deps,
    );
  }

  /** @param {string} eventName @param {any} payload */
  describeFallback(eventName, payload) {
    switch (eventName) {
      case 'folio.closed':
        return 'Kapanan folyonun sadakat puanı yazılacak';
      case 'folio.reopened':
        return 'Yeniden açılan folyonun sadakat puanı geri alınacak';
      case 'folio.item.voided':
        return 'İptal edilen kalem puan indirimiyse puan iade edilecek';
      case 'spa.appointment.changed':
        return 'Spa randevusunun sadakat puanı yazılacak';
      default:
        return super.describeFallback(eventName, payload);
    }
  }
}

export { loyaltyWorkerManifest };

/** @param {ConstructorParameters<typeof LoyaltyWorker>[0]} service @param {ConstructorParameters<typeof LoyaltyWorker>[1]} deps */
export function createLoyaltyWorker(service, deps) {
  return new LoyaltyWorker(service, deps);
}
