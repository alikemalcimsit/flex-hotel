import { DAY_MS, eachNight, isZero, percentOf, subtract, sum, toDecimal, toIsoDay, toMoneyString, toUtcDayStart } from '@hotelos/core';
import { utcToZonedWallTime, zonedWallTimeToUtc } from '@hotelos/hotel-contracts';

/**
 * Check-in / check-out'un saf kuralları (modül 6) — veritabanına dokunmaz,
 * birim testlidir. Para-kritik: ücret ya da erken ayrılışta bırakılan geceler
 * yanlış hesaplanırsa misafirden sessizce yanlış tutar alınır.
 *
 * "Saat" her zaman **otelin** saatidir (`hotelClock`): sunucu UTC'de, resepsiyon
 * bilgisayarı başka dilimde olabilir; erken giriş "otelin 14:00'ünden önce" demektir.
 */

/**
 * "14:00" → 840 (gece yarısından dakika).
 * @param {string} text
 */
export function clockMinutes(text) {
  const [hours, minutes] = String(text).split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Bir anın otel saatindeki günü ve dakikası.
 * @param {string} timezone IANA
 * @param {Date} now
 * @returns {{ day: string, minutes: number }}
 */
export function hotelClock(timezone, now) {
  const wall = utcToZonedWallTime(now, timezone);
  return { day: wall.slice(0, 10), minutes: clockMinutes(wall.slice(11, 16)) };
}

/**
 * Otelin bir takvim gününün UTC aralığı `[start, end)` ("bugün giriş yapanlar"
 * gibi anlık damga sorguları için). Yaz saati geçişinde gün 23 ya da 25 saattir.
 * @param {string} day "YYYY-MM-DD"
 * @param {string} timezone
 */
export function hotelDayRange(day, timezone) {
  const next = toIsoDay(new Date(toUtcDayStart(day) + DAY_MS));
  return {
    start: zonedWallTimeToUtc(`${day}T00:00`, timezone),
    end: zonedWallTimeToUtc(`${next}T00:00`, timezone),
  };
}

/**
 * Politikaya göre ücret. Ücret yoksa (ya da sıfırsa) `null`.
 * @param {{ mode: string, value: string }} policy
 * @param {string | null} nightAmount ilgili gecenin fiyatı
 * @returns {string | null}
 */
export function stayFeeAmount(policy, nightAmount) {
  let fee = null;
  if (policy.mode === 'FIXED') fee = toMoneyString(policy.value);
  if (policy.mode === 'PERCENT_OF_NIGHT') fee = toMoneyString(percentOf(nightAmount ?? '0', policy.value));
  return fee === null || isZero(fee) ? null : fee;
}

/**
 * Erken giriş: giriş gününde, otelin giriş saatinden önce yapılan giriş. Ücret
 * giriş gecesinin fiyatı üzerinden. Giriş günü geçmiş misafir (geç gelen) erken
 * değildir.
 *
 * @param {{
 *   policy: { mode: string, value: string },
 *   checkInTime: string,
 *   clock: { day: string, minutes: number },
 *   arrivalDay: string,
 *   firstNightAmount: string | null,
 * }} input
 * @returns {{ applies: boolean, fee: string | null }} `applies`: erken; ücret politikaya göre null olabilir
 */
export function earlyCheckInCharge({ policy, checkInTime, clock, arrivalDay, firstNightAmount }) {
  if (clock.day !== arrivalDay || clock.minutes >= clockMinutes(checkInTime)) return { applies: false, fee: null };
  return { applies: true, fee: stayFeeAmount(policy, firstNightAmount) };
}

/**
 * Geç çıkış: çıkış gününde, otelin çıkış saatinden sonra yapılan çıkış. Ücret
 * son gecenin fiyatı üzerinden. Çıkış günü geçmişse (misafir günlerce önce
 * ayrılmış, çıkışı unutulmuş olabilir) ücret otomatik uygulanmaz; bu
 * "gecikmiş çıkış" olarak ayrıca gösterilir.
 *
 * @param {{
 *   policy: { mode: string, value: string },
 *   checkOutTime: string,
 *   clock: { day: string, minutes: number },
 *   departureDay: string,
 *   lastNightAmount: string | null,
 * }} input
 * @returns {{ applies: boolean, fee: string | null }}
 */
export function lateCheckOutCharge({ policy, checkOutTime, clock, departureDay, lastNightAmount }) {
  if (clock.day !== departureDay || clock.minutes <= clockMinutes(checkOutTime)) return { applies: false, fee: null };
  return { applies: true, fee: stayFeeAmount(policy, lastNightAmount) };
}

/**
 * Çıkışın konaklamaya etkisi.
 * - `ON_TIME`: çıkış günü (ya da bırakılacak gece yok: tek gecelik konaklamada
 *   aynı gün ayrılan misafir o geceyi öder).
 * - `EARLY`: çıkış tarihinden önce ayrılış; `checkOut` bugüne çekilir, bugünden
 *   sonraki geceler bırakılır (envantere döner, fiyattan düşer).
 * - `OVERDUE`: çıkış tarihi geçmiş (çıkış işlemi unutulmuş); tarih değişmez.
 *
 * @param {{ checkIn: Date | string, checkOut: Date | string, businessDate: Date | string }} stay
 * @returns {{ kind: 'ON_TIME' | 'EARLY' | 'OVERDUE', checkOut: Date, releasedNights: string[], overdueDays: number }}
 */
export function departurePlan({ checkIn, checkOut, businessDate }) {
  const today = toUtcDayStart(businessDate);
  const out = toUtcDayStart(checkOut);
  if (today > out) {
    return { kind: 'OVERDUE', checkOut: new Date(out), releasedNights: [], overdueDays: Math.round((today - out) / DAY_MS) };
  }
  // Konaklama en az bir gece: giriş günü ayrılan misafirin çıkışı ertesi gündür.
  const earliest = toUtcDayStart(checkIn) + DAY_MS;
  const newOut = Math.max(today, earliest);
  if (newOut >= out) return { kind: 'ON_TIME', checkOut: new Date(out), releasedNights: [], overdueDays: 0 };
  return {
    kind: 'EARLY',
    checkOut: new Date(newOut),
    releasedNights: eachNight(new Date(newOut), new Date(out)).map((night) => toIsoDay(night)),
    overdueDays: 0,
  };
}

/**
 * Erken ayrılışta kalan gecelerin toplamı ve bırakılan tutar.
 * @param {Array<{ date: string, amount: string }>} nights
 * @param {string[]} releasedNights "YYYY-MM-DD"
 * @returns {{ total: string, released: string }}
 */
export function priceAfterRelease(nights, releasedNights) {
  const released = new Set(releasedNights);
  const kept = nights.filter((night) => !released.has(night.date)).map((night) => night.amount);
  const dropped = nights.filter((night) => released.has(night.date)).map((night) => night.amount);
  return {
    total: toMoneyString(kept.length ? sum(...kept) : '0'),
    released: toMoneyString(dropped.length ? sum(...dropped) : '0'),
  };
}

/**
 * Çıkışta ödenecek tutar: folyo bakiyesi + henüz folyoya işlenmemiş ücret.
 * Folyo yoksa (folyo modülü devrede değil ya da folyo açılmamış) `null`:
 * bakiye denetlenemez. Artı: misafir borçlu; eksi: otel iade edecek.
 *
 * @param {{ balance: string } | null} folio
 * @param {Array<string | null>} pendingFees
 * @returns {string | null}
 */
export function amountDue(folio, pendingFees) {
  if (!folio) return null;
  const fees = pendingFees.filter(Boolean);
  return toMoneyString(fees.length ? sum(folio.balance, ...fees) : folio.balance);
}

/**
 * Folyo bakiyesi: kalemler (tutar × adet) − ödemeler (tutar × kur).
 * @param {{ charges: string, paid: string }} totals
 */
export function folioBalance({ charges, paid }) {
  return toMoneyString(subtract(charges, paid));
}

/**
 * Tutarlar eşit mi (metin biçiminden bağımsız: "500.5" = "500.50").
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
export function sameAmount(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return toDecimal(a).equals(toDecimal(b));
}

/**
 * Kimlik politikasının eksikleri. Rezervasyon sahibinin kimliği şemada
 * zorunlu; burada refakatçi sayısı denetlenir.
 *
 * @param {{
 *   policy: 'PRIMARY_GUEST' | 'ALL_ADULTS',
 *   adults: number,
 *   children: number,
 *   companions: Array<{ isChild: boolean }>,
 * }} input
 * @returns {string | null} eksikse gösterilecek sebep
 */
export function identityShortfall({ policy, adults, children, companions }) {
  const partySize = adults + children;
  if (companions.length > partySize - 1) {
    return `Rezervasyonda ${partySize} kişi var; sahibi dışında en fazla ${partySize - 1} kişi girilebilir. Kişi sayısı değiştiyse önce rezervasyonu düzenleyin.`;
  }
  const adultCompanions = companions.filter((companion) => !companion.isChild).length;
  if (adultCompanions > adults - 1) {
    return `Rezervasyonda ${adults} yetişkin var; ${adultCompanions + 1} yetişkin girilemez. Kişi sayısı değiştiyse önce rezervasyonu düzenleyin.`;
  }
  if (policy === 'ALL_ADULTS' && adultCompanions < adults - 1) {
    const missing = adults - 1 - adultCompanions;
    return `Otel politikası bütün yetişkinlerin kimliğini istiyor: ${missing} yetişkinin kimliği eksik.`;
  }
  return null;
}

/**
 * Odanın girişe hazırlığı (liste rozeti ve giriş uyarısı).
 * - `OCCUPIED`: odada başka bir misafir hâlâ içeride.
 * - `BLOCKED`: bugün arıza / hizmet dışı kaydı var.
 * - `DIRTY` / `CLEANING`: kat hizmeti bitmedi (giriş personelin onayıyla).
 * - `READY`: temiz ya da kontrol edilmiş.
 *
 * @param {{ housekeepingStatus: string }} room
 * @param {{ occupied: boolean, blocked: boolean }} state
 */
export function roomReadiness(room, { occupied, blocked }) {
  if (occupied) return 'OCCUPIED';
  if (blocked) return 'BLOCKED';
  if (room.housekeepingStatus === 'DIRTY') return 'DIRTY';
  if (room.housekeepingStatus === 'CLEANING') return 'CLEANING';
  return 'READY';
}
