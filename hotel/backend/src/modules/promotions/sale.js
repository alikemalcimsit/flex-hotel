import { ValidationError } from '../../lib/errors.js';
import { lockCoupons } from '../../lib/locks.js';
import { planOffer, toTerms } from './rules.js';

/**
 * Promosyonlu satış (modül 31): rezervasyon servisinin yayındaki promosyonları
 * ve kuponu okuduğu yer.
 *
 * Kupon **kilitli** okunur (`lock: true`, çağıranın transaction'ında; kilit
 * sırası rezervasyon → oda tipi → acente → promosyon → kupon): kullanım sayısı
 * kilit altında sayılır, tek kullanımlık kuponu aynı anda iki rezervasyon
 * alamaz. Önizleme aynı okumayı kilitsiz (`prisma` ile) yapar.
 *
 * Kullanım = kuponla açılmış **geçerli** rezervasyon (iptal / gelmedi
 * sayılmaz): iptalde hak kendiliğinden geri açılır, sayaç tutulmaz.
 */

/** Kupon hakkını tüketen rezervasyon durumları. */
export const COUPON_USE_STATUSES = Object.freeze(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT']);

/**
 * Satışta değerlendirilen en fazla otomatik promosyon (güvenlik sınırı: bir
 * otelde aynı gün yayında bu kadar kampanya beklenmez; aşarsa adına göre ilkleri).
 */
export const MAX_LIVE_PROMOTIONS = 200;

/** Promosyonun koşul ve indirim alanları (`toTerms`). */
export const PROMOTION_TERMS_SELECT = Object.freeze({
  id: true,
  name: true,
  status: true,
  requiresCoupon: true,
  discountType: true,
  discountValue: true,
  stayNights: true,
  payNights: true,
  bookFrom: true,
  bookTo: true,
  stayFrom: true,
  stayTo: true,
  minNights: true,
  maxNights: true,
  minLeadDays: true,
  maxLeadDays: true,
  roomTypeIds: true,
  boardTypes: true,
  sources: true,
});

/**
 * Kupon / promosyon reddi. 422; `code` `PROMOTION_ISSUES` değerlerinden biri,
 * mesaj formda kupon alanının altında görünür.
 */
export class PromotionError extends ValidationError {
  /**
   * @param {string} message
   * @param {string} code
   * @param {string} [field]
   */
  constructor(message, code, field = 'couponCode') {
    super(message, { field });
    this.code = code;
  }
}

/** @param {string} day */
const dayStart = (day) => new Date(`${day}T00:00:00.000Z`);

/**
 * @typedef {{
 *   id: string | null,
 *   code: string,
 *   terms: import('./rules.js').PromotionTerms | null,
 *   issue: { code: string, message: string } | null,
 *   maxUses: number | null,
 *   used: number,
 * }} CouponState
 */

/**
 * Kuponu (kilitleyerek ya da kilitsiz) okur ve kullanılabilir mi söyler.
 *
 * @param {any} db transaction ya da `prisma`
 * @param {string} hotelId
 * @param {string} code normalize edilmiş kod
 * @param {{ lock: boolean, excludeReservationId: string | null }} options
 *   `excludeReservationId`: kuponu zaten tutan rezervasyon (kendi kullanımı sayılmaz)
 * @returns {Promise<CouponState>}
 */
export async function readCoupon(db, hotelId, code, { lock, excludeReservationId }) {
  const found = await db.coupon.findFirst({ where: { hotelId, code }, select: { id: true } });
  if (!found) {
    return { id: null, code, terms: null, issue: { code: 'COUPON_NOT_FOUND', message: `"${code}" kodlu kupon bulunamadı` }, maxUses: null, used: 0 };
  }
  if (lock) await lockCoupons(db, hotelId, [found.id]);
  const row = await db.coupon.findFirst({
    where: { id: found.id, hotelId },
    select: { id: true, code: true, maxUses: true, isActive: true, promotion: { select: PROMOTION_TERMS_SELECT } },
  });
  const used = await db.reservation.count({
    where: {
      hotelId,
      couponId: row.id,
      status: { in: COUPON_USE_STATUSES },
      ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
    },
  });
  let issue = null;
  if (!row.isActive) {
    issue = { code: 'COUPON_DISABLED', message: `"${row.code}" kuponu kapatılmış` };
  } else if (row.promotion.status !== 'ACTIVE') {
    issue = { code: 'COUPON_PROMOTION_INACTIVE', message: `"${row.code}" kuponunun promosyonu (${row.promotion.name}) şu an yayında değil` };
  } else if (row.maxUses !== null && used >= row.maxUses) {
    issue = { code: 'COUPON_USED_UP', message: `"${row.code}" kuponunun kullanım hakkı dolmuş (${used}/${row.maxUses})` };
  }
  return { id: row.id, code: row.code, terms: toTerms(row.promotion), issue, maxUses: row.maxUses, used };
}

/**
 * Bu satış gününde yayındaki otomatik promosyonlar ve (girildiyse) kupon.
 *
 * @param {any} db transaction ya da `prisma`
 * @param {string} hotelId
 * @param {{ bookedOn: string, couponCode?: string | null, lock?: boolean, excludeReservationId?: string | null }} options
 *   `bookedOn`: satış günü (otelin bugünü, "YYYY-MM-DD")
 */
export async function loadPromotionSale(db, hotelId, { bookedOn, couponCode = null, lock = false, excludeReservationId = null }) {
  const day = dayStart(bookedOn);
  const autoRows = await db.promotion.findMany({
    where: {
      hotelId,
      status: 'ACTIVE',
      requiresCoupon: false,
      AND: [{ OR: [{ bookFrom: null }, { bookFrom: { lte: day } }] }, { OR: [{ bookTo: null }, { bookTo: { gte: day } }] }],
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: MAX_LIVE_PROMOTIONS,
    select: PROMOTION_TERMS_SELECT,
  });
  const autos = autoRows.map(toTerms);
  const coupon = couponCode ? await readCoupon(db, hotelId, couponCode, { lock, excludeReservationId }) : null;

  return {
    bookedOn,
    autos,
    coupon,

    /**
     * Bir oda satırının teklifi (liste fiyatlı gecelerle).
     * @param {{ roomTypeId: string, boardType: string, source: string, checkIn: string, nights: Array<{ date: string, amount: string }> }} line
     */
    offerFor(line) {
      return planOffer({
        autos,
        coupon,
        sale: { bookedOn, checkIn: line.checkIn, days: line.nights.map((night) => night.date), roomTypeId: line.roomTypeId, boardType: line.boardType, source: line.source },
        nights: line.nights.map((night) => ({ date: night.date, gross: night.amount })),
      });
    },

    /** Girilen kupon kullanılamıyorsa (yok, kapalı, dolmuş, promosyonu yayında değil) reddeder. */
    assertCouponUsable() {
      if (coupon?.issue) throw new PromotionError(coupon.issue.message, coupon.issue.code);
    },

    /**
     * Kupon bu kadar oda için yetiyor mu (her oda bir kullanım)?
     * @param {number} rooms
     */
    assertCouponCapacity(rooms) {
      if (!coupon || coupon.maxUses === null || rooms === 0) return;
      const left = coupon.maxUses - coupon.used;
      if (rooms > left) {
        throw new PromotionError(
          `"${coupon.code}" kuponunun ${Math.max(left, 0)} kullanım hakkı kaldı; ${rooms} oda için kullanılamaz (her oda bir kullanım)`,
          'COUPON_USED_UP',
        );
      }
    },
  };
}
