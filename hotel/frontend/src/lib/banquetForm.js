import { EVENT_ITEM_DEFAULT_TAX, VENUE_LAYOUTS } from '@hotelos/hotel-contracts';

/**
 * Banket formlarının saf dönüşümleri (modül 37): kayıt ↔ form, form → istek gövdesi,
 * kalem satırının tutar önizlemesi, sunucu hata yollarının satırlara dağıtılması.
 *
 * Doğrulama sözleşmenin şemasıyla yapılır (`validateWith`); burada yalnızca biçim
 * dönüşümü var. Kalem önizlemesi kuruş cinsinden tam sayıyla (BigInt) hesaplanır —
 * kayan noktalı sayı 0,1 + 0,2 hatası yapardı; kesin tutar ve vergi sunucudadır.
 */

/* ══════════════════ Para (önizleme) ══════════════════ */

const DECIMAL = /^(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * "1250", "1250,5", "1250.50" → yüzde birlik tam sayı (125050n); geçersiz → null.
 * @param {string | number | null | undefined} text
 */
export function toHundredths(text) {
  const match = DECIMAL.exec(String(text ?? '').trim());
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

/** 125050n → "1250.50" (eksi destekli). @param {bigint} value */
export function hundredthsText(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

/**
 * Kalem satırının vergi dahil brüt önizlemesi: miktar (kişi başında faturalanacak
 * kişi) × birim fiyat × (1 − indirim). Yarım kuruş sıfırdan uzağa yuvarlanır
 * (sunucuyla aynı). Girdi eksik / geçersizse `null`.
 *
 * @param {{ perPerson: boolean, quantity: string, unitPrice: string, discountPct: string }} row
 * @param {number} pax faturalanacak kişi
 * @returns {string | null}
 */
export function linePreview(row, pax) {
  const quantity = row.perPerson ? BigInt(Math.max(0, Math.trunc(pax))) * 100n : toHundredths(row.quantity);
  const price = toHundredths(row.unitPrice);
  const discount = toHundredths(row.discountPct === '' ? '0' : row.discountPct);
  if (quantity === null || price === null || discount === null || discount > 10000n) return null;
  // kuruş × (miktar / 100) × ((10000 − indirim) / 10000) → kuruş; payda 1 000 000.
  const numerator = price * quantity * (10000n - discount);
  const denominator = 1_000_000n;
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  return hundredthsText(rounded);
}

/** Satır önizlemelerinin toplamı (geçersiz satır sayılmaz). @param {Array<string | null>} values */
export function previewTotal(values) {
  return hundredthsText(values.reduce((sum, value) => sum + (value === null ? 0n : toHundredths(value) ?? 0n), 0n));
}

/* ══════════════════ Duvar saati ══════════════════ */

/** "2026-11-20" + "19:00" → "2026-11-20T19:00"; eksikse "". */
export const wallOf = (date, time) => (date && time ? `${date}T${time}` : '');

/** "2026-11-20T19:00" → { date, time }. @param {string | null | undefined} wall */
export const splitWall = (wall) => ({ date: wall ? wall.slice(0, 10) : '', time: wall ? wall.slice(11, 16) : '' });

/* ══════════════════ Etkinlik dosyası ══════════════════ */

export const EMPTY_EVENT_FORM = Object.freeze({ name: '', type: 'MEETING', client: null, ownerEmail: '', expectedPax: '', guaranteedPax: '', notes: '' });

/** @param {any} event */
export function eventFormOf(event) {
  return {
    name: event.name,
    type: event.type,
    client: event.client ? { id: event.client.id, name: event.client.name } : null,
    ownerEmail: event.ownerEmail ?? '',
    expectedPax: String(event.expectedPax),
    guaranteedPax: event.guaranteedPax === null || event.guaranteedPax === undefined ? '' : String(event.guaranteedPax),
    notes: event.notes ?? '',
  };
}

/** @param {typeof EMPTY_EVENT_FORM} form @param {string} [expectedUpdatedAt] */
export function eventPayloadOf(form, expectedUpdatedAt) {
  return {
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    name: form.name,
    type: form.type,
    clientId: form.client?.id ?? '',
    ownerEmail: form.ownerEmail.trim() || null,
    expectedPax: form.expectedPax,
    guaranteedPax: form.guaranteedPax,
    notes: form.notes,
  };
}

/* ══════════════════ Oturum ══════════════════ */

/**
 * @param {any | null} session düzenlenen oturum (yeni için `null`)
 * @param {{ day: string }} defaults yeni oturumun günü
 */
export function sessionFormOf(session, { day }) {
  if (!session) {
    return { title: '', venueId: '', layout: 'THEATER', pax: '', startDate: day, startTime: '09:00', endDate: day, endTime: '17:00', setupMinutes: '', teardownMinutes: '', notes: '' };
  }
  const start = splitWall(session.startLocal);
  const end = splitWall(session.endLocal);
  return {
    title: session.title,
    venueId: session.venueId,
    layout: session.layout,
    pax: String(session.pax),
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    setupMinutes: String(session.setupMinutes),
    teardownMinutes: String(session.teardownMinutes),
    notes: session.notes ?? '',
  };
}

/** @param {ReturnType<typeof sessionFormOf>} form @param {string} expectedUpdatedAt */
export function sessionPayloadOf(form, expectedUpdatedAt) {
  return {
    expectedUpdatedAt,
    title: form.title,
    venueId: form.venueId,
    layout: form.layout,
    pax: form.pax,
    startAt: wallOf(form.startDate, form.startTime),
    endAt: wallOf(form.endDate, form.endTime),
    // Boş = salonun varsayılan hazırlık süresi.
    setupMinutes: form.setupMinutes === '' ? null : form.setupMinutes,
    teardownMinutes: form.teardownMinutes === '' ? null : form.teardownMinutes,
    notes: form.notes,
  };
}

/** Salonda tanımlı düzenler (sözleşmedeki sırayla). @param {{ capacities: Array<{ layout: string, capacity: number }> } | undefined} venue */
export const venueLayouts = (venue) => VENUE_LAYOUTS.filter((layout) => venue?.capacities.some((entry) => entry.layout === layout));

/* ══════════════════ Kalemler ══════════════════ */

let rowSeed = 0;
const rowKey = () => `row-${(rowSeed += 1)}`;

/** @param {string} category */
export function newItemRow(category = 'FNB') {
  const perPerson = category === 'FNB' || category === 'BEVERAGE';
  return {
    key: rowKey(),
    category,
    description: '',
    sessionId: '',
    equipmentId: '',
    perPerson,
    quantity: '1',
    unit: perPerson ? 'PERSON' : category === 'VENUE' ? 'DAY' : 'PIECE',
    unitPrice: '',
    discountPct: '0',
    taxCategory: EVENT_ITEM_DEFAULT_TAX[category],
  };
}

/** Kayıtlı kalem → satır. @param {any} item */
export function itemRowOf(item) {
  return {
    key: rowKey(),
    category: item.category,
    description: item.description,
    sessionId: item.sessionId ?? '',
    equipmentId: item.equipmentId ?? '',
    perPerson: item.perPerson,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
    discountPct: item.discountPct,
    taxCategory: item.taxCategory,
  };
}

/**
 * Satır alanı değişince bağlı alanlar: kişi başı → birim kişi; tür değişince
 * varsayılan vergi; ekipman dışı türde ekipman bağı kalkar.
 *
 * @param {ReturnType<typeof newItemRow>} row
 * @param {string} field
 * @param {unknown} value
 */
export function changeItemRow(row, field, value) {
  const next = { ...row, [field]: value };
  if (field === 'category') {
    next.taxCategory = EVENT_ITEM_DEFAULT_TAX[/** @type {string} */ (value)];
    if (value !== 'EQUIPMENT') next.equipmentId = '';
    if (value === 'EQUIPMENT') {
      next.perPerson = false;
      if (next.unit === 'PERSON') next.unit = 'PIECE';
    }
  }
  if (field === 'perPerson') next.unit = value ? 'PERSON' : next.unit === 'PERSON' ? 'PIECE' : next.unit;
  if (field === 'unit' && value !== 'PERSON') next.perPerson = false;
  return next;
}

/** @param {Array<ReturnType<typeof newItemRow>>} rows @param {string} expectedUpdatedAt */
export function itemsPayloadOf(rows, expectedUpdatedAt) {
  return {
    expectedUpdatedAt,
    items: rows.map((row) => ({
      category: row.category,
      description: row.description,
      sessionId: row.sessionId || null,
      equipmentId: row.category === 'EQUIPMENT' ? row.equipmentId || null : null,
      perPerson: row.perPerson,
      quantity: row.perPerson ? '1' : row.quantity,
      unit: row.unit,
      unitPrice: row.unitPrice,
      discountPct: row.discountPct === '' ? '0' : row.discountPct,
      taxCategory: row.taxCategory,
    })),
  };
}

/**
 * Şema / sunucu hatalarını ("items.3.unitPrice") satır anahtarına dağıtır; genel
 * hatalar `_` altında.
 *
 * @param {Record<string, string>} errors
 * @param {Array<{ key: string }>} rows
 * @returns {Record<string, Record<string, string>>}
 */
export function itemErrorsByRow(errors, rows) {
  const result = {};
  for (const [path, message] of Object.entries(errors ?? {})) {
    const match = /^items\.(\d+)\.(\w+)$/.exec(path);
    const row = match ? rows[Number(match[1])] : null;
    const key = row ? row.key : '_';
    result[key] = { ...(result[key] ?? {}), [match && row ? match[2] : path]: message };
  }
  return result;
}

/* ══════════════════ Ödeme planı ══════════════════ */

/** @param {Array<{ label: string, dueDate: string, amount: string }>} installments */
export const installmentRowsOf = (installments) => installments.map((entry) => ({ key: rowKey(), label: entry.label, dueDate: entry.dueDate, amount: entry.amount }));

/** @param {Array<{ label: string, dueDate: string, amount: string }>} rows @param {string} expectedUpdatedAt */
export const installmentsPayloadOf = (rows, expectedUpdatedAt) => ({
  expectedUpdatedAt,
  installments: rows.map((row) => ({ label: row.label, dueDate: row.dueDate, amount: row.amount })),
});

/** Plan toplamı (geçersiz tutar sayılmaz). @param {Array<{ amount: string }>} rows */
export const planTotal = (rows) => hundredthsText(rows.reduce((sum, row) => sum + (toHundredths(row.amount) ?? 0n), 0n));

/* ══════════════════ Salon ve politika ══════════════════ */

export const EMPTY_VENUE_FORM = Object.freeze({
  code: '',
  name: '',
  description: '',
  parentId: '',
  areaSqm: '',
  hourlyRate: '',
  halfDayRate: '',
  dayRate: '',
  setupMinutes: '60',
  teardownMinutes: '60',
  status: 'ACTIVE',
  capacities: [],
});

/** @param {any} venue */
export function venueFormOf(venue) {
  return {
    code: venue.code,
    name: venue.name,
    description: venue.description ?? '',
    parentId: venue.parentId ?? '',
    areaSqm: venue.areaSqm ?? '',
    hourlyRate: venue.hourlyRate ?? '',
    halfDayRate: venue.halfDayRate ?? '',
    dayRate: venue.dayRate ?? '',
    setupMinutes: String(venue.setupMinutes),
    teardownMinutes: String(venue.teardownMinutes),
    status: venue.status,
    capacities: venue.capacities.map((entry) => ({ layout: entry.layout, capacity: String(entry.capacity) })),
  };
}

/** @param {typeof EMPTY_VENUE_FORM} form @param {string} [expectedUpdatedAt] */
export function venuePayloadOf(form, expectedUpdatedAt) {
  return {
    ...(expectedUpdatedAt ? { expectedUpdatedAt, status: form.status } : {}),
    code: form.code,
    name: form.name,
    description: form.description,
    parentId: form.parentId || null,
    areaSqm: form.areaSqm,
    hourlyRate: form.hourlyRate,
    halfDayRate: form.halfDayRate,
    dayRate: form.dayRate,
    setupMinutes: form.setupMinutes,
    teardownMinutes: form.teardownMinutes,
    capacities: form.capacities.filter((entry) => entry.capacity !== '').map((entry) => ({ layout: entry.layout, capacity: entry.capacity })),
  };
}
