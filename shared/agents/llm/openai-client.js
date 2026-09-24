import OpenAI from 'openai';

/**
 * OpenAI sohbet adaptörü (Chat Completions, resmi SDK).
 *
 * Ajanlar sağlayıcıyı bilmez; bu dosyanın sunduğu `chat()` arayüzünü
 * kullanır. Başka bir sağlayıcıya geçmek yeni bir adaptör yazmaktır.
 *
 * ### Neden böyle
 *
 * - **Yeniden deneme SDK'da kapalı** (`maxRetries: 0`): aktör tabanı
 *   (`BaseWorker`) zaten geri çekilerek dener. İkisi birden denerse bir mesaj
 *   için 3 × 3 = 9 çağrı yapılır, bütçe sessizce erir.
 * - **Önbellek:** OpenAI uzun istemlerin sabit başını kendiliğinden önbelleğe
 *   alır. İstemler "sabit önce, değişken sonra" dizilir (ajanların işi) ve
 *   `prompt_cache_key` aynı otelin isteklerini aynı önbelleğe yönlendirir.
 * - **Katı şema:** araçlar ve yapılandırılmış çıktı `strict: true` — model
 *   şemaya uymayan argüman üretemez; yine de sunucu tarafında doğrulanır.
 *
 * @typedef {{ id: string, name: string, arguments: string }} ToolCall
 * @typedef {{ role: 'system' | 'user' | 'assistant' | 'tool', content: string | null, toolCalls?: ToolCall[], toolCallId?: string }} ChatMessage
 * @typedef {{ name: string, description: string, parameters: object }} ToolSpec
 * @typedef {{ inputTokens: number, cachedInputTokens: number, outputTokens: number }} Usage
 * @typedef {{
 *   model: string,
 *   messages: ChatMessage[],
 *   tools?: ToolSpec[],
 *   responseSchema?: { name: string, schema: object },
 *   maxOutputTokens?: number,
 *   cacheKey?: string,
 *   safetyId?: string,
 * }} ChatRequest
 * @typedef {{ text: string | null, toolCalls: ToolCall[], usage: Usage, model: string, finishReason: string | null, refusal: string | null }} ChatResult
 */

/** İstek başına üst süre. Misafir cevap bekliyor; takılan çağrı yeniden denenir. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Sağlayıcı hatası. `retryable`: aynı çağrıyı biraz sonra tekrar denemek
 * düzeltebilir mi (hız sınırı, geçici sunucu hatası, zaman aşımı)?
 */
export class LlmProviderError extends Error {
  /**
   * @param {string} message
   * @param {{ retryable: boolean, status?: number | null, code?: string | null, cause?: unknown }} details
   */
  constructor(message, { retryable, status = null, code = null, cause } = {}) {
    super(message, { cause });
    this.name = 'LlmProviderError';
    this.retryable = retryable;
    this.status = status;
    this.code = code;
  }
}

/**
 * SDK hatasını sınıflandırır.
 * @param {unknown} error
 * @returns {LlmProviderError}
 */
export function classifyProviderError(error) {
  if (error instanceof LlmProviderError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new LlmProviderError('Model zamanında cevap vermedi', { retryable: true, code: 'TIMEOUT', cause: error });
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new LlmProviderError('Model sağlayıcısına bağlanılamadı', { retryable: true, code: 'CONNECTION', cause: error });
  }
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? null;
    if (status === 401 || status === 403) {
      return new LlmProviderError('API anahtarı geçersiz ya da yetkisiz', { retryable: false, status, code: 'AUTH', cause: error });
    }
    if (status === 429) {
      // Kota bitti (insufficient_quota) tekrar denemekle düzelmez; hız sınırı düzelir.
      const quota = error.code === 'insufficient_quota';
      return new LlmProviderError(quota ? 'Sağlayıcı hesabının kotası bitti' : 'Sağlayıcı hız sınırı', {
        retryable: !quota,
        status,
        code: quota ? 'QUOTA' : 'RATE_LIMIT',
        cause: error,
      });
    }
    if (status !== null && status >= 500) {
      return new LlmProviderError('Sağlayıcıda geçici hata', { retryable: true, status, code: 'PROVIDER_5XX', cause: error });
    }
    return new LlmProviderError(`Sağlayıcı isteği reddetti: ${error.message}`, {
      retryable: false,
      status,
      code: error.code ?? 'BAD_REQUEST',
      cause: error,
    });
  }
  return new LlmProviderError(error instanceof Error ? error.message : 'Bilinmeyen model hatası', {
    retryable: false,
    code: 'UNKNOWN',
    cause: error,
  });
}

/** @param {ChatMessage} message */
function toOpenAiMessage(message) {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content ?? '' };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content ?? '' };
}

/**
 * İstek gövdesi (saf; testte doğrulanır).
 * @param {ChatRequest} request
 */
export function buildChatBody(request) {
  const body = {
    model: request.model,
    messages: request.messages.map(toOpenAiMessage),
  };
  if (request.maxOutputTokens) body.max_completion_tokens = request.maxOutputTokens;
  if (request.cacheKey) body.prompt_cache_key = request.cacheKey;
  if (request.safetyId) body.safety_identifier = request.safetyId;
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: true },
    }));
    body.parallel_tool_calls = false;
  }
  if (request.responseSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: request.responseSchema.name, schema: request.responseSchema.schema, strict: true },
    };
  }
  return body;
}

/**
 * Cevabı sağlayıcıdan bağımsız biçime çevirir (saf).
 * @param {any} completion
 * @returns {ChatResult}
 */
export function readCompletion(completion) {
  const choice = completion?.choices?.[0];
  if (!choice) throw new LlmProviderError('Model boş cevap döndü', { retryable: true, code: 'EMPTY' });
  const message = choice.message ?? {};
  const usage = completion.usage ?? {};
  return {
    text: typeof message.content === 'string' ? message.content : null,
    toolCalls: (message.tool_calls ?? [])
      .filter((call) => call.type === 'function')
      .map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments ?? '{}' })),
    usage: {
      inputTokens: usage.prompt_tokens ?? 0,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
    },
    model: completion.model ?? null,
    finishReason: choice.finish_reason ?? null,
    refusal: message.refusal ?? null,
  };
}

/**
 * @param {{ apiKey: string, timeoutMs?: number, fetch?: typeof fetch, baseURL?: string }} options
 * @returns {{ provider: 'openai', chat: (request: ChatRequest) => Promise<ChatResult> }}
 */
export function createOpenAiChatClient({ apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetch, baseURL } = {}) {
  if (!apiKey) throw new Error('OpenAI API anahtarı verilmedi');
  const sdk = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0, ...(fetch ? { fetch } : {}), ...(baseURL ? { baseURL } : {}) });
  return {
    provider: 'openai',
    async chat(request) {
      let completion;
      try {
        completion = await sdk.chat.completions.create(buildChatBody(request));
      } catch (error) {
        throw classifyProviderError(error);
      }
      return readCompletion(completion);
    },
  };
}
