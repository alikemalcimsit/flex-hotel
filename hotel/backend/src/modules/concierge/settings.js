import { conciergeAgentManifest } from '@hotelos/concierge-agent';
import { currentActor } from '@hotelos/core';
import { routerAgentManifest } from '@hotelos/router-agent';
import { prisma } from '../../db.js';
import { isActorEnabledCached } from '../../lib/actor-settings.js';
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
 * (`aiActiveFor`): sunucuda anahtar tanımlı ve ajan kayıtlı (süreç düzeyi),
 * otel AI'ı açmış **ve** iki ajan da aktör panelinde (modül 12) açık. Gelen
 * kutusu yeni konuşmayı buna göre AI ya da personel modunda açar; ajan
 * kapalıyken her misafir mesajı ayrı bir manuel göreve düşmez, konuşma
 * baştan personelde olur.
 *
 * Ayar sık okunur (her mesajda); kısa süre önbelleklenir, kayıtta silinir.
 */

const CACHE_TTL_MS = 60_000;
const cacheKey = (hotelId) => `ai:${hotelId}:settings`;

/** AI'ın misafire cevap verebilmesi için açık olması gereken ajanlar. */
export const AI_AGENT_NAMES = Object.freeze([routerAgentManifest.name, conciergeAgentManifest.name]);

/** Ajan → ayardaki model alanı (aktör panelinin LLM kartı için). */
const AGENT_MODEL_FIELDS = Object.freeze({
  [routerAgentManifest.name]: 'routerModel',
  [conciergeAgentManifest.name]: 'conciergeModel',
});

/**
 * Ajanın bu oteldeki modeli; LLM ajanı değilse ya da seçilmemişse `null`.
 * @param {string} actorName
 * @param {{ routerModel?: string, conciergeModel?: string }} settings
 */
export function agentModel(actorName, settings) {
  const field = AGENT_MODEL_FIELDS[actorName];
  return (field && settings?.[field]) || null;
}

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
  if (!(await getAiSettingsCached(hotelId)).enabled) return false;
  return aiAgentsEnabled(hotelId);
}

/**
 * AI ajanlarının ikisi de aktör panelinde açık mı?
 * @param {string} hotelId
 */
export async function aiAgentsEnabled(hotelId) {
  const states = await Promise.all(AI_AGENT_NAMES.map((name) => isActorEnabledCached(hotelId, name)));
  return states.every(Boolean);
}

/**
 * Ayar ekranı: ayar + sunucu durumu.
 * @param {string} hotelId
 */
export async function getAiSettings(hotelId) {
  const settings = toDto(await prisma.aiSettings.findFirst({ where: { hotelId } }));
  return {
    ...settings,
    keyConfigured: aiKeyConfigured(),
    agentRunning: hasAutoResponder(),
    agentsEnabled: await aiAgentsEnabled(hotelId),
  };
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
