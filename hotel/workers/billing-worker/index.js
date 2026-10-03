import { BaseWorker } from '@hotelos/actor-kit';
import { billingWorkerManifest } from './manifest.js';

/**
 * Hata iş kuralından mı geliyor? Servis katmanının tipli hataları HTTP
 * durumu taşır; 4xx olanlar ("odada konaklayan yok", "folyo kapalı") tekrar
 * denemekle düzelmez — beklemeden personelin önüne düşmeli.
 * @param {unknown} error
 */
function markBusinessErrorsFinal(error) {
  const status = /** @type {{ statusCode?: number }} */ (error)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    /** @type {{ retryable?: boolean }} */ (error).retryable = false;
  }
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

/** "2026-09-29" → "29.09.2026" */
const dotted = (day) => day.split('-').reverse().join('.');

/**
 * @param {string | null | undefined} value
 * @param {string} [currency]
 */
const priced = (value, currency = '') => (value ? `${value}${currency ? ` ${currency}` : ''}` : '');

/**
 * Folyo aktörü.
 *
 * Servisi dışarıdan alır: worker paketi ne Prisma ne HTTP bilir, böylece sahte
 * bir servisle veritabanısız test edilebilir. Kararlar (hangi folyo, kaç
 * gece, vergi) serviste; aktör olayı doğru işe çevirir ve sonucu okunur yazar.
 */
class BillingWorker extends BaseWorker {
  /**
   * @param {{
   *   openStayOnCheckIn: (hotelId: string, reservationId: string, input: { earlyCheckInFee: string | null, eventId: string }) => Promise<{ skipped?: string, opened?: boolean, feePosted?: string | null }>,
   *   settleStayOnCheckOut: (hotelId: string, reservationId: string, input: { lateCheckOutFee: string | null, openBalance: string | null, eventId: string }) => Promise<{ skipped?: string, roomItems?: number, feePosted?: string | null, closed?: number, open?: number }>,
   *   reverseCheckInFees: (hotelId: string, reservationId: string, input: { reason: string, occurredAt: Date }) => Promise<{ reversed: number }>,
   *   reopenStayOnCheckOutRevert: (hotelId: string, reservationId: string, input: { reason: string, occurredAt: Date }) => Promise<{ reopened: number, reversed: number }>,
   *   postReservationFee: (hotelId: string, reservationId: string, input: { kind: 'CANCELLATION' | 'NO_SHOW', eventId: string }) => Promise<{ skipped?: string, posted?: string | null }>,
   *   reverseReservationFees: (hotelId: string, reservationId: string, input: { occurredAt: Date }) => Promise<{ reversed: number }>,
   *   runRoomCharges: (hotelId: string, input: { night: string }) => Promise<{ night: string, stays: number, items: number, total: string }>,
   *   postExternalCharge: (hotelId: string, charge: object, options: { source: 'FNB_ORDER' | 'MINIBAR', eventId: string }) => Promise<{ reservationId: string, items: number, total: string }>,
   * }} service
   * @param {object} deps BaseWorker bağımlılıkları
   */
  constructor(service, deps) {
    /** Olayın oluştuğu an (geri almada "bundan önce işlenen ücret"). */
    const occurredAt = (envelope) => new Date(envelope.occurredAt ?? Date.now());

    super(
      billingWorkerManifest,
      {
        /** Misafir girdi: folyo açılır, erken giriş ücreti işlenir. */
        'guest.checked_in': async (payload, envelope) => {
          const result = await run(() =>
            service.openStayOnCheckIn(payload.hotelId, payload.reservationId, {
              earlyCheckInFee: payload.earlyCheckInFee ?? null,
              eventId: envelope.id,
            }),
          );
          if (result.skipped) return { message: result.skipped };
          const parts = [result.opened ? 'Folyo açıldı' : 'Folyo zaten açıktı'];
          if (result.feePosted) parts.push(`erken giriş ücreti işlendi (${result.feePosted})`);
          return { message: parts.join(', '), meta: { feePosted: result.feePosted ?? null } };
        },

        /**
         * Misafir çıktı: kalan geceler ve geç çıkış ücreti işlenir, bakiyesi
         * sıfır olan folyolar kapanır (fatura modülü `folio.closed`'u dinler).
         */
        'guest.checked_out': async (payload, envelope) => {
          const result = await run(() =>
            service.settleStayOnCheckOut(payload.hotelId, payload.reservationId, {
              lateCheckOutFee: payload.lateCheckOutFee ?? null,
              openBalance: payload.openBalance ?? null,
              eventId: envelope.id,
            }),
          );
          if (result.skipped) return { message: result.skipped };
          const parts = [];
          if (result.roomItems) parts.push(`${result.roomItems} oda ücreti kalemi`);
          if (result.feePosted) parts.push(`geç çıkış ücreti (${result.feePosted})`);
          parts.push(result.open ? `${result.closed} folyo kapandı, ${result.open} folyoda bakiye var` : `${result.closed} folyo kapandı`);
          return { message: parts.join(', '), meta: { closed: result.closed, open: result.open } };
        },

        /** Yanlış giriş geri alındı: o girişin erken giriş ücreti düşer. */
        'guest.check_in_reverted': async (payload, envelope) => {
          const result = await run(() =>
            service.reverseCheckInFees(payload.hotelId, payload.reservationId, {
              reason: payload.reason,
              occurredAt: occurredAt(envelope),
            }),
          );
          return { message: result.reversed ? 'Erken giriş ücreti ters kayıtla düşüldü' : 'Düşülecek ücret yoktu' };
        },

        /** Yanlış çıkış geri alındı: folyo yeniden açılır, geç çıkış ücreti düşer. */
        'guest.check_out_reverted': async (payload, envelope) => {
          const result = await run(() =>
            service.reopenStayOnCheckOutRevert(payload.hotelId, payload.reservationId, {
              reason: payload.reason,
              occurredAt: occurredAt(envelope),
            }),
          );
          const parts = [];
          if (result.reopened) parts.push(`${result.reopened} folyo yeniden açıldı`);
          if (result.reversed) parts.push('geç çıkış ücreti düşüldü');
          return { message: parts.length ? parts.join(', ') : 'Folyoda değişiklik gerekmedi' };
        },

        'reservation.cancelled': async (payload, envelope) => {
          const result = await run(() =>
            service.postReservationFee(payload.hotelId, payload.reservationId, { kind: 'CANCELLATION', eventId: envelope.id }),
          );
          return { message: result.skipped ?? `İptal ücreti folyoya işlendi (${priced(result.posted)})` };
        },

        'reservation.no_show': async (payload, envelope) => {
          const result = await run(() =>
            service.postReservationFee(payload.hotelId, payload.reservationId, { kind: 'NO_SHOW', eventId: envelope.id }),
          );
          return { message: result.skipped ?? `Gelmedi ücreti folyoya işlendi (${priced(result.posted)})` };
        },

        /** İptal / gelmedi geri alındı: o ücretler düşer. */
        'reservation.reinstated': async (payload, envelope) => {
          const result = await run(() =>
            service.reverseReservationFees(payload.hotelId, payload.reservationId, { occurredAt: occurredAt(envelope) }),
          );
          return { message: result.reversed ? `${result.reversed} ücret kalemi ters kayıtla düşüldü` : 'Düşülecek ücret yoktu' };
        },

        /** Gün döndü: gecenin oda ücretleri işlenir. */
        'folio.room_charges.due': async (payload) => {
          const summary = await run(() => service.runRoomCharges(payload.hotelId, { night: payload.night }));
          return {
            message: summary.items
              ? `${dotted(summary.night)} gecesi: ${summary.stays} konaklamaya ${summary.items} oda ücreti kalemi (${summary.total})`
              : `${dotted(summary.night)} gecesi: işlenecek yeni gece yoktu`,
            meta: summary,
          };
        },

        'fnb.order.charged': async (payload, envelope) => {
          const result = await run(() => service.postExternalCharge(payload.hotelId, payload, { source: 'FNB_ORDER', eventId: envelope.id }));
          return { message: `Restoran siparişi ${payload.reference} folyoya işlendi (${result.total})`, meta: result };
        },

        'minibar.consumed': async (payload, envelope) => {
          const result = await run(() => service.postExternalCharge(payload.hotelId, payload, { source: 'MINIBAR', eventId: envelope.id }));
          return { message: `Minibar tüketimi ${payload.reference} folyoya işlendi (${result.total})`, meta: result };
        },
      },
      deps,
    );
  }

  /**
   * Manuel görev başlığı: personel görev listesinde event adı değil, folyo
   * ekranında yapacağı işi görmeli.
   * @param {string} eventName
   * @param {any} payload
   */
  describeFallback(eventName, payload) {
    switch (eventName) {
      case 'guest.checked_in':
        return payload.earlyCheckInFee
          ? `Folyo açılacak, erken giriş ücreti (${payload.earlyCheckInFee}) işlenecek`
          : 'Misafir girdi: folyo açılacak';
      case 'guest.checked_out':
        return payload.lateCheckOutFee
          ? `Çıkış: kalan oda ücretleri ve geç çıkış ücreti (${payload.lateCheckOutFee}) işlenecek, folyo kapatılacak`
          : 'Çıkış: kalan oda ücretleri işlenecek, folyo kapatılacak';
      case 'guest.check_in_reverted':
        return 'Giriş geri alındı: erken giriş ücreti folyodan düşülecek';
      case 'guest.check_out_reverted':
        return 'Çıkış geri alındı: folyo yeniden açılacak, geç çıkış ücreti düşülecek';
      case 'reservation.cancelled':
        return 'İptal ücreti (varsa) folyoya işlenecek';
      case 'reservation.no_show':
        return 'Gelmedi ücreti (varsa) folyoya işlenecek';
      case 'reservation.reinstated':
        return 'Rezervasyon geri alındı: iptal / gelmedi ücreti folyodan düşülecek';
      case 'folio.room_charges.due':
        return `${dotted(payload.night)} gecesinin oda ücretleri işlenecek (Folyolar → Oda ücretlerini işle)`;
      case 'fnb.order.charged':
        return `Restoran siparişi ${payload.reference} folyoya elle işlenecek`;
      case 'minibar.consumed':
        return `Minibar tüketimi ${payload.reference} folyoya elle işlenecek`;
      default:
        return super.describeFallback(eventName, payload);
    }
  }
}

/**
 * @param {object} service
 * @param {object} deps
 * @returns {BillingWorker}
 */
export function createBillingWorker(service, deps) {
  return new BillingWorker(service, deps);
}

export { billingWorkerManifest };
