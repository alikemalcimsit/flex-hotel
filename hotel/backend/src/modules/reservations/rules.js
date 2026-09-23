import { addDays, eachNight, sum, toDecimal, toIsoDay, toMoneyString, toUtcDayStart } from '@hotelos/core';
import { findSeasonForDate } from '../settings/rules.js';

/**
 * Rezervasyon yönetiminin saf kuralları (modül 4) — veritabanı, HTTP ve saat
 * bilmez; "bugün" dışarıdan verilir. Para hesabı `@hotelos/core/money.js`
 * (decimal) ile yapılır, `Number()` ile çarpılmaz; yuvarlama yalnızca gece
 * tutarı yazılırken yapılır.
 */

const DAY_MS = 86_400_000;

/* ══════════════════ Onay kodu ══════════════════ */

/**
 * Onay kodunda kullanılan harfler: telefonda okunurken karışanlar (0/O, 1/I/L,
 * 2/Z, 5/S, 6/G, 8/B) yok. 25 harf × 6 hane ≈ 244 milyon kod; otel başına
 * önek ayrıca çakışmayı düşürür. Tekillik veritabanında (`confirmationCode`
 * tekil), çakışmada yeniden üretilir.
 */
export const CONFIRMATION_CODE_ALPHABET = 'ACDEFHJKMNPQRTUVWXY347';
export const CONFIRMATION_CODE_LENGTH = 6;
/** Önek (otel kodu) en fazla bu kadar karakter. */
const CONFIRMATION_PREFIX_MAX = 6;

/**
 * Otel kodundan önek: yalnızca harf ve rakam, büyük harf.
 * @param {string} hotelCode
 */
export function confirmationCodePrefix(hotelCode) {
  const cleaned = String(hotelCode ?? '')
    .toLocaleUpperCase('en-US')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CONFIRMATION_PREFIX_MAX);
  return cleaned || 'R';
}

/**
 * @param {string} hotelCode
 * @param {(size: number) => Uint8Array} randomBytes kriptografik rastgele bayt üreticisi
 * @returns {string} ör. "DEMO-K7QXNA"
 */
export function generateConfirmationCode(hotelCode, randomBytes) {
  const alphabet = CONFIRMATION_CODE_ALPHABET;
  // Eşit dağılım için alfabe boyunun katı altındaki baytlar kullanılır
  // (modulo sapması yok).
  const limit = 256 - (256 % alphabet.length);
  let code = '';
  while (code.length < CONFIRMATION_CODE_LENGTH) {
    for (const byte of randomBytes(CONFIRMATION_CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      code += alphabet[byte % alphabet.length];
      if (code.length === CONFIRMATION_CODE_LENGTH) break;
    }
  }
  return `${confirmationCodePrefix(hotelCode)}-${code}`;
}

/* ══════════════════ Fiyat ══════════════════ */

/**
 * @typedef {{ date: string, amount: string, baseRate: string | null, multiplier: string | null, seasonName: string | null }} PricedNight
 */

/**
 * Konaklamanın gece gece fiyatı: **oda tipinin taban fiyatı × o geceye düşen
 * sezon çarpanı**. Sezonu olmayan gece taban fiyattır. Her gece kuruşa
 * yuvarlanır; toplam, yuvarlanmış gecelerin toplamıdır (gece tablosu ile
 * toplam hiçbir zaman ayrışmaz).
 *
 * Fiyat oda başınadır: kişi sayısı ve pansiyon fiyatı değiştirmez (pansiyon
 * farkı ve kişi başı fiyat modül 28'in işi).
 *
 * @param {{
 *   basePrice: string,
 *   seasons: Array<{ name: string, startDate: Date | string, endDate: Date | string, multiplier: string }>,
 *   checkIn: Date | string,
 *   checkOut: Date | string,
 * }} input
 * @returns {{ nights: PricedNight[], total: string }}
 */
export function priceStay({ basePrice, seasons, checkIn, checkOut }) {
  const nights = eachNight(checkIn, checkOut).map((date) => {
    const season = findSeasonForDate(seasons, date);
    const multiplier = season?.multiplier ?? '1';
    return {
      date: toIsoDay(date),
      amount: toMoneyString(toDecimal(basePrice).times(toDecimal(multiplier))),
      baseRate: toMoneyString(basePrice),
      multiplier: toDecimal(multiplier).toFixed(3),
      seasonName: season?.name ?? null,
    };
  });
  return { nights, total: totalOf(nights) };
}

/**
 * @param {Array<{ amount: string }>} nights
 * @returns {string}
 */
export function totalOf(nights) {
  return nights.length === 0 ? '0.00' : toMoneyString(sum(...nights.map((night) => night.amount)));
}

/**
 * Elle girilen toplamı gecelere böler: eşit pay, kuruş aşağı yuvarlanır, son
 * gece farkı alır. Gecelerin toplamı her zaman girilen toplama eşittir.
 *
 * @param {string} total
 * @param {Array<Date | string>} dates
 * @returns {PricedNight[]}
 */
export function distributeTotal(total, dates) {
  if (dates.length === 0) return [];
  const cents = toDecimal(total).times(100);
  const share = cents.dividedToIntegerBy(dates.length);
  const last = cents.minus(share.times(dates.length - 1));
  return dates.map((date, index) => ({
    date: toIsoDay(date),
    amount: toMoneyString((index === dates.length - 1 ? last : share).dividedBy(100)),
    baseRate: null,
    multiplier: null,
    seasonName: null,
  }));
}

/**
 * Konaklama değişince gece fiyatlarını birleştirir: `keep(date)` doğru olan
 * ve eski fiyatı bulunan geceler **anlaşılan fiyatında kalır**, diğerleri
 * yeni hesaptan gelir. Böylece uzatma yalnızca eklenen geceyi fiyatlar,
 * içerideki misafirin geçmiş geceleri yeniden yazılmaz.
 *
 * @param {PricedNight[]} existing
 * @param {PricedNight[]} fresh yeni konaklamanın hesaplanmış geceleri
 * @param {(date: string) => boolean} keep
 * @returns {PricedNight[]}
 */
export function mergeNights(existing, fresh, keep) {
  const byDate = new Map(existing.map((night) => [toIsoDay(night.date), night]));
  return fresh.map((night) => {
    const previous = byDate.get(night.date);
    return previous && keep(night.date) ? { ...previous, date: night.date, amount: toMoneyString(previous.amount) } : night;
  });
}

/**
 * Oda ücretine düşen vergilerin dökümü (bilgi amaçlı; tahsilat folyoda).
 *
 * Yalnızca "Oda" kalemine uygulanan vergiler sayılır. Dahil vergiler fiyatın
 * içindedir: net = toplam ÷ (1 + dahil oranların toplamı); her dahil vergi
 * net × oran. Hariç vergiler net üzerine eklenir.
 *
 * @param {string} roomTotal oda fiyatı (rezervasyonun toplamı)
 * @param {Array<{ name: string, rate: string, isIncluded: boolean, appliesTo: string[] }>} taxes
 * @returns {{ net: string, included: Array<{ name: string, rate: string, amount: string }>, added: Array<{ name: string, rate: string, amount: string }>, grandTotal: string }}
 */
export function roomTaxBreakdown(roomTotal, taxes) {
  const roomTaxes = taxes.filter((tax) => (tax.appliesTo ?? []).includes('ROOM'));
  const includedRate = sum('0', ...roomTaxes.filter((tax) => tax.isIncluded).map((tax) => tax.rate));
  const net = toDecimal(roomTotal).dividedBy(toDecimal(1).plus(includedRate.dividedBy(100)));
  const line = (tax) => ({
    name: tax.name,
    rate: toDecimal(tax.rate).toString(),
    amount: toMoneyString(net.times(toDecimal(tax.rate)).dividedBy(100)),
  });
  const included = roomTaxes.filter((tax) => tax.isIncluded).map(line);
  const added = roomTaxes.filter((tax) => !tax.isIncluded).map(line);
  return {
    net: toMoneyString(net),
    included,
    added,
    grandTotal: toMoneyString(sum(roomTotal, ...added.map((tax) => tax.amount))),
  };
}

/* ══════════════════ İptal ve gelmedi ══════════════════ */

/**
 * İptal politikası: girişe `policyDays` günden az kala yapılan iptalde
 * toplamın `penaltyPct` yüzdesi kadar ceza. Politika yoksa (0 gün) ceza yok.
 *
 * "3 gün öncesine kadar ücretsiz": girişi 10'unda olan rezervasyon 7'sinde
 * (dahil) ücretsiz iptal edilir, 8'inde cezalıdır.
 *
 * @param {{ totalPrice: string, checkIn: Date | string }} reservation
 * @param {{ cancellationPolicyDays: number, cancellationPolicyPenaltyPct: string }} policy
 * @param {Date | string} businessDate
 * @returns {{ fee: string, penaltyApplies: boolean, freeUntil: string | null, daysBefore: number }}
 */
export function cancellationTerms(reservation, policy, businessDate) {
  const checkIn = toUtcDayStart(reservation.checkIn);
  const today = toUtcDayStart(businessDate);
  const daysBefore = Math.round((checkIn - today) / DAY_MS);
  const days = Number(policy.cancellationPolicyDays ?? 0);
  if (days <= 0 || toDecimal(policy.cancellationPolicyPenaltyPct ?? '0').isZero()) {
    return { fee: '0.00', penaltyApplies: false, freeUntil: null, daysBefore };
  }
  const freeUntil = toIsoDay(addDays(new Date(checkIn), -days));
  const penaltyApplies = daysBefore < days;
  const fee = penaltyApplies
    ? toMoneyString(toDecimal(reservation.totalPrice).times(toDecimal(policy.cancellationPolicyPenaltyPct)).dividedBy(100))
    : '0.00';
  return { fee, penaltyApplies, freeUntil, daysBefore };
}

/**
 * Gelmedi (no-show) ücreti: ilk gecenin fiyatı. Otel sektöründe yerleşik
 * uygulama (odanın o gece satılamaması); personel gerekçeyle vazgeçebilir.
 *
 * @param {Array<{ date: string | Date, amount: string }>} nights
 * @returns {string}
 */
export function noShowFee(nights) {
  if (nights.length === 0) return '0.00';
  const first = [...nights].sort((a, b) => toUtcDayStart(a.date) - toUtcDayStart(b.date))[0];
  return toMoneyString(first.amount);
}

/* ══════════════════ Grup ══════════════════ */

/**
 * Grup satırlarını tek tek odalara açar (sıra korunur).
 * @template {{ quantity: number }} T
 * @param {T[]} lines
 * @returns {Array<Omit<T, 'quantity'> & { line: number }>}
 */
export function expandGroupLines(lines) {
  return lines.flatMap((line, index) => {
    const { quantity, ...rest } = line;
    return Array.from({ length: quantity }, () => ({ ...rest, line: index }));
  });
}

/**
 * Oda tipi başına istenen oda sayısı.
 * @param {Array<{ roomTypeId: string }>} rooms
 * @returns {Map<string, number>}
 */
export function demandByRoomType(rooms) {
  const demand = new Map();
  for (const room of rooms) demand.set(room.roomTypeId, (demand.get(room.roomTypeId) ?? 0) + 1);
  return demand;
}

/* ══════════════════ Misafir ══════════════════ */

/** @param {string | null | undefined} value */
function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('tr-TR');
}

/**
 * Aynı kişi mi? Ad ve soyad Türkçe büyük/küçük harf duyarsız, boşluklar
 * sadeleştirilerek karşılaştırılır ("AYŞE yılmaz" = "Ayşe Yılmaz"). Aynı
 * telefonda farklı adlı kart ayrı kişi sayılır (aile, şirket telefonu):
 * yanlış karta bağlamak, başkasının geçmişini ve iletişim izinlerini miras
 * bırakır.
 *
 * @param {{ firstName: string, lastName: string }} a
 * @param {{ firstName: string, lastName: string }} b
 */
export function sameGuestName(a, b) {
  return normalizeName(a.firstName) === normalizeName(b.firstName) && normalizeName(a.lastName) === normalizeName(b.lastName);
}

/* ══════════════════ Değişiklik ══════════════════ */

/** Düzenlemede izlenen alanlar (olayda ve denetim izinde `changedFields`). */
const TRACKED_FIELDS = Object.freeze(['checkIn', 'checkOut', 'roomTypeId', 'adults', 'children', 'boardType', 'notes', 'totalPrice', 'priceMode']);

/**
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @returns {string[]}
 */
export function changedReservationFields(before, after) {
  const norm = (value) => (value instanceof Date ? toIsoDay(value) : value === undefined ? null : String(value));
  return TRACKED_FIELDS.filter((field) => field in after && norm(before[field]) !== norm(after[field]));
}

/**
 * Konaklama (fiyatı etkileyen kısım) değişti mi?
 * @param {{ checkIn: Date | string, checkOut: Date | string, roomTypeId: string }} before
 * @param {{ checkIn: Date | string, checkOut: Date | string, roomTypeId: string }} after
 */
export function stayChanged(before, after) {
  return (
    toIsoDay(before.checkIn) !== toIsoDay(after.checkIn) ||
    toIsoDay(before.checkOut) !== toIsoDay(after.checkOut) ||
    before.roomTypeId !== after.roomTypeId
  );
}

/* ══════════════════ Bekleme listesi ══════════════════ */

/** Bekleme listesi taramasında tek envanter okumasının kapsadığı en uzun pencere (gün). */
export const REFRESH_WINDOW_DAYS = 62;

/**
 * Kayıtları giriş tarihine göre pencerelere böler: her pencere en fazla
 * `REFRESH_WINDOW_DAYS` gün (tek kaydın konaklaması daha uzunsa kendi penceresi).
 *
 * @template {{ checkIn: Date, checkOut: Date }} T
 * @param {T[]} entries giriş tarihine göre sıralı
 * @returns {Array<{ from: Date, to: Date, entries: T[] }>}
 */
export function chunkByWindow(entries) {
  const chunks = [];
  let current = null;
  for (const entry of entries) {
    const start = toUtcDayStart(entry.checkIn);
    const end = toUtcDayStart(entry.checkOut);
    if (current && end - current.fromMs <= REFRESH_WINDOW_DAYS * DAY_MS) {
      current.entries.push(entry);
      current.toMs = Math.max(current.toMs, end);
      continue;
    }
    current = { fromMs: start, toMs: end, entries: [entry] };
    chunks.push(current);
  }
  return chunks.map((chunk) => ({ from: new Date(chunk.fromMs), to: new Date(chunk.toMs), entries: chunk.entries }));
}
