import { Prisma } from '@prisma/client';
import { DESIGNER_AGGREGATE_LABELS, aggregateKey, designerColumn, resolvePeriod } from '@hotelos/hotel-contracts';
import { columnSql, sourceSql } from './catalog.js';

/**
 * Tasarımdan SQL (modül 26). Her parça ya katalogdaki sabit ifade ya da parametre: kullanıcının yazdığı hiçbir şey SQL
 * metnine girmez. Seçilen sütunlar sırayla `c0, c1…`, toplamlar `a0, a1…` takma adıyla döner; gruplama sıra
 * numarasıyla (`GROUP BY 1, 2`), sıralama takma adla.
 */

const join = Prisma.join;
const raw = Prisma.raw;

/** LIKE özel karakterlerini kaçışlar (kullanıcının "%" yazması joker olmasın). @param {string} text */
const escapeLike = (text) => text.replace(/[\\%_]/g, (char) => `\\${char}`);
/** "1.250,50" değil — sözleşme yalnız "1250.5" / sayı geçirir; virgül noktaya. @param {string | number} value */
const numeric = (value) => Prisma.sql`${String(value).replace(',', '.')}::numeric`;
const day = (value) => Prisma.sql`${String(value)}::date`;

/**
 * Filtrenin WHERE parçası.
 * @param {Prisma.Sql} expression @param {{ type: string }} column @param {any} filter @param {string} today
 */
function filterSql(expression, column, filter, today) {
  const value = (input) => (column.type === 'date' ? day(input) : numeric(input));
  switch (filter.op) {
    case 'CONTAINS':
      return Prisma.sql`${expression} ILIKE ${`%${escapeLike(String(filter.value))}%`}`;
    case 'EQ':
      return column.type === 'text' ? Prisma.sql`lower(${expression}) = lower(${String(filter.value)})` : Prisma.sql`${expression} = ${value(filter.value)}`;
    case 'EMPTY':
      return Prisma.sql`(${expression} IS NULL OR ${expression}::text = '')`;
    case 'NOT_EMPTY':
      return Prisma.sql`(${expression} IS NOT NULL AND ${expression}::text <> '')`;
    case 'IN':
      return Prisma.sql`${expression} = ANY(${filter.values}::text[])`;
    case 'NOT_IN':
      return Prisma.sql`(${expression} IS NULL OR NOT (${expression} = ANY(${filter.values}::text[])))`;
    case 'PERIOD': {
      const range = resolvePeriod(filter.period, today);
      return Prisma.sql`${expression} BETWEEN ${day(range.from)} AND ${day(range.to)}`;
    }
    case 'BETWEEN':
      return Prisma.sql`${expression} BETWEEN ${value(filter.value)} AND ${value(filter.valueTo)}`;
    case 'GTE':
      return Prisma.sql`${expression} >= ${value(filter.value)}`;
    case 'LTE':
      return Prisma.sql`${expression} <= ${value(filter.value)}`;
    default:
      throw new Error(`Bilinmeyen işleç: ${filter.op}`);
  }
}

/** Toplamın SQL'i. @param {{ fn: string, column: string | null }} aggregate @param {(key: string) => Prisma.Sql} sqlOf */
function aggregateSql(aggregate, sqlOf) {
  if (aggregate.fn === 'COUNT') return raw('count(*)::int');
  const expression = sqlOf(aggregate.column);
  if (aggregate.fn === 'AVG') return Prisma.sql`round(avg(${expression})::numeric, 2)`;
  return Prisma.sql`${raw(aggregate.fn.toLowerCase())}(${expression})`;
}

/**
 * Doğrulanmış tasarımdan sorgu ve çıktının sütun düzeni.
 * @param {import('@hotelos/hotel-contracts').ReportDesign} design
 * @param {{ hotelId: string, timezone: string, today: string, limit: number }} context
 * @returns {{ query: Prisma.Sql, outputs: Array<{ alias: string, key: string, label: string, kind: string, options?: Record<string, string> }> }}
 */
export function buildDesignQuery(design, { hotelId, timezone, today, limit }) {
  const source = sourceSql(design.source);
  const sqlOf = (key) => columnSql(design.source, key, { timezone });
  const kindOf = (column) => (column.type === 'enum' ? 'text' : column.type);

  const outputs = design.columns.map((key, index) => {
    const column = designerColumn(design.source, key);
    return { alias: `c${index}`, key, label: column.label, kind: kindOf(column), options: column.options, sql: sqlOf(key) };
  });
  if (design.grouped) {
    design.aggregates.forEach((aggregate, index) => {
      const column = aggregate.column ? designerColumn(design.source, aggregate.column) : null;
      outputs.push({
        alias: `a${index}`,
        key: aggregateKey(aggregate),
        label: column ? `${DESIGNER_AGGREGATE_LABELS[aggregate.fn]} · ${column.label}` : DESIGNER_AGGREGATE_LABELS.COUNT,
        kind: column ? column.type : 'number',
        sql: aggregateSql(aggregate, sqlOf),
      });
    });
  }

  const select = join(outputs.map((output) => Prisma.sql`${output.sql} AS ${raw(`"${output.alias}"`)}`), ', ');
  const conditions = [Prisma.sql`${raw(source.hotelColumn)} = ${hotelId}`, raw(source.where)];
  for (const filter of design.filters) {
    conditions.push(filterSql(sqlOf(filter.column), designerColumn(design.source, filter.column), filter, today));
  }
  const where = join(conditions, ' AND ');

  const aliasOf = new Map(outputs.map((output) => [output.key, output.alias]));
  const sorts = design.sort.length > 0 ? design.sort : outputs.length > 0 ? [{ key: outputs[0].key, dir: 'ASC' }] : [];
  const orderBy = sorts.length ? Prisma.sql` ORDER BY ${join(sorts.map((sort) => raw(`"${aliasOf.get(sort.key)}" ${sort.dir === 'DESC' ? 'DESC' : 'ASC'} NULLS LAST`)), ', ')}` : Prisma.empty;
  const dimensions = design.columns.length;
  const groupBy = design.grouped && dimensions > 0 ? Prisma.sql` GROUP BY ${raw(Array.from({ length: dimensions }, (_, index) => index + 1).join(', '))}` : Prisma.empty;

  const query = Prisma.sql`SELECT ${select} FROM ${raw(source.from)} WHERE ${where}${groupBy}${orderBy} LIMIT ${limit}`;
  return { query, outputs: outputs.map(({ sql, ...output }) => output) };
}

/**
 * Hücre: tarih → "YYYY-AA-GG", durum / tür kodu → Türkçe adı, tutar → "1250.50", sayı → sayı.
 * @param {unknown} value @param {{ kind: string, options?: Record<string, string> }} output
 */
function cellValue(value, output) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (output.options) return output.options[String(value)] ?? String(value);
  if (output.kind === 'money') return new Prisma.Decimal(String(value)).toFixed(2);
  if (output.kind === 'number') return Number(value);
  return String(value);
}

/**
 * Sorgu satırları → ekranın tablosu (`{ columns, rows, summary, currency }`, rapor asistanıyla aynı biçim).
 * @param {Array<Record<string, unknown>>} rows @param {ReturnType<typeof buildDesignQuery>['outputs']} outputs
 */
export function toDataset(rows, outputs) {
  return {
    columns: outputs.map((output) => ({ key: output.key, label: output.label, kind: output.kind })),
    rows: rows.map((row) => Object.fromEntries(outputs.map((output) => [output.key, cellValue(row[output.alias], output)]))),
    summary: [],
    currency: null,
  };
}
