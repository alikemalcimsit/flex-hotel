import { utcToZonedWallTime } from '@hotelos/hotel-contracts';

/**
 * Oda servisi (modül 41) ekranlarının sorgu anahtarları, renkleri, yolları ve saf yardımcıları (sorgu kancaları
 * `roomServiceQueries.js`'te: bu dosya tarayıcısız test edilir).
 *
 * Anahtarlar `['pos', 'rs', ...]` altındadır: restoranın `pos.changed` kanalı (`pos.room_service.changed` dahil)
 * POS anahtarlarının hepsini tazelediği için pano, sipariş ekranı ve hazırlık listesi başka personelin işlemiyle
 * anında güncellenir. Saatler **otelin saatiyle** gösterilir (kahvaltı 07:30 her bilgisayarda 07:30).
 */

export const rsKeys = Object.freeze({
  all: ['pos', 'rs'],
  /** @param {object} filters */
  board: (filters) => ['pos', 'rs', 'board', filters],
  /** @param {string} id */
  order: (id) => ['pos', 'rs', 'order', id],
  /** @param {object} filters */
  orders: (filters) => ['pos', 'rs', 'orders', filters],
  /** @param {object} filters */
  prep: (filters) => ['pos', 'rs', 'prep', filters],
  /** @param {object} filters */
  trays: (filters) => ['pos', 'rs', 'trays', filters],
  /** @param {object} filters */
  report: (filters) => ['pos', 'rs', 'report', filters],
  /** @param {string} reservationId */
  link: (reservationId) => ['pos', 'rs', 'link', reservationId],
});

export const RS_STATUS_TONES = Object.freeze({
  REQUESTED: 'violet',
  SCHEDULED: 'neutral',
  RECEIVED: 'info',
  PREPARING: 'warning',
  READY: 'success',
  ON_THE_WAY: 'sky',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
  REJECTED: 'danger',
});
export const RS_SOURCE_TONES = Object.freeze({ STAFF: 'neutral', GUEST: 'violet', REQUEST: 'sky' });
export const RS_SOURCE_ICONS = Object.freeze({ STAFF: 'phone', GUEST: 'globe', REQUEST: 'clipboard' });

export const ROOM_SERVICE_PATH = '/pos/oda-servisi';
export const NEW_ORDER_PATH = '/pos/oda-servisi/yeni';
export const PREP_PATH = '/pos/oda-servisi/hazirlik';
export const HISTORY_PATH = '/pos/oda-servisi/gecmis';
export const RS_REPORT_PATH = '/pos/oda-servisi/rapor';
/** Tepsi listesi POS'un dışında: kat hizmetleri (istek yetkisi) de kullanır. */
export const TRAYS_PATH = '/oda-servisi/tepsiler';
/** @param {string} id */
export const orderPath = (id) => `/pos/oda-servisi/siparis/${id}`;

/** "07:30" — otelin saatiyle. @param {string | null | undefined} value ISO @param {string} timeZone */
export const clockText = (value, timeZone) => (value ? utcToZonedWallTime(value, timeZone).slice(11, 16) : '—');

/** "26.10 07:30" — otelin saatiyle. @param {string | null | undefined} value ISO @param {string} timeZone */
export function dayClockText(value, timeZone) {
  if (!value) return '—';
  const wall = utcToZonedWallTime(value, timeZone);
  return `${wall.slice(8, 10)}.${wall.slice(5, 7)} ${wall.slice(11, 16)}`;
}

/** Süre yazısı: "12 dk", "1 sa 05 dk", bir günü aşınca "3 gün 4 sa". @param {number} minutes */
export function durationText(minutes) {
  if (minutes < 60) return `${minutes} dk`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} sa ${String(minutes % 60).padStart(2, '0')} dk`;
  const hours = Math.floor((minutes % 1440) / 60);
  return `${Math.floor(minutes / 1440)} gün${hours ? ` ${hours} sa` : ''}`;
}

/**
 * Teslim hedefine kalan / hedefi geçen süre ve rengi: geçtiyse kırmızı, 5 dakikadan azsa sarı.
 * @param {string} dueAt ISO @param {number} now ms
 * @returns {{ text: string, tone: 'danger' | 'warning' | 'neutral', late: boolean }}
 */
export function dueState(dueAt, now) {
  const minutes = Math.round((Date.parse(dueAt) - now) / 60_000);
  if (minutes < 0) return { text: `${durationText(-minutes)} gecikti`, tone: 'danger', late: true };
  return { text: minutes === 0 ? 'şimdi' : `${durationText(minutes)} kaldı`, tone: minutes <= 5 ? 'warning' : 'neutral', late: false };
}

/** Bir süreden bu yana ("12 dk önce"). @param {string} value ISO @param {number} now ms */
export const agoText = (value, now) => `${durationText(Math.max(0, Math.round((now - Date.parse(value)) / 60_000)))} önce`;

/**
 * Siparişin ekranda sunulan işlemleri (sunucu kuralının karşılığı; sunucu yine denetler): misafir siparişi kabul /
 * ret; planlı mutfağa gönder / iptal; mutfaktaki adımlar, teslim; mutfak başladıysa iptal yalnızca şef garson.
 *
 * @param {{ status: string }} order
 * @param {{ canOperate: boolean, canSupervise: boolean }} access
 * @returns {string[]} 'accept' | 'reject' | 'release' | 'preparing' | 'ready' | 'dispatch' | 'back' | 'deliver' | 'cancel'
 */
export function orderActions(order, { canOperate, canSupervise }) {
  if (!canOperate) return [];
  const started = ['PREPARING', 'READY', 'ON_THE_WAY'].includes(order.status);
  const byStatus = {
    REQUESTED: ['accept', 'reject'],
    SCHEDULED: ['release', 'cancel'],
    RECEIVED: ['preparing', 'ready', 'dispatch', 'deliver', 'cancel'],
    PREPARING: ['ready', 'dispatch', 'deliver', 'cancel'],
    READY: ['dispatch', 'deliver', 'cancel'],
    ON_THE_WAY: ['deliver', 'back', 'cancel'],
  };
  return (byStatus[order.status] ?? []).filter((action) => action !== 'cancel' || !started || canSupervise);
}

/** @param {string | number} value "12.50" → 1250 */
const cents = (value) => Math.round(Number(String(value).replace(',', '.')) * 100);
/** @param {number} value 1250 → "12.50" */
const money = (value) => (value / 100).toFixed(2);

/**
 * Teslimde ödemenin önizlemesi (sunucunun kuralıyla aynı): kapıda alınanlar kalanı aşamaz; kalan odaya yazılır ya da
 * kapıda tamamlanmalı.
 * @param {{ balance: string, payments: Array<{ amount: string }>, chargeRemainder: boolean }} input
 * @returns {{ paid: string, remainder: string, error: string | null }}
 */
export function deliveryPreview({ balance, payments, chargeRemainder }) {
  const due = cents(balance);
  const entered = payments.map((payment) => cents(payment.amount || '0'));
  if (entered.some((value) => !Number.isFinite(value) || value < 0)) return { paid: '0.00', remainder: money(due), error: 'Tutar geçersiz' };
  const paid = entered.reduce((sum, value) => sum + value, 0);
  const remainder = Math.max(0, due - paid);
  if (paid > due) return { paid: money(paid), remainder: '0.00', error: `Kapıda alınan kalan tutarı (${money(due)}) aşıyor; para üstünü elde verin.` };
  if (remainder > 0 && !chargeRemainder) return { paid: money(paid), remainder: money(remainder), error: `Kalan ${money(remainder)} ödenmedi: kapıda alın ya da odaya yazın.` };
  return { paid: money(paid), remainder: money(remainder), error: null };
}

/**
 * Siparişin kalem kopyasını düzenlenebilir sepete çevirir (kabulde / elle göndermede kalem değişimi).
 * @param {Array<{ menuItemId: string, name: string, unitPrice: string, quantity: number, note: string | null }>} items
 */
export const cartFromItems = (items) =>
  items.map((item, index) => ({ key: `${item.menuItemId}:copy:${index}`, menuItemId: item.menuItemId, name: item.name, price: item.unitPrice, quantity: item.quantity, note: item.note ?? '' }));

/**
 * Teslim saati kısayolları (otelin duvar saati, "YYYY-AA-GGTSS:dd"): bir saat sonra ve yarın sabah kahvaltı saatleri.
 * @param {number} now ms @param {string} timeZone @param {string[]} breakfastTimes ["07:00", "07:30", …]
 */
export function deliverAtShortcuts(now, timeZone, breakfastTimes) {
  const inOneHour = utcToZonedWallTime(new Date(now + 60 * 60_000), timeZone);
  const today = utcToZonedWallTime(new Date(now), timeZone).slice(0, 10);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return [
    { value: inOneHour, label: `1 saat sonra (${inOneHour.slice(11, 16)})` },
    ...breakfastTimes.map((time) => ({ value: `${tomorrow}T${time}`, label: `Yarın ${time}` })),
  ];
}
