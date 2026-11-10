import { BaseLlmAgent, isLlmUnavailable } from '@hotelos/actor-kit';
import { insightAgentManifest } from './manifest.js';
import {
  ANALYSIS_MAX_OUTPUT_TOKENS,
  INSIGHT_MAX_OUTPUT_TOKENS,
  analysisSchema,
  buildAnalysisMessages,
  buildInsightMessages,
  insightSchema,
  parseAnalysis,
  parseInsight,
} from './prompt.js';

/**
 * Geri bildirim ajanı. Servisi dışarıdan alır (paket Prisma bilmez):
 *
 * @typedef {{
 *   model: (hotelId: string) => Promise<string | null>,
 *   analysisInput: (hotelId: string, responseId: string) => Promise<{ pending: boolean, kind: string, language: string, npsScore: number | null, ratingAverage: number | null, comment: string | null, topics: string[], sentiments: string[] }>,
 *   completeAnalysis: (hotelId: string, responseId: string, result: object) => Promise<boolean>,
 *   insightInput: (hotelId: string, insightId: string) => Promise<{ pending: boolean, kind: string, period: object, stats: object, comments: object[], responseCount: number }>,
 *   completeInsight: (hotelId: string, insightId: string, result: object) => Promise<boolean>,
 *   sentiments: string[],
 * }} InsightService
 */
class InsightAgent extends BaseLlmAgent {
  #service;

  /** @param {InsightService} service @param {object} deps `BaseLlmAgent` bağımlılıkları (`llm` dahil) */
  constructor(service, deps) {
    super(
      insightAgentManifest,
      {
        'survey.analysis.requested': (payload) => this.#analyze(payload),
        'survey.insight.requested': (payload) => this.#summarize(payload),
      },
      deps,
    );
    this.#service = service;
  }

  /** @param {{ hotelId: string, responseId: string }} payload */
  async #analyze({ hotelId, responseId }) {
    const input = await this.#service.analysisInput(hotelId, responseId);
    if (!input.pending) return { message: 'Cevap zaten etiketlenmiş' };
    const model = await this.#service.model(hotelId);
    if (!model || !input.comment) {
      await this.#service.completeAnalysis(hotelId, responseId, { status: 'FAILED', model });
      return { message: model ? 'Yorum yok; etiketlenmedi' : 'AI modeli seçilmemiş; etiketlenmedi' };
    }
    let result;
    try {
      result = await this.callModel(hotelId, {
        model,
        messages: buildAnalysisMessages(/** @type {any} */ (input)),
        maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
        responseSchema: analysisSchema(input.topics, input.sentiments),
        cacheKey: `insight:analysis:${hotelId}`,
        safetyId: responseId,
      });
    } catch (error) {
      if (!isLlmUnavailable(error)) throw error;
      await this.#service.completeAnalysis(hotelId, responseId, { status: 'FAILED', model });
      return { message: `AI kullanılamıyor (${error.message}); etiketlenmedi`, meta: { reason: error.reason } };
    }
    const parsed = parseAnalysis(result.text, input);
    if (!parsed) {
      await this.#service.completeAnalysis(hotelId, responseId, { status: 'FAILED', model });
      return { message: 'Model geçersiz cevap verdi' };
    }
    await this.#service.completeAnalysis(hotelId, responseId, { status: 'DONE', ...parsed, model });
    return { message: `Yorum etiketlendi (${parsed.sentiment})`, meta: { model, topics: parsed.topics.length } };
  }

  /** @param {{ hotelId: string, insightId: string }} payload */
  async #summarize({ hotelId, insightId }) {
    const input = await this.#service.insightInput(hotelId, insightId);
    if (!input.pending) return { message: 'Özet zaten kapanmış' };
    const model = await this.#service.model(hotelId);
    if (!model) {
      await this.#service.completeInsight(hotelId, insightId, { status: 'FAILED', failureReason: 'AI modeli seçilmemiş.' });
      return { message: 'AI modeli seçilmemiş; özet yazılmadı' };
    }
    if (!input.comments.length) {
      await this.#service.completeInsight(hotelId, insightId, { status: 'FAILED', failureReason: 'Dönemde yorum yok.', model });
      return { message: 'Dönemde yorum yok' };
    }
    let result;
    try {
      result = await this.callModel(hotelId, {
        model,
        messages: buildInsightMessages(input),
        maxOutputTokens: INSIGHT_MAX_OUTPUT_TOKENS,
        responseSchema: insightSchema(this.#service.sentiments),
        cacheKey: `insight:summary:${hotelId}`,
        safetyId: insightId,
      });
    } catch (error) {
      if (!isLlmUnavailable(error)) throw error;
      await this.#service.completeInsight(hotelId, insightId, { status: 'FAILED', failureReason: error.message, model });
      return { message: `AI kullanılamıyor (${error.message}); özet yazılmadı`, meta: { reason: error.reason } };
    }
    const parsed = parseInsight(result.text, { sentiments: this.#service.sentiments });
    if (!parsed) {
      await this.#service.completeInsight(hotelId, insightId, { status: 'FAILED', failureReason: 'Model boş ya da geçersiz cevap verdi; tekrar isteyebilirsiniz.', model });
      return { message: 'Model geçersiz cevap verdi' };
    }
    await this.#service.completeInsight(hotelId, insightId, { status: 'READY', ...parsed, model, responseCount: input.responseCount });
    return { message: `Dönem özeti yazıldı (${parsed.themes.length} tema)`, meta: { model, comments: input.comments.length } };
  }

  /**
   * Ajan kapalı ya da hata verdi (iş personele düştü): bekleyen istek "yapılamadı" olarak kapanır, ekran askıda kalmaz.
   */
  async afterFallback(payload, envelope, reason) {
    if (envelope?.name === 'survey.analysis.requested' && payload.responseId) await this.#service.completeAnalysis(payload.hotelId, payload.responseId, { status: 'FAILED' });
    if (envelope?.name === 'survey.insight.requested' && payload.insightId) await this.#service.completeInsight(payload.hotelId, payload.insightId, { status: 'FAILED', failureReason: `Özet yazılamadı: ${reason}` });
  }

  describeFallback(eventName) {
    if (eventName === 'survey.analysis.requested') return 'Anket yorumu elle okunacak (AI etiketi yapılamadı)';
    if (eventName === 'survey.insight.requested') return 'Anket dönem özeti elle çıkarılacak (AI özeti yapılamadı)';
    return super.describeFallback(eventName);
  }
}

/** @param {InsightService} service @param {object} deps */
export function createInsightAgent(service, deps) {
  return new InsightAgent(service, deps);
}

export { insightAgentManifest };
export * from './prompt.js';
