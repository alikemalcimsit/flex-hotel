import { BOARD_TYPE_LABELS, BOARD_TYPES } from './constants.js';
import { EMAIL_PATTERN, isoDayField } from './fields.js';
import { COUNTRY_CODES, ID_DOCUMENT_TYPE_LABELS, ID_DOCUMENT_TYPES, identityNumberError, looksLikeCardNumber, normalizeIdNumber } from './front-desk.js';
import { z } from './locale.js';
import { PERMISSIONS } from './permissions.js';
import { MAX_BASE_OCCUPANCY, MAX_RATE_PLAN_STAY, MIN_BASE_OCCUPANCY, MIN_RATE_PLAN_STAY } from './pricing.js';

/**
 * Excel'den toplu yükleme (modül 26): misafir listesi ve fiyat planı.
 *
 * Sihirbaz: dosya seç → dosyanın sütunlarını alanlarla eşleştir (başlık adlarından otomatik önerilir) → satırlar
 * denetlenir (önizleme) → hatasızsa içe aktar. Yükleme ya hep ya hiç; aynı yükleme kimliği ikinci kez gönderilirse
 * yeniden yazılmaz (önceki sonuç döner).
 *
 * - **Misafir:** sistemde aynı kişi (belge no / e-posta / telefon) varsa yeni kart açılmaz, satır "zaten var" olarak
 *   raporlanır; mevcut karta dokunulmaz (kullanıcı kararı). Dosyada tekrarlanan kişi de bir kez açılır.
 * - **Fiyat planı:** aynı oda tipi + pansiyonda tarihi çakışan plan (sistemde ya da dosyada) satırı reddeder; mevcut
 *   fiyatlar habersiz değişmez (kullanıcı kararı).
 */

export const IMPORT_KINDS = Object.freeze(['GUESTS', 'RATE_PLANS']);
export const IMPORT_KIND_LABELS = Object.freeze({ GUESTS: 'Misafir listesi', RATE_PLANS: 'Fiyat planı' });
export const IMPORT_KIND_PERMISSIONS = Object.freeze({ GUESTS: PERMISSIONS.GUESTS_MANAGE, RATE_PLANS: PERMISSIONS.SETTINGS_MANAGE });

/** Satır sonucu: yazılacak, atlanacak (zaten var), hatalı. */
export const IMPORT_ROW_STATUSES = Object.freeze(['OK', 'SKIP', 'ERROR']);
export const IMPORT_ROW_STATUS_LABELS = Object.freeze({ OK: 'Hazır', SKIP: 'Zaten var (atlanacak)', ERROR: 'Hatalı' });

export const MAX_IMPORT_ROWS = 2000;
/** Hücre metninin üst sınırı (taşan hücre hatadır). */
export const MAX_IMPORT_CELL = 300;

/**
 * Alan tanımı: anahtar, ekrandaki ad, zorunlu mu, dosya başlığı eşleşmesi için eş anlamlılar.
 * @typedef {{ key: string, label: string, required?: boolean, aliases: string[], hint?: string }} ImportField
 */

/** @type {Record<string, ReadonlyArray<ImportField>>} */
export const IMPORT_FIELDS = Object.freeze({
  GUESTS: Object.freeze([
    { key: 'firstName', label: 'Ad', required: true, aliases: ['ad', 'adı', 'isim', 'first name', 'firstname', 'name'] },
    { key: 'lastName', label: 'Soyad', required: true, aliases: ['soyad', 'soyadı', 'soyisim', 'last name', 'lastname', 'surname'] },
    { key: 'phone', label: 'Telefon', aliases: ['telefon', 'tel', 'cep', 'gsm', 'cep telefonu', 'cep no', 'telefon no', 'telefon numarası', 'gsm no', 'phone', 'mobile', 'phone number'] },
    { key: 'email', label: 'E-posta', aliases: ['e-posta', 'eposta', 'email', 'e-mail', 'mail', 'e-posta adresi', 'mail adresi', 'email address'] },
    { key: 'nationality', label: 'Uyruk', hint: 'İki harfli ülke kodu (TR, DE…)', aliases: ['uyruk', 'ülke', 'nationality', 'country'] },
    { key: 'idType', label: 'Belge türü', hint: 'TC kimlik / Pasaport / Diğer', aliases: ['belge türü', 'kimlik türü', 'id type', 'document type'] },
    { key: 'idNumber', label: 'Belge no', aliases: ['belge no', 'belge numarası', 'kimlik no', 'kimlik numarası', 'tc', 'tc no', 'tc kimlik no', 'tckn', 'pasaport no', 'pasaport numarası', 'passport', 'passport no', 'id number'] },
    { key: 'birthDate', label: 'Doğum tarihi', hint: 'GG.AA.YYYY', aliases: ['doğum tarihi', 'dogum tarihi', 'birth date', 'birthdate', 'dob'] },
    { key: 'tags', label: 'Etiketler', hint: 'Virgülle ayrılmış (VIP, Sadık)', aliases: ['etiket', 'etiketler', 'tags'] },
    { key: 'notes', label: 'Not', aliases: ['not', 'notlar', 'açıklama', 'notes'] },
  ]),
  RATE_PLANS: Object.freeze([
    { key: 'roomType', label: 'Oda tipi', required: true, hint: 'Oda tipinin kodu ya da adı', aliases: ['oda tipi', 'oda tipi kodu', 'room type', 'roomtype'] },
    { key: 'name', label: 'Plan adı', required: true, aliases: ['plan adı', 'plan', 'ad', 'name'] },
    { key: 'boardType', label: 'Pansiyon', required: true, hint: 'RO / BB / HB / FB / AI / UAI ya da adı', aliases: ['pansiyon', 'pansiyon tipi', 'board', 'board type'] },
    { key: 'startDate', label: 'Başlangıç', required: true, hint: 'GG.AA.YYYY', aliases: ['başlangıç', 'baslangic', 'başlangıç tarihi', 'start', 'start date', 'from'] },
    { key: 'endDate', label: 'Bitiş', required: true, hint: 'GG.AA.YYYY (dahil)', aliases: ['bitiş', 'bitis', 'bitiş tarihi', 'end', 'end date', 'to'] },
    { key: 'price', label: 'Gecelik fiyat', required: true, aliases: ['fiyat', 'gecelik fiyat', 'price', 'rate'] },
    { key: 'baseOccupancy', label: 'Dahil kişi', hint: 'Boşsa 2', aliases: ['dahil kişi', 'kişi', 'base occupancy'] },
    { key: 'extraAdultRate', label: 'Ek yetişkin', aliases: ['ek yetişkin', 'ekstra yetişkin', 'extra adult'] },
    { key: 'childRate', label: 'Çocuk başı ek', aliases: ['çocuk', 'çocuk başı ek', 'child', 'child rate'] },
    { key: 'minStay', label: 'En az gece', aliases: ['en az gece', 'min gece', 'min stay', 'minimum stay'] },
  ]),
});

/** Başlık karşılaştırması: Türkçe küçük harf, boşluk / noktalama sadeleşmiş. @param {unknown} text */
export const normalizeHeader = (text) =>
  String(text ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[*:()]/g, '')
    .replace(/[\s_.-]+/g, ' ')
    .trim();

/**
 * Dosya başlıklarından alan eşleşmesi önerisi: alanın adı ya da eş anlamlısı başlıkla aynıysa. Her başlık en fazla bir
 * alana gider.
 * @param {string} kind @param {unknown[]} headers dosyanın ilk satırı
 * @returns {Record<string, number | null>} alan → başlık sırası (yoksa null)
 */
export function suggestImportMapping(kind, headers) {
  const normalized = headers.map(normalizeHeader);
  const used = new Set();
  return Object.fromEntries(
    IMPORT_FIELDS[kind].map((field) => {
      const names = [field.label, ...field.aliases].map(normalizeHeader);
      const index = normalized.findIndex((header, position) => !used.has(position) && names.includes(header));
      if (index >= 0) used.add(index);
      return [field.key, index >= 0 ? index : null];
    }),
  );
}

/* ─────────────── Hücre okuma ─────────────── */

const cell = z.union([z.string(), z.number()]).nullish().transform((value) => (value == null ? '' : String(value).trim()));

/** "16.11.2026", "16/11/2026", "2026-11-16" → "2026-11-16"; değilse olduğu gibi (şema yakalar). @param {string} value */
export function importDay(value) {
  const text = String(value ?? '').trim();
  const local = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);
  if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  return text;
}

/** "1.250,50" / "1250,5" / "1250.50" → "1250.50"; değilse olduğu gibi. @param {string} value */
export function importAmount(value) {
  const text = String(value ?? '').trim().replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) return text.replace(/\./g, '').replace(',', '.');
  return text.replace(',', '.');
}

const optionalText = (max, label) =>
  cell
    .refine((value) => value.length <= max, { message: `${label} en fazla ${max} karakter` })
    .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' })
    .transform((value) => value || null);

const requiredText = (max, label) => optionalText(max, label).refine((value) => value !== null, { message: `${label} boş` });

const optionalDay = (label) =>
  cell.transform(importDay).refine((value) => value === '' || isoDayField.safeParse(value).success, { message: `${label} geçersiz (GG.AA.YYYY)` }).transform((value) => value || null);

const requiredDay = (label) => optionalDay(label).refine((value) => value !== null, { message: `${label} boş` });

const amount = (label, { required = false, min = 0 } = {}) =>
  cell
    .transform(importAmount)
    .refine((value) => (value === '' ? !required : /^\d+(\.\d{1,2})?$/.test(value) && Number(value) >= min && Number(value) <= 100_000_000), {
      message: required ? `${label} geçersiz (ör. 2500 ya da 2.500,00)` : `${label} geçersiz`,
    })
    .transform((value) => value || null);

const integer = (label, min, max) =>
  cell
    .refine((value) => value === '' || (/^\d+$/.test(value) && Number(value) >= min && Number(value) <= max), { message: `${label} ${min}–${max} arası tam sayı olmalı` })
    .transform((value) => (value === '' ? null : Number(value)));

/**
 * Kod karşılaştırması İngilizce büyük harfle: Türkçe küçük harfte "I" noktasız "ı" olur ("AI" → "aı"), kod eşleşmezdi.
 * @param {unknown} value
 */
const codeOf = (value) => String(value ?? '').trim().replace(/[\s-]+/g, '_').toLocaleUpperCase('en-US');

/** Belge türü: kod ya da Türkçe adı ("TC kimlik", "Pasaport"). */
const ID_TYPE_ALIASES = Object.freeze({
  'tc kimlik': 'NATIONAL_ID',
  'tc': 'NATIONAL_ID',
  'kimlik': 'NATIONAL_ID',
  'nüfus cüzdanı': 'NATIONAL_ID',
  'pasaport': 'PASSPORT',
  'passport': 'PASSPORT',
  'diğer': 'OTHER',
});
const idTypeOf = (value) => {
  const key = normalizeHeader(value);
  if (!key) return null;
  const byCode = ID_DOCUMENT_TYPES.find((type) => type === codeOf(value));
  const byLabel = Object.entries(ID_DOCUMENT_TYPE_LABELS).find(([, label]) => normalizeHeader(label) === key)?.[0];
  return byCode ?? byLabel ?? ID_TYPE_ALIASES[key] ?? undefined;
};

/** Pansiyon adının sade hâli: kod öneki ("BB — ") ve "+" atılır ("Oda + kahvaltı" = "oda kahvaltı"). @param {unknown} text */
const boardName = (text) =>
  normalizeHeader(String(text ?? '').split('—').at(-1))
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Pansiyon: kod ("BB") ya da adı ("Oda kahvaltı", "Yarım pansiyon", "BB — Oda + kahvaltı"). */
const boardOf = (value) => {
  const name = boardName(value);
  return BOARD_TYPES.find((board) => board === codeOf(value)) ?? Object.entries(BOARD_TYPE_LABELS).find(([, label]) => boardName(label) === name)?.[0];
};

/* ─────────────── Satır şemaları ─────────────── */

export const guestImportRowSchema = z
  .object({
    firstName: requiredText(80, 'Ad'),
    lastName: requiredText(80, 'Soyad'),
    phone: optionalText(40, 'Telefon'),
    email: optionalText(120, 'E-posta').refine((value) => value === null || EMAIL_PATTERN.test(value), { message: 'E-posta geçersiz' }),
    nationality: cell
      .transform((value) => value.toLocaleUpperCase('en-US'))
      .refine((value) => value === '' || COUNTRY_CODES.includes(value), { message: 'Uyruk iki harfli ülke kodu olmalı (TR, DE…)' })
      .transform((value) => value || null),
    idType: cell.transform(idTypeOf).refine((value) => value !== undefined, { message: 'Belge türü TC kimlik, Pasaport ya da Diğer olmalı' }),
    idNumber: optionalText(60, 'Belge no').transform((value) => (value ? normalizeIdNumber(value) : null)),
    birthDate: optionalDay('Doğum tarihi'),
    tags: cell.transform((value) =>
      value
        .split(/[,;]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 10),
    ),
    notes: optionalText(MAX_IMPORT_CELL, 'Not'),
  })
  .superRefine((row, ctx) => {
    if (row.idNumber) {
      const idType = row.idType ?? 'OTHER';
      const error = identityNumberError({ idType, idNumber: row.idNumber, nationality: row.nationality ?? '' });
      if (error) ctx.addIssue({ code: 'custom', path: ['idNumber'], message: error });
    }
    if (row.idType && !row.idNumber) ctx.addIssue({ code: 'custom', path: ['idNumber'], message: 'Belge türü yazılmış ama belge no boş' });
  });

export const ratePlanImportRowSchema = z
  .object({
    roomType: requiredText(80, 'Oda tipi'),
    name: requiredText(80, 'Plan adı'),
    boardType: cell.transform(boardOf).refine((value) => value !== undefined, { message: 'Pansiyon RO / BB / HB / FB / AI / UAI olmalı' }),
    startDate: requiredDay('Başlangıç'),
    endDate: requiredDay('Bitiş'),
    price: amount('Gecelik fiyat', { required: true, min: 0.01 }),
    baseOccupancy: integer('Dahil kişi', MIN_BASE_OCCUPANCY, MAX_BASE_OCCUPANCY),
    extraAdultRate: amount('Ek yetişkin'),
    childRate: amount('Çocuk başı ek'),
    minStay: integer('En az gece', MIN_RATE_PLAN_STAY, MAX_RATE_PLAN_STAY),
  })
  .superRefine((row, ctx) => {
    if (row.price === null) ctx.addIssue({ code: 'custom', path: ['price'], message: 'Gecelik fiyat boş' });
    if (row.startDate && row.endDate && row.endDate < row.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Bitiş başlangıçtan önce olamaz' });
  });

export const IMPORT_ROW_SCHEMAS = Object.freeze({ GUESTS: guestImportRowSchema, RATE_PLANS: ratePlanImportRowSchema });

/** Sunucuya giden satır: alan anahtarı → hücre metni (eşleştirmeden sonra). */
const rawRow = z.record(z.string().max(40), z.union([z.string().max(MAX_IMPORT_CELL * 2), z.number(), z.null()]));

export const dataImportSchema = z.object({
  /** Sihirbazın ürettiği kimlik: aynı yükleme ikinci kez yazılmaz. */
  requestId: z.string().uuid('Yükleme kimliği geçersiz'),
  dryRun: z.boolean().default(true),
  fileName: z.string().trim().max(200).nullish().transform((value) => value ?? null),
  rows: z.array(rawRow).min(1, 'Dosyada satır yok').max(MAX_IMPORT_ROWS, `Bir seferde en fazla ${MAX_IMPORT_ROWS} satır`),
});

export const dataImportParamSchema = z.object({ kind: z.enum(IMPORT_KINDS) });
