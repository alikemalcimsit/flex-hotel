import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FORECAST_DAYS, forecastQuerySchema, forecastSettingsSchema } from './forecast.js';

describe('tahmin sözleşmeleri', () => {
  it('eşikler: tam yüzde, 0–100, yüksek eşik düşükten en az 5 puan büyük; sürüm damgası zorunlu', () => {
    const stamp = '2026-10-05T09:00:00.000Z';
    const parsed = forecastSettingsSchema.parse({ expectedUpdatedAt: stamp, lowPct: '30', highPct: 95 });
    assert.deepEqual({ ...parsed, expectedUpdatedAt: parsed.expectedUpdatedAt.toISOString() }, { expectedUpdatedAt: stamp, lowPct: 30, highPct: 95 });
    const valid = (body) => forecastSettingsSchema.safeParse({ expectedUpdatedAt: stamp, ...body }).success;
    assert.equal(valid({ lowPct: 30.5, highPct: 95 }), false);
    assert.equal(valid({ lowPct: -1, highPct: 95 }), false);
    assert.equal(valid({ lowPct: 30, highPct: 101 }), false);
    const close = forecastSettingsSchema.safeParse({ expectedUpdatedAt: stamp, lowPct: 92, highPct: 95 });
    assert.equal(close.success, false);
    assert.deepEqual(close.error.issues[0].path, ['highPct']);
    assert.equal(valid({ lowPct: 0, highPct: 5 }), true);
    assert.equal(forecastSettingsSchema.safeParse({ lowPct: 30, highPct: 95 }).success, false, 'sürümsüz kayıt ezebilirdi');
  });

  it('gün sayısı varsayılan 30; 1–30 arası tam sayı', () => {
    assert.deepEqual(forecastQuerySchema.parse({}), { days: FORECAST_DAYS });
    assert.deepEqual(forecastQuerySchema.parse({ days: '7' }), { days: 7 });
    assert.equal(forecastQuerySchema.safeParse({ days: 0 }).success, false);
    assert.equal(forecastQuerySchema.safeParse({ days: 31 }).success, false);
    assert.equal(forecastQuerySchema.safeParse({ days: 'abc' }).success, false);
  });
});
