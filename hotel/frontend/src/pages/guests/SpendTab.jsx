import { Badge } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { formatDate, formatMoney } from '../../lib/format.js';
import { useGuestSpend } from '../../lib/crm.js';

const FOLIO_TONES = { OPEN: 'warning', CLOSED: 'success', TRANSFERRED: 'neutral' };

/** Harcama sekmesi (modül 22): misafirin folyoları (borç / ödeme / bakiye). */
export function SpendTab({ guestId }) {
  const query = useGuestSpend(guestId);
  const folios = query.data ?? [];

  if (query.isPending || query.isError) return <QueryFallback query={query} errorTitle="Harcama geçmişi yüklenemedi" />;

  return (
    <>
      {folios.length === 0 ? (
        <p className="text-sm text-ink-muted">Folyo kaydı yok.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-sm">
            <thead className="bg-canvas text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left">Tarih</th>
                <th className="px-4 py-2 text-left">Durum</th>
                <th className="px-4 py-2 text-right">Borç</th>
                <th className="px-4 py-2 text-right">Ödeme</th>
                <th className="px-4 py-2 text-right">Bakiye</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {folios.map((f) => (
                <tr key={f.id}>
                  <td className="px-4 py-2 text-ink-muted">{formatDate(f.createdAt)}</td>
                  <td className="px-4 py-2"><Badge tone={FOLIO_TONES[f.status] ?? 'neutral'}>{f.status}</Badge></td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(f.chargesTotal)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(f.paymentsTotal)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatMoney(f.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
