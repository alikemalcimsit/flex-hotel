import { IMPORT_FIELDS, IMPORT_KIND_PERMISSIONS, IMPORT_KINDS, MAX_IMPORT_ROWS } from '@hotelos/hotel-contracts';
import { excelDay } from './assets.js';

/**
 * Excel'den toplu yükleme (modül 26) sihirbazının saf yardımcıları: şablon, dosyanın okunması, sütun eşleştirmesi,
 * hücrenin metne çevrilmesi, sonuç süzgeci. Doğrulama ve kayda çevirme sunucuda (önizleme / yükleme).
 */

export const dataImportKeys = Object.freeze({
  all: ['data-import'],
  history: ['data-import', 'history'],
});

export const DATA_IMPORT_PATH = '/ice-aktar';
/** Yüklemeden sonra kayıtların göründüğü ekran. */
export const IMPORT_TARGET_LINKS = Object.freeze({
  GUESTS: { to: '/misafirler', label: 'Misafirlere git' },
  RATE_PLANS: { to: '/ayarlar/fiyat-planlari', label: 'Fiyat planlarına git' },
});

/** Okunan dosyanın üst sınırı. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** Şablonun örnek satırı. */
const EXAMPLES = Object.freeze({
  GUESTS: {
    firstName: 'Ayşe',
    lastName: 'Kaya',
    phone: '0532 111 22 33',
    email: 'ayse.kaya@ornek.com',
    nationality: 'TR',
    idType: 'TC kimlik',
    idNumber: '10000000146',
    birthDate: '01.02.1990',
    tags: 'VIP, Sadık',
    notes: 'Deniz manzaralı oda tercih eder',
  },
  RATE_PLANS: {
    roomType: 'STD',
    name: 'Yaz 2027',
    boardType: 'BB',
    startDate: '01.06.2027',
    endDate: '31.08.2027',
    price: '3250',
    baseOccupancy: '2',
    extraAdultRate: '750',
    childRate: '400',
    minStay: '2',
  },
});

/** Sonuç süzgeci. */
export const IMPORT_RESULT_FILTERS = Object.freeze([
  { value: 'ALL', label: 'Hepsi' },
  { value: 'ERROR', label: 'Hatalı' },
  { value: 'SKIP', label: 'Atlanacak' },
  { value: 'OK', label: 'Hazır' },
]);

/**
 * Kullanıcının yükleyebildiği türler.
 * @param {(permission: string) => boolean} can
 */
export const importKindsFor = (can) => IMPORT_KINDS.filter((kind) => can(IMPORT_KIND_PERMISSIONS[kind]));

/**
 * Şablon: başlık satırı (zorunlular yıldızlı) ve bir örnek satır.
 * @param {string} kind
 * @returns {[string[], string[]]}
 */
export function templateRows(kind) {
  const fields = IMPORT_FIELDS[kind];
  return [fields.map((field) => (field.required ? `${field.label}*` : field.label)), fields.map((field) => EXAMPLES[kind][field.key] ?? '')];
}

/** @param {string} kind */
export async function downloadImportTemplate(kind) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const [header, example] = templateRows(kind);
  await writeXlsxFile(
    [header.map((value) => ({ value, fontWeight: 'bold', backgroundColor: '#eef2f7' })), example.map((value) => ({ value, type: String }))],
    { sheet: 'Yükleme', columns: header.map((label) => ({ width: Math.max(14, label.length + 4) })), stickyRowsCount: 1 },
  ).toFile(kind === 'GUESTS' ? 'misafir-sablonu.xlsx' : 'fiyat-plani-sablonu.xlsx');
}

/**
 * Hücre → metin: Excel tarihi "YYYY-AA-GG", sayı en fazla iki ondalıkla (kimlik / telefon gibi tam sayılar olduğu
 * gibi), boş "".
 * @param {unknown} value
 */
export function importCellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return excelDay(value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
  return String(value).trim();
}

/**
 * Dosyanın satırları → başlıklar ve dolu veri satırları (tamamen boş satır atlanır).
 * @param {unknown[][]} sheet `readSheet` çıktısı
 * @returns {{ headers: string[], rows: unknown[][], errors: string[] }}
 */
export function splitSheet(sheet) {
  if (!sheet?.length) return { headers: [], rows: [], errors: ['Dosya boş.'] };
  const headers = sheet[0].map((cell, index) => importCellText(cell) || `Sütun ${index + 1}`);
  const rows = sheet.slice(1).filter((row) => row.some((cell) => importCellText(cell) !== ''));
  if (rows.length === 0) return { headers, rows: [], errors: ['Dosyada başlıktan sonra satır yok.'] };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { headers, rows: [], errors: [`Bir seferde en fazla ${MAX_IMPORT_ROWS} satır yüklenir (dosyada ${rows.length} satır var); dosyayı bölün.`] };
  }
  return { headers, rows, errors: [] };
}

/**
 * Yüklenen Excel'in ilk sayfasını okur.
 * @param {File} file
 */
export async function readImportFile(file) {
  if (file.size > IMPORT_MAX_BYTES) return { headers: [], rows: [], errors: [`Dosya çok büyük (en fazla ${IMPORT_MAX_BYTES / 1024 / 1024} MB).`] };
  const { readSheet } = await import('read-excel-file/browser');
  return splitSheet(await readSheet(file));
}

/**
 * Eşleştirmeye göre sunucuya giden satırlar: alan anahtarı → hücre metni (eşlenmemiş alan gönderilmez).
 * @param {unknown[][]} rows @param {Record<string, number | null>} mapping
 * @returns {Array<Record<string, string>>}
 */
export function mapImportRows(rows, mapping) {
  const pairs = Object.entries(mapping).filter(([, index]) => index !== null && index !== undefined);
  return rows.map((row) => Object.fromEntries(pairs.map(([key, index]) => [key, importCellText(row[index])])));
}

/**
 * Sütunun ilk dolu örnek değerleri (eşleştirme tablosunda).
 * @param {unknown[][]} rows @param {number | null} index @param {number} [count]
 */
export function sampleValues(rows, index, count = 3) {
  if (index === null || index === undefined) return [];
  const values = [];
  for (const row of rows) {
    const text = importCellText(row[index]);
    if (text) values.push(text);
    if (values.length >= count) break;
  }
  return values;
}

/** Eşlenmemiş zorunlu alanların adları. @param {string} kind @param {Record<string, number | null>} mapping */
export const missingRequired = (kind, mapping) => IMPORT_FIELDS[kind].filter((field) => field.required && (mapping[field.key] === null || mapping[field.key] === undefined)).map((field) => field.label);

/**
 * Sonuç satırları süzgeçten.
 * @param {Array<{ status: string }>} rows @param {string} filter `ALL` | `OK` | `SKIP` | `ERROR`
 */
export const filterImportRows = (rows, filter) => (filter === 'ALL' ? rows : rows.filter((row) => row.status === filter));

/**
 * Satırın hataları okunur metin: "Ad: boş · E-posta: geçersiz".
 * @param {string} kind @param {{ errors: Array<{ field: string, message: string }> }} row
 */
export function rowErrorText(kind, row) {
  const labels = new Map(IMPORT_FIELDS[kind].map((field) => [field.key, field.label]));
  return row.errors.map((error) => (labels.has(error.field) ? `${labels.get(error.field)}: ${error.message}` : error.message)).join(' · ');
}
