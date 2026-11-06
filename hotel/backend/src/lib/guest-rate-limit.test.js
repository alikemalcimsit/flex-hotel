import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { applyGuestIpCeiling, guestLinkKey, guestLinkLimit } from './guest-rate-limit.js';

const LINK_A = `${'a'.repeat(8)}-0000-4000-8000-${'a'.repeat(12)}`;
const LINK_B = `${'b'.repeat(8)}-0000-4000-8000-${'b'.repeat(12)}`;
const SIG = 'S'.repeat(43);

/** Uygulamadaki düzenin küçük eşi: genel sınır + ortak kapsamda IP tavanı + uç başına bağlantı sınırı. */
async function buildGuestApp({ perLink, ceiling }) {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 10_000, timeWindow: '1 minute' });
  app.setErrorHandler((error, _request, reply) => reply.status(error.statusCode ?? 500).send({ code: error.code }));
  await app.register(async (guestApp) => {
    applyGuestIpCeiling(guestApp, { max: ceiling });
    await guestApp.register(
      async (portal) => {
        portal.get('/:token', guestLinkLimit(perLink), async () => ({ ok: true }));
      },
      { prefix: '/portal' },
    );
    await guestApp.register(
      async (roomService) => {
        roomService.get('/:token', guestLinkLimit(perLink), async () => ({ ok: true }));
      },
      { prefix: '/room-service' },
    );
  });
  return app;
}

const hit = (app, url, ip) => app.inject({ method: 'GET', url, remoteAddress: ip }).then((response) => response.statusCode);

describe('misafir uçlarının hız sınırı', () => {
  it('anahtar bağlantı kimliğidir; imza ve IP anahtara girmez; belirteç yoksa IP', () => {
    assert.equal(guestLinkKey({ ip: '85.1.2.3', params: { token: `${LINK_A}.${SIG}` } }), `link|${LINK_A}`);
    assert.equal(guestLinkKey({ ip: '85.9.9.9', params: { token: `${LINK_A}.baska` } }), `link|${LINK_A}`);
    assert.equal(guestLinkKey({ ip: '85.1.2.3', params: {} }), 'ip|85.1.2.3');
    assert.equal(guestLinkKey({ ip: '85.1.2.3', params: { token: 'x'.repeat(5000) } }).length, 'link|'.length + 64, 'uzun yol anahtarı şişirmez');
  });

  it('aynı otel ağındaki (tek IP) iki misafir birbirinin kotasını yemez; bağlantı kendi sınırını aşınca 429', async () => {
    const app = await buildGuestApp({ perLink: 3, ceiling: 100 });
    const otelWifi = '85.1.2.3';
    for (let i = 0; i < 3; i += 1) assert.equal(await hit(app, `/portal/${LINK_A}.${SIG}`, otelWifi), 200);
    assert.equal(await hit(app, `/portal/${LINK_A}.${SIG}`, otelWifi), 429, 'A kendi sınırını aştı');
    assert.equal(await hit(app, `/portal/${LINK_B}.${SIG}`, otelWifi), 200, 'aynı ağdaki B etkilenmez');
    assert.equal(await hit(app, `/room-service/${LINK_A}.${SIG}`, otelWifi), 200, 'uçların sayacı ayrı');
    await app.close();
  });

  it('bağlantı kimliğini değiştirerek deneme IP tavanına takılır; tavan iki uç ailesinde ortaktır, başka IP etkilenmez', async () => {
    const app = await buildGuestApp({ perLink: 50, ceiling: 5 });
    const attacker = '203.0.113.7';
    const randomLink = (i) => `${String(i).padStart(8, '0')}-0000-4000-8000-${'c'.repeat(12)}.${SIG}`;
    for (let i = 0; i < 3; i += 1) assert.equal(await hit(app, `/portal/${randomLink(i)}`, attacker), 200);
    for (let i = 3; i < 5; i += 1) assert.equal(await hit(app, `/room-service/${randomLink(i)}`, attacker), 200);
    const blocked = await app.inject({ method: 'GET', url: `/portal/${randomLink(9)}`, remoteAddress: attacker });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().code, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal(await hit(app, `/portal/${LINK_A}.${SIG}`, '85.1.2.3'), 200, 'başka IP etkilenmez');
    await app.close();
  });
});
