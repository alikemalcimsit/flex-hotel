import { BaseLlmAgent, isLlmUnavailable } from '@hotelos/actor-kit';
import { budgetAgentManifest } from './manifest.js';
import { MAX_OUTPUT_TOKENS, buildBudgetMessages, cleanCommentary } from './prompt.js';

/**
 * Bütçe yorum ajanı. Servisi dışarıdan alır (paket Prisma bilmez):
 *
 * @typedef {{
 *   model: (hotelId: string) => Promise<string | null>,
 *   explainVariance: (hotelId: string, query: { year: number, month: number, scope: 'MONTH' | 'YTD' }) => Promise<object>,
 *   completeCommentary: (hotelId: string, commentaryId: string, result: object) => Promise<boolean>,
 * }} BudgetService
 */
class BudgetAgent extends BaseLlmAgent {
  #service;

  /**
   * @param {BudgetService} service
   * @param {object} deps `BaseLlmAgent` bağımlılıkları (`llm` dahil)
   */
  constructor(service, deps) {
    super(budgetAgentManifest, { 'budget.commentary.requested': (payload) => this.#comment(payload) }, deps);
    this.#service = service;
  }

  /** @param {{ hotelId: string, commentaryId: string, year: number, month: number, scope: 'MONTH' | 'YTD' }} payload */
  async #comment(payload) {
    const { hotelId, commentaryId, year, month, scope } = payload;
    const model = await this.#service.model(hotelId);
    if (!model) {
      await this.#service.completeCommentary(hotelId, commentaryId, { status: 'FAILED', failureReason: 'AI modeli seçilmemiş.' });
      return { message: 'AI modeli seçilmemiş; yorum yapılmadı' };
    }
    const explanation = await this.#service.explainVariance(hotelId, { year, month, scope });

    let result;
    try {
      result = await this.callModel(hotelId, {
        model,
        messages: buildBudgetMessages(explanation),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        cacheKey: `budget:${hotelId}`,
        safetyId: commentaryId,
      });
    } catch (error) {
      if (!isLlmUnavailable(error)) throw error;
      await this.#service.completeCommentary(hotelId, commentaryId, { status: 'FAILED', failureReason: error.message, model });
      return { message: `AI kullanılamıyor (${error.message}); yorum yapılmadı`, meta: { reason: error.reason } };
    }

    const text = cleanCommentary(result.text);
    if (!text) {
      await this.#service.completeCommentary(hotelId, commentaryId, { status: 'FAILED', failureReason: 'Model boş cevap verdi; tekrar isteyebilirsiniz.', model });
      return { message: 'Model boş cevap verdi' };
    }
    await this.#service.completeCommentary(hotelId, commentaryId, { status: 'READY', text, model });
    return { message: `${explanation.period} bütçe yorumu yazıldı`, meta: { model, chars: text.length } };
  }

  /**
   * Ajan kapalı ya da hata verdi (iş personele düştü): bekleyen istek
   * "yazılamadı" olarak kapanır; ekran askıda kalmaz, kullanıcı yeniden ister.
   */
  async afterFallback(payload, _envelope, reason) {
    if (payload.commentaryId) {
      await this.#service.completeCommentary(payload.hotelId, payload.commentaryId, { status: 'FAILED', failureReason: `Yorum yapılamadı: ${reason}` });
    }
  }

  describeFallback(eventName) {
    if (eventName === 'budget.commentary.requested') return 'Bütçe sapması elle yorumlanacak (AI yorumu yapılamadı)';
    return super.describeFallback(eventName);
  }
}

/**
 * @param {BudgetService} service
 * @param {object} deps
 */
export function createBudgetAgent(service, deps) {
  return new BudgetAgent(service, deps);
}

export { budgetAgentManifest };
export { BUDGET_SYSTEM_PROMPT, COMMENTARY_MAX_CHARS, MAX_OUTPUT_TOKENS, buildBudgetMessages, cleanCommentary } from './prompt.js';
