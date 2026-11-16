import { toDecimal, toMoneyString } from '@hotelos/core';

/**
 * Paket servisin (modül 42) saf para kuralları: teslimde tahsilat, sipariş alınırken ön ödeme ve en az sipariş
 * tutarı. Tutarlar metin ("450.00"); hesap `Decimal` ile (kuruş kaybı yok).
 */

/** @param {Array<{ amount: string }>} payments */
const sum = (payments) => payments.reduce((total, payment) => total.plus(toDecimal(payment.amount)), toDecimal(0));

/**
 * Teslimde tahsilat planı: kapıda alınanlar kalan bakiyeyi tam kapatır (paket serviste açık hesap ve odaya yaz yok;
 * para üstü elde verilir, kasaya alınan yazılır).
 *
 * @param {{ balance: string, payments: Array<{ amount: string }> }} input
 * @returns {{ error: string | null, field: string | null, paid: string }}
 */
export function deliverySettlement({ balance, payments }) {
  const due = toDecimal(balance);
  const paid = sum(payments);
  const result = (error) => ({ error, field: error ? 'payments' : null, paid: toMoneyString(paid) });
  if (payments.length && !due.greaterThan(0)) return result('Siparişin ödenecek tutarı yok; kapıda ödeme alınmaz.');
  if (paid.greaterThan(due)) return result(`Kapıda alınan (${toMoneyString(paid)}) kalan tutarı (${toMoneyString(due)}) aşıyor; para üstünü elde verin, kasaya alınan tutarı yazın.`);
  if (due.minus(paid).greaterThan(0)) return result(`Kalan ${toMoneyString(due.minus(paid))} ödenmedi; paket serviste açık hesap kalmaz — kapıda tamamını alın.`);
  return result(null);
}

/**
 * Sipariş alınırken ön ödeme: toplamı aşamaz; kalan varsa kapıda yöntemi seçili olmalı, tamamı ödendiyse kapı
 * yöntemi ve bozuk para yazılmaz; nakitte bozuk para kapıda alınacak tutardan az olamaz.
 *
 * @param {{ grandTotal: string, prepayments: Array<{ amount: string }>, doorMethod: string | null, changeFor: string | null }} input
 * @returns {{ error: string | null, field: string | null, prepaid: string, remainder: string }}
 */
export function prepaymentPlan({ grandTotal, prepayments, doorMethod, changeFor }) {
  const total = toDecimal(grandTotal);
  const prepaid = sum(prepayments);
  const remainder = total.minus(prepaid);
  const result = (error, field) => ({ error, field, prepaid: toMoneyString(prepaid), remainder: toMoneyString(remainder.greaterThan(0) ? remainder : 0) });
  if (prepaid.greaterThan(total)) return result(`Ön ödeme (${toMoneyString(prepaid)}) sipariş toplamını (${toMoneyString(total)}) aşıyor.`, 'prepayments');
  if (remainder.greaterThan(0) && !doorMethod) return result(`Kalan ${toMoneyString(remainder)} kapıda alınacak: kapıda nakit ya da kart seçin.`, 'doorMethod');
  if (!remainder.greaterThan(0) && doorMethod) return result('Siparişin tamamı önceden ödendi; kapıda ödeme seçilmez.', 'doorMethod');
  if (changeFor && toDecimal(changeFor).lessThan(remainder)) return result(`Müşterinin vereceği (${toMoneyString(changeFor)}) kapıda alınacak tutardan (${toMoneyString(remainder)}) az; bozuk tutarını düzeltin.`, 'changeFor');
  return result(null, null);
}

/**
 * En az sipariş tutarı: ürün toplamı (paket ücreti hariç) sınırın altındaysa sipariş alınmaz; sınır 0 ise yok.
 * @param {string} itemsTotal @param {string} minOrder
 * @returns {string | null}
 */
export function minimumOrderError(itemsTotal, minOrder) {
  const min = toDecimal(minOrder);
  if (!min.greaterThan(0) || !toDecimal(itemsTotal).lessThan(min)) return null;
  return `En az sipariş tutarı ${toMoneyString(min)} (paket ücreti hariç); ürün toplamı ${toMoneyString(itemsTotal)}.`;
}
