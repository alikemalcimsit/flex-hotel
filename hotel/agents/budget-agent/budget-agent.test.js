import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlmUnavailableError } from '@hotelos/actor-kit';
import { COMMENTARY_MAX_CHARS, budgetAgentManifest, buildBudgetMessages, cleanCommentary, createBudgetAgent } from './index.js';

/**
 * Bütçe yorum ajanı: yorum yazılır; AI kullanılamazken, model boş dönünce ya
 * da ajan kapalıyken istek askıda kalmaz ("yazılamadı" ile kapanır). Model
 * sahte (veritabanı ve ağ yok).
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const COMMENTARY = '22222222-2222-4222-8222-222222222222';
const payload = { hotelId: HOTEL, commentaryId: COMMENTARY, budgetId: '33333333-3333-4333-8333-333333333333', year: 2026, month: 9, scope: 'MONTH' };
const envelope = { id: '44444444-4444-4444-8444-444444444444', name: 'budget.commentary.requested', correlationId: 'z', hop: 1 };
const explanation = {
  period: 'Eylül 2026',
  currency: 'TRY',
  totals: { revenue: { plan: '1000.00', actual: '900.00', difference: '-100.00', tone: 'BAD' } },
  topVariances: [{ label: 'Oda geliri', difference: '-100.00', tone: 'BAD' }],
  notes: ['Bazı gider kalemlerinin gerçekleşeni girilmemiş; gider ve brüt faaliyet kârı eksik.'],
};

function harness({ text = 'Eylül 2026 oda geliri planın %10 altında kaldı.', llm = {}, enabled = true, model = 'main-model' } = {}) {
  const calls = { chat: [], completed: [], manualTasks: [], usage: [] };
  const service = {
    model: async () => model,
    explainVariance: async () => explanation,
    completeCommentary: async (hotelId, commentaryId, result) => {
      calls.completed.push({ commentaryId, ...result });
      return true;
    },
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
          return { text, toolCalls: [], usage: { inputTokens: 900, cachedInputTokens: 0, outputTokens: 120 } };
        },
      },
      assertCanCall: async () => {},
      recordUsage: async (entry) => calls.usage.push(entry),
      ...llm,
    },
  };
  return { agent: createBudgetAgent(service, deps), calls };
}

describe('istem ve çıktı', () => {
  it('sistem istemi önde (rakam uydurma yasağı); açıklama JSON olarak', () => {
    const messages = buildBudgetMessages(explanation);
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /yeni rakam hesaplama/);
    assert.deepEqual(JSON.parse(messages[1].content), explanation);
  });

  it('yorum sadeleşir: markdown ve madde işareti ayıklanır, uzunsa cümle sonunda kesilir; boşsa yok', () => {
    assert.equal(cleanCommentary('**Gelir** planın altında.\n- Oda geliri düştü.'), 'Gelir planın altında. Oda geliri düştü.');
    const long = `${'Bu bir cümle. '.repeat(200)}`;
    const cut = cleanCommentary(long);
    assert.ok(cut.length <= COMMENTARY_MAX_CHARS);
    assert.ok(cut.endsWith('.'));
    assert.equal(cleanCommentary('   '), null);
    assert.equal(cleanCommentary(null), null);
  });
});

describe('bütçe yorum ajanı', () => {
  it('bildirge: yorum isteğini dinler, tamamlandı olayını yayınlar; arka planda', () => {
    assert.deepEqual([...budgetAgentManifest.subscribes], ['budget.commentary.requested']);
    assert.deepEqual([...budgetAgentManifest.publishes], ['budget.commentary.completed']);
    assert.equal(budgetAgentManifest.type, 'agent');
    assert.ok(budgetAgentManifest.background);
  });

  it('yorumu yazar: otelin modeli, sınırlı çıktı, kullanım kaydı', async () => {
    const { agent, calls } = harness();
    await agent.handle(payload, envelope);
    assert.equal(calls.chat[0].model, 'main-model');
    assert.ok(calls.chat[0].maxOutputTokens > 0);
    assert.equal(calls.usage.length, 1);
    assert.deepEqual(calls.completed, [{ commentaryId: COMMENTARY, status: 'READY', text: 'Eylül 2026 oda geliri planın %10 altında kaldı.', model: 'main-model' }]);
  });

  it('AI kullanılamıyorsa (bütçe doldu) istek "yazılamadı" ile kapanır; manuel görev açılmaz', async () => {
    const { agent, calls } = harness({
      llm: {
        assertCanCall: async () => {
          throw new LlmUnavailableError('Günlük AI bütçesi doldu', 'BUDGET');
        },
      },
    });
    await agent.handle(payload, envelope);
    assert.equal(calls.completed[0].status, 'FAILED');
    assert.match(calls.completed[0].failureReason, /bütçesi doldu/);
    assert.equal(calls.manualTasks.length, 0);
  });

  it('model seçilmemişse ya da boş dönerse istek askıda kalmaz', async () => {
    const noModel = harness({ model: null });
    await noModel.agent.handle(payload, envelope);
    assert.equal(noModel.calls.chat.length, 0);
    assert.equal(noModel.calls.completed[0].status, 'FAILED');

    const empty = harness({ text: '  ' });
    await empty.agent.handle(payload, envelope);
    assert.equal(empty.calls.completed[0].status, 'FAILED');
  });

  it('ajan kapalıysa iş personele düşer ve istek "yazılamadı" olarak kapanır', async () => {
    const { agent, calls } = harness({ enabled: false });
    await agent.handle(payload, envelope);
    assert.equal(calls.chat.length, 0);
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].title, 'Bütçe sapması elle yorumlanacak (AI yorumu yapılamadı)');
    assert.equal(calls.completed[0].status, 'FAILED');
  });
});
