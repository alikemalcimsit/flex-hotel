import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Dinamik fiyat (modül 34) entegrasyon testleri: yield ayarları, öneri üretimi
 * (yüksek doluluk / son dakika indirimi), M11 onayından geçen uygulama (upsert
 * + rate.changed), red/düzenleme, ve onaylı çarpanın gerçek rezervasyon
 * fiyatına yansıması. Hiçbir fiyat onaysız değişmez — testin kendisi bunu
 * doğrular.
 */

const ZONE = 'Europe/Istanbul';
const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = TEST_DB ? false : 'TEST_DATABASE_URL tanımlı değil — entegrasyon testleri atlandı';

describe('Dinamik fiyat / yield (modül 34)', { skip }, () => {
  let db;
  let core;
  let cache;
  let yieldService;
  let approvals;
  let reservations;
  let resetDatabase;
  let hotelId;
  let types;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ resetDatabase } = await import('../../test-support/reset-database.js'));
    db = (await import('../../db.js')).prismaUnfiltered;
    core = await import('@hotelos/core');
    cache = await import('../../lib/cache.js');
    yieldService = await import('./yield-service.js');
    approvals = await import('../approvals/service.js');
    reservations = await import('../reservations/service.js');
    // Onay kararını öneriye işleyen subscriber (sunucuda buildApp kaydeder).
    (await import('./subscribers.js')).registerPricingSubscribers();
  });

  after(async () => {
    await db?.$disconnect();
  });

  const as = (fn) => core.runWithContext({ correlationId: randomUUID(), actor: 'mudur@hotel.local' }, fn);
  const today = () => core.calendarDateInTimeZone(ZONE);
  const day = (offset) => core.toIsoDay(core.addDays(today(), offset));

  beforeEach(async () => {
    await resetDatabase(db);
    reservations.clearReservationCache();
    cache.cache.clear();
    const hotel = await db.hotel.create({
      data: {
        name: 'Yield Otel',
        code: `Y${randomUUID().slice(0, 5).toUpperCase()}`,
        timezone: ZONE,
        phoneCountryCode: '90',
        settings: { yield: { enabled: true, horizonDays: 14, highOccupancyPct: 80, highAdjustmentPct: 10, lowOccupancyPct: 30, lowDaysOut: 7, lowAdjustmentPct: 15 } },
      },
    });
    hotelId = hotel.id;
    const type = (code, basePrice) =>
      db.roomType.create({ data: { hotelId, code, name: `${code} oda`, basePrice, capacityAdults: 3, capacityChildren: 2 } });
    types = { std: await type('STD', '1000') };
    for (let index = 0; index < 5; index += 1) {
      await db.room.create({ data: { hotelId, number: `10${index}`, roomTypeId: types.std.id } });
    }
  });

  const reservationInput = (overrides = {}) => ({
    guestId: null,
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', phone: `+90555${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, email: null, nationality: 'TR' },
    forceNewGuest: false,
    roomTypeId: types.std.id,
    adults: 2,
    children: 0,
    boardType: 'BB',
    checkIn: new Date(day(10)),
    checkOut: new Date(day(12)),
    status: 'CONFIRMED',
    source: 'PHONE',
    notes: null,
    requestId: randomUUID(),
    waitlistId: null,
    roomId: null,
    manualTotal: null,
    priceNote: null,
    packageId: null,
    agencyId: null,
    ...overrides,
  });

  /** 10-11. gecelerde 5 odanın 4'ünü doldurur (%80 doluluk → yüksek doluluk kuralı). */
  async function fillHigh() {
    let last = null;
    for (let index = 0; index < 4; index += 1) {
      last = await as(() => reservations.createReservation(hotelId, reservationInput({ adults: 1 })));
    }
    cache.cache.clear();
    return last;
  }

  describe('öneri üretimi', () => {
    it('yüksek doluluk önerisi onaya düşer; ikinci koşu mükerrer üretmez (idempotent)', async () => {
      await fillHigh();
      const first = await as(() => yieldService.generateSuggestions(hotelId));
      // İki kural birden tetiklenir: dolu geceler (+%10) ve boş kalan son günler (−%15).
      assert.equal(first.created, 2);

      const high = await db.priceSuggestion.findFirst({ where: { hotelId, multiplier: { gt: 1 } } });
      assert.equal(high.status, 'PENDING');
      assert.equal(high.source, 'RULE');
      assert.equal(Number(high.multiplier), 1.1);
      assert.equal(core.toIsoDay(high.startDate), day(10));
      assert.equal(core.toIsoDay(high.endDate), day(11));
      assert.match(high.reason, /%80/);
      assert.equal(high.inputs.days.length, 2); // yapılandırılmış girdiler (FlexAI 2.0)

      const approval = await db.approval.findFirst({ where: { id: high.approvalId } });
      assert.equal(approval.type, 'BULK_PRICE_CHANGE');
      assert.equal(approval.entityType, 'PriceSuggestion');

      const second = await as(() => yieldService.generateSuggestions(hotelId));
      assert.equal(second.created, 0);
      assert.equal(await db.priceSuggestion.count({ where: { hotelId } }), 2);
    });

    it('düşük doluluk yalnız son günlerde indirim önerir', async () => {
      // Hiç rezervasyon yok: %0 doluluk. 7 gün içindeki geceler indirim alır, sonrası almaz.
      const result = await as(() => yieldService.generateSuggestions(hotelId));
      assert.equal(result.created, 1);
      const row = await db.priceSuggestion.findFirst({ where: { hotelId } });
      assert.equal(Number(row.multiplier), 0.85);
      assert.equal(core.toIsoDay(row.startDate), day(0));
      assert.equal(core.toIsoDay(row.endDate), day(7));
    });

    it('yield kapalı ve ajan kayıtsızken hiçbir şey üretmez', async () => {
      await db.hotel.update({ where: { id: hotelId }, data: { settings: { yield: { enabled: false } } } });
      cache.cache.clear();
      const result = await as(() => yieldService.generateSuggestions(hotelId));
      assert.deepEqual(result, { created: 0, skipped: 0, agentNotified: false });
    });
  });

  describe('onay kararı', () => {
    it('onaylanınca çarpan gecelere yazılır, yeni rezervasyon onaylı fiyattan açılır; onaysız fiyat değişmez', async () => {
      // Onay ÖNCESİ: fiyat taban (1000 × 2 gece) — doldururken açılan son rezervasyon kanıt.
      const beforeApproval = await fillHigh();
      assert.equal(beforeApproval.reservation.totalPrice, '2000.00');

      await as(() => yieldService.generateSuggestions(hotelId));
      const suggestion = await db.priceSuggestion.findFirst({ where: { hotelId, multiplier: { gt: 1 } } });

      await as(() => approvals.decideApproval(hotelId, suggestion.approvalId, 'GRANTED'));

      const updated = await db.priceSuggestion.findFirst({ where: { id: suggestion.id } });
      assert.equal(updated.status, 'APPROVED');
      const adjustments = await db.priceAdjustment.findMany({ where: { hotelId }, orderBy: { date: 'asc' } });
      assert.equal(adjustments.length, 2);
      assert.equal(Number(adjustments[0].multiplier), 1.1);

      // rate.changed kanala gitti (olay günlüğünde).
      const rateChanged = await db.eventLog.findFirst({ where: { hotelId, name: 'rate.changed' } });
      assert.ok(rateChanged);

      // Onay SONRASI: yeni rezervasyon %10 zamlı (5. oda): 1100 × 2 gece.
      cache.cache.clear();
      const afterApproval = await as(() => reservations.createReservation(hotelId, reservationInput({ adults: 1, checkIn: new Date(day(10)), checkOut: new Date(day(12)) })));
      assert.equal(afterApproval.reservation.totalPrice, '2200.00');
    });

    it('reddedilince hiçbir gece yazılmaz', async () => {
      await fillHigh();
      await as(() => yieldService.generateSuggestions(hotelId));
      const suggestion = await db.priceSuggestion.findFirst({ where: { hotelId, multiplier: { gt: 1 } } });

      await as(() => approvals.decideApproval(hotelId, suggestion.approvalId, 'DENIED', { note: 'Sezon sonu, zam istemiyoruz' }));

      assert.equal((await db.priceSuggestion.findFirst({ where: { id: suggestion.id } })).status, 'REJECTED');
      assert.equal(await db.priceAdjustment.count({ where: { hotelId } }), 0);
    });

    it('karar öncesi düzenlenen çarpan uygulanır (+%10 → +%20)', async () => {
      await fillHigh();
      await as(() => yieldService.generateSuggestions(hotelId));
      const suggestion = await db.priceSuggestion.findFirst({ where: { hotelId, multiplier: { gt: 1 } } });

      const edited = await as(() =>
        yieldService.updateSuggestionMultiplier(hotelId, suggestion.id, { multiplier: '1.200', expectedUpdatedAt: suggestion.updatedAt }),
      );
      assert.equal(edited.multiplier, '1.200');
      assert.equal(edited.suggestedPrice, '1200.00');

      await as(() => approvals.decideApproval(hotelId, suggestion.approvalId, 'GRANTED'));
      const adjustment = await db.priceAdjustment.findFirst({ where: { hotelId } });
      assert.equal(Number(adjustment.multiplier), 1.2);
    });
  });

  describe('ayar ve geçmiş', () => {
    it('yield ayarları kaydedilir ve cache olayla tazelenir', async () => {
      const current = await yieldService.getYieldSettings(hotelId);
      const saved = await as(() =>
        yieldService.saveYieldSettings(hotelId, {
          enabled: true,
          horizonDays: 21,
          highOccupancyPct: 85,
          highAdjustmentPct: 12,
          lowOccupancyPct: 25,
          lowDaysOut: 5,
          lowAdjustmentPct: 20,
          expectedUpdatedAt: current.updatedAt,
        }),
      );
      assert.equal(saved.highOccupancyPct, 85);
      const fresh = await yieldService.getYieldSettings(hotelId);
      assert.equal(fresh.horizonDays, 21);
    });

    it('fiyat geçmişi uygulanmış çarpanları döner', async () => {
      await fillHigh();
      await as(() => yieldService.generateSuggestions(hotelId));
      const suggestion = await db.priceSuggestion.findFirst({ where: { hotelId, multiplier: { gt: 1 } } });
      await as(() => approvals.decideApproval(hotelId, suggestion.approvalId, 'GRANTED'));

      const history = await yieldService.getPriceHistory(hotelId, { from: new Date(day(0)), to: new Date(day(14)) });
      assert.equal(history.length, 2);
      assert.equal(history[0].multiplier, '1.100');
      assert.equal(history[0].roomTypeCode, 'STD');
    });
  });
});
