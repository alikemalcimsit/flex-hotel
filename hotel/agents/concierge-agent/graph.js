import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  TOOL_NAMES,
  TOOL_SPECS,
  offerFresh,
  offersForModel,
  offersFrom,
  requestBlocker,
  validateGuestArgs,
  validateStayArgs,
} from './tools.js';

/**
 * Concierge'ın bir turu (LangGraph).
 *
 * ```
 * START → agent ──(araç çağrısı)──→ tools ──→ agent … ──(metin)──→ END
 *                                    └──(personele devir)──→ END
 * ```
 *
 * - `agent`: model çağrısı (izin, bütçe ve kullanım kaydı `callModel`'da).
 * - `tools`: aracı korumalardan geçirip servisle çalıştırır; sonucu modele
 *   araç mesajı olarak geri verir. Araç hatası turu düşürmez: model misafirden
 *   eksik bilgiyi ister.
 * - Model çağrısı tur başına `MAX_MODEL_CALLS` ile sınırlı; aşılırsa konuşma
 *   personele devredilir (sonsuz araç döngüsü faturayı büyütmesin).
 *
 * Grafik bir kez derlenir; tura özgü her şey `config.configurable.turn`'de.
 */

/** Tur başına en fazla model çağrısı. */
export const MAX_MODEL_CALLS = 5;
/** Misafire gidecek metnin üst sınırı (kanallar uzun metni böler ya da reddeder). */
export const MAX_REPLY_LENGTH = 1500;
/** Concierge çıktısının token üst sınırı. */
export const MAX_OUTPUT_TOKENS = 600;

const replace = (_previous, next) => next;

export const TurnState = Annotation.Root({
  /** Modele giden mesajlar (sistem + geçmiş + bu turun asistan/araç mesajları). */
  messages: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
  offers: Annotation({ reducer: replace, default: () => [] }),
  offersAt: Annotation({ reducer: replace, default: () => null }),
  pendingOffer: Annotation({ reducer: replace, default: () => null }),
  /** Bu turda gönderilen rezervasyon isteği. */
  requested: Annotation({ reducer: replace, default: () => null }),
  handoff: Annotation({ reducer: replace, default: () => null }),
  reply: Annotation({ reducer: replace, default: () => null }),
  modelCalls: Annotation({ reducer: replace, default: () => 0 }),
  /** Çalıştırılan araçlar (iz ve Activity Feed için). */
  toolLog: Annotation({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

/**
 * @typedef {{
 *   hotelId: string,
 *   conversationId: string,
 *   model: string,
 *   today: string,
 *   now: () => number,
 *   knownPhone: string | null,
 *   latestGuestMessageAt: string,
 *   affirmative: boolean,
 *   pendingRequestId: string | null,
 *   hotelFacts: object,
 *   reservationStatus: 'CONFIRMED' | 'PENDING',
 *   guestId: string | null,
 *   callModel: (request: object) => Promise<{ text: string | null, toolCalls: Array<{ id: string, name: string, arguments: string }> }>,
 *   service: {
 *     checkAvailability: (hotelId: string, stay: object) => Promise<{ roomTypes: object[], currency: string }>,
 *     requestReservation: (hotelId: string, conversationId: string, request: object) => Promise<{ requestId: string }>,
 *   },
 *   parseArguments: (text: string) => { ok: boolean, value?: object, error?: string },
 * }} Turn
 */

/** @param {import('@langchain/langgraph').LangGraphRunnableConfig} config @returns {Turn} */
const turnOf = (config) => config.configurable.turn;

async function agentNode(state, config) {
  const turn = turnOf(config);
  if (state.modelCalls >= MAX_MODEL_CALLS) {
    return { handoff: { reason: 'LOOP', detail: `Model ${MAX_MODEL_CALLS} çağrıda cevap üretemedi` } };
  }
  const result = await turn.callModel({
    model: turn.model,
    messages: state.messages,
    tools: TOOL_SPECS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    cacheKey: `concierge:${turn.hotelId}`,
    safetyId: turn.conversationId,
  });
  const assistant = { role: 'assistant', content: result.text ?? null, toolCalls: result.toolCalls };
  const update = { messages: [assistant], modelCalls: state.modelCalls + 1 };
  if (!result.toolCalls.length) {
    const text = (result.text ?? '').trim();
    if (!text) return { ...update, handoff: { reason: 'EMPTY', detail: 'Model boş cevap verdi' } };
    update.reply = text.length > MAX_REPLY_LENGTH ? `${text.slice(0, MAX_REPLY_LENGTH - 1)}…` : text;
  }
  return update;
}

/**
 * Tek araç çağrısı. Dönen `result` modele gider; `update` turun durumuna.
 * @param {object} state
 * @param {Turn} turn
 * @param {{ name: string, args: object }} call
 */
async function runTool(state, turn, { name, args }) {
  switch (name) {
    case TOOL_NAMES.CHECK_AVAILABILITY: {
      const stay = validateStayArgs(args, turn.today);
      if (!stay.ok) return { result: { ok: false, error: stay.error } };
      const quote = await turn.service.checkAvailability(turn.hotelId, stay.value);
      const offers = offersFrom(quote, stay.value);
      return {
        result: {
          ok: true,
          check_in: stay.value.checkIn,
          check_out: stay.value.checkOut,
          nights: stay.value.nights,
          options: offersForModel(offers),
          ...(offers.length ? {} : { note: 'No room available for these dates and party size.' }),
        },
        update: { offers, offersAt: new Date(turn.now()).toISOString() },
      };
    }
    case TOOL_NAMES.GET_HOTEL_INFO:
      return { result: { ok: true, topic: args.topic ?? 'GENERAL', facts: turn.hotelFacts } };
    case TOOL_NAMES.PROPOSE: {
      const offer = state.offers.find((item) => item.offerId === args.offer_id);
      if (!offer) return { result: { ok: false, error: 'Unknown offer_id. Call check_availability and use one of its offer ids.' } };
      if (!offerFresh(state.offersAt, turn.now())) {
        return { result: { ok: false, error: 'This offer has expired. Call check_availability again for current prices.' } };
      }
      const guest = validateGuestArgs(args, { knownPhone: turn.knownPhone });
      if (!guest.ok) return { result: { ok: false, error: guest.error } };
      const pendingOffer = { ...offer, guest: guest.value, proposedAt: new Date(turn.now()).toISOString() };
      return {
        result: {
          ok: true,
          summary: {
            room_type: offer.roomTypeName,
            check_in: offer.checkIn,
            check_out: offer.checkOut,
            nights: offer.nights,
            adults: offer.adults,
            children: offer.children,
            total_price: offer.totalPrice,
            currency: offer.currency,
            guest: `${guest.value.firstName} ${guest.value.lastName}`,
            contact: guest.value.phone ?? guest.value.email,
          },
          instruction: 'Show this summary to the guest and ask them to confirm with a clear yes. Do not call request_reservation now.',
        },
        update: { pendingOffer },
      };
    }
    case TOOL_NAMES.REQUEST: {
      if (state.requested) return { result: { ok: false, error: 'The request was already sent in this turn.' } };
      const blocker = requestBlocker({
        offerId: args.offer_id,
        pendingOffer: state.pendingOffer,
        latestGuestMessageAt: turn.latestGuestMessageAt,
        affirmative: turn.affirmative,
        pendingRequestId: turn.pendingRequestId,
      });
      if (blocker) return { result: { ok: false, error: blocker } };

      // Göndermeden hemen önce: hâlâ yer var mı, fiyat aynı mı?
      const proposal = state.pendingOffer;
      const quote = await turn.service.checkAvailability(turn.hotelId, proposal);
      const current = offersFrom(quote, proposal).find((offer) => offer.roomTypeId === proposal.roomTypeId);
      if (!current) {
        return {
          result: { ok: false, error: 'This room type is no longer available for these dates. Tell the guest and offer to check alternatives.' },
          update: { pendingOffer: null },
        };
      }
      if (current.totalPrice !== proposal.totalPrice) {
        return {
          result: {
            ok: false,
            error: `The price changed from ${proposal.totalPrice} to ${current.totalPrice} ${current.currency}. Tell the guest the new price and propose again.`,
          },
          update: { pendingOffer: null, offers: offersFrom(quote, proposal), offersAt: new Date(turn.now()).toISOString() },
        };
      }
      const { requestId } = await turn.service.requestReservation(turn.hotelId, turn.conversationId, {
        offer: proposal,
        guest: proposal.guest,
        guestId: turn.guestId,
        status: turn.reservationStatus,
      });
      return {
        result: {
          ok: true,
          message: 'Booking request sent. Tell the guest it is received and that the confirmation code will follow in this chat shortly.',
        },
        update: { requested: { requestId }, pendingOffer: null },
      };
    }
    case TOOL_NAMES.HANDOFF:
      return {
        result: { ok: true },
        update: { handoff: { reason: 'MODEL', detail: String(args.reason ?? '').slice(0, 300) || 'Model personele devretti' } },
      };
    default:
      return { result: { ok: false, error: `Unknown tool ${name}` } };
  }
}

async function toolsNode(state, config) {
  const turn = turnOf(config);
  const last = state.messages.at(-1);
  let working = { ...state };
  const messages = [];
  const toolLog = [];
  const update = {};
  for (const call of last.toolCalls ?? []) {
    const parsed = turn.parseArguments(call.arguments);
    const outcome = parsed.ok
      ? await runTool(working, turn, { name: call.name, args: parsed.value })
      : { result: { ok: false, error: parsed.error } };
    messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.result) });
    toolLog.push({ tool: call.name, ok: outcome.result.ok !== false });
    if (outcome.update) {
      Object.assign(update, outcome.update);
      working = { ...working, ...outcome.update };
    }
  }
  return { ...update, messages, toolLog };
}

const afterAgent = (state) => (state.handoff || state.reply !== null ? END : 'tools');
const afterTools = (state) => (state.handoff ? END : 'agent');

export const conciergeGraph = new StateGraph(TurnState)
  .addNode('agent', agentNode)
  .addNode('tools', toolsNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', afterAgent, ['tools', END])
  .addConditionalEdges('tools', afterTools, ['agent', END])
  .compile();

/**
 * Bir turu çalıştırır.
 * @param {Turn} turn
 * @param {{ messages: object[], offers: object[], offersAt: string | null, pendingOffer: object | null }} initial
 */
export async function runTurn(turn, initial) {
  return conciergeGraph.invoke(initial, {
    configurable: { turn },
    // Her model çağrısı + araç iki adım; sınır MAX_MODEL_CALLS'u rahat kapsar.
    recursionLimit: MAX_MODEL_CALLS * 2 + 4,
  });
}
