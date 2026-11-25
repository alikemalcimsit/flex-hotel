import { BOARD_TYPE_LABELS, RESERVATION_STATUS_LABELS } from './constants.js';
import { expectedUpdatedAt, isoDayField } from './fields.js';
import { FOLIO_ITEM_SOURCE_LABELS, FOLIO_ITEM_TYPE_LABELS, PAYMENT_METHOD_LABELS } from './folios.js';
import { ID_DOCUMENT_TYPE_LABELS, looksLikeCardNumber } from './front-desk.js';
import { z } from './locale.js';
import { PAYMENT_KIND_LABELS, PAYMENT_SOURCE_LABELS, PAYMENT_STATUS_LABELS } from './payments.js';
import { PERMISSIONS } from './permissions.js';
import { REPORT_PERIOD_PRESETS } from './report-chat.js';
import { RESERVATION_SOURCE_LABELS } from './reservations.js';

/**
 * Rapor tasarımcısı (modül 26) sözleşmesi.
 *
 * Kullanıcı bir **kaynak** seçer (rezervasyon, folyo kalemi, misafir, ödeme), izin verilen **sütunlardan** seçer, filtre
 * ekler, isterse gruplar (boyut sütunları + toplam / adet / ortalama), sıralar. Sunucu sorguyu yalnız bu katalogdan
 * kurar: sütunun SQL ifadesi sunucudadır, kullanıcıdan gelen yalnız anahtar ve parametreli değerdir (SQL enjeksiyonuna
 * kapalı). Her kaynağın kendi görme yetkisi vardır (misafir kaynağı kişisel veri — misafir yetkisi ister).
 *
 * Tasarım kaydedilir (kişisel + otelle paylaşılabilir; "Kayıtlı raporlar"da rapor asistanının raporlarıyla birlikte).
 * Tarih filtresi göreli dönem alabilir ("geçen ay") — kayıtlı rapor çalıştırıldığı güne göre kayar.
 */

/* ─────────────── Kaynaklar ve sütunlar ─────────────── */

export const DESIGNER_SOURCES = Object.freeze(['RESERVATIONS', 'FOLIO_ITEMS', 'GUESTS', 'PAYMENTS']);
export const DESIGNER_SOURCE_LABELS = Object.freeze({
  RESERVATIONS: 'Rezervasyonlar',
  FOLIO_ITEMS: 'Folyo kalemleri (harcamalar)',
  GUESTS: 'Misafirler',
  PAYMENTS: 'Ödemeler',
});
/** Kaynağı görmek için gereken yetki (rapor yetkisinin üstüne). */
export const DESIGNER_SOURCE_PERMISSIONS = Object.freeze({
  RESERVATIONS: PERMISSIONS.RESERVATIONS_VIEW,
  FOLIO_ITEMS: PERMISSIONS.FOLIO_VIEW,
  GUESTS: PERMISSIONS.GUESTS_VIEW,
  PAYMENTS: PERMISSIONS.CASH_VIEW,
});

/** Sütun türleri: filtre işlecini ve toplanabilirliği belirler. */
export const DESIGNER_COLUMN_TYPES = Object.freeze(['text', 'enum', 'date', 'number', 'money']);

const ACTIVE_STATE_LABELS = Object.freeze({ ACTIVE: 'Geçerli', VOIDED: 'İptal edildi' });

const text = (key, label) => ({ key, label, type: 'text' });
const enumOf = (key, label, labels) => ({ key, label, type: 'enum', options: labels });
const date = (key, label) => ({ key, label, type: 'date' });
const number = (key, label) => ({ key, label, type: 'number' });
const money = (key, label) => ({ key, label, type: 'money' });

/** Kaynakların izin verilen sütunları (sıra: seçim listesindeki sıra). */
export const DESIGNER_COLUMNS = Object.freeze({
  RESERVATIONS: Object.freeze([
    text('confirmationCode', 'Onay kodu'),
    enumOf('status', 'Durum', RESERVATION_STATUS_LABELS),
    enumOf('source', 'Kaynak', RESERVATION_SOURCE_LABELS),
    text('guestName', 'Misafir'),
    text('roomTypeName', 'Oda tipi'),
    text('roomNumber', 'Oda'),
    text('agencyName', 'Acente'),
    enumOf('boardType', 'Pansiyon', BOARD_TYPE_LABELS),
    date('checkIn', 'Giriş'),
    date('checkOut', 'Çıkış'),
    text('checkInMonth', 'Giriş ayı'),
    number('nights', 'Gece'),
    number('adults', 'Yetişkin'),
    number('children', 'Çocuk'),
    money('totalPrice', 'Tutar'),
    money('discountTotal', 'İndirim'),
    text('currency', 'Para birimi'),
    date('createdAt', 'Kayıt günü'),
    text('createdMonth', 'Kayıt ayı'),
    date('cancelledAt', 'İptal günü'),
    money('cancellationFee', 'İptal bedeli'),
  ]),
  FOLIO_ITEMS: Object.freeze([
    date('serviceDate', 'Hizmet günü'),
    text('serviceMonth', 'Hizmet ayı'),
    enumOf('type', 'Tür', FOLIO_ITEM_TYPE_LABELS),
    enumOf('source', 'Nereden', FOLIO_ITEM_SOURCE_LABELS),
    text('description', 'Açıklama'),
    number('quantity', 'Adet'),
    money('netAmount', 'Net'),
    money('taxAmount', 'Vergi'),
    money('total', 'Toplam'),
    enumOf('state', 'Durum', ACTIVE_STATE_LABELS),
    text('guestName', 'Misafir'),
    text('confirmationCode', 'Onay kodu'),
    text('roomNumber', 'Oda'),
    text('currency', 'Para birimi'),
    text('postedBy', 'İşleyen'),
  ]),
  GUESTS: Object.freeze([
    text('firstName', 'Ad'),
    text('lastName', 'Soyad'),
    text('nationality', 'Uyruk'),
    text('phone', 'Telefon'),
    text('email', 'E-posta'),
    enumOf('idType', 'Belge türü', ID_DOCUMENT_TYPE_LABELS),
    date('birthDate', 'Doğum tarihi'),
    text('tags', 'Etiketler'),
    number('stayCount', 'Konaklama sayısı'),
    date('lastStay', 'Son çıkış'),
    date('createdAt', 'Kayıt günü'),
    text('createdMonth', 'Kayıt ayı'),
  ]),
  PAYMENTS: Object.freeze([
    date('businessDate', 'İş günü'),
    text('businessMonth', 'Ay'),
    enumOf('kind', 'Tür', PAYMENT_KIND_LABELS),
    enumOf('status', 'Durum', PAYMENT_STATUS_LABELS),
    enumOf('method', 'Yöntem', PAYMENT_METHOD_LABELS),
    enumOf('source', 'Nereden', PAYMENT_SOURCE_LABELS),
    money('amount', 'Tutar'),
    text('currency', 'Para birimi'),
    money('folioAmount', 'Folyo tutarı (otel parası)'),
    enumOf('state', 'Geçerlilik', ACTIVE_STATE_LABELS),
    text('guestName', 'Misafir'),
    text('confirmationCode', 'Onay kodu'),
    text('reference', 'Referans'),
    text('receivedBy', 'Alan'),
  ]),
});

/** @param {string} source @param {string} key */
export const designerColumn = (source, key) => DESIGNER_COLUMNS[source]?.find((column) => column.key === key) ?? null;

/* ─────────────── İşleçler ve toplamlar ─────────────── */

export const DESIGNER_OPERATORS = Object.freeze({
  text: Object.freeze(['CONTAINS', 'EQ', 'EMPTY', 'NOT_EMPTY']),
  enum: Object.freeze(['IN', 'NOT_IN']),
  date: Object.freeze(['PERIOD', 'BETWEEN', 'GTE', 'LTE', 'EMPTY', 'NOT_EMPTY']),
  number: Object.freeze(['EQ', 'GTE', 'LTE', 'BETWEEN']),
  money: Object.freeze(['EQ', 'GTE', 'LTE', 'BETWEEN']),
});
export const DESIGNER_OPERATOR_LABELS = Object.freeze({
  CONTAINS: 'içerir',
  EQ: 'eşittir',
  EMPTY: 'boş',
  NOT_EMPTY: 'dolu',
  IN: 'şunlardan biri',
  NOT_IN: 'şunlar dışında',
  PERIOD: 'dönem',
  BETWEEN: 'arasında',
  GTE: 'en az / sonra',
  LTE: 'en çok / önce',
});

export const DESIGNER_AGGREGATES = Object.freeze(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
export const DESIGNER_AGGREGATE_LABELS = Object.freeze({ COUNT: 'Adet', SUM: 'Toplam', AVG: 'Ortalama', MIN: 'En az', MAX: 'En çok' });
/** Toplanabilen sütun türleri. */
export const DESIGNER_NUMERIC_TYPES = Object.freeze(['number', 'money']);

export const MAX_DESIGNER_COLUMNS = 25;
export const MAX_DESIGNER_GROUP_COLUMNS = 5;
export const MAX_DESIGNER_AGGREGATES = 6;
export const MAX_DESIGNER_FILTERS = 10;
export const MAX_DESIGNER_SORTS = 3;
/** Önizleme satırı; çalıştırma (Excel) üst sınırı. */
export const DESIGNER_PREVIEW_ROWS = 100;
export const MAX_DESIGNER_ROWS = 5000;
/** Kişi başı kayıtlı tasarım (rapor asistanındaki kayıtlı rapor sınırıyla aynı). */
export const MAX_DESIGNS_PER_USER = 100;
export const MAX_DESIGNER_TEXT_FILTER = 100;

/** Toplam sütununun anahtarı: "COUNT", "SUM:totalPrice". @param {{ fn: string, column?: string | null }} aggregate */
export const aggregateKey = (aggregate) => (aggregate.fn === 'COUNT' ? 'COUNT' : `${aggregate.fn}:${aggregate.column}`);

/* ─────────────── Şema ─────────────── */

const filterSchema = z.object({
  column: z.string().max(40),
  op: z.enum(['CONTAINS', 'EQ', 'EMPTY', 'NOT_EMPTY', 'IN', 'NOT_IN', 'PERIOD', 'BETWEEN', 'GTE', 'LTE']),
  /** Metin / sayı / tarih değeri (BETWEEN'de alt sınır). */
  value: z.union([z.string().trim().max(MAX_DESIGNER_TEXT_FILTER), z.number()]).nullish().transform((value) => value ?? null),
  /** BETWEEN'de üst sınır. */
  valueTo: z.union([z.string().trim().max(MAX_DESIGNER_TEXT_FILTER), z.number()]).nullish().transform((value) => value ?? null),
  /** IN / NOT_IN seçenekleri. */
  values: z.array(z.string().max(40)).max(30).default([]),
  /** PERIOD: göreli dönem. */
  period: z.enum(REPORT_PERIOD_PRESETS).nullish().transform((value) => value ?? null),
});

const aggregateSchema = z.object({
  fn: z.enum(DESIGNER_AGGREGATES),
  column: z.string().max(40).nullish().transform((value) => value ?? null),
});

const sortSchema = z.object({ key: z.string().max(60), dir: z.enum(['ASC', 'DESC']).default('ASC') });

const isNumber = (value) => typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim().replace(',', '.')));

/**
 * Bir filtrenin değer hatası (sütunun türüne göre).
 * @param {{ type: string, options?: Record<string, string> }} column
 * @param {z.infer<typeof filterSchema>} filter
 * @returns {string | null}
 */
function filterError(column, filter) {
  if (!DESIGNER_OPERATORS[column.type].includes(filter.op)) return `"${column.label}" için "${DESIGNER_OPERATOR_LABELS[filter.op]}" kullanılamaz`;
  if (filter.op === 'EMPTY' || filter.op === 'NOT_EMPTY') return null;
  if (filter.op === 'IN' || filter.op === 'NOT_IN') {
    if (filter.values.length === 0) return `"${column.label}" için en az bir seçenek seçin`;
    return filter.values.every((value) => Object.hasOwn(column.options, value)) ? null : `"${column.label}" seçeneği geçersiz`;
  }
  if (filter.op === 'PERIOD') return filter.period ? null : `"${column.label}" için dönem seçin`;
  const bounds = filter.op === 'BETWEEN' ? [filter.value, filter.valueTo] : [filter.value];
  if (bounds.some((value) => value === null || value === '')) return `"${column.label}" için değer yazın`;
  if (column.type === 'date' && !bounds.every((value) => isoDayField.safeParse(value).success)) return `"${column.label}" tarihi geçersiz`;
  if ((column.type === 'number' || column.type === 'money') && !bounds.every(isNumber)) return `"${column.label}" sayı olmalı`;
  if (column.type === 'text' && bounds.some((value) => looksLikeCardNumber(String(value)))) return 'Kart numarası yazılamaz';
  return null;
}

/**
 * Rapor tasarımı. Gruplamasız: seçilen sütunların satırları. Gruplu: seçilen sütunlar boyut, toplamlar yanında.
 * @typedef {z.infer<typeof reportDesignSchema>} ReportDesign
 */
export const reportDesignSchema = z
  .object({
    source: z.enum(DESIGNER_SOURCES, { error: 'Kaynak seçin' }),
    columns: z.array(z.string().max(40)).max(MAX_DESIGNER_COLUMNS, `En fazla ${MAX_DESIGNER_COLUMNS} sütun`).default([]),
    grouped: z.boolean().default(false),
    aggregates: z.array(aggregateSchema).max(MAX_DESIGNER_AGGREGATES, `En fazla ${MAX_DESIGNER_AGGREGATES} toplam`).default([]),
    filters: z.array(filterSchema).max(MAX_DESIGNER_FILTERS, `En fazla ${MAX_DESIGNER_FILTERS} filtre`).default([]),
    sort: z.array(sortSchema).max(MAX_DESIGNER_SORTS, `En fazla ${MAX_DESIGNER_SORTS} sıralama`).default([]),
    limit: z.coerce.number().int().min(1).max(MAX_DESIGNER_ROWS).default(1000),
  })
  .superRefine((design, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
    const known = (key) => designerColumn(design.source, key);
    if (new Set(design.columns).size !== design.columns.length) issue(['columns'], 'Aynı sütun iki kez seçilmiş');
    design.columns.forEach((key, index) => {
      if (!known(key)) issue(['columns', index], `Bilinmeyen sütun: ${key}`);
    });
    if (design.grouped) {
      if (design.columns.length > MAX_DESIGNER_GROUP_COLUMNS) issue(['columns'], `Gruplamada en fazla ${MAX_DESIGNER_GROUP_COLUMNS} sütun`);
      if (design.aggregates.length === 0) issue(['aggregates'], 'Gruplamada en az bir toplam (adet, toplam…) seçin');
      design.aggregates.forEach((aggregate, index) => {
        if (aggregate.fn === 'COUNT') return;
        const column = known(aggregate.column);
        if (!column || !DESIGNER_NUMERIC_TYPES.includes(column.type)) issue(['aggregates', index, 'column'], `${DESIGNER_AGGREGATE_LABELS[aggregate.fn]} yalnız sayı / tutar sütununa uygulanır`);
      });
      if (new Set(design.aggregates.map(aggregateKey)).size !== design.aggregates.length) issue(['aggregates'], 'Aynı toplam iki kez seçilmiş');
    } else if (design.columns.length === 0) {
      issue(['columns'], 'En az bir sütun seçin');
    }
    design.filters.forEach((filter, index) => {
      const column = known(filter.column);
      const error = column ? filterError(column, filter) : `Bilinmeyen filtre sütunu: ${filter.column}`;
      if (error) issue(['filters', index], error);
    });
    const sortable = new Set([...design.columns, ...(design.grouped ? design.aggregates.map(aggregateKey) : [])]);
    design.sort.forEach((sort, index) => {
      if (!sortable.has(sort.key)) issue(['sort', index], 'Sıralama seçilen sütunlardan biri olmalı');
    });
  });

const titleField = z
  .string({ error: 'Başlık yazın' })
  .trim()
  .min(1, 'Başlık yazın')
  .max(80, 'Başlık en fazla 80 karakter')
  .refine((value) => !looksLikeCardNumber(value), { message: 'Kart numarası yazılamaz' });

export const runReportDesignSchema = z.object({ design: reportDesignSchema, preview: z.boolean().default(true) });
export const createReportDefinitionSchema = z.object({ title: titleField, shared: z.boolean().default(false), design: reportDesignSchema });
export const updateReportDefinitionSchema = z.object({
  expectedUpdatedAt,
  title: titleField.optional(),
  shared: z.boolean().optional(),
  design: reportDesignSchema.optional(),
});
