import { BaseLlmAgent, isLlmUnavailable } from '@hotelos/actor-kit';
import { pricingAgentManifest } from './manifest.js';
import { MAX_OUTPUT_TOKENS, buildPricingMessages, parseAgentSuggestions } from './prompt.js';

/**
 * Dinamik fiyat ajanı (modül 34). Servisi dışarıdan alır (paket Prisma bilmez):
 *
 * @typedef {{
 *   model: (hotelId: string) => Promise<string | null>,
 *   reviewInputs: (hotelId: string, window: { businessDate: string, horizonDays: number }) => Promise<object>,
 *   submitSuggestions: (hotelId: string, proposals: object[]) => Promise<{ created: number, skipped: number }>,
 * }} PricingService
 *
 * Fiyatı kendisi değiştirmez: önerileri kural işiyle aynı kapıdan
 * (`createSuggestions` → M11 onayı) girer. Model yoksa ya da AI kapalıysa iş
 * sessizce biter — kural tabanlı yield bağımsız çalışıyor; kimse fiyatsız
 * kalmaz.
 */
class PricingAgent extends BaseLlmAgent {
  #service;

  /**
   * @param {PricingService} service
   * @param {object} deps `BaseLlmAgent` bağımlılıkları (`llm` dahil)
   */
  constructor(service, deps) {
    super(pricingAgentManifest, { 'pricing.review.requested': (payload) => this.#review(payload) }, deps);
    this.#service = service;
  }

  /** @param {{ hotelId: string, businessDate: string, horizonDays: number }} payload */
  async #review(payload) {
    const { hotelId, businessDate, horizonDays } = payload;
    const model = await this.#service.model(hotelId);
    if (!model) return { message: 'AI modeli seçilmemiş; fiyat değerlendirmesi kural tabanlı yield ile sınırlı' };

    const inputs = await this.#service.reviewInputs(hotelId, { businessDate, horizonDays });
    if (inputs.days.length === 0) return { message: 'Eşiklere yakın gün yok; öneri üretilmedi' };

    let result;
    try {
      result = await this.callModel(hotelId, {
        model,
        messages: buildPricingMessages(inputs),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        cacheKey: `pricing:${hotelId}`,
        safetyId: `${hotelId}:${businessDate}`,
      });
    } catch (error) {
      if (!isLlmUnavailable(error)) throw error;
      return { message: `AI kullanılamıyor (${error.message}); kural tabanlı yield çalışmaya devam ediyor`, meta: { reason: error.reason } };
    }

    const { accepted, dropped } = parseAgentSuggestions(result.text, inputs);
    if (accepted.length === 0) {
      return {
        message: dropped > 0 ? `Model ${dropped} geçersiz öneri verdi; hiçbiri kuyruğa alınmadı` : 'Model öneri üretmedi',
        meta: { dropped },
      };
    }
    const outcome = await this.#service.submitSuggestions(
      hotelId,
      accepted.map((row) => ({ ...row, source: 'AGENT' })),
    );
    return {
      message: `${outcome.created} fiyat önerisi onaya düşürüldü${dropped > 0 ? ` (${dropped} geçersiz satır elendi)` : ''}`,
      meta: { model, ...outcome, dropped },
    };
  }

  describeFallback(eventName) {
    if (eventName === 'pricing.review.requested') {
      return 'AI fiyat değerlendirmesi yapılamadı (kural tabanlı yield çalışmaya devam ediyor)';
    }
    return super.describeFallback(eventName);
  }
}

/**
 * @param {PricingService} service
 * @param {object} deps
 */
export function createPricingAgent(service, deps) {
  return new PricingAgent(service, deps);
}

export { pricingAgentManifest };
export { MAX_AGENT_SUGGESTIONS, MAX_OUTPUT_TOKENS, PRICING_SYSTEM_PROMPT, buildPricingMessages, parseAgentSuggestions } from './prompt.js';
