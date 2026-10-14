import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PROMOTION_STATUSES, PROMOTION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { describeRule } from '../../lib/promotionForm.js';
import { AVAILABILITY_LABELS, AVAILABILITY_TONES, PROMOTION_STATUS_TONES, promotionKeys, usePromotionLive } from '../../lib/promotions.js';
import { usePromotionContext } from './usePromotionContext.js';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const OFFLINE_REFRESH_MS = 60_000;
/** Listede gösterilen koşul sayısı (fazlası kartta). */
const LIST_CONDITIONS = 3;

const STATUS_FILTERS = Object.freeze([{ value: '', label: 'Tümü' }, ...PROMOTION_STATUSES.map((value) => ({ value, label: PROMOTION_STATUS_LABELS[value] }))]);
const KIND_FILTERS = Object.freeze([
  { value: '', label: 'Hepsi' },
  { value: 'AUTO', label: 'Kendiliğinden' },
  { value: 'COUPON', label: 'Kuponla' },
]);

/** @param {{ label: string, options: ReadonlyArray<{ value: string, label: string }>, value: string, onChange: (value: string) => void }} props */
function FilterChips({ label, options, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value || 'all'}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-full border px-3 py-1 text-sm font-semibold ${value === option.value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Promosyon listesi (modül 31): ada göre arama, durum ve uygulama şekli
 * süzgeci, sayfalı ve canlı. Satırda indirim, kuralın ilk koşulları, geçerli
 * kullanım (iptal sayılmaz) ve satış durumu (yayında ama dönemi başlamamış /
 * bitmiş) görünür.
 */
export function PromotionListTab() {
  const can = useCan();
  const context = usePromotionContext();
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { isLive } = usePromotionLive({ withUsage: true });
  const filters = { search, status, kind, page };
  const list = useQuery({
    queryKey: promotionKeys.list(filters),
    queryFn: () => api(withQuery('/promotions', { search: search || undefined, status: status || undefined, kind: kind || undefined, page, pageSize: PAGE_SIZE })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });

  const columns = [
    {
      key: 'name',
      header: 'Promosyon',
      render: (row) => (
        <Link to={`/promosyonlar/${row.id}`} className="block min-w-0">
          <span className="block truncate font-semibold text-ink hover:underline">{row.name}</span>
          <span className="block text-xs font-semibold text-success-ink">{describeRule(row, context).headline}</span>
        </Link>
      ),
    },
    {
      key: 'rule',
      header: 'Koşullar',
      render: (row) => {
        const { conditions } = describeRule(row, context);
        return (
          <ul className="flex flex-col text-xs text-ink-soft">
            {conditions.slice(1, LIST_CONDITIONS + 1).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {conditions.length > LIST_CONDITIONS + 1 && <li className="text-ink-muted">+{conditions.length - LIST_CONDITIONS - 1} koşul daha</li>}
          </ul>
        );
      },
    },
    {
      key: 'kind',
      header: 'Uygulama',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block font-semibold text-ink">{row.requiresCoupon ? 'Kuponla' : 'Kendiliğinden'}</span>
          {row.requiresCoupon && <span className="block text-ink-muted">{row.couponCount} kupon</span>}
        </span>
      ),
    },
    {
      key: 'usage',
      header: 'Kullanım',
      className: 'whitespace-nowrap text-right tabular-nums',
      render: (row) =>
        row.usage.reservations === 0 ? (
          <span className="text-xs text-ink-muted">Henüz kullanılmadı</span>
        ) : (
          <span className="block text-xs">
            <span className="block font-semibold text-ink">{row.usage.reservations} rezervasyon</span>
            <span className="block text-ink-muted">−{formatMoney(row.usage.discountTotal, context.currency)}</span>
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={PROMOTION_STATUS_TONES[row.status]}>{PROMOTION_STATUS_LABELS[row.status]}</Badge>
          {row.availability && row.availability !== 'LIVE' && <Badge tone={AVAILABILITY_TONES[row.availability]}>{AVAILABILITY_LABELS[row.availability]}</Badge>}
        </span>
      ),
    },
  ];

  const filtered = Boolean(search || status || kind);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterChips label="Durum" options={STATUS_FILTERS} value={status} onChange={(value) => { setStatus(value); setPage(1); }} />
          <FilterChips label="Uygulama" options={KIND_FILTERS} value={kind} onChange={(value) => { setKind(value); setPage(1); }} />
          <Badge tone={isLive ? 'success' : 'warning'} className="ml-auto">
            {isLive ? 'Canlı' : 'Canlı değil'}
          </Badge>
        </div>
        <Input label="Ara" name="promotion-search" placeholder="Promosyon adı" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="sm:max-w-md" />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Süzgece uyan promosyon yok' : 'Henüz promosyon yok'}
        emptyHint={
          filtered
            ? 'Aramayı ya da süzgeçleri değiştirin.'
            : can(PERMISSIONS.PROMOTIONS_MANAGE)
              ? '"Yeni promosyon" ile erken rezervasyon, uzun konaklama ya da kupon kampanyası tanımlayın.'
              : undefined
        }
      />
    </div>
  );
}
