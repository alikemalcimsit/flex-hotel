import { startRecurringJobs } from '../../lib/recurring.js';
import { runSurveyJob } from './invites.js';

/**
 * Anketin zamanlanmış işi (yalnızca sunucu sürecinde, modül 55).
 *
 * | İş              | Sıklık | Neden |
 * |-----------------|--------|-------|
 * | Anket davetleri | 15 dk  | Gönderim saati otelin ayarı (ör. 11:00, ara ankette 18:00): saatin ilk çeyreğinde gider |
 */
const SURVEY_INTERVAL_MS = 15 * 60_000;

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startSurveyJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'survey-invitations',
      intervalMs: SURVEY_INTERVAL_MS,
      run: async () => {
        const sent = await runSurveyJob(logger);
        if (sent > 0) logger.info({ sent }, 'Anket davetleri sıraya alındı');
      },
    },
  ]);
}
