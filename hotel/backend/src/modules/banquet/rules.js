import { toDecimal, toMoneyString } from '@hotelos/core';
import { FULL_DAY_HOURS, HALF_DAY_HOURS, cancellationFeePct } from '@hotelos/hotel-contracts';
import { chargeLine } from '../folios/rules.js';
import { refundableAmount } from '../payments/rules.js';

/**
 * Banket / etkinliğin saf kuralları (modül 37) — veritabanı, HTTP ve saat bilmez.
 *
 * Para hesabı `@hotelos/core` decimal ile; vergi folyonun motoruyla (`chargeLine`):
 * etkinlik kalemi ile oda / restoran kalemi aynı vergiyle aynı yuvarlamayı görür.
 */

const MINUTE_MS = 60_000;
const ZERO = () => toDecimal(0);

/* ══════════════════ Salon fiyatı ══════════════════ */

/**
 * Oturum süresine göre salon kirası önerisi: saatlik, yarım gün ve tam gün
 * fiyatlarından **en ucuz** uygun olan. Kurallar:
 * - Yarım gün fiyatı en çok `HALF_DAY_HOURS` saatlik oturuma uyar.
 * - Tam gün fiyatı `FULL_DAY_HOURS` saate kadar bir gün; daha uzun oturum
 *   (çok günlü sergi) gün sayısı kadar.
 * - Saatlik fiyat başlamış saat başına (yukarı yuvarlanır).
 *
 * @param {{ hourlyRate: string | null, halfDayRate: string | null, dayRate: string | null }} venue
 * @param {number} minutes oturum süresi (kurulum / söküm hariç: müşteri kullandığı süreyi öder)
 * @returns {{ basis: 'HOUR' | 'HALF_DAY' | 'DAY', quantity: string, unitPrice: string, total: string } | null} fiyatı olmayan salonda `null`
 */
export function suggestVenuePrice(venue, minutes) {
  if (!(minutes > 0)) return null;
  const hours = Math.ceil(minutes / 60);
  const options = [];
  if (venue.hourlyRate) options.push({ basis: 'HOUR', quantity: hours, unitPrice: venue.hourlyRate });
  if (venue.halfDayRate && minutes <= HALF_DAY_HOURS * 60) options.push({ basis: 'HALF_DAY', quantity: 1, unitPrice: venue.halfDayRate });
  if (venue.dayRate) options.push({ basis: 'DAY', quantity: Math.max(1, Math.ceil(minutes / (FULL_DAY_HOURS * 60))), unitPrice: venue.dayRate });
  if (options.length === 0) return null;
  const priced = options.map((option) => ({ ...option, totalValue: toDecimal(option.unitPrice).times(option.quantity) }));
  // En ucuz; eşitlikte daha yalın temel (gün > yarım gün > saat).
  const order = { DAY: 0, HALF_DAY: 1, HOUR: 2 };
  priced.sort((a, b) => a.totalValue.comparedTo(b.totalValue) || order[a.basis] - order[b.basis]);
  const best = priced[0];
  return { basis: best.basis, quantity: String(best.quantity), unitPrice: toMoneyString(best.unitPrice), total: toMoneyString(best.totalValue) };
}

/* ══════════════════ Bölünebilir salon ══════════════════ */

/**
 * Salonun kapladığı atomik parçalar: parçaları varsa parçaları, yoksa kendisi.
 * (İki seviye: bütün → parçalar; parçanın parçası olmaz.)
 *
 * @param {string} venueId
 * @param {Array<{ id: string, parentId: string | null }>} venues otelin salonları
 * @returns {string[]}
 */
export function atomicVenueIds(venueId, venues) {
  const parts = venues.filter((venue) => venue.parentId === venueId).map((venue) => venue.id);
  return parts.length > 0 ? parts.sort() : [venueId];
}

/* ══════════════════ Zaman aralığı ══════════════════ */

/**
 * Salonun dolu olduğu aralık: oturum ± kurulum / söküm.
 * @param {{ startAt: Date, endAt: Date, setupMinutes: number, teardownMinutes: number }} session
 * @returns {{ startAt: Date, endAt: Date }}
 */
export function occupiedRange({ startAt, endAt, setupMinutes, teardownMinutes }) {
  return {
    startAt: new Date(startAt.getTime() - setupMinutes * MINUTE_MS),
    endAt: new Date(endAt.getTime() + teardownMinutes * MINUTE_MS),
  };
}

/** Yarı açık aralıklar kesişiyor mu ([başlangıç, bitiş)). */
export const overlaps = (a, b) => a.startAt.getTime() < b.endAt.getTime() && b.startAt.getTime() < a.endAt.getTime();

/* ══════════════════ Opsiyon sırası ══════════════════ */

/**
 * @typedef {{ id: string, eventId: string, venueId: string, startAt: Date, endAt: Date, status: 'TENTATIVE' | 'DEFINITE', heldAt: Date }} Hold
 */

/**
 * Bir tutmanın sırası: aynı atomik parçada kesişen ve **önce gelen** tutma sayısı + 1.
 * Kesin tutma her zaman önde sayılır (sırası 1'dir, onunla kesişen opsiyon en az 2.).
 * Aynı etkinliğin kendi tutmaları birbirini saymaz.
 *
 * @param {Hold} hold
 * @param {Hold[]} others aynı salonların kesişebilecek tutmaları
 */
export function holdRank(hold, others) {
  if (hold.status === 'DEFINITE') return 1;
  let ahead = 0;
  for (const other of others) {
    if (other.id === hold.id || other.eventId === hold.eventId || other.venueId !== hold.venueId || !overlaps(hold, other)) continue;
    const earlier =
      other.status === 'DEFINITE' ||
      other.heldAt.getTime() < hold.heldAt.getTime() ||
      (other.heldAt.getTime() === hold.heldAt.getTime() && other.id < hold.id);
    if (earlier) ahead += 1;
  }
  return ahead + 1;
}

/**
 * Etkinliğin opsiyon sırası: tutmalarının en kötüsü (her salonda 1. değilse
 * kesinleşemez). Tutması yoksa `null`.
 *
 * @param {Hold[]} own etkinliğin tutmaları
 * @param {Hold[]} others kesişebilecek diğer tutmalar
 * @returns {{ rank: number, blockedBy: string[] } | null} `blockedBy`: önde olan etkinlikler
 */
export function eventRank(own, others) {
  if (own.length === 0) return null;
  let rank = 1;
  const blockedBy = new Set();
  for (const hold of own) {
    const holdRankValue = holdRank(hold, others);
    rank = Math.max(rank, holdRankValue);
    if (hold.status !== 'TENTATIVE') continue;
    for (const other of others) {
      if (other.eventId === hold.eventId || other.venueId !== hold.venueId || !overlaps(hold, other)) continue;
      if (other.status === 'DEFINITE' || other.heldAt.getTime() < hold.heldAt.getTime() || (other.heldAt.getTime() === hold.heldAt.getTime() && other.id < hold.id)) {
        blockedBy.add(other.eventId);
      }
    }
  }
  return { rank, blockedBy: [...blockedBy].sort() };
}

/* ══════════════════ Ekipman stoku ══════════════════ */

/**
 * Ekipmanın aynı anda en çok kaç adet ayrıldığı (süpürme çizgisi): çakışan
 * oturumların adetleri toplanır, ardışık (biri biterken başlayan) oturumlar
 * toplanmaz.
 *
 * @param {Array<{ startAt: Date, endAt: Date, quantity: number }>} usages
 * @returns {number}
 */
export function peakUsage(usages) {
  const points = [];
  for (const usage of usages) {
    points.push({ at: usage.startAt.getTime(), delta: usage.quantity });
    points.push({ at: usage.endAt.getTime(), delta: -usage.quantity });
  }
  // Aynı anda biten önce düşülür (yarı açık aralık).
  points.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const point of points) {
    current += point.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

/* ══════════════════ Kişi ve tutar ══════════════════ */

/**
 * Faturalanacak kişi sayısı (kişi başı kalemlerin miktarı): gerçekleşmeden önce
 * garanti (yoksa tahmini); gerçekleşince en çok (garanti, gerçekleşen) —
 * garanti verilen sayının altına düşülmez.
 *
 * @param {{ status: string, expectedPax: number, guaranteedPax: number | null, actualPax: number | null }} event
 */
export function billablePax({ status, expectedPax, guaranteedPax, actualPax }) {
  if (status === 'COMPLETED' && actualPax !== null && actualPax !== undefined) return Math.max(guaranteedPax ?? 0, actualPax);
  return guaranteedPax ?? expectedPax;
}

/**
 * Kalemin tutarı: miktar (kişi başında faturalanacak kişi) × birim fiyat ×
 * (1 − indirim); vergiler folyonun motoruyla. Fiyatlar (folyo kalemleri gibi)
 * dahil vergili brüttür.
 *
 * @param {{ perPerson: boolean, quantity: string, unitPrice: string, discountPct: string, taxCategory: string }} item
 * @param {number} pax faturalanacak kişi
 * @param {Array<{ id: string, name: string, rate: string, isIncluded: boolean, appliesTo: string[] }>} taxes
 */
export function itemLine(item, pax, taxes) {
  const billedQuantity = item.perPerson ? toDecimal(pax) : toDecimal(item.quantity);
  const gross = toDecimal(item.unitPrice).times(billedQuantity).times(toDecimal(100).minus(toDecimal(item.discountPct ?? 0))).dividedBy(100);
  const line = chargeLine({ amount: toMoneyString(gross), quantity: 1, taxCategory: item.taxCategory, taxes });
  return {
    billedQuantity: billedQuantity.toFixed(2),
    netAmount: line.netAmount,
    taxAmount: line.taxAmount,
    total: line.total,
    taxLines: line.taxLines,
  };
}

/**
 * Etkinliğin toplamları ve vergi dökümü (vergi adı + oranına göre).
 * @param {Array<{ netAmount: string, taxAmount: string, total: string, taxLines: Array<{ name: string, rate: string, included: boolean, amount: string }> }>} lines
 */
export function eventTotals(lines) {
  let net = ZERO();
  let tax = ZERO();
  let total = ZERO();
  /** @type {Map<string, { name: string, rate: string, included: boolean, amount: import('@hotelos/core').Decimal }>} */
  const breakdown = new Map();
  for (const line of lines) {
    net = net.plus(toDecimal(line.netAmount));
    tax = tax.plus(toDecimal(line.taxAmount));
    total = total.plus(toDecimal(line.total));
    for (const taxLine of line.taxLines ?? []) {
      const key = `${taxLine.name}|${taxLine.rate}|${taxLine.included}`;
      const entry = breakdown.get(key) ?? { name: taxLine.name, rate: taxLine.rate, included: taxLine.included, amount: ZERO() };
      entry.amount = entry.amount.plus(toDecimal(taxLine.amount));
      breakdown.set(key, entry);
    }
  }
  return {
    netTotal: toMoneyString(net),
    taxTotal: toMoneyString(tax),
    grandTotal: toMoneyString(total),
    taxes: [...breakdown.values()].map((entry) => ({ ...entry, amount: toMoneyString(entry.amount) })).sort((a, b) => a.name.localeCompare(b.name, 'tr') || Number(a.rate) - Number(b.rate)),
  };
}

/* ══════════════════ İptal ══════════════════ */

/**
 * İptal bedeli: etkinliğin toplamı × etkinliğe kalan güne göre kademe yüzdesi.
 *
 * @param {{ grandTotal: string, tiers: Array<{ daysBefore: number, feePct: string }>, daysBefore: number }} input
 * @returns {{ feePct: string, fee: string }}
 */
export function cancellationFee({ grandTotal, tiers, daysBefore }) {
  const feePct = cancellationFeePct(tiers, Math.max(0, daysBefore));
  return { feePct, fee: toMoneyString(toDecimal(grandTotal).times(toDecimal(feePct)).dividedBy(100)) };
}

/**
 * Etkinliğin borçlandığı tutar: iptalde iptal bedeli, kaybedilen dosyada sıfır (müşteri
 * hiçbir şey borçlanmadı; alınmış para varsa iade edilir), değilse toplam.
 * @param {{ status: string, grandTotal: string, cancellationFee: string | null }} event
 */
export const amountDue = (event) =>
  event.status === 'CANCELLED' ? toMoneyString(event.cancellationFee ?? 0) : event.status === 'LOST' ? toMoneyString(0) : toMoneyString(event.grandTotal);

/* ══════════════════ Ödeme planı ══════════════════ */

/**
 * Ödenen tutarı taksitlere vadesi eskiden yeniye dağıtır ve her taksitin durumunu çıkarır.
 *
 * @param {Array<{ id?: string, label: string, dueDate: string, amount: string }>} installments vade sırası önemli değil
 * @param {string} paidTotal bakiyeye girmiş ödemeler
 * @param {string} today "YYYY-AA-GG"
 * @returns {Array<{ id?: string, label: string, dueDate: string, amount: string, paid: string, remaining: string, status: 'PAID' | 'PARTIAL' | 'DUE' | 'OVERDUE' }>}
 */
export function allocateInstallments(installments, paidTotal, today) {
  let left = toDecimal(paidTotal);
  if (left.lessThan(0)) left = ZERO();
  return [...installments]
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
    .map((installment) => {
      const amount = toDecimal(installment.amount);
      const paid = left.greaterThan(amount) ? amount : left;
      left = left.minus(paid);
      const remaining = amount.minus(paid);
      const status = remaining.isZero() ? 'PAID' : installment.dueDate < today ? 'OVERDUE' : paid.greaterThan(0) ? 'PARTIAL' : 'DUE';
      return { ...installment, amount: toMoneyString(amount), paid: toMoneyString(paid), remaining: toMoneyString(remaining), status };
    });
}

/**
 * Önerilen ödeme planı: imzada depozito (yüzde), kalan etkinlikten `daysBefore` gün önce
 * (o gün geçtiyse bugün). Kuruş farkı kalan taksite yazılır.
 *
 * @param {{ grandTotal: string, depositPct: string, today: string, eventDay: string, balanceDaysBefore: number }} input
 * @returns {Array<{ label: string, dueDate: string, amount: string }>}
 */
export function suggestInstallments({ grandTotal, depositPct, today, eventDay, balanceDaysBefore }) {
  const total = toDecimal(grandTotal);
  if (!total.greaterThan(0)) return [];
  const deposit = toDecimal(toMoneyString(total.times(toDecimal(depositPct)).dividedBy(100)));
  const balanceDue = shiftDay(eventDay, -balanceDaysBefore);
  const plan = [];
  if (deposit.greaterThan(0)) plan.push({ label: 'Depozito', dueDate: today, amount: toMoneyString(deposit) });
  const rest = total.minus(deposit);
  if (rest.greaterThan(0)) plan.push({ label: 'Kalan ödeme', dueDate: balanceDue > today ? balanceDue : today, amount: toMoneyString(rest) });
  return plan;
}

/* ══════════════════ Etkinlik ödemesi ══════════════════ */

/**
 * Ödeme satırlarının özeti (durum × tür toplamlarından): bakiyeye girmiş net
 * (tahsilat − iade ± iptal kaydı), onay bekleyen tahsilat ve onay bekleyen iade (eksi).
 *
 * @param {Array<{ status: string, kind: string, amount: string }>} groups
 * @returns {{ postedNet: string, pendingPayments: string, pendingRefunds: string }}
 */
export function eventPaymentState(groups) {
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

/**
 * İade edilebilecek en fazla tutar. Açık etkinlikte (talep → kesin) ve kayıpta: alınan
 * para (bekleyen iadeler düşülmüş). Kapanmış etkinlikte (gerçekleşti / iptal) borç
 * kesindir: yalnızca borcun üstündeki fazla — iptal bedelini karşılayan para iade
 * edilmez.
 *
 * @param {{ status: string, amountDue: string, state: { postedNet: string, pendingRefunds: string } }} input
 * @returns {string} "0.00" ya da pozitif
 */
export function eventRefundLimit({ status, amountDue, state }) {
  const received = toDecimal(refundableAmount(state));
  if (status !== 'COMPLETED' && status !== 'CANCELLED') return toMoneyString(received);
  const excess = received.minus(toDecimal(amountDue));
  return toMoneyString(excess.lessThan(0) ? 0 : excess);
}

/**
 * Tahsilat / iade alınabilir mi?
 *
 * - **Tahsilat:** kaybedilen etkinliğe alınmaz. Kapanmış etkinlikte (gerçekleşti /
 *   iptal) borç artık kesindir: kalan borçtan (onay bekleyen tahsilatlar düşülmüş)
 *   fazlası alınmaz. Açık etkinlikte (talep → kesin) tutar henüz değişebilir;
 *   depozito ve ara ödeme serbesttir.
 * - **İade:** alınmamış para iade edilemez (işlenmiş net, bekleyen iadeler düşülmüş —
 *   modül 17 ile aynı kural). Kapanmış etkinlikte yalnızca **borcun üstündeki fazla**
 *   iade edilir (`eventRefundLimit`).
 *
 * @param {{ kind: 'PAYMENT' | 'REFUND', status: string, amount: string, amountDue: string, state: { postedNet: string, pendingPayments: string, pendingRefunds: string } }} input
 * @returns {{ message: string, limit: string | null } | null}
 */
export function eventPaymentIssue({ kind, status, amount, amountDue, state }) {
  const value = toDecimal(amount);
  if (kind === 'REFUND') {
    const limit = eventRefundLimit({ status, amountDue, state });
    const closed = status === 'COMPLETED' || status === 'CANCELLED';
    if (toDecimal(limit).isZero()) {
      return {
        message: closed ? 'Fazla ödeme yok: alınan para borcu (etkinlik tutarı / iptal bedeli) karşılıyor.' : 'Bu etkinlikte iade edilecek ödeme yok (alınmamış para iade edilemez).',
        limit,
      };
    }
    if (value.greaterThan(toDecimal(limit))) {
      return { message: `En fazla ${limit} iade edilebilir (${closed ? 'borcun üstündeki fazla ödeme' : 'alınan ödemeler'}, bekleyen iadeler düşülmüş).`, limit };
    }
    return null;
  }
  if (status === 'LOST') return { message: 'Kaybedilen etkinliğe tahsilat yapılmaz.', limit: null };
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    const outstanding = toDecimal(amountDue).minus(toDecimal(state.postedNet)).minus(toDecimal(state.pendingPayments));
    const limit = toMoneyString(outstanding.lessThan(0) ? 0 : outstanding);
    const what = status === 'CANCELLED' ? 'iptal bedeli' : 'etkinlik borcu';
    if (!outstanding.greaterThan(0)) return { message: `Etkinliğin ödenecek ${what} kalmadı; fazla tahsilat alınmaz.`, limit };
    if (value.greaterThan(outstanding)) return { message: `En fazla ${limit} tahsil edilebilir (kalan ${what}; onay bekleyen tahsilatlar düşülmüş).`, limit };
  }
  return null;
}

/* ══════════════════ Belgeler ══════════════════ */

/**
 * Bu durumda bu belge üretilebilir mi?
 *
 * - **Teklif:** satış aşamasında (talep / opsiyon).
 * - **Sözleşme:** talep, opsiyon ya da kesin etkinlikte (kesinleşmeden imzalanır; kesin
 *   etkinlikte değişiklik eki yeni sürümdür).
 * - **Proforma:** borç kesinleşince — gerçekleşti ya da iptal bedeli olan iptal.
 * - Program ve fiyat kalemi olmayan dosyaya teklif / sözleşme çıkmaz.
 *
 * @param {{ kind: 'OFFER' | 'CONTRACT' | 'PROFORMA', status: string, sessionCount: number, itemCount: number, cancellationFee: string | null }} input
 * @returns {string | null}
 */
export function documentIssueError({ kind, status, sessionCount, itemCount, cancellationFee }) {
  if (status === 'LOST') return 'Kaybedilen etkinliğe belge üretilmez.';
  if (kind === 'PROFORMA') {
    if (status === 'COMPLETED') return itemCount > 0 ? null : 'Fiyat kalemi olmayan etkinliğe proforma üretilmez.';
    if (status === 'CANCELLED') return toDecimal(cancellationFee ?? 0).greaterThan(0) ? null : 'İptal bedeli olmayan iptalde proforma üretilmez.';
    return 'Proforma, etkinlik gerçekleşince (ya da bedelli iptalde) üretilir.';
  }
  if (kind === 'OFFER' && !['INQUIRY', 'TENTATIVE'].includes(status)) return 'Teklif satış aşamasında (talep / opsiyon) üretilir; kesin etkinlikte sözleşme sürümü üretin.';
  if (kind === 'CONTRACT' && !['INQUIRY', 'TENTATIVE', 'DEFINITE'].includes(status)) return 'Sözleşme gerçekleşmiş ya da iptal edilmiş etkinliğe üretilmez.';
  if (sessionCount === 0) return 'Önce programa oturum ekleyin (salon ve saat).';
  if (itemCount === 0) return 'Önce fiyat kalemlerini girin.';
  return null;
}

/**
 * Belge kararı (teklif kabul / ret, sözleşme imza) verilebilir mi?
 *
 * @param {{ kind: string, status: string, decision: 'ACCEPTED' | 'DECLINED' | 'SIGNED', date: string, issuedDay: string, validUntil: string | null, today: string }} input
 * @returns {{ message: string, field: 'date' | null } | null} `field`: formun hangi alanına bağlanacağı
 */
export function documentDecisionError({ kind, status, decision, date, issuedDay, validUntil, today }) {
  const fail = (message, field = null) => ({ message, field });
  if (status === 'SUPERSEDED') return fail('Bu belgenin yeni sürümü var; kararı güncel sürüme verin.');
  if (status !== 'ISSUED') return fail('Bu belge için karar zaten verilmiş.');
  if (kind === 'PROFORMA') return fail('Proforma için karar verilmez.');
  if (kind === 'OFFER' && decision === 'SIGNED') return fail('Teklif kabul ya da ret edilir; imza sözleşmeye verilir.');
  if (kind === 'CONTRACT' && decision !== 'SIGNED') return fail('Sözleşme yalnızca imzalandı olarak işaretlenir.');
  if (date > today) return fail('Karar günü ileri bir tarih olamaz.', 'date');
  if (date < issuedDay) return fail('Karar günü belgenin üretildiği günden önce olamaz.', 'date');
  if (kind === 'OFFER' && decision === 'ACCEPTED' && validUntil && date > validUntil) {
    return fail(`Teklifin geçerliliği ${validUntil} tarihinde bitti; güncel fiyatlarla yeni sürüm üretin.`);
  }
  return null;
}

/**
 * Teklifin geçerlilik günü: bugün + politika günü; etkinliğin ilk gününü geçmez.
 * @param {{ today: string, validityDays: number, firstDay: string | null }} input
 */
export function offerValidUntil({ today, validityDays, firstDay }) {
  const until = shiftDay(today, validityDays);
  if (firstDay && firstDay < until) return firstDay < today ? today : firstDay;
  return until;
}

/**
 * Belge numarası: ilk sürüm seriden yeni numara alır; sonraki sürümler aynı numarayı
 * sürüm ekiyle taşır ("TKL-2026-0007/2"): müşteri yazışmasında hangi teklifin
 * revizyonu olduğu bellidir.
 *
 * @param {{ previousNumber: string | null, version: number, freshNumber: () => Promise<string> }} input
 */
export async function documentNumber({ previousNumber, version, freshNumber }) {
  if (!previousNumber || version <= 1) return freshNumber();
  return `${previousNumber.split('/')[0]}/${version}`;
}

/** "YYYY-AA-GG" ± gün. */
export function shiftDay(day, offset) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}
