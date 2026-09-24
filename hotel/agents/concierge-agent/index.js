import { BaseLlmAgent, isLlmUnavailable } from '@hotelos/actor-kit';
import { runTurn } from './graph.js';
import { conciergeAgentManifest } from './manifest.js';
import {
  buildContextPrompt,
  buildSummaryMessages,
  buildSystemPrompt,
  confirmationMessage,
  handoffMessage,
  historyMessages,
  rejectionMessage,
  rejectionNeedsStaff,
} from './prompt.js';

/** Özetlenmemiş geçmiş bu sayıyı aşınca eskiler özetlenir. */
export const SUMMARY_TRIGGER = 30;
/** Özetten sonra modele olduğu gibi giden son mesaj sayısı. */
export const KEEP_RECENT = 12;
/** Özetin üst sınırı (karakter). */
const MAX_SUMMARY_LENGTH = 2000;
/** AI'ın rezervasyon isteği gönderebildiği kanallar (`reservation.requested` kaynağı). */
const CHANNEL_SOURCES = new Set(['WHATSAPP', 'WEBCHAT']);

/**
 * Concierge ajanı. Servisi dışarıdan alır (paket Prisma bilmez).
 *
 * @typedef {{
 *   loadTurn: (hotelId: string, conversationId: string) => Promise<null | {
 *     conversation: { id: string, mode: string, status: string, channel: string, guestId: string | null,
 *                     guestName: string | null, knownPhone: string | null, guestEmail: string | null },
 *     hotel: { name: string, currency: string, checkInTime: string, checkOutTime: string, cancellation: string,
 *              boards: string, info: string | null, today: string },
 *     settings: { conciergeModel: string, routerModel: string, maxRepliesPerConversationDay: number,
 *                 reservationStatus: 'CONFIRMED' | 'PENDING' },
 *     memory: { language: string | null, summary: string | null, offers: object[], offersAt: string | null,
 *               pendingOffer: object | null, pendingRequestId: string | null, repliesToday: number },
 *     messages: Array<{ id: string, author: string, text: string, at: string }>,
 *     latestGuest: { id: string, at: string } | null,
 *     unanswered: boolean,
 *   }>,
 *   checkAvailability: (hotelId: string, stay: object) => Promise<object>,
 *   requestReservation: (hotelId: string, conversationId: string, request: object) => Promise<{ requestId: string }>,
 *   saveMemory: (hotelId: string, conversationId: string, patch: object) => Promise<void>,
 *   reply: (hotelId: string, conversationId: string, text: string, meta: object) => Promise<{ messageId: string }>,
 *   handOff: (hotelId: string, conversationId: string, handoff: { reason: string, detail?: string, notice?: string | null, severity?: string }) => Promise<void>,
 *   findRequest: (hotelId: string, requestId: string) => Promise<{ conversationId: string, language: string | null } | null>,
 *   reservationSummary: (hotelId: string, reservationId: string) => Promise<object | null>,
 *   completeRequest: (hotelId: string, conversationId: string, done: { requestId: string, reservationId: string, text: string }) => Promise<void>,
 *   failRequest: (hotelId: string, conversationId: string, failed: { requestId: string, text: string }) => Promise<void>,
 * }} ConciergeService
 */
class ConciergeAgent extends BaseLlmAgent {
  #service;
  #parseArguments;
  #now;
  /** Konuşma başına tur sırası: aynı konuşmanın turları üst üste binmez. */
  #queues = new Map();

  /**
   * @param {ConciergeService} service
   * @param {object} deps `BaseLlmAgent` bağımlılıkları + `parseArguments`, isteğe bağlı `now`
   */
  constructor(service, deps) {
    super(
      conciergeAgentManifest,
      {
        'guest.intent.detected': (payload) => this.#serial(payload.conversationId, () => this.#onIntent(payload)),
        'reservation.created': (payload) => this.#onReservationCreated(payload),
        'reservation.rejected': (payload) => this.#onReservationRejected(payload),
      },
      deps,
    );
    this.#service = service;
    this.#parseArguments = deps.parseArguments;
    this.#now = deps.now ?? (() => Date.now());
  }

  /**
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  #serial(key, task) {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {});
    this.#queues.set(key, tail);
    tail.then(() => {
      if (this.#queues.get(key) === tail) this.#queues.delete(key);
    });
    return run;
  }

  /** @param {{ hotelId: string, conversationId: string, messageId: string, intent: string, affirmative: boolean, language: string }} payload */
  async #onIntent(payload) {
    const { hotelId, conversationId } = payload;
    const context = await this.#service.loadTurn(hotelId, conversationId);
    if (!context || context.conversation.mode !== 'AI' || context.conversation.status !== 'OPEN') {
      return { message: 'Konuşma AI modunda değil; cevap verilmedi' };
    }
    // Yalnızca en son misafir mesajı cevaplanır: arada gelen mesajın niyeti
    // (ör. "dur, tarih değişsin") eski bir "evet"i geçersiz kılar.
    if (!context.latestGuest || context.latestGuest.id !== payload.messageId) {
      return { message: 'Daha yeni bir misafir mesajı var; cevap onun turunda verilecek' };
    }
    if (!context.unanswered) return { message: 'Mesaj zaten cevaplanmış' };

    const language = payload.language || context.memory.language;
    if (payload.intent === 'COMPLAINT' || payload.intent === 'HUMAN') {
      await this.#service.handOff(hotelId, conversationId, {
        reason: payload.intent,
        detail: payload.intent === 'COMPLAINT' ? 'Misafir şikâyet ediyor' : 'Misafir personelle görüşmek istedi',
        notice: handoffMessage(payload.intent, language),
        severity: payload.intent === 'COMPLAINT' ? 'WARNING' : 'INFO',
      });
      return { message: `Konuşma personele devredildi (${payload.intent})`, meta: { intent: payload.intent } };
    }
    if (context.memory.repliesToday >= context.settings.maxRepliesPerConversationDay) {
      await this.#service.handOff(hotelId, conversationId, {
        reason: 'LIMIT',
        detail: `Günlük AI cevap sınırı (${context.settings.maxRepliesPerConversationDay}) doldu`,
        notice: handoffMessage('LIMIT', language),
      });
      return { message: 'Günlük cevap sınırı doldu; konuşma personele devredildi' };
    }

    let state;
    let summary = context.memory.summary;
    let summaryPatch = {};
    try {
      let history = context.messages;
      if (history.length > SUMMARY_TRIGGER) {
        const older = history.slice(0, -KEEP_RECENT);
        const result = await this.callModel(hotelId, {
          model: context.settings.routerModel,
          messages: buildSummaryMessages(summary, older),
          maxOutputTokens: 300,
          cacheKey: `summary:${hotelId}`,
          safetyId: conversationId,
        }, { conversationId });
        const text = (result.text ?? '').trim().slice(0, MAX_SUMMARY_LENGTH);
        if (text) {
          summary = text;
          summaryPatch = { summary, summarizedUntil: older.at(-1).at };
          history = history.slice(-KEEP_RECENT);
        }
      }

      const hotelFacts = {
        name: context.hotel.name,
        check_in_from: context.hotel.checkInTime,
        check_out_until: context.hotel.checkOutTime,
        currency: context.hotel.currency,
        cancellation: context.hotel.cancellation,
        boards: context.hotel.boards,
        info: context.hotel.info ?? null,
      };
      const messages = [
        { role: 'system', content: buildSystemPrompt(context.hotel) },
        {
          role: 'system',
          content: buildContextPrompt({
            today: context.hotel.today,
            channel: context.conversation.channel,
            guest: { name: context.conversation.guestName, phone: context.conversation.knownPhone, email: context.conversation.guestEmail },
            summary,
            offers: context.memory.offers,
            pendingOffer: context.memory.pendingOffer,
            language,
          }),
        },
        ...historyMessages(history),
      ];

      state = await runTurn(
        {
          hotelId,
          conversationId,
          model: context.settings.conciergeModel,
          today: context.hotel.today,
          now: this.#now,
          knownPhone: context.conversation.knownPhone,
          latestGuestMessageAt: context.latestGuest.at,
          affirmative: payload.affirmative === true,
          pendingRequestId: context.memory.pendingRequestId,
          hotelFacts,
          reservationStatus: context.settings.reservationStatus,
          guestId: context.conversation.guestId,
          callModel: (request) => this.callModel(hotelId, request, { conversationId }),
          service: this.#service,
          parseArguments: this.#parseArguments,
        },
        {
          messages,
          offers: context.memory.offers,
          offersAt: context.memory.offersAt,
          pendingOffer: context.memory.pendingOffer,
        },
      );
    } catch (error) {
      if (!isLlmUnavailable(error)) throw error;
      await this.#service.handOff(hotelId, conversationId, {
        reason: error.reason,
        detail: error.message,
        notice: handoffMessage('UNAVAILABLE', language),
        severity: error.reason === 'BUDGET' ? 'WARNING' : 'INFO',
      });
      return { message: `AI kullanılamıyor (${error.message}); konuşma personele devredildi`, meta: { reason: error.reason } };
    }

    await this.#service.saveMemory(hotelId, conversationId, {
      ...summaryPatch,
      language,
      lastIntent: payload.intent,
      offers: state.offers,
      offersAt: state.offersAt,
      pendingOffer: state.pendingOffer,
      countReply: !state.handoff,
    });

    const tools = state.toolLog.map((entry) => `${entry.tool}${entry.ok ? '' : ' (reddedildi)'}`);
    if (state.handoff) {
      await this.#service.handOff(hotelId, conversationId, {
        reason: state.handoff.reason,
        detail: state.handoff.detail,
        notice: handoffMessage(state.handoff.reason === 'MODEL' ? 'HUMAN' : 'UNAVAILABLE', language),
      });
      return { message: `Konuşma personele devredildi: ${state.handoff.detail}`, meta: { tools } };
    }

    try {
      await this.#service.reply(hotelId, conversationId, state.reply, {
        intent: payload.intent,
        model: context.settings.conciergeModel,
        tools,
        ...(state.requested ? { requestId: state.requested.requestId } : {}),
      });
    } catch (error) {
      if (error?.code === 'CONVERSATION_MANUAL') return { message: 'Konuşma bu arada personele alındı; AI cevabı gönderilmedi' };
      throw error;
    }
    return {
      message: state.requested ? 'Misafir onayladı; rezervasyon isteği gönderildi' : 'Misafire cevap verildi',
      meta: { intent: payload.intent, tools, modelCalls: state.modelCalls, requestId: state.requested?.requestId ?? null },
    };
  }

  /**
   * İsteğin sonucu konuşmanın sırasına girer: rezervasyon, isteği gönderen
   * tur henüz "talebiniz alındı" cevabını yazmadan açılabilir (aynı süreçte,
   * milisaniyeler içinde). Sıra, onay kodunun o cevaptan **sonra** gitmesini
   * sağlar; misafir "kod birazdan gelecek"i koddan sonra okumaz.
   *
   * @param {{ hotelId: string, reservationId: string, requestId: string | null }} payload
   */
  async #onReservationCreated(payload) {
    if (!payload.requestId) return { message: 'Kanal isteğinden açılmamış rezervasyon; ilgilenilmedi' };
    const link = await this.#service.findRequest(payload.hotelId, payload.requestId);
    if (!link) return { message: 'Bu rezervasyonun isteği bir AI konuşmasından değil' };
    return this.#serial(link.conversationId, async () => {
      const summary = await this.#service.reservationSummary(payload.hotelId, payload.reservationId);
      if (!summary) return { message: 'Rezervasyon bulunamadı; onay kodu yazılmadı' };
      await this.#service.completeRequest(payload.hotelId, link.conversationId, {
        requestId: payload.requestId,
        reservationId: payload.reservationId,
        text: confirmationMessage(summary, link.language),
      });
      return { message: `Onay kodu misafire yazıldı: ${summary.confirmationCode}`, meta: { reservationId: payload.reservationId } };
    });
  }

  /**
   * Yer kalmadıysa AI konuşmaya devam eder (başka tip/tarih önerir); başka
   * bir sebepse misafire "ekibimiz dönecek" denir — söz tutulsun diye konuşma
   * personele devredilir.
   *
   * @param {{ hotelId: string, requestId: string, code: string, reason: string }} payload
   */
  async #onReservationRejected(payload) {
    const link = await this.#service.findRequest(payload.hotelId, payload.requestId);
    if (!link) return { message: 'Bu istek bir AI konuşmasından değil' };
    return this.#serial(link.conversationId, async () => {
      await this.#service.failRequest(payload.hotelId, link.conversationId, {
        requestId: payload.requestId,
        text: rejectionMessage(payload.code, link.language),
      });
      if (rejectionNeedsStaff(payload.code)) {
        await this.#service.handOff(payload.hotelId, link.conversationId, {
          reason: 'REQUEST_FAILED',
          detail: payload.reason,
          notice: null,
          severity: 'WARNING',
        });
      }
      return { message: `Rezervasyon açılamadı (${payload.reason}); misafire bildirildi`, meta: { code: payload.code } };
    });
  }

  /**
   * Sıraya yalnızca ilgilenilecek olay girer: her rezervasyon için değil,
   * kanal isteğinden (WhatsApp / web chat) açılanlar için.
   */
  accepts(eventName, payload) {
    if (eventName === 'reservation.created') return CHANNEL_SOURCES.has(payload.source) && Boolean(payload.requestId);
    return true;
  }

  /** Konuşma turu personele düştüyse konuşma AI modunda bırakılmaz. */
  async afterFallback(payload, envelope, reason) {
    if (envelope.name === 'guest.intent.detected' && payload.conversationId) {
      await this.#service.handOff(payload.hotelId, payload.conversationId, { reason: 'AGENT_FAILED', detail: reason, notice: null });
    }
  }

  describeFallback(eventName) {
    switch (eventName) {
      case 'guest.intent.detected':
        return 'Misafir mesajı elle cevaplanacak (AI devre dışı)';
      case 'reservation.created':
        return 'Misafire rezervasyon onay kodu elle iletilecek';
      case 'reservation.rejected':
        return 'Misafire rezervasyonun açılamadığı elle iletilecek';
      default:
        return super.describeFallback(eventName);
    }
  }
}

/**
 * @param {ConciergeService} service
 * @param {object} deps
 */
export function createConciergeAgent(service, deps) {
  return new ConciergeAgent(service, deps);
}

export { conciergeAgentManifest };
export { MAX_MODEL_CALLS, runTurn } from './graph.js';
export * from './prompt.js';
export * from './tools.js';
