import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlmUnavailableError } from '@hotelos/actor-kit';
import { conciergeAgentManifest, createConciergeAgent, KEEP_RECENT, MAX_MODEL_CALLS } from './index.js';

/**
 * Concierge ajanı gerçek LangGraph grafiğiyle, sahte model ve sahte servisle.
 * Model senaryolu: her çağrıda sıradaki cevabı verir (araç çağrısı ya da metin).
 * Korumaların kodda olduğunu göstermek için model "yanlış" araç çağrıları da yapar.
 */

const HOTEL = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const T0 = Date.parse('2026-10-10T10:00:00.000Z');

const QUOTE = {
  currency: 'TRY',
  roomTypes: [
    { id: 'type-std', code: 'STD', name: 'Standart', capacityAdults: 2, capacityChildren: 1, available: 4, total: '6000.00' },
    { id: 'type-dlx', code: 'DLX', name: 'Deluxe', capacityAdults: 3, capacityChildren: 1, available: 1, total: '9000.00' },
  ],
};
const OFFER_ID = 'STD-2026-10-15-2026-10-18-2-0';

const toolCall = (name, args, id = `call_${name}`) => ({ text: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const say = (text) => ({ text, toolCalls: [] });

/**
 * @param {{ script?: Array<object | ((request: object) => object)>, memory?: object, messages?: object[], quote?: object, llm?: object, enabled?: boolean, now?: number }} options
 */
function harness(options = {}) {
  const calls = { chat: [], replies: [], handoffs: [], requests: [], memory: [], completed: [], failed: [], manualTasks: [], order: [] };
  const script = [...(options.script ?? [])];
  let clock = options.now ?? T0;
  const memory = {
    language: 'tr',
    summary: null,
    offers: [],
    offersAt: null,
    pendingOffer: null,
    pendingRequestId: null,
    repliesToday: 0,
    ...options.memory,
  };
  const messages = options.messages ?? [{ id: 'm1', author: 'GUEST', text: '15-18 Ekim 2 kişi oda var mı?', at: new Date(clock - 1000).toISOString() }];
  let quote = options.quote ?? QUOTE;

  const service = {
    loadTurn: async () => {
      const latestGuest = [...messages].reverse().find((message) => message.author === 'GUEST') ?? null;
      return {
        conversation: { id: CONVERSATION, mode: 'AI', status: 'OPEN', channel: 'WEBCHAT', guestId: null, guestName: null, knownPhone: null, guestEmail: null },
        hotel: { name: 'Deniz Otel', currency: 'TRY', checkInTime: '14:00', checkOutTime: '12:00', cancellation: '3 gün öncesine kadar ücretsiz', boards: 'BB: kahvaltı', info: 'Havuz var', today: '2026-10-10' },
        settings: { conciergeModel: 'large-model', routerModel: 'small-model', maxRepliesPerConversationDay: 40, reservationStatus: 'CONFIRMED' },
        memory: { ...memory },
        messages: [...messages],
        latestGuest: latestGuest ? { id: latestGuest.id, at: latestGuest.at } : null,
        unanswered: messages.at(-1)?.author === 'GUEST',
      };
    },
    checkAvailability: async () => quote,
    requestReservation: async (hotelId, conversationId, request) => {
      calls.requests.push(request);
      memory.pendingRequestId = 'req-1';
      // Gerçekte rezervasyon aktörü isteği aynı süreçte, tur bitmeden işler.
      options.onRequest?.(agent);
      return { requestId: 'req-1' };
    },
    saveMemory: async (hotelId, conversationId, patch) => {
      calls.memory.push(patch);
      const { countReply, ...rest } = patch;
      Object.assign(memory, rest);
      if (countReply) memory.repliesToday += 1;
    },
    reply: async (hotelId, conversationId, text, meta) => {
      calls.replies.push({ text, meta });
      calls.order.push('reply');
      messages.push({ id: `ai-${calls.replies.length}`, author: 'AI', text, at: new Date(clock).toISOString() });
      return { messageId: `ai-${calls.replies.length}` };
    },
    handOff: async (hotelId, conversationId, handoff) => calls.handoffs.push(handoff),
    findRequest: async (hotelId, requestId) => (requestId === 'req-1' ? { conversationId: CONVERSATION, language: 'tr' } : null),
    reservationSummary: async (hotelId, reservationId) =>
      reservationId === 'res-1'
        ? { requestId: 'req-1', confirmationCode: 'DEM4XK7', checkIn: '2026-10-15', checkOut: '2026-10-18', roomTypeName: 'Standart', adults: 2, children: 0, totalPrice: '6000.00', currency: 'TRY', status: 'CONFIRMED' }
        : { requestId: null },
    completeRequest: async (hotelId, conversationId, done) => {
      calls.completed.push(done);
      calls.order.push('complete');
    },
    failRequest: async (hotelId, conversationId, failed) => calls.failed.push(failed),
  };

  const deps = {
    isProcessed: async () => false,
    markProcessed: async () => {},
    isEnabled: async () => options.enabled ?? true,
    logActivity: async () => {},
    createManualTask: async (task) => calls.manualTasks.push(task),
    sleep: async () => {},
    now: () => clock,
    parseArguments: (text) => {
      try {
        return { ok: true, value: JSON.parse(text) };
      } catch {
        return { ok: false, error: 'bad json' };
      }
    },
    llm: {
      client: {
        chat: async (request) => {
          calls.chat.push(request);
          const next = script.shift();
          if (!next) throw Object.assign(new Error('senaryo bitti'), { retryable: false });
          const response = typeof next === 'function' ? next(request) : next;
          return { ...response, usage: { inputTokens: 1000, cachedInputTokens: 800, outputTokens: 50 } };
        },
      },
      assertCanCall: async () => {},
      recordUsage: async () => {},
      ...options.llm,
    },
  };
  const agent = createConciergeAgent(service, deps);
  const guestSays = (text, id) => {
    clock += 60_000;
    messages.push({ id, author: 'GUEST', text, at: new Date(clock).toISOString() });
  };
  const intent = (messageId, overrides = {}) =>
    agent.handle(
      { hotelId: HOTEL, conversationId: CONVERSATION, messageId, intent: 'RESERVATION', confidence: 0.9, language: 'tr', affirmative: false, ...overrides },
      { id: `evt-${messageId}-${Math.random()}`, name: 'guest.intent.detected', correlationId: 'z', hop: 2 },
    );
  return { agent, calls, memory, messages, guestSays, intent, setQuote: (next) => (quote = next), script };
}

describe('bildirge', () => {
  it('niyeti ve rezervasyon sonucunu dinler; rezervasyon isteği yayınlar', () => {
    assert.deepEqual([...conciergeAgentManifest.subscribes], ['guest.intent.detected', 'reservation.created', 'reservation.rejected']);
    assert.deepEqual([...conciergeAgentManifest.publishes], ['reservation.requested']);
  });
});

describe('rezervasyon akışı (üç tur)', () => {
  it('müsaitlik → teklif → "evet" → istek; her tur tek cevap, istek yalnızca onaydan sonra', async () => {
    const h = harness({
      script: [
        toolCall('check_availability', { check_in: '2026-10-15', check_out: '2026-10-18', adults: 2, children: 0 }),
        say('15-18 Ekim için Standart oda 6000 TRY, Deluxe 9000 TRY. Hangisini istersiniz?'),
        toolCall('propose_reservation', { offer_id: OFFER_ID, first_name: 'Ayşe', last_name: 'Yılmaz', phone: '+905321110001', email: null }),
        say('Standart oda, 15-18 Ekim, 2 kişi, toplam 6000 TRY, Ayşe Yılmaz adına. Onaylıyor musunuz?'),
        toolCall('request_reservation', { offer_id: OFFER_ID }),
        say('Talebiniz alındı; onay kodu birazdan burada.'),
      ],
    });

    // 1. tur: müsaitlik.
    await h.intent('m1');
    assert.equal(h.calls.replies.length, 1);
    assert.equal(h.memory.offers.length, 2);
    const firstRequest = h.calls.chat[0];
    assert.equal(firstRequest.model, 'large-model');
    assert.equal(firstRequest.messages[0].role, 'system');
    assert.match(firstRequest.messages[0].content, /<hotel_info>\nHavuz var\n<\/hotel_info>/);
    assert.equal(firstRequest.cacheKey, `concierge:${HOTEL}`);
    assert.ok(firstRequest.tools.some((tool) => tool.name === 'request_reservation'));

    // 2. tur: misafir seçti, adını verdi → teklif hazırlandı, onay soruldu; istek YOK.
    h.guestSays('Standart olsun, Ayşe Yılmaz, 0532 111 00 01', 'm2');
    await h.intent('m2');
    assert.equal(h.memory.pendingOffer.offerId, OFFER_ID);
    assert.equal(h.calls.requests.length, 0);

    // 3. tur: misafir "evet" dedi (router onay saydı) → istek gönderildi.
    h.guestSays('Evet, onaylıyorum', 'm3');
    await h.intent('m3', { affirmative: true });
    assert.equal(h.calls.requests.length, 1);
    const [request] = h.calls.requests;
    assert.equal(request.offer.roomTypeId, 'type-std');
    assert.equal(request.offer.totalPrice, '6000.00');
    assert.deepEqual(request.guest, { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905321110001', email: null });
    assert.equal(request.status, 'CONFIRMED');
    assert.equal(h.calls.replies.at(-1).meta.requestId, 'req-1');
    assert.equal(h.memory.pendingOffer, null);
    assert.equal(h.memory.repliesToday, 3);
  });

  it('model aynı turda teklif hazırlayıp istemeye kalkarsa istek gönderilmez', async () => {
    const h = harness({
      memory: { offers: [], offersAt: null },
      script: [
        toolCall('check_availability', { check_in: '2026-10-15', check_out: '2026-10-18', adults: 2, children: 0 }),
        toolCall('propose_reservation', { offer_id: OFFER_ID, first_name: 'Ayşe', last_name: 'Yılmaz', phone: '+905321110001', email: null }),
        (request) => {
          return toolCall('request_reservation', { offer_id: OFFER_ID }, 'call_req');
        },
        (request) => {
          const toolResult = JSON.parse(request.messages.at(-1).content);
          assert.equal(toolResult.ok, false);
          assert.match(toolResult.error, /not seen/);
          return say('Özet: Standart oda 6000 TRY. Onaylıyor musunuz?');
        },
      ],
    });
    await h.intent('m1', { affirmative: true });
    assert.equal(h.calls.requests.length, 0);
    assert.equal(h.calls.replies.length, 1);
  });

  it('misafir onaylamadıysa (router onay saymadı) istek gönderilmez', async () => {
    const proposedAt = new Date(T0 - 120_000).toISOString();
    const h = harness({
      memory: { pendingOffer: { offerId: OFFER_ID, roomTypeId: 'type-std', checkIn: '2026-10-15', checkOut: '2026-10-18', nights: 3, adults: 2, children: 0, totalPrice: '6000.00', currency: 'TRY', guest: { firstName: 'A', lastName: 'B', phone: '+905321110001', email: null }, proposedAt } },
      script: [
        toolCall('request_reservation', { offer_id: OFFER_ID }),
        (request) => {
          assert.match(JSON.parse(request.messages.at(-1).content).error, /not explicitly confirmed/);
          return say('Onaylıyor musunuz?');
        },
      ],
    });
    await h.intent('m1', { affirmative: false });
    assert.equal(h.calls.requests.length, 0);
  });

  it('onay anında fiyat değiştiyse istek gönderilmez, teklif düşer, yeni fiyat modele söylenir', async () => {
    const proposedAt = new Date(T0 - 120_000).toISOString();
    const h = harness({
      memory: { pendingOffer: { offerId: OFFER_ID, roomTypeId: 'type-std', checkIn: '2026-10-15', checkOut: '2026-10-18', nights: 3, adults: 2, children: 0, totalPrice: '6000.00', currency: 'TRY', guest: { firstName: 'A', lastName: 'B', phone: '+905321110001', email: null }, proposedAt } },
      quote: { ...QUOTE, roomTypes: [{ ...QUOTE.roomTypes[0], total: '6600.00' }] },
      script: [
        toolCall('request_reservation', { offer_id: OFFER_ID }),
        (request) => {
          assert.match(JSON.parse(request.messages.at(-1).content).error, /6000\.00 to 6600\.00/);
          return say('Fiyat 6600 TRY oldu, devam edelim mi?');
        },
      ],
    });
    await h.intent('m1', { affirmative: true });
    assert.equal(h.calls.requests.length, 0);
    assert.equal(h.memory.pendingOffer, null);
  });
});

describe('tur kuralları', () => {
  it('daha yeni misafir mesajı varsa eski mesajın turu cevap vermez', async () => {
    const h = harness({ script: [say('x')] });
    h.guestSays('dur, tarih değişecek', 'm2');
    await h.intent('m1', { affirmative: true });
    assert.equal(h.calls.chat.length, 0);
    assert.equal(h.calls.replies.length, 0);
  });

  it('aynı konuşmanın iki turu üst üste binmez; cevaplanmış mesaj ikinci kez cevaplanmaz', async () => {
    const h = harness({ script: [say('Merhaba, nasıl yardımcı olabilirim?'), say('ikinci cevap olmamalı')] });
    await Promise.all([h.intent('m1'), h.intent('m1')]);
    assert.equal(h.calls.replies.length, 1);
    assert.equal(h.calls.chat.length, 1);
  });

  it('şikâyet ve personel isteği modelsiz devredilir; misafire şablon mesaj', async () => {
    const h = harness();
    await h.intent('m1', { intent: 'COMPLAINT' });
    assert.equal(h.calls.chat.length, 0);
    assert.equal(h.calls.handoffs[0].reason, 'COMPLAINT');
    assert.equal(h.calls.handoffs[0].severity, 'WARNING');
    assert.match(h.calls.handoffs[0].notice, /ekibimize ilettim/);
  });

  it('bütçe dolmuşsa konuşma personele devredilir (misafire bilgi verilir)', async () => {
    const h = harness({
      llm: {
        assertCanCall: async () => {
          throw new LlmUnavailableError('Günlük AI bütçesi doldu', 'BUDGET');
        },
      },
    });
    await h.intent('m1');
    assert.equal(h.calls.handoffs[0].reason, 'BUDGET');
    assert.match(h.calls.handoffs[0].notice, /ekibimize iletildi/);
    assert.equal(h.calls.replies.length, 0);
  });

  it('model araç döngüsünden çıkamazsa tur sınırlanır ve devredilir', async () => {
    const endless = Array.from({ length: MAX_MODEL_CALLS + 3 }, () => toolCall('get_hotel_info', { topic: 'GENERAL' }));
    const h = harness({ script: endless });
    await h.intent('m1');
    assert.equal(h.calls.chat.length, MAX_MODEL_CALLS);
    assert.equal(h.calls.handoffs[0].reason, 'LOOP');
  });

  it('günlük cevap sınırı dolmuşsa model çağrılmaz, devredilir', async () => {
    const h = harness({ memory: { repliesToday: 40 } });
    await h.intent('m1');
    assert.equal(h.calls.chat.length, 0);
    assert.equal(h.calls.handoffs[0].reason, 'LIMIT');
  });

  it('uzun konuşmada eskiler küçük modelle özetlenir; modele son mesajlar gider', async () => {
    const long = Array.from({ length: 34 }, (_, index) => ({
      id: `h${index}`,
      author: index % 2 ? 'AI' : 'GUEST',
      text: `mesaj ${index}`,
      at: new Date(T0 - (40 - index) * 1000).toISOString(),
    }));
    long.push({ id: 'last', author: 'GUEST', text: 'havuz açık mı?', at: new Date(T0).toISOString() });
    const h = harness({ messages: long, script: [say('Misafir 2 kişi için Ekim ortası sordu.'), say('Havuz 09-19 açık.')] });
    await h.intent('last', { intent: 'QUESTION' });
    assert.equal(h.calls.chat[0].model, 'small-model');
    const conversation = h.calls.chat[1].messages;
    assert.equal(conversation.filter((message) => message.role !== 'system').length, KEEP_RECENT);
    assert.match(conversation[1].content, /Summary of earlier conversation:\nMisafir 2 kişi/);
    assert.equal(h.memory.summary, 'Misafir 2 kişi için Ekim ortası sordu.');
  });
});

describe('rezervasyonun sonucu', () => {
  const created = (overrides = {}) => ({ hotelId: HOTEL, reservationId: 'res-1', requestId: 'req-1', source: 'WEBCHAT', ...overrides });
  const createdEnvelope = (id) => ({ id, name: 'reservation.created', correlationId: 'z', hop: 3 });

  it('rezervasyon açılınca onay kodu şablondan sohbete yazılır; kanal isteği olmayan rezervasyon sıraya bile girmez', async () => {
    const h = harness();
    await h.agent.handle(created(), createdEnvelope('e1'));
    assert.equal(h.calls.completed.length, 1);
    assert.match(h.calls.completed[0].text, /Onay kodu: DEM4XK7/);
    assert.equal(h.calls.completed[0].requestId, 'req-1');

    assert.equal(h.agent.accepts('reservation.created', created({ source: 'UI' })), false);
    assert.equal(h.agent.accepts('reservation.created', created({ requestId: null })), false);
    assert.equal(h.agent.accepts('reservation.created', created({ source: 'WHATSAPP' })), true);
    // Başka bir kanal isteği (AI konuşması değil): dokunulmaz.
    await h.agent.handle(created({ reservationId: 'res-2', requestId: 'req-ota' }), createdEnvelope('e2'));
    assert.equal(h.calls.completed.length, 1);
  });

  it('rezervasyon tur bitmeden açılsa da onay kodu "talebiniz alındı" cevabından sonra yazılır', async () => {
    let completion = null;
    const h = harness({
      memory: {
        offers: [],
        pendingOffer: {
          offerId: OFFER_ID, roomTypeId: 'type-std', roomTypeName: 'Standart', checkIn: '2026-10-15', checkOut: '2026-10-18',
          nights: 3, adults: 2, children: 0, totalPrice: '6000.00', currency: 'TRY', available: 4,
          guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905321110001', email: null },
          proposedAt: new Date(T0 - 5000).toISOString(),
        },
      },
      script: [toolCall('request_reservation', { offer_id: OFFER_ID }), say('Talebiniz alındı; onay kodu birazdan burada.')],
      onRequest: (agent) => {
        completion = agent.handle(created(), createdEnvelope('e-order'));
      },
    });
    await h.intent('m1', { affirmative: true });
    await completion;
    assert.deepEqual(h.calls.order, ['reply', 'complete']);
  });

  it('istek reddedilince misafire sebebe göre yazılır; yer yoksa AI devam eder, başka sebepte personele devredilir', async () => {
    const h = harness();
    await h.agent.handle({ hotelId: HOTEL, requestId: 'req-1', code: 'NO_AVAILABILITY', reason: 'yer yok' }, { id: 'e3', name: 'reservation.rejected', correlationId: 'z', hop: 3 });
    assert.match(h.calls.failed[0].text, /yer kalmadı/);
    assert.equal(h.calls.handoffs.length, 0);

    await h.agent.handle({ hotelId: HOTEL, requestId: 'req-1', code: 'VALIDATION', reason: 'Misafirin telefonu yok' }, { id: 'e4', name: 'reservation.rejected', correlationId: 'z', hop: 3 });
    assert.match(h.calls.failed[1].text, /Ekibimiz sizinle iletişime geçecek/);
    assert.deepEqual(h.calls.handoffs[0], { reason: 'REQUEST_FAILED', detail: 'Misafirin telefonu yok', notice: null, severity: 'WARNING' });
  });

  it('arka planda çalışır: olay yayıncısı turun bitmesini beklemez', () => {
    assert.deepEqual({ ...conciergeAgentManifest.background }, { maxConcurrent: 16, maxQueued: 1000, onOverflow: 'fallback' });
  });

  it('ajan kapalıyken konuşma personele alınır, iş manuel göreve düşer', async () => {
    const h = harness({ enabled: false });
    await h.intent('m1');
    assert.equal(h.calls.manualTasks[0].title, 'Misafir mesajı elle cevaplanacak (AI devre dışı)');
    assert.equal(h.calls.handoffs[0].reason, 'AGENT_FAILED');
  });
});
