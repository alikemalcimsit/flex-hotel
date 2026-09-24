import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  classifySendError,
  createWhatsAppGateway,
  deliverWhatsAppMessage,
  parseWebhook,
  sendText,
  verifySignature,
  verifySubscription,
  whatsappGatewayManifest,
  windowOpen,
} from './index.js';

/**
 * WhatsApp geçidi: webhook imzası ve kurulumu, gövde ayrıştırma, 24 saat
 * penceresi, gönderim isteği ve hata sınıfları, çift gönderimsiz teslim akışı.
 * Ağa çıkılmaz: sahte `fetch`.
 */

const APP_SECRET = 'uygulama-sirri-0123456789';
const HOTEL = '11111111-1111-4111-8111-111111111111';
const sign = (body) => `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;

const webhook = (value) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1234567890', display_phone_number: '905551112233' }, ...value } }] }],
});

describe('webhook güvenliği', () => {
  it('ham gövdenin imzası doğrulanır; gövde ya da sır değişince reddedilir', () => {
    const body = Buffer.from(JSON.stringify(webhook({})));
    assert.equal(verifySignature(body, sign(body), APP_SECRET), true);
    assert.equal(verifySignature(Buffer.from(`${body} `), sign(body), APP_SECRET), false);
    assert.equal(verifySignature(body, sign(body), 'baska-sir-0123456789'), false);
    assert.equal(verifySignature(body, undefined, APP_SECRET), false);
    assert.equal(verifySignature(body, 'sha1=abc', APP_SECRET), false);
  });

  it('kurulum: token tutarsa challenge döner', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': 'dogrulama-token-123456', 'hub.challenge': '99887766' };
    assert.equal(verifySubscription(query, 'dogrulama-token-123456'), '99887766');
    assert.equal(verifySubscription({ ...query, 'hub.verify_token': 'yanlis' }, 'dogrulama-token-123456'), null);
    assert.equal(verifySubscription(query, null), null);
  });
});

describe('gövde ayrıştırma', () => {
  it('metin, düğme, konum ve medya mesajı; gönderenin adı', () => {
    const { messages } = parseWebhook(
      webhook({
        contacts: [{ wa_id: '905321110001', profile: { name: 'Ayşe' } }],
        messages: [
          { from: '905321110001', id: 'wamid.1', timestamp: '1760000000', type: 'text', text: { body: '15-18 Ekim 2 kişi' } },
          { from: '905321110001', id: 'wamid.2', timestamp: '1760000010', type: 'image', image: { id: 'm' } },
          { from: '905321110001', id: 'wamid.3', timestamp: '1760000020', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b', title: 'Evet' } } },
          { from: '905321110001', id: 'wamid.4', timestamp: '1760000030', type: 'location', location: { name: 'Otel', address: 'Antalya' } },
        ],
      }),
    );
    assert.deepEqual(
      messages.map((message) => [message.id, message.text, message.name]),
      [
        ['wamid.1', '15-18 Ekim 2 kişi', 'Ayşe'],
        ['wamid.2', '[Görsel gönderildi]', 'Ayşe'],
        ['wamid.3', 'Evet', 'Ayşe'],
        ['wamid.4', '[Konum: Otel, Antalya]', 'Ayşe'],
      ],
    );
    assert.equal(messages[0].phoneNumberId, '1234567890');
    assert.equal(messages[0].sentAt.toISOString(), new Date(1760000000 * 1000).toISOString());
  });

  it('teslim durumları; başarısız olanın sebebi okunur hâle gelir; başka nesne yok sayılır', () => {
    const { statuses } = parseWebhook(
      webhook({
        statuses: [
          { id: 'wamid.9', status: 'delivered', timestamp: '1760000100', recipient_id: '905321110001' },
          { id: 'wamid.10', status: 'failed', timestamp: '1760000200', recipient_id: '905321110001', errors: [{ code: 131047, title: 'Re-engagement message' }] },
          { id: 'wamid.11', status: 'weird' },
        ],
      }),
    );
    assert.deepEqual(statuses.map((status) => [status.id, status.delivery]), [['wamid.9', 'DELIVERED'], ['wamid.10', 'FAILED']]);
    assert.match(statuses[1].failureReason, /24 saat penceresi/);
    assert.deepEqual(parseWebhook({ object: 'page', entry: [] }), { messages: [], statuses: [] });
  });
});

describe('24 saat penceresi ve hata sınıfı', () => {
  it('misafir son 24 saatte yazdıysa açık', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    assert.equal(windowOpen('2026-10-09T12:00:01Z', now), true);
    assert.equal(windowOpen('2026-10-09T12:00:00Z', now), false);
    assert.equal(windowOpen(null, now), false);
  });

  it('hız sınırı ve 5xx denenir; pencere, yetki ve geçersiz istek denenmez', () => {
    assert.deepEqual(classifySendError(429, { code: 130429 }), { retryable: true, code: 'TEMPORARY' });
    assert.deepEqual(classifySendError(500, undefined), { retryable: true, code: 'TEMPORARY' });
    assert.deepEqual(classifySendError(400, { code: 131047 }), { retryable: false, code: 'WINDOW_CLOSED' });
    assert.deepEqual(classifySendError(401, { code: 190 }), { retryable: false, code: 'AUTH' });
    assert.deepEqual(classifySendError(400, { code: 100 }), { retryable: false, code: 'REJECTED' });
  });
});

function fakeFetch(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

describe('gönderim', () => {
  it('Graph API isteği: sürüm, numara kimliği, token, metin gövdesi', async () => {
    const { fetchImpl, calls } = fakeFetch(200, { messages: [{ id: 'wamid.OUT' }] });
    const result = await sendText({ phoneNumberId: '1234567890', accessToken: 'EAAG-token', to: '905321110001', text: 'Merhaba', graphVersion: 'v22.0', fetchImpl });
    assert.deepEqual(result, { externalMessageId: 'wamid.OUT' });
    assert.equal(calls[0].url, 'https://graph.facebook.com/v22.0/1234567890/messages');
    assert.equal(calls[0].init.headers.authorization, 'Bearer EAAG-token');
    assert.deepEqual(calls[0].body, { messaging_product: 'whatsapp', recipient_type: 'individual', to: '905321110001', type: 'text', text: { preview_url: false, body: 'Merhaba' } });
  });

  it('hata gövdesi okunur ve sınıflandırılır', async () => {
    const { fetchImpl } = fakeFetch(400, { error: { code: 131047, message: 'Re-engagement' } });
    await assert.rejects(sendText({ phoneNumberId: '1', accessToken: 't', to: '9', text: 'x', fetchImpl }), { retryable: false, code: 'WINDOW_CLOSED' });
    const busy = fakeFetch(429, { error: { code: 80007, message: 'rate' } });
    await assert.rejects(sendText({ phoneNumberId: '1', accessToken: 't', to: '9', text: 'x', fetchImpl: busy.fetchImpl }), { retryable: true });
  });
});

function service({ outgoing, calls }) {
  return {
    claimOutgoing: async () => outgoing,
    release: async (hotelId, messageId) => calls.released.push(messageId),
    markDelivery: async (hotelId, messageId, report) => calls.reports.push(report),
    recordFailure: async (hotelId, error) => calls.failures.push(error),
  };
}

const credentials = { phoneNumberId: '1234567890', accessToken: 'EAAG-token', graphVersion: 'v22.0' };
const NOW = Date.parse('2026-10-10T12:00:00Z');

describe('teslim akışı', () => {
  it('pencere açıkken gönderir ve WhatsApp kimliğiyle "gönderildi" yazar', async () => {
    const calls = { released: [], reports: [], failures: [] };
    const { fetchImpl } = fakeFetch(200, { messages: [{ id: 'wamid.OUT' }] });
    const outgoing = { messageId: 'm1', text: 'Merhaba', to: '905321110001', lastInboundAt: '2026-10-10T11:00:00Z', credentials };
    const outcome = await deliverWhatsAppMessage(service({ outgoing, calls }), { fetchImpl, now: () => NOW }, HOTEL, 'm1');
    assert.equal(outcome.status, 'SENT');
    assert.deepEqual(calls.reports, [{ delivery: 'SENT', externalMessageId: 'wamid.OUT' }]);
  });

  it('başkası sahiplendiyse göndermez; kanal kapalıysa mesaj bekler', async () => {
    const calls = { released: [], reports: [], failures: [] };
    assert.equal((await deliverWhatsAppMessage(service({ outgoing: null, calls }), {}, HOTEL, 'm1')).status, 'SKIPPED');
    const waiting = await deliverWhatsAppMessage(service({ outgoing: { messageId: 'm1', text: 'x', to: '9', lastInboundAt: null, credentials: null }, calls }), {}, HOTEL, 'm1');
    assert.equal(waiting.status, 'WAITING');
    assert.deepEqual(calls.released, ['m1']);
    assert.equal(calls.reports.length, 0);
  });

  it('pencere kapalıysa göndermeden "başarısız" ve sebebi', async () => {
    const calls = { released: [], reports: [], failures: [] };
    const { fetchImpl, calls: http } = fakeFetch(200, {});
    const outgoing = { messageId: 'm1', text: 'x', to: '9', lastInboundAt: '2026-10-08T11:00:00Z', credentials };
    const outcome = await deliverWhatsAppMessage(service({ outgoing, calls }), { fetchImpl, now: () => NOW }, HOTEL, 'm1');
    assert.equal(outcome.status, 'FAILED');
    assert.equal(http.length, 0);
    assert.match(calls.reports[0].failureReason, /24 saat/);
  });

  it('geçici hatada sahiplik bırakılır ve hata fırlar (aktör tekrar dener); token hatası kanala yazılır', async () => {
    const calls = { released: [], reports: [], failures: [] };
    const outgoing = { messageId: 'm1', text: 'x', to: '9', lastInboundAt: '2026-10-10T11:00:00Z', credentials };
    const busy = fakeFetch(503, { error: { code: 2, message: 'down' } });
    await assert.rejects(deliverWhatsAppMessage(service({ outgoing, calls }), { fetchImpl: busy.fetchImpl, now: () => NOW }, HOTEL, 'm1'), { retryable: true });
    assert.deepEqual(calls.released, ['m1']);

    const auth = fakeFetch(401, { error: { code: 190, message: 'expired' } });
    const outcome = await deliverWhatsAppMessage(service({ outgoing, calls }), { fetchImpl: auth.fetchImpl, now: () => NOW }, HOTEL, 'm1');
    assert.equal(outcome.status, 'FAILED');
    assert.equal(calls.failures.length, 1);
  });

  it('aktör: yalnızca WhatsApp konuşmasının cevabını gönderir', async () => {
    const calls = { released: [], reports: [], failures: [] };
    let claimed = 0;
    const gateway = createWhatsAppGateway(
      { ...service({ outgoing: null, calls }), claimOutgoing: async () => { claimed += 1; return null; } },
      { isProcessed: async () => false, markProcessed: async () => {}, isEnabled: async () => true, logActivity: async () => {}, createManualTask: async () => {}, sleep: async () => {} },
    );
    const payload = (channel) => ({ hotelId: HOTEL, conversationId: '22222222-2222-4222-8222-222222222222', messageId: '33333333-3333-4333-8333-333333333333', channel, recipient: '905321110001', author: 'AI' });
    // Başka kanalın cevabı sıraya bile girmez (iz de bırakmaz).
    assert.equal(gateway.accepts('guest.message.reply', payload('WEBCHAT')), false);
    assert.equal(gateway.accepts('guest.message.reply', payload('WHATSAPP')), true);
    await gateway.handle(payload('WHATSAPP'), { id: 'e2', name: 'guest.message.reply', correlationId: 'z', hop: 1 });
    assert.equal(claimed, 1);
    assert.deepEqual([...whatsappGatewayManifest.subscribes], ['guest.message.reply']);
    // Dış API personelin isteğini bekletmez; sıra taşarsa bekleyenler işi gönderir.
    assert.equal(whatsappGatewayManifest.background.onOverflow, 'skip');
  });
});
