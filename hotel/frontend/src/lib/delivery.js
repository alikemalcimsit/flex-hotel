import { DELIVERY_DOOR_METHOD_LABELS, kitchenStarted } from '@hotelos/hotel-contracts';

/**
 * Paket servis (modül 42) ekranlarının sorgu anahtarları, renkleri, yolları ve saf yardımcıları (sorgu kancaları
 * `deliveryQueries.js`'te: bu dosya tarayıcısız test edilir). Saat / süre yazıları oda servisinin
 * yardımcılarıdır (`roomService.js`: otelin saatiyle).
 *
 * Anahtarlar `['pos', 'delivery', ...]` altındadır: restoranın `pos.changed` kanalı (`pos.delivery.changed` dahil)
 * POS anahtarlarının hepsini tazelediği için pano ve sipariş ekranı başka personelin işlemiyle anında güncellenir.
 * Para hesabı kuruşla yapılır (ekranda önizleme; sunucu yine denetler).
 */

export const deliveryKeys = Object.freeze({
  all: ['pos', 'delivery'],
  /** @param {object} filters */
  board: (filters) => ['pos', 'delivery', 'board', filters],
  /** @param {string} id */
  order: (id) => ['pos', 'delivery', 'order', id],
  /** @param {object} filters */
  orders: (filters) => ['pos', 'delivery', 'orders', filters],
  /** @param {string} phone */
  customer: (phone) => ['pos', 'delivery', 'customer', phone],
});

export const DELIVERY_STATUS_TONES = Object.freeze({
  RECEIVED: 'info',
  PREPARING: 'warning',
  READY: 'success',
  ON_THE_WAY: 'sky',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
});
export const DELIVERY_SOURCE_TONES = Object.freeze({ PHONE: 'neutral', MESSAGE: 'success', ONLINE: 'violet' });
export const DELIVERY_SOURCE_ICONS = Object.freeze({ PHONE: 'phone', MESSAGE: 'message', ONLINE: 'globe' });

export const DELIVERY_PATH = '/pos/paket';
export const NEW_DELIVERY_PATH = '/pos/paket/yeni';
export const DELIVERY_HISTORY_PATH = '/pos/paket/gecmis';
/** @param {string} id */
export const deliveryOrderPath = (id) => `/pos/paket/siparis/${id}`;

/** Mutfağın başladığı (iptalde kalemlerin zayi sayıldığı ve şef garson yetkisinin gerektiği) durumlar — oda servisiyle aynı kural. */
export const deliveryStarted = kitchenStarted;

const ACTIONS_BY_STATUS = Object.freeze({
  RECEIVED: ['preparing', 'ready', 'assign', 'dispatch', 'cancel'],
  PREPARING: ['ready', 'assign', 'dispatch', 'cancel'],
  READY: ['assign', 'dispatch', 'cancel'],
  ON_THE_WAY: ['deliver', 'back', 'cancel'],
});

/**
 * Siparişin ekranda sunulan işlemleri (sunucu kuralının karşılığı; sunucu yine denetler): mutfak adımları, kurye
 * atama ve yola çıkarma; yoldaki sipariş teslim edilir ya da geri getirilir (kurye değişecekse önce geri); mutfak
 * başladıysa iptal yalnızca şef garson.
 *
 * @param {{ status: string }} order
 * @param {{ canOperate: boolean, canSupervise: boolean }} access
 * @returns {string[]} 'preparing' | 'ready' | 'assign' | 'dispatch' | 'back' | 'deliver' | 'cancel'
 */
export function deliveryActions(order, { canOperate, canSupervise }) {
  if (!canOperate) return [];
  return (ACTIONS_BY_STATUS[order.status] ?? []).filter((action) => action !== 'cancel' || !deliveryStarted(order.status) || canSupervise);
}

/** @param {string | number} value "12.50" → 1250 */
const cents = (value) => Math.round(Number(String(value).replace(',', '.')) * 100);
/** @param {number} value 1250 → "12.50" */
const money = (value) => (value / 100).toFixed(2);

/**
 * Kuryenin kapıda alacağı (kartta / panoda tek satır): "Kapıda nakit 450,00 TL · 500,00 TL bozuk", "Ödendi".
 * @param {{ balance: string, doorMethod: string | null, changeFor: string | null }} order
 * @param {(value: string) => string} format para biçimi
 */
export function doorSummary(order, format) {
  if (cents(order.balance) <= 0) return 'Ödendi';
  const label = order.doorMethod ? DELIVERY_DOOR_METHOD_LABELS[order.doorMethod] : 'Kapıda';
  const change = order.doorMethod === 'CASH' && order.changeFor ? ` · ${format(order.changeFor)} bozuk` : '';
  return `${label} ${format(order.balance)}${change}`;
}

/**
 * Teslim diyaloğunun ilk ödemesi: kalanın tamamı siparişte beklenen yöntemle (yazılmadıysa nakit).
 * @param {{ balance: string, doorMethod: string | null }} order
 */
export function defaultDoorPayments(order) {
  if (cents(order.balance) <= 0) return [];
  return [{ key: `door:${order.doorMethod ?? 'CASH'}`, method: order.doorMethod ?? 'CASH', amount: money(cents(order.balance)), reference: '' }];
}

/**
 * Teslimde kapı ödemesinin önizlemesi (sunucunun kuralıyla aynı): kapıda alınanlar kalanı tam kapatır — paket
 * serviste açık hesap ve odaya yazma yoktur; para üstü elde verilir.
 * @param {{ balance: string, payments: Array<{ amount: string }> }} input
 * @returns {{ paid: string, remainder: string, error: string | null }}
 */
export function doorPreview({ balance, payments }) {
  const due = cents(balance);
  const entered = payments.map((payment) => cents(payment.amount || '0'));
  if (entered.some((value) => !Number.isFinite(value) || value < 0)) return { paid: '0.00', remainder: money(due), error: 'Tutar geçersiz' };
  const paid = entered.reduce((sum, value) => sum + value, 0);
  const remainder = Math.max(0, due - paid);
  if (paid > due) return { paid: money(paid), remainder: '0.00', error: `Kapıda alınan kalan tutarı (${money(due)}) aşıyor; para üstünü elde verin, kasaya alınan tutarı yazın.` };
  if (remainder > 0) return { paid: money(paid), remainder: money(remainder), error: `Kalan ${money(remainder)} ödenmedi; paket serviste açık hesap kalmaz — kapıda tamamını alın.` };
  return { paid: money(paid), remainder: '0.00', error: null };
}

/**
 * Sipariş formunun ödeme önizlemesi: toplam = ürünler + paket ücreti; ön ödemeler düşülünce kapıda kalan; ürün
 * toplamı en az tutarın altındaysa eksik (sunucu reddeder); ön ödeme toplamı aşamaz.
 *
 * @param {{ itemsTotal: string, fee: string, minOrder: string, prepayments: Array<{ amount: string }> }} input
 * @returns {{ total: string, prepaid: string, remainder: string, shortfall: string | null, error: string | null }}
 */
export function orderPaymentPreview({ itemsTotal, fee, minOrder, prepayments }) {
  const items = cents(itemsTotal);
  const total = items + cents(fee || '0');
  const entered = prepayments.map((payment) => cents(payment.amount || '0'));
  const invalid = entered.some((value) => !Number.isFinite(value) || value < 0);
  const prepaid = invalid ? 0 : entered.reduce((sum, value) => sum + value, 0);
  const short = cents(minOrder || '0') - items;
  const error = invalid ? 'Ön ödeme tutarı geçersiz' : prepaid > total ? `Ön ödeme (${money(prepaid)}) sipariş toplamını (${money(total)}) aşıyor` : null;
  return { total: money(total), prepaid: money(prepaid), remainder: money(Math.max(0, total - prepaid)), shortfall: short > 0 ? money(short) : null, error };
}
