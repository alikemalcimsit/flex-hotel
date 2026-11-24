import { ASSET_A4_LABELS_PER_SHEET, ASSET_IMPORT_COLUMNS, MAX_ASSET_IMPORT_ROWS, fromCents, toCents } from '@hotelos/hotel-contracts';
import { escapeHtml } from './posPrint.js';
import { qrSvg } from './qr.js';

/**
 * Demirbaş ve amortisman (modül 46) ekranlarının sorgu anahtarları, yolları, renkleri ve saf yardımcıları: etiket
 * belgesi (QR + kod), Excel şablonu / okuma, konum seçeneği kodlaması, aylık pay. Sorgu kancaları
 * `assetQueries.js`'te — bu dosya tarayıcısız test edilir (Excel kitaplıkları yalnız işlev içinde yüklenir).
 */

export const assetKeys = Object.freeze({
  all: ['assets'],
  options: ['assets', 'options'],
  /** @param {object} filters */
  list: (filters) => ['assets', 'list', filters],
  /** @param {string} id */
  detail: (id) => ['assets', 'detail', id],
  /** @param {string} code */
  byCode: (code) => ['assets', 'by-code', code],
  /** @param {boolean} includeInactive */
  categories: (includeInactive) => ['assets', 'categories', includeInactive],
  /** @param {boolean} includeInactive */
  areas: (includeInactive) => ['assets', 'areas', includeInactive],
  /** @param {object} filters */
  counts: (filters) => ['assets', 'counts', filters],
  /** @param {string} id */
  count: (id) => ['assets', 'count', id],
  /** @param {number} year */
  depreciation: (year) => ['assets', 'depreciation', year],
  /** @param {object} filters */
  warranty: (filters) => ['assets', 'warranty', filters],
  /** @param {string} employeeId */
  employee: (employeeId) => ['assets', 'employee', employeeId],
});

export const ASSETS_PATH = '/demirbas';
export const ASSET_COUNTS_PATH = '/demirbas/sayim';
export const ASSET_DEPRECIATION_PATH = '/demirbas/amortisman';
export const ASSET_WARRANTY_PATH = '/demirbas/garanti';
export const ASSET_DEFINITIONS_PATH = '/demirbas/tanimlar';
/** @param {string} id */
export const assetPath = (id) => `/demirbas/${id}`;
/** @param {string} id */
export const assetCountPath = (id) => `/demirbas/sayim/${id}`;
/** Etiketteki QR'ın açtığı yol (kodla karta yönlendirir). @param {string} code */
export const assetQrPath = (code) => `/demirbas/k/${encodeURIComponent(code)}`;
/** @param {string} origin uygulamanın adresi @param {string} code */
export const assetQrUrl = (origin, code) => `${origin.replace(/\/+$/, '')}${assetQrPath(code)}`;

export const ASSET_STATUS_TONES = Object.freeze({ ACTIVE: 'success', DISPOSED: 'neutral' });
export const ASSET_COUNT_STATUS_TONES = Object.freeze({ OPEN: 'info', CLOSED: 'success', CANCELLED: 'neutral' });
export const ASSET_DISPOSAL_TONES = Object.freeze({ SOLD: 'info', SCRAPPED: 'warning', LOST: 'danger' });
export const ASSET_MOVEMENT_ICONS = Object.freeze({
  CREATED: 'plus',
  UPDATED: 'pencil',
  TRANSFERRED: 'arrowRight',
  ASSIGNED: 'user',
  RETURNED: 'rotateCcw',
  DISPOSED: 'trash',
});

/** Sayım satırının durumu (sunucunun `state` alanı). */
export const COUNT_ITEM_STATES = Object.freeze(['MISSING', 'MISPLACED', 'EXTRA', 'FOUND']);
export const COUNT_ITEM_STATE_LABELS = Object.freeze({ MISSING: 'Eksik', MISPLACED: 'Başka yerde', EXTRA: 'Fazla', FOUND: 'Yerinde' });
export const COUNT_ITEM_STATE_TONES = Object.freeze({ MISSING: 'danger', MISPLACED: 'warning', EXTRA: 'violet', FOUND: 'success' });

/** Okutmanın sonucu → bant rengi ve başlık. */
const SCAN_FEEDBACK = Object.freeze({
  FOUND: { tone: 'success', title: 'Yerinde', ok: true },
  MISPLACED: { tone: 'warning', title: 'Başka yerde bulundu', ok: true },
  EXTRA: { tone: 'warning', title: 'Sayım kapsamı dışından', ok: true },
  DUPLICATE: { tone: 'info', title: 'Zaten okutuldu', ok: false },
  DISPOSED: { tone: 'danger', title: 'Elden çıkarılmış demirbaş', ok: false },
  UNKNOWN: { tone: 'danger', title: 'Tanınmayan kod', ok: false },
});

/**
 * Okutma sonucunun ekrandaki bandı: renk, başlık, sesin "olumlu" mu olduğu. Bilinmeyen sonuç tehlike rengiyle.
 * @param {{ result: string, message?: string }} scan
 * @returns {{ tone: string, title: string, ok: boolean, message: string }}
 */
export function scanFeedback(scan) {
  const feedback = SCAN_FEEDBACK[scan.result] ?? { tone: 'danger', title: 'Okutulamadı', ok: false };
  return { ...feedback, message: scan.message ?? '' };
}

export const DEPRECIATION_SOURCE_LABELS = Object.freeze({ OPENING: 'Açılış', POSTED: 'Kaydedildi', PLANNED: 'Plan', NONE: '—' });
export const DEPRECIATION_SOURCE_TONES = Object.freeze({ OPENING: 'neutral', POSTED: 'success', PLANNED: 'info', NONE: 'neutral' });

/** Garantinin kalan günü → renk: bitmiş kırmızı, 30 gün içinde turuncu. @param {number} daysLeft */
export function warrantyTone(daysLeft) {
  if (daysLeft < 0) return 'danger';
  if (daysLeft <= 30) return 'warning';
  return 'neutral';
}

/**
 * Yıllık tutarın aylık payı (yönetim raporları için yıllık / 12; kuruş yuvarlanır).
 * @param {string} amount "1200.00"
 */
export function monthlyShare(amount) {
  const cents = toCents(amount || '0');
  return fromCents((cents + 6n) / 12n);
}

/* ─────────────── Konum seçeneği (oda ya da alan) ─────────────── */

/**
 * Konum seçicisinin değeri: "room:<id>" ya da "area:<id>" (tek seçicide iki tür).
 * @param {{ roomId?: string | null, areaId?: string | null }} location
 */
export function locationValue(location) {
  if (location?.roomId) return `room:${location.roomId}`;
  if (location?.areaId) return `area:${location.areaId}`;
  return '';
}

/**
 * Seçici değerinden konum: `{ roomId, areaId }` (biri dolu ya da ikisi boş).
 * @param {string} value
 */
export function parseLocationValue(value) {
  const [kind, id] = String(value ?? '').split(':');
  if (kind === 'room' && id) return { roomId: id, areaId: null };
  if (kind === 'area' && id) return { roomId: null, areaId: id };
  return { roomId: null, areaId: null };
}

/**
 * Konum seçenekleri: önce alanlar (ada göre), sonra odalar (kat, numara).
 * @param {{ areas?: Array<{ id: string, name: string }>, rooms?: Array<{ id: string, number: string, floor?: number }> }} options
 * @returns {Array<{ value: string, label: string }>}
 */
export function locationOptions(options) {
  const areas = [...(options?.areas ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'tr')).map((area) => ({ value: `area:${area.id}`, label: `Alan · ${area.name}` }));
  const rooms = [...(options?.rooms ?? [])]
    .sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0) || a.number.localeCompare(b.number, 'tr', { numeric: true }))
    .map((room) => ({ value: `room:${room.id}`, label: `Oda ${room.number}` }));
  return [...areas, ...rooms];
}

/* ─────────────── Etiket ─────────────── */

const LABEL_STYLES = Object.freeze({
  THERMAL_50x30: `
    @page { size: 50mm 30mm; margin: 0; }
    .sheet { display: block; }
    .label { width: 50mm; height: 30mm; padding: 1.5mm; page-break-after: always; break-after: page; }
    .label:last-child { page-break-after: auto; break-after: auto; }
    .qr { width: 26mm; height: 26mm; }
    .code { font-size: 11pt; }
    .name { font-size: 7pt; -webkit-line-clamp: 3; }
  `,
  A4_3x8: `
    @page { size: A4; margin: 0; }
    .sheet { display: grid; grid-template-columns: repeat(3, 70mm); grid-auto-rows: 37mm; width: 210mm; padding: 0.5mm 0; }
    .label { width: 70mm; height: 37mm; padding: 2.5mm 3mm; }
    .label.blank { visibility: hidden; }
    .qr { width: 31mm; height: 31mm; }
    .code { font-size: 13pt; }
    .name { font-size: 8pt; -webkit-line-clamp: 3; }
  `,
});

const LABEL_BASE_STYLE = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; }
  .label { display: flex; gap: 2mm; align-items: center; overflow: hidden; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .qr { flex: none; }
  .text { min-width: 0; display: flex; flex-direction: column; gap: 0.8mm; }
  .code { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: bold; letter-spacing: 0.02em; white-space: nowrap; }
  .name { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.15; }
  .hotel { font-size: 6pt; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

/**
 * Demirbaş etiketlerinin yazdırılacak belgesi: her etikette QR (kamerayla okutunca kartı açan bağlantı), büyük
 * kod, ad ve otel adı. Termal yazıcıda her etiket bir sayfa; A4 sayfasında 3 × 8 ızgara ve başlangıç konumu (önceki
 * baskıdan kalan boş etiketler atlanır). Tüm metinler kaçışlanır.
 *
 * @param {{
 *   items: Array<{ code: string, name: string }>, hotelName?: string,
 *   format: 'THERMAL_50x30' | 'A4_3x8', start?: number, origin: string,
 * }} input
 * @returns {string} HTML belgesi
 */
export function assetLabelsHtml({ items, hotelName = '', format, start = 1, origin }) {
  const style = LABEL_STYLES[format] ?? LABEL_STYLES.THERMAL_50x30;
  const skip = format === 'A4_3x8' ? Math.min(Math.max(Math.trunc(start) || 1, 1), ASSET_A4_LABELS_PER_SHEET) - 1 : 0;
  const blanks = Array.from({ length: skip }, () => '<div class="label blank"></div>').join('');
  const labels = items
    .map(
      (item) =>
        `<div class="label"><div class="qr">${qrSvg(assetQrUrl(origin, item.code), { title: item.code })}</div>` +
        `<div class="text"><span class="code">${escapeHtml(item.code)}</span><span class="name">${escapeHtml(item.name)}</span>` +
        (hotelName ? `<span class="hotel">${escapeHtml(hotelName)}</span>` : '') +
        '</div></div>',
    )
    .join('');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Demirbaş etiketleri</title><style>${LABEL_BASE_STYLE}${style}</style></head><body><div class="sheet">${blanks}${labels}</div></body></html>`;
}

/* ─────────────── Excel ─────────────── */

/** Yüklenebilecek en büyük dosya. */
export const ASSET_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const DATE_KEYS = new Set(['purchaseDate', 'warrantyUntil']);
const TURKISH_DAY = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** @param {unknown} text */
const normalizeHeader = (text) => String(text ?? '').trim().toLocaleLowerCase('tr').replace(/\s+/g, ' ');

/** @param {number} value */
const pad2 = (value) => String(value).padStart(2, '0');

/**
 * Tarih hücresi → "YYYY-AA-GG". Excel'in tarih hücresi `Date` (UTC gece yarısı) gelir; metin "GG.AA.YYYY",
 * "GG/AA/YYYY" ya da "YYYY-AA-GG" olabilir. Tanınmayan metin olduğu gibi kalır (sunucu satır hatası olarak söyler).
 * @param {unknown} value
 */
export function excelDay(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }
  const text = String(value ?? '').trim();
  const turkish = TURKISH_DAY.exec(text);
  if (turkish) return `${turkish[3]}-${pad2(Number(turkish[2]))}-${pad2(Number(turkish[1]))}`;
  const iso = ISO_DAY.exec(text);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : text;
}

/**
 * Hücre → metin: sayı (tutar) en fazla iki ondalıkla, tarih sütunu günle, boş hücre "".
 * @param {string} key sütun anahtarı
 * @param {unknown} value
 */
function cellValue(key, value) {
  if (value === null || value === undefined) return '';
  if (DATE_KEYS.has(key)) return excelDay(value);
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  if (value instanceof Date) return excelDay(value);
  return String(value).trim();
}

/**
 * Excel'in satırlarını yükleme satırlarına çevirir: başlık satırındaki sütun adları (büyük / küçük harf ve boşluk
 * duyarsız; şablondaki ad ya da alan anahtarı) eşlenir, boş satırlar atlanır, her hücre metne çevrilir. Doğrulama ve
 * adların kayda çevrilmesi sunucuda (önizleme).
 *
 * @param {unknown[][]} rows `readSheet` çıktısı
 * @returns {{ rows: Array<Record<string, string>>, errors: string[] }}
 */
export function parseAssetImportRows(rows) {
  if (!rows?.length) return { rows: [], errors: ['Dosya boş.'] };
  const lookup = new Map();
  for (const column of ASSET_IMPORT_COLUMNS) {
    lookup.set(normalizeHeader(column.label), column.key);
    lookup.set(normalizeHeader(column.key), column.key);
  }
  const header = rows[0].map((cell) => lookup.get(normalizeHeader(cell)) ?? null);
  const missing = ASSET_IMPORT_COLUMNS.filter((column) => column.required && !header.includes(column.key)).map((column) => column.label);
  if (missing.length) return { rows: [], errors: [`Başlık satırında eksik sütun: ${missing.join(', ')}. Ekrandan indirilen şablonu kullanın.`] };

  const parsed = [];
  for (const row of rows.slice(1)) {
    const record = Object.fromEntries(ASSET_IMPORT_COLUMNS.map((column) => [column.key, '']));
    header.forEach((key, index) => {
      if (key) record[key] = cellValue(key, row[index]);
    });
    if (Object.values(record).every((value) => value === '')) continue;
    parsed.push(record);
  }
  if (parsed.length === 0) return { rows: [], errors: ['Dosyada demirbaş satırı yok.'] };
  if (parsed.length > MAX_ASSET_IMPORT_ROWS) return { rows: [], errors: [`Bir seferde en fazla ${MAX_ASSET_IMPORT_ROWS} satır yüklenir (dosyada ${parsed.length} satır var); dosyayı bölün.`] };
  return { rows: parsed, errors: [] };
}

/**
 * Yüklenen Excel'i okur.
 * @param {File} file
 */
export async function readAssetImport(file) {
  if (file.size > ASSET_IMPORT_MAX_BYTES) return { rows: [], errors: [`Dosya çok büyük (en fazla ${ASSET_IMPORT_MAX_BYTES / 1024 / 1024} MB).`] };
  const { readSheet } = await import('read-excel-file/browser');
  return parseAssetImportRows(await readSheet(file));
}

/** Örnek satır (şablonda başlığın altında). */
const IMPORT_EXAMPLE = Object.freeze({
  name: 'Lobi koltuğu (3 kişilik)',
  category: 'Mobilya',
  location: 'Lobi',
  purchaseDate: '15.03.2024',
  cost: 18500,
  usefulLifeYears: 5,
  brand: '',
  model: '',
  serialNumber: '',
  supplierName: 'Örnek Mobilya Ltd.',
  invoiceNumber: 'A-1024',
  warrantyUntil: '15.03.2026',
  openingAccumulated: 3700,
  openingThroughYear: 2024,
  employeeCode: '',
  note: '',
});

/** Boş şablonu indirir: başlık + örnek satır (tarih "GG.AA.YYYY", tutar sayı). */
export async function downloadAssetImportTemplate() {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const header = ASSET_IMPORT_COLUMNS.map((column) => ({ value: column.required ? `${column.label}` : column.label, fontWeight: 'bold', backgroundColor: column.required ? '#fde68a' : '#eef2f7' }));
  const example = ASSET_IMPORT_COLUMNS.map((column) => {
    const value = IMPORT_EXAMPLE[column.key];
    return typeof value === 'number' ? { value, type: Number } : { value: String(value), type: String };
  });
  await writeXlsxFile([header, example], {
    sheet: 'Demirbaşlar',
    columns: ASSET_IMPORT_COLUMNS.map((column) => ({ width: Math.max(12, column.label.length + 2) })),
    stickyRowsCount: 1,
  }).toFile('demirbas-sablonu.xlsx');
}

/**
 * Amortisman tablosunu Excel'e yazar (mali müşavir için): demirbaş satırları ve toplam.
 * @param {any} table `GET /assets/depreciation` yanıtı
 */
export async function exportDepreciationExcel(table) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const labels = ['Kod', 'Demirbaş', 'Kategori', 'Alış tarihi', 'Maliyet', 'Ömür (yıl)', 'Oran %', 'Dönem başı birikmiş', 'Yıl amortismanı', 'Aylık pay', 'Dönem sonu birikmiş', 'Net değer', 'Elden çıkarma'];
  const bold = (value) => ({ value, fontWeight: 'bold', backgroundColor: '#eef2f7' });
  const number = (value) => ({ value: Number(value), type: Number, format: '#,##0.00' });
  const text = (value) => ({ value: value ?? '', type: String });
  const rows = table.rows.map((row) => [
    text(row.code),
    text(row.name),
    text(row.categoryName),
    text(row.purchaseDate),
    number(row.cost),
    { value: row.usefulLifeYears, type: Number },
    number(row.ratePct),
    number(row.accumulatedStart),
    number(row.amount),
    number(monthlyShare(row.amount)),
    number(row.accumulatedEnd),
    number(row.bookValueEnd),
    text(row.disposedOn),
  ]);
  const totals = table.totals;
  const footer = [bold('Toplam'), text(`${table.rows.length} demirbaş`), null, null, number(totals.cost), null, null, number(totals.accumulatedStart), number(totals.amount), number(monthlyShare(totals.amount)), number(totals.accumulatedEnd), number(totals.bookValueEnd), null];
  await writeXlsxFile([labels.map(bold), ...rows, footer], {
    sheet: `Amortisman ${table.year}`,
    columns: labels.map((label) => ({ width: Math.max(10, label.length + 2) })),
    stickyRowsCount: 1,
  }).toFile(`amortisman-${table.year}.xlsx`);
}
