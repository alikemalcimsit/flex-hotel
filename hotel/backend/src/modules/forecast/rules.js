import { toDecimal, toMoneyString } from '@hotelos/core';
import {
  FORECAST_LAST_YEAR_OFFSET_DAYS,
  FORECAST_LAST_YEAR_WINDOW_WEEKS,
  FORECAST_MIN_SAMPLES,
  FORECAST_RECENT_WEEKS,
  reportDayCount,
  shiftDay,
} from '@hotelos/hotel-contracts';

/**
 * Doluluk ve gelir tahmininin saf kuralları (modül 25) — veritabanı bilmez,
 * birim testli. Tanımlar `contracts/forecast.js`.
 *
 * ### Pickup
 *
 * Tahmin günü `day` için "gün kala" sayısı `lead` (bugün 0). Karşılaştırma
 * günü `ref = day − Δ`; "o gün kala" anı `asOf = şimdi − Δ` (aynı gün kala,
 * günün aynı saati — bugünün eldekiyle aynı anda ölçülmüş olur). Örnek
 * pickup = (ref günü gerçekleşen gece − asOf anında ref için eldeki gece) /
 * ref günü satılabilir oda. Satılabilire bölünür: otelin oda sayısı
 * değişse de oran taşınır.
 *
 * Karşılaştırma ancak `asOf` anında sistemde kayıt varsa geçerlidir
 * (`dataStart` = otelin ilk rezervasyon kaydı): yoksa "o gün kala eldeki"
 * sıfır görünür ve pickup gerçekleşenin tamamı sanılırdı.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

/** Tahmini gece (beklenen değer) bir ondalıkla tutulur; ekran yuvarlar. */
const NIGHTS_PRECISION = 10;
const roundNights = (value) => Math.round(value * NIGHTS_PRECISION) / NIGHTS_PRECISION;
/** Yüzde, bir ondalık. */
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/**
 * @typedef {{ day: string, asOf: Date }} ReferencePoint
 */

/**
 * Bir tahmin gününün karşılaştırma noktaları.
 *
 * - Geçen yıl: haftanın aynı günü 364 gün önce ve ± `FORECAST_LAST_YEAR_WINDOW_WEEKS` hafta.
 * - Son haftalar: aynı gün, bugünden önceki en yakın `FORECAST_RECENT_WEEKS` hafta
 *   (gün kalası kadar geriye gidilir: 20 gün sonrası için en yakın karşılık 21 gün önce).
 *
 * @param {{ day: string, businessDate: string, now: Date, dataStart: Date | null }} input
 * @returns {{ lead: number, lastYear: ReferencePoint[], recent: ReferencePoint[] }}
 */
export function referencePoints({ day, businessDate, now, dataStart }) {
  const lead = reportDayCount(businessDate, day) - 1;
  const point = (delta) => ({ day: shiftDay(day, -delta), asOf: new Date(now.getTime() - delta * DAY_MS) });
  const known = (ref) => dataStart !== null && ref.asOf.getTime() >= dataStart.getTime() && ref.day < businessDate;

  const lastYear = [];
  for (let week = -FORECAST_LAST_YEAR_WINDOW_WEEKS; week <= FORECAST_LAST_YEAR_WINDOW_WEEKS; week += 1) {
    const ref = point(FORECAST_LAST_YEAR_OFFSET_DAYS + week * WEEK_DAYS);
    if (known(ref)) lastYear.push(ref);
  }

  const recent = [];
  const firstWeek = Math.floor(lead / WEEK_DAYS) + 1; // geçmiş en yakın aynı gün
  for (let week = firstWeek; week < firstWeek + FORECAST_RECENT_WEEKS; week += 1) {
    const ref = point(week * WEEK_DAYS);
    if (known(ref)) recent.push(ref);
  }
  return { lead, lastYear, recent };
}

/**
 * Bir karşılaştırma noktasının pickup oranı (satılabilir odaya göre). Satılabilir
 * oda yoksa örnek sayılmaz (`null`).
 * @param {{ onBooks: number, final: number, sellable: number }} sample
 */
export function pickupRate({ onBooks, final, sellable }) {
  if (!(sellable > 0)) return null;
  return (final - onBooks) / sellable;
}

/**
 * Kullanılabilir örnekler (satılabilir odası olan karşılaştırma noktaları).
 * @param {Array<number | null>} rates
 * @returns {number[]}
 */
export function usableRates(rates) {
  return rates.filter((rate) => rate !== null && Number.isFinite(rate));
}

/**
 * Kaynak seçimi: geçen yılın yeterli örneği varsa o, yoksa son haftalar, o da
 * yoksa pickup yok (tahmin = eldeki).
 *
 * @param {{ lastYear: Array<number | null>, recent: Array<number | null> }} rates
 * @returns {{ basis: 'LAST_YEAR' | 'RECENT' | 'NONE', rate: number, samples: number }}
 */
export function chooseBasis({ lastYear, recent }) {
  const mean = (list) => list.reduce((total, rate) => total + rate, 0) / list.length;
  const ly = usableRates(lastYear);
  if (ly.length >= FORECAST_MIN_SAMPLES) return { basis: 'LAST_YEAR', rate: mean(ly), samples: ly.length };
  const near = usableRates(recent);
  if (near.length >= FORECAST_MIN_SAMPLES) return { basis: 'RECENT', rate: mean(near), samples: near.length };
  return { basis: 'NONE', rate: 0, samples: 0 };
}

/**
 * Bir günün tahmini.
 *
 * - Gece: eldeki + oran × satılabilir. Artı pickup satılabilir odayı (eldeki
 *   zaten fazlaysa eldekini) aşmaz; eksi pickup sıfırın altına indirmez.
 * - Gelir: eldeki gelir + (tahmini − eldeki gece) × ADR. ADR o günün eldeki
 *   ADR'si; o gün satış yoksa `fallbackAdr` (pencerenin eldeki ADR'si, o da
 *   yoksa geçen yılın aynı döneminin ADR'si). ADR bilinmiyorsa pickup'ın
 *   geliri eklenmez.
 *
 * @param {{
 *   sold: number,
 *   sellable: number,
 *   revenue: import('@hotelos/core').Decimal | string,
 *   rate: number,
 *   fallbackAdr: import('@hotelos/core').Decimal | null,
 * }} input
 */
export function forecastDay({ sold, sellable, revenue, rate, fallbackAdr }) {
  const pickup = rate * sellable;
  let nights = sold + pickup;
  if (pickup > 0) nights = Math.min(nights, Math.max(sellable, sold));
  nights = Math.max(0, nights);

  const onBooksRevenue = toDecimal(revenue);
  const adr = sold > 0 ? onBooksRevenue.dividedBy(sold) : fallbackAdr;
  const extra = nights - sold;
  const forecastRevenue = adr && extra !== 0 ? onBooksRevenue.plus(adr.times(extra)) : onBooksRevenue;
  return {
    nights: roundNights(nights),
    pickup: roundNights(nights - sold),
    occupancyPct: percent(nights, sellable),
    revenue: forecastRevenue.isNegative() ? toDecimal(0) : forecastRevenue,
  };
}

/**
 * Kritik gün: fazla satış (eldeki > satılabilir), tahmin yüksek eşiğin
 * üstünde ya da düşük eşiğin altında. Satılabilir oda yoksa (hepsi arızalı)
 * yalnızca fazla satış uyarılır.
 *
 * Düşük doluluk **tahmin ister**: karşılaştırma verisi yokken (`NONE`)
 * tahmin = eldeki ve uzak günlerin eldekisi doğal olarak düşüktür — her uzak
 * gün "riskli" görünürdü. Yüksek doluluk ve fazla satış eldekiyle de
 * işaretlenir: satılmış oda gerçektir.
 *
 * @param {{ sold: number, sellable: number, forecastPct: number | null, basis: 'LAST_YEAR' | 'RECENT' | 'NONE', lowPct: number, highPct: number }} input
 * @returns {'OVERBOOKED' | 'HIGH' | 'LOW' | null}
 */
export function alertFor({ sold, sellable, forecastPct, basis, lowPct, highPct }) {
  if (sold > sellable) return 'OVERBOOKED';
  if (forecastPct === null) return null;
  if (forecastPct > highPct) return 'HIGH';
  if (forecastPct < lowPct && basis !== 'NONE') return 'LOW';
  return null;
}

/**
 * Pencerenin eldeki ADR'si (gece fiyatlı satış yoksa `null`).
 * @param {Array<{ sold: number, revenue: import('@hotelos/core').Decimal | string }>} days
 */
export function windowAdr(days) {
  const sold = days.reduce((total, day) => total + day.sold, 0);
  if (sold === 0) return null;
  return days.reduce((total, day) => total.plus(toDecimal(day.revenue)), toDecimal(0)).dividedBy(sold);
}

/**
 * Pencerenin toplamı: eldeki, tahmin, geçen yılın aynı günleri; oranlar
 * toplamlardan.
 *
 * @param {Array<{
 *   sellable: number,
 *   onBooks: { sold: number, revenue: string },
 *   forecast: { nights: number, revenue: string },
 *   lastYear: { sold: number, sellable: number, revenue: string },
 * }>} days
 */
export function forecastTotals(days) {
  const sum = (pick) => days.reduce((total, day) => total + pick(day), 0);
  const money = (pick) => days.reduce((total, day) => total.plus(toDecimal(pick(day))), toDecimal(0));
  const sellable = sum((day) => day.sellable);
  const sold = sum((day) => day.onBooks.sold);
  const nights = roundNights(sum((day) => day.forecast.nights));
  const lySold = sum((day) => day.lastYear.sold);
  const lySellable = sum((day) => day.lastYear.sellable);
  const revenue = money((day) => day.onBooks.revenue);
  const forecastRevenue = money((day) => day.forecast.revenue);
  const lyRevenue = money((day) => day.lastYear.revenue);
  const change = (now, before) => (before.isZero() ? null : Math.round(now.minus(before).dividedBy(before.abs()).times(1000).toNumber()) / 10);
  const forecastPct = percent(nights, sellable);
  const lyPct = percent(lySold, lySellable);
  return {
    sellable,
    onBooks: { sold, occupancyPct: percent(sold, sellable), revenue: toMoneyString(revenue) },
    forecast: {
      nights,
      pickup: roundNights(nights - sold),
      occupancyPct: forecastPct,
      revenue: toMoneyString(forecastRevenue),
      /** Beklenen satışın (eksiyse iptal / gelmeyenin) geliri: tahmin − eldeki. */
      pickupRevenue: toMoneyString(forecastRevenue.minus(revenue)),
      adr: nights > 0 ? toMoneyString(forecastRevenue.dividedBy(nights)) : null,
    },
    lastYear: {
      sold: lySold,
      sellable: lySellable,
      occupancyPct: lyPct,
      revenue: toMoneyString(lyRevenue),
      adr: lySold > 0 ? toMoneyString(lyRevenue.dividedBy(lySold)) : null,
    },
    change: {
      occupancyPts: forecastPct === null || lyPct === null ? null : Math.round((forecastPct - lyPct) * 10) / 10,
      revenue: change(forecastRevenue, lyRevenue),
    },
  };
}
