import { expectedUpdatedAt } from './fields.js';
import { z } from './locale.js';
import { REPORT_LAST_YEAR_OFFSET_DAYS } from './reports.js';

/**
 * Doluluk ve gelir tahmini sözleşmeleri (modül 25).
 *
 * Tanımlar (otelcilik karşılıkları):
 *
 * - **Eldeki (on the books, "gerçek"):** bugün elde olan rezervasyonların
 *   gecesi ve gece fiyatından geliri (vergiler hariç) — gelir raporu ve günlük
 *   durumla aynı tanım (opsiyonlu + kesin + içeride).
 * - **Pickup:** bir günün "o gün kala" eldeki gecesi ile gün geçtikten sonra
 *   gerçekleşen gecesi arasındaki fark: aradaki yeni satış eksi iptal, gelmeyen
 *   ve erken çıkış. Eksi olabilir.
 * - **Tahmin = eldeki + beklenen pickup** (kullanıcı kararı, 5 Ekim 2026):
 *   beklenen pickup, karşılaştırma günlerinin **aynı gün kala** gerçekleşen
 *   pickup'ının ortalamasıdır — geçen yılın aynı dönemi (haftanın aynı günü,
 *   364 gün önce ± 1 hafta); geçen yılın verisi yoksa son 8 haftanın aynı
 *   günleri; o da yoksa tahmin eldekiyle aynıdır. Hangi kaynaktan tahmin
 *   edildiği her gün için verilir.
 * - **Kritik gün:** tahmini doluluk yüksek eşiğin üstünde ya da düşük eşiğin
 *   altında; eldeki satış satılabilir odayı aşmışsa fazla satış. Düşük doluluk
 *   tahmin ister (karşılaştırma verisi yokken uzak günlerin eldekisi doğal
 *   olarak düşüktür); yüksek doluluk ve fazla satış eldekiyle de işaretlenir.
 *   Eşikler otel ayarı (varsayılan %30 / %95; kullanıcı kararı).
 */

/** Tahmin penceresi: iş günü dahil önümüzdeki gün sayısı. */
export const FORECAST_DAYS = 30;
/** Geçen yılın karşılık günü: haftanın aynı günü — gelir raporunun sabiti (ikisi ayrışmasın). */
export const FORECAST_LAST_YEAR_OFFSET_DAYS = REPORT_LAST_YEAR_OFFSET_DAYS;
/** Geçen yıl karşılık gününün iki yanında bakılan hafta sayısı (± hafta, aynı gün). */
export const FORECAST_LAST_YEAR_WINDOW_WEEKS = 1;
/** Geçen yılın verisi yoksa bakılan son hafta sayısı (aynı gün). */
export const FORECAST_RECENT_WEEKS = 8;
/** Bir kaynağın kullanılması için gereken en az karşılaştırma günü. */
export const FORECAST_MIN_SAMPLES = 2;

/** Tahminin dayandığı karşılaştırma. */
export const FORECAST_BASES = Object.freeze(['LAST_YEAR', 'RECENT', 'NONE']);

export const FORECAST_BASIS_LABELS = Object.freeze({
  LAST_YEAR: 'Geçen yılın aynı dönemi',
  RECENT: 'Son haftalar',
  NONE: 'Karşılaştırma verisi yok (eldeki)',
});

/** Kritik gün türleri (önem sırasıyla). */
export const FORECAST_ALERTS = Object.freeze(['OVERBOOKED', 'HIGH', 'LOW']);

export const FORECAST_ALERT_LABELS = Object.freeze({
  OVERBOOKED: 'Fazla satış',
  HIGH: 'Çok yüksek doluluk',
  LOW: 'Düşük doluluk',
});

/** Eşik varsayılanları (yüzde). */
export const FORECAST_DEFAULT_LOW_PCT = 30;
export const FORECAST_DEFAULT_HIGH_PCT = 95;
/** Eşik sınırları (yüzde) ve iki eşik arasındaki en az fark (puan). */
export const FORECAST_THRESHOLD_MIN_PCT = 0;
export const FORECAST_THRESHOLD_MAX_PCT = 100;
export const FORECAST_THRESHOLD_MIN_GAP_PCT = 5;

const pct = (label) =>
  z.coerce
    .number({ error: `${label} sayı olmalı` })
    .int(`${label} tam sayı olmalı`)
    .min(FORECAST_THRESHOLD_MIN_PCT, `${label} en az %${FORECAST_THRESHOLD_MIN_PCT} olabilir`)
    .max(FORECAST_THRESHOLD_MAX_PCT, `${label} en fazla %${FORECAST_THRESHOLD_MAX_PCT} olabilir`);

/**
 * Kritik gün eşikleri. `expectedUpdatedAt`: otel kaydının okunan sürümü — iki
 * kişi aynı anda değiştirirse ikincisi öncekini sessizce ezmez.
 */
export const forecastSettingsSchema = z
  .object({
    expectedUpdatedAt,
    lowPct: pct('Düşük doluluk eşiği'),
    highPct: pct('Yüksek doluluk eşiği'),
  })
  .refine((value) => value.highPct - value.lowPct >= FORECAST_THRESHOLD_MIN_GAP_PCT, {
    path: ['highPct'],
    message: `Yüksek eşik düşük eşikten en az ${FORECAST_THRESHOLD_MIN_GAP_PCT} puan büyük olmalı`,
  });

/** Tahmin isteği (ekran ve MCP `get_forecast`). */
export const forecastQuerySchema = z.object({
  days: z.coerce
    .number({ error: 'Gün sayısı sayı olmalı' })
    .int('Gün sayısı tam sayı olmalı')
    .min(1, 'En az 1 gün')
    .max(FORECAST_DAYS, `En fazla ${FORECAST_DAYS} gün`)
    .default(FORECAST_DAYS),
});
