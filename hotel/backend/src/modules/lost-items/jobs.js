import { startRecurringJobs } from '../../lib/recurring.js';
import { purgeClosedItemPhotos } from './photos.js';

/**
 * Kayıp eşya modülünün zamanlanmış işi (yalnızca sunucu sürecinde).
 *
 * | İş                              | Sıklık | Neden |
 * |---------------------------------|--------|-------|
 * | Kapanan eşyaların fotoğrafları  | 1 sa   | Teslim edilen / kapatılan eşyanın fotoğrafı bir ay sonra gereksiz kişisel veri; disk de dolmasın |
 */
const PHOTO_PURGE_INTERVAL_MS = 60 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startLostItemJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'lost-item-photo-purge',
      intervalMs: PHOTO_PURGE_INTERVAL_MS,
      run: async () => {
        const purged = await purgeClosedItemPhotos(logger);
        if (purged.photos > 0) logger.info(purged, 'Kapanan kayıp eşyaların fotoğrafları silindi');
      },
    },
  ]);
}
