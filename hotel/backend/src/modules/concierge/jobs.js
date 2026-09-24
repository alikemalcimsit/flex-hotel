import { guessLanguage, handoffMessage } from '@hotelos/concierge-agent';
import { prismaUnfiltered } from '../../db.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { handOffToStaff } from '../messaging/service.js';

/**
 * AI asistanının zamanlanmış işi (modül 8, yalnızca sunucu sürecinde).
 *
 * AI modundaki konuşmada misafir `STALL_AFTER_MS`'den uzun süredir cevap
 * bekliyorsa konuşma personele devredilir. Normalde AI saniyeler içinde
 * cevap verir ya da kendisi devreder; bu iş geri kalan her durumun sigortası:
 * - AI ajanları arka planda çalışır; süreç tur ortasında kapanırsa sıradaki
 *   işler kaybolur,
 * - yoğunlukta sıra birikmiş olabilir,
 * - sağlayıcı cevap vermeden takılmış olabilir.
 * Misafir her durumda "ekibimiz dönecek" bilgisini alır; personelin ziline uyarı düşer.
 *
 * Kısmi index'li (`Conversation_ai_waiting_idx`): yalnızca AI'da bekleyen
 * konuşmalar taranır.
 */

/** Bu süredir cevapsız AI konuşması takılmış sayılır. */
export const STALL_AFTER_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
/** Tur başına en fazla konuşma. */
const SWEEP_BATCH = 100;

/**
 * @param {Date} [now]
 * @returns {Promise<number>} personele devredilen konuşma
 */
export async function handOffStalledConversations(now = new Date()) {
  const cut = new Date(now.getTime() - STALL_AFTER_MS);
  const rows = await prismaUnfiltered.$queryRaw`
    SELECT c."id", c."hotelId", c."lastMessagePreview", s."language"
    FROM "Conversation" c
    LEFT JOIN "ConversationAiState" s ON s."conversationId" = c."id"
    WHERE c."mode" = 'AI' AND c."status" = 'OPEN' AND c."awaitingReplySince" IS NOT NULL AND c."deletedAt" IS NULL
      AND c."awaitingReplySince" < ${sqlTimestamp(cut)}
    ORDER BY c."awaitingReplySince" ASC
    LIMIT ${SWEEP_BATCH}`;
  let changed = 0;
  for (const row of rows) {
    const minutes = Math.round(STALL_AFTER_MS / 60_000);
    const result = await handOffToStaff(row.hotelId, row.id, {
      reason: 'STALLED',
      detail: `Misafir ${minutes} dakikadan uzun süredir AI cevabı bekliyordu`,
      notice: handoffMessage('UNAVAILABLE', row.language ?? guessLanguage(row.lastMessagePreview)),
      severity: 'WARNING',
    });
    if (result.changed) changed += 1;
  }
  return changed;
}

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startConciergeJobs(logger) {
  return startRecurringJobs(logger, [
    {
      name: 'ai-stalled-conversations',
      intervalMs: SWEEP_INTERVAL_MS,
      run: async () => {
        const changed = await handOffStalledConversations();
        if (changed > 0) logger.warn({ changed }, 'Takılan AI konuşmaları personele devredildi');
      },
    },
  ]);
}
