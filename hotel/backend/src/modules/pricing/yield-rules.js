import { toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';

/**
 * Yield kuralları (modül 34) — veritabanı ve saat bilmez. Girdi: gün gün
 * doluluk; çıktı: oda tipi başına, **ardışık aynı-çarpanlı günler tek öneri**
 * olacak şekilde birleştirilmiş fiyat önerileri. 2500 odalı otelde onay
 * kuyruğunu gün × tip kadar kalemle boğmamak için birleştirme şarttır.
 *
 * Hiçbir öneri kendiliğinden uygulanmaz; karar M11 onay kuyruğunda.
 */

const DAY_MS = 86_400_000;

/** @param {number} pct yüzde (+10 artış, −15 indirim) → "1.100" / "0.850" */
export function pctToMultiplier(pct) {
  return toDecimal(1).plus(toDecimal(pct).dividedBy(100)).toFixed(3);
}

/**
 * Tek günün kural kararı: çarpan + kural adı; kural tetiklenmediyse `null`.
 *
 * @param {{ occupancyPct: number, daysOut: number }} day
 * @param {{ highOccupancyPct: number, highAdjustmentPct: number, lowOccupancyPct: number, lowDaysOut: number, lowAdjustmentPct: number }} settings
 * @returns {{ multiplier: string, rule: 'HIGH_OCCUPANCY' | 'LOW_OCCUPANCY_LAST_MINUTE' } | null}
 */
export function evaluateDay(day, settings) {
  if (day.occupancyPct >= settings.highOccupancyPct) {
    return { multiplier: pctToMultiplier(settings.highAdjustmentPct), rule: 'HIGH_OCCUPANCY' };
  }
  if (day.occupancyPct <= settings.lowOccupancyPct && day.daysOut <= settings.lowDaysOut) {
    return { multiplier: pctToMultiplier(-settings.lowAdjustmentPct), rule: 'LOW_OCCUPANCY_LAST_MINUTE' };
  }
  return null;
}

/**
 * Kural gerekçesi (Türkçe, öneri kartında gösterilir).
 * @param {'HIGH_OCCUPANCY' | 'LOW_OCCUPANCY_LAST_MINUTE'} rule
 * @param {{ occupancyPct: number, daysOut: number }} first dönemin ilk günü
 * @param {object} settings
 * @param {number} nights dönem gece sayısı
 */
export function ruleReason(rule, first, settings, nights) {
  const span = nights > 1 ? `${nights} gece boyunca ` : '';
  if (rule === 'HIGH_OCCUPANCY') {
    return (
      `${span}tahmini doluluk %${Math.round(first.occupancyPct)} — yüksek doluluk eşiğinin (%${settings.highOccupancyPct}) ` +
      `üzerinde; fiyat +%${settings.highAdjustmentPct} önerildi.`
    );
  }
  return (
    `${span}tahmini doluluk %${Math.round(first.occupancyPct)} ve girişe ${first.daysOut} gün kaldı — düşük doluluk ` +
    `eşiğinin (%${settings.lowOccupancyPct}, son ${settings.lowDaysOut} gün) altında; fiyat −%${settings.lowAdjustmentPct} önerildi.`
  );
}

/**
 * Gün gün doluluktan birleşik öneriler.
 *
 * @param {Array<{ roomTypeId: string, date: string, occupancyPct: number, sellable: number, sold: number, daysOut: number, lastYearOccupancyPct: number | null }>} days
 *   tip × gün satırları ("YYYY-MM-DD"; sıralı olması gerekmez)
 * @param {{ highOccupancyPct: number, highAdjustmentPct: number, lowOccupancyPct: number, lowDaysOut: number, lowAdjustmentPct: number }} settings
 * @returns {Array<{ roomTypeId: string, startDate: string, endDate: string, multiplier: string, rule: string, reason: string, days: Array<object> }>}
 *   `days`: dönemin yapılandırılmış girdileri (FlexAI 2.0 — öneri `inputs` alanına yazılır)
 */
export function evaluateYield(days, settings) {
  const byType = new Map();
  for (const day of days) {
    const list = byType.get(day.roomTypeId) ?? [];
    list.push(day);
    byType.set(day.roomTypeId, list);
  }

  const suggestions = [];
  for (const [roomTypeId, list] of byType) {
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
    /** @type {{ multiplier: string, rule: string, days: object[] } | null} */
    let open = null;
    const flush = () => {
      if (!open) return;
      const first = open.days[0];
      suggestions.push({
        roomTypeId,
        startDate: first.date,
        endDate: open.days.at(-1).date,
        multiplier: open.multiplier,
        rule: open.rule,
        reason: ruleReason(/** @type {any} */ (open.rule), first, settings, open.days.length),
        days: open.days,
      });
      open = null;
    };

    for (const day of sorted) {
      const decision = evaluateDay(day, settings);
      const snapshot = {
        date: day.date,
        occupancyPct: day.occupancyPct,
        sellable: day.sellable,
        sold: day.sold,
        daysOut: day.daysOut,
        lastYearOccupancyPct: day.lastYearOccupancyPct ?? null,
      };
      if (!decision) {
        flush();
        continue;
      }
      const previous = open ? toUtcMs(open.days.at(-1).date) : null;
      const consecutive = previous !== null && toUtcMs(day.date) - previous === DAY_MS;
      if (open && (open.multiplier !== decision.multiplier || open.rule !== decision.rule || !consecutive)) flush();
      if (!open) open = { multiplier: decision.multiplier, rule: decision.rule, days: [] };
      open.days.push(snapshot);
    }
    flush();
  }
  return suggestions;
}

/** @param {string} day */
function toUtcMs(day) {
  return new Date(`${day}T00:00:00.000Z`).getTime();
}

/**
 * Bir gecenin fiyatına onaylı çarpanı uygular (kuruşa yuvarlanır).
 * @param {string} amount "1234.50"
 * @param {string | number} multiplier "1.100"
 */
export function applyPriceMultiplier(amount, multiplier) {
  return toMoneyString(toDecimal(amount).times(toDecimal(String(multiplier))));
}

/**
 * Takvimden (rooms `buildAvailabilityCalendar`) kural girdisi üretir.
 *
 * @param {{ days: string[], byRoomType: Record<string, { total: number, days: Record<string, { total: number, outOfOrder: number, free: number }> }> }} calendar
 * @param {{ today: string, lastYearByKey?: Map<string, number> }} context
 *   `lastYearByKey`: `${roomTypeId}|${day}` → geçen yıl satılan gece (364 gün önce)
 * @returns {Array<{ roomTypeId: string, date: string, occupancyPct: number, sellable: number, sold: number, daysOut: number, lastYearOccupancyPct: number | null }>}
 */
export function calendarToYieldDays(calendar, { today, lastYearByKey }) {
  const todayMs = toUtcMs(today);
  const rows = [];
  for (const [roomTypeId, entry] of Object.entries(calendar.byRoomType)) {
    for (const day of calendar.days) {
      const cell = entry.days[day];
      if (!cell) continue;
      const sellable = cell.total - cell.outOfOrder;
      if (sellable <= 0) continue;
      const sold = Math.max(0, sellable - Math.max(0, cell.free));
      const lastYearSold = lastYearByKey?.get(`${roomTypeId}|${toIsoDay(shiftDays(day, -364))}`);
      rows.push({
        roomTypeId,
        date: day,
        occupancyPct: (sold / sellable) * 100,
        sellable,
        sold,
        daysOut: Math.round((toUtcMs(day) - todayMs) / DAY_MS),
        lastYearOccupancyPct: lastYearSold === undefined ? null : Math.round((lastYearSold / sellable) * 100),
      });
    }
  }
  return rows;
}

/** @param {string} day @param {number} offset */
function shiftDays(day, offset) {
  return new Date(toUtcMs(day) + offset * DAY_MS);
}
