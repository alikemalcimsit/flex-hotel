import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRateLimiter, createSessionToken, createWebchatGateway, verifySessionToken, webchatGatewayManifest, SESSION_TTL_MS } from './index.js';

/**
 * Web chat geçidi: imzalı oturum (başkasının konuşması okunamaz), hız sınırı
 * (herkese açık uçta bütçe ve sunucu korunur), cevabın oturuma iletilmesi.
 */

const SECRET = 'sunucu-sirri-0123456789abcdef';
const HOTEL = '11111111-1111-4111-8111-111111111111';
const OTHER_HOTEL = '99999999-9999-4999-8999-999999999999';

describe('oturum token\'ı', () => {
  it('imzalı token doğrulanır ve oturumu verir', () => {
    const { token, sessionId } = createSessionToken({ hotelId: HOTEL }, SECRET);
    assert.deepEqual(verifySessionToken(token, SECRET, { hotelId: HOTEL }), { sessionId });
  });

  it('başka otelin, başka sırrın, oynanmış gövdenin ya da süresi dolmuşun token\'ı geçmez', () => {
    const now = Date.parse('2026-10-10T10:00:00Z');
    const { token } = createSessionToken({ hotelId: HOTEL, sessionId: 'oturum-1', now }, SECRET);
    assert.equal(verifySessionToken(token, SECRET, { hotelId: OTHER_HOTEL, now }), null);
    assert.equal(verifySessionToken(token, 'baska-sir-0123456789abcdef', { hotelId: HOTEL, now }), null);
    const [body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ h: HOTEL, s: 'baskasinin-oturumu', i: now })).toString('base64url');
    assert.equal(verifySessionToken(`${forged}.${signature}`, SECRET, { hotelId: HOTEL, now }), null);
    assert.equal(verifySessionToken(`${body}.${signature}.fazla`, SECRET, { hotelId: HOTEL, now }), null);
    assert.equal(verifySessionToken(token, SECRET, { hotelId: HOTEL, now: now + SESSION_TTL_MS + 1 }), null);
    assert.equal(verifySessionToken(null, SECRET, { hotelId: HOTEL, now }), null);
  });
});

describe('hız sınırı', () => {
  it('kapasite kadar izin, sonra dolana kadar ret', () => {
    let now = 0;
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1, now: () => now });
    assert.deepEqual([limiter.take('a'), limiter.take('a'), limiter.take('a'), limiter.take('a')], [true, true, true, false]);
    now += 1000;
    assert.equal(limiter.take('a'), true);
    assert.equal(limiter.take('a'), false);
    assert.equal(limiter.take('b'), true, 'anahtarlar birbirini etkilemez');
  });

  it('bellek sınırlı: en eski anahtar atılır', () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0, maxKeys: 2 });
    limiter.take('a');
    limiter.take('b');
    limiter.take('c');
    assert.equal(limiter.size(), 2);
    assert.equal(limiter.take('a'), true, 'atılan anahtar yeniden tam kapasiteyle başlar');
  });
});

describe('giden mesaj', () => {
  const deps = { isProcessed: async () => false, markProcessed: async () => {}, isEnabled: async () => true, logActivity: async () => {}, createManualTask: async () => {}, sleep: async () => {} };
  const payload = (channel) => ({ hotelId: HOTEL, conversationId: '22222222-2222-4222-8222-222222222222', messageId: '33333333-3333-4333-8333-333333333333', channel, recipient: 'oturum-1', author: 'AI' });
  const envelope = { id: 'e1', name: 'guest.message.reply', correlationId: 'z', hop: 1 };

  it('oturuma iletir ve "gönderildi" yazar; başka kanal ve sahiplenilmiş mesaja dokunmaz', async () => {
    const delivered = [];
    const reports = [];
    let outgoing = { messageId: 'm1', to: 'oturum-1', message: { id: 'm1', author: 'AI', text: 'Merhaba', at: 'x' } };
    const gateway = createWebchatGateway(
      { claimOutgoing: async () => outgoing, release: async () => {}, markDelivery: async (hotelId, messageId, report) => reports.push(report) },
      { deliver: async (hotelId, sessionId, message) => { delivered.push([sessionId, message.text]); return 1; } },
      deps,
    );
    assert.equal(gateway.accepts('guest.message.reply', payload('WHATSAPP')), false);
    assert.equal(gateway.accepts('guest.message.reply', payload('WEBCHAT')), true);
    await gateway.handle(payload('WEBCHAT'), { ...envelope, id: 'e2' });
    assert.deepEqual(delivered, [['oturum-1', 'Merhaba']]);
    assert.deepEqual(reports, [{ delivery: 'SENT' }]);
    outgoing = null;
    await gateway.handle(payload('WEBCHAT'), { ...envelope, id: 'e3' });
    assert.equal(delivered.length, 1);
    assert.equal(webchatGatewayManifest.name, 'webchat-gateway');
  });

  it('iletim hata verirse sahiplik bırakılır (tekrar denenir)', async () => {
    const released = [];
    let attempts = 0;
    const gateway = createWebchatGateway(
      { claimOutgoing: async () => ({ messageId: 'm1', to: 's', message: {} }), release: async (h, id) => released.push(id), markDelivery: async () => {} },
      { deliver: async () => { attempts += 1; throw new Error('socket düştü'); } },
      deps,
    );
    await gateway.handle(payload('WEBCHAT'), envelope);
    assert.equal(attempts, 3);
    assert.equal(released.length, 3);
  });
});
