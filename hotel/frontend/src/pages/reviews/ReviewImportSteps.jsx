import { useState } from 'react';
import { REVIEW_IMPORT_FIELDS } from '@hotelos/hotel-contracts';
import { Badge, Select } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { sampleValues } from '../../lib/dataImport.js';
import { formatDate } from '../../lib/format.js';

/** Yorum yükleme sihirbazının (modül 54) parçaları: sütun eşleştirme ve önizleme / sonuç tablosu. */

const STATUS = Object.freeze({ OK: { tone: 'success', label: 'Hazır' }, SKIP: { tone: 'warning', label: 'Zaten var' }, ERROR: { tone: 'danger', label: 'Hatalı' } });
const FILTERS = [
  { value: 'ALL', label: 'Hepsi' },
  { value: 'ERROR', label: 'Hatalı' },
  { value: 'SKIP', label: 'Zaten var' },
  { value: 'OK', label: 'Hazır' },
];
/** Tabloda en fazla satır (sayılar ayrıca). */
const MAX_RESULT_ROWS = 300;
const TH = 'px-3 py-2 text-left font-semibold';

/**
 * Alan → dosya sütunu (başlıklardan önerilir, elle değişir); yanında dosyadan örnekler.
 * @param {{ headers: string[], rows: unknown[][], mapping: Record<string, number | null>, onChange: (mapping: Record<string, number | null>) => void, disabled?: boolean }} props
 */
export function ReviewMappingTable({ headers, rows, mapping, onChange, disabled = false }) {
  const options = [{ value: '', label: '— Eşleme yok —' }, ...headers.map((header, index) => ({ value: String(index), label: header }))];
  return (
    <div className="max-h-[22rem] overflow-auto rounded-card border border-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th scope="col" className={TH}>Alan</th>
            <th scope="col" className={TH}>Dosyadaki sütun</th>
            <th scope="col" className={TH}>Örnek</th>
          </tr>
        </thead>
        <tbody>
          {REVIEW_IMPORT_FIELDS.map((field) => {
            const index = mapping[field.key];
            const samples = sampleValues(rows, index, 2);
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
                    name={`review-map-${field.key}`}
                    aria-label={`${field.label} sütunu`}
                    value={index === null || index === undefined ? '' : String(index)}
                    options={options}
                    disabled={disabled}
                    onChange={(event) => onChange({ ...mapping, [field.key]: event.target.value === '' ? null : Number(event.target.value) })}
                    className="min-w-44"
                  />
                </td>
                <td className="max-w-56 px-3 py-2 text-xs text-ink-muted">
                  <span className="line-clamp-2">{samples.length ? samples.join(' · ') : '—'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** @param {any} preview */
function previewText(preview) {
  if (!preview) return '—';
  return [formatDate(preview.reviewedAt), preview.rating !== null ? `puan ${String(preview.rating).replace('.', ',')}` : null, preview.authorName, preview.text].filter(Boolean).join(' · ');
}

/**
 * Önizleme / yükleme sonucu: sayılar, süzgeç, satır satır durum (dosya satır numarasıyla; başlık 1. satır).
 * @param {{ result: { summary?: { total: number, ok: number, skipped: number, errors: number }, rows: any[] } }} props
 */
export function ReviewResultTable({ result }) {
  const hasErrors = result.rows.some((row) => row.status === 'ERROR');
  const [filter, setFilter] = useState(hasErrors ? 'ERROR' : 'ALL');
  const rows = filter === 'ALL' ? result.rows : result.rows.filter((row) => row.status === filter);
  return (
    <div className="flex flex-col gap-3">
      {result.summary && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="neutral">{result.summary.total} satır</Badge>
          <Badge tone="success">{result.summary.ok} hazır</Badge>
          <Badge tone="warning">{result.summary.skipped} zaten var</Badge>
          <Badge tone={result.summary.errors ? 'danger' : 'neutral'}>{result.summary.errors} hatalı</Badge>
        </div>
      )}
      <ChoiceChips label="Göster" options={FILTERS} value={filter} onChange={(value) => value && setFilter(value)} />
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu süzgeçte satır yok.</p>
      ) : (
        <div className="max-h-[20rem] overflow-auto rounded-card border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th scope="col" className={TH}>Satır</th>
                <th scope="col" className={TH}>Durum</th>
                <th scope="col" className={TH}>Yorum / açıklama</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, MAX_RESULT_ROWS).map((row) => (
                <tr key={row.row} className="border-t border-line align-top">
                  <td className="px-3 py-2 tabular-nums text-ink-muted">{row.row + 1}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS[row.status]?.tone ?? 'neutral'}>{STATUS[row.status]?.label ?? row.status}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {row.status !== 'ERROR' && <span className="line-clamp-2 text-ink-soft">{previewText(row.preview)}</span>}
                    {row.errors?.length > 0 && <span className={`block text-xs ${row.status === 'ERROR' ? 'text-sec-strong' : 'text-ink-muted'}`}>{row.errors.join(' · ')}</span>}
                  </td>
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
