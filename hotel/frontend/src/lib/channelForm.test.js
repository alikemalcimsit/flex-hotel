import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { saveChannelMappingsSchema, updateChannelSchema } from '@hotelos/hotel-contracts';
import { exportUrl, mappingErrorsByRow, mappingPayload, mappingRowsOf, propertyChanged, ratePlansFor, settingsFormOf, settingsPayload, syncSummary } from './channelForm.js';

const STD = '11111111-1111-4111-8111-111111111111';
const DLX = '22222222-2222-4222-8222-222222222222';
const OLD = '33333333-3333-4333-8333-333333333333';
const roomTypes = [
  { id: STD, code: 'STD', name: 'Standart' },
  { id: DLX, code: 'DLX', name: 'Deluxe' },
];

const channex = {
  type: 'CHANNEX',
  name: 'Channex',
  status: 'ACTIVE',
  environment: 'STAGING',
  propertyId: '44444444-4444-4444-8444-444444444444',
  priceMarkupPercent: '15.00',
  horizonDays: 500,
  provider: null,
  updatedAt: '2027-01-01T10:00:00.000Z',
  rooms: [
    { roomTypeId: STD, roomType: { code: 'STD', name: 'Standart' }, externalRoomTypeId: 'rt-1', rates: [{ externalRatePlanId: 'rp-1', boardType: 'BB' }], icalImportUrl: null, exportPath: null },
    { roomTypeId: OLD, roomType: { code: 'OLD', name: 'Eski tip' }, externalRoomTypeId: 'rt-9', rates: [], icalImportUrl: null, exportPath: null },
  ],
  sync: { pending: false, lastSyncAt: null, lastSyncStatus: null, pausedUntil: null, lastError: null },
};
const options = {
  roomTypes: [{ id: 'rt-1', title: 'Standard Double' }, { id: 'rt-2', title: 'Deluxe Sea' }],
  ratePlans: [
    { id: 'rp-1', title: 'BAR', roomTypeId: 'rt-1' },
    { id: 'rp-2', title: 'B&B', roomTypeId: 'rt-2' },
  ],
};

describe('kanal ayar formu', () => {
  it('anahtar hiç gelmez; boş anahtar gönderilmez (değiştirme); şemadan geçer', () => {
    const values = settingsFormOf(channex);
    assert.equal(values.apiKey, '');
    assert.equal(values.priceMarkupPercent, '15');
    const payload = settingsPayload(values, channex);
    assert.equal(payload.apiKey, null);
    assert.equal(payload.provider, undefined, 'Channex kanalında iCal alanı yok');
    assert.equal(updateChannelSchema.safeParse(payload).success, true);
  });

  it('mülk ya da ortam değişirse eşleştirme silinecek (onay istenir)', () => {
    const values = settingsFormOf(channex);
    assert.equal(propertyChanged(values, channex), false);
    assert.equal(propertyChanged({ ...values, propertyId: '55555555-5555-4555-8555-555555555555' }, channex), true);
    assert.equal(propertyChanged({ ...values, environment: 'PRODUCTION' }, channex), true);
    assert.equal(propertyChanged(values, { ...channex, type: 'ICAL' }), false);
  });
});

describe('eşleştirme tablosu', () => {
  it('otelin her tipi bir satır; silinmiş ama eşleşmiş tip de görünür (kaldırılabilsin)', () => {
    const rows = mappingRowsOf(channex, roomTypes);
    assert.deepEqual(rows.map((row) => [row.roomTypeCode, row.enabled, row.deleted]), [
      ['STD', true, false],
      ['DLX', false, false],
      ['OLD', true, true],
    ]);
  });

  it('fiyat planları seçilen Channex oda tipine göre süzülür', () => {
    assert.deepEqual(ratePlansFor(options, 'rt-2').map((plan) => plan.id), ['rp-2']);
    assert.deepEqual(ratePlansFor(options, ''), []);
  });

  it('yalnızca açık satırlar gider, adlar Channex listesinden; şemadan geçer', () => {
    const rows = mappingRowsOf(channex, roomTypes);
    rows[1] = { ...rows[1], enabled: true, externalRoomTypeId: 'rt-2', rates: [{ externalRatePlanId: 'rp-2', boardType: 'HB' }, { externalRatePlanId: '', boardType: 'BB' }] };
    rows[2] = { ...rows[2], enabled: false };
    const payload = mappingPayload(rows, channex, options);
    assert.deepEqual(payload.rooms.map((room) => [room.roomTypeId, room.externalName, room.rates.map((rate) => [rate.externalRatePlanId, rate.externalName, rate.boardType])]), [
      [STD, 'Standard Double', [['rp-1', 'BAR', 'BB']]],
      [DLX, 'Deluxe Sea', [['rp-2', 'B&B', 'HB']]],
    ]);
    assert.equal(saveChannelMappingsSchema.safeParse(payload).success, true);
  });

  it('iCal: takvim adresi kırpılır, boşsa yok; kanal oda tipi ve fiyat planı gitmez', () => {
    const ical = { ...channex, type: 'ICAL', rooms: [] };
    const rows = mappingRowsOf(ical, roomTypes).map((row) => ({ ...row, enabled: true, icalImportUrl: row.roomTypeId === STD ? '  https://www.airbnb.com/a.ics  ' : '' }));
    const payload = mappingPayload(rows, ical, undefined);
    assert.deepEqual(payload.rooms.map((room) => room.icalImportUrl), ['https://www.airbnb.com/a.ics', null]);
    assert.ok(payload.rooms.every((room) => room.externalRoomTypeId === null && room.rates.length === 0));
  });

  it('sunucu hatası açık satırın sırasıyla doğru oda tipine düşer', () => {
    const rows = mappingRowsOf(channex, roomTypes);
    const errors = mappingErrorsByRow({ 'rooms.1.externalRoomTypeId': 'Channex oda tipini seçin', expectedUpdatedAt: 'x' }, rows);
    assert.deepEqual(errors, { [OLD]: { externalRoomTypeId: 'Channex oda tipini seçin' } }, '1. açık satır = OLD (DLX kapalı)');
  });
});

describe('senkron durumu ve adres', () => {
  const time = (value) => value.slice(11, 16);
  it('taslak, durmuş, beklemede, hata, kısmi, sırada, güncel', () => {
    assert.equal(syncSummary({ ...channex, status: 'DRAFT' }, time).tone, 'neutral');
    assert.match(syncSummary({ ...channex, status: 'PAUSED' }, time).text, /Durduruldu/);
    const waiting = syncSummary({ ...channex, sync: { ...channex.sync, pausedUntil: '2027-01-01T10:05:00.000Z', lastError: 'Channex hız sınırı' } }, time);
    assert.deepEqual([waiting.tone, waiting.text], ['danger', 'Channex hız sınırı — 10:05 sonrası yeniden denenecek']);
    assert.equal(syncSummary({ ...channex, sync: { ...channex.sync, lastSyncStatus: 'PARTIAL', lastError: 'Kanal 2 satırı reddetti' } }, time).tone, 'warning');
    assert.equal(syncSummary({ ...channex, sync: { ...channex.sync, pending: true } }, time).tone, 'info');
    assert.match(syncSummary(channex, time).text, /İlk tam eşitleme/);
    assert.match(syncSummary({ ...channex, sync: { ...channex.sync, lastSyncAt: '2027-01-01T09:30:00.000Z', lastSyncStatus: 'SUCCESS' } }, time).text, /Güncel · son iş 09:30/);
    const ical = { ...channex, type: 'ICAL' };
    assert.match(syncSummary(ical, time).text, /Takvim henüz okunmadı/);
    assert.match(syncSummary({ ...ical, sync: { ...ical.sync, lastIcalImportAt: '2027-01-01T08:15:00.000Z' } }, time).text, /son iş 08:15/, 'değişiklik yoksa son okuma');
  });

  it('dışa aktarma adresi sunucu köküyle birleşir', () => {
    assert.equal(exportUrl('https://otel.example.com/api/', '/channel-ical/abc.ics'), 'https://otel.example.com/api/channel-ical/abc.ics');
    assert.equal(exportUrl('https://otel.example.com', null), '');
  });
});
