import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import {
  HOTEL_GENERAL_FIELDS,
  TEMPLATE_FIELDS,
  TEMPLATE_NEVER_COPIED,
  dashboardTotalsByCurrency,
  decodeNameCursor,
  encodeNameCursor,
  generalSettingsCopy,
  reportTotalsByCurrency,
  settleWithConcurrency,
} from './rules.js';

const SOURCE = {
  id: 'h1',
  name: 'Kaynak',
  code: 'SRC',
  currency: 'TRY',
  phoneCountryCode: '90',
  checkInTime: '14:00',
  checkOutTime: '12:00',
  defaultBoardType: 'BB',
  cancellationPolicyDays: 3,
  cancellationPolicyPenaltyPct: '50',
  overbookingPolicy: 'REJECT',
  earlyCheckInFeeMode: 'FIXED',
  earlyCheckInFeeValue: '500',
  lateCheckOutFeeMode: 'PERCENT_OF_NIGHT',
  lateCheckOutFeeValue: '50',
  checkInIdentityPolicy: 'ALL_ADULTS',
  largePaymentThreshold: '100000',
  laundryExpressPct: '50',
  lostItemRetentionDays: 90,
  lostItemValuableRetentionDays: 365,
  forecastLowOccupancyPct: 30,
  forecastHighOccupancyPct: 95,
  settings: { portal: 'gizli' },
};

describe('zincir kuralları', () => {
  describe('generalSettingsCopy', () => {
    it('aynı para biriminde bütün genel parametreler gelir; kimlik ve serbest ayar gelmez', () => {
      const { data, skipped } = generalSettingsCopy(SOURCE, { sameCurrency: true });
      assert.deepEqual(Object.keys(data).sort(), [...HOTEL_GENERAL_FIELDS].sort());
      assert.equal(data.largePaymentThreshold, '100000');
      assert.equal(data.earlyCheckInFeeMode, 'FIXED');
      assert.equal('name' in data || 'code' in data || 'settings' in data || 'currency' in data, false);
      assert.deepEqual(skipped, []);
    });

    it('para birimi farklıysa tutarlar gelmez: eşik varsayılana, sabit ücret "ücret yok"a döner; yüzdeli ücret kalır', () => {
      const { data, skipped } = generalSettingsCopy(SOURCE, { sameCurrency: false });
      assert.equal('largePaymentThreshold' in data, false);
      assert.equal(data.earlyCheckInFeeMode, 'NONE');
      assert.equal(data.earlyCheckInFeeValue, '0');
      assert.equal(data.lateCheckOutFeeMode, 'PERCENT_OF_NIGHT');
      assert.equal(data.lateCheckOutFeeValue, '50');
      assert.deepEqual(skipped.sort(), ['earlyCheckInFeeValue', 'largePaymentThreshold']);
    });

    it('şablon tablolarının her alanı için karar verilmiş: kopyalanır ya da asla kopyalanmaz (şemadan)', () => {
      for (const [modelName, fields] of Object.entries(TEMPLATE_FIELDS)) {
        const model = Prisma.dmmf.datamodel.models.find((row) => row.name === modelName);
        const scalars = model.fields.filter((field) => field.kind !== 'object').map((field) => field.name);
        const decided = new Set([...fields, ...TEMPLATE_NEVER_COPIED]);
        assert.deepEqual(scalars.filter((field) => !decided.has(field)), [], `${modelName}: karar verilmemiş alan`);
        for (const field of fields) assert.ok(scalars.includes(field), `${modelName}.${field} şemada yok`);
        // Başka bir kayda bağ (yabancı anahtar) asla kopyalanmaz.
        const foreignKeys = model.fields.flatMap((field) => field.relationFromFields ?? []);
        assert.deepEqual(fields.filter((field) => foreignKeys.includes(field)), [], `${modelName}: bağ alanı kopyalanıyor`);
      }
    });

    it('kopyalanan her alan Hotel tablosunda var (şemadan)', () => {
      const hotel = Prisma.dmmf.datamodel.models.find((model) => model.name === 'Hotel');
      const fields = new Set(hotel.fields.map((field) => field.name));
      for (const field of HOTEL_GENERAL_FIELDS) assert.ok(fields.has(field), field);
    });
  });

  describe('settleWithConcurrency', () => {
    it('sırayı korur, hatalı öğe diğerlerini durdurmaz, aynı anda sınır kadar çalışır', async () => {
      let running = 0;
      let peak = 0;
      const results = await settleWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5 * (7 - item)));
        running -= 1;
        if (item === 3) throw new Error('üç');
        return item * 10;
      });
      assert.equal(peak, 2);
      assert.deepEqual(results.map((row) => (row.ok ? row.value : row.error.message)), [10, 20, 'üç', 40, 50, 60]);
    });

    it('boş listede çalışır', async () => {
      assert.deepEqual(await settleWithConcurrency([], 4, async () => 1), []);
    });
  });

  describe('reportTotalsByCurrency', () => {
    it('para birimine göre ayrı toplar; oranlar toplamdan (ağırlıklı), geçen yıl farkı', () => {
      const rows = [
        { currency: 'TRY', sold: 270, sellable: 300, roomRevenue: '270000.00', totalRevenue: '280000.00', lastYear: { sold: 240, sellable: 300, roomRevenue: '200000.00' } },
        { currency: 'TRY', sold: 2, sellable: 20, roomRevenue: '1000.00', totalRevenue: '1000.00', lastYear: { sold: 10, sellable: 20, roomRevenue: '5000.00' } },
        { currency: 'EUR', sold: 10, sellable: 40, roomRevenue: '1500.50', totalRevenue: '1600.50', lastYear: { sold: 0, sellable: 0, roomRevenue: '0.00' } },
      ];
      const [eur, tryRow] = reportTotalsByCurrency(rows);
      assert.equal(tryRow.currency, 'TRY');
      assert.equal(tryRow.hotels, 2);
      assert.equal(tryRow.sold, 272);
      assert.equal(tryRow.sellable, 320);
      assert.equal(tryRow.occupancyPct, 85); // 272 / 320 (ortalama 50 olurdu)
      assert.equal(tryRow.roomRevenue, '271000.00');
      assert.equal(tryRow.adr, '996.32');
      assert.equal(tryRow.revpar, '846.88');
      assert.equal(tryRow.lastYear.occupancyPct, 78.1);
      assert.equal(tryRow.change.occupancyPts, 6.9);
      assert.equal(tryRow.change.roomRevenue, 32.2);
      assert.equal(eur.currency, 'EUR');
      assert.equal(eur.change.roomRevenue, null);
      assert.equal(eur.lastYear.occupancyPct, null);
    });

    it('satılabilir oda yoksa oranlar tanımsız', () => {
      const [row] = reportTotalsByCurrency([{ currency: 'TRY', sold: 0, sellable: 0, roomRevenue: '0', totalRevenue: '0' }]);
      assert.equal(row.occupancyPct, null);
      assert.equal(row.adr, null);
      assert.equal(row.revpar, null);
    });
  });

  it('dashboardTotalsByCurrency: bu gecenin toplamı ve oranları', () => {
    const [row] = dashboardTotalsByCurrency([
      { currency: 'TRY', sold: 80, sellable: 100, arrivals: 10, departures: 5, inHouse: 70, revenue: '80000.00' },
      { currency: 'TRY', sold: 10, sellable: 50, arrivals: 1, departures: 2, inHouse: 9, revenue: '5000.00' },
    ]);
    assert.deepEqual(
      { hotels: row.hotels, sold: row.sold, sellable: row.sellable, occupancyPct: row.occupancyPct, arrivals: row.arrivals, departures: row.departures, inHouse: row.inHouse, revenue: row.revenue, adr: row.adr, revpar: row.revpar },
      { hotels: 2, sold: 90, sellable: 150, occupancyPct: 60, arrivals: 11, departures: 7, inHouse: 79, revenue: '85000.00', adr: '944.44', revpar: '566.67' },
    );
  });

  it('ad imleci: gidiş-dönüş; bozuk imleç tanınır', () => {
    const cursor = encodeNameCursor({ name: 'Ankara | Çankaya', id: 'abc' });
    assert.deepEqual(decodeNameCursor(cursor), { name: 'Ankara | Çankaya', id: 'abc' });
    assert.equal(decodeNameCursor(undefined), null);
    assert.equal(decodeNameCursor('bozuk!!'), null);
    assert.equal(decodeNameCursor(Buffer.from('[1,2]').toString('base64url')), null);
  });
});
