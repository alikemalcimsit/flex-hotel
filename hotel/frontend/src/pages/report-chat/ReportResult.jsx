import { formatCell, isNumericColumn } from '../../lib/reportChat.js';
import { ReportChart } from './ReportChart.jsx';

/** Tablo bu kadar satıra kadar kaydırmasız; üstünde kutu içinde kayar. */
const SCROLL_ROWS = 12;

/**
 * Raporun gövdesi (modül 24): özet kutucukları, grafik, tablo ve notlar. Sohbet cevabı ve kayıtlı raporun
 * çalıştırılması aynı bloğu kullanır. Rakamlar sistemin çalıştırdığı rapordan gelir.
 *
 * @param {{ dataset: any, chart: { type: string, series: string[] } | null }} props
 */
export function ReportResult({ dataset, chart }) {
  const { columns, rows, summary = [], currency, notes = [] } = dataset;
  return (
    <div className="flex flex-col gap-4">
      {summary.length > 0 && (
        <dl className="flex flex-wrap gap-2">
          {summary.map((item) => (
            <div key={item.label} className="rounded-card border border-line bg-surface-muted px-3 py-2">
              <dt className="text-xs text-ink-muted">{item.label}</dt>
              <dd className="text-base font-bold tabular-nums">
                {formatCell(item.value, item.kind)}
                {item.kind === 'money' && currency && item.value !== null ? <span className="ml-1 text-xs font-normal text-ink-muted">{currency}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {chart && chart.type !== 'TABLE' && <ReportChart dataset={dataset} chart={chart} />}

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu dönemde veri yok.</p>
      ) : (
        <div className={`overflow-x-auto rounded-card border border-line ${rows.length > SCROLL_ROWS ? 'max-h-96 overflow-y-auto' : ''}`}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} scope="col" className={`whitespace-nowrap px-3 py-2 font-semibold ${isNumericColumn(column) ? 'text-right' : 'text-left'}`}>
                    {column.label}
                    {column.kind === 'money' && currency ? ` (${currency})` : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-line">
                  {columns.map((column) => (
                    <td key={column.key} className={`whitespace-nowrap px-3 py-2 ${isNumericColumn(column) ? 'text-right tabular-nums' : ''}`}>
                      {formatCell(row[column.key], column.kind)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
