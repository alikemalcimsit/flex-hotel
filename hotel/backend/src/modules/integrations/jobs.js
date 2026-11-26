import { startRecurringJobs } from '../../lib/recurring.js';
import { disableWebhookSender, enableWebhookSender, purgeWebhookDeliveries, runScheduledWebhookRound } from './sender.js';

/**
 * Entegrasyonun zamanlanmış işleri (yalnızca sunucu sürecinde, modül 61).
 *
 * | İş                 | Sıklık | Neden |
 * |--------------------|--------|-------|
 * | Webhook gönderimi  | 15 sn  | Yeniden denemelerin vakti gelenler; olay anında da uyandırılır (`kickWebhookSender`) |
 * | Teslimat temizliği | 1 sa   | 30 günden eski teslimatlar silinir, süresi geçen eski imza sırları atılır |
 */
const SEND_INTERVAL_MS = 15_000;
const PURGE_INTERVAL_MS = 60 * 60_000;

/** @param {{ info: Function, warn: Function, error: Function }} logger */
export function startIntegrationJobs(logger) {
  enableWebhookSender(logger);
  const stop = startRecurringJobs(logger, [
    { name: 'webhook-sender', intervalMs: SEND_INTERVAL_MS, run: () => runScheduledWebhookRound(logger) },
    {
      name: 'webhook-purge',
      intervalMs: PURGE_INTERVAL_MS,
      run: async () => {
        const purged = await purgeWebhookDeliveries();
        if (purged > 0) logger.info({ purged }, 'Eski webhook teslimatları silindi');
      },
    },
  ]);
  return () => {
    stop();
    disableWebhookSender();
  };
}
