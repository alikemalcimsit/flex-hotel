import { currentActor } from '@hotelos/core';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { cache } from '../../lib/cache.js';
import { hasAutoResponder } from '../../lib/channels.js';
import { NotFoundError, StaleWriteError, rethrowPrismaError } from '../../lib/errors.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';

/**
 * AI asistanı ayarları (modül 8).
 *
 * "Bu otelde AI misafire cevap verir mi?" sorusunun tek cevabı burada
 * (`aiActiveFor`): sunucuda anahtar tanımlı ve ajan kayıtlı (süreç düzeyi)
 * **ve** otel AI'ı açmış. Gelen kutusu yeni konuşmayı buna göre AI ya da
 * personel modunda açar.
 *
 * Ayar sık okunur (her mesajda); kısa süre önbelleklenir, kayıtta silinir.
 */

const CACHE_TTL_MS = 60_000;
const cacheKey = (hotelId) => `ai:${hotelId}:settings`;

/** Sunucuda model anahtarı var mı (süreç düzeyi; anahtarın kendisi hiçbir cevapta dönmez). */
export function aiKeyConfigured(env = process.env) {
  return Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim());
}

const DEFAULTS = Object.freeze({
  enabled: false,
  routerModel: '',
  conciergeModel: '',
  prices: {},
  dailyBudgetUsd: '0',
  reservationStatus: 'CONFIRMED',
  hotelInfo: null,
  maxRepliesPerConversationDay: 40,
  updatedAt: null,
  updatedBy: null,
});

/** @param {object | null} row */
function toDto(row) {
  if (!row) return { ...DEFAULTS };
  return {
    enabled: row.enabled,
    routerModel: row.routerModel,
    conciergeModel: row.conciergeModel,
    prices: row.prices ?? {},
    dailyBudgetUsd: row.dailyBudgetUsd.toString(),
    reservationStatus: row.reservationStatus,
    hotelInfo: row.hotelInfo,
    maxRepliesPerConversationDay: row.maxRepliesPerConversationDay,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

/**
 * Önbellekli ayar (ajanlar ve gelen kutusu için).
 * @param {string} hotelId
 */
export function getAiSettingsCached(hotelId) {
  return cache.getOrSet(
    cacheKey(hotelId),
    async () => toDto(await prisma.aiSettings.findFirst({ where: { hotelId } })),
    CACHE_TTL_MS,
  );
}

/**
 * Bu otelde AI misafire cevap verir mi?
 * @param {string} hotelId
 */
export async function aiActiveFor(hotelId) {
  if (!hasAutoResponder()) return false;
  return (await getAiSettingsCached(hotelId)).enabled;
}

/**
 * Ayar ekranı: ayar + sunucu durumu.
 * @param {string} hotelId
 */
export async function getAiSettings(hotelId) {
  const settings = toDto(await prisma.aiSettings.findFirst({ where: { hotelId } }));
  return { ...settings, keyConfigured: aiKeyConfigured(), agentRunning: hasAutoResponder() };
}

/**
 * @param {string} hotelId
 * @param {object} input `aiSettingsSchema` çıktısı
 */
export async function saveAiSettings(hotelId, input) {
  const { expectedUpdatedAt, ...values } = input;
  // Yalnızca seçili modellerin fiyatı saklanır (eski modelin fiyatı birikmesin).
  const prices = Object.fromEntries(
    Object.entries(values.prices ?? {}).filter(([model]) => [values.routerModel, values.conciergeModel].includes(model)),
  );
  const data = {
    enabled: values.enabled,
    routerModel: values.routerModel,
    conciergeModel: values.conciergeModel,
    prices,
    dailyBudgetUsd: values.dailyBudgetUsd,
    reservationStatus: values.reservationStatus,
    hotelInfo: values.hotelInfo ?? null,
    maxRepliesPerConversationDay: values.maxRepliesPerConversationDay,
    updatedBy: currentActor(),
  };
  try {
    await writeWithEvents(async (tx) => {
      const before = await tx.aiSettings.findFirst({ where: { hotelId } });
      if (Boolean(before) !== Boolean(expectedUpdatedAt)) throw new StaleWriteError();
      if (before) {
        await updateWithVersionCheck(tx, 'aiSettings', { id: before.id, hotelId }, expectedUpdatedAt, data, 'AI ayarı bulunamadı');
      } else {
        await tx.aiSettings.create({ data: { hotelId, ...data } });
      }
      const after = await tx.aiSettings.findFirst({ where: { hotelId } });
      if (!after) throw new NotFoundError('AI ayarı bulunamadı');
      await recordAudit(tx, {
        hotelId,
        entity: 'AiSettings',
        entityId: after.id,
        action: before ? 'UPDATE' : 'CREATE',
        before: before ? toDto(before) : null,
        after: toDto(after),
      });
    });
  } catch (error) {
    rethrowPrismaError(error);
  } finally {
    cache.invalidatePrefix(`ai:${hotelId}:`);
  }
  return getAiSettings(hotelId);
}
