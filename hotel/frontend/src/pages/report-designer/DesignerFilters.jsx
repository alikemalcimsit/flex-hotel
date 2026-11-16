import {
  DESIGNER_COLUMNS,
  DESIGNER_OPERATORS,
  DESIGNER_OPERATOR_LABELS,
  MAX_DESIGNER_FILTERS,
  MAX_DESIGNER_ROWS,
  MAX_DESIGNER_SORTS,
  REPORT_PERIOD_LABELS,
  REPORT_PERIOD_PRESETS,
  designerColumn,
} from '@hotelos/hotel-contracts';
import { Button, Input, Select } from '@hotelos/ui';
import { MultiChips } from '../../components/MultiChips.jsx';
import { sortOptions } from '../../lib/reportDesigner.js';
import { DesignerSection, IconButton } from './DesignerSections.jsx';

/**
 * Rapor tasarımcısının (modül 26) filtre ve sıralama bölümleri. Filtrenin değer alanı sütunun türüne göre: metin,
 * seçenek çipleri, tarih ya da göreli dönem ("geçen ay" — kayıtlı rapor çalıştırıldığı güne göre kayar), sayı.
 */

/**
 * @param {{ design: any, dispatch: Function, errors: string[] }} props
 */
export function FiltersSection({ design, dispatch, errors }) {
  const columns = DESIGNER_COLUMNS[design.source] ?? [];
  return (
    <DesignerSection
      step={4}
      title="Filtreler"
      description="Hangi kayıtların rapora gireceği. Tarih için göreli dönem seçerseniz kayıtlı rapor her çalıştığında o güne göre hesaplanır."
      errors={errors}
    >
      {design.filters.length === 0 && <p className="text-sm text-ink-muted">Filtre yok: kaynağın tüm kayıtları (satır sınırına kadar).</p>}
      <div className="flex flex-col gap-3">
        {design.filters.map((filter, index) => {
          const column = designerColumn(design.source, filter.column) ?? columns[0];
          return (
            <div key={index} className="flex flex-col gap-2 rounded-card border border-line p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Select
                  compact
                  label="Sütun"
                  name={`filter-column-${index}`}
                  value={filter.column}
                  options={columns.map((item) => ({ value: item.key, label: item.label }))}
                  onChange={(event) => dispatch({ type: 'SET_FILTER_COLUMN', index, column: event.target.value })}
                  className="w-52"
                />
                <Select
                  compact
                  label="Koşul"
                  name={`filter-op-${index}`}
                  value={filter.op}
                  options={DESIGNER_OPERATORS[column.type].map((op) => ({ value: op, label: DESIGNER_OPERATOR_LABELS[op] }))}
                  onChange={(event) => dispatch({ type: 'SET_FILTER_OPERATOR', index, op: event.target.value })}
                  className="w-44"
                />
                <FilterValue column={column} filter={filter} index={index} onChange={(patch) => dispatch({ type: 'UPDATE_FILTER', index, patch })} />
                <IconButton label="Filtreyi kaldır" icon="trash" onClick={() => dispatch({ type: 'REMOVE_FILTER', index })} />
              </div>
              {(filter.op === 'IN' || filter.op === 'NOT_IN') && (
                <MultiChips
                  label={`${column.label}: seçenekler`}
                  options={Object.entries(column.options ?? {}).map(([value, label]) => ({ value, label }))}
                  values={filter.values}
                  onChange={(values) => dispatch({ type: 'UPDATE_FILTER', index, patch: { values } })}
                />
              )}
            </div>
          );
        })}
      </div>
      <div>
        <Button size="sm" variant="outline" icon="plus" disabled={design.filters.length >= MAX_DESIGNER_FILTERS} onClick={() => dispatch({ type: 'ADD_FILTER' })}>
          Filtre ekle
        </Button>
      </div>
    </DesignerSection>
  );
}

/**
 * Filtrenin değer alanı (seçenek çipleri ayrı satırda).
 * @param {{ column: { key: string, label: string, type: string }, filter: any, index: number, onChange: (patch: object) => void }} props
 */
function FilterValue({ column, filter, index, onChange }) {
  const { op } = filter;
  if (op === 'EMPTY' || op === 'NOT_EMPTY' || op === 'IN' || op === 'NOT_IN') return null;
  if (op === 'PERIOD') {
    return (
      <Select
        compact
        label="Dönem"
        name={`filter-period-${index}`}
        value={filter.period ?? 'THIS_MONTH'}
        options={REPORT_PERIOD_PRESETS.map((value) => ({ value, label: REPORT_PERIOD_LABELS[value] }))}
        onChange={(event) => onChange({ period: event.target.value })}
        className="w-48"
      />
    );
  }
  const isDate = column.type === 'date';
  const isNumber = column.type === 'number' || column.type === 'money';
  const field = (key, label) => (
    <Input
      label={label}
      name={`filter-${key}-${index}`}
      type={isDate ? 'date' : 'text'}
      inputMode={isNumber ? 'decimal' : undefined}
      value={filter[key] ?? ''}
      maxLength={100}
      onChange={(event) => onChange({ [key]: event.target.value })}
      className="w-44"
    />
  );
  if (op === 'BETWEEN') {
    return (
      <>
        {field('value', isDate ? 'Başlangıç' : 'En az')}
        {field('valueTo', isDate ? 'Bitiş' : 'En çok')}
      </>
    );
  }
  return field('value', 'Değer');
}

/**
 * Sıralama ve satır sınırı.
 * @param {{ design: any, dispatch: Function, errors: string[] }} props
 */
export function SortSection({ design, dispatch, errors }) {
  const options = sortOptions(design);
  return (
    <DesignerSection step={5} title="Sıralama ve sınır" description="Sıralama seçilen sütunlardan (gruplu raporda toplamlardan da) yapılır." errors={errors}>
      <div className="flex flex-col gap-2">
        {design.sort.map((sort, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <Select
              compact
              label={index === 0 ? 'Sırala' : undefined}
              name={`sort-key-${index}`}
              value={sort.key}
              options={options}
              onChange={(event) => dispatch({ type: 'UPDATE_SORT', index, patch: { key: event.target.value } })}
              className="w-56"
            />
            <Select
              compact
              label={index === 0 ? 'Yön' : undefined}
              name={`sort-dir-${index}`}
              value={sort.dir}
              options={[
                { value: 'ASC', label: 'Artan (A → Z, küçük → büyük)' },
                { value: 'DESC', label: 'Azalan (Z → A, büyük → küçük)' },
              ]}
              onChange={(event) => dispatch({ type: 'UPDATE_SORT', index, patch: { dir: event.target.value } })}
              className="w-64"
            />
            <IconButton label="Sıralamayı kaldır" icon="trash" onClick={() => dispatch({ type: 'REMOVE_SORT', index })} />
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-4">
          <Button size="sm" variant="outline" icon="plus" disabled={design.sort.length >= MAX_DESIGNER_SORTS || options.length === design.sort.length} onClick={() => dispatch({ type: 'ADD_SORT' })}>
            Sıralama ekle
          </Button>
          <Input
            label={`Satır sınırı (en fazla ${MAX_DESIGNER_ROWS})`}
            name="design-limit"
            type="number"
            min={1}
            max={MAX_DESIGNER_ROWS}
            value={design.limit}
            onChange={(event) => dispatch({ type: 'SET_LIMIT', limit: Math.min(MAX_DESIGNER_ROWS, Math.max(1, Number(event.target.value) || 1)) })}
            className="w-48"
          />
        </div>
      </div>
    </DesignerSection>
  );
}
