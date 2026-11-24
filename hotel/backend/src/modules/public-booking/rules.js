import { PUBLIC_BOOKING_AVAILABILITY_CAP } from '@hotelos/hotel-contracts';

/**
 * Public rezervasyon motoru kuralları (modül 32) — veritabanı bilmez.
 *
 * Personel teklif ucu (`quoteReservation`) iç kimlikler taşır (promosyon id,
 * acente, liste/indirim ayrıntısı, gerçek envanter). Public yanıt bunların
 * **kırpılmış** hâlidir: misafirin karar vermesine yetecek kadarı, iç bilgi
 * sızdırmadan.
 */

/** @param {number} value */
const capAvailability = (value) => Math.max(0, Math.min(value, PUBLIC_BOOKING_AVAILABILITY_CAP));

/**
 * Personel teklifini public yanıta kırpar.
 *
 * - `available` 0..CAP aralığına kırpılır (negatif overbooking ve gerçek
 *   envanter dışarı sızmaz; ekran CAP değerini "5+" gösterir).
 * - İndirim yalnızca tutar + etiket olarak döner (promosyon/kupon kimliği yok).
 * - Acente alanları hiç dönmez (public satışta acente yoktur).
 * - Kapasitesi aileye yetmeyen tip `fits: false` ile işaretlenir (ekran soluk
 *   gösterir) — misafir "neden seçemiyorum" diye düşünmesin.
 *
 * @param {object} quote `quoteReservation` yanıtı
 * @param {{ adults: number, children: number }} party
 * @returns {object} public yanıt
 */
export function trimQuoteForPublic(quote, party) {
  const roomTypes = quote.roomTypes.map((type) => ({
    id: type.id,
    code: type.code,
    name: type.name,
    capacityAdults: type.capacityAdults,
    capacityChildren: type.capacityChildren,
    fits: party.adults <= type.capacityAdults && party.children <= type.capacityChildren,
    available: capAvailability(type.available),
    total: type.total,
    ...(type.discount ? { listTotal: type.listTotal, discount: { amount: type.discount.amount, label: type.discount.promotion?.label ?? null } } : {}),
  }));

  const line = quote.lines?.[0] ?? null;
  return {
    checkIn: quote.checkIn,
    checkOut: quote.checkOut,
    nights: quote.nights,
    currency: quote.currency,
    roomTypes,
    // Seçilen tipin kişi sayısına göre kesin toplamı (ikinci adım; kişi başı ek dahil).
    selection: line
      ? {
          roomTypeId: line.roomTypeId,
          fits: line.fitsCapacity,
          total: line.total,
          discount: line.discount ? { amount: line.discount.amount, label: line.discount.promotion?.label ?? null } : null,
        }
      : null,
    // Kupon geri bildirimi: yalnız durum + misafire gösterilecek mesaj (iç kimlik yok).
    coupon: quote.coupon ? { status: quote.coupon.status, message: quote.coupon.issue?.message ?? null } : null,
  };
}
