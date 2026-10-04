import { z } from './locale.js';

/**
 * Gelir raporları sözleşmeleri (modül 23).
 *
 * Tanımlar (otelcilik karşılıkları; günlük durum ekranıyla — modül 13 — aynı):
 *
 * - **Satılan oda (room nights sold):** bugün ve sonrası opsiyonlu, kesin ve
 *   içerideki konaklamanın geceleri (eldeki); geçmiş gecelerde yalnızca
 *   gerçekleşen konaklama — içeride ya da çıkmış. Gelmeyen misafirin gecesi
 *   ("gelmedi" işaretlenmemiş olsa da) ve erken çıkışta bırakılan geceler
 *   sayılmaz (backend `countsSoldNight`; oda planı ve günlük durumla ortak).
 * - **Satılabilir oda:** o gece kayıtlı oda − arızalı (envanterden düşen) oda;
 *   sonradan silinen oda silindiği güne kadar sayılır.
 * - **Doluluk** = satılan / satılabilir. **ADR** = oda geliri / satılan.
 *   **RevPAR** = oda geliri / satılabilir. Oranlar toplamlardan hesaplanır
 *   (günlük oranların ortalaması alınmaz).
 * - **Oda geliri vergiler hariçtir.** Geçmiş günlerde **folyoya işlenen**
 *   gerçekleşen gelir (gece oda ücretleri, fiyat düzeltmeleri, oda indirimleri,
 *   iptaller — iptal işlendiği güne düşer); bugün ve sonrası rezervasyonun gece
 *   fiyatlarından **eldeki** gelir (kullanıcı kararı, 4 Ekim 2026).
 * - Erken giriş / geç çıkış ücretleri ve iptal / gelmeme gelirleri ayrı
 *   sütundur; ADR / RevPAR'a girmez (satılmış bir geceye ait değiller).
 * - **Geçen yıl:** haftanın aynı günü, 364 gün öncesi (kullanıcı kararı).
 */

/** Gruplama: gün, hafta (pazartesi başlar), ay. */
export const REPORT_GROUPINGS = Object.freeze(['DAY', 'WEEK', 'MONTH']);

export const REPORT_GROUPING_LABELS = Object.freeze({ DAY: 'Gün', WEEK: 'Hafta', MONTH: 'Ay' });

/** Kırılımlar. */
export const REPORT_BREAKDOWNS = Object.freeze(['ROOM_TYPE', 'SOURCE']);

export const REPORT_BREAKDOWN_LABELS = Object.freeze({ ROOM_TYPE: 'Oda tipi', SOURCE: 'Rezervasyon kaynağı' });

/** Grafikte seçilen ölçü. */
export const REPORT_METRICS = Object.freeze(['OCCUPANCY', 'ADR', 'REVPAR', 'ROOM_REVENUE']);

export const REPORT_METRIC_LABELS = Object.freeze({
  OCCUPANCY: 'Doluluk',
  ADR: 'ADR (ortalama oda fiyatı)',
  REVPAR: 'RevPAR (satılabilir oda başına gelir)',
  ROOM_REVENUE: 'Oda geliri',
});

/** Tek raporun en uzun aralığı (gün): bir yıl + artık gün. */
export const REPORT_MAX_RANGE_DAYS = 366;
/** Geçen yıl karşılaştırması: haftanın aynı günü (52 hafta öncesi). */
export const REPORT_LAST_YEAR_OFFSET_DAYS = 364;
/** Raporun en ileri günü: iş gününden bu kadar sonrası (eldeki rezervasyon). */
export const REPORT_MAX_FUTURE_DAYS = 730;
/** Raporun en eski günü (yazım hatasını yakalamak için). */
export const REPORT_EARLIEST_DAY = '2000-01-01';

/**
 * MCP'nin parametrik rapor sorguları (`run_report_query`): serbest SQL yok,
 * yalnızca adı verilen, girdisi doğrulanan raporlar.
 */
export const REPORT_QUERY_NAMES = Object.freeze(['occupancy_by_period', 'revenue_by_period', 'revenue_by_room_type', 'revenue_by_source']);

export const REPORT_QUERY_DESCRIPTIONS = Object.freeze({
  occupancy_by_period: 'Dönem dönem doluluk: satılan / satılabilir oda, doluluk yüzdesi, geçen yılın aynı dönemi.',
  revenue_by_period: 'Dönem dönem oda geliri (vergiler hariç), ADR, RevPAR, ek ücretler, iptal geliri; geçen yılla.',
  revenue_by_room_type: 'Aralığın oda tipine göre satılan gecesi, oda geliri, ADR ve payı; geçen yılla.',
  revenue_by_source: 'Aralığın rezervasyon kaynağına göre satılan gecesi, oda geliri, ADR ve payı; geçen yılla.',
});

/* ─────────────── Tarih yardımcıları ─────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "YYYY-AA-GG" geçerli bir takvim günü mü (2026-02-30 değil)?
 * @param {string} value
 */
export function isCalendarDay(value) {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/**
 * Güne gün ekler (eksi de olur).
 * @param {string} day "YYYY-AA-GG"
 * @param {number} days
 */
export function shiftDay(day, days) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Aralıktaki gün sayısı (iki uç dahil).
 * @param {string} from
 * @param {string} to
 */
export function reportDayCount(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;
}

/**
 * Aralık geçerli mi? Değilse sebep (alan adıyla).
 * @param {string} from
 * @param {string} to
 * @returns {{ field: 'from' | 'to', message: string } | null}
 */
export function reportRangeError(from, to) {
  if (!isCalendarDay(from)) return { field: 'from', message: 'Başlangıç tarihi geçersiz' };
  if (!isCalendarDay(to)) return { field: 'to', message: 'Bitiş tarihi geçersiz' };
  if (from < REPORT_EARLIEST_DAY) return { field: 'from', message: `Başlangıç ${REPORT_EARLIEST_DAY} öncesi olamaz` };
  if (to < from) return { field: 'to', message: 'Bitiş tarihi başlangıçtan önce olamaz' };
  if (reportDayCount(from, to) > REPORT_MAX_RANGE_DAYS) {
    return { field: 'to', message: `Bir raporda en fazla ${REPORT_MAX_RANGE_DAYS} gün seçilir` };
  }
  return null;
}

/* ─────────────── Şemalar ─────────────── */

const dayField = (label) =>
  z
    .string({ error: `${label} zorunlu` })
    .trim()
    .refine(isCalendarDay, { message: `${label} YYYY-AA-GG biçiminde geçerli bir gün olmalı` });

/** Rapor aralığı (ekranın ve MCP araçlarının ortak girdisi). */
export const reportRangeSchema = z
  .object({
    from: dayField('Başlangıç tarihi'),
    to: dayField('Bitiş tarihi'),
    groupBy: z.enum(REPORT_GROUPINGS, { error: 'Geçersiz gruplama' }).default('DAY'),
  })
  .superRefine((value, ctx) => {
    const error = reportRangeError(value.from, value.to);
    if (error) ctx.addIssue({ code: 'custom', path: [error.field], message: error.message });
  });

/** Kırılım raporu (oda tipi / kaynak): gruplama yok, aralığın toplamı. */
export const reportBreakdownSchema = z
  .object({
    from: dayField('Başlangıç tarihi'),
    to: dayField('Bitiş tarihi'),
    by: z.enum(REPORT_BREAKDOWNS, { error: 'Geçersiz kırılım' }),
  })
  .superRefine((value, ctx) => {
    const error = reportRangeError(value.from, value.to);
    if (error) ctx.addIssue({ code: 'custom', path: [error.field], message: error.message });
  });
