import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Input } from '@hotelos/ui';
import { useT } from '../../i18n/index.jsx';
import { api } from '../../lib/api.js';
import { balanceTone, frontDeskKeys } from '../../lib/front-desk.js';
import { folioPath } from '../../lib/folios.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

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
  const t = useT();
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-card bg-surface p-4 shadow-card sm:p-5">
      {views && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('frontDesk.filters.view')}>
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
        label={t('frontDesk.filters.search')}
        type="search"
        placeholder={t('frontDesk.filters.searchPlaceholder')}
        value={searchText}
        onChange={(event) => onSearch(event.target.value)}
      />
      {children}
    </div>
  );
}

/** Misafir hücresi: ad, onay kodu (detay bağlantısı), grup. */
export function GuestCell({ row }) {
  const t = useT();
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-semibold text-ink">{row.guest.name}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        <Link to={`/rezervasyonlar/${row.id}`} className="font-mono font-bold text-info-ink underline-offset-2 hover:underline">
          {row.confirmationCode}
        </Link>
        {row.group && <span>{t('frontDesk.stay.group', { name: row.group.name })}</span>}
      </span>
    </span>
  );
}

/** Kimlik rozeti: belge girilmiş mi (maskeli numara başlıkta). */
export function IdentityBadge({ guest }) {
  const t = useT();
  return guest.hasIdentity ? (
    <Badge tone="success" dot={false}>
      <span title={guest.idMasked ?? ''}>{t('frontDesk.stay.hasIdentity')}</span>
    </Badge>
  ) : (
    <Badge tone="warning" dot={false}>{t('frontDesk.stay.noIdentity')}</Badge>
  );
}

/**
 * Folyo bakiyesi: borç / iade / kapalı; folyo yoksa "Folyo yok". Folyo
 * görüntüleme yetkisi varsa konaklamanın folyo ekranına götürür.
 * @param {{ balance: string | null | undefined, currency: string, reservationId?: string }} props
 */
export function BalanceCell({ balance, currency, reservationId }) {
  const can = useCan();
  const t = useT();
  const content =
    balance === null || balance === undefined ? (
      <span className="text-xs text-ink-muted">{t('frontDesk.stay.noFolio')}</span>
    ) : (
      <Badge tone={balanceTone(balance)}>
        {Number(balance) > 0 ? formatMoney(balance, currency) : Number(balance) < 0 ? t('frontDesk.stay.refund', { amount: formatMoney(balance.replace('-', ''), currency) }) : t('frontDesk.stay.closed')}
      </Badge>
    );
  if (!reservationId || !can(PERMISSIONS.FOLIO_VIEW)) return content;
  return (
    <Link to={folioPath(reservationId)} className="inline-flex rounded-full focus-visible:outline-2" title={t('frontDesk.stay.openFolio')}>
      {content}
    </Link>
  );
}
