import { useState } from 'react';
import { IMPORT_FIELDS, IMPORT_ROW_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Select } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { formatDate, formatMoney } from '../../lib/format.js';
import { IMPORT_RESULT_FILTERS, filterImportRows, rowErrorText, sampleValues } from '../../lib/dataImport.js';

/**
 * Excel yükleme sihirbazının (modül 26) parçaları: sütun eşleştirme tablosu ve denetim sonucu tablosu.
 */

const STATUS_TONES = Object.freeze({ OK: 'success', SKIP: 'warning', ERROR: 'danger' });
/** Sonuç tablosunda en fazla satır (sayılar ayrıca gösterilir). */
const MAX_RESULT_ROWS = 300;

/**
 * Alan → dosya sütunu eşleştirmesi (başlıklardan önerilir, elle değişir); her alanın yanında dosyadan örnek değerler.
 * @param {{ kind: string, headers: string[], rows: unknown[][], mapping: Record<string, number | null>, onChange: (mapping: Record<string, number | null>) => void }} props
 */
export function MappingTable({ kind, headers, rows, mapping, onChange }) {
  const options = [{ value: '', label: '— Eşleme yok —' }, ...headers.map((header, index) => ({ value: String(index), label: header }))];
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Alan
            </th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Dosyadaki sütun
            </th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Örnek değerler
            </th>
          </tr>
        </thead>
        <tbody>
          {IMPORT_FIELDS[kind].map((field) => {
            const index = mapping[field.key];
            const samples = sampleValues(rows, index);
            return (
              <tr key={field.key} className="border-t border-line align-top">
                <th scope="row" className="px-3 py-2 text-left font-semibold">
                  {field.label}
                  {field.required && <span className="ml-1 text-sec-strong">*</span>}
                  {field.hint && <span className="block text-xs font-normal text-ink-muted">{field.hint}</span>}
                </th>
                <td className="px-3 py-2">
                  <Select
                    compact
                    name={`import-map-${field.key}`}
                    aria-label={`${field.label} sütunu`}
                    value={index === null || index === undefined ? '' : String(index)}
                    options={options}
                    onChange={(event) => onChange({ ...mapping, [field.key]: event.target.value === '' ? null : Number(event.target.value) })}
                    className="min-w-48"
                  />
                </td>
                <td className="px-3 py-2 text-xs text-ink-muted">{samples.length ? samples.join(' · ') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Satırın kaydı okunur özet. @param {string} kind @param {any} preview */
function previewText(kind, preview) {
  if (!preview) return '—';
  if (kind === 'GUESTS') return [preview.name, preview.phone, preview.email, preview.nationality].filter(Boolean).join(' · ');
  return [preview.roomTypeName, preview.name, preview.boardType, `${formatDate(preview.startDate)} – ${formatDate(preview.endDate)}`, formatMoney(preview.price)].filter(Boolean).join(' · ');
}

/**
 * Denetim / yükleme sonucu: sayılar, süzgeç ve satır satır durum (Excel satır numarasıyla).
 * @param {{ kind: string, result: any }} props
 */
export function ResultTable({ kind, result }) {
  const [filter, setFilter] = useState(result.summary.errors > 0 ? 'ERROR' : 'ALL');
  const rows = filterImportRows(result.rows, filter);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="neutral">{result.summary.total} satır</Badge>
        <Badge tone="success">{result.summary.ok} hazır</Badge>
        <Badge tone="warning">{result.summary.skipped} zaten var</Badge>
        <Badge tone={result.summary.errors ? 'danger' : 'neutral'}>{result.summary.errors} hatalı</Badge>
      </div>
      <ChoiceChips label="Göster" options={IMPORT_RESULT_FILTERS} value={filter} onChange={(value) => value && setFilter(value)} />
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu süzgeçte satır yok.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-card border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Excel satırı
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Durum
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Kayıt
                </th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">
                  Açıklama
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, MAX_RESULT_ROWS).map((row) => (
                <tr key={row.index} className="border-t border-line align-top">
                  <td className="px-3 py-2 tabular-nums text-ink-muted">{row.index + 2}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONES[row.status]}>{IMPORT_ROW_STATUS_LABELS[row.status]}</Badge>
                  </td>
                  <td className="px-3 py-2">{previewText(kind, row.preview)}</td>
                  <td className={`px-3 py-2 text-xs ${row.status === 'ERROR' ? 'text-sec-strong' : 'text-ink-muted'}`}>{row.status === 'ERROR' ? rowErrorText(kind, row) : (row.note ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > MAX_RESULT_ROWS && <p className="text-xs text-ink-muted">İlk {MAX_RESULT_ROWS} satır gösteriliyor.</p>}
    </div>
  );
}
