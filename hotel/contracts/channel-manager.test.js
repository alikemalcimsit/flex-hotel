import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHANNEX_HORIZON_DAYS,
  DEFAULT_ICAL_HORIZON_DAYS,
  addChannelStopSaleSchema,
  channelLogQuerySchema,
  channelMappingIssues,
  channexWebhookSchema,
  createChannelSchema,
  icalUrlIssue,
  saveChannelMappingsSchema,
  updateChannelSchema,
} from './index.js';

/**
 * Kanal yönetimi sözleşmesi (modül 33): kanal açma, eşleştirme tekilliği,
 * iCal adresi güvenliği, stop-sale ve log dönemi.
 */

const issuesOf = (schema, value) => {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};
const has = (issues, path) => issues.some((line) => line.startsWith(`${path}:`));

const channex = { type: 'CHANNEX', name: 'Channex', environment: 'STAGING', propertyId: '3f2a9c1e-8b4d-4e7a-9f10-2c5d6e7f8a9b', apiKey: 'abcdefghijklmnop1234' };

describe('kanal açma', () => {
  it('Channex: varsayılan 500 gün ve %0 fark; fark virgüllü yazılabilir, iki ondalığa çevrilir', () => {
    const parsed = createChannelSchema.parse(channex);
    assert.equal(parsed.horizonDays, CHANNEX_HORIZON_DAYS);
    assert.equal(parsed.priceMarkupPercent, '0.00');
    assert.equal(createChannelSchema.parse({ ...channex, priceMarkupPercent: '12,5' }).priceMarkupPercent, '12.50');
    assert.equal(createChannelSchema.parse({ ...channex, priceMarkupPercent: '-10' }).priceMarkupPercent, '-10.00');
  });

  it('fark %-50 – %100, gün 30 – 730; anahtar boşluksuz ve en az 16 karakter; mülk UUID', () => {
    assert.ok(has(issuesOf(createChannelSchema, { ...channex, priceMarkupPercent: '101' }), 'priceMarkupPercent'));
    assert.ok(has(issuesOf(createChannelSchema, { ...channex, priceMarkupPercent: '-51' }), 'priceMarkupPercent'));
    assert.ok(has(issuesOf(createChannelSchema, { ...channex, priceMarkupPercent: '1.234' }), 'priceMarkupPercent'));
    assert.ok(has(issuesOf(createChannelSchema, { ...channex, horizonDays: 731 }), 'horizonDays'));
    assert.ok(has(issuesOf(createChannelSchema, { ...channex, apiKey: 'kisa' }), 'apiKey'));
    assert.ok(has(issuesOf(createChannelSchema, { ...channex, apiKey: 'abcdefgh ijklmnop1234' }), 'apiKey'));
    assert.ok(has(issuesOf(createChannelSchema, { ...channex, propertyId: 'mulk-1' }), 'propertyId'));
  });

  it('iCal: sağlayıcı zorunlu, varsayılan 365 gün; tür seçilmeden kanal açılmaz', () => {
    const parsed = createChannelSchema.parse({ type: 'ICAL', name: 'Airbnb', provider: 'AIRBNB' });
    assert.equal(parsed.horizonDays, DEFAULT_ICAL_HORIZON_DAYS);
    assert.ok(issuesOf(createChannelSchema, { type: 'ICAL', name: 'Airbnb' }).length > 0);
    assert.ok(issuesOf(createChannelSchema, { name: 'Kanal' }).length > 0);
  });

  it('düzenlemede boş anahtar "değiştirme" demektir', () => {
    const parsed = updateChannelSchema.parse({ expectedUpdatedAt: '2027-01-01T00:00:00.000Z', name: 'Channex', horizonDays: 500, apiKey: '  ' });
    assert.equal(parsed.apiKey, null);
  });
});

describe('iCal adresi', () => {
  it('yalnızca https, kullanıcı / parolasız, IP ve yerel ad değil', () => {
    assert.equal(icalUrlIssue('https://www.airbnb.com/calendar/ical/123.ics?s=abc'), null);
    assert.match(icalUrlIssue('http://www.airbnb.com/a.ics'), /https/);
    assert.match(icalUrlIssue('https://user:pass@example.com/a.ics'), /kullanıcı adı/);
    assert.match(icalUrlIssue('https://192.168.1.10/a.ics'), /IP değil/);
    assert.match(icalUrlIssue('https://[::1]/a.ics'), /IP değil/);
    assert.match(icalUrlIssue('https://localhost/a.ics'), /herkese açık/);
    assert.match(icalUrlIssue('https://intranet/a.ics'), /herkese açık/);
    assert.match(icalUrlIssue('takvim'), /Geçerli bir adres/);
  });
});

describe('eşleştirme', () => {
  const version = { expectedUpdatedAt: '2027-01-01T00:00:00.000Z' };
  const type = (n) => `00000000-0000-4000-8000-00000000000${n}`;

  it('oda tipi, kanal oda tipi ve kanal fiyat planı birer kez eşleşir', () => {
    const issues = channelMappingIssues([
      { roomTypeId: type(1), externalRoomTypeId: 'a', rates: [{ externalRatePlanId: 'p1' }] },
      { roomTypeId: type(1), externalRoomTypeId: 'a', rates: [{ externalRatePlanId: 'p1' }] },
    ]);
    assert.deepEqual(issues.map((issue) => issue.path.join('.')), ['rooms.1.roomTypeId', 'rooms.1.externalRoomTypeId', 'rooms.1.rates.0.externalRatePlanId']);
  });

  it('boş kanal oda tipi ve boş takvim adresi "yok" demektir; takvim adresi https olmalı', () => {
    const parsed = saveChannelMappingsSchema.parse({ ...version, rooms: [{ roomTypeId: type(1), externalRoomTypeId: '  ', icalImportUrl: '' }] });
    assert.equal(parsed.rooms[0].externalRoomTypeId, null);
    assert.equal(parsed.rooms[0].icalImportUrl, null);
    assert.deepEqual(parsed.rooms[0].rates, []);
    assert.ok(has(issuesOf(saveChannelMappingsSchema, { ...version, rooms: [{ roomTypeId: type(1), icalImportUrl: 'http://x.com/a.ics' }] }), 'rooms.0.icalImportUrl'));
  });
});

describe('stop-sale, log, webhook', () => {
  it('stop-sale: bitiş başlangıçtan önce olamaz; en fazla 730 gün; aynı tip iki kez seçilmez', () => {
    assert.ok(has(issuesOf(addChannelStopSaleSchema, { startDate: '2027-06-10', endDate: '2027-06-01' }), 'endDate'));
    assert.ok(has(issuesOf(addChannelStopSaleSchema, { startDate: '2027-01-01', endDate: '2029-01-05' }), 'endDate'));
    const id = '00000000-0000-4000-8000-000000000001';
    assert.ok(has(issuesOf(addChannelStopSaleSchema, { roomTypeIds: [id, id], startDate: '2027-06-01', endDate: '2027-06-02' }), 'roomTypeIds'));
    assert.deepEqual(addChannelStopSaleSchema.parse({ startDate: '2027-06-01', endDate: '2027-06-01' }).roomTypeIds, [], 'boşsa bütün tipler');
  });

  it('log dönemi en fazla 366 gün', () => {
    assert.ok(has(issuesOf(channelLogQuerySchema, { from: '2027-01-01', to: '2028-01-03' }), 'to'));
    assert.deepEqual(issuesOf(channelLogQuerySchema, { from: '2027-01-01', to: '2027-12-31' }), []);
  });

  it('webhook adresi https olmalı', () => {
    const version = { expectedUpdatedAt: '2027-01-01T00:00:00.000Z' };
    assert.ok(has(issuesOf(channexWebhookSchema, { ...version, callbackBaseUrl: 'http://otel.example.com' }), 'callbackBaseUrl'));
    assert.deepEqual(issuesOf(channexWebhookSchema, { ...version, callbackBaseUrl: 'https://otel.example.com/api' }), []);
  });
});
