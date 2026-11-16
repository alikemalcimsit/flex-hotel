import { useState } from 'react';
import {
  DESIGNER_AGGREGATES,
  DESIGNER_AGGREGATE_LABELS,
  DESIGNER_COLUMNS,
  DESIGNER_SOURCES,
  DESIGNER_SOURCE_LABELS,
  DESIGNER_SOURCE_PERMISSIONS,
  MAX_DESIGNER_AGGREGATES,
  MAX_DESIGNER_GROUP_COLUMNS,
  designerColumn,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Checkbox, Icon, Select } from '@hotelos/ui';
import { useCan } from '../../lib/permissions.js';
import { numericColumns } from '../../lib/reportDesigner.js';

/**
 * Rapor tasarımcısının (modül 26) bölümleri: kaynak, sütunlar, gruplama. Filtre ve sıralama `DesignerFilters.jsx`'te.
 * Her bölüm tasarımın yalnız kendi parçasını gösterir; değişiklik reducer eylemiyle (`dispatch`) gider.
 */

/** Sütun türünün kısa adı (seçim listesinde). */
const TYPE_LABELS = Object.freeze({ text: 'metin', enum: 'seçenek', date: 'tarih', number: 'sayı', money: 'tutar' });

/** @param {{ step: number, title: string, description?: string, errors?: string[], children: React.ReactNode, action?: React.ReactNode }} props */
export function DesignerSection({ step, title, description, errors = [], children, action }) {
  return (
    <Card>
      <section className="flex flex-col gap-4" aria-labelledby={`designer-step-${step}`}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id={`designer-step-${step}`} className="flex items-center gap-2 text-base font-bold">
              <span className="flex size-6 items-center justify-center rounded-full bg-ink text-xs text-white">{step}</span>
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
          </div>
          {action}
        </header>
        {children}
        {errors.length > 0 && (
          <Alert tone="danger">
            <ul className="list-disc space-y-0.5 pl-4">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </Alert>
        )}
      </section>
    </Card>
  );
}

/**
 * Kaynak seçimi: yetkisi olmayan kaynak seçilemez (misafir kaynağı kişisel veri; misafir görme yetkisi ister).
 * @param {{ source: string, dispatch: Function, errors: string[] }} props
 */
export function SourceSection({ source, dispatch, errors }) {
  const can = useCan();
  return (
    <DesignerSection step={1} title="Kaynak" description="Raporun hangi kayıtlardan kurulacağı. Kaynak değişince seçimler sıfırlanır." errors={errors}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {DESIGNER_SOURCES.map((value) => {
          const allowed = can(DESIGNER_SOURCE_PERMISSIONS[value]);
          const selected = value === source;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              disabled={!allowed}
              title={allowed ? undefined : 'Bu kaynağı görme yetkiniz yok'}
              onClick={() => dispatch({ type: 'SET_SOURCE', source: value })}
              className={`flex flex-col items-start gap-1 rounded-card border px-4 py-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                selected ? 'border-ink bg-ink text-white' : 'border-line bg-surface hover:border-ink'
              }`}
            >
              <span className="text-sm font-semibold">{DESIGNER_SOURCE_LABELS[value]}</span>
              <span className={`text-xs ${selected ? 'text-white/80' : 'text-ink-muted'}`}>{allowed ? `${DESIGNER_COLUMNS[value].length} sütun` : 'Yetkiniz yok'}</span>
            </button>
          );
        })}
      </div>
    </DesignerSection>
  );
}

/**
 * Sütunlar: soldan işaretle, sağda sırala (oklar ya da sürükle-bırak).
 * @param {{ design: any, dispatch: Function, errors: string[] }} props
 */
export function ColumnsSection({ design, dispatch, errors }) {
  const [dragging, setDragging] = useState(/** @type {number | null} */ (null));
  const available = DESIGNER_COLUMNS[design.source] ?? [];
  const groupFull = design.grouped && design.columns.length >= MAX_DESIGNER_GROUP_COLUMNS;
  const moveTo = (from, to) => dispatch({ type: 'MOVE_COLUMN', from, to });

  return (
    <DesignerSection
      step={2}
      title={design.grouped ? 'Gruplanacak sütunlar' : 'Sütunlar'}
      description={design.grouped ? `Satırlar bu sütunlara göre toplanır (en fazla ${MAX_DESIGNER_GROUP_COLUMNS}).` : 'Tabloda görünecek sütunlar; sağdaki sıra tablonun sırası.'}
      errors={errors}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Kullanılabilir</legend>
          <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
            {available.map((column) => {
              const checked = design.columns.includes(column.key);
              return (
                <Checkbox
                  key={column.key}
                  name={`design-column-${column.key}`}
                  label={column.label}
                  hint={TYPE_LABELS[column.type]}
                  checked={checked}
                  disabled={!checked && groupFull}
                  onChange={() => dispatch({ type: 'TOGGLE_COLUMN', key: column.key })}
                />
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Seçilen ({design.columns.length})</p>
          {design.columns.length === 0 ? (
            <p className="text-sm text-ink-muted">Soldan sütun işaretleyin.</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {design.columns.map((key, index) => (
                <li
                  key={key}
                  draggable
                  onDragStart={() => setDragging(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragging !== null) moveTo(dragging, index);
                    setDragging(null);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={`flex items-center gap-2 rounded-card border bg-surface px-3 py-1.5 text-sm ${dragging === index ? 'border-ink opacity-60' : 'border-line'}`}
                >
                  <span className="cursor-grab text-ink-muted" aria-hidden>
                    ⋮⋮
                  </span>
                  <span className="flex-1">{designerColumn(design.source, key)?.label ?? key}</span>
                  <IconButton label="Yukarı taşı" icon="arrowDown" rotate disabled={index === 0} onClick={() => moveTo(index, index - 1)} />
                  <IconButton label="Aşağı taşı" icon="arrowDown" disabled={index === design.columns.length - 1} onClick={() => moveTo(index, index + 1)} />
                  <IconButton label="Çıkar" icon="close" onClick={() => dispatch({ type: 'TOGGLE_COLUMN', key })} />
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </DesignerSection>
  );
}

/** @param {{ label: string, icon: string, onClick: () => void, disabled?: boolean, rotate?: boolean }} props */
export function IconButton({ label, icon, onClick, disabled = false, rotate = false }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-30">
      <Icon name={icon} className={`size-4 ${rotate ? 'rotate-180' : ''}`} />
    </button>
  );
}

/**
 * Gruplama: açıkken seçilen sütunlar boyut olur, yanına toplamlar (adet, toplam, ortalama, en az, en çok) gelir.
 * @param {{ design: any, dispatch: Function, errors: string[] }} props
 */
export function GroupingSection({ design, dispatch, errors }) {
  const numeric = numericColumns(design.source);
  return (
    <DesignerSection
      step={3}
      title="Gruplama"
      description="Kapalıyken her kayıt bir satır. Açıkken seçilen sütunlara göre toplanır (ör. kaynağa göre adet ve tutar)."
      errors={errors}
      action={<Checkbox name="design-grouped" label="Grupla" checked={design.grouped} onChange={(event) => dispatch({ type: 'SET_GROUPED', grouped: event.target.checked })} />}
    >
      {design.grouped && (
        <div className="flex flex-col gap-2">
          {design.aggregates.map((aggregate, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              <Select
                compact
                label={index === 0 ? 'Hesap' : undefined}
                name={`aggregate-fn-${index}`}
                value={aggregate.fn}
                options={DESIGNER_AGGREGATES.map((fn) => ({ value: fn, label: DESIGNER_AGGREGATE_LABELS[fn], disabled: fn !== 'COUNT' && numeric.length === 0 }))}
                onChange={(event) => dispatch({ type: 'UPDATE_AGGREGATE', index, patch: { fn: event.target.value } })}
                className="w-40"
              />
              {aggregate.fn !== 'COUNT' && (
                <Select
                  compact
                  label={index === 0 ? 'Sütun' : undefined}
                  name={`aggregate-column-${index}`}
                  value={aggregate.column ?? ''}
                  options={numeric.map((column) => ({ value: column.key, label: column.label }))}
                  onChange={(event) => dispatch({ type: 'UPDATE_AGGREGATE', index, patch: { column: event.target.value } })}
                  className="w-56"
                />
              )}
              <IconButton label="Toplamı kaldır" icon="trash" onClick={() => dispatch({ type: 'REMOVE_AGGREGATE', index })} />
            </div>
          ))}
          <div>
            <Button size="sm" variant="outline" icon="plus" disabled={design.aggregates.length >= MAX_DESIGNER_AGGREGATES} onClick={() => dispatch({ type: 'ADD_AGGREGATE' })}>
              Toplam ekle
            </Button>
          </div>
        </div>
      )}
    </DesignerSection>
  );
}
