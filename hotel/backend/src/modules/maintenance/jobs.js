import { runWithContext } from '@hotelos/core';
import { startRecurringJobs } from '../../lib/recurring.js';
import { purgeResolvedTicketPhotos } from './photos.js';
import { generateDuePlanTickets } from './service.js';

/**
 * Teknik servisin zamanlanmış işleri (yalnızca sunucu sürecinde).
 *
 * | İş                        | Sıklık | Neden |
 * |---------------------------|--------|-------|
 * | Periyodik bakım biletleri | 6 saat | Süresi gelen planlardan bilet üretir (plan başına tek açık bilet) |
 * | Kapanmış bilet fotoğrafı  | 24 saat| Çözülen biletlerin fotoğrafları süre dolunca silinir |
 */
const PLAN_CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const PHOTO_PURGE_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startMaintenanceModuleJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'maintenance-plan-tickets',
      intervalMs: PLAN_CHECK_INTERVAL_MS,
      run: async () => {
        const created = await runWithContext({ actor: 'sistem:teknik-servis' }, () => generateDuePlanTickets());
        if (created > 0) logger.info({ created }, 'Periyodik bakım biletleri üretildi');
      },
    },
    {
      name: 'maintenance-photo-purge',
      intervalMs: PHOTO_PURGE_INTERVAL_MS,
      run: async () => {
        const purged = await purgeResolvedTicketPhotos(logger);
        if (purged > 0) logger.info({ purged }, 'Kapanmış arıza fotoğrafları silindi');
      },
    },
  ]);
}
