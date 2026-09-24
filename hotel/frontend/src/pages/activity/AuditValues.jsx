import { fieldLabel, formatAuditValue } from '../../lib/activity.js';

/** Oluşturma / silmede gösterilen en fazla alan (kaydın anlık görüntüsü uzun olabilir). */
const MAX_SNAPSHOT_FIELDS = 40;

/**
 * Denetim satırının değerleri: değişiklikte yalnızca değişen alanlar (eski →
 * yeni), oluşturmada kaydın ilk hâli, silmede son hâli.
 *
 * @param {{ row: { action: string, changedFields: string[], before: object | null, after: object | null } }} props
 */
export function AuditValues({ row }) {
  if (row.action === 'UPDATE') {
    if (row.changedFields.length === 0) return <p className="text-xs text-ink-muted">Değişen alan kaydedilmemiş.</p>;
    return (
      <ValueTable
        caption="Değişen alanlar"
        headers={['Alan', 'Eski', 'Yeni']}
        rows={row.changedFields.map((field) => [fieldLabel(field), formatAuditValue(row.before?.[field]), formatAuditValue(row.after?.[field])])}
      />
    );
  }
  const snapshot = row.action === 'DELETE' ? row.before : row.after;
  const entries = Object.entries(snapshot ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (entries.length === 0) return <p className="text-xs text-ink-muted">Kaydın anlık görüntüsü yok.</p>;
  return (
    <ValueTable
      caption={row.action === 'DELETE' ? 'Silinmeden önceki hâli' : 'Oluşturulduğu hâli'}
      headers={['Alan', 'Değer']}
      rows={entries.slice(0, MAX_SNAPSHOT_FIELDS).map(([field, value]) => [fieldLabel(field), formatAuditValue(value)])}
      note={entries.length > MAX_SNAPSHOT_FIELDS ? `${entries.length - MAX_SNAPSHOT_FIELDS} alan daha var.` : null}
    />
  );
}

/** @param {{ caption: string, headers: string[], rows: string[][], note?: string | null }} props */
function ValueTable({ caption, headers, rows, note = null }) {
  return (
    <div className="overflow-x-auto rounded-control border border-line bg-surface">
      <table className="w-full text-sm">
        <caption className="border-b border-line px-4 py-2 text-left text-xs font-bold text-ink">{caption}</caption>
        <thead className="text-left text-[0.7rem] uppercase tracking-[0.06em] text-ink-muted">
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="px-4 py-2 font-bold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells) => (
            <tr key={cells[0]} className="border-t border-line align-top">
              {cells.map((cell, index) => (
                <td key={`${cells[0]}-${headers[index]}`} className={`px-4 py-2 ${index === 0 ? 'font-semibold text-ink' : 'break-all text-ink-soft'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">{note}</p>}
    </div>
  );
}
