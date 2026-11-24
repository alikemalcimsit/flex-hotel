import { toDecimal, toMoneyString } from '@hotelos/core';
import { SPA_CLOSED_STATUSES, spaCancellationPct } from '@hotelos/hotel-contracts';
import { chargeLine } from '../folios/rules.js';
import { refundableAmount } from '../payments/rules.js';

/**
 * Spa'nın saf para kuralları (modül 57) — veritabanına dokunmaz, birim testlidir. Para-kritik: yanlış hesap
 * misafirden sessizce yanlış tutar alır ya da kasada açık bırakır.
 *
 * Tutarın iki hâli vardır: **esas** (`price`, `amountDue`: otelin vergi ayarına göre girilen fiyat — dahil vergide
 * misafirin ödediği, hariç vergide matrah) ve **toplam** (`totalDue`: hariç vergiler eklenmiş, misafirin ödeyeceği).
 * Toplam folyonun vergi motoruyla (`chargeLine`, SPA kategorisi) hesaplanır: odaya yazılan esas tutarın folyodaki
 * toplamı ile kasada tahsil edilen aynı sayıdır.
 */

/** Spa kalemlerinin vergi kategorisi (vergi ayarındaki "uygulandığı kalem"). */
export const SPA_TAX_CATEGORY = 'SPA';

const ZERO = () => toDecimal(0);

/**
 * Esas tutarın vergili toplamı (misafirin ödeyeceği).
 * @param {string} amount esas tutar @param {Array<{ id: string, name: string, rate: string, isIncluded: boolean, appliesTo: string[] }>} taxes
 * @returns {string}
 */
export function spaTotal(amount, taxes) {
  if (toDecimal(amount).isZero()) return '0.00';
  return chargeLine({ amount: toMoneyString(amount), quantity: 1, taxCategory: SPA_TAX_CATEGORY, taxes }).total;
}

/**
 * Randevunun liste fiyatı: kişi başı fiyat × kişi (çift masajı, grup dersine aileyle kayıt).
 * @param {string} unitPrice @param {number} guestCount
 */
export const spaListPrice = (unitPrice, guestCount) => toMoneyString(toDecimal(unitPrice).times(guestCount));

/**
 * İptal / gelmedi bedeli (esas tutar): anlaşılan fiyatın ayardaki oranı. Bedel silindiyse (yetkili) sıfır.
 * @param {{ price: string, startsAt: Date, at: Date, outcome: 'CANCELLED' | 'NO_SHOW', settings: { freeCancelHours: number, lateCancelFeePct: string, noShowFeePct: string }, waived?: boolean }} input
 * @returns {{ pct: string, amount: string, late: boolean }}
 */
export function spaFee({ price, startsAt, at, outcome, settings, waived = false }) {
  const { pct, late } = spaCancellationPct({ startsAt, at, outcome, settings });
  if (waived) return { pct: '0', amount: '0.00', late };
  return { pct, amount: toMoneyString(toDecimal(price).times(toDecimal(pct)).dividedBy(100)), late };
}

/** Bakiye: ödenecek toplam − kasada alınan − odaya yazılan. @param {{ totalDue: string, paidTotal: string, roomChargeTotal: string }} row */
export const spaBalance = (row) => toMoneyString(toDecimal(row.totalDue).minus(toDecimal(row.paidTotal)).minus(toDecimal(row.roomChargeTotal)));

/**
 * Ödeme satırlarının özeti (durum × tür toplamlarından): işlenmiş net, onay bekleyen tahsilat, onay bekleyen iade (eksi).
 * @param {Array<{ status: string, kind: string, amount: string }>} groups
 */
export function spaPaymentState(groups) {
  let postedNet = ZERO();
  let pendingPayments = ZERO();
  let pendingRefunds = ZERO();
  for (const group of groups) {
    const amount = toDecimal(group.amount ?? 0);
    if (group.status === 'POSTED') postedNet = postedNet.plus(amount);
    else if (group.status === 'PENDING' && group.kind === 'PAYMENT') pendingPayments = pendingPayments.plus(amount);
    else if (group.status === 'PENDING' && group.kind === 'REFUND') pendingRefunds = pendingRefunds.plus(amount);
  }
  return { postedNet: toMoneyString(postedNet), pendingPayments: toMoneyString(pendingPayments), pendingRefunds: toMoneyString(pendingRefunds) };
}

const floor0 = (value) => toMoneyString(value.lessThan(0) ? 0 : value);

/**
 * Kasada alınabilecek en fazla tutar. Açık randevuda (henüz yapılmadı) **ön ödeme**: fiyatın vergili toplamına
 * kadar. Kapanmış randevuda borç kesindir: kalan (odaya yazılan ve onay bekleyen tahsilat düşülmüş).
 *
 * @param {{ status: string, priceTotal: string, totalDue: string, roomChargeTotal: string, state: { postedNet: string, pendingPayments: string } }} input
 */
export function spaPayableLimit({ status, priceTotal, totalDue, roomChargeTotal, state }) {
  const target = SPA_CLOSED_STATUSES.includes(status) ? toDecimal(totalDue).minus(toDecimal(roomChargeTotal)) : toDecimal(priceTotal);
  return floor0(target.minus(toDecimal(state.postedNet)).minus(toDecimal(state.pendingPayments)));
}

/**
 * İade edilebilecek en fazla tutar. Açık randevuda alınan ön ödemenin tamamı; kapanmışta yalnız borcun üstündeki
 * fazla (iptal bedelini karşılayan para iade edilmez). Bekleyen iadeler düşülür; alınmamış para iade edilmez.
 *
 * @param {{ status: string, totalDue: string, roomChargeTotal: string, state: { postedNet: string, pendingRefunds: string } }} input
 */
export function spaRefundLimit({ status, totalDue, roomChargeTotal, state }) {
  const received = toDecimal(refundableAmount(state));
  if (!SPA_CLOSED_STATUSES.includes(status)) return toMoneyString(received);
  const owed = toDecimal(totalDue).minus(toDecimal(roomChargeTotal));
  return floor0(received.minus(owed.lessThan(0) ? ZERO() : owed));
}

/**
 * Tahsilat / iade alınabilir mi? Alınamıyorsa sebep ve sınır.
 * @param {{ kind: 'PAYMENT' | 'REFUND', amount: string, status: string, priceTotal: string, totalDue: string, roomChargeTotal: string, state: { postedNet: string, pendingPayments: string, pendingRefunds: string } }} input
 * @returns {{ message: string, limit: string } | null}
 */
export function spaPaymentIssue({ kind, amount, status, priceTotal, totalDue, roomChargeTotal, state }) {
  const value = toDecimal(amount);
  const closed = SPA_CLOSED_STATUSES.includes(status);
  if (kind === 'REFUND') {
    const limit = spaRefundLimit({ status, totalDue, roomChargeTotal, state });
    if (toDecimal(limit).isZero()) {
      return { message: closed ? 'Fazla ödeme yok: alınan para borcu karşılıyor.' : 'Bu randevuda iade edilecek ödeme yok (alınmamış para iade edilemez).', limit };
    }
    if (value.greaterThan(toDecimal(limit))) return { message: `En fazla ${limit} iade edilebilir (${closed ? 'borcun üstündeki fazla ödeme' : 'alınan ön ödeme'}, bekleyen iadeler düşülmüş).`, limit };
    return null;
  }
  if (status === 'WAITLISTED') return { message: 'Yedek listedeki kayıttan ödeme alınmaz; asıl listeye geçince alınır.', limit: '0.00' };
  const limit = spaPayableLimit({ status, priceTotal, totalDue, roomChargeTotal, state });
  if (toDecimal(limit).isZero()) {
    const pending = !toDecimal(state.pendingPayments).isZero();
    return { message: pending ? 'Kalan tutar onay bekleyen ödemeyle karşılanıyor.' : closed ? 'Randevunun ödenecek bakiyesi yok.' : 'Randevunun fiyatı kadar ön ödeme zaten alındı.', limit };
  }
  if (value.greaterThan(toDecimal(limit))) return { message: `En fazla ${limit} alınır (${closed ? 'kalan bakiye' : 'randevunun tutarı'}); para üstünü ekranda verin.`, limit };
  return null;
}

/**
 * Odaya yazılabilir mi? Kapanmış, borcu olan ve kasada hiç ödeme almamış (bekleyen dahil) randevu, borcun tamamıyla:
 * kısmi oda + kısmi kasa vergi yuvarlamasında kuruş farkı doğurur, bu yüzden randevu ya odaya ya kasaya kapanır.
 *
 * @param {{ status: string, amountDue: string, roomChargeTotal: string, state: { postedNet: string, pendingPayments: string, pendingRefunds: string } }} input
 * @returns {string | null} engel
 */
export function spaRoomChargeBlock({ status, amountDue, roomChargeTotal, state }) {
  if (!SPA_CLOSED_STATUSES.includes(status)) return 'Randevu tamamlanmadan (ya da iptal bedeli doğmadan) odaya yazılmaz.';
  if (toDecimal(amountDue).isZero()) return 'Randevunun odaya yazılacak borcu yok.';
  if (!toDecimal(roomChargeTotal).isZero()) return 'Bu randevu odaya zaten yazıldı.';
  if (!toDecimal(state.postedNet).isZero() || !toDecimal(state.pendingPayments).isZero() || !toDecimal(state.pendingRefunds).isZero()) {
    return 'Bu randevu için kasada ödeme alınmış (ya da onay bekliyor); kalanı da kasada kapatın.';
  }
  return null;
}

/**
 * Kapanmış randevu geri alınabilir mi (yanlışlıkla tamamlandı / gelmedi / iptal)? Para hareketi olmuşsa hayır:
 * önce ödeme / folyo kalemi düzeltilir.
 * @param {{ status: string, roomChargeTotal: string, state: { postedNet: string, pendingPayments: string, pendingRefunds: string } }} input
 * @returns {string | null} engel
 */
export function spaRestoreBlock({ status, roomChargeTotal, state }) {
  if (!SPA_CLOSED_STATUSES.includes(status)) return 'Yalnız tamamlanmış, iptal edilmiş ya da gelmedi işaretlenmiş randevu geri alınır.';
  if (!toDecimal(roomChargeTotal).isZero()) return 'Ücret odaya yazılmış; önce folyodaki kalemi iptal ettirin, sonra yeni randevu açın.';
  if (status !== 'CANCELLED' && (!toDecimal(state.postedNet).isZero() || !toDecimal(state.pendingPayments).isZero() || !toDecimal(state.pendingRefunds).isZero())) {
    return 'Bu randevunun ödemesi alınmış; geri almadan önce ödemeyi iade / iptal edin.';
  }
  return null;
}
