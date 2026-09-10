import { BaseWorker } from '@hotelos/actor-kit';
import { roomWorkerManifest } from './manifest.js';

/**
 * Oda aktörü.
 *
 * Servisi ve altyapıyı dışarıdan alır: worker paketi ne Prisma ne HTTP bilir,
 * böylece sahte bir servisle veritabanısız test edilebilir.
 */
class RoomWorker extends BaseWorker {
  /**
   * @param {{
   *   autoAssignRoom: (hotelId: string, reservationId: string) => Promise<{ assigned: boolean, room?: { number: string }, reason?: string }>,
   *   applySystemRoomStatus: (hotelId: string, roomId: string, status: string, reason: string) => Promise<unknown>,
   * }} service
   * @param {object} deps BaseWorker bağımlılıkları
   */
  constructor(service, deps) {
    super(
      roomWorkerManifest,
      {
        /**
         * Yeni rezervasyona oda ata.
         *
         * Rezervasyon oluşturulurken oda zaten seçilmişse dokunmaz — personel
         * bilerek seçmiş olabilir, üzerine yazmak sürpriz olurdu.
         */
        'reservation.created': async (payload) => {
          if (payload.roomId) {
            return { message: 'Oda zaten atanmış, dokunulmadı', meta: { roomId: payload.roomId } };
          }

          const result = await service.autoAssignRoom(payload.hotelId, payload.reservationId);

          if (!result.assigned) {
            // Boş oda yokluğu geçici bir arıza değil; tekrar denemek yerine
            // doğrudan personelin önüne düşsün.
            const error = new Error(result.reason ?? 'Uygun oda bulunamadı');
            error.retryable = false;
            throw error;
          }

          return {
            message: `${result.room.number} numaralı oda atandı`,
            meta: { roomId: result.room.id, roomNumber: result.room.number },
          };
        },

        'guest.checked_in': async (payload) => {
          await service.applySystemRoomStatus(payload.hotelId, payload.roomId, 'OCCUPIED', 'Misafir giriş yaptı');
          return { message: 'Oda dolu olarak işaretlendi' };
        },

        'guest.checked_out': async (payload) => {
          // Çıkış sonrası oda kirlidir; housekeeping (modül 14) buradan devralır.
          await service.applySystemRoomStatus(payload.hotelId, payload.roomId, 'DIRTY', 'Misafir çıkış yaptı');
          return { message: 'Oda kirli olarak işaretlendi' };
        },
      },
      deps,
    );
  }

  /**
   * Manuel görev başlığını okunur yapar: personel görev listesinde event adı
   * değil, yapılacak işi görmeli.
   * @param {string} eventName
   * @param {object} payload
   */
  describeFallback(eventName, payload) {
    switch (eventName) {
      case 'reservation.created':
        return 'Rezervasyona oda atanacak';
      case 'guest.checked_in':
        return 'Oda "dolu" olarak işaretlenecek';
      case 'guest.checked_out':
        return 'Oda "kirli" olarak işaretlenecek';
      default:
        return super.describeFallback(eventName, payload);
    }
  }
}

/**
 * @param {object} service
 * @param {object} deps
 * @returns {RoomWorker}
 */
export function createRoomWorker(service, deps) {
  return new RoomWorker(service, deps);
}

export { roomWorkerManifest };
