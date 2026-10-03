import { addDays, toDecimal, toIsoDay, toMoneyString } from '@hotelos/core';
import { EXCHANGE_RATE_SCALE, EXCHANGE_RATE_STALE_DAYS } from '@hotelos/hotel-contracts';

/**
 * Ödemenin saf kuralları (modül 17): veritabanı bilmez, birim testli.
 *
 * Para `@hotelos/core` → `money.js` ile hesaplanır; yuvarlama yalnızca
 * sonda, kuruşa, yarım yukarı (sıfırdan uzağa) — veritabanındaki
 * `ROUND(tutar × kur, 2)` kısıtıyla aynı sonuç.
 */

/**
 * Ödeme tutarını folyonun para birimine çevirir. Kur yoksa (aynı para birimi) tutar aynen.
 * @param {string} amount ödeme para biriminde (iade ve iptalde eksi)
 * @param {string | null} rate 1 birim ödeme parası = kur × folyo parası
 * @returns {string} "1234.50"
 */
export function toFolioAmount(amount, rate) {
  return toMoneyString(rate === null ? toDecimal(amount) : toDecimal(amount).times(toDecimal(rate)));
}

/**
 * Kur metni → 6 ondalıklı kanonik metin ("36.125" → "36.125000").
 * @param {string | number} rate
 */
export function rateText(rate) {
  return toDecimal(String(rate)).toFixed(EXCHANGE_RATE_SCALE);
}

/**
 * İki kur aynı mı (formun gördüğü ile sunucununki)? Biçim farkı ("36.1" /
 * "36.100000") fark sayılmaz.
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 */
export function sameRate(a, b) {
  if (a === null || a === undefined || a === '' || b === null || b === undefined || b === '') return (a ?? '') === (b ?? '');
  return toDecimal(String(a)).equals(toDecimal(String(b)));
}

/**
 * Ödemenin kuru: aynı para birimiyse kur yok; değilse iş gününe kadar girilmiş
 * en son kur. Kur yoksa ya da çok eskiyse ödeme alınmaz (sebep döner).
 *
 * @param {{
 *   currency: string,
 *   folioCurrency: string,
 *   hotelCurrency: string,
 *   latest: { rate: string, date: string } | null,
 *   businessDate: string,
 *   staleDays?: number,
 * }} input
 * @returns {{ rate: string | null, rateDate: string | null, error: string | null }}
 */
export function resolvePaymentRate({ currency, folioCurrency, hotelCurrency, latest, businessDate, staleDays = EXCHANGE_RATE_STALE_DAYS }) {
  if (currency === folioCurrency) return { rate: null, rateDate: null, error: null };
  // Kur tablosu otelin para birimine göre tutulur; otelinkinden farklı para birimli folyo yok (bkz. ayarlar).
  if (folioCurrency !== hotelCurrency) {
    return { rate: null, rateDate: null, error: `Bu folyo ${folioCurrency}; ödeme yalnızca ${folioCurrency} alınır` };
  }
  if (!latest) return { rate: null, rateDate: null, error: `${currency} için kur girilmemiş; önce günün kurunu girin (Kasa → Kurlar)` };
  if (latest.date > businessDate) {
    // Gelecek tarihli kur olmaz (yalnızca iş günü girilir); yine de gelirse kullanılmaz.
    return { rate: null, rateDate: null, error: `${currency} kuru ileri tarihli; kurları kontrol edin` };
  }
  const oldest = toIsoDay(addDays(new Date(`${businessDate}T00:00:00.000Z`), -staleDays));
  if (latest.date < oldest) {
    return {
      rate: null,
      rateDate: latest.date,
      error: `${currency} kuru güncel değil (son giriş ${dotted(latest.date)}); önce günün kurunu girin`,
    };
  }
  return { rate: rateText(latest.rate), rateDate: latest.date, error: null };
}

/**
 * Ödeme onaya gider mi? Eşik 0 ise hiçbir ödeme gitmez; değilse folyoya
 * girecek tutar eşiğe eşit ya da büyükse gider.
 * @param {string} folioAmount folyo para biriminde (pozitif)
 * @param {string} threshold otel ayarı
 */
export function needsLargePaymentApproval(folioAmount, threshold) {
  const limit = toDecimal(threshold);
  if (limit.lte(0)) return false;
  return toDecimal(folioAmount).abs().gte(limit);
}

/**
 * İade edilebilecek en fazla tutar (folyo para biriminde): folyoya işlenmiş
 * net ödeme (tahsilat − iade ± iptal) eksi onay bekleyen iadeler. Alınmamış
 * para iade edilemez; iki bekleyen iade aynı parayı iki kez geri veremez.
 *
 * @param {{ postedNet: string, pendingRefunds: string }} input `pendingRefunds` eksi işaretli toplam
 * @returns {string} "0.00" ya da pozitif
 */
export function refundableAmount({ postedNet, pendingRefunds }) {
  const left = toDecimal(postedNet).plus(toDecimal(pendingRefunds));
  return toMoneyString(left.lt(0) ? 0 : left);
}

/**
 * Ödeme iptal edilince folyoda iade edilmiş paradan az ödeme kalmamalı:
 * iptalden sonraki net ödeme, bekleyen iadeleri karşılamalı ve eksiye düşmemeli.
 * (Önce iade edilen paranın asıl ödemesi iptal edilirse kasa açığı izi kaybolur.)
 *
 * @param {{ postedNet: string, pendingRefunds: string, paymentFolioAmount: string }} input
 * @returns {boolean}
 */
export function voidLeavesRefundsCovered({ postedNet, pendingRefunds, paymentFolioAmount }) {
  const after = toDecimal(postedNet).minus(toDecimal(paymentFolioAmount)).plus(toDecimal(pendingRefunds));
  return after.gte(0);
}

/**
 * Ödemenin kaynağı: girişten önce alınan ön ödemedir; sonrası resepsiyon.
 * @param {string} stayStatus rezervasyon durumu
 * @returns {'ADVANCE' | 'DESK'}
 */
export function paymentSourceForStay(stayStatus) {
  return stayStatus === 'PENDING' || stayStatus === 'CONFIRMED' ? 'ADVANCE' : 'DESK';
}

/**
 * Kasa toplamı: veritabanının (yöntem, para birimi, tür) gruplarını ekranın
 * yapısına çevirir. Yöntem başına: tahsilat, iade, iptal ve net (folyo para
 * biriminde); dövizde ayrıca kendi para birimindeki net (kasadaki döviz).
 *
 * @param {Array<{ method: string, currency: string, kind: string, count: number, amount: string, folioAmount: string }>} rows
 * @param {string[]} methods sıralama
 */
export function summarizeCash(rows, methods) {
  const zero = () => toDecimal(0);
  const byMethod = new Map();
  for (const row of rows) {
    if (!byMethod.has(row.method)) {
      byMethod.set(row.method, { received: zero(), refunded: zero(), voided: zero(), count: 0, currencies: new Map() });
    }
    const entry = byMethod.get(row.method);
    const folioAmount = toDecimal(row.folioAmount);
    if (row.kind === 'PAYMENT') entry.received = entry.received.plus(folioAmount);
    else if (row.kind === 'REFUND') entry.refunded = entry.refunded.plus(folioAmount);
    else entry.voided = entry.voided.plus(folioAmount);
    entry.count += row.count;
    const currency = entry.currencies.get(row.currency) ?? { amount: zero(), folioAmount: zero() };
    currency.amount = currency.amount.plus(toDecimal(row.amount));
    currency.folioAmount = currency.folioAmount.plus(folioAmount);
    entry.currencies.set(row.currency, currency);
  }
  const ordered = [...byMethod.keys()].sort((a, b) => methods.indexOf(a) - methods.indexOf(b));
  const lines = ordered.map((method) => {
    const entry = byMethod.get(method);
    return {
      method,
      count: entry.count,
      received: toMoneyString(entry.received),
      refunded: toMoneyString(entry.refunded),
      voided: toMoneyString(entry.voided),
      net: toMoneyString(entry.received.plus(entry.refunded).plus(entry.voided)),
      currencies: [...entry.currencies.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, value]) => ({ currency, amount: toMoneyString(value.amount), folioAmount: toMoneyString(value.folioAmount) })),
    };
  });
  const total = lines.reduce(
    (acc, line) => ({
      received: acc.received.plus(toDecimal(line.received)),
      refunded: acc.refunded.plus(toDecimal(line.refunded)),
      voided: acc.voided.plus(toDecimal(line.voided)),
    }),
    { received: zero(), refunded: zero(), voided: zero() },
  );
  return {
    methods: lines,
    total: {
      received: toMoneyString(total.received),
      refunded: toMoneyString(total.refunded),
      voided: toMoneyString(total.voided),
      net: toMoneyString(total.received.plus(total.refunded).plus(total.voided)),
    },
  };
}

/** "2026-09-29" → "29.09.2026" */
function dotted(day) {
  return day.split('-').reverse().join('.');
}
