import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Input } from '@hotelos/ui';
import { api } from '../../lib/api.js';
import { balanceTone, frontDeskKeys } from '../../lib/front-desk.js';
import { formatMoney } from '../../lib/format.js';

/** Günün özeti (sekme rozetleri, sayılar). Canlı kanal tazeler. */
export function useFrontDeskSummary() {
  return useQuery({ queryKey: frontDeskKeys.summary, queryFn: () => api('/front-desk/summary') });
}

/**
 * Görünüm çipleri + arama. `counts[view]` verilirse çipte sayı gösterilir.
 * @param {{ views?: readonly string[], labels?: Record<string, string>, value?: string, onChange?: (view: string) => void,
 *           counts?: Record<string, number | undefined>, searchText: string, onSearch: (text: string) => void, children?: React.ReactNode }} props
 */
export function StayFilters({ views, labels, value, onChange, counts = {}, searchText, onSearch, children }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-card bg-surface p-4 shadow-card sm:p-5">
      {views && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Görünüm">
          {views.map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={value === view}
              onClick={() => onChange(view)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                value === view ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'
              }`}
            >
              {labels[view]}
              {counts[view] !== undefined && <span className="ml-1.5 tabular-nums opacity-80">{counts[view]}</span>}
            </button>
          ))}
        </div>
      )}
      <Input
        className="min-w-[14rem] flex-1"
        label="Ara"
        type="search"
        placeholder="Ad, onay kodu, telefon, oda no"
        value={searchText}
        onChange={(event) => onSearch(event.target.value)}
      />
      {children}
    </div>
  );
}

/** Misafir hücresi: ad, onay kodu (detay bağlantısı), grup. */
export function GuestCell({ row }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-semibold text-ink">{row.guest.name}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        <Link to={`/rezervasyonlar/${row.id}`} className="font-mono font-bold text-info-ink underline-offset-2 hover:underline">
          {row.confirmationCode}
        </Link>
        {row.group && <span>· Grup: {row.group.name}</span>}
      </span>
    </span>
  );
}

/** Kimlik rozeti: belge girilmiş mi (maskeli numara başlıkta). */
export function IdentityBadge({ guest }) {
  return guest.hasIdentity ? (
    <Badge tone="success" dot={false}>
      <span title={guest.idMasked ?? ''}>Kimlik var</span>
    </Badge>
  ) : (
    <Badge tone="warning" dot={false}>Kimlik yok</Badge>
  );
}

/** Folyo bakiyesi: borç / iade / kapalı; folyo yoksa bilinmiyor. */
export function BalanceCell({ balance, currency }) {
  if (balance === null || balance === undefined) return <span className="text-xs text-ink-muted">Folyo yok</span>;
  const value = Number(balance);
  const tone = balanceTone(balance);
  const label = value > 0 ? formatMoney(balance, currency) : value < 0 ? `İade ${formatMoney(balance.replace('-', ''), currency)}` : 'Kapalı';
  return <Badge tone={tone}>{label}</Badge>;
}
