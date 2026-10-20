import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { POS_CHECK_STATUSES, POS_CHECK_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { CHECK_STATUS_TONES, checkPath, dateTimeText, posKeys, useDebounced, usePosOutlets } from '../../lib/pos.js';

const PAGE_SIZE = 25;
const OFFLINE_REFRESH_MS = 30_000;
const STATUS_OPTIONS = Object.freeze([{ value: '', label: 'Bütün durumlar' }, ...POS_CHECK_STATUSES.map((value) => ({ value, label: POS_CHECK_STATUS_LABELS[value] }))]);

/**
 * Adisyonlar (modül 39): en yeni açılan önce, sayfalı ve canlı. Durum, satış noktası, garson
 * ve kapanış iş günü aralığıyla süzülür; numara ("123") ya da masa adıyla aranır. Kapanmış
 * adisyonu bulup yeniden yazdırmak, ödemesini görmek için.
 */
export function ChecksPage() {
  const { isLive = true } = useOutletContext() ?? {};
  const outlets = usePosOutlets();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [filters, setFilters] = useState({ status: '', outletId: '', waiterEmail: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const rangeError = filters.from && filters.to && filters.to < filters.from ? 'Bitiş başlangıçtan önce olamaz' : null;
  const params = { ...filters, search, page };
  const list = useQuery({
    queryKey: posKeys.checks(params),
    queryFn: () =>
      api(
        withQuery('/pos/checks', {
          status: filters.status || undefined,
          outletId: filters.outletId || undefined,
          waiterEmail: filters.waiterEmail.trim() || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          search: search || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
      ),
    enabled: !rangeError,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
  const currency = list.data?.meta?.currency ?? '';
  const set = (key) => (event) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
    setPage(1);
  };
  const filtered = Boolean(search || Object.values(filters).some(Boolean));

  const columns = [
    {
      key: 'number',
      header: 'Adisyon',
      render: (row) => (
        <Link to={checkPath(row.id)} className="block">
          <span className="block font-mono font-semibold text-ink hover:underline">{row.number}</span>
          <span className="block text-xs text-ink-muted">
            {row.outletName} · {row.tableName ? `masa ${row.tableName}` : 'masasız'} · {row.covers} kişi
          </span>
        </Link>
      ),
    },
    { key: 'waiter', header: 'Garson', render: (row) => <span className="text-xs">{row.waiterEmail}</span> },
    {
      key: 'time',
      header: 'Açılış / kapanış',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block">{dateTimeText(row.openedAt)}</span>
          <span className="block text-ink-muted">{row.closedAt ? dateTimeText(row.closedAt) : '—'}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={CHECK_STATUS_TONES[row.status]}>{POS_CHECK_STATUS_LABELS[row.status]}</Badge> },
    {
      key: 'total',
      header: 'Tutar',
      className: 'whitespace-nowrap text-right tabular-nums',
      render: (row) => (
        <span className="block text-xs">
          <span className="block text-sm font-bold text-ink">{formatMoney(row.grandTotal, currency)}</span>
          {Number(row.balance) > 0 && row.status === 'OPEN' && <span className="block text-warning-ink">kalan {formatMoney(row.balance, currency)}</span>}
          {Number(row.roomChargeTotal) > 0 && <span className="block text-ink-muted">odaya {formatMoney(row.roomChargeTotal, currency)}</span>}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Input label="Ara" name="pos-checks-search" value={searchText} onChange={(event) => { setSearchText(event.target.value); setPage(1); }} placeholder="Adisyon no ya da masa" />
        <Select label="Durum" value={filters.status} onChange={set('status')} options={STATUS_OPTIONS} />
        <Select
          label="Satış noktası"
          value={filters.outletId}
          onChange={set('outletId')}
          options={[{ value: '', label: 'Hepsi' }, ...(outlets.data?.items ?? []).map((outlet) => ({ value: outlet.id, label: outlet.name }))]}
        />
        <Input label="Garson (e-posta)" name="pos-checks-waiter" value={filters.waiterEmail} onChange={set('waiterEmail')} />
        <Input label="Kapanış günü (başlangıç)" name="pos-checks-from" type="date" value={filters.from} onChange={set('from')} />
        <Input label="Kapanış günü (bitiş)" name="pos-checks-to" type="date" value={filters.to} onChange={set('to')} error={rangeError ?? undefined} />
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
        emptyTitle={filtered ? 'Süzgece uyan adisyon yok' : 'Henüz adisyon yok'}
        emptyHint={filtered ? 'Aramayı ya da süzgeçleri değiştirin. Gün aralığı yalnızca kapanmış adisyonları getirir.' : 'Masa planından adisyon açılınca burada görünür.'}
      />
    </div>
  );
}
