import { MAX_POS_LINE_QUANTITY, MAX_ORDER_LINES } from '@hotelos/hotel-contracts';

/**
 * POS ekranının saf dönüşümleri (modül 39): sipariş sepeti, para üstü, hızlı nakit
 * tutarları, bölme seçimi ve kalemlerin turlara ayrılması. Para kuruş tamsayısıyla
 * hesaplanır (kayan nokta yuvarlaması yok); asıl hesap sunucudadır, burası ekranın önizlemesi.
 */

/** @param {string | number} value "12.50" → 1250 */
const cents = (value) => Math.round(Number(value) * 100);
/** @param {number} value 1250 → "12.50" */
const money = (value) => (value / 100).toFixed(2);

/**
 * @typedef {{ key: string, menuItemId: string, name: string, price: string, quantity: number, note: string }} CartLine
 */

let sequence = 0;
const nextKey = (menuItemId) => `${menuItemId}:${(sequence += 1)}`;

/**
 * Ürünü sepete ekler: aynı ürünün notsuz satırı varsa adedi artar (en fazla 99); yoksa yeni
 * satır. Sepet en fazla bir turun kalem sınırı kadar satır alır.
 * @param {CartLine[]} cart
 * @param {{ id: string, name: string, price: string }} item
 * @returns {CartLine[]}
 */
export function addToCart(cart, item) {
  const same = cart.find((line) => line.menuItemId === item.id && !line.note.trim());
  if (same) return cart.map((line) => (line === same ? { ...line, quantity: Math.min(MAX_POS_LINE_QUANTITY, line.quantity + 1) } : line));
  if (cart.length >= MAX_ORDER_LINES) return cart;
  return [...cart, { key: nextKey(item.id), menuItemId: item.id, name: item.name, price: item.price, quantity: 1, note: '' }];
}

/**
 * Adedi değiştirir; sıfıra inen satır çıkar.
 * @param {CartLine[]} cart @param {string} key @param {number} delta
 */
export function changeQuantity(cart, key, delta) {
  return cart
    .map((line) => (line.key === key ? { ...line, quantity: Math.min(MAX_POS_LINE_QUANTITY, line.quantity + delta) } : line))
    .filter((line) => line.quantity > 0);
}

/**
 * Satıra not (pişirme, alerji). Notlu satır ayrı kalır: aynı ürün notsuz eklenince ona katılmaz.
 * @param {CartLine[]} cart @param {string} key @param {string} note
 */
export const setNote = (cart, key, note) => cart.map((line) => (line.key === key ? { ...line, note } : line));

/** @param {CartLine[]} cart */
export const cartCount = (cart) => cart.reduce((sum, line) => sum + line.quantity, 0);

/** @param {CartLine[]} cart */
export const cartTotal = (cart) => money(cart.reduce((sum, line) => sum + cents(line.price) * line.quantity, 0));

/**
 * "Gönder" gövdesi: istek kimliği sepet ilk dolduğunda üretilir (çift dokunuş tek tur).
 * @param {CartLine[]} cart @param {string} requestId
 */
export function cartPayload(cart, requestId) {
  return { requestId, lines: cart.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity, note: line.note.trim() || null })) };
}

/**
 * Para üstü: verilen nakit tutarı karşılamıyorsa `null`.
 * @param {string} tendered verilen @param {string} amount alınacak
 */
export function changeDue(tendered, amount) {
  const given = cents(String(tendered).replace(',', '.'));
  const due = cents(amount);
  if (!Number.isFinite(given) || given < due) return null;
  return money(given - due);
}

/** Hızlı nakit düğmelerinde yuvarlama adımları (kuruş). */
const CASH_STEPS = [1_000, 5_000, 10_000, 20_000, 50_000];

/**
 * Hızlı nakit tutarları: tam tutar ve onu karşılayan yuvarlak banknot toplamları (en çok 4).
 * @param {string} balance
 */
export function cashSuggestions(balance) {
  const due = cents(balance);
  if (!(due > 0)) return [];
  const options = new Set([due]);
  for (const step of CASH_STEPS) options.add(Math.ceil(due / step) * step);
  return [...options]
    .filter((value) => value >= due)
    .sort((a, b) => a - b)
    .slice(0, 4)
    .map(money);
}

/**
 * Bölme gövdesi: seçimdeki sıfırdan büyük adetler.
 * @param {Record<string, number>} selection kalem → taşınacak adet
 */
export const splitLines = (selection) =>
  Object.entries(selection)
    .filter(([, quantity]) => quantity > 0)
    .map(([lineId, quantity]) => ({ lineId, quantity }));

/**
 * Bölmede taşınacak kalemlerin tutarı (önizleme: birim fiyat × adet; indirim / vergi sunucuda).
 * @param {Array<{ id: string, unitPrice: string }>} lines @param {Record<string, number>} selection
 */
export const selectionTotal = (lines, selection) => money(lines.reduce((sum, line) => sum + cents(line.unitPrice) * (selection[line.id] ?? 0), 0));

/**
 * Kalemleri sipariş turlarına ayırır (tur kimliğiyle; sıra turların gönderiliş sırası). Bölmeyle
 * gelen kalem kaynak adisyonun turunda kalır; numarası aynı olsa da ayrı tur sayılır.
 * @template {{ orderId: string, orderSeq: number }} T
 * @param {T[]} lines
 * @param {Array<{ id: string, seq: number, sentAt: string }>} orders adisyon ekranının turları (gönderiliş sırasıyla)
 * @returns {Array<{ orderId: string, seq: number, sentAt: string | null, lines: T[] }>}
 */
export function groupByOrder(lines, orders) {
  const rank = new Map(orders.map((order, index) => [order.id, index]));
  const groups = new Map();
  for (const line of lines) {
    if (!groups.has(line.orderId)) groups.set(line.orderId, { orderId: line.orderId, seq: line.orderSeq, sentAt: orders[rank.get(line.orderId)]?.sentAt ?? null, lines: [] });
    groups.get(line.orderId).lines.push(line);
  }
  return [...groups.values()].sort((a, b) => (rank.get(a.orderId) ?? 0) - (rank.get(b.orderId) ?? 0));
}
