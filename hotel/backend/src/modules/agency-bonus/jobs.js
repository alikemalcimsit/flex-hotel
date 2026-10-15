import { runWithContext } from '@hotelos/core';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../db.js';
import { startRecurringJobs } from '../../lib/recurring.js';
import { refreshProgress, settleDueRules } from './progress.js';
import { calculateBonus } from './settlement.js';
import { SYSTEM_ACTOR } from './shared.js';

/**
 * Acente bonusunun zamanlanmış işi (modül 35, yalnızca sunucu sürecinde).
 *
 * | İş                  | Sıklık | Ne yapar |
 * |---------------------|--------|----------|
 * | Hedef ilerlemesi    | 30 dk  | Yürürlükteki kuralların gerçekleşen üretim / puan / kademe özeti; kademe yükselince uyarı |
 * | Dönem sonu hak edişi| aynı tur | Dönemi biten kuralın hak edişini hesaplar, yetkiliye "onaya gönderin" uyarısı |
 *
 * Yürürlükte kuralı olan oteller sırayla işlenir; bir otelin hatası diğerlerini
 * durdurmaz.
 */

const PROGRESS_INTERVAL_MS = 30 * 60_000;

/**
 * Bir tur: her otel için önce dönemi bitenler (hesap), sonra ilerleme.
 * @param {{ info: Function, warn: Function }} logger
 */
export async function runAgencyBonusTick(logger) {
  const hotels = await prisma.agencyBonusRule.findMany({ where: { status: 'ACTIVE' }, distinct: ['hotelId'], select: { hotelId: true } });
  for (const { hotelId } of hotels) {
    try {
      await runWithContext({ correlationId: randomUUID(), actor: SYSTEM_ACTOR }, async () => {
        const settled = await settleDueRules(hotelId, { calculate: calculateBonus, logger });
        const progress = await refreshProgress(hotelId);
        if (settled || progress.tierUps) logger.info({ hotelId, settled, tierUps: progress.tierUps }, 'Acente prim turu');
      });
    } catch (error) {
      logger.warn({ err: error, hotelId }, 'Acente prim ilerlemesi tazelenemedi');
    }
  }
  return hotels.length;
}

/**
 * @param {{ info: Function, warn: Function, error: Function }} logger
 * @returns {() => void}
 */
export function startAgencyBonusJobs(logger) {
  return startRecurringJobs(logger, [{ name: 'agency-bonus-progress', intervalMs: PROGRESS_INTERVAL_MS, run: () => runAgencyBonusTick(logger) }]);
}
