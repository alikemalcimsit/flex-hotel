import { BaseWorker } from '@hotelos/actor-kit';
import { housekeepingWorkerManifest } from './manifest.js';

/** Oda durumunu süren görev tipleri — havlu isteği odayı "Temizleniyor" yapmaz. */
const CLEANING_TYPES = Object.freeze(['CHECKOUT_CLEAN', 'STAYOVER', 'DEEP_CLEAN']);

/** Göreve çevrilen misafir isteği kategorileri (modül 7). */
const REQUEST_CATEGORIES = Object.freeze(['HOUSEKEEPING', 'AMENITY']);

/**
 * Hata iş kuralından mı geliyor? Servis katmanının tipli hataları HTTP durumu
 * taşır; 4xx olanlar ("oda bulunamadı") tekrar denemekle düzelmez —
 * beklemeden personelin önüne düşmeli.
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
 * Kat hizmeti aktörü.
 *
 * Servisi dışarıdan alır: worker paketi ne Prisma ne HTTP bilir, sahte
 * servisle veritabanısız test edilir. Oda durumunun **tek sistem yazıcısı**
 * `applySystemRoomState`tir; görev kaydı odayı hiç yazmaz — bu aktör olaydan
 * yazar, kapalıyken iş personele düşer.
 */
class HousekeepingWorker extends BaseWorker {
  /**
   * @param {{
   *   createCleaningTask: (hotelId: string, input: { roomId: string, type: string, priority?: number, notes?: string | null }) => Promise<{ created: boolean, upgraded?: boolean, task: { room?: { number: string } } }>,
   *   createRequestTask: (hotelId: string, input: { requestId: string, roomId: string, priority: string }) => Promise<{ created: boolean, task: object | null }>,
   *   cancelOpenCheckoutTasks: (hotelId: string, roomId: string, reason: string) => Promise<{ cancelled: number }>,
   *   applySystemRoomState: (hotelId: string, roomId: string, state: { housekeepingStatus?: string }, reason: string) => Promise<unknown>,
   *   completeGuestRequest: (hotelId: string, requestId: string, note: string) => Promise<unknown>,
   * }} service
   * @param {object} deps BaseWorker bağımlılıkları
   */
  constructor(service, deps) {
    super(
      housekeepingWorkerManifest,
      {
        /** Misafir çıktı: oda satışa dönecek, öncelikli çıkış temizliği açılır. */
        'guest.checked_out': async (payload) => {
          let result;
          try {
            result = await service.createCleaningTask(payload.hotelId, {
              roomId: payload.roomId,
              type: 'CHECKOUT_CLEAN',
              notes: null,
            });
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }
          if (result.upgraded) return { message: 'Açık konaklama temizliği çıkış temizliğine çevrildi (erken çıkış)' };
          return result.created
            ? { message: 'Çıkış temizliği görevi açıldı', meta: { taskId: result.task.id ?? null } }
            : { message: 'Odanın açık temizlik görevi zaten var, yenisi açılmadı' };
        },

        /** Yanlış çıkış geri alındı: misafir hâlâ içeride, görevli kapıyı çalmasın. */
        'guest.check_out_reverted': async (payload) => {
          let result;
          try {
            result = await service.cancelOpenCheckoutTasks(
              payload.hotelId,
              payload.roomId,
              `Çıkış geri alındı: ${payload.reason}`,
            );
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }
          return result.cancelled > 0
            ? { message: 'Çıkış temizliği görevi iptal edildi (çıkış geri alındı)' }
            : { message: 'İptal edilecek açık çıkış temizliği görevi yoktu' };
        },

        /**
         * Arıza / bakım kaydı kapandı: oda kirliye düştü (modül 3), tadilat
         * tozunun ardından detaylı temizlik ister.
         */
        'room.unblocked': async (payload) => {
          let result;
          try {
            result = await service.createCleaningTask(payload.hotelId, {
              roomId: payload.roomId,
              type: 'DEEP_CLEAN',
              notes: 'Arıza / bakım kaydı kapandı; detaylı temizlik',
            });
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }
          return result.created
            ? { message: 'Bakım sonrası detaylı temizlik görevi açıldı' }
            : { message: 'Odanın açık temizlik görevi zaten var, yenisi açılmadı' };
        },

        /** Misafirin kat isteği (havlu, yastık) görev listesine düşer. */
        'guest.request.created': async (payload) => {
          let result;
          try {
            result = await service.createRequestTask(payload.hotelId, {
              requestId: payload.requestId,
              roomId: payload.roomId,
              priority: payload.priority,
            });
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }
          if (!result.created) {
            return { message: result.task ? 'İsteğin açık görevi zaten var' : 'İstek bu arada kapanmış, görev açılmadı' };
          }
          return { message: 'Misafir isteği kat görevine çevrildi' };
        },

        /** Görevli "Başladım" dedi: temizlik görevlerinde oda "Temizleniyor". */
        'housekeeping.task.started': async (payload) => {
          try {
            await service.applySystemRoomState(
              payload.hotelId,
              payload.roomId,
              { housekeepingStatus: 'CLEANING' },
              'Temizlik başladı (kat görevi)',
            );
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }
          return { message: 'Oda "Temizleniyor" olarak işaretlendi' };
        },

        /**
         * Görevli "Bitti" dedi: temizlik görevinde oda "Temiz" olur (kat şefi
         * kontrolünü bekler); bağlı misafir isteği varsa kapanır.
         */
        'housekeeping.task.completed': async (payload) => {
          const done = [];
          try {
            if (CLEANING_TYPES.includes(payload.type)) {
              await service.applySystemRoomState(
                payload.hotelId,
                payload.roomId,
                { housekeepingStatus: 'CLEAN' },
                'Temizlik tamamlandı (kat görevi)',
              );
              done.push('oda "Temiz" yapıldı');
            }
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }
          if (payload.guestRequestId) {
            try {
              await service.completeGuestRequest(payload.hotelId, payload.guestRequestId, 'Kat görevi tamamlandı');
              done.push('misafir isteği kapatıldı');
            } catch (error) {
              // İstek bu arada personelce kapatılmış olabilir; iş zaten yapılmış.
              const status = /** @type {{ statusCode?: number }} */ (error)?.statusCode;
              if (typeof status === 'number' && status >= 400 && status < 500) {
                done.push('misafir isteği zaten kapalıydı');
              } else {
                throw error;
              }
            }
          }
          return { message: `Görev bitti: ${done.join(', ') || 'oda durumu değişmedi'}` };
        },

        /** Kat şefi kontrolü: geçtiyse "Kontrol edildi", kaldıysa yeniden "Kirli". */
        'housekeeping.room.inspected': async (payload) => {
          try {
            await service.applySystemRoomState(
              payload.hotelId,
              payload.roomId,
              { housekeepingStatus: payload.passed ? 'INSPECTED' : 'DIRTY' },
              payload.passed ? 'Kat şefi onayladı' : `Kontrolden döndü: ${payload.note ?? 'sebep yazılmadı'}`,
            );
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }
          return {
            message: payload.passed ? 'Oda "Kontrol edildi" olarak işaretlendi' : 'Oda yeniden "Kirli" olarak işaretlendi',
          };
        },
      },
      deps,
    );
  }

  /**
   * İlgisiz olay sıraya girmez, iz bırakmaz: havlu görevi odanın durumunu
   * değiştirmez, kat-dışı istek göreve dönmez, süren arıza kaydının iptali
   * temizlik istemez.
   * @param {string} eventName
   * @param {object} payload
   */
  accepts(eventName, payload) {
    switch (eventName) {
      case 'room.unblocked':
        // Yalnızca süren kaydın bitişi: başlamamış kaydın iptalinde oda hiç kapanmadı.
        return payload.mode === 'ENDED';
      case 'guest.request.created':
        return REQUEST_CATEGORIES.includes(payload.category) && Boolean(payload.roomId);
      case 'housekeeping.task.started':
        return CLEANING_TYPES.includes(payload.type);
      case 'housekeeping.task.completed':
        return CLEANING_TYPES.includes(payload.type) || Boolean(payload.guestRequestId);
      default:
        return true;
    }
  }

  /**
   * Aktör kapalıyken misafir isteği göreve çevrilmez ama kaybolmaz: istek
   * zaten kendi ekranında (modül 7) personelin önünde. Diğer işler manuel
   * görev olarak düşer.
   * @param {string} eventName
   */
  skipWhenDisabled(eventName) {
    return eventName === 'guest.request.created';
  }

  /**
   * Manuel görev başlığı: personel görev listesinde event adı değil yapılacak
   * işi görmeli.
   * @param {string} eventName
   * @param {object} payload
   */
  describeFallback(eventName, payload) {
    const room = payload.roomNumber ? `${payload.roomNumber} odası: ` : '';
    switch (eventName) {
      case 'guest.checked_out':
        return 'Çıkış temizliği görevi açılacak';
      case 'guest.check_out_reverted':
        return 'Çıkış geri alındı: açık çıkış temizliği görevi iptal edilecek';
      case 'room.unblocked':
        return `${room}bakım sonrası detaylı temizlik görevi açılacak`;
      case 'housekeeping.task.started':
        return `${room}oda "Temizleniyor" olarak işaretlenecek`;
      case 'housekeeping.task.completed':
        return `${room}oda "Temiz" olarak işaretlenecek; bağlı misafir isteği varsa kapatılacak`;
      case 'housekeeping.room.inspected':
        return payload.passed
          ? `${room}oda "Kontrol edildi" olarak işaretlenecek`
          : `${room}oda yeniden "Kirli" olarak işaretlenecek`;
      default:
        return super.describeFallback(eventName, payload);
    }
  }
}

/**
 * @param {object} service
 * @param {object} deps
 * @returns {HousekeepingWorker}
 */
export function createHousekeepingWorker(service, deps) {
  return new HousekeepingWorker(service, deps);
}

export { housekeepingWorkerManifest };
