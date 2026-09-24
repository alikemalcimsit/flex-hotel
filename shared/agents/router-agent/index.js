import { BaseLlmAgent, isLlmUnavailable } from '@hotelos/actor-kit';
import { routerAgentManifest } from './manifest.js';
import { ROUTER_SCHEMA, buildRouterMessages, parseRouterOutput } from './prompt.js';

/** Sınıflandırma kısa bir JSON; üst sınır maliyeti tutar. */
const MAX_OUTPUT_TOKENS = 120;

/**
 * Router ajanı. Servisi dışarıdan alır (paket Prisma bilmez):
 *
 * @typedef {{
 *   loadMessage: (hotelId: string, messageId: string) => Promise<null | {
 *     conversationId: string, mode: 'AI' | 'MANUAL', status: 'OPEN' | 'CLOSED', text: string,
 *     language: string | null, pendingOffer: string | null, lastAssistantMessage: string | null,
 *   }>,
 *   settings: (hotelId: string) => Promise<{ routerModel: string }>,
 *   recordIntent: (hotelId: string, intent: object) => Promise<void>,
 *   handOff: (hotelId: string, conversationId: string, handoff: { reason: string, detail?: string }) => Promise<void>,
 * }} RouterService
 */
class RouterAgent extends BaseLlmAgent {
  #service;

  /**
   * @param {RouterService} service
   * @param {object} deps `BaseLlmAgent` bağımlılıkları (`llm` dahil)
   */
  constructor(service, deps) {
    super(
      routerAgentManifest,
      {
        'guest.message.received': (payload) => this.#route(payload),
      },
      deps,
    );
    this.#service = service;
  }

  /** @param {{ hotelId: string, conversationId: string, messageId: string, mode: string }} payload */
  async #route(payload) {
    // Personeldeki konuşmaya AI karışmaz (event gövdesi yayın anındaki modu taşır).
    if (payload.mode !== 'AI') return { message: 'Konuşma personelde; sınıflandırılmadı' };

    const context = await this.#service.loadMessage(payload.hotelId, payload.messageId);
    // Bu arada personele alınmış ya da kapanmış olabilir.
    if (!context || context.mode !== 'AI' || context.status !== 'OPEN') {
      return { message: 'Konuşma artık AI modunda değil; sınıflandırılmadı' };
    }

    let result;
    try {
      const { routerModel } = await this.#service.settings(payload.hotelId);
      result = await this.callModel(payload.hotelId, {
        model: routerModel,
        messages: buildRouterMessages(context),
        responseSchema: ROUTER_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        cacheKey: `router:${payload.hotelId}`,
        safetyId: context.conversationId,
      }, { conversationId: context.conversationId });
    } catch (error) {
      if (!isLlmUnavailable(error)) throw error;
      await this.#service.handOff(payload.hotelId, context.conversationId, { reason: error.reason, detail: error.message });
      return { message: `AI kullanılamıyor (${error.message}); konuşma personele devredildi`, meta: { reason: error.reason } };
    }

    const intent = parseRouterOutput(result.text, {
      hasPendingOffer: Boolean(context.pendingOffer),
      fallbackLanguage: context.language ?? 'tr',
    });
    await this.#service.recordIntent(payload.hotelId, {
      conversationId: context.conversationId,
      messageId: payload.messageId,
      intent: intent.intent,
      confidence: intent.confidence,
      language: intent.language,
      affirmative: intent.affirmative,
    });
    return {
      message: `Niyet: ${intent.intent}${intent.affirmative ? ' (teklif onaylandı)' : ''}${intent.valid ? '' : ' — model çıktısı okunamadı, "diğer" sayıldı'}`,
      meta: { intent: intent.intent, confidence: intent.confidence, language: intent.language, affirmative: intent.affirmative },
    };
  }

  /** Yalnızca AI modundaki konuşmanın mesajı (personeldeki konuşmaya AI karışmaz). */
  accepts(_eventName, payload) {
    return payload.mode === 'AI';
  }

  /**
   * Ajan kapalı ya da hata verdi: konuşma AI modunda kalırsa misafir cevapsız
   * bekler. Personele alınır (iş zaten manuel göreve düştü).
   */
  async afterFallback(payload, _envelope, reason) {
    if (payload.conversationId && payload.mode === 'AI') {
      await this.#service.handOff(payload.hotelId, payload.conversationId, { reason: 'AGENT_FAILED', detail: reason });
    }
  }

  describeFallback(eventName) {
    if (eventName === 'guest.message.received') return 'Misafir mesajı elle cevaplanacak (AI devre dışı)';
    return super.describeFallback(eventName);
  }
}

/**
 * @param {RouterService} service
 * @param {object} deps
 */
export function createRouterAgent(service, deps) {
  return new RouterAgent(service, deps);
}

export { routerAgentManifest };
export { INTENTS, ROUTER_SCHEMA, buildRouterMessages, parseRouterOutput } from './prompt.js';
