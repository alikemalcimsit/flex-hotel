import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assetCode,
  assetCountNumber,
  assetImportRowSchema,
  createAssetSchema,
  depreciationRatePct,
  depreciationSchedule,
  disposalResult,
  disposeAssetSchema,
  parseAssetCode,
  plannedDepreciationCents,
  scanAssetCountSchema,
} from './assets.js';

const ROOM = '3f2b8a52-8c1e-4c55-9a43-0d4bfb5a7c11';
const AREA = '7c1d3e9a-2b4f-4a8e-9c6d-5e1f2a3b4c5d';
const CATEGORY = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const REQUEST = '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b';

const baseAsset = (overrides = {}) => ({
  requestId: REQUEST,
  name: 'Lobi koltuğu',
  categoryId: CATEGORY,
  purchaseDate: '2024-03-15',
  cost: '1000',
  areaId: AREA,
  ...overrides,
});

describe('demirbaş kodu', () => {
  test('sıra numarasından altı haneli kod üretir', () => {
    assert.equal(assetCode(1), 'DM-000001');
    assert.equal(assetCode(123456), 'DM-123456');
    assert.equal(assetCountNumber(2026, 7), 'SY-2026-0007');
  });

  test('okutulan QR bağlantısından, küçük harfli ya da boşluklu metinden kodu çıkarır', () => {
    assert.equal(parseAssetCode('https://otel.example/demirbas/k/DM-000123'), 'DM-000123');
    assert.equal(parseAssetCode('  dm-000045\n'), 'DM-000045');
    assert.equal(parseAssetCode('DM-12'), null);
    assert.equal(parseAssetCode('LF-7K2Q9X'), null);
    assert.equal(parseAssetCode(undefined), null);
  });
});

describe('VUK yıllık doğrusal amortisman', () => {
  test('oran = 1 / ömür', () => {
    assert.equal(depreciationRatePct(5), '20.00');
    assert.equal(depreciationRatePct(3), '33.33');
  });

  test('alış yılı tam yıl; kuruş artığı son yıla kalır; toplam maliyete eşittir', () => {
    const rows = depreciationSchedule({ cost: '1000', usefulLifeYears: 3, purchaseYear: 2024 });
    assert.deepEqual(rows.map((row) => [row.year, row.amount, row.source]), [
      [2024, '333.33', 'PLANNED'],
      [2025, '333.33', 'PLANNED'],
      [2026, '333.34', 'PLANNED'],
    ]);
    assert.equal(rows.at(-1).bookValue, '0.00');
    assert.equal(rows.at(-1).accumulated, '1000.00');
  });

  test('alış yılından önce ve tamamen ayrılmış kartta pay sıfırdır', () => {
    assert.equal(plannedDepreciationCents({ costCents: 100000n, accumulatedCents: 0n, usefulLifeYears: 5, purchaseYear: 2025, year: 2024 }), 0n);
    assert.equal(plannedDepreciationCents({ costCents: 100000n, accumulatedCents: 100000n, usefulLifeYears: 5, purchaseYear: 2020, year: 2026 }), 0n);
  });

  test('ömür geçmiş ama kalan varsa (eksik ayrılmış) kalanın tamamı o yıl ayrılır', () => {
    assert.equal(plannedDepreciationCents({ costCents: 100000n, accumulatedCents: 60000n, usefulLifeYears: 3, purchaseYear: 2020, year: 2026 }), 40000n);
  });

  test('açılış tek satırdır; kalan, ömrün kalan yıllarına yayılır', () => {
    const rows = depreciationSchedule({ cost: '10000', usefulLifeYears: 5, purchaseYear: 2023, openingAccumulated: '4000', openingThroughYear: 2024 });
    assert.deepEqual(rows.map((row) => [row.year, row.amount, row.source]), [
      [2024, '4000.00', 'OPENING'],
      [2025, '2000.00', 'PLANNED'],
      [2026, '2000.00', 'PLANNED'],
      [2027, '2000.00', 'PLANNED'],
    ]);
  });

  test('kaydedilmiş yıllar tablodaki planın yerine geçer', () => {
    const rows = depreciationSchedule({ cost: '900', usefulLifeYears: 3, purchaseYear: 2024, posted: [{ year: 2024, amount: '300' }, { year: 2025, amount: '300' }] });
    assert.deepEqual(rows.map((row) => [row.year, row.source]), [
      [2024, 'POSTED'],
      [2025, 'POSTED'],
      [2026, 'PLANNED'],
    ]);
  });

  test('elden çıkarıldığı yıl ve sonrası tabloda yoktur', () => {
    const rows = depreciationSchedule({ cost: '1000', usefulLifeYears: 5, purchaseYear: 2024, disposedYear: 2026 });
    assert.deepEqual(rows.map((row) => row.year), [2024, 2025]);
  });

  test('elden çıkarma: net değer ve kâr / zarar', () => {
    assert.deepEqual(disposalResult({ cost: '1000', accumulated: '600', price: '500' }), { bookValue: '400.00', gainLoss: '100.00' });
    assert.deepEqual(disposalResult({ cost: '1000', accumulated: '600' }), { bookValue: '400.00', gainLoss: '-400.00' });
  });
});

describe('şemalar', () => {
  test('konum tam olarak bir oda ya da bir alandır', () => {
    assert.equal(createAssetSchema.safeParse(baseAsset()).success, true);
    assert.equal(createAssetSchema.safeParse(baseAsset({ roomId: ROOM })).success, false);
    assert.equal(createAssetSchema.safeParse(baseAsset({ areaId: null })).success, false);
    assert.equal(scanAssetCountSchema.safeParse({ code: 'DM-000001', roomId: ROOM }).success, true);
  });

  test('önceki amortisman yıl ister, maliyeti aşamaz, alış yılından önce olamaz', () => {
    const issues = (overrides) => createAssetSchema.safeParse(baseAsset(overrides)).error?.issues.map((issue) => issue.path.join('.')) ?? [];
    assert.deepEqual(issues({ openingAccumulated: '200' }), ['openingThroughYear']);
    assert.deepEqual(issues({ openingAccumulated: '2000', openingThroughYear: 2025 }), ['openingAccumulated']);
    assert.deepEqual(issues({ openingAccumulated: '200', openingThroughYear: 2023 }), ['openingThroughYear']);
    assert.deepEqual(issues({ openingAccumulated: '200', openingThroughYear: 2025, cost: '1000,50' }), []);
  });

  test('satış bedeli yalnız satışta ve satışta zorunlu', () => {
    const base = { expectedUpdatedAt: new Date().toISOString(), disposedOn: '2026-05-01', reason: 'Yenisi alındı' };
    assert.equal(disposeAssetSchema.safeParse({ ...base, type: 'SOLD' }).success, false);
    assert.equal(disposeAssetSchema.safeParse({ ...base, type: 'SOLD', price: '250' }).success, true);
    assert.equal(disposeAssetSchema.safeParse({ ...base, type: 'SCRAPPED', price: '250' }).success, false);
    assert.equal(disposeAssetSchema.safeParse({ ...base, type: 'LOST' }).success, true);
  });

  test('Excel satırı: boş isteğe bağlı hücreler boş kalır, hatalı tutar ve tarih yakalanır', () => {
    const row = { name: 'TV', category: 'Elektronik', location: '101', purchaseDate: '2025-01-10', cost: '15000', usefulLifeYears: '', brand: '', model: '', serialNumber: '', supplierName: '', invoiceNumber: '', warrantyUntil: '', openingAccumulated: '', openingThroughYear: '', employeeCode: '', note: '' };
    const parsed = assetImportRowSchema.parse(row);
    assert.equal(parsed.usefulLifeYears, null);
    assert.equal(parsed.openingAccumulated, null);
    assert.equal(parsed.warrantyUntil, null);
    const broken = assetImportRowSchema.safeParse({ ...row, cost: '15.000,00', purchaseDate: '10.01.2025' });
    assert.deepEqual([...new Set(broken.error.issues.map((issue) => issue.path[0]))].sort(), ['cost', 'purchaseDate']);
  });
});
