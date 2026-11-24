import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlmUnavailableError } from '@hotelos/actor-kit';
import { buildAnalysisMessages, createInsightAgent, insightAgentManifest, parseAnalysis, parseInsight } from './index.js';

/**
 * Geri bildirim ajanı: yorum etiketlenir, dönem özeti yazılır; AI kullanılamazken, model bozuk dönünce ya da ajan
 * kapalıyken istek askıda kalmaz. Model sahte (veritabanı ve ağ yok).
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const RESPONSE = '22222222-2222-4222-8222-222222222222';
const INSIGHT = '33333333-3333-4333-8333-333333333333';
const TOPICS = ['OVERALL', 'ROOM', 'CLEANLINESS', 'STAFF', 'FOOD_BEVERAGE', 'OTHER'];
const SENTIMENTS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'MIXED'];
const envelopeOf = (name) => ({ id: '44444444-4444-4444-8444-444444444444', name, correlationId: 'z', hop: 1 });

function harness({ text, llm = {}, enabled = true, model = 'main-model', pending = true, comment = 'Kahvaltı harikaydı ama oda çok gürültülüydü.' } = {}) {
  const calls = { chat: [], analysis: [], insight: [], manualTasks: [] };
  const service = {
    sentiments: SENTIMENTS,
    model: async () => model,
    analysisInput: async () => ({ pending, kind: 'POST_STAY', language: 'tr', npsScore: 6, ratingAverage: 3.2, comment, topics: TOPICS, sentiments: SENTIMENTS }),
    completeAnalysis: async (_hotelId, responseId, result) => calls.analysis.push({ responseId, ...result }),
    insightInput: async () => ({ pending, kind: 'POST_STAY', period: { from: '2026-10-01', to: '2026-10-31' }, stats: { responses: 40, nps: 35 }, comments: comment ? [{ nps: 9, text: comment }] : [], responseCount: 40 }),
    completeInsight: async (_hotelId, insightId, result) => calls.insight.push({ insightId, ...result }),
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
          return { text, toolCalls: [], usage: { inputTokens: 500, cachedInputTokens: 0, outputTokens: 80 } };
        },
      },
      assertCanCall: async () => {},
      recordUsage: async () => {},
      ...llm,
    },
  };
  return { agent: createInsightAgent(service, deps), calls };
}

describe('istem ve ayrıştırma', () => {
  it('etiket isteği kişisel veri taşımaz: yalnız puan, dil ve yorum', () => {
    const messages = buildAnalysisMessages({ kind: 'POST_STAY', language: 'de', npsScore: 4, ratingAverage: 2.5, comment: 'Zimmer laut', topics: TOPICS });
    assert.equal(messages[0].role, 'system');
    assert.deepEqual(Object.keys(JSON.parse(messages[1].content)).sort(), ['allowedTopics', 'comment', 'language', 'nps', 'rating', 'survey']);
  });

  it('etiket: liste dışı konu ve tekrar düşer, en fazla beş; geçersiz duygu ya da bozuk JSON → yok', () => {
    const parsed = parseAnalysis(JSON.stringify({ sentiment: 'MIXED', topics: ['ROOM', 'ROOM', 'PARKING', 'FOOD_BEVERAGE'], summary: '  **Kahvaltı** iyi,   oda gürültülü. ' }), { topics: TOPICS, sentiments: SENTIMENTS });
    assert.deepEqual(parsed, { sentiment: 'MIXED', topics: ['ROOM', 'FOOD_BEVERAGE'], summary: 'Kahvaltı iyi, oda gürültülü.' });
    assert.equal(parseAnalysis(JSON.stringify({ sentiment: 'ANGRY', topics: [], summary: 'x' }), { topics: TOPICS, sentiments: SENTIMENTS }), null);
    assert.equal(parseAnalysis('bozuk', { topics: TOPICS, sentiments: SENTIMENTS }), null);
  });

  it('dönem özeti: tema en fazla altı, pay 0–100 aralığına çekilir, öneri en fazla üç; özet boşsa yok', () => {
    const themes = Array.from({ length: 8 }, (_, index) => ({ title: `Tema ${index}`, sentiment: index % 2 ? 'NEGATIVE' : 'BOGUS', share: index === 0 ? 140 : 12.6, quote: 'alıntı' }));
    const parsed = parseInsight(JSON.stringify({ summary: 'NPS 35.', themes, actions: ['a', 'b', 'c', 'd'] }), { sentiments: SENTIMENTS });
    assert.equal(parsed.themes.length, 6);
    assert.deepEqual([parsed.themes[0].share, parsed.themes[0].sentiment, parsed.themes[1].share], [100, 'NEUTRAL', 13]);
    assert.equal(parsed.actions.length, 3);
    assert.equal(parseInsight(JSON.stringify({ summary: '  ', themes: [], actions: [] }), { sentiments: SENTIMENTS }), null);
  });
});

describe('geri bildirim ajanı', () => {
  it('bildirge: etiket ve özet isteklerini dinler, arka planda', () => {
    assert.deepEqual([...insightAgentManifest.subscribes], ['survey.analysis.requested', 'survey.insight.requested']);
    assert.equal(insightAgentManifest.type, 'agent');
    assert.ok(insightAgentManifest.background);
  });

  it('yorumu etiketler: otelin modeli, şemalı çıktı, sınırlı token', async () => {
    const { agent, calls } = harness({ text: JSON.stringify({ sentiment: 'MIXED', topics: ['FOOD_BEVERAGE', 'NOISE', 'ROOM'], summary: 'Kahvaltı övülmüş, oda gürültüsünden şikâyet.' }) });
    await agent.handle({ hotelId: HOTEL, responseId: RESPONSE }, envelopeOf('survey.analysis.requested'));
    assert.equal(calls.chat[0].model, 'main-model');
    assert.equal(calls.chat[0].responseSchema.name, 'feedback_analysis');
    assert.ok(calls.chat[0].maxOutputTokens > 0);
    assert.deepEqual(calls.analysis, [{ responseId: RESPONSE, status: 'DONE', sentiment: 'MIXED', topics: ['FOOD_BEVERAGE', 'ROOM'], summary: 'Kahvaltı övülmüş, oda gürültüsünden şikâyet.', model: 'main-model' }]);
  });

  it('dönem özetini yazar; etiketlenmiş / kapanmış istek ikinci kez işlenmez', async () => {
    const { agent, calls } = harness({ text: JSON.stringify({ summary: 'Dönemde NPS 35.', themes: [{ title: 'Kahvaltı', sentiment: 'POSITIVE', share: 40, quote: 'harika' }], actions: ['Gürültü yalıtımı'] }) });
    await agent.handle({ hotelId: HOTEL, insightId: INSIGHT }, envelopeOf('survey.insight.requested'));
    assert.equal(calls.insight[0].status, 'READY');
    assert.equal(calls.insight[0].responseCount, 40);
    assert.equal(calls.insight[0].themes[0].title, 'Kahvaltı');

    const done = harness({ pending: false, text: '{}' });
    await done.agent.handle({ hotelId: HOTEL, responseId: RESPONSE }, envelopeOf('survey.analysis.requested'));
    assert.deepEqual([done.calls.chat.length, done.calls.analysis.length], [0, 0]);
  });

  it('AI kullanılamıyorsa, model seçilmemişse ya da bozuk dönerse istek "yapılamadı" ile kapanır; manuel görev açılmaz', async () => {
    const budget = harness({ llm: { assertCanCall: async () => { throw new LlmUnavailableError('Günlük AI bütçesi doldu', 'BUDGET'); } } });
    await budget.agent.handle({ hotelId: HOTEL, insightId: INSIGHT }, envelopeOf('survey.insight.requested'));
    assert.equal(budget.calls.insight[0].status, 'FAILED');
    assert.match(budget.calls.insight[0].failureReason, /bütçesi doldu/);
    assert.equal(budget.calls.manualTasks.length, 0);

    const noModel = harness({ model: null });
    await noModel.agent.handle({ hotelId: HOTEL, responseId: RESPONSE }, envelopeOf('survey.analysis.requested'));
    assert.deepEqual([noModel.calls.chat.length, noModel.calls.analysis[0].status], [0, 'FAILED']);

    const broken = harness({ text: 'yarım { json' });
    await broken.agent.handle({ hotelId: HOTEL, responseId: RESPONSE }, envelopeOf('survey.analysis.requested'));
    assert.equal(broken.calls.analysis[0].status, 'FAILED');
  });

  it('ajan kapalıysa istek "yapılamadı" olarak kapanır, ekran askıda kalmaz', async () => {
    const { agent, calls } = harness({ enabled: false });
    await agent.handle({ hotelId: HOTEL, insightId: INSIGHT }, envelopeOf('survey.insight.requested'));
    assert.equal(calls.chat.length, 0);
    assert.equal(calls.insight[0].status, 'FAILED');
  });
});
