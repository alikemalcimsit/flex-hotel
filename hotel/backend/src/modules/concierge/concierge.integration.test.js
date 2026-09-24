import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Modül 8 uçtan uca — gerçek PostgreSQL, gerçek servisler, gerçek aktörler
 * (router, concierge, rezervasyon, oda, kanal geçitleri), **sahte model**.
 *
 * Model senaryoludur: router çağrısına mesaja bakıp niyet döner, concierge
 * çağrılarına sıradaki cevabı (araç çağrısı ya da metin) verir. Böylece
 * sınanan her şey kodun kendisi: "evet olmadan rezervasyon yok", fiyatın
 * yeniden denetlenmesi, onay kodunun modelden değil veritabanından yazılması,
 * sıralama, bütçe, devir, webhook imzası, web chat protokolü.
 */

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

const ZONE = 'Europe/Istanbul';
const ORIGIN = 'https://otel.example';
const ROUTER_MODEL = 'mini-router';
const CONCIERGE_MODEL = 'big-concierge';
const PRICES = {
  [ROUTER_MODEL]: { input: '0.1500', cachedInput: '0.0750', output: '0.6000' },
  [CONCIERGE_MODEL]: { input: '2.5000', cachedInput: '1.2500', output: '10.0000' },
};
/** AI kapalı ayar (webhook ve hız sınırı testleri modelden bağımsız). */
const PRICES_OFF = Object.freeze({
  enabled: false,
  routerModel: ROUTER_MODEL,
  conciergeModel: CONCIERGE_MODEL,
  prices: PRICES,
  dailyBudgetUsd: '5.00',
  reservationStatus: 'CONFIRMED',
  hotelInfo: null,
  maxRepliesPerConversationDay: 40,
});
const APP_SECRET = 'meta-uygulama-sirri-123456';
const VERIFY_TOKEN = 'dogrulama-token-123456';
const PHONE_NUMBER_ID = '1098765432100';

/** Sahte model istemcisi: router niyeti mesajdan, concierge cevabı senaryodan. */
const fakeModel = {
  calls: [],
  script: [],
  /** @type {(message: string, hasPendingOffer: boolean) => object} */
  route: () => ({ intent: 'QUESTION', confidence: 0.9, language: 'tr', affirmative: false }),
  reset() {
    this.calls = [];
    this.script = [];
    this.route = () => ({ intent: 'QUESTION', confidence: 0.9, language: 'tr', affirmative: false });
  },
  async chat(request) {
    this.calls.push(request);
    const usage = { inputTokens: 1200, cachedInputTokens: 400, outputTokens: 60 };
    if (request.responseSchema) {
      const body = JSON.parse(request.messages.at(-1).content);
      return { text: JSON.stringify(this.route(body.message, Boolean(body.pendingOffer))), toolCalls: [], usage };
    }
    const next = this.script.shift();
    if (!next) throw Object.assign(new Error('senaryo bitti'), { retryable: false });
    return { ...(typeof next === 'function' ? next(request) : next), usage };
  },
};

const toolCall = (name, args) => ({ text: null, toolCalls: [{ id: `call_${name}_${randomUUID().slice(0, 6)}`, name, arguments: JSON.stringify(args) }] });
const say = (text) => ({ text, toolCalls: [] });

describe('konuşarak rezervasyon (modül 8, entegrasyon)', { skip }, () => {
  /** @type {any} */ let db;
  /** @type {any} */ let core;
  /** @type {any} */ let messaging;
  /** @type {any} */ let settings;
  /** @type {any} */ let llm;
  /** @type {any} */ let conciergeJobs;
  /** @type {any} */ let channels;
  /** @type {any} */ let channelJobs;
  /** @type {any} */ let webchat;
  /** @type {any} */ let actors;
  /** @type {any} */ let security;
  /** @type {any} */ let app;
  /** @type {(client: any) => Promise<void>} */ let resetDatabase;
  let hotelId;
  let standard;
  const originalFetch = globalThis.fetch;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.SETTINGS_SECRET_KEY = randomBytes(32).toString('base64');
    delete process.env.OPENAI_API_KEY;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    messaging = await import('../messaging/service.js');
    settings = await import('./settings.js');
    llm = await import('./llm.js');
    conciergeJobs = await import('./jobs.js');
    channels = await import('../channels/service.js');
    channelJobs = await import('../channels/jobs.js');
    webchat = await import('../channels/webchat.js');
    actors = await import('../../lib/actors.js');
    security = await import('../../lib/http-security.js');
    app = await (await import('../../app.js')).buildApp({ logger: false });
    assert.equal(actors.registerAiAgents({ client: fakeModel }), true);
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await actors.actorRegistry?.idle();
    await app?.close();
    await db?.$disconnect();
  });

  const asManager = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'mudur@test.local' }, fn);
  const day = (offset) => core.addDays(core.calendarDateInTimeZone(ZONE), offset).toISOString().slice(0, 10);
  /** Bütün arka plan işleri (router → concierge → rezervasyon → onay → gönderim) bitene kadar. */
  const settle = () => actors.actorRegistry.idle();

  beforeEach(async () => {
    await resetDatabase(db);
    fakeModel.reset();
    llm.resetSpendCache();
    globalThis.fetch = originalFetch;

    const hotel = await db.hotel.create({
      data: {
        name: 'Deniz Otel',
        code: `AI-${randomUUID().slice(0, 8)}`,
        timezone: ZONE,
        currency: 'TRY',
        cancellationPolicyDays: 3,
        cancellationPolicyPenaltyPct: '50',
      },
    });
    hotelId = hotel.id;
    standard = await db.roomType.create({
      data: { hotelId, code: 'STD', name: 'Standart', basePrice: '2000', capacityAdults: 2, capacityChildren: 1 },
    });
    const deluxe = await db.roomType.create({
      data: { hotelId, code: 'DLX', name: 'Deluxe', basePrice: '3500', capacityAdults: 3, capacityChildren: 1 },
    });
    for (const number of ['101', '102', '103']) await db.room.create({ data: { hotelId, number, roomTypeId: standard.id, floor: 1 } });
    await db.room.create({ data: { hotelId, number: '201', roomTypeId: deluxe.id, floor: 2 } });

    await asManager(() =>
      settings.saveAiSettings(hotelId, {
        enabled: true,
        routerModel: ROUTER_MODEL,
        conciergeModel: CONCIERGE_MODEL,
        prices: { ...PRICES, 'eski-model': PRICES[ROUTER_MODEL] },
        dailyBudgetUsd: '5.00',
        reservationStatus: 'CONFIRMED',
        hotelInfo: 'Açık havuz 09:00-19:00. Otopark ücretsiz.',
        maxRepliesPerConversationDay: 40,
        expectedUpdatedAt: null,
      }),
    );
    await asManager(() =>
      channels.saveWebchatChannel(hotelId, {
        enabled: true,
        allowedOrigins: [ORIGIN],
        title: 'Deniz Otel',
        greeting: 'Merhaba!',
        accentColor: '#0f766e',
        expectedUpdatedAt: null,
      }),
    );
  });

  /** Web chat misafiri yazar; bütün zincir bitene kadar beklenir. */
  const guestSays = async (session, text) => {
    const result = await messaging.receiveInboundMessage(hotelId, {
      channel: 'WEBCHAT',
      externalId: session,
      externalMessageId: randomUUID(),
      text,
    });
    await settle();
    return result;
  };
  const transcript = (conversationId) =>
    db.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  it('müsaitlik → teklif → "evet" → rezervasyon; onay kodu "talebiniz alındı"dan sonra, veritabanından', async () => {
    const checkIn = day(10);
    const checkOut = day(13);
    const offerId = `STD-${checkIn}-${checkOut}-2-0`;
    fakeModel.route = (message, hasPendingOffer) => ({
      intent: 'RESERVATION',
      confidence: 0.95,
      language: 'tr',
      affirmative: hasPendingOffer && /evet/i.test(message),
    });
    fakeModel.script.push(
      toolCall('check_availability', { check_in: checkIn, check_out: checkOut, adults: 2, children: 0 }),
      (request) => {
        // Araç sonucu gerçek fiyatı taşıyor: 3 gece × 2000.
        const result = JSON.parse(request.messages.at(-1).content);
        assert.equal(result.options.find((option) => option.offer_id === offerId).total_price, '6000.00');
        return say('Standart oda 3 gece toplam 6000 TRY. Deluxe 10500 TRY. Hangisini istersiniz?');
      },
      toolCall('propose_reservation', { offer_id: offerId, first_name: 'Ayşe', last_name: 'Yılmaz', phone: null, email: 'ayse@example.com' }),
      say('Standart oda, 2 yetişkin, toplam 6000 TRY, Ayşe Yılmaz adına. Onaylıyor musunuz?'),
      toolCall('request_reservation', { offer_id: offerId }),
      say('Talebiniz alındı; onay kodu birazdan burada.'),
    );
    const session = randomUUID();

    const first = await guestSays(session, `${checkIn} - ${checkOut} 2 kişi oda var mı?`);
    await guestSays(session, 'Standart olsun. Ayşe Yılmaz, ayse@example.com');
    // Teklif hazırlandı ama "evet" gelmedi: rezervasyon yok.
    assert.equal(await db.reservation.count({ where: { hotelId } }), 0);
    await guestSays(session, 'Evet, onaylıyorum');

    const reservation = await db.reservation.findFirst({ where: { hotelId }, include: { guest: true } });
    assert.ok(reservation, 'rezervasyon açılmalı');
    assert.equal(reservation.source, 'WEBCHAT');
    assert.equal(reservation.status, 'CONFIRMED');
    assert.equal(reservation.totalPrice.toFixed(2), '6000.00');
    assert.equal(reservation.roomTypeId, standard.id);
    assert.equal(reservation.guest.email, 'ayse@example.com');
    assert.equal(`${reservation.guest.firstName} ${reservation.guest.lastName}`, 'Ayşe Yılmaz');
    assert.ok(reservation.roomId, 'oda kendiliğinden atandı (room-worker)');
    // Zincirin her halkası Activity Feed'de (aktivite izi) görünür.
    const traced = new Set((await db.activityLog.findMany({ where: { hotelId }, select: { actorName: true } })).map((row) => row.actorName));
    for (const actor of ['router-agent', 'concierge-agent', 'reservation-worker', 'room-worker', 'webchat-gateway']) {
      assert.ok(traced.has(actor), `${actor} iz bırakmalı`);
    }

    const conversation = await db.conversation.findFirst({ where: { id: first.conversationId }, include: { aiState: true } });
    assert.equal(conversation.mode, 'AI');
    assert.equal(conversation.reservationId, reservation.id, 'konuşma rezervasyona bağlandı');
    assert.equal(conversation.guestId, reservation.guestId);
    assert.equal(conversation.aiState.pendingRequestId, null, 'istek kapandı');
    assert.equal(conversation.aiState.repliesCount, 3);
    assert.equal(conversation.aiState.language, 'tr');

    const messages = await transcript(first.conversationId);
    const outgoing = messages.filter((message) => message.direction === 'OUT' && !message.internal);
    assert.deepEqual(
      outgoing.map((message) => message.author),
      ['AI', 'AI', 'AI', 'SYSTEM'],
    );
    assert.match(outgoing[2].text, /Talebiniz alındı/);
    assert.match(outgoing[3].text, new RegExp(`Onay kodu: ${reservation.confirmationCode}`));
    assert.match(outgoing[3].text, /Toplam: 6000\.00 TRY/);
    assert.ok(outgoing.every((message) => message.delivery === 'SENT'), 'web chat geçidi hepsini iletti');
    assert.ok(messages.some((message) => message.internal && /AI rezervasyon isteği gönderdi/.test(message.text)));
    // Router'ın niyeti misafir mesajında (gelen kutusu rozeti).
    const listed = await messaging.listMessages(hotelId, first.conversationId, { limit: 50 });
    assert.ok(listed.items.filter((message) => message.direction === 'IN').every((message) => message.intent === 'RESERVATION'));

    // Maliyet: 3 router + 6 concierge çağrısı, konuşmaya bağlı, fiyattan hesaplanmış.
    const usage = await db.llmUsage.findMany({ where: { hotelId } });
    assert.equal(usage.length, 9);
    assert.ok(usage.every((row) => row.conversationId === first.conversationId && Number(row.costUsd) > 0));
    const report = await llm.getAiUsage(hotelId, { days: 7 });
    assert.equal(report.total.calls, 9);
    assert.deepEqual(
      report.byActor.map((row) => [row.actorName, row.calls]),
      [['concierge-agent', 6], ['router-agent', 3]],
    );
    // Router çağrısı: 800 taze × 0.15 + 400 önbellekli × 0.075 + 60 çıktı × 0.6 (1M başına) = 0.000186
    assert.equal(report.byModel.find((row) => row.model === ROUTER_MODEL).costUsd, (0.000186 * 3).toFixed(6));
    assert.equal(report.today.exhausted, false);
  });

  it('bütçe dolmuşsa model çağrılmaz; misafire bilgi, konuşma personele, yönetime bütçe uyarısı', async () => {
    // Bütçe denetimi günlük özetten okur (modül 12): bugün bütçe aşılmış.
    await db.llmUsageDaily.create({
      data: {
        hotelId,
        actorName: 'concierge-agent',
        model: CONCIERGE_MODEL,
        calls: 1,
        costUsd: '5.000001',
        date: core.calendarDateInTimeZone(ZONE),
      },
    });
    const { conversationId } = await guestSays(randomUUID(), 'Merhaba, oda bakıyorum');

    assert.equal(fakeModel.calls.length, 0);
    const conversation = await db.conversation.findFirst({ where: { id: conversationId } });
    assert.equal(conversation.mode, 'MANUAL');
    assert.ok(conversation.awaitingReplySince, 'misafir hâlâ cevap bekliyor');
    const messages = await transcript(conversationId);
    assert.ok(messages.some((message) => message.author === 'AI' && /ekibimize iletildi/.test(message.text)));
    assert.ok(messages.some((message) => message.internal && /Günlük AI bütçesi doldu/.test(message.text)));
    const alerts = await db.staffAlert.findMany({ where: { hotelId } });
    assert.ok(alerts.some((alert) => alert.kind === 'AI_HANDOFF' && alert.permission === 'messages.reply'));
    assert.ok(alerts.some((alert) => alert.kind === 'AI_BUDGET' && alert.permission === 'settings.manage'));
  });

  it('şikâyet modelsiz devredilir; personel uyarısı "uyarı" önemde', async () => {
    fakeModel.route = () => ({ intent: 'COMPLAINT', confidence: 0.9, language: 'tr', affirmative: false });
    const { conversationId } = await guestSays(randomUUID(), 'Odam kirli ve kimse ilgilenmiyor!');

    assert.equal(fakeModel.calls.length, 1, 'yalnızca router');
    assert.equal((await db.conversation.findFirst({ where: { id: conversationId } })).mode, 'MANUAL');
    const alert = await db.staffAlert.findFirst({ where: { hotelId, kind: 'AI_HANDOFF' } });
    assert.equal(alert.severity, 'WARNING');
    const messages = await transcript(conversationId);
    assert.ok(messages.some((message) => message.author === 'AI' && /üzgünüz/i.test(message.text)));
  });

  it('personelin devraldığı konuşmaya AI karışmaz; AI kapalıyken AI moduna alınamaz', async () => {
    fakeModel.script.push(say('Havuz 09:00-19:00 arası açık.'));
    const session = randomUUID();
    const { conversationId } = await guestSays(session, 'Havuz kaçta açık?');
    const conversation = await db.conversation.findFirst({ where: { id: conversationId } });

    // Personel konuşmayı devraldı → yeni mesajda model hiç çağrılmaz.
    await asManager(() => messaging.updateConversation(hotelId, conversationId, { mode: 'MANUAL', expectedStateVersion: conversation.stateVersion }));
    const before = fakeModel.calls.length;
    await guestSays(session, 'Teşekkürler, bir de otopark var mı?');
    assert.equal(fakeModel.calls.length, before);

    const { updatedAt } = await settings.getAiSettings(hotelId);
    await asManager(() => settings.saveAiSettings(hotelId, { ...PRICES_OFF, expectedUpdatedAt: updatedAt }));
    const current = await db.conversation.findFirst({ where: { id: conversationId } });
    await assert.rejects(
      () => asManager(() => messaging.updateConversation(hotelId, conversationId, { mode: 'AI', expectedStateVersion: current.stateVersion })),
      (error) => error.code === 'NO_AUTO_RESPONDER',
    );
  });

  it('AI ayarı: iki kişi aynı anda kaydederse ikincisi reddedilir; yalnızca seçili modellerin fiyatı saklanır', async () => {
    const current = await settings.getAiSettings(hotelId);
    assert.deepEqual(Object.keys(current.prices).sort(), [CONCIERGE_MODEL, ROUTER_MODEL]);
    assert.equal(current.keyConfigured, false, 'anahtar ortamda değil; cevapta anahtar yok');
    assert.equal(current.agentRunning, true);
    const input = { ...current, dailyBudgetUsd: '7.50', expectedUpdatedAt: current.updatedAt };
    delete input.keyConfigured;
    delete input.agentRunning;
    delete input.updatedBy;
    delete input.updatedAt;
    await asManager(() => settings.saveAiSettings(hotelId, input));
    await assert.rejects(() => asManager(() => settings.saveAiSettings(hotelId, input)), (error) => error.code === 'STALE_WRITE');
    assert.equal((await settings.getAiSettings(hotelId)).dailyBudgetUsd, '7.5');
  });

  it('takılan AI konuşması (5 dakikadır cevapsız) personele devredilir', async () => {
    const conversation = await db.conversation.create({
      data: {
        hotelId,
        channel: 'WEBCHAT',
        externalId: randomUUID(),
        mode: 'AI',
        lastMessagePreview: 'Merhaba, yarın için oda var mı?',
        awaitingReplySince: new Date(Date.now() - 10 * 60_000),
      },
    });
    const fresh = await db.conversation.create({
      data: { hotelId, channel: 'WEBCHAT', externalId: randomUUID(), mode: 'AI', awaitingReplySince: new Date() },
    });

    assert.equal(await conciergeJobs.handOffStalledConversations(), 1);
    await settle();
    assert.equal((await db.conversation.findFirst({ where: { id: conversation.id } })).mode, 'MANUAL');
    assert.equal((await db.conversation.findFirst({ where: { id: fresh.id } })).mode, 'AI', 'yeni bekleyene dokunulmaz');
    const notice = await db.message.findFirst({ where: { conversationId: conversation.id, author: 'AI' } });
    assert.match(notice.text, /ekibimize iletildi/);
  });

  it('bekleyen web chat cevabı iş tarafından gönderilir; kanal kapalıysa bekler', async () => {
    const conversation = await db.conversation.create({ data: { hotelId, channel: 'WEBCHAT', externalId: randomUUID(), mode: 'MANUAL' } });
    const pending = await db.message.create({
      data: {
        hotelId,
        conversationId: conversation.id,
        direction: 'OUT',
        author: 'STAFF',
        text: 'Merhaba, nasıl yardımcı olabilirim?',
        delivery: 'PENDING',
        createdAt: new Date(Date.now() - 2 * 60_000),
      },
    });
    await db.messagingChannel.updateMany({ where: { hotelId, channel: 'WEBCHAT' }, data: { enabled: false } });
    let summary = await channelJobs.sendPendingMessages({ warn: () => {} });
    assert.deepEqual(summary.WEBCHAT, {});
    assert.equal((await db.message.findFirst({ where: { id: pending.id } })).delivery, 'PENDING');

    await db.messagingChannel.updateMany({ where: { hotelId, channel: 'WEBCHAT' }, data: { enabled: true } });
    summary = await channelJobs.sendPendingMessages({ warn: () => {} });
    assert.deepEqual(summary.WEBCHAT, { SENT: 1 });
    assert.equal((await db.message.findFirst({ where: { id: pending.id } })).delivery, 'SENT');
  });

  describe('WhatsApp webhook', () => {
    let channelId;
    const sign = (raw, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    const payload = ({ messages = [], statuses = [], phoneNumberId = PHONE_NUMBER_ID }) =>
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WABA',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '908501112233', phone_number_id: phoneNumberId },
                  contacts: [{ wa_id: '905321110001', profile: { name: 'Elif' } }],
                  messages,
                  statuses,
                },
              },
            ],
          },
        ],
      });
    const textMessage = (id, body) => ({ from: '905321110001', id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } });
    /** @param {string} raw @param {string | null} [signature] null: imza başlığı yok */
    const post = (raw, signature = sign(raw)) =>
      app.inject({
        method: 'POST',
        url: `/webhooks/whatsapp/${channelId}`,
        headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) },
        payload: raw,
      });

    beforeEach(async () => {
      const saved = await asManager(() =>
        channels.saveWhatsAppChannel(hotelId, {
          enabled: true,
          phoneNumberId: PHONE_NUMBER_ID,
          displayPhone: '+90 850 111 22 33',
          graphVersion: null,
          accessToken: 'EAAG-test-erisim-tokeni-1234567890',
          appSecret: APP_SECRET,
          verifyToken: VERIFY_TOKEN,
          expectedUpdatedAt: null,
        }),
      );
      channelId = saved.id;
      assert.equal(saved.hasAccessToken, true);
      assert.equal(JSON.stringify(saved).includes(APP_SECRET), false, 'sır cevapta yok');
    });

    it('kurulum doğrulaması: doğru token challenge döner, yanlışı 403', async () => {
      const ok = await app.inject({
        method: 'GET',
        url: `/webhooks/whatsapp/${channelId}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=4815162342`,
      });
      assert.equal(ok.statusCode, 200);
      assert.equal(ok.body, '4815162342');
      const wrong = await app.inject({
        method: 'GET',
        url: `/webhooks/whatsapp/${channelId}?hub.mode=subscribe&hub.verify_token=yanlis-token-000000&hub.challenge=1`,
      });
      assert.equal(wrong.statusCode, 403);
    });

    it('imzasız / yanlış imzalı bildirim hiçbir şey yazdırmaz; başka numaranın mesajı atlanır; tekrar tek kayıt', async () => {
      const { updatedAt } = await settings.getAiSettings(hotelId);
      await asManager(() => settings.saveAiSettings(hotelId, { ...PRICES_OFF, expectedUpdatedAt: updatedAt }));
      const raw = payload({ messages: [textMessage('wamid.IN1', 'Merhaba')] });
      assert.equal((await post(raw, sign(raw, 'baska-sir-0000000000'))).statusCode, 401);
      assert.equal((await post(raw, null)).statusCode, 401);
      assert.equal(await db.message.count({ where: { hotelId } }), 0);

      const first = await post(raw);
      assert.equal(first.statusCode, 200);
      assert.deepEqual(first.json().data, { received: 1, duplicates: 0, reports: 0, skipped: 0 });
      const again = await post(raw);
      assert.deepEqual(again.json().data, { received: 0, duplicates: 1, reports: 0, skipped: 0 });

      const foreign = payload({ messages: [textMessage('wamid.IN2', 'x')], phoneNumberId: '5550000000' });
      assert.deepEqual((await post(foreign)).json().data, { received: 0, duplicates: 0, reports: 0, skipped: 1 });

      const conversation = await db.conversation.findFirst({ where: { hotelId, channel: 'WHATSAPP' } });
      assert.equal(conversation.displayName, 'Elif');
      assert.equal(conversation.mode, 'MANUAL', 'AI kapalı: personel');
      assert.ok((await db.messagingChannel.findFirst({ where: { id: channelId } })).lastInboundAt);
    });

    it('AI cevabı Cloud API ile gider; teslim bildirimleri mesaja işlenir', async () => {
      const sent = [];
      globalThis.fetch = async (url, init) => {
        sent.push({ url: String(url), body: JSON.parse(init.body), authorization: init.headers.authorization });
        return new Response(JSON.stringify({ messages: [{ id: `wamid.OUT${sent.length}` }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };
      fakeModel.script.push(say('Havuzumuz 09:00-19:00 arası açık.'));

      const response = await post(payload({ messages: [textMessage('wamid.IN9', 'Havuz kaçta açık?')] }));
      assert.equal(response.statusCode, 200);
      await settle();

      assert.equal(sent.length, 1);
      assert.match(sent[0].url, new RegExp(`/v\\d+\\.\\d/${PHONE_NUMBER_ID}/messages$`));
      assert.equal(sent[0].body.to, '905321110001');
      assert.equal(sent[0].body.text.body, 'Havuzumuz 09:00-19:00 arası açık.');
      assert.equal(sent[0].authorization, 'Bearer EAAG-test-erisim-tokeni-1234567890');
      const reply = await db.message.findFirst({ where: { hotelId, author: 'AI' } });
      assert.equal(reply.delivery, 'SENT');
      assert.equal(reply.externalId, 'wamid.OUT1');

      const read = payload({
        statuses: [{ id: 'wamid.OUT1', status: 'read', timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: '905321110001' }],
      });
      assert.deepEqual((await post(read)).json().data, { received: 0, duplicates: 0, reports: 1, skipped: 0 });
      assert.equal((await db.message.findFirst({ where: { id: reply.id } })).delivery, 'READ');
    });
  });

  describe('web chat balonu (socket)', () => {
    let server;
    let port;
    let publicKey;
    let clientIo;

    before(async () => {
      const { Server } = await import('socket.io');
      clientIo = (await import('socket.io-client')).io;
      const httpServer = createServer();
      const io = new Server(httpServer);
      const transport = webchat.registerWebchatNamespace(io, {
        secret: webchat.webchatSessionSecret('test-jwt-sirri-000000000000000000000000'),
        clientIp: security.socketIpResolver('loopback'),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
      webchat.setWebchatTransport(transport);
      await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
      port = httpServer.address().port;
      server = { httpServer, io };
    });

    after(async () => {
      webchat.setWebchatTransport(null);
      await new Promise((resolve) => server.io.close(() => resolve()));
    });

    beforeEach(async () => {
      publicKey = (await channels.getMessagingChannels(hotelId)).webchat.publicKey;
    });

    const connect = ({ key = publicKey, token, origin = ORIGIN } = {}) =>
      clientIo(`http://127.0.0.1:${port}/webchat`, {
        auth: { key, ...(token ? { token } : {}) },
        extraHeaders: { origin },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
    const next = (socket, event, predicate = () => true) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`"${event}" gelmedi`)), 10_000);
        const handler = (data) => {
          if (!predicate(data)) return;
          clearTimeout(timer);
          socket.off(event, handler);
          resolve(data);
        };
        socket.on(event, handler);
      });

    it('oturum, ayar ve geçmiş gelir; mesaj kaydedilir, AI cevabı balona düşer, "gördüm" okundu yapar; token ile aynı oturum', async () => {
      fakeModel.script.push(say('Havuz 09:00-19:00 arası açık.'));
      const socket = connect();
      const [session, config, history] = await Promise.all([next(socket, 'session'), next(socket, 'config'), next(socket, 'history')]);
      assert.ok(session.token);
      assert.equal(config.title, 'Deniz Otel');
      assert.equal(config.greeting, 'Merhaba!');
      assert.deepEqual(history.messages, []);

      const clientMessageId = randomUUID();
      const ack = next(socket, 'ack');
      const typing = next(socket, 'typing', (data) => data.on === true);
      const answer = next(socket, 'message', (message) => message.author === 'AI');
      socket.emit('send', { clientMessageId, text: 'Havuz kaçta açık?' });
      const acked = await ack;
      assert.equal(acked.clientMessageId, clientMessageId);
      assert.ok(acked.id);
      await typing;
      const reply = await answer;
      assert.equal(reply.text, 'Havuz 09:00-19:00 arası açık.');
      await settle();

      socket.emit('seen', { messageIds: [reply.id, randomUUID()] });
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal((await db.message.findFirst({ where: { id: reply.id } })).delivery, 'READ');
      socket.close();

      // Aynı token: aynı konuşma, geçmişle.
      const again = connect({ token: session.token });
      const restored = await next(again, 'history');
      assert.deepEqual(
        restored.messages.map((message) => [message.author, message.text]),
        [
          ['GUEST', 'Havuz kaçta açık?'],
          ['AI', 'Havuz 09:00-19:00 arası açık.'],
        ],
      );
      again.close();
      assert.equal(await db.conversation.count({ where: { hotelId, channel: 'WEBCHAT' } }), 1);
    });

    it('izin verilmeyen site ve bilinmeyen anahtar bağlanamaz', async () => {
      for (const options of [{ origin: 'https://baska-site.example' }, { key: 'wc_bilinmeyenAnahtar000000000' }]) {
        const socket = connect(options);
        const error = await next(socket, 'connect_error');
        assert.equal(error.data?.code, 'CHAT_DISABLED');
        socket.close();
      }
    });

    it('oturum başına mesaj sınırı: sınırı aşan mesaj kaydedilmez', async () => {
      const { updatedAt } = await settings.getAiSettings(hotelId);
      await asManager(() => settings.saveAiSettings(hotelId, { ...PRICES_OFF, expectedUpdatedAt: updatedAt }));
      const socket = connect();
      await next(socket, 'history');
      const acks = [];
      socket.on('ack', (ack) => acks.push(ack));
      for (let index = 0; index < 10; index += 1) socket.emit('send', { clientMessageId: randomUUID(), text: `mesaj ${index}` });
      for (let waited = 0; acks.length < 10 && waited < 10_000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
      socket.close();
      assert.equal(acks.length, 10);
      assert.equal(acks.filter((ack) => ack.code === 'RATE_LIMITED').length, 2);
      assert.equal(await db.message.count({ where: { hotelId, direction: 'IN' } }), 8);
    });
  });
});
