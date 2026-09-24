import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlmUnavailableError } from '@hotelos/actor-kit';
import { ROUTER_SCHEMA, buildRouterMessages, createRouterAgent, parseRouterOutput, routerAgentManifest } from './index.js';

/**
 * Router ajanı: mesajın niyeti, teklif onayı ve AI kullanılamazken konuşmanın
 * personele alınması. Model sahte (veritabanı ve ağ yok).
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '33333333-3333-4333-8333-333333333333';
const payload = (overrides = {}) => ({ hotelId: HOTEL, conversationId: CONVERSATION, messageId: MESSAGE, channel: 'WEBCHAT', guestId: null, mode: 'AI', ...overrides });
const envelope = { id: '44444444-4444-4444-8444-444444444444', name: 'guest.message.received', correlationId: 'z', hop: 1 };

describe('çıktı okuma', () => {
  it('geçerli çıktı olduğu gibi; güven 0..1 aralığına kırpılır; dil küçük harf', () => {
    const out = parseRouterOutput('{"intent":"RESERVATION","confidence":1.4,"language":"TR","affirmative":false}', { hasPendingOffer: false });
    assert.deepEqual(out, { intent: 'RESERVATION', confidence: 1, language: 'tr', affirmative: false, valid: true });
  });

  it('bozuk ya da şema dışı çıktı "diğer" sayılır; dil önceki dilden', () => {
    assert.deepEqual(parseRouterOutput('olmadı', { hasPendingOffer: true, fallbackLanguage: 'de' }), {
      intent: 'OTHER',
      confidence: 0,
      language: 'de',
      affirmative: false,
      valid: false,
    });
    assert.equal(parseRouterOutput('{"intent":"BOOK","confidence":0.9,"language":"en","affirmative":true}', { hasPendingOffer: true }).intent, 'OTHER');
  });

  it('bekleyen teklif yoksa model "onay" dese de onay sayılmaz', () => {
    const text = '{"intent":"RESERVATION","confidence":0.9,"language":"tr","affirmative":true}';
    assert.equal(parseRouterOutput(text, { hasPendingOffer: false }).affirmative, false);
    assert.equal(parseRouterOutput(text, { hasPendingOffer: true }).affirmative, true);
  });

  it('istem: sabit sistem mesajı önde, misafir metni JSON alanı olarak sonda ve kırpılmış', () => {
    const messages = buildRouterMessages({ text: 'x'.repeat(5000), pendingOffer: 'Standart oda 15-18 Ekim, 9000 TRY', lastAssistantMessage: null });
    assert.equal(messages[0].role, 'system');
    const input = JSON.parse(messages[1].content);
    assert.equal(input.message.length, 1500);
    assert.equal(input.pendingOffer, 'Standart oda 15-18 Ekim, 9000 TRY');
    assert.deepEqual(ROUTER_SCHEMA.schema.required, ['intent', 'confidence', 'language', 'affirmative']);
  });
});

function harness({ context, llmText, llm = {}, enabled = true } = {}) {
  const calls = { intents: [], handoffs: [], chat: [], manualTasks: [], usage: [] };
  const service = {
    loadMessage: async () =>
      context === undefined
        ? { conversationId: CONVERSATION, mode: 'AI', status: 'OPEN', text: 'evet ayırın', language: 'tr', pendingOffer: 'Standart oda', lastAssistantMessage: 'Onaylıyor musunuz?' }
        : context,
    settings: async () => ({ routerModel: 'small-model' }),
    recordIntent: async (hotelId, intent) => calls.intents.push(intent),
    handOff: async (hotelId, conversationId, handoff) => calls.handoffs.push(handoff),
  };
  const deps = {
    isProcessed: async () => false,
    markProcessed: async () => {},
    isEnabled: async () => enabled,
    logActivity: async () => {},
    createManualTask: async (task) => calls.manualTasks.push(task),
    sleep: async () => {},
    llm: {
      client: {
        chat: async (request) => {
          calls.chat.push(request);
          return { text: llmText ?? '{"intent":"RESERVATION","confidence":0.95,"language":"tr","affirmative":true}', toolCalls: [], usage: { inputTokens: 300, cachedInputTokens: 256, outputTokens: 20 } };
        },
      },
      assertCanCall: async () => {},
      recordUsage: async (entry) => calls.usage.push(entry),
      ...llm,
    },
  };
  return { agent: createRouterAgent(service, deps), calls };
}

describe('router ajanı', () => {
  it('bildirge: mesajı dinler, niyeti yayınlar', () => {
    assert.deepEqual([...routerAgentManifest.subscribes], ['guest.message.received']);
    assert.deepEqual([...routerAgentManifest.publishes], ['guest.intent.detected']);
    assert.equal(routerAgentManifest.type, 'agent');
  });

  it('AI konuşmasında niyeti belirler; küçük model, katı şema, otel başına önbellek anahtarı', async () => {
    const { agent, calls } = harness();
    await agent.handle(payload(), envelope);
    assert.equal(calls.chat[0].model, 'small-model');
    assert.equal(calls.chat[0].responseSchema.name, 'guest_intent');
    assert.equal(calls.chat[0].cacheKey, `router:${HOTEL}`);
    assert.deepEqual(calls.intents, [{ conversationId: CONVERSATION, messageId: MESSAGE, intent: 'RESERVATION', confidence: 0.95, language: 'tr', affirmative: true }]);
    assert.equal(calls.usage.length, 1);
  });

  it('personeldeki ya da bu arada personele alınmış konuşmada model çağrılmaz', async () => {
    const manual = harness();
    assert.equal(manual.agent.accepts('guest.message.received', payload({ mode: 'MANUAL' })), false);
    assert.equal(manual.agent.accepts('guest.message.received', payload()), true);
    await manual.agent.handle(payload({ mode: 'MANUAL' }), envelope);
    assert.equal(manual.calls.chat.length, 0);

    const taken = harness({ context: { conversationId: CONVERSATION, mode: 'MANUAL', status: 'OPEN', text: 'x', pendingOffer: null } });
    await taken.agent.handle(payload(), envelope);
    assert.equal(taken.calls.chat.length, 0);
    assert.equal(taken.calls.intents.length, 0);
  });

  it('bütçe dolunca konuşma personele devredilir; manuel görev açılmaz (konuşma zaten "cevap bekliyor")', async () => {
    const { agent, calls } = harness({
      llm: {
        assertCanCall: async () => {
          throw new LlmUnavailableError('Günlük AI bütçesi doldu', 'BUDGET');
        },
      },
    });
    await agent.handle(payload(), envelope);
    assert.deepEqual(calls.handoffs, [{ reason: 'BUDGET', detail: 'Günlük AI bütçesi doldu' }]);
    assert.equal(calls.manualTasks.length, 0);
    assert.equal(calls.intents.length, 0);
  });

  it('ajan kapalıysa iş personele düşer ve konuşma AI modunda bırakılmaz', async () => {
    const { agent, calls } = harness({ enabled: false });
    await agent.handle(payload(), envelope);
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].title, 'Misafir mesajı elle cevaplanacak (AI devre dışı)');
    assert.equal(calls.handoffs[0].reason, 'AGENT_FAILED');
  });
});
