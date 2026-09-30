import { startRecurringJobs } from '../../lib/recurring.js';
import { scheduleDueRoomCharges } from './service.js';

/**
 * Folyo modülünün zamanlanmış işi (yalnızca sunucu sürecinde).
 *
 * | İş                      | Sıklık | Neden |
 * |-------------------------|--------|-------|
 * | Gecenin oda ücretleri   | 5 dk   | Otelin iş günü dönünce dün gecenin çalışması bir kez açılır, folyo aktörüne haber gider |
 *
 * İşin kendisi (2500 konaklamaya kalem) aktörde; zamanlayıcı yalnızca "gece
 * bitti" haberini verir. Sunucu kapalıyken geçen geceler sonraki açılışta
 * tek çalışmayla telafi edilir (uzlaştırma eksik bütün geceleri işler).
 */
const ROOM_CHARGE_CHECK_INTERVAL_MS = 5 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startFolioJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'room-charge-schedule',
      intervalMs: ROOM_CHARGE_CHECK_INTERVAL_MS,
      run: async () => {
        const opened = await scheduleDueRoomCharges();
        if (opened > 0) logger.info({ opened }, 'Gecenin oda ücreti çalışması açıldı');
      },
    },
  ]);
}
