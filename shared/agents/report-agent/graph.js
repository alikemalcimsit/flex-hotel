import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

/**
 * Rapor sorusunun turu (LangGraph).
 *
 * ```
 * START → agent ──(araç çağrısı)──→ tools ──→ agent … ──(cevap sunuldu / metin)──→ END
 * ```
 *
 * - `agent`: model çağrısı (izin, bütçe ve kullanım kaydı `callModel`'da).
 * - `tools`: veri aracı (raporu çalıştır) sonucu modele döner; cevap aracı ("cevabı sun") servis kabul ederse tur
 *   biter, reddederse (geçersiz tanım / seri) hata modele döner — model düzeltir.
 * - Model çağrısı soru başına `MAX_MODEL_CALLS` ile sınırlı (sonsuz araç döngüsü faturayı büyütmesin).
 *
 * Paket ürün bilmez: talimat, araç şemaları, veri aracı ve cevabın kabulü servisten (`turn`) gelir.
 */

/** Soru başına en fazla model çağrısı. */
export const MAX_MODEL_CALLS = 6;
/** Tek çağrının çıktı sınırı (yorum + tanım). */
export const MAX_OUTPUT_TOKENS = 900;
/** Metin cevabın üst sınırı. */
export const MAX_TEXT_ANSWER_LENGTH = 800;

const replace = (_previous, next) => next;

export const QuestionState = Annotation.Root({
  messages: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
  modelCalls: Annotation({ reducer: replace, default: () => 0 }),
  /** Tur sonucu: `{ kind: 'REPORT' }` (servis kabul etti), `{ kind: 'TEXT', text }` ya da `{ kind: 'GIVE_UP', reason }`. */
  outcome: Annotation({ reducer: replace, default: () => null }),
  toolLog: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

/**
 * @typedef {{
 *   hotelId: string,
 *   questionId: string,
 *   model: string,
 *   tools: object[],
 *   dataTool: string,
 *   answerTool: string,
 *   callModel: (request: object) => Promise<{ text: string | null, toolCalls: Array<{ id: string, name: string, arguments: string }> }>,
 *   runData: (args: object) => Promise<{ ok: true, result: object } | { ok: false, error: string }>,
 *   submitAnswer: (args: object, modelCalls: number) => Promise<{ ok: true } | { ok: false, error: string }>,
 *   parseArguments: (text: string) => { ok: boolean, value?: object, error?: string },
 * }} Turn
 */

/** @param {import('@langchain/langgraph').LangGraphRunnableConfig} config @returns {Turn} */
const turnOf = (config) => config.configurable.turn;

async function agentNode(state, config) {
  const turn = turnOf(config);
  if (state.modelCalls >= MAX_MODEL_CALLS) {
    return { outcome: { kind: 'GIVE_UP', reason: 'Soru çok adımlı oldu; daha açık sorabilirsiniz (ör. hangi dönem, hangi rapor).' } };
  }
  const result = await turn.callModel({
    model: turn.model,
    messages: state.messages,
    tools: turn.tools,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    cacheKey: `report:${turn.hotelId}`,
    safetyId: turn.questionId,
  });
  const update = { messages: [{ role: 'assistant', content: result.text ?? null, toolCalls: result.toolCalls }], modelCalls: state.modelCalls + 1 };
  if (result.toolCalls.length) return update;
  const text = (result.text ?? '').trim();
  if (!text) return { ...update, outcome: { kind: 'GIVE_UP', reason: 'Model boş cevap verdi; tekrar sorabilirsiniz.' } };
  return { ...update, outcome: { kind: 'TEXT', text: text.slice(0, MAX_TEXT_ANSWER_LENGTH) } };
}

async function toolsNode(state, config) {
  const turn = turnOf(config);
  const last = state.messages.at(-1);
  const messages = [];
  const toolLog = [];
  let outcome = null;
  for (const call of last.toolCalls ?? []) {
    const parsed = turn.parseArguments(call.arguments);
    let reply;
    if (!parsed.ok) reply = { ok: false, error: parsed.error };
    else if (call.name === turn.dataTool) reply = await turn.runData(parsed.value);
    else if (call.name === turn.answerTool) {
      reply = outcome ? { ok: false, error: 'The answer was already presented.' } : await turn.submitAnswer(parsed.value, state.modelCalls);
      if (reply.ok) outcome = { kind: 'REPORT' };
    } else reply = { ok: false, error: `Unknown tool ${call.name}` };
    messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(reply.ok ? (reply.result ?? { ok: true }) : { ok: false, error: reply.error }) });
    toolLog.push({ tool: call.name, ok: reply.ok });
  }
  return { messages, toolLog, ...(outcome ? { outcome } : {}) };
}

const afterAgent = (state) => (state.outcome ? END : 'tools');
const afterTools = (state) => (state.outcome ? END : 'agent');

export const reportGraph = new StateGraph(QuestionState)
  .addNode('agent', agentNode)
  .addNode('tools', toolsNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', afterAgent, ['tools', END])
  .addConditionalEdges('tools', afterTools, ['agent', END])
  .compile();

/**
 * Soruyu cevaplar.
 * @param {Turn} turn
 * @param {object[]} messages sistem + kullanıcı mesajı
 */
export async function runQuestion(turn, messages) {
  return reportGraph.invoke({ messages }, { configurable: { turn }, recursionLimit: MAX_MODEL_CALLS * 2 + 4 });
}
