import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  API_SCOPES,
  WEBHOOK_EVENTS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SOURCE_EVENTS,
  WEBHOOK_TEST_EVENT,
  apiKeyCreateSchema,
  buildWebhookEnvelope,
  missingScopeRequirements,
  parseApiKey,
  publicReservationCreateSchema,
  publicReservationListQuerySchema,
  publicReservationUpdateSchema,
  shouldDisableWebhook,
  toWebhookEvent,
  webhookCreateSchema,
  webhookRetryDelayMs,
  webhookUrlProblem,
} from './integrations.js';
import { PUBLIC_API_ROUTES, WEBHOOK_EVENT_DATA_SCHEMAS, buildPublicApiDocument } from './public-api-spec.js';

const ID = '7d2f4e8a-1b3c-4d5e-8f60-123456789abc';
const ID2 = '9a8b7c6d-5e4f-4a3b-9c2d-0f1e2d3c4b5a';
const SECRET = 'A'.repeat(43);

/** İç olayların örnek gövdeleri (olay kataloğundaki alanlarla; kişisel veri dahil — dışarı sızmamalı). */
const SAMPLE_PAYLOADS = {
  'reservation.created': { hotelId: ID, reservationId: ID, roomTypeId: ID2, checkIn: '2026-12-01T00:00:00.000Z', checkOut: '2026-12-03T00:00:00.000Z', roomId: null, groupId: null, source: 'API', requestId: 'r-1', agencyId: null },
  'reservation.updated': { hotelId: ID, reservationId: ID, roomTypeId: ID2, checkIn: '2026-12-01T00:00:00.000Z', checkOut: '2026-12-03T00:00:00.000Z', changedFields: ['checkOut'] },
  'reservation.confirmed': { hotelId: ID, reservationId: ID },
  'reservation.cancelled': { hotelId: ID, reservationId: ID, roomTypeId: ID2, checkIn: '2026-12-01T00:00:00.000Z', checkOut: '2026-12-03T00:00:00.000Z' },
  'reservation.no_show': { hotelId: ID, reservationId: ID, roomTypeId: ID2, checkIn: '2026-12-01T00:00:00.000Z', checkOut: '2026-12-03T00:00:00.000Z' },
  'reservation.reinstated': { hotelId: ID, reservationId: ID, roomTypeId: ID2, checkIn: '2026-12-01T00:00:00.000Z', checkOut: '2026-12-03T00:00:00.000Z' },
  'guest.checked_in': { hotelId: ID, reservationId: ID, roomTypeId: ID2, checkIn: '2026-12-01T00:00:00.000Z', checkOut: '2026-12-03T00:00:00.000Z', roomId: ID2, guestId: ID, earlyCheckInFee: '10.00', deposit: { method: 'CASH', amount: '500.00', reference: 'Kasa 3' } },
  'guest.checked_out': { hotelId: ID, reservationId: ID, roomTypeId: ID2, checkIn: '2026-12-01T00:00:00.000Z', checkOut: '2026-12-02T00:00:00.000Z', roomId: ID2, guestId: ID, lateCheckOutFee: null, earlyDeparture: true, openBalance: '45.00' },
  'guest.check_in_reverted': { hotelId: ID, reservationId: ID, roomTypeId: ID2, checkIn: '2026-12-01T00:00:00.000Z', checkOut: '2026-12-03T00:00:00.000Z', roomId: ID2, reason: 'Ayşe Hanım yanlış odaya alındı' },
  'guest.check_out_reverted': { hotelId: ID, reservationId: ID, roomTypeId: ID2, checkIn: '2026-12-01T00:00:00.000Z', checkOut: '2026-12-03T00:00:00.000Z', roomId: ID2, reason: 'Misafir geri döndü' },
  'guest.card.updated': { hotelId: ID, guestId: ID },
  'guest.card.merged': { hotelId: ID, sourceId: ID, targetId: ID2 },
  'payment.received': { hotelId: ID, folioId: ID, reservationId: ID2, paymentId: ID, stayEnded: false, method: 'CARD', source: 'FRONT_DESK', amount: '1250.00', currency: 'TRY', approvalId: null },
  'payment.refunded': { hotelId: ID, folioId: ID, reservationId: ID2, paymentId: ID, stayEnded: true, method: 'CARD', amount: '100.00', currency: 'TRY', approvalId: ID2 },
  'invoice.issued': { hotelId: ID, invoiceId: ID, number: 'FLX2026000000001', source: 'FOLIO', documentType: 'E_ARSIV', folioId: ID2, eventId: null, ledgerAccountId: null, total: '1180.00', taxTotal: '180.00', currency: 'TRY', issuedOn: '2026-12-03' },
  'invoice.cancelled': { hotelId: ID, invoiceId: ID, number: 'FLX2026000000001', source: 'FOLIO', folioId: ID2, eventId: null, ledgerAccountId: null },
  'room.status.changed': { hotelId: ID, roomId: ID, roomNumber: '204', field: 'housekeeping', from: 'DIRTY', to: 'CLEAN' },
};

/** Gövdede olmaması gereken alanlar (kişisel / serbest metin / iç kimlik). */
const FORBIDDEN_KEYS = ['firstName', 'lastName', 'phone', 'email', 'idNumber', 'reason', 'deposit', 'openBalance', 'requestId', 'approvalId', 'ledgerAccountId', 'hotelId'];

describe('API anahtarı biçimi', () => {
  it('doğru biçimi parçalar, gerisini veritabanına gitmeden reddeder', () => {
    assert.deepEqual(parseApiKey(`fhk_abcdefgh2345_${SECRET}`), { prefix: 'abcdefgh2345', secret: SECRET });
    assert.deepEqual(parseApiKey(`  fhk_abcdefgh2345_${SECRET}  `), { prefix: 'abcdefgh2345', secret: SECRET });
    for (const bad of [null, 42, '', `fhk_ABCDEFGH2345_${SECRET}`, `fhk_abcdefgh234_${SECRET}`, `fhk_abcdefgh2345_${SECRET}x`, `fhk_abcdefgh2345_${'A'.repeat(42)}!`, `xyz_abcdefgh2345_${SECRET}`, 'Bearer abc']) {
      assert.equal(parseApiKey(bad), null, String(bad));
    }
  });
});

describe('kapsamlar', () => {
  it('rezervasyon yazma, okuma ve müsaitliği gerektirir', () => {
    assert.deepEqual(missingScopeRequirements(['reservations:write']).sort(), ['availability:read', 'reservations:read']);
    assert.deepEqual(missingScopeRequirements(['reservations:write', 'reservations:read', 'availability:read']), []);
    assert.deepEqual(missingScopeRequirements(['guests:read']), []);
  });

  it('anahtar şeması kapsamları katalog sırasına dizer, tekrarı atar, eksik gereksinimi reddeder', () => {
    const ok = apiKeyCreateSchema.parse({ name: 'CRM', scopes: ['guests:read', 'reservations:read', 'guests:read'] });
    assert.deepEqual(ok.scopes, ['reservations:read', 'guests:read']);
    assert.equal(ok.expiresInDays, null);
    assert.equal(apiKeyCreateSchema.safeParse({ name: 'CRM', scopes: ['reservations:write'] }).success, false);
    assert.equal(apiKeyCreateSchema.safeParse({ name: 'CRM', scopes: [] }).success, false);
    assert.equal(apiKeyCreateSchema.safeParse({ name: 'CRM', scopes: ['admin'] }).success, false);
    assert.equal(apiKeyCreateSchema.safeParse({ name: 'CRM', scopes: ['guests:read'], expiresInDays: 45 }).success, false);
    assert.equal(apiKeyCreateSchema.parse({ name: 'CRM', scopes: ['guests:read'], expiresInDays: '90' }).expiresInDays, 90);
    assert.deepEqual([...API_SCOPES].sort(), ['availability:read', 'guests:read', 'reservations:read', 'reservations:write']);
  });
});

describe('webhook adresi', () => {
  it('yalnız https, kimlik bilgisiz, iç ağ dışı', () => {
    assert.equal(webhookUrlProblem('https://api.ornek.com/hooks/flex'), null);
    assert.equal(webhookUrlProblem('https://api.ornek.com:8443/h'), null);
    assert.equal(webhookUrlProblem('https://93.184.216.34/h'), null);
    const rejected = {
      'http://api.ornek.com/h': 'https',
      'ftp://api.ornek.com/h': 'https',
      'https://user:pw@api.ornek.com/h': 'parola',
      'https://localhost/h': 'İç ağ',
      'https://LOCALHOST./h': 'İç ağ',
      'https://foo.localhost/h': 'İç ağ',
      'https://router.local/h': 'İç ağ',
      'https://db.internal/h': 'İç ağ',
      'https://127.0.0.1/h': 'İç ağ',
      'https://10.1.2.3/h': 'İç ağ',
      'https://172.20.0.5/h': 'İç ağ',
      'https://192.168.1.10/h': 'İç ağ',
      'https://169.254.169.254/latest/meta-data': 'İç ağ',
      'https://100.64.0.1/h': 'İç ağ',
      'https://0.0.0.0/h': 'İç ağ',
      'https://[::1]/h': 'İç ağ',
      'https://[fd00::1]/h': 'İç ağ',
      'https://[fe80::1]/h': 'İç ağ',
      'https://[::ffff:127.0.0.1]/h': 'İç ağ',
      'https://intranet/h': 'tam alan adı',
      'bozuk': 'geçersiz',
      '': 'zorunlu',
    };
    for (const [url, fragment] of Object.entries(rejected)) {
      const problem = webhookUrlProblem(url);
      assert.ok(problem && problem.includes(fragment), `${url} → ${problem}`);
    }
    assert.match(webhookUrlProblem(`https://ornek.com/${'a'.repeat(600)}`), /en fazla/);
  });

  it('abonelik şeması olayları katalog sırasına dizer, deneme olayını seçtirmez', () => {
    const parsed = webhookCreateSchema.parse({ url: 'https://ornek.com/h', events: ['payment.received', 'reservation.created', 'payment.received'] });
    assert.deepEqual(parsed.events, ['reservation.created', 'payment.received']);
    assert.equal(webhookCreateSchema.safeParse({ url: 'https://ornek.com/h', events: [WEBHOOK_TEST_EVENT] }).success, false);
    assert.equal(webhookCreateSchema.safeParse({ url: 'https://ornek.com/h', events: [] }).success, false);
    assert.equal(webhookCreateSchema.safeParse({ url: 'http://ornek.com/h', events: ['reservation.created'] }).success, false);
  });
});

describe('yeniden deneme', () => {
  it('çizelge: 1 dk → 24 sa, sonra hak biter', () => {
    assert.equal(webhookRetryDelayMs(1), 60_000);
    assert.equal(webhookRetryDelayMs(2), 5 * 60_000);
    assert.equal(webhookRetryDelayMs(7), 24 * 3_600_000);
    assert.equal(webhookRetryDelayMs(WEBHOOK_MAX_ATTEMPTS), null);
    assert.equal(webhookRetryDelayMs(0), null);
    assert.equal(WEBHOOK_MAX_ATTEMPTS, 8);
  });

  it('dağıtma payı en fazla %10; Retry-After çizelgeden uzunsa ona uyulur (24 saat tavanı)', () => {
    assert.equal(webhookRetryDelayMs(1, { jitter: 1 }), 66_000);
    assert.equal(webhookRetryDelayMs(1, { jitter: 5 }), 66_000);
    assert.equal(webhookRetryDelayMs(1, { retryAfterSeconds: 600 }), 600_000);
    assert.equal(webhookRetryDelayMs(1, { retryAfterSeconds: 10 }), 60_000);
    assert.equal(webhookRetryDelayMs(1, { retryAfterSeconds: 10 * 86_400 }), 86_400_000);
    assert.equal(webhookRetryDelayMs(1, { retryAfterSeconds: Number.NaN }), 60_000);
  });

  it('kendiliğinden kapanma: hem sayı hem süre', () => {
    const now = new Date('2026-12-05T12:00:00Z');
    const since = (hours) => new Date(now.getTime() - hours * 3_600_000);
    assert.equal(shouldDisableWebhook({ consecutiveFailures: 20, failingSince: since(72), now }), true);
    assert.equal(shouldDisableWebhook({ consecutiveFailures: 19, failingSince: since(200), now }), false);
    assert.equal(shouldDisableWebhook({ consecutiveFailures: 500, failingSince: since(71), now }), false);
    assert.equal(shouldDisableWebhook({ consecutiveFailures: 500, failingSince: null, now }), false);
  });
});

describe('webhook olayları', () => {
  it('her iç olay örneği dışarı ince gövdeye çevrilir ve doküman şemasına uyar; kişisel veri yok', () => {
    assert.deepEqual([...WEBHOOK_SOURCE_EVENTS].sort(), Object.keys(SAMPLE_PAYLOADS).sort());
    const types = new Set();
    for (const [source, payload] of Object.entries(SAMPLE_PAYLOADS)) {
      const event = toWebhookEvent(source, payload);
      assert.ok(event, source);
      types.add(event.type);
      const parsed = WEBHOOK_EVENT_DATA_SCHEMAS[event.type].strict().safeParse(event.data);
      assert.ok(parsed.success, `${event.type}: ${JSON.stringify(parsed.error?.issues)}`);
      for (const key of FORBIDDEN_KEYS) assert.ok(!(key in event.data), `${event.type} gövdesinde ${key}`);
    }
    assert.deepEqual([...types].sort(), [...WEBHOOK_EVENTS].sort());
    assert.equal(toWebhookEvent('stock.changed', { hotelId: ID }), null);
    assert.equal(toWebhookEvent('reservation.created', null), null);
  });

  it('tarihler gün, check-in sonrası iç alanlar (teminat, ücret) gitmez', () => {
    const event = toWebhookEvent('guest.checked_in', SAMPLE_PAYLOADS['guest.checked_in']);
    assert.deepEqual(event, { type: 'stay.checked_in', data: { reservationId: ID, roomTypeId: ID2, checkIn: '2026-12-01', checkOut: '2026-12-03', roomId: ID2, guestId: ID } });
  });

  it('zarf: olay kimliği, tür, sürüm, zaman', () => {
    const envelope = buildWebhookEnvelope({ eventId: ID, type: 'reservation.confirmed', occurredAt: new Date('2026-12-01T10:00:00Z'), hotelId: ID2, data: { reservationId: ID } });
    assert.deepEqual(Object.keys(envelope), ['id', 'type', 'apiVersion', 'createdAt', 'hotelId', 'data']);
    assert.equal(envelope.createdAt, '2026-12-01T10:00:00.000Z');
    assert.ok(WEBHOOK_EVENT_DATA_SCHEMAS[WEBHOOK_TEST_EVENT]);
  });
});

describe('açık API şemaları', () => {
  const base = { roomTypeId: ID, checkIn: '2026-12-01', checkOut: '2026-12-03', adults: 2 };

  it('rezervasyon: misafir ya kart kimliği ya yeni misafir; iletişim şart; tarih aralığı', () => {
    assert.equal(publicReservationCreateSchema.safeParse({ ...base, guestId: ID }).success, true);
    assert.equal(publicReservationCreateSchema.safeParse({ ...base, guest: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'AYSE@ornek.com' } }).data.guest.email, 'ayse@ornek.com');
    assert.equal(publicReservationCreateSchema.safeParse(base).success, false);
    assert.equal(publicReservationCreateSchema.safeParse({ ...base, guestId: ID, guest: { firstName: 'A', lastName: 'B', email: 'a@b.co' } }).success, false);
    assert.equal(publicReservationCreateSchema.safeParse({ ...base, guest: { firstName: 'A', lastName: 'B' } }).success, false);
    assert.equal(publicReservationCreateSchema.safeParse({ ...base, guestId: ID, checkOut: '2026-12-01' }).success, false);
    assert.equal(publicReservationCreateSchema.safeParse({ ...base, guestId: ID, checkIn: '2026-02-30' }).success, false);
    assert.equal(publicReservationCreateSchema.safeParse({ ...base, guestId: ID, totalPrice: '1' }).data.totalPrice, undefined, 'fiyat dışarıdan verilemez');
  });

  it('değiştirme en az bir alan ve sürüm ister; liste süzgeci aralığı denetler', () => {
    assert.equal(publicReservationUpdateSchema.safeParse({ expectedUpdatedAt: '2026-11-26T10:00:00.000Z' }).success, false);
    assert.equal(publicReservationUpdateSchema.safeParse({ expectedUpdatedAt: '2026-11-26T10:00:00.000Z', adults: 3 }).success, true);
    assert.equal(publicReservationUpdateSchema.safeParse({ adults: 3 }).success, false);
    assert.equal(publicReservationUpdateSchema.safeParse({ expectedUpdatedAt: 'dün', adults: 3 }).success, false);
    assert.equal(publicReservationListQuerySchema.safeParse({ checkInFrom: '2026-12-05', checkInTo: '2026-12-01' }).success, false);
    assert.equal(publicReservationListQuerySchema.parse({}).limit, 50);
    assert.equal(publicReservationListQuerySchema.safeParse({ limit: 500 }).success, false);
  });
});

describe('OpenAPI dokümanı', () => {
  const doc = buildPublicApiDocument({ serverUrl: 'https://otel.example/api' });

  it('her uç belgeli, kimlikler tekil, kapsamlar katalogdan', () => {
    const ids = PUBLIC_API_ROUTES.map((route) => route.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const route of PUBLIC_API_ROUTES) {
      const operation = doc.paths[route.path.replace(/:([A-Za-z]+)/g, '{$1}')]?.[route.method.toLowerCase()];
      assert.ok(operation, `${route.method} ${route.path}`);
      assert.ok(operation.responses['401'] && operation.responses['429'], `${route.id} 401/429`);
      if (route.scope) assert.ok(API_SCOPES.includes(route.scope), route.scope);
      if (route.idempotent) assert.ok(operation.parameters.some((parameter) => parameter.name === 'Idempotency-Key' && parameter.required));
    }
    assert.equal(doc.openapi, '3.1.0');
    assert.equal(doc.servers[0].url, 'https://otel.example/api');
  });

  it('yol parametreleri zorunlu, varsayılanlı sorgu alanları değil; bütün olaylar webhook bölümünde', () => {
    const get = doc.paths['/v1/reservations/{id}'].get;
    assert.deepEqual(get.parameters.map((parameter) => [parameter.name, parameter.in, parameter.required]), [['id', 'path', true]]);
    const availability = doc.paths['/v1/availability'].get.parameters;
    assert.equal(availability.find((parameter) => parameter.name === 'checkIn').required, true);
    assert.equal(availability.find((parameter) => parameter.name === 'adults').required, false);
    assert.deepEqual(Object.keys(doc.webhooks).sort(), [...WEBHOOK_EVENTS, WEBHOOK_TEST_EVENT].sort());
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(doc)));
  });
});
