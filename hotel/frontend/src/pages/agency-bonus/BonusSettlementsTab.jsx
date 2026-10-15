import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AGENCY_BONUS_METRIC_LABELS, AGENCY_BONUS_STATUSES, AGENCY_BONUS_STATUS_LABELS, formatBonusPeriod } from '@hotelos/hotel-contracts';
import { Badge, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { SETTLEMENT_STATUS_TONES, agencyBonusKeys, formatQuantity, formatScore } from '../../lib/agencyBonus.js';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
const OFFLINE_REFRESH_MS = 60_000;

/**
 * Hak ediş raporu (modül 35): dönem sonu hak edişleri — acente, dönem, gerçekleşen
 * / hedef, kademe, prim, durum (hesaplandı → onay bekliyor → onaylandı → ödendi).
 * Durum kutuları adet ve tutarla süzgeç düğmesidir (diğer süzgeçlerle birlikte
 * sayılır); dönem sonuna göre tarih aralığı ve acente / kural araması.
 *
 * @param {{ agencyId?: string, embedded?: boolean }} [props] acente kartında yalnızca o acentenin hak edişleri
 */
export function BonusSettlementsTab({ agencyId, embedded = false } = {}) {
  const outlet = useOutletContext() ?? {};
  const isLive = outlet.isLive ?? true;
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const rangeError = from && to && to < from ? 'Bitiş başlangıçtan önce olamaz' : null;
  const filters = { search, status, from, to, page, agencyId: agencyId ?? null };
  const list = useQuery({
    queryKey: agencyBonusKeys.settlements(filters),
    queryFn: () =>
      api(
        withQuery('/agency-bonus/settlements', {
          search: search || undefined,
          status: status || undefined,
          from: from || undefined,
          to: to || undefined,
          agencyId: agencyId || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
      ),
    enabled: !rangeError,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
  const currency = list.data?.meta?.currency ?? '';
  const totals = new Map((list.data?.totals ?? []).map((row) => [row.status, row]));

  const columns = [
    {
      key: 'agency',
      header: embedded ? 'Kural' : 'Acente / kural',
      render: (row) => (
        <Link to={`/acente-primleri/hak-edis/${row.id}`} className="block min-w-0">
          {!embedded && <span className="block truncate font-semibold text-ink hover:underline">{row.agency.name}</span>}
          <span className={`block truncate ${embedded ? 'font-semibold text-ink hover:underline' : 'text-xs text-ink-muted'}`}>{row.rule.name}</span>
          <span className="block text-xs text-ink-muted">{formatBonusPeriod(row.periodStart, row.periodEnd)}</span>
        </Link>
      ),
    },
    {
      key: 'production',
      header: 'Gerçekleşen / hedef',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block font-semibold text-ink">
            {formatQuantity(row.metric, row.achieved, currency)} / {formatQuantity(row.metric, row.target, currency)}
          </span>
          <span className="block text-ink-muted">
            {AGENCY_BONUS_METRIC_LABELS[row.metric]} · {formatScore(row.scorePct)}
          </span>
        </span>
      ),
    },
    {
      key: 'tier',
      header: 'Kademe',
      render: (row) => (row.tierIndex ? <Badge tone="success">{row.tierIndex}. kademe</Badge> : <span className="text-xs text-ink-muted">Ulaşılmadı</span>),
    },
    {
      key: 'amount',
      header: 'Prim',
      className: 'whitespace-nowrap text-right tabular-nums',
      render: (row) => (
        <span className="block">
          <span className="block font-bold text-ink">{formatMoney(row.amount, currency)}</span>
          {row.capped && <span className="block text-xs text-warning-ink">Tavana takıldı</span>}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={SETTLEMENT_STATUS_TONES[row.status]}>{AGENCY_BONUS_STATUS_LABELS[row.status]}</Badge>
          {row.revision > 1 && <span className="text-xs text-ink-muted">{row.revision}. sürüm</span>}
          {row.status === 'PAID' && <span className="text-xs text-ink-muted">{formatDate(row.paidAt)} · {row.paymentRef}</span>}
        </span>
      ),
    },
  ];

  const filtered = Boolean(search || status || from || to);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Duruma göre">
        {AGENCY_BONUS_STATUSES.map((value) => {
          const row = totals.get(value);
          const selected = status === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setStatus(selected ? '' : value);
                setPage(1);
              }}
              className={`rounded-card border bg-surface p-3 text-left shadow-soft transition-colors ${selected ? 'border-ink' : 'border-transparent hover:border-line-strong'}`}
            >
              <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{AGENCY_BONUS_STATUS_LABELS[value]}</span>
              <span className="mt-1 block text-xl font-bold tabular-nums text-ink">{row?.count ?? 0}</span>
              <span className="block text-xs text-ink-muted tabular-nums">{formatMoney(row?.amount ?? '0', currency)}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {!embedded && (
          <Input label="Ara" name="bonus-settlement-search" placeholder="Acente adı / kodu ya da kural adı" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:max-w-sm" />
        )}
        <Input label="Dönem sonu (başlangıç)" name="bonus-settlement-from" type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className="w-full sm:w-48" />
        <Input
          label="Dönem sonu (bitiş)"
          name="bonus-settlement-to"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => { setTo(event.target.value); setPage(1); }}
          error={rangeError ?? undefined}
          className="w-full sm:w-48"
        />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending && !rangeError}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Süzgece uyan hak ediş yok' : 'Henüz hak ediş yok'}
        emptyHint={filtered ? 'Süzgeçleri değiştirin.' : 'Yürürlükteki kuralın dönemi bitince hak ediş kendiliğinden hesaplanır.'}
      />
    </div>
  );
}
