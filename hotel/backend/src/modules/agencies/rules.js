import { toDecimal, toMoneyString } from '@hotelos/core';
import { dayText } from '@hotelos/hotel-contracts';

/**
 * Acente satışının saf kuralları (modül 29) — veritabanı, HTTP ve saat bilmez.
 *
 * Kontrat fiyatı **oda başına gecelik**tir (kişi başı ek, tek kişi farkı,
 * çocuk indirimi modül 28'in işi). Para hesabı `@hotelos/core` decimal ile
 * yapılır; fiyat satırdaki tutarın kendisidir, çarpan ya da yuvarlama yoktur.
 */

/** Gün (ISO) bir kaydın iki ucu dahil dönemine düşüyor mu? */
const covers = (item, day) => dayText(item.startDate) <= day && day <= dayText(item.endDate);

/** "2027-06-01" → "01.06.2027" */
const dotted = (value) => {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
};

/** @param {string} day */
function nextDay(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   startDate: Date | string,
 *   endDate: Date | string,
 *   rates: Array<{ roomTypeId: string, boardType: string, startDate: Date | string, endDate: Date | string, price: unknown }>,
 *   stopSales: Array<{ roomTypeId: string | null, startDate: Date | string, endDate: Date | string, reason?: string | null }>,
 * }} SaleContract
 *
 * @typedef {'PRICED' | 'NO_CONTRACT' | 'NO_RATE' | 'STOP_SALE'} NightStatus
 * @typedef {{ date: string, status: NightStatus, amount?: string, contractId?: string, contractName?: string }} SaleNight
 */

/**
 * Bir oda satırının geceleri: her gece için o günü kapsayan satıştaki kontrat,
 * stop-sale ve fiyat. Sıra önemli: kontrat yoksa fiyat aranmaz; stop-sale
 * fiyattan önce gelir (stop-sale'deki geceye fiyat girilmiş olması satışı açmaz).
 *
 * Acentenin aynı günü kapsayan tek aktif kontratı olur (veritabanı kısıtı);
 * iki kontrat aynı günü kapsarsa (olmamalı) ilk bulunan alınır.
 *
 * @param {{ contracts: SaleContract[], roomTypeId: string, boardType: string, days: string[] }} input `days` ISO gün listesi
 * @returns {SaleNight[]}
 */
export function priceAgencyNights({ contracts, roomTypeId, boardType, days }) {
  return days.map((date) => {
    const contract = contracts.find((candidate) => covers(candidate, date));
    if (!contract) return { date, status: 'NO_CONTRACT' };
    const base = { date, contractId: contract.id, contractName: contract.name };
    const stopped = contract.stopSales.some((stop) => (stop.roomTypeId === null || stop.roomTypeId === roomTypeId) && covers(stop, date));
    if (stopped) return { ...base, status: 'STOP_SALE' };
    const rate = contract.rates.find((candidate) => candidate.roomTypeId === roomTypeId && candidate.boardType === boardType && covers(candidate, date));
    if (!rate) return { ...base, status: 'NO_RATE' };
    return { ...base, status: 'PRICED', amount: toMoneyString(String(rate.price)) };
  });
}

/**
 * Fiyatlanan geceleri rezervasyon gecesi biçimine çevirir. Kontrat fiyatında
 * çarpan yoktur; `baseRate` kontrat fiyatının kendisi, `seasonName` kontratın adı
 * (gece dökümünde "hangi kontrattan" görünsün diye).
 *
 * @param {SaleNight[]} nights hepsi `PRICED` olmalı
 * @returns {Array<{ date: string, amount: string, baseRate: string, multiplier: null, seasonName: string | null }>}
 */
export function toReservationNights(nights) {
  return nights.map((night) => {
    if (night.status !== 'PRICED' || night.amount === undefined) {
      throw new Error(`Fiyatlanmamış gece rezervasyona yazılamaz: ${night.date} (${night.status})`);
    }
    return { date: night.date, amount: night.amount, baseRate: night.amount, multiplier: null, seasonName: night.contractName ?? null };
  });
}

/** Ardışık günleri aralıklara birleştirir. @param {string[]} days sıralı ISO günler */
export function compressDays(days) {
  /** @type {Array<{ from: string, to: string }>} */
  const ranges = [];
  for (const day of days) {
    const last = ranges.at(-1);
    if (last && nextDay(last.to) === day) last.to = day;
    else ranges.push({ from: day, to: day });
  }
  return ranges;
}

/** Sorun önceliği: stop-sale kesindir, kontrat yokluğu fiyat yokluğundan önce söylenir. */
const PROBLEM_ORDER = Object.freeze(['STOP_SALE', 'NO_CONTRACT', 'NO_RATE']);

/** Gece durumu → hata kodu. */
export const PROBLEM_CODES = Object.freeze({
  STOP_SALE: 'AGENCY_STOP_SALE',
  NO_CONTRACT: 'AGENCY_NO_CONTRACT',
  NO_RATE: 'AGENCY_NO_RATE',
});

/**
 * Satışı engelleyen geceler, sebebe göre gruplanmış aralıklarla.
 *
 * `requireRate` açıksa (sistem fiyatı kullanılacak) kontrat ya da fiyat yokluğu
 * da engeldir. Kapalıysa (yetkili personel fiyatı elle girdi) yalnızca stop-sale
 * engeller: elle fiyat stop-sale'i aşmaz.
 *
 * @param {SaleNight[]} nights
 * @param {{ requireRate: boolean }} options
 * @returns {Array<{ status: 'STOP_SALE' | 'NO_CONTRACT' | 'NO_RATE', code: string, ranges: Array<{ from: string, to: string }>, days: number }>}
 */
export function saleProblems(nights, { requireRate }) {
  const problems = [];
  for (const status of PROBLEM_ORDER) {
    if (status !== 'STOP_SALE' && !requireRate) continue;
    const days = nights.filter((night) => night.status === status).map((night) => night.date).sort();
    if (days.length === 0) continue;
    problems.push({ status, code: PROBLEM_CODES[status], ranges: compressDays(days), days: days.length });
  }
  return problems;
}

/** Mesajda gösterilen en fazla aralık sayısı (gerisi "+N aralık"). */
const MAX_RANGES_IN_MESSAGE = 3;

/**
 * Kullanıcıya gösterilecek sebep metni.
 * @param {ReturnType<typeof saleProblems>} problems
 * @param {{ agencyName: string, roomTypeName: string, boardLabel: string }} labels
 * @returns {string}
 */
export function describeProblems(problems, { agencyName, roomTypeName, boardLabel }) {
  const rangeText = (range) => (range.from === range.to ? dotted(range.from) : `${dotted(range.from)} – ${dotted(range.to)}`);
  return problems
    .map((problem) => {
      const shown = problem.ranges.slice(0, MAX_RANGES_IN_MESSAGE).map(rangeText).join(', ');
      const hidden = problem.ranges.length - MAX_RANGES_IN_MESSAGE;
      const where = `${shown}${hidden > 0 ? ` (+${hidden} aralık daha)` : ''} ${problem.days > 1 ? 'gecelerinde' : 'gecesinde'}`;
      if (problem.status === 'STOP_SALE') return `${where} ${agencyName} için stop-sale var`;
      if (problem.status === 'NO_CONTRACT') return `${where} ${agencyName} acentesinin satıştaki kontratı yok`;
      return `${where} kontratta ${roomTypeName} / ${boardLabel} fiyatı yok`;
    })
    .join('; ');
}

/**
 * Komisyon tutarı: toplam × yüzde ÷ 100, kuruşa yuvarlanmış (rezervasyon başına).
 * @param {string} total
 * @param {string | number} pct
 */
export function commissionAmount(total, pct) {
  return toMoneyString(toDecimal(total).times(toDecimal(String(pct))).dividedBy(100));
}

/**
 * Taslak kontratın satışa açılabilmesi için eksikler (boşsa açılabilir).
 *
 * @param {{
 *   agencyStatus: string,
 *   contract: { currency: string, endDate: Date | string },
 *   rateCount: number,
 *   hotelCurrency: string,
 *   businessDate: string,
 * }} input
 * @returns {string[]}
 */
export function activationIssues({ agencyStatus, contract, rateCount, hotelCurrency, businessDate }) {
  const issues = [];
  if (agencyStatus !== 'ACTIVE') issues.push('Pasif acentenin kontratı satışa açılamaz; önce acenteyi aktif yapın');
  if (rateCount === 0) issues.push('Satışa açmak için en az bir fiyat satırı girin');
  if (contract.currency !== hotelCurrency) {
    issues.push(`Kontratın para birimi (${contract.currency}) otelin para biriminden (${hotelCurrency}) farklı`);
  }
  if (dayText(contract.endDate) < businessDate) issues.push('Kontrat dönemi geçmiş; satışa açılamaz');
  return issues;
}
