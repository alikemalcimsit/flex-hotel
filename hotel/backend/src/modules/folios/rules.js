import { isZero, sum, toDecimal, toMoneyString } from '@hotelos/core';

/**
 * Folyonun saf kuralları (modül 15) — veritabanına dokunmaz, birim testlidir.
 * Para-kritik: satır yanlış hesaplanırsa misafirden sessizce yanlış tutar
 * alınır, fatura (16) vergi dökümü tutmaz.
 *
 * Vergi aynı formülle (rezervasyon ekranının dökümü `roomTaxBreakdown`, günlük
 * durumun net geliri): dahil vergiler fiyatın içindedir, net = brüt ÷ (1 +
 * dahil oranlar); hariç vergiler net üzerine eklenir. Fark: burada satır
 * bazında yuvarlanır (her kalem kendi başına faturalanabilir bir satırdır);
 * çok gecelik konaklamada toplamdaki yuvarlamayla kuruş farkı olabilir.
 */

/**
 * @typedef {{ id: string, name: string, rate: string, isIncluded: boolean, appliesTo: string[] }} TaxSetting
 * @typedef {{ taxId: string, name: string, rate: string, included: boolean, amount: string }} TaxLine
 * @typedef {{ amount: string, quantity: number, netAmount: string, taxAmount: string, total: string, taxLines: TaxLine[] }} ChargeLine
 */

/**
 * Bir kalemin satır hesabı.
 *
 * - Brüt = birim tutar × adet (dahil vergiler içinde).
 * - Net = brüt ÷ (1 + Σ dahil oran), kuruşa yuvarlanır; dahil vergilerin
 *   toplamı brüt − net'tir (kuruş kaybı olmaz); tek tek dökümde yuvarlama
 *   farkını son dahil vergi alır.
 * - Hariç her vergi = net × oran (kuruşa yuvarlanır); toplam = brüt + hariç vergiler.
 * - Eksi tutar (indirim) aynı formülle eksi satır verir.
 *
 * @param {{ amount: string, quantity: number, taxCategory: string | null, taxes: TaxSetting[] }} input
 * @returns {ChargeLine}
 */
export function chargeLine({ amount, quantity, taxCategory, taxes }) {
  const gross = toDecimal(amount).times(quantity);
  const applicable = taxCategory ? taxes.filter((tax) => (tax.appliesTo ?? []).includes(taxCategory)) : [];
  const included = applicable.filter((tax) => tax.isIncluded);
  const excluded = applicable.filter((tax) => !tax.isIncluded);

  const includedRate = sum('0', ...included.map((tax) => tax.rate));
  const net = toDecimal(toMoneyString(gross.dividedBy(toDecimal(1).plus(includedRate.dividedBy(100)))));
  const includedTotal = gross.minus(net);

  /** @type {TaxLine[]} */
  const lines = [];
  let includedLeft = includedTotal;
  included.forEach((tax, index) => {
    const share =
      index === included.length - 1 ? includedLeft : toDecimal(toMoneyString(net.times(toDecimal(tax.rate)).dividedBy(100)));
    includedLeft = includedLeft.minus(share);
    lines.push({ taxId: tax.id, name: tax.name, rate: toDecimal(tax.rate).toString(), included: true, amount: toMoneyString(share) });
  });
  let excludedTotal = toDecimal(0);
  for (const tax of excluded) {
    const share = toDecimal(toMoneyString(net.times(toDecimal(tax.rate)).dividedBy(100)));
    excludedTotal = excludedTotal.plus(share);
    lines.push({ taxId: tax.id, name: tax.name, rate: toDecimal(tax.rate).toString(), included: false, amount: toMoneyString(share) });
  }

  return {
    amount: toMoneyString(amount),
    quantity,
    netAmount: toMoneyString(net),
    taxAmount: toMoneyString(includedTotal.plus(excludedTotal)),
    total: toMoneyString(gross.plus(excludedTotal)),
    taxLines: lines,
  };
}

/**
 * Ters kayıt: asıl satırın birebir eksisi (yeniden hesaplanmaz — vergi ayarı
 * bu arada değişmiş olsa da iptal, işlenen tutarı sıfırlar).
 *
 * @param {{ amount: string, quantity: number, netAmount: string, taxAmount: string, total: string, taxLines: TaxLine[] }} item
 * @returns {ChargeLine}
 */
export function reversalLine(item) {
  const negate = (value) => toMoneyString(toDecimal(value).negated());
  return {
    amount: negate(item.amount),
    quantity: item.quantity,
    netAmount: negate(item.netAmount),
    taxAmount: negate(item.taxAmount),
    total: negate(item.total),
    taxLines: (item.taxLines ?? []).map((line) => ({ ...line, amount: negate(line.amount) })),
  };
}

/**
 * Oda ücretlerinin uzlaştırması: konaklamanın geceleri ile folyoya işlenmiş
 * gece kalemleri karşılaştırılır, eksik olan işlenir.
 *
 * - İşlenmemiş gece → gece ücreti (`NIGHT`). Fiyatı sıfır olan gece (ücretsiz
 *   konaklama) kalem üretmez.
 * - İşlenmiş ama fiyatı sonradan değişmiş gece → fark kalemi (`ADJUSTMENT`,
 *   artı ya da eksi). Elle fiyat değişikliği, oda tipi değişikliği gibi.
 * - Konaklamadan çıkmış ama işlenmiş gece → işleneni sıfırlayan fark kalemi.
 * - Gecenin kalemlerinden biri **iptal edilmişse** (ör. ikram gece) o geceye
 *   dokunulmaz: personelin kararı sistemin hesabından üstündür.
 *
 * `throughNight` verilirse yalnızca o geceye kadar (dahil) bakılır (gece
 * çalışması); verilmezse bütün geceler (çıkış).
 *
 * @param {{
 *   nights: Array<{ date: string, amount: string }>,
 *   posted: Array<{ serviceDate: string, amount: string, quantity: number, voided: boolean }>,
 *   throughNight?: string | null,
 * }} input
 * @returns {Array<{ date: string, kind: 'NIGHT' | 'ADJUSTMENT', amount: string, sequence: number }>}
 *   `sequence`: o gecenin kaçıncı kalemi (0 = gece ücreti) — tekrar işleme anahtarı
 */
export function planRoomPostings({ nights, posted, throughNight = null }) {
  const within = (date) => throughNight === null || date <= throughNight;
  /** @type {Map<string, Array<{ amount: string, quantity: number, voided: boolean }>>} */
  const byDate = new Map();
  for (const item of posted) {
    if (!within(item.serviceDate)) continue;
    const list = byDate.get(item.serviceDate) ?? [];
    list.push(item);
    byDate.set(item.serviceDate, list);
  }

  const plan = [];
  const nightDates = new Set();
  for (const night of nights) {
    if (!within(night.date)) continue;
    nightDates.add(night.date);
    const items = byDate.get(night.date) ?? [];
    if (items.some((item) => item.voided)) continue;
    const already = sum('0', ...items.map((item) => toDecimal(item.amount).times(item.quantity)));
    const diff = toDecimal(night.amount).minus(already);
    if (diff.isZero()) continue;
    plan.push({
      date: night.date,
      kind: items.length === 0 ? 'NIGHT' : 'ADJUSTMENT',
      amount: toMoneyString(diff),
      sequence: items.length,
    });
  }

  for (const [date, items] of byDate) {
    if (nightDates.has(date) || items.some((item) => item.voided)) continue;
    const already = sum('0', ...items.map((item) => toDecimal(item.amount).times(item.quantity)));
    if (already.isZero()) continue;
    plan.push({ date, kind: 'ADJUSTMENT', amount: toMoneyString(already.negated()), sequence: items.length });
  }

  return plan.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Sistem kaleminin düşeceği folyo: yönlendirme varsa ve o folyo açıksa oraya,
 * yoksa konaklamanın ilk açık folyosuna. İkisi de yoksa `null` (yeni folyo açılmalı).
 *
 * @param {{
 *   type: string,
 *   routes: Array<{ type: string, folio: { id: string, status: string, reservationId: string } }>,
 *   stayFolios: Array<{ id: string, window: number, status: string }>,
 * }} input
 * @returns {{ folioId: string, routed: boolean, reservationId: string | null } | null}
 *   `reservationId`: yönlendirilen folyo başka konaklamanınsa onun kimliği
 */
export function resolvePostingFolio({ type, routes, stayFolios }) {
  const route = routes.find((entry) => entry.type === type);
  if (route && route.folio.status === 'OPEN') {
    return { folioId: route.folio.id, routed: true, reservationId: route.folio.reservationId };
  }
  const primary = stayFolios.filter((folio) => folio.status === 'OPEN').sort((a, b) => a.window - b.window)[0];
  return primary ? { folioId: primary.id, routed: false, reservationId: null } : null;
}

/**
 * Konaklamanın bir sonraki pencere numarası (1'den başlar, boşluk doldurulmaz).
 * @param {number[]} windows
 */
export function nextWindow(windows) {
  return windows.length === 0 ? 1 : Math.max(...windows) + 1;
}

/**
 * Satırların toplamı (metin).
 * @param {Array<{ total: string }>} lines
 */
export function linesTotal(lines) {
  return toMoneyString(lines.length ? sum(...lines.map((line) => line.total)) : '0');
}

/**
 * Bakiye sıfır mı ("0", "0.00", "-0.00" hepsi sıfır).
 * @param {string | null | undefined} balance
 */
export function balanceIsZero(balance) {
  return balance === null || balance === undefined || isZero(balance);
}

/**
 * Oda gecesinin tekrar işleme anahtarı: gece ücreti `night:<konaklama>:<gün>`,
 * fark kalemleri `…:<sıra>`. Aynı hesap iki kez yapılırsa (iki çalışma aynı
 * anda) aynı anahtar çıkar; veritabanı ikincisini yazmaz.
 *
 * @param {string} reservationId
 * @param {{ date: string, sequence: number }} posting
 */
export function nightSourceKey(reservationId, posting) {
  return posting.sequence === 0 ? `night:${reservationId}:${posting.date}` : `night:${reservationId}:${posting.date}:${posting.sequence}`;
}
