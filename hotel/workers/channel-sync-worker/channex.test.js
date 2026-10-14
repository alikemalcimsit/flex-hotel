import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHANNEX_BASE_URLS, CHANNEX_WEBHOOK_SECRET_HEADER, ChannexError, createChannexClient } from './channex.js';

/**
 * Channex istemcisi: doğru uç, doğru başlık ve hataların doğru sınıfı. Hata
 * sınıfı gönderim davranışını belirler: anahtar hatası yeniden denenmez, hız
 * sınırında bir dakika beklenir, geçici hata geri çekilerek yeniden denenir.
 */

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: new Map(Object.entries(next.headers ?? {})),
      text: async () => (next.body === undefined ? '' : JSON.stringify(next.body)),
    };
  };
  return { fetchImpl, calls };
}

const client = (fetchImpl, environment = 'STAGING') => createChannexClient({ environment, apiKey: 'test-anahtar-1234567890', fetchImpl });

describe('Channex istemcisi', () => {
  it('ortam doğru köke gider; anahtar user-api-key başlığında', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { data: { id: 'P1', attributes: { title: 'Otel', currency: 'TRY' } } } }]);
    const property = await client(fetchImpl, 'PRODUCTION').getProperty('P1');
    assert.deepEqual(property, { id: 'P1', title: 'Otel', currency: 'TRY', timezone: null });
    assert.equal(calls[0].url, `${CHANNEX_BASE_URLS.PRODUCTION}/properties/P1`);
    assert.equal(calls[0].init.headers['user-api-key'], 'test-anahtar-1234567890');
  });

  it('müsaitlik ve fiyat ayrı uçlara; görev kimliği ve uyarılar döner', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { data: [{ id: 'T1', type: 'task' }], meta: { message: 'Success', warnings: [] } } },
      { status: 200, body: { data: [{ id: 'T2', type: 'task' }], meta: { warnings: [{ warning: { rate: ['must be greater than 0'] } }] } } },
    ]);
    const api = client(fetchImpl);
    assert.deepEqual(await api.updateAvailability([{ availability: 1 }]), { taskId: 'T1', warnings: [] });
    const restrictions = await api.updateRestrictions([{ rate: '0' }]);
    assert.equal(restrictions.taskId, 'T2');
    assert.equal(restrictions.warnings.length, 1, 'kısmen reddedilen satır uyarı olarak görünür');
    assert.match(calls[0].url, /\/availability$/);
    assert.match(calls[1].url, /\/restrictions$/);
    assert.deepEqual(calls[0].body, { values: [{ availability: 1 }] });
  });

  it('401 anahtar hatasıdır, yeniden denenmez', async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: { errors: { code: 'unauthorized', title: 'Unauthorized' } } }]);
    await assert.rejects(client(fetchImpl).updateAvailability([]), (error) => error instanceof ChannexError && error.auth && !error.retryable);
  });

  it('429 bir dakika (ya da Retry-After kadar) bekletir', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 429, body: { errors: { code: 'http_too_many_requests' } } },
      { status: 429, headers: { 'retry-after': '15' }, body: {} },
    ]);
    await assert.rejects(client(fetchImpl).updateRestrictions([]), (error) => error.code === 'CHANNEX_RATE_LIMIT' && error.retryable && error.retryAfterMs === 60_000);
    await assert.rejects(client(fetchImpl).updateRestrictions([]), (error) => error.retryAfterMs === 15_000);
  });

  it('5xx ve ağ hatası geçicidir; 422 kalıcıdır ve sebebi okunur', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 503, body: {} },
      new TypeError('fetch failed'),
      { status: 422, body: { errors: { code: 'validation_error', title: 'Validation Error' } } },
    ]);
    const api = client(fetchImpl);
    await assert.rejects(api.updateAvailability([]), (error) => error.retryable && error.code === 'CHANNEX_UNAVAILABLE');
    await assert.rejects(api.updateAvailability([]), (error) => error.retryable && error.code === 'CHANNEX_NETWORK');
    await assert.rejects(api.updateAvailability([]), (error) => !error.retryable && /Validation Error/.test(error.message));
  });

  it('revizyon akışı eskiden yeniye, mülke süzülü; teyit revizyon kimliğiyle', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { data: [{ id: 'R1', type: 'booking_revision', attributes: { booking_id: 'B1', status: 'new' } }], meta: { total: 1 } } },
      { status: 200, body: { meta: { message: 'Success' } } },
    ]);
    const api = client(fetchImpl);
    const feed = await api.bookingFeed('P1');
    assert.equal(feed.revisions[0].id, 'R1');
    assert.equal(feed.revisions[0].booking_id, 'B1');
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('filter[property_id]'), 'P1');
    assert.equal(url.searchParams.get('order[inserted_at]'), 'asc');
    await api.ackRevision('R1');
    assert.match(calls[1].url, /\/booking_revisions\/R1\/ack$/);
    assert.equal(calls[1].init.method, 'POST');
  });

  it('oda tipi ve fiyat planı listesi mülke göre süzülür', async () => {
    const { fetchImpl } = fakeFetch([
      {
        status: 200,
        body: {
          data: [
            { id: 'RT1', attributes: { id: 'RT1', title: 'Twin', default_occupancy: 2, property_id: 'P1' } },
            { id: 'RTX', attributes: { id: 'RTX', title: 'Başka mülk', property_id: 'P2' } },
          ],
        },
      },
      { status: 200, body: { data: [{ id: 'RP1', attributes: { id: 'RP1', title: 'BAR', room_type_id: 'RT1', property_id: 'P1', sell_mode: 'per_room' } }] } },
    ]);
    const api = client(fetchImpl);
    assert.deepEqual(await api.listRoomTypes('P1'), [{ id: 'RT1', title: 'Twin', occupancy: 2 }]);
    assert.deepEqual(await api.listRatePlans('P1'), [{ id: 'RP1', title: 'BAR', roomTypeId: 'RT1', sellMode: 'per_room', occupancy: null }]);
  });

  it('webhook: yalnızca rezervasyon olayları, sır başlıkta; silinirken yoksa sorun değil', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 201, body: { data: { id: 'W1' } } }, { status: 404, body: {} }]);
    const api = client(fetchImpl);
    assert.equal(await api.createWebhook({ propertyId: 'P1', callbackUrl: 'https://otel.example/webhooks/channex/x', secret: 'sir' }), 'W1');
    const { webhook } = calls[0].body;
    assert.equal(webhook.event_mask, 'booking');
    assert.equal(webhook.headers[CHANNEX_WEBHOOK_SECRET_HEADER], 'sir');
    assert.equal(webhook.is_active, true);
    await api.deleteWebhook('W1');
  });

  it('bilinmeyen ortam reddedilir', () => {
    assert.throws(() => createChannexClient({ environment: 'TEST', apiKey: 'x' }), /Bilinmeyen Channex ortamı/);
  });
});
