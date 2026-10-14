import { sum, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import { COUPON_CODE_ALPHABET, COUPON_RANDOM_LENGTH, PROMOTION_ISSUE_LABELS, RESERVATION_SOURCE_LABELS } from '@hotelos/hotel-contracts';

/**
 * Promosyonun saf kuralları (modül 31) — veritabanı, HTTP ve saat bilmez;
 * "bugün" (satış günü) dışarıdan verilir. Para hesabı decimal ile yapılır;
 * yuvarlama yalnızca gece indirimi yazılırken (kuruşa).
 *
 * ### Terimler
 *
 * - **Koşullar** (`promotionIssue`): satış kanalı, rezervasyon (satış) tarihi,
 *   oda tipi, pansiyon, gece sayısı, erken rezervasyon / son dakika günü,
 *   konaklama dönemi. Hepsi tutmalı.
 * - **Uygun gece:** konaklama dönemine düşen gece. İndirim yalnızca uygun
 *   gecelere düşer; dönem dışındaki gece liste fiyatıdır.
 * - **İndirim** (`discountNights`): yüzde her uygun geceye; tutar uygun
 *   gecelere fiyatları oranında (kuruş kalanı tarih sırasıyla); "X kal Y öde"
 *   her X uygun gecede en ucuz (X − Y) gece bedava (eşit fiyatta sonraki gece).
 * - **Teklif** (`planOffer`): uygun otomatik promosyonlar ve kupon arasından
 *   en çok indirim sağlayan tek teklif (eşitlikte otomatik — kupon hakkı harcanmaz).
 */

const DAY_MS = 86_400_000;

/**
 * Promosyonun koşulları ve indirimi (rezervasyonda `promotionTerms` olarak
 * kopyalanır; tarihler "YYYY-MM-DD", tutarlar metin).
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   requiresCoupon: boolean,
 *   discountType: 'PERCENT' | 'AMOUNT' | 'FREE_NIGHTS',
 *   discountValue: string | null,
 *   stayNights: number | null,
 *   payNights: number | null,
 *   bookFrom: string | null,
 *   bookTo: string | null,
 *   stayFrom: string | null,
 *   stayTo: string | null,
 *   minNights: number | null,
 *   maxNights: number | null,
 *   minLeadDays: number | null,
 *   maxLeadDays: number | null,
 *   roomTypeIds: string[],
 *   boardTypes: string[],
 *   sources: string[],
 * }} PromotionTerms
 *
 * Satışın promosyona bakan yüzü.
 * @typedef {{
 *   bookedOn: string,
 *   checkIn: string,
 *   days: string[],
 *   roomTypeId: string,
 *   boardType: string,
 *   source: string,
 * }} Sale
 *
 * @typedef {{ code: string, message: string }} PromotionIssue
 * @typedef {{ date: string, gross: string }} GrossNight
 */

/* ══════════════════ Kopya ══════════════════ */

/** @param {Date | string | null | undefined} value */
const day = (value) => (value === null || value === undefined ? null : toIsoDay(value));

/**
 * Veritabanı satırından (ya da rezervasyondaki kopyadan) koşullar.
 * @param {any} row
 * @returns {PromotionTerms}
 */
export function toTerms(row) {
  return {
    id: row.id,
    name: row.name,
    requiresCoupon: Boolean(row.requiresCoupon),
    discountType: row.discountType,
    discountValue: row.discountValue === null || row.discountValue === undefined ? null : toMoneyString(String(row.discountValue)),
    stayNights: row.stayNights ?? null,
    payNights: row.payNights ?? null,
    bookFrom: day(row.bookFrom),
    bookTo: day(row.bookTo),
    stayFrom: day(row.stayFrom),
    stayTo: day(row.stayTo),
    minNights: row.minNights ?? null,
    maxNights: row.maxNights ?? null,
    minLeadDays: row.minLeadDays ?? null,
    maxLeadDays: row.maxLeadDays ?? null,
    roomTypeIds: [...(row.roomTypeIds ?? [])],
    boardTypes: [...(row.boardTypes ?? [])],
    sources: [...(row.sources ?? [])],
  };
}

/* ══════════════════ Koşullar ══════════════════ */

/** "2027-06-01" → "01.06.2027" @param {string} value */
const dotted = (value) => {
  const [year, month, dayOfMonth] = value.split('-');
  return `${dayOfMonth}.${month}.${year}`;
};

/** @param {string} from @param {string} to */
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** Gece konaklama dönemine düşüyor mu? @param {PromotionTerms} terms @param {string} date */
const withinStay = (terms, date) => (!terms.stayFrom || date >= terms.stayFrom) && (!terms.stayTo || date <= terms.stayTo);

/** @param {string | null} from @param {string | null} to */
const bookingWindowText = (from, to) =>
  from && to ? `${dotted(from)} – ${dotted(to)} arasında` : from ? `${dotted(from)} ve sonrasında` : `en geç ${dotted(/** @type {string} */ (to))} tarihinde`;

/** @param {string | null} from @param {string | null} to */
const stayWindowText = (from, to) =>
  from && to ? `${dotted(from)} – ${dotted(to)} gecelerinde` : from ? `${dotted(from)} ve sonraki gecelerde` : `${dotted(/** @type {string} */ (to))} ve önceki gecelerde`;

/** @param {string} code @param {string} message @returns {PromotionIssue} */
const issueOf = (code, message) => ({ code, message });

/**
 * Promosyonun bu satışa uymama sebebi; uyuyorsa `null`.
 *
 * @param {PromotionTerms} terms
 * @param {Sale} sale
 * @returns {PromotionIssue | null}
 */
export function promotionIssue(terms, sale) {
  if (!terms.sources.includes(sale.source)) {
    return issueOf('PROMO_SOURCE', `${RESERVATION_SOURCE_LABELS[sale.source] ?? sale.source} satışında geçerli değil`);
  }
  if ((terms.bookFrom && sale.bookedOn < terms.bookFrom) || (terms.bookTo && sale.bookedOn > terms.bookTo)) {
    return issueOf('PROMO_BOOKING_WINDOW', `Yalnızca ${bookingWindowText(terms.bookFrom, terms.bookTo)} yapılan rezervasyonda geçerli`);
  }
  if (terms.roomTypeIds.length > 0 && !terms.roomTypeIds.includes(sale.roomTypeId)) {
    return issueOf('PROMO_ROOM_TYPE', 'Bu oda tipinde geçerli değil');
  }
  if (terms.boardTypes.length > 0 && !terms.boardTypes.includes(sale.boardType)) {
    return issueOf('PROMO_BOARD', 'Bu pansiyonda geçerli değil');
  }
  const nights = sale.days.length;
  if (terms.minNights !== null && nights < terms.minNights) {
    return issueOf('PROMO_MIN_NIGHTS', `En az ${terms.minNights} gece konaklamada geçerli (bu konaklama ${nights} gece)`);
  }
  if (terms.maxNights !== null && nights > terms.maxNights) {
    return issueOf('PROMO_MAX_NIGHTS', `En fazla ${terms.maxNights} gece konaklamada geçerli (bu konaklama ${nights} gece)`);
  }
  const lead = daysBetween(sale.bookedOn, sale.checkIn);
  if (terms.minLeadDays !== null && lead < terms.minLeadDays) {
    return issueOf('PROMO_LEAD_MIN', `Girişe en az ${terms.minLeadDays} gün kala yapılan rezervasyonda geçerli (girişe ${lead} gün var)`);
  }
  if (terms.maxLeadDays !== null && lead > terms.maxLeadDays) {
    return issueOf('PROMO_LEAD_MAX', `Girişe en fazla ${terms.maxLeadDays} gün kala yapılan rezervasyonda geçerli (girişe ${lead} gün var)`);
  }
  const eligible = sale.days.filter((date) => withinStay(terms, date)).length;
  if (eligible === 0) {
    return issueOf('PROMO_STAY_WINDOW', `Yalnızca ${stayWindowText(terms.stayFrom, terms.stayTo)} geçerli`);
  }
  if (terms.discountType === 'FREE_NIGHTS' && eligible < /** @type {number} */ (terms.stayNights)) {
    return issueOf(
      'PROMO_FREE_NIGHTS',
      `${terms.stayNights} gece kal ${terms.payNights} gece öde: dönemde en az ${terms.stayNights} gece gerekir (bu konaklamada ${eligible})`,
    );
  }
  return null;
}

/* ══════════════════ İndirim ══════════════════ */

/** @param {import('@hotelos/core').Decimal} cents */
const fromCents = (cents) => toMoneyString(cents.dividedBy(100));

/**
 * Gece gece indirim (gecelerle aynı sırada). Koşullar denetlenmez
 * (`promotionIssue`); yalnızca dönemdeki geceler indirim alır. İndirim hiçbir
 * gecede gecenin fiyatını aşmaz.
 *
 * @param {PromotionTerms} terms
 * @param {GrossNight[]} nights
 * @returns {{ discounts: string[], total: string }}
 */
export function discountNights(terms, nights) {
  const eligible = nights.map((night) => withinStay(terms, night.date));
  const discounts = nights.map(() => '0.00');

  if (terms.discountType === 'PERCENT') {
    nights.forEach((night, index) => {
      if (eligible[index]) discounts[index] = toMoneyString(toDecimal(night.gross).times(toDecimal(terms.discountValue ?? '0')).dividedBy(100));
    });
  } else if (terms.discountType === 'AMOUNT') {
    const indexes = nights.map((_, index) => index).filter((index) => eligible[index]);
    const grossCents = indexes.map((index) => toDecimal(nights[index].gross).times(100));
    const poolCents = grossCents.length ? sum(...grossCents) : toDecimal(0);
    // decimal.js isPositive() sıfırda da true döner: karşılaştırma açıkça > 0.
    if (poolCents.greaterThan(0)) {
      const wanted = toDecimal(terms.discountValue ?? '0').times(100);
      const totalCents = wanted.lessThan(poolCents) ? wanted : poolCents;
      // Fiyatı oranında (aşağı yuvarlanmış kuruş), kalan kuruşlar tarih sırasıyla birer birer.
      const shares = grossCents.map((cents) => totalCents.times(cents).dividedToIntegerBy(poolCents));
      let remainder = totalCents.minus(sum('0', ...shares));
      while (remainder.greaterThan(0)) {
        for (let i = 0; i < shares.length && remainder.greaterThan(0); i += 1) {
          if (shares[i].lessThan(grossCents[i])) {
            shares[i] = shares[i].plus(1);
            remainder = remainder.minus(1);
          }
        }
      }
      indexes.forEach((index, i) => {
        discounts[index] = fromCents(shares[i]);
      });
    }
  } else if (terms.discountType === 'FREE_NIGHTS') {
    const cycle = /** @type {number} */ (terms.stayNights);
    const freePerCycle = cycle - /** @type {number} */ (terms.payNights);
    const indexes = nights.map((_, index) => index).filter((index) => eligible[index]);
    const free = Math.floor(indexes.length / cycle) * freePerCycle;
    // En ucuz geceler bedava; eşit fiyatta sonraki gece (konaklamanın sonu).
    const order = [...indexes].sort((a, b) => {
      const byPrice = toDecimal(nights[a].gross).comparedTo(toDecimal(nights[b].gross));
      return byPrice !== 0 ? byPrice : nights[b].date.localeCompare(nights[a].date);
    });
    for (const index of order.slice(0, free)) discounts[index] = toMoneyString(nights[index].gross);
  }

  return { discounts, total: toMoneyString(sum('0', ...discounts)) };
}

/**
 * Koşullar + indirim. Uymuyorsa sebebi; uyuyor ama indirim doğmuyorsa (ör.
 * dönemdeki geceler sıfır fiyatlı) `PROMO_NO_DISCOUNT`.
 *
 * @param {PromotionTerms} terms
 * @param {Sale} sale
 * @param {GrossNight[]} nights
 * @returns {{ issue: PromotionIssue, discounts?: undefined, total?: undefined } | { issue: null, discounts: string[], total: string }}
 */
export function evaluatePromotion(terms, sale, nights) {
  const issue = promotionIssue(terms, sale);
  if (issue) return { issue };
  const result = discountNights(terms, nights);
  if (toDecimal(result.total).isZero()) {
    return { issue: issueOf('PROMO_NO_DISCOUNT', PROMOTION_ISSUE_LABELS.PROMO_NO_DISCOUNT) };
  }
  return { issue: null, ...result };
}

/**
 * @typedef {{ terms: PromotionTerms, couponId: string | null, couponCode: string | null, discounts: string[], total: string }} Offer
 */

/**
 * En avantajlı teklif: en çok indirim; eşitlikte otomatik promosyon (kupon hakkı
 * harcanmaz), sonra ada ve kimliğe göre (her çalıştırmada aynı sonuç).
 *
 * @param {Offer[]} offers
 * @returns {Offer | null}
 */
export function bestOffer(offers) {
  let best = null;
  for (const offer of offers) {
    if (!best) {
      best = offer;
      continue;
    }
    const byTotal = toDecimal(offer.total).comparedTo(toDecimal(best.total));
    if (byTotal > 0) best = offer;
    else if (byTotal === 0) {
      const autoFirst = Number(Boolean(offer.couponId)) - Number(Boolean(best.couponId));
      if (autoFirst < 0) best = offer;
      else if (autoFirst === 0) {
        const byName = offer.terms.name.localeCompare(best.terms.name, 'tr');
        if (byName < 0 || (byName === 0 && offer.terms.id < best.terms.id)) best = offer;
      }
    }
  }
  return best;
}

/**
 * Bir oda satırı için teklif: uygun otomatik promosyonlar ve (girildiyse)
 * kupon arasından tek indirim.
 *
 * Kuponun durumu:
 * - `INVALID`: kupon yok / kapalı / dolmuş / promosyonu yayında değil (`coupon.issue` verilir).
 * - `NOT_APPLICABLE`: kuponun promosyonu bu konaklamaya uymuyor.
 * - `NOT_BETTER`: uyuyor ama otomatik bir promosyon en az onun kadar indirim veriyor.
 * - `APPLIED`: kupon uygulanıyor.
 *
 * @param {{
 *   autos: PromotionTerms[],
 *   coupon: { id: string, code: string, terms: PromotionTerms | null, issue: PromotionIssue | null } | null,
 *   sale: Sale,
 *   nights: GrossNight[],
 * }} input
 * @returns {{ offer: Offer | null, coupon: { status: 'APPLIED' | 'NOT_BETTER' | 'NOT_APPLICABLE' | 'INVALID', issue: PromotionIssue | null, total: string | null } | null }}
 */
export function planOffer({ autos, coupon, sale, nights }) {
  /** @type {Offer[]} */
  const autoOffers = [];
  for (const terms of autos) {
    const result = evaluatePromotion(terms, sale, nights);
    if (!result.issue) autoOffers.push({ terms, couponId: null, couponCode: null, discounts: result.discounts, total: result.total });
  }
  const bestAuto = bestOffer(autoOffers);
  if (!coupon) return { offer: bestAuto, coupon: null };

  if (coupon.issue || !coupon.terms) {
    return { offer: bestAuto, coupon: { status: 'INVALID', issue: coupon.issue, total: null } };
  }
  const result = evaluatePromotion(coupon.terms, sale, nights);
  if (result.issue) return { offer: bestAuto, coupon: { status: 'NOT_APPLICABLE', issue: result.issue, total: null } };

  /** @type {Offer} */
  const couponOffer = { terms: coupon.terms, couponId: coupon.id, couponCode: coupon.code, discounts: result.discounts, total: result.total };
  const winner = bestOffer(bestAuto ? [bestAuto, couponOffer] : [couponOffer]);
  if (winner === couponOffer) return { offer: couponOffer, coupon: { status: 'APPLIED', issue: null, total: result.total } };
  return {
    offer: bestAuto,
    coupon: {
      status: 'NOT_BETTER',
      issue: issueOf('COUPON_NOT_BETTER', `Kupon geçerli ama "${bestAuto?.terms.name}" promosyonu daha avantajlı; kupon kullanılmaz`),
      total: result.total,
    },
  };
}

/**
 * Teklifi gecelere yazar: tutar = liste fiyatı − indirim.
 *
 * @template {{ date: string, amount: string }} N
 * @param {N[]} nights liste fiyatlı geceler (`amount` = liste fiyatı)
 * @param {Offer | null} offer
 * @returns {Array<N & { discount: string }>}
 */
export function applyOffer(nights, offer) {
  return nights.map((night, index) => {
    const discount = offer ? offer.discounts[index] : '0.00';
    return { ...night, amount: toMoneyString(toDecimal(night.amount).minus(toDecimal(discount))), discount };
  });
}

/**
 * Kısalan konaklama (erken çıkış): kalan gecelerle kopyadaki koşullar (kopyadaki
 * satış günüyle) yeniden denetlenir. Tutuyorsa indirim kalan gecelere göre
 * yeniden hesaplanır; tutmuyorsa kalkar (modül 31 kararı). Promosyonsuz konaklama
 * olduğu gibi döner.
 *
 * @param {{
 *   terms: (PromotionTerms & { bookedOn: string }) | null,
 *   checkIn: string,
 *   roomTypeId: string,
 *   boardType: string,
 *   source: string,
 *   nights: Array<{ date: string, amount: string, discount: string }>,
 * }} stay kalan geceler (indirimli tutar + indirim)
 * @returns {{ nights: Array<{ date: string, amount: string, discount: string }>, total: string, discountTotal: string, kept: boolean, issue: PromotionIssue | null }}
 */
export function reevaluateStay({ terms, checkIn, roomTypeId, boardType, source, nights }) {
  const totals = (list) => ({
    total: toMoneyString(sum('0', ...list.map((night) => night.amount))),
    discountTotal: toMoneyString(sum('0', ...list.map((night) => night.discount))),
  });
  if (!terms) return { nights, ...totals(nights), kept: false, issue: null };
  const listed = nights.map((night) => ({ date: night.date, gross: toMoneyString(toDecimal(night.amount).plus(toDecimal(night.discount))) }));
  const result = evaluatePromotion(terms, { bookedOn: terms.bookedOn, checkIn, days: listed.map((night) => night.date), roomTypeId, boardType, source }, listed);
  const discounts = result.issue ? listed.map(() => '0.00') : result.discounts;
  const repriced = listed.map((night, index) => ({
    date: night.date,
    amount: toMoneyString(toDecimal(night.gross).minus(toDecimal(discounts[index]))),
    discount: discounts[index],
  }));
  return { nights: repriced, ...totals(repriced), kept: !result.issue, issue: result.issue };
}

/* ══════════════════ Kupon kodu ══════════════════ */

/**
 * Rastgele kupon kodu: isteğe bağlı önek + tire + `COUPON_RANDOM_LENGTH` harf.
 * Harfler karışmayan alfabeden, modulo sapması olmadan seçilir.
 *
 * @param {string | null} prefix büyük harf, harf / rakam
 * @param {(size: number) => Uint8Array} randomBytes kriptografik rastgele bayt üreticisi
 */
export function generateCouponCode(prefix, randomBytes) {
  const alphabet = COUPON_CODE_ALPHABET;
  const limit = 256 - (256 % alphabet.length);
  let code = '';
  while (code.length < COUPON_RANDOM_LENGTH) {
    for (const byte of randomBytes(COUPON_RANDOM_LENGTH * 2)) {
      if (byte >= limit) continue;
      code += alphabet[byte % alphabet.length];
      if (code.length === COUPON_RANDOM_LENGTH) break;
    }
  }
  return prefix ? `${prefix}-${code}` : code;
}

/* ══════════════════ Etiket ══════════════════ */

/**
 * İndirimin kısa metni ("%15", "%12,5", "3 gece kal 2 gece öde", "750 TRY", "750,50 TRY").
 * @param {Pick<PromotionTerms, 'discountType' | 'discountValue' | 'stayNights' | 'payNights'>} terms
 * @param {string} currency
 */
export function discountLabel(terms, currency) {
  const value = toDecimal(terms.discountValue ?? '0');
  // decimal.js toString sondaki sıfırları atar: "15.00" → "15", "12.50" → "12.5".
  if (terms.discountType === 'PERCENT') return `%${value.toString().replace('.', ',')}`;
  if (terms.discountType === 'FREE_NIGHTS') return `${terms.stayNights} gece kal ${terms.payNights} gece öde`;
  return `${(value.isInteger() ? value.toFixed(0) : value.toFixed(2)).replace('.', ',')} ${currency}`;
}
