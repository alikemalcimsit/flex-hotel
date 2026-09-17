import { BaseWorker } from '@hotelos/actor-kit';
import { roomWorkerManifest } from './manifest.js';

/**
 * Hata iş kuralından mı geliyor? Servis katmanının tipli hataları HTTP
 * durumu taşır; 4xx olanlar ("rezervasyon atanabilir durumda değil") tekrar
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

/**
 * Oda aktörü.
 *
 * Servisi ve altyapıyı dışarıdan alır: worker paketi ne Prisma ne HTTP bilir,
 * böylece sahte bir servisle veritabanısız test edilebilir.
 */
class RoomWorker extends BaseWorker {
  /**
   * @param {{
   *   autoAssignRoom: (hotelId: string, reservationId: string) => Promise<{ assigned: boolean, alreadyAssigned?: boolean, room?: { id: string, number: string }, reason?: string }>,
   *   applySystemRoomState: (hotelId: string, roomId: string, state: { occupancy?: string, housekeepingStatus?: string }, reason: string) => Promise<unknown>,
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

          let result;
          try {
            result = await service.autoAssignRoom(payload.hotelId, payload.reservationId);
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }

          if (result.alreadyAssigned) {
            // Aktör işe başlamadan personel odayı elle vermiş: iş zaten yapılmış.
            return {
              message: `Oda bu arada elle atanmış (${result.room?.number ?? '—'}), dokunulmadı`,
              meta: { roomId: result.room?.id ?? null, roomNumber: result.room?.number ?? null },
            };
          }
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

        /** Misafir girdi: oda dolu. Kat hizmeti durumuna dokunulmaz. */
        'guest.checked_in': async (payload) => {
          try {
            await service.applySystemRoomState(payload.hotelId, payload.roomId, { occupancy: 'OCCUPIED' }, 'Misafir giriş yaptı');
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }
          return { message: 'Oda dolu olarak işaretlendi' };
        },

        /**
         * Misafir çıktı: oda boş **ve kirli**. Yalnızca "boş" yapmak, temizlenmemiş
         * odayı bir sonraki misafire hazır gösterirdi; housekeeping (modül 14)
         * kirli odadan devralır.
         */
        'guest.checked_out': async (payload) => {
          try {
            await service.applySystemRoomState(
              payload.hotelId,
              payload.roomId,
              { occupancy: 'VACANT', housekeepingStatus: 'DIRTY' },
              'Misafir çıkış yaptı',
            );
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }
          return { message: 'Oda boş ve kirli olarak işaretlendi' };
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
        return 'Oda "boş · kirli" olarak işaretlenecek';
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
