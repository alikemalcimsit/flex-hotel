import { BaseWorker } from './base-worker.js';

/**
 * LLM ajanlarının ortak tabanı.
 *
 * `BaseWorker`'ın verdiği her şey (tekrar işlememek, kapalıyken işi personele
 * düşürmek, yeniden denemek, iz bırakmak) burada da geçerli. Üstüne model
 * çağrısının üç kuralı eklenir — her ajan bunları kendi yazarsa biri
 * mutlaka unutur:
 *
 * 1. **Önce izin:** çağrıdan önce otelin AI'ı açık mı, modelin fiyatı tanımlı
 *    mı, günlük bütçe yetiyor mu (`deps.llm.assertCanCall`). Değilse
 *    `LlmUnavailableError` — tekrar denenmez; ajan konuşmayı personele alır.
 * 2. **Sonra kayıt:** her çağrının token kullanımı ve maliyeti hemen yazılır
 *    (`deps.llm.recordUsage`). İşleyicinin geri kalanı hata verse de para
 *    harcandı; bütçe bunu görmeli.
 * 3. **Sağlayıcı hatası:** hız sınırı / geçici hata tekrar denenir (aktör
 *    tabanı dener); anahtar geçersiz, kota bitti gibi kalıcı hatalar
 *    `LlmUnavailableError`'a çevrilir.
 *
 * Altyapıyı bilmez: model istemcisi, ayar, bütçe ve kayıt `deps.llm` ile verilir.
 */

/** Model kullanılamıyor (kapalı, anahtar yok, bütçe bitti, fiyat yok, sağlayıcı kalıcı hata). */
export class LlmUnavailableError extends Error {
  /**
   * @param {string} message kullanıcıya / personele gösterilebilir
   * @param {'DISABLED' | 'NOT_CONFIGURED' | 'BUDGET' | 'NO_PRICE' | 'PROVIDER'} reason
   */
  constructor(message, reason) {
    super(message);
    this.name = 'LlmUnavailableError';
    this.reason = reason;
    this.retryable = false;
  }
}

/** @param {unknown} error */
export const isLlmUnavailable = (error) => error instanceof LlmUnavailableError;

export class BaseLlmAgent extends BaseWorker {
  #llm;
  #actorName;

  /**
   * @param {ReturnType<import('./manifest.js').defineActor>} manifest
   * @param {Record<string, Function>} handlers
   * @param {object & {
   *   llm: {
   *     client: { chat: (request: object) => Promise<{ usage: object }> } | null,
   *     assertCanCall: (hotelId: string, model: string) => Promise<void>,
   *     recordUsage: (entry: { hotelId: string, actorName: string, model: string, usage: object, conversationId: string | null }) => Promise<void>,
   *   },
   * }} deps
   */
  constructor(manifest, handlers, deps) {
    if (!deps?.llm) throw new Error(`"${manifest.name}" bir LLM ajanı; deps.llm verilmeli`);
    super(manifest, handlers, deps);
    this.#llm = deps.llm;
    this.#actorName = manifest.name;
  }

  /**
   * Modeli çağırır (izin → çağrı → kayıt).
   * @param {string} hotelId
   * @param {object & { model: string }} request sağlayıcı adaptörünün `chat` isteği
   * @param {{ conversationId?: string | null }} [context] kullanımın ait olduğu konuşma (maliyet dökümü için)
   */
  async callModel(hotelId, request, context = {}) {
    if (!this.#llm.client) {
      throw new LlmUnavailableError('Sunucuda AI anahtarı tanımlı değil', 'NOT_CONFIGURED');
    }
    await this.#llm.assertCanCall(hotelId, request.model);

    let result;
    try {
      result = await this.#llm.client.chat(request);
    } catch (error) {
      if (error?.retryable === false) {
        throw new LlmUnavailableError(`AI sağlayıcısı kullanılamıyor: ${error.message}`, 'PROVIDER');
      }
      throw error;
    }

    await this.#llm.recordUsage({
      hotelId,
      actorName: this.#actorName,
      model: request.model,
      usage: result.usage,
      conversationId: context.conversationId ?? null,
    });
    return result;
  }
}
