import { BOARD_TYPES, DEFAULT_PROMOTION_SOURCES, PROMOTION_SOURCES, RESERVATION_SOURCE_LABELS } from '@hotelos/hotel-contracts';

/**
 * Promosyon formunun saf dönüşümleri (modül 31): sunucudaki promosyon ↔ form
 * alanları, gönderilecek gövde ve kuralın okunur cümlesi. Tarayıcıya bağlı bir
 * şey içermez (birim test edilir): personelin "ne tanımladım" diye okuduğu
 * cümle ile kaydedilen kuralın aynı olması buna bağlı.
 */

/** Boş form: yüzde indirim, kendiliğinden, doğrudan satış kanalları. */
export const EMPTY_PROMOTION_FORM = Object.freeze({
  name: '',
  notes: '',
  requiresCoupon: false,
  discountType: 'PERCENT',
  discountValue: '',
  stayNights: '',
  payNights: '',
  bookFrom: '',
  bookTo: '',
  stayFrom: '',
  stayTo: '',
  minNights: '',
  maxNights: '',
  minLeadDays: '',
  maxLeadDays: '',
  roomTypeIds: Object.freeze([]),
  boardTypes: Object.freeze([]),
  sources: DEFAULT_PROMOTION_SOURCES,
});

/** @param {unknown} value */
const text = (value) => (value === null || value === undefined ? '' : String(value));

/** Tutar metni: "15.00" → "15", "250.50" → "250,5" (formda Türkçe yazım). @param {string | null} value */
function amountText(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(Number(value)).replace('.', ',');
}

/**
 * Sunucudaki promosyondan form değerleri.
 * @param {any} promotion
 */
export function formOf(promotion) {
  if (!promotion) return { ...EMPTY_PROMOTION_FORM, roomTypeIds: [], boardTypes: [], sources: [...DEFAULT_PROMOTION_SOURCES] };
  return {
    name: promotion.name,
    notes: promotion.notes ?? '',
    requiresCoupon: promotion.requiresCoupon,
    discountType: promotion.discountType,
    discountValue: amountText(promotion.discountValue),
    stayNights: text(promotion.stayNights),
    payNights: text(promotion.payNights),
    bookFrom: promotion.bookFrom ?? '',
    bookTo: promotion.bookTo ?? '',
    stayFrom: promotion.stayFrom ?? '',
    stayTo: promotion.stayTo ?? '',
    minNights: text(promotion.minNights),
    maxNights: text(promotion.maxNights),
    minLeadDays: text(promotion.minLeadDays),
    maxLeadDays: text(promotion.maxLeadDays),
    roomTypeIds: [...promotion.roomTypeIds],
    boardTypes: [...promotion.boardTypes],
    sources: [...promotion.sources],
  };
}

/**
 * Gönderilecek gövde. Boş alanlar boş gider (sözleşme "yok" sayar); türün
 * kullanmadığı alanlar boşaltılır (tür değişince eski değer kalmasın).
 *
 * @param {ReturnType<typeof formOf>} form
 * @param {string | null} [expectedUpdatedAt] düzenlemede sürüm
 */
export function payloadOf(form, expectedUpdatedAt = null) {
  const freeNights = form.discountType === 'FREE_NIGHTS';
  return {
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    name: form.name,
    notes: form.notes,
    requiresCoupon: form.requiresCoupon,
    discountType: form.discountType,
    discountValue: freeNights ? '' : form.discountValue,
    stayNights: freeNights ? form.stayNights : '',
    payNights: freeNights ? form.payNights : '',
    bookFrom: form.bookFrom,
    bookTo: form.bookTo,
    stayFrom: form.stayFrom,
    stayTo: form.stayTo,
    minNights: form.minNights,
    maxNights: form.maxNights,
    minLeadDays: form.minLeadDays,
    maxLeadDays: form.maxLeadDays,
    // Katalog sırası (ekranda ve denetim izinde hep aynı sıra).
    roomTypeIds: [...form.roomTypeIds],
    boardTypes: BOARD_TYPES.filter((board) => form.boardTypes.includes(board)),
    sources: PROMOTION_SOURCES.filter((source) => form.sources.includes(source)),
  };
}

/** "2027-06-01" → "01.06.2027" @param {string} value */
const dotted = (value) => {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
};

/** Satış dönemi: "… arasında", "… ve sonrasında", "en geç …" (açık uçlu dönem doğal okunsun). @param {string} from @param {string} to */
const bookingText = (from, to) =>
  from && to ? `${dotted(from)} – ${dotted(to)} arasında` : from ? `${dotted(from)} ve sonrasında` : `en geç ${dotted(to)} tarihinde`;

/** Konaklama dönemi: "… gecelerine", "… ve sonraki gecelere", "… ve önceki gecelere". @param {string} from @param {string} to */
const stayText = (from, to) =>
  from && to ? `${dotted(from)} – ${dotted(to)} gecelerine` : from ? `${dotted(from)} ve sonraki gecelere` : `${dotted(to)} ve önceki gecelere`;

/** Para: "500" → "500", "250.5" → "250,50" (formda değil cümlede). @param {string} value */
const moneyText = (value) => {
  const number = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('tr-TR', { minimumFractionDigits: Number.isInteger(number) ? 0 : 2, maximumFractionDigits: 2 });
};

/**
 * İndirimin kısa adı: "%15", "500 TRY indirim", "3 gece kal 2 gece öde".
 * @param {{ discountType: string, discountValue: string | number | null, stayNights: string | number | null, payNights: string | number | null }} rule
 * @param {string} currency
 */
export function discountPhrase(rule, currency) {
  if (rule.discountType === 'FREE_NIGHTS') {
    return rule.stayNights && rule.payNights ? `${rule.stayNights} gece kal ${rule.payNights} gece öde` : '"X gece kal, Y gece öde"';
  }
  const value = text(rule.discountValue);
  if (!value) return rule.discountType === 'PERCENT' ? 'yüzde indirim' : 'tutar indirimi';
  return rule.discountType === 'PERCENT' ? `%${String(Number(value.replace(',', '.'))).replace('.', ',')}` : `${moneyText(value)} ${currency} indirim`;
}

/**
 * Kuralın okunur hâli: başlık (indirim) ve koşullar ayrı satırlar. Formda canlı
 * önizleme, listede ve kartta özet olarak kullanılır.
 *
 * @param {ReturnType<typeof formOf> | any} rule form değerleri ya da sunucudaki promosyon
 * @param {{ currency: string, roomTypeName: (id: string) => string, boardLabel: (board: string) => string }} context
 * @returns {{ headline: string, conditions: string[] }}
 */
export function describeRule(rule, { currency, roomTypeName, boardLabel }) {
  const conditions = [];
  conditions.push(rule.requiresCoupon ? 'Kupon kodu girilince uygulanır' : 'Koşulu tutan satışa kendiliğinden uygulanır');
  if (rule.bookFrom || rule.bookTo) conditions.push(`Rezervasyon ${bookingText(rule.bookFrom, rule.bookTo)} yapılırsa`);
  if (rule.stayFrom || rule.stayTo) conditions.push(`İndirim ${stayText(rule.stayFrom, rule.stayTo)}`);
  const min = text(rule.minNights);
  const max = text(rule.maxNights);
  if (min && max) conditions.push(min === max ? `Tam ${min} gece konaklamada` : `${min}–${max} gece konaklamada`);
  else if (min) conditions.push(`En az ${min} gece konaklamada`);
  else if (max) conditions.push(`En fazla ${max} gece konaklamada`);
  const early = text(rule.minLeadDays);
  const late = text(rule.maxLeadDays);
  if (early && early !== '0') conditions.push(`Girişe en az ${early} gün kala (erken rezervasyon)`);
  if (late) conditions.push(late === '0' ? 'Yalnızca giriş günü yapılan rezervasyonda (son dakika)' : `Girişe en fazla ${late} gün kala (son dakika)`);
  if (rule.roomTypeIds.length) conditions.push(`Oda tipi: ${rule.roomTypeIds.map(roomTypeName).join(', ')}`);
  if (rule.boardTypes.length) conditions.push(`Pansiyon: ${rule.boardTypes.map(boardLabel).join(', ')}`);
  const sources = PROMOTION_SOURCES.filter((source) => rule.sources.includes(source));
  if (sources.length === 0) conditions.push('Satış kanalı seçilmedi');
  else if (sources.length === PROMOTION_SOURCES.length) conditions.push('Bütün kanallar (acente hariç)');
  else if (sources.length === DEFAULT_PROMOTION_SOURCES.length && DEFAULT_PROMOTION_SOURCES.every((source) => sources.includes(source))) {
    conditions.push('Doğrudan satış kanalları (OTA ve acente hariç)');
  } else conditions.push(`Kanal: ${sources.map((source) => RESERVATION_SOURCE_LABELS[source] ?? source).join(', ')}`);
  return { headline: discountPhrase(rule, currency), conditions };
}

/**
 * Listede tek tıkla aç / kapa (oda tipi, pansiyon, kanal seçimi).
 * @template T
 * @param {T[]} list
 * @param {T} value
 */
export function toggle(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}
