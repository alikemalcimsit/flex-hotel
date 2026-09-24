import { LlmUnavailableError } from '@hotelos/actor-kit';
import { toDecimal } from '@hotelos/core';
import { budgetExhausted, createOpenAiChatClient, priceFor, usageCost } from '@hotelos/llm';
import { prisma, prismaUnfiltered } from '../../db.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { SQL_NOW } from '../../lib/sql-time.js';
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
 *
 * Tazeleme de, kullanım ekranları da çağrı satırlarını (`LlmUsage`, büyük
 * otelde günde on binlerce) değil günlük özeti (`LlmUsageDaily`: gün × ajan ×
 * model) okur. Özet, çağrı kaydedilirken aynı transaction'da artırılır.
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
  const result = await prisma.llmUsageDaily.aggregate({ where: { hotelId, date: day }, _sum: { costUsd: true } });
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
  const tokensIn = Math.max(0, usage.inputTokens ?? 0);
  const tokensOut = Math.max(0, usage.outputTokens ?? 0);
  const cacheRead = Math.max(0, usage.cachedInputTokens ?? 0);
  // Çağrı satırı ve günlük özet birlikte: özet hiçbir zaman satırlardan sapmaz.
  await prismaUnfiltered.$transaction([
    prismaUnfiltered.llmUsage.create({
      data: { hotelId, actorName, conversationId, model, tokensIn, tokensOut, cacheRead, costUsd, date: day },
    }),
    prismaUnfiltered.$executeRaw`
      INSERT INTO "LlmUsageDaily" ("hotelId", "date", "actorName", "model", "calls", "tokensIn", "tokensOut",
                                   "cacheRead", "costUsd", "updatedAt")
      VALUES (${hotelId}, CAST(${dayKey(day)} AS date), ${actorName}, ${model}, 1, ${tokensIn}, ${tokensOut},
              ${cacheRead}, CAST(${costUsd} AS numeric), ${SQL_NOW})
      ON CONFLICT ("hotelId", "date", "actorName", "model")
      DO UPDATE SET "calls" = "LlmUsageDaily"."calls" + 1,
                    "tokensIn" = "LlmUsageDaily"."tokensIn" + EXCLUDED."tokensIn",
                    "tokensOut" = "LlmUsageDaily"."tokensOut" + EXCLUDED."tokensOut",
                    "cacheRead" = "LlmUsageDaily"."cacheRead" + EXCLUDED."cacheRead",
                    "costUsd" = "LlmUsageDaily"."costUsd" + EXCLUDED."costUsd",
                    "updatedAt" = EXCLUDED."updatedAt"`,
  ]);
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

/* ══════════════════ Kullanım ekranları ══════════════════ */

const money = (value) => toDecimal(value ?? 0).toFixed(6);
/** Özetteki token toplamı (`BigInt`) → sayı; günlük toplamlar güvenli tamsayı aralığında. */
const tokens = (value) => Number(value ?? 0);

/**
 * Son `days` iş günü: `[from, today]` (UTC gün başları).
 * @param {string} hotelId
 * @param {number} days
 */
async function usageWindow(hotelId, days) {
  const today = await getBusinessDate(hotelId);
  const from = new Date(today.getTime() - (days - 1) * 86_400_000);
  return { today, from };
}

/**
 * Son `days` günün AI kullanımı: gün gün, model ve ajan kırılımı, bugünün
 * bütçe durumu. Günlük özetten okunur: satır sayısı gün × ajan × model
 * (90 günde birkaç yüz), çağrı sayısından bağımsız.
 *
 * @param {string} hotelId
 * @param {{ days: number }} query
 */
export async function getAiUsage(hotelId, { days }) {
  const { today, from } = await usageWindow(hotelId, days);
  const where = { hotelId, date: { gte: from, lte: today } };
  const sums = { calls: true, costUsd: true, tokensIn: true, tokensOut: true, cacheRead: true };
  const [byDay, byModel, byActor, settings] = await Promise.all([
    prisma.llmUsageDaily.groupBy({ by: ['date'], where, _sum: sums, orderBy: { date: 'asc' } }),
    prisma.llmUsageDaily.groupBy({ by: ['model'], where, _sum: sums, orderBy: { model: 'asc' } }),
    prisma.llmUsageDaily.groupBy({
      by: ['actorName'],
      where,
      _sum: { calls: true, costUsd: true },
      orderBy: { actorName: 'asc' },
    }),
    getAiSettingsCached(hotelId),
  ]);
  const row = (group) => ({
    calls: group._sum.calls ?? 0,
    costUsd: money(group._sum.costUsd),
    tokensIn: tokens(group._sum.tokensIn),
    tokensOut: tokens(group._sum.tokensOut),
    cacheRead: tokens(group._sum.cacheRead),
  });
  const todayRow = byDay.find((group) => dayKey(group.date) === dayKey(today));
  const spent = money(todayRow?._sum.costUsd);
  return {
    from: dayKey(from),
    to: dayKey(today),
    days: byDay.map((group) => ({ date: dayKey(group.date), ...row(group) })),
    byModel: byModel.map((group) => ({ model: group.model, ...row(group) })),
    byActor: byActor.map((group) => ({
      actorName: group.actorName,
      calls: group._sum.calls ?? 0,
      costUsd: money(group._sum.costUsd),
    })),
    total: {
      calls: byDay.reduce((total, group) => total + (group._sum.calls ?? 0), 0),
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

/**
 * Bir ajanın son `days` günü (aktör paneli, modül 12): gün gün çağrı, token
 * ve maliyet; bugün ajanın ve otelin toplam harcaması (bütçe otel geneli,
 * ajanlar paylaşır). `(hotelId, actorName, date)` index'inden okunur.
 *
 * @param {string} hotelId
 * @param {string} actorName
 * @param {{ days: number }} query
 */
export async function getAgentUsage(hotelId, actorName, { days }) {
  const { today, from } = await usageWindow(hotelId, days);
  const [rows, hotelToday, settings] = await Promise.all([
    prisma.llmUsageDaily.findMany({
      where: { hotelId, actorName, date: { gte: from, lte: today } },
      orderBy: [{ date: 'asc' }, { model: 'asc' }],
      select: { date: true, model: true, calls: true, tokensIn: true, tokensOut: true, cacheRead: true, costUsd: true },
    }),
    prisma.llmUsageDaily.aggregate({ where: { hotelId, date: today }, _sum: { costUsd: true } }),
    getAiSettingsCached(hotelId),
  ]);
  return summarizeAgentUsage(rows, {
    from,
    today,
    hotelSpentToday: money(hotelToday._sum.costUsd),
    budgetUsd: settings.dailyBudgetUsd,
  });
}

/**
 * Ajanın günlük özet satırlarını karta çevirir: eksik günler sıfırla
 * doldurulur (çubuklar boşluksuz), model kırılımı toplanır. Saf fonksiyon;
 * tutarlar kuruş kaybı olmadan `Decimal` ile toplanır.
 *
 * @param {Array<{ date: Date, model: string, calls: number, tokensIn: bigint | number, tokensOut: bigint | number, cacheRead: bigint | number, costUsd: unknown }>} rows
 * @param {{ from: Date, today: Date, hotelSpentToday: string, budgetUsd: string }} context
 */
export function summarizeAgentUsage(rows, { from, today, hotelSpentToday, budgetUsd }) {
  const zero = () => ({ calls: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cost: toDecimal(0) });
  const byDay = new Map();
  for (let at = from.getTime(); at <= today.getTime(); at += 86_400_000) byDay.set(dayKey(new Date(at)), zero());
  const byModel = new Map();
  for (const row of rows) {
    const cost = toDecimal(row.costUsd ?? 0);
    const day = byDay.get(dayKey(row.date));
    if (day) {
      day.calls += row.calls;
      day.tokensIn += tokens(row.tokensIn);
      day.tokensOut += tokens(row.tokensOut);
      day.cacheRead += tokens(row.cacheRead);
      day.cost = day.cost.plus(cost);
    }
    const model = byModel.get(row.model) ?? { calls: 0, cost: toDecimal(0) };
    model.calls += row.calls;
    model.cost = model.cost.plus(cost);
    byModel.set(row.model, model);
  }
  const days = [...byDay.entries()].map(([date, day]) => ({
    date,
    calls: day.calls,
    tokensIn: day.tokensIn,
    tokensOut: day.tokensOut,
    cacheRead: day.cacheRead,
    costUsd: day.cost.toFixed(6),
  }));
  const todayRow = byDay.get(dayKey(today)) ?? zero();
  const totalCost = [...byDay.values()].reduce((total, day) => total.plus(day.cost), toDecimal(0));
  const totalCalls = days.reduce((total, day) => total + day.calls, 0);
  return {
    from: dayKey(from),
    to: dayKey(today),
    days,
    byModel: [...byModel.entries()]
      .map(([model, value]) => ({ model, calls: value.calls, costUsd: value.cost.toFixed(6) }))
      .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
    total: {
      calls: totalCalls,
      costUsd: totalCost.toFixed(6),
      avgCostPerCallUsd: totalCalls > 0 ? totalCost.div(totalCalls).toFixed(6) : money(0),
    },
    today: {
      date: dayKey(today),
      calls: todayRow.calls,
      agentSpentUsd: todayRow.cost.toFixed(6),
      hotelSpentUsd: hotelSpentToday,
      budgetUsd,
      exhausted: budgetExhausted(hotelSpentToday, budgetUsd),
    },
  };
}
