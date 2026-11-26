import { BaseWorker } from '@hotelos/actor-kit';
import { kbsWorkerManifest } from './manifest.js';

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

/** @param {{ posted?: boolean, skipped?: string, message?: string | null }} result @param {string} fallback */
const said = (result, fallback) => ({ message: result.message ?? result.skipped ?? fallback, meta: { posted: Boolean(result.posted) } });

/** @typedef {(hotelId: string, reservationId: string) => Promise<{ posted?: boolean, skipped?: string, message?: string | null }>} StayHandler */

/** KBS aktörü. Servisi dışarıdan alır (veritabanısız test edilir); kurallar (kim, hangi bildirim, zincir) serviste. */
class KbsWorker extends BaseWorker {
  /**
   * @param {{ onCheckedIn: StayHandler, onCheckedOut: StayHandler, onCheckInReverted: StayHandler, onCheckOutReverted: StayHandler, onRoomAssigned: StayHandler }} service
   * @param {object} deps
   */
  constructor(service, deps) {
    /** @param {keyof typeof service} name @param {string} fallback */
    const handler = (name, fallback) => async (payload) => said(await run(() => service[name](payload.hotelId, payload.reservationId)), fallback);
    super(
      kbsWorkerManifest,
      {
        'guest.checked_in': handler('onCheckedIn', 'Giriş bildirimi sıraya alındı'),
        'guest.checked_out': handler('onCheckedOut', 'Çıkış bildirimi sıraya alındı'),
        'guest.check_in_reverted': handler('onCheckInReverted', 'Geri alınan girişin KBS kaydı düzeltildi'),
        'guest.check_out_reverted': handler('onCheckOutReverted', 'Geri alınan çıkışın KBS kaydı düzeltildi'),
        'room.assigned': handler('onRoomAssigned', 'Oda değişikliği denetlendi'),
      },
      deps,
    );
  }

  /** @param {string} eventName @param {any} payload */
  describeFallback(eventName, payload) {
    switch (eventName) {
      case 'guest.checked_in':
        return 'Giren misafirin KBS giriş bildirimi elle yapılacak';
      case 'guest.checked_out':
        return 'Çıkan misafirin KBS çıkış bildirimi elle yapılacak';
      case 'guest.check_in_reverted':
        return 'Geri alınan girişin KBS kaydı elle düzeltilecek';
      case 'guest.check_out_reverted':
        return 'Geri alınan çıkışın KBS kaydı elle düzeltilecek (yeniden giriş)';
      case 'room.assigned':
        return 'Oda değiştiren misafirin KBS oda değişikliği elle bildirilecek';
      default:
        return super.describeFallback(eventName, payload);
    }
  }
}

export { kbsWorkerManifest };

/** @param {ConstructorParameters<typeof KbsWorker>[0]} service @param {ConstructorParameters<typeof KbsWorker>[1]} deps */
export function createKbsWorker(service, deps) {
  return new KbsWorker(service, deps);
}
