import {
  DESIGNER_AGGREGATE_LABELS,
  DESIGNER_COLUMNS,
  DESIGNER_NUMERIC_TYPES,
  DESIGNER_SOURCE_LABELS,
  MAX_DESIGNER_AGGREGATES,
  MAX_DESIGNER_FILTERS,
  MAX_DESIGNER_SORTS,
  aggregateKey,
  designerColumn,
} from '@hotelos/hotel-contracts';

/**
 * Rapor tasarımcısı (modül 26) ekranının saf yardımcıları: tasarımın durumu (reducer), filtrenin türe göre varsayılanı,
 * sıralama seçenekleri, özet adı, gruplu tablonun grafiği. Sorgu kancaları `reportDesignerQueries.js`'te.
 *
 * Sorgu anahtarları rapor asistanının altında (`['report-chat', 'designer', …]`): aynı canlı kanal (`report-chat.changed`)
 * ikisini birden tazeler.
 */

export const reportDesignerKeys = Object.freeze({
  all: ['report-chat', 'designer'],
  /** @param {'MINE' | 'SHARED'} scope */
  definitions: (scope) => ['report-chat', 'designer', 'definitions', scope],
  /** @param {string} id */
  definition: (id) => ['report-chat', 'designer', 'definition', id],
});

export const REPORT_DESIGNER_PATH = '/raporlar/tasarim';
/** @param {string} id */
export const designerEditPath = (id) => `${REPORT_DESIGNER_PATH}/${id}`;

/** Yeni tasarımın satır sınırı. */
export const DEFAULT_DESIGN_LIMIT = 1000;

/**
 * @typedef {{ column: string, op: string, value: string | number | null, valueTo: string | number | null, values: string[], period: string | null }} DesignFilter
 * @typedef {{ fn: string, column: string | null }} DesignAggregate
 * @typedef {{ source: string, columns: string[], grouped: boolean, aggregates: DesignAggregate[], filters: DesignFilter[], sort: Array<{ key: string, dir: 'ASC' | 'DESC' }>, limit: number }} Design
 */

/** @param {string} source @returns {Design} */
export function emptyDesign(source) {
  return { source, columns: [], grouped: false, aggregates: [], filters: [], sort: [], limit: DEFAULT_DESIGN_LIMIT };
}

/**
 * Sütunun türüne göre yeni filtre: metin "içerir", seçenek "şunlardan biri", tarih "bu ay", sayı "en az".
 * @param {{ key: string, type: string }} column
 * @returns {DesignFilter}
 */
export function defaultFilter(column) {
  const base = { column: column.key, value: null, valueTo: null, values: [], period: null };
  if (column.type === 'enum') return { ...base, op: 'IN' };
  if (column.type === 'date') return { ...base, op: 'PERIOD', period: 'THIS_MONTH' };
  if (column.type === 'text') return { ...base, op: 'CONTAINS', value: '' };
  return { ...base, op: 'GTE', value: '' };
}

/**
 * İşleç değişince ilgisiz değerler temizlenir (sunucuya yalnız işlecin değeri gider).
 * @param {DesignFilter} filter @param {string} op
 */
export function withOperator(filter, op) {
  return {
    ...filter,
    op,
    value: ['EMPTY', 'NOT_EMPTY', 'IN', 'NOT_IN', 'PERIOD'].includes(op) ? null : (filter.value ?? ''),
    valueTo: op === 'BETWEEN' ? (filter.valueTo ?? '') : null,
    values: op === 'IN' || op === 'NOT_IN' ? filter.values : [],
    period: op === 'PERIOD' ? (filter.period ?? 'THIS_MONTH') : null,
  };
}

/** Toplamın adı: "Adet", "Toplam · Tutar". @param {string} source @param {DesignAggregate} aggregate */
export function aggregateLabel(source, aggregate) {
  if (aggregate.fn === 'COUNT') return DESIGNER_AGGREGATE_LABELS.COUNT;
  return `${DESIGNER_AGGREGATE_LABELS[aggregate.fn]} · ${designerColumn(source, aggregate.column)?.label ?? aggregate.column}`;
}

/** Toplanabilen sütunlar. @param {string} source */
export const numericColumns = (source) => (DESIGNER_COLUMNS[source] ?? []).filter((column) => DESIGNER_NUMERIC_TYPES.includes(column.type));

/**
 * Sıralanabilen anahtarlar: seçilen sütunlar ve (gruplu) toplamlar.
 * @param {Design} design
 * @returns {Array<{ value: string, label: string }>}
 */
export function sortOptions(design) {
  const columns = design.columns.map((key) => ({ value: key, label: designerColumn(design.source, key)?.label ?? key }));
  const aggregates = design.grouped ? design.aggregates.filter((item) => item.fn === 'COUNT' || item.column).map((item) => ({ value: aggregateKey(item), label: aggregateLabel(design.source, item) })) : [];
  return [...columns, ...aggregates];
}

/** Artık seçilemeyen sıralamaları ayıklar. @param {Design} design @returns {Design} */
function pruneSort(design) {
  const allowed = new Set(sortOptions(design).map((option) => option.value));
  return { ...design, sort: design.sort.filter((item) => allowed.has(item.key)) };
}

/** @param {unknown[]} list @param {number} from @param {number} to */
function move(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** @param {unknown[]} list @param {number} index @param {object} patch */
const patchAt = (list, index, patch) => list.map((item, position) => (position === index ? { ...item, ...patch } : item));
/** @param {unknown[]} list @param {number} index */
const removeAt = (list, index) => list.filter((_, position) => position !== index);

/**
 * Tasarımın durumu. Her eylem yeni bir tasarım döner (değiştirmez).
 * @param {Design} design
 * @param {{ type: string, [key: string]: any }} action
 * @returns {Design}
 */
export function designReducer(design, action) {
  switch (action.type) {
    case 'LOAD':
      return { ...emptyDesign(action.design.source), ...action.design };
    case 'SET_SOURCE':
      return action.source === design.source ? design : { ...emptyDesign(action.source), limit: design.limit };
    case 'TOGGLE_COLUMN': {
      const columns = design.columns.includes(action.key) ? design.columns.filter((key) => key !== action.key) : [...design.columns, action.key];
      return pruneSort({ ...design, columns });
    }
    case 'MOVE_COLUMN':
      return { ...design, columns: move(design.columns, action.from, action.to) };
    case 'SET_GROUPED': {
      const aggregates = action.grouped && design.aggregates.length === 0 ? [{ fn: 'COUNT', column: null }] : design.aggregates;
      return pruneSort({ ...design, grouped: action.grouped, aggregates });
    }
    case 'ADD_AGGREGATE':
      if (design.aggregates.length >= MAX_DESIGNER_AGGREGATES) return design;
      return { ...design, aggregates: [...design.aggregates, { fn: 'SUM', column: numericColumns(design.source)[0]?.key ?? null }] };
    case 'UPDATE_AGGREGATE': {
      const patch = action.patch.fn === 'COUNT' ? { fn: 'COUNT', column: null } : action.patch;
      const current = design.aggregates[action.index];
      const next = { ...current, ...patch };
      if (next.fn !== 'COUNT' && !next.column) next.column = numericColumns(design.source)[0]?.key ?? null;
      return pruneSort({ ...design, aggregates: patchAt(design.aggregates, action.index, next) });
    }
    case 'REMOVE_AGGREGATE':
      return pruneSort({ ...design, aggregates: removeAt(design.aggregates, action.index) });
    case 'ADD_FILTER': {
      const column = DESIGNER_COLUMNS[design.source]?.[0];
      if (!column || design.filters.length >= MAX_DESIGNER_FILTERS) return design;
      return { ...design, filters: [...design.filters, defaultFilter(column)] };
    }
    case 'SET_FILTER_COLUMN': {
      const column = designerColumn(design.source, action.column);
      return column ? { ...design, filters: design.filters.map((item, index) => (index === action.index ? defaultFilter(column) : item)) } : design;
    }
    case 'SET_FILTER_OPERATOR':
      return { ...design, filters: design.filters.map((item, index) => (index === action.index ? withOperator(item, action.op) : item)) };
    case 'UPDATE_FILTER':
      return { ...design, filters: patchAt(design.filters, action.index, action.patch) };
    case 'REMOVE_FILTER':
      return { ...design, filters: removeAt(design.filters, action.index) };
    case 'ADD_SORT': {
      const first = sortOptions(design).find((option) => !design.sort.some((item) => item.key === option.value));
      if (!first || design.sort.length >= MAX_DESIGNER_SORTS) return design;
      return { ...design, sort: [...design.sort, { key: first.value, dir: 'ASC' }] };
    }
    case 'UPDATE_SORT':
      return { ...design, sort: patchAt(design.sort, action.index, action.patch) };
    case 'REMOVE_SORT':
      return { ...design, sort: removeAt(design.sort, action.index) };
    case 'SET_LIMIT':
      return { ...design, limit: action.limit };
    default:
      return design;
  }
}

/** Kısa özet: "Rezervasyonlar · 5 sütun · 2 filtre · gruplu". @param {Design} design */
export function designSummary(design) {
  const parts = [DESIGNER_SOURCE_LABELS[design.source] ?? design.source, `${design.columns.length} sütun`];
  if (design.filters?.length) parts.push(`${design.filters.length} filtre`);
  if (design.grouped) parts.push(`gruplu (${design.aggregates.length} toplam)`);
  return parts.join(' · ');
}

/**
 * Gruplu raporda grafik: ilk boyut yatay eksen, ilk sayısal toplam sütun. Gruplamasız ya da boyutsuz (tek satır)
 * raporda grafik yok (tablo).
 * @param {Design} design
 * @param {{ columns: Array<{ key: string, kind: string }>, rows: unknown[] }} dataset
 * @returns {{ type: 'BAR' | 'TABLE', series: string[] }}
 */
export function designerChart(design, dataset) {
  if (!design.grouped || design.columns.length === 0 || dataset.rows.length < 2) return { type: 'TABLE', series: [] };
  const firstAggregate = dataset.columns.slice(1).find((column) => column.key !== design.columns[0] && !design.columns.includes(column.key) && ['number', 'money', 'percent'].includes(column.kind));
  return firstAggregate ? { type: 'BAR', series: [firstAggregate.key] } : { type: 'TABLE', series: [] };
}

/** Tasarımın sunucuya giden hâli: boş metin değerleri `null` olur. @param {Design} design */
export function designPayload(design) {
  const blank = (value) => (value === '' || value === undefined ? null : value);
  return {
    ...design,
    filters: design.filters.map((item) => ({ ...item, value: blank(item.value), valueTo: blank(item.valueTo) })),
  };
}

/**
 * Doğrulama hatalarını bölümlere göre toplar: "columns", "aggregates", "filters.1" → bölüm adı.
 * @param {Record<string, string>} errors `validateWith` çıktısı
 * @returns {Record<'columns' | 'aggregates' | 'filters' | 'sort' | 'source' | 'limit', string[]>}
 */
export function groupDesignErrors(errors) {
  const sections = { source: [], columns: [], aggregates: [], filters: [], sort: [], limit: [] };
  for (const [path, message] of Object.entries(errors ?? {})) {
    const section = path.split('.')[0];
    (sections[section] ?? sections.columns).push(message);
  }
  return sections;
}
