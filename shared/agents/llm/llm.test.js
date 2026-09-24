import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { budgetExhausted, createOpenAiChatClient, parseToolArguments, priceFor, usageCost } from './index.js';

/**
 * Model katmanı: maliyet (para-kritik, bütçe buna göre denetlenir) ve OpenAI
 * adaptörünün gerçek SDK üzerinden kurduğu istek / okuduğu cevap. Ağa
 * çıkılmaz: SDK'ya sahte `fetch` verilir.
 */

const PRICE = { input: '0.40', cachedInput: '0.10', output: '1.60' };

describe('maliyet', () => {
  it('önbellekten okunan girdi indirimli sayılır; toplam yukarı yuvarlanır', () => {
    // 1000 girdi (400'ü önbellekten), 200 çıktı:
    // 600 × 0.40/1e6 + 400 × 0.10/1e6 + 200 × 1.60/1e6 = 0.00024 + 0.00004 + 0.00032 = 0.0006
    assert.equal(usageCost({ inputTokens: 1000, cachedInputTokens: 400, outputTokens: 200 }, PRICE), '0.000600');
    // 1 token × 0.40/1e6 = 0.0000004 → yukarı: 0.000001 (bütçe eksik sayılmaz)
    assert.equal(usageCost({ inputTokens: 1, outputTokens: 0 }, PRICE), '0.000001');
  });

  it('önbellek sayısı girdiden büyük gelirse girdiyle sınırlanır', () => {
    assert.equal(usageCost({ inputTokens: 100, cachedInputTokens: 500, outputTokens: 0 }, PRICE), '0.000010');
  });

  it('bütçe: harcanan ≥ bütçe ise biter; bütçe 0 ise AI kapalı sayılır', () => {
    assert.equal(budgetExhausted('4.999999', '5'), false);
    assert.equal(budgetExhausted('5.000000', '5'), true);
    assert.equal(budgetExhausted('0', '0'), true);
  });

  it('fiyatı ayarlanmamış ya da bozuk model için fiyat yok', () => {
    assert.deepEqual(priceFor({ 'model-a': PRICE }, 'model-a'), PRICE);
    assert.equal(priceFor({ 'model-a': PRICE }, 'model-b'), null);
    assert.equal(priceFor({ 'model-a': { ...PRICE, output: 'abc' } }, 'model-a'), null);
    assert.equal(priceFor({ 'model-a': { ...PRICE, output: '-1' } }, 'model-a'), null);
  });
});

describe('araç argümanları', () => {
  it('JSON nesnesi okunur; bozuk ya da nesne olmayan reddedilir', () => {
    assert.deepEqual(parseToolArguments('{"a":1}'), { ok: true, value: { a: 1 } });
    assert.equal(parseToolArguments('{"a":').ok, false);
    assert.equal(parseToolArguments('[1]').ok, false);
    assert.deepEqual(parseToolArguments(''), { ok: true, value: {} });
  });
});

/**
 * SDK'nın çağıracağı sahte fetch: istekleri kaydeder, sıradaki cevabı döner.
 * @param {Array<{ status?: number, body: object, headers?: Record<string, string> }>} responses
 */
function fakeFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) });
    const next = responses.shift();
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
    });
  };
  return { fetch, calls };
}

const completion = (message, usage = {}) => ({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  model: 'model-x',
  choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', ...message } }],
  usage: { prompt_tokens: 1200, completion_tokens: 40, total_tokens: 1240, prompt_tokens_details: { cached_tokens: 1024 }, ...usage },
});

describe('OpenAI adaptörü', () => {
  it('istek: araçlar katı şemalı, paralel araç kapalı, önbellek anahtarı ve üst sınır gönderilir', async () => {
    const { fetch, calls } = fakeFetch([{ body: completion({ content: 'Merhaba' }) }]);
    const client = createOpenAiChatClient({ apiKey: 'test-key', fetch });
    const result = await client.chat({
      model: 'model-x',
      messages: [
        { role: 'system', content: 'Sen bir otel asistanısın' },
        { role: 'user', content: 'Merhaba' },
        { role: 'assistant', content: null, toolCalls: [{ id: 'call_1', name: 'check', arguments: '{"a":1}' }] },
        { role: 'tool', toolCallId: 'call_1', content: '{"ok":true}' },
      ],
      tools: [{ name: 'check', description: 'Kontrol', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }],
      maxOutputTokens: 500,
      cacheKey: 'hotel:1:concierge',
    });

    const [call] = calls;
    assert.match(call.url, /\/chat\/completions$/);
    assert.equal(call.headers.get('authorization'), 'Bearer test-key');
    assert.equal(call.body.model, 'model-x');
    assert.equal(call.body.max_completion_tokens, 500);
    assert.equal(call.body.prompt_cache_key, 'hotel:1:concierge');
    assert.equal(call.body.parallel_tool_calls, false);
    assert.equal(call.body.tools[0].function.strict, true);
    assert.deepEqual(call.body.messages[2].tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'check', arguments: '{"a":1}' } }]);
    assert.deepEqual(call.body.messages[3], { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' });

    assert.equal(result.text, 'Merhaba');
    assert.deepEqual(result.usage, { inputTokens: 1200, cachedInputTokens: 1024, outputTokens: 40 });
  });

  it('cevap: araç çağrıları okunur; yapılandırılmış çıktı json_schema ile istenir', async () => {
    const { fetch, calls } = fakeFetch([
      { body: completion({ content: null, tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'x', arguments: '{"b":2}' } }] }) },
    ]);
    const client = createOpenAiChatClient({ apiKey: 'k', fetch });
    const result = await client.chat({
      model: 'model-x',
      messages: [{ role: 'user', content: 'x' }],
      responseSchema: { name: 'intent', schema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    });
    assert.equal(calls[0].body.response_format.type, 'json_schema');
    assert.equal(calls[0].body.response_format.json_schema.strict, true);
    assert.deepEqual(result.toolCalls, [{ id: 'call_2', name: 'x', arguments: '{"b":2}' }]);
    assert.equal(result.finishReason, 'tool_calls');
  });

  it('hatalar: hız sınırı ve 5xx tekrar denenir; kota, anahtar ve hatalı istek denenmez; SDK kendisi tekrar denemez', async () => {
    const error = (status, code = null) => ({ status, body: { error: { message: 'x', type: 'x', code } } });
    const cases = [
      [error(429), { retryable: true, code: 'RATE_LIMIT' }],
      [error(429, 'insufficient_quota'), { retryable: false, code: 'QUOTA' }],
      [error(503), { retryable: true, code: 'PROVIDER_5XX' }],
      [error(401), { retryable: false, code: 'AUTH' }],
      [error(400, 'invalid_value'), { retryable: false, code: 'invalid_value' }],
    ];
    for (const [response, expected] of cases) {
      const { fetch, calls } = fakeFetch([response, response, response]);
      const client = createOpenAiChatClient({ apiKey: 'k', fetch });
      await assert.rejects(client.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }), (err) => {
        assert.equal(err.name, 'LlmProviderError');
        assert.equal(err.retryable, expected.retryable, `${response.status} ${expected.code}`);
        assert.equal(err.code, expected.code);
        return true;
      });
      assert.equal(calls.length, 1, 'SDK kendi başına tekrar denememeli (aktör tabanı dener)');
    }
  });

  it('bağlantı kurulamazsa tekrar denenebilir hata', async () => {
    const client = createOpenAiChatClient({
      apiKey: 'k',
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await assert.rejects(client.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }), { retryable: true, code: 'CONNECTION' });
  });

  it('anahtar yoksa istemci kurulmaz', () => {
    assert.throws(() => createOpenAiChatClient({ apiKey: '' }), /API anahtarı/);
  });
});
