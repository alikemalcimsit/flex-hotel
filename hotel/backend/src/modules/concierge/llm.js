import { LlmUnavailableError } from '@hotelos/actor-kit';
import { toDecimal } from '@hotelos/core';
import { budgetExhausted, createOpenAiChatClient, priceFor, usageCost } from '@hotelos/llm';
import { prisma, prismaUnfiltered } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { aiKeyConfigured, getAiSettingsCached } from './settings.js';

/**
 * AI ajanlarının model katmanı (modül 8): istemci, bütçe denetimi, kullanım kaydı.
 *
 * `BaseLlmAgent` her model çağrısından önce `assertCanCall`, sonra
 * `recordUsage` çağırır. Buradaki üç kural para-kritik:
 *
 * 1. **Fiyatı bilinmeyen modelle çağrı yok.** Maliyet sayılamazsa bütçe de
 *    denetlenemez.
 * 2. **Günlük bütçe otelin iş gününe göre.** Harcama `LlmUsage.date` (iş
 *    günü) üzerinden toplanır; gece yarısı otelin saat diliminde döner.
 * 3. **Her çağrı hemen kaydedilir** (turun geri kalanı hata verse de para
 *    harcandı).
 *
 * ### Yük
 *
 * Her çağrıdan önce bugünün toplamını saymak (`SUM`) yoğun saatte saniyede
 * onlarca sorgu demek. Toplam süreç içinde tutulur: `SPEND_REFRESH_MS`'de bir
 * veritabanından tazelenir, arada bu süreçte kaydedilen her çağrı üstüne
 * eklenir. Aynı anda uçuşta olan çağrılar kadar (her biri en fazla çıktı
 * sınırı kadar) aşım olabilir; bütçe bir sigortadır, fatura değil.
 */

/** Günlük harcamanın veritabanından tazelenme aralığı. */
const SPEND_REFRESH_MS = 30_000;
/** Süreçte tutulan otel harcama kaydı üst sınırı (eski günler zaten ezilir). */
const SPEND_CACHE_MAX_ENTRIES = 10_000;

/** @type {Map<string, { day: string, spent: import('@hotelos/core').Decimal, loadedAt: number }>} */
const spendCache = new Map();

/**
 * Çağrı sırasında ayar değişip modelin fiyatı silinirse maliyet yine
 * sayılsın: çağrıdan önce görülen fiyat hatırlanır.
 * @type {Map<string, object>}
 */
const lastPrices = new Map();

/** @param {Date} day */
const dayKey = (day) => day.toISOString().slice(0, 10);

/**
 * Otelin bu iş günündeki AI harcaması (USD).
 * @param {string} hotelId
 * @param {Date} day iş günü (UTC gün başı)
 */
async function spentOn(hotelId, day) {
  const key = dayKey(day);
  const entry = spendCache.get(hotelId);
  if (entry && entry.day === key && Date.now() - entry.loadedAt < SPEND_REFRESH_MS) return entry.spent;
  const result = await prisma.llmUsage.aggregate({ where: { hotelId, date: day }, _sum: { costUsd: true } });
  const spent = toDecimal(result._sum.costUsd ?? 0);
  if (spendCache.size >= SPEND_CACHE_MAX_ENTRIES && !spendCache.has(hotelId)) {
    spendCache.delete(spendCache.keys().next().value);
  }
  spendCache.set(hotelId, { day: key, spent, loadedAt: Date.now() });
  return spent;
}

/**
 * Model çağrısından önce: AI açık mı, fiyat var mı, bütçe yetiyor mu?
 * @param {string} hotelId
 * @param {string} model
 */
export async function assertCanCall(hotelId, model) {
  const settings = await getAiSettingsCached(hotelId);
  if (!settings.enabled) throw new LlmUnavailableError('AI asistanı bu otelde kapalı', 'DISABLED');
  const price = priceFor(settings.prices, model);
  if (!model || !price) throw new LlmUnavailableError(`"${model || '(seçilmemiş)'}" modelinin fiyatı ayarlarda yok`, 'NO_PRICE');
  lastPrices.set(`${hotelId}:${model}`, price);
  const spent = await spentOn(hotelId, await getBusinessDate(hotelId));
  if (budgetExhausted(spent.toFixed(6), settings.dailyBudgetUsd)) {
    throw new LlmUnavailableError(`Günlük AI bütçesi (${settings.dailyBudgetUsd} USD) doldu`, 'BUDGET');
  }
}

/**
 * Model çağrısından sonra: token kullanımı ve maliyet.
 * @param {{ hotelId: string, actorName: string, model: string, usage: { inputTokens: number, cachedInputTokens?: number, outputTokens: number }, conversationId: string | null }} entry
 */
export async function recordUsage({ hotelId, actorName, model, usage, conversationId }) {
  const settings = await getAiSettingsCached(hotelId);
  const price = priceFor(settings.prices, model) ?? lastPrices.get(`${hotelId}:${model}`) ?? null;
  const costUsd = price ? usageCost(usage, price) : '0.000000';
  const day = await getBusinessDate(hotelId);
  await prismaUnfiltered.llmUsage.create({
    data: {
      hotelId,
      actorName,
      conversationId,
      model,
      tokensIn: Math.max(0, usage.inputTokens ?? 0),
      tokensOut: Math.max(0, usage.outputTokens ?? 0),
      cacheRead: Math.max(0, usage.cachedInputTokens ?? 0),
      costUsd,
      date: day,
    },
  });
  const entry = spendCache.get(hotelId);
  if (entry && entry.day === dayKey(day)) entry.spent = entry.spent.plus(costUsd);
}

/**
 * Ajanlara verilen model bağımlılıkları. Anahtar yoksa istemci yok: ajanlar
 * zaten kaydedilmez (bkz. `lib/actors.js`); kaydedilse de her çağrı
 * "anahtar tanımlı değil" ile personele düşer.
 *
 * @param {{ client?: object | null, env?: NodeJS.ProcessEnv }} [options] testler sahte istemci verir
 */
export function createLlmDeps({ client, env = process.env } = {}) {
  const resolved =
    client !== undefined
      ? client
      : aiKeyConfigured(env)
        ? createOpenAiChatClient({
            apiKey: env.OPENAI_API_KEY.trim(),
            ...(Number(env.OPENAI_TIMEOUT_MS) > 0 ? { timeoutMs: Number(env.OPENAI_TIMEOUT_MS) } : {}),
            ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}),
          })
        : null;
  return { client: resolved, assertCanCall, recordUsage };
}

/** Testler için: süreç içi harcama toplamını unutur. */
export function resetSpendCache() {
  spendCache.clear();
  lastPrices.clear();
}

/* ══════════════════ Kullanım ekranı ══════════════════ */

const money = (value) => toDecimal(value ?? 0).toFixed(6);

/**
 * Son `days` günün AI kullanımı: gün gün, model ve ajan kırılımı, bugünün
 * bütçe durumu. Tek otel, `(hotelId, date)` index'li; gruplar küçük (gün ≤ 90,
 * model ve ajan birkaç tane).
 *
 * @param {string} hotelId
 * @param {{ days: number }} query
 */
export async function getAiUsage(hotelId, { days }) {
  const today = await getBusinessDate(hotelId);
  const from = new Date(today.getTime() - (days - 1) * 86_400_000);
  const where = { hotelId, date: { gte: from, lte: today } };
  const sums = { costUsd: true, tokensIn: true, tokensOut: true, cacheRead: true };
  const [byDay, byModel, byActor, settings] = await Promise.all([
    prisma.llmUsage.groupBy({ by: ['date'], where, _sum: sums, _count: { _all: true }, orderBy: { date: 'asc' } }),
    prisma.llmUsage.groupBy({ by: ['model'], where, _sum: sums, _count: { _all: true }, orderBy: { model: 'asc' } }),
    prisma.llmUsage.groupBy({ by: ['actorName'], where, _sum: { costUsd: true }, _count: { _all: true }, orderBy: { actorName: 'asc' } }),
    getAiSettingsCached(hotelId),
  ]);
  const row = (group) => ({
    calls: group._count._all,
    costUsd: money(group._sum.costUsd),
    tokensIn: group._sum.tokensIn ?? 0,
    tokensOut: group._sum.tokensOut ?? 0,
    cacheRead: group._sum.cacheRead ?? 0,
  });
  const todayRow = byDay.find((group) => dayKey(group.date) === dayKey(today));
  const spent = money(todayRow?._sum.costUsd);
  return {
    from: dayKey(from),
    to: dayKey(today),
    days: byDay.map((group) => ({ date: dayKey(group.date), ...row(group) })),
    byModel: byModel.map((group) => ({ model: group.model, ...row(group) })),
    byActor: byActor.map((group) => ({ actorName: group.actorName, calls: group._count._all, costUsd: money(group._sum.costUsd) })),
    total: {
      calls: byDay.reduce((total, group) => total + group._count._all, 0),
      costUsd: money(byDay.reduce((total, group) => total.plus(toDecimal(group._sum.costUsd ?? 0)), toDecimal(0))),
    },
    today: {
      date: dayKey(today),
      spentUsd: spent,
      budgetUsd: settings.dailyBudgetUsd,
      exhausted: budgetExhausted(spent, settings.dailyBudgetUsd),
    },
  };
}
