import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlmUnavailableError } from '@hotelos/actor-kit';
import { MAX_MODEL_CALLS, createReportAgent, reportAgentManifest } from './index.js';

/**
 * Rapor ajanı: raporu araçla görür, cevabı sunar (servis kabul edince biter, reddederse model düzeltir); kapsam dışı
 * soruya metinle döner; döngü sınırı ve AI kullanılamaz durumu soruyu askıda bırakmaz. Model ve servis sahte.
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const QUESTION = '22222222-2222-4222-8222-222222222222';
const payload = { hotelId: HOTEL, questionId: QUESTION, question: 'Geçen ayın haftalık doluluğu' };
const envelope = { id: '44444444-4444-4444-8444-444444444444', name: 'report.question.asked', correlationId: 'z', hop: 1 };
const SPEC = { report: 'OCCUPANCY', period: 'LAST_MONTH', from: null, to: null, groupBy: 'WEEK', forecastDays: null, budgetScope: null };

const call = (id, name, args) => ({ id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const usage = { inputTokens: 500, cachedInputTokens: 0, outputTokens: 60 };

/**
 * @param {{ replies: Array<{ text?: string | null, toolCalls?: object[] }>, accept?: (args: object, attempt: number) => { ok: boolean, error?: string }, llm?: object, model?: string | null, prepared?: object | null }} options
 */
function harness({ replies, accept = () => ({ ok: true }), llm = {}, model = 'ana-model', prepared } = {}) {
  const calls = { chat: [], runData: [], complete: [], fail: [], handOff: [], manualTasks: [], usage: [] };
  let attempts = 0;
  const service = {
    prepare: async () =>
      prepared === undefined
        ? { model, messages: [{ role: 'system', content: 'talimat' }, { role: 'user', content: payload.question }], tools: [{ name: 'run_report' }, { name: 'present_report' }], dataTool: 'run_report', answerTool: 'present_report' }
        : prepared,
    runData: async (hotelId, args) => {
      calls.runData.push(args);
      return { ok: true, result: { columns: ['period', 'occupancyPct'], rows: [['1–7 Eki', 71.4]] } };
    },
    complete: async (hotelId, questionId, answer) => {
      calls.complete.push(answer);
      if (answer.kind === 'TEXT') return { ok: true };
      attempts += 1;
      return accept(answer.args, attempts);
    },
    fail: async (hotelId, questionId, reason, extra) => calls.fail.push({ reason, ...extra }),
    handOff: async (hotelId, questionId, reason) => calls.handOff.push(reason),
  };
  let index = 0;
  const deps = {
    isProcessed: async () => false,
    markProcessed: async () => {},
    isEnabled: async () => true,
    logActivity: async () => {},
    createManualTask: async (task) => calls.manualTasks.push(task),
    sleep: async () => {},
    parseArguments: (text) => {
      try {
        return { ok: true, value: JSON.parse(text) };
      } catch {
        return { ok: false, error: 'Arguments are not valid JSON' };
      }
    },
    llm: {
      client: {
        chat: async (request) => {
          calls.chat.push(request);
          const reply = replies[Math.min(index, replies.length - 1)];
          index += 1;
          return { text: reply.text ?? null, toolCalls: reply.toolCalls ?? [], usage };
        },
      },
      assertCanCall: async () => {},
      recordUsage: async (entry) => calls.usage.push(entry),
      ...llm,
    },
  };
  return { agent: createReportAgent(service, deps), calls };
}

const answerArgs = { title: 'Ekim haftalık doluluk', comment: 'Doluluk ilk hafta %71,4.', spec: SPEC, chart: { type: 'LINE', series: ['occupancyPct'] } };

describe('rapor ajanı', () => {
  it('raporu araçla görür, cevabı sunar; her model çağrısı kullanıma yazılır', async () => {
    const { agent, calls } = harness({
      replies: [{ toolCalls: [call('c1', 'run_report', SPEC)] }, { toolCalls: [call('c2', 'present_report', answerArgs)] }],
    });
    await agent.handle(payload, envelope);
    assert.deepEqual(calls.runData, [SPEC]);
    assert.equal(calls.complete.length, 1);
    assert.deepEqual(calls.complete[0], { kind: 'REPORT', args: answerArgs, model: 'ana-model', modelCalls: 2 });
    assert.equal(calls.usage.length, 2);
    assert.equal(calls.usage[0].actorName, 'report-agent');
    // Aracın sonucu modele araç mesajı olarak döndü.
    const toolMessage = calls.chat[1].messages.find((message) => message.role === 'tool');
    assert.match(toolMessage.content, /71\.4/);
    assert.equal(calls.fail.length + calls.handOff.length, 0);
  });

  it('servis cevabı reddederse hata modele döner, model düzeltir', async () => {
    const { agent, calls } = harness({
      replies: [{ toolCalls: [call('c1', 'present_report', { ...answerArgs, chart: { type: 'LINE', series: ['yok'] } })] }, { toolCalls: [call('c2', 'present_report', answerArgs)] }],
      accept: (_args, attempt) => (attempt === 1 ? { ok: false, error: 'spec.period: Dönem şunlardan biri olmalı' } : { ok: true }),
    });
    await agent.handle(payload, envelope);
    assert.equal(calls.complete.length, 2);
    const feedback = calls.chat[1].messages.at(-1);
    assert.equal(feedback.role, 'tool');
    assert.match(feedback.content, /Dönem şunlardan biri olmalı/);
    assert.equal(calls.fail.length, 0);
  });

  it('kapsam dışı soru metinle cevaplanır; bozuk JSON argümanı modele hata olarak döner', async () => {
    const { agent, calls } = harness({
      replies: [{ toolCalls: [call('c1', 'run_report', '{bozuk')] }, { text: 'Restoran satışları için rapor yok; doluluk, gelir, tahmin ve bütçe raporlarını hazırlayabilirim.' }],
    });
    await agent.handle(payload, envelope);
    assert.match(calls.chat[1].messages.at(-1).content, /not valid JSON/);
    assert.equal(calls.complete.at(-1).kind, 'TEXT');
    assert.match(calls.complete.at(-1).text, /Restoran satışları/);
  });

  it(`model ${MAX_MODEL_CALLS} çağrıda bitiremezse soru "cevaplanamadı" olur (askıda kalmaz)`, async () => {
    const { agent, calls } = harness({ replies: [{ toolCalls: [call('c', 'run_report', SPEC)] }] });
    await agent.handle(payload, envelope);
    assert.equal(calls.chat.length, MAX_MODEL_CALLS);
    assert.equal(calls.fail.length, 1);
    assert.match(calls.fail[0].reason, /çok adımlı/);
    assert.equal(calls.fail[0].modelCalls, MAX_MODEL_CALLS);
  });

  it('AI kullanılamıyorsa (bütçe bitti) ya da model seçilmemişse soru personele devredilir', async () => {
    const budget = harness({
      replies: [{ text: 'x' }],
      llm: {
        assertCanCall: async () => {
          throw new LlmUnavailableError('Günlük AI bütçesi doldu', 'BUDGET');
        },
      },
    });
    await budget.agent.handle(payload, envelope);
    assert.equal(budget.calls.handOff.length, 1);
    assert.match(budget.calls.handOff[0], /bütçesi doldu/);
    assert.equal(budget.calls.chat.length, 0);

    const noModel = harness({ replies: [{ text: 'x' }], model: null });
    await noModel.agent.handle(payload, envelope);
    assert.deepEqual(noModel.calls.handOff, ['AI modeli seçilmemiş.']);

    const answered = harness({ replies: [{ text: 'x' }], prepared: null });
    await answered.agent.handle(payload, envelope);
    assert.equal(answered.calls.chat.length, 0, 'cevaplanmış soru yeniden işlenmez');
  });

  it('kapalıyken iş rapor talebi görevine düşer (başlık sorudan) ve soru kapanır', async () => {
    const calls = { fail: [], manualTasks: [] };
    const disabled = createReportAgent(
      { prepare: async () => null, runData: async () => ({ ok: true }), complete: async () => ({ ok: true }), fail: async (h, q, reason) => calls.fail.push({ reason }), handOff: async () => {} },
      {
        isProcessed: async () => false,
        markProcessed: async () => {},
        isEnabled: async () => false,
        logActivity: async () => {},
        createManualTask: async (task) => calls.manualTasks.push(task),
        sleep: async () => {},
        parseArguments: () => ({ ok: true, value: {} }),
        llm: { client: { chat: async () => ({}) }, assertCanCall: async () => {}, recordUsage: async () => {} },
      },
    );
    await disabled.handle(payload, envelope);
    assert.equal(calls.manualTasks.length, 1);
    assert.equal(calls.manualTasks[0].module, reportAgentManifest.fallbackModule);
    assert.equal(calls.manualTasks[0].title, 'Rapor talebi: "Geçen ayın haftalık doluluğu"');
    assert.match(calls.fail[0].reason, /rapor talebi olarak personele/);
  });
});
