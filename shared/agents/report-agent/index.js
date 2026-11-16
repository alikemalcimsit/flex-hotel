import { BaseLlmAgent, isLlmUnavailable } from '@hotelos/actor-kit';
import { runQuestion } from './graph.js';
import { reportAgentManifest } from './manifest.js';

/**
 * Rapor ajanı. Servisi dışarıdan alır (paket Prisma ve rapor bilmez):
 *
 * @typedef {{
 *   prepare: (hotelId: string, questionId: string) => Promise<null | { model: string | null, messages: object[], tools: object[], dataTool: string, answerTool: string }>,
 *   runData: (hotelId: string, args: object) => Promise<{ ok: true, result: object } | { ok: false, error: string }>,
 *   complete: (hotelId: string, questionId: string, answer: object) => Promise<{ ok: true } | { ok: false, error: string }>,
 *   fail: (hotelId: string, questionId: string, reason: string, extra?: { model?: string | null, modelCalls?: number }) => Promise<void>,
 *   handOff: (hotelId: string, questionId: string, reason: string) => Promise<void>,
 * }} ReportService
 */
class ReportAgent extends BaseLlmAgent {
  #service;
  #parseArguments;

  /**
   * @param {ReportService} service
   * @param {object & { parseArguments: Function }} deps `BaseLlmAgent` bağımlılıkları (`llm` dahil) + araç argümanı ayrıştırıcı
   */
  constructor(service, deps) {
    super(reportAgentManifest, { 'report.question.asked': (payload) => this.#answer(payload) }, deps);
    if (!deps.parseArguments) throw new Error('report-agent: deps.parseArguments verilmeli');
    this.#service = service;
    this.#parseArguments = deps.parseArguments;
  }

  /** @param {{ hotelId: string, questionId: string }} payload */
  async #answer({ hotelId, questionId }) {
    const prepared = await this.#service.prepare(hotelId, questionId);
    if (!prepared) return { message: 'Soru artık beklemiyor; atlandı' };
    const { model } = prepared;
    if (!model) {
      await this.#service.handOff(hotelId, questionId, 'AI modeli seçilmemiş.');
      return { message: 'AI modeli seçilmemiş; soru rapor talebi olarak personele iletildi' };
    }

    let modelCalls = 0;
    const turn = {
      hotelId,
      questionId,
      model,
      tools: prepared.tools,
      dataTool: prepared.dataTool,
      answerTool: prepared.answerTool,
      callModel: async (request) => {
        modelCalls += 1;
        return this.callModel(hotelId, request);
      },
      runData: (args) => this.#service.runData(hotelId, args),
      submitAnswer: (args, calls) => this.#service.complete(hotelId, questionId, { kind: 'REPORT', args, model, modelCalls: calls }),
      parseArguments: this.#parseArguments,
    };

    let state;
    try {
      state = await runQuestion(turn, prepared.messages);
    } catch (error) {
      if (!isLlmUnavailable(error)) throw error;
      await this.#service.handOff(hotelId, questionId, `AI kullanılamıyor: ${error.message}.`);
      return { message: `AI kullanılamıyor (${error.message}); soru rapor talebi olarak personele iletildi`, meta: { reason: error.reason, modelCalls } };
    }

    const { outcome } = state;
    const meta = { model, modelCalls, tools: state.toolLog.map((entry) => `${entry.tool}:${entry.ok ? 'ok' : 'hata'}`) };
    if (outcome.kind === 'REPORT') return { message: 'Rapor cevabı yazıldı', meta };
    if (outcome.kind === 'TEXT') {
      await this.#service.complete(hotelId, questionId, { kind: 'TEXT', text: outcome.text, model, modelCalls });
      return { message: 'Soru raporsuz (metinle) cevaplandı', meta };
    }
    await this.#service.fail(hotelId, questionId, outcome.reason, { model, modelCalls });
    return { message: `Soru cevaplanamadı: ${outcome.reason}`, meta };
  }

  /** Ajan kapalı ya da hata verdi (iş personele düştü): soru "cevaplanamadı" olarak kapanır; ekran askıda kalmaz. */
  async afterFallback(payload, _envelope, reason) {
    if (payload.questionId) {
      await this.#service.fail(payload.hotelId, payload.questionId, `Rapor ajanı cevaplayamadı (${reason}); sorunuz rapor talebi olarak personele iletildi.`);
    }
  }

  describeFallback(eventName, payload) {
    if (eventName === 'report.question.asked') return `Rapor talebi: "${String(payload?.question ?? '').slice(0, 120)}"`;
    return super.describeFallback(eventName, payload);
  }
}

/**
 * @param {ReportService} service
 * @param {object} deps
 */
export function createReportAgent(service, deps) {
  return new ReportAgent(service, deps);
}

export { reportAgentManifest };
export { MAX_MODEL_CALLS, MAX_OUTPUT_TOKENS, runQuestion } from './graph.js';
