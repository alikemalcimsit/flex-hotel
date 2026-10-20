import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { POS_SHIFT_STATUSES, POS_SHIFT_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { SHIFT_STATUS_TONES, dateTimeText, posKeys, shiftPath, useCurrentShift } from '../../lib/pos.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';

const PAGE_SIZE = 25;
const OFFLINE_REFRESH_MS = 30_000;
const STATUS_OPTIONS = Object.freeze([{ value: '', label: 'Hepsi' }, ...POS_SHIFT_STATUSES.map((value) => ({ value, label: POS_SHIFT_STATUS_LABELS[value] }))]);

/**
 * Garson vardiyaları (modül 39): en yeni açılan önce, sayfalı. Garson yalnızca kendi
 * vardiyalarını görür; şef garson / raporcu hepsini (garsona göre süzer). Satırda nakit /
 * kart neti, kapanan adisyon, satış ve kasa farkı.
 */
export function ShiftsPage() {
  const can = useCan();
  const seeAll = can(PERMISSIONS.POS_SUPERVISE) || can(PERMISSIONS.POS_REPORT);
  const { isLive = true } = useOutletContext() ?? {};
  const current = useCurrentShift({ enabled: can(PERMISSIONS.POS_OPERATE) });
  const [filters, setFilters] = useState({ status: '', waiterEmail: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const rangeError = filters.from && filters.to && filters.to < filters.from ? 'Bitiş başlangıçtan önce olamaz' : null;
  const params = { ...filters, page };
  const list = useQuery({
    queryKey: posKeys.shifts(params),
    queryFn: () =>
      api(
        withQuery('/pos/shifts', {
          status: filters.status || undefined,
          waiterEmail: filters.waiterEmail.trim() || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
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
    setFilters((value) => ({ ...value, [key]: event.target.value }));
    setPage(1);
  };

  const columns = [
    {
      key: 'waiter',
      header: 'Garson',
      render: (row) => (
        <Link to={shiftPath(row.id)} className="block">
          <span className="block font-semibold text-ink hover:underline">{row.waiterEmail}</span>
          <span className="block text-xs text-ink-muted">iş günü {row.businessDate}{row.outletName ? ` · ${row.outletName}` : ''}</span>
        </Link>
      ),
    },
    {
      key: 'time',
      header: 'Açılış / kapanış',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block">{dateTimeText(row.openedAt)}</span>
          <span className="block text-ink-muted">{row.closedAt ? dateTimeText(row.closedAt) : 'açık'}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={SHIFT_STATUS_TONES[row.status]}>{POS_SHIFT_STATUS_LABELS[row.status]}</Badge> },
    {
      key: 'checks',
      header: 'Adisyon',
      className: 'text-right tabular-nums',
      render: (row) => (
        <span className="block text-xs">
          <span className="block font-semibold text-ink">{row.closedChecks}</span>
          {row.openChecks > 0 && <span className="block text-warning-ink">{row.openChecks} açık</span>}
        </span>
      ),
    },
    {
      key: 'money',
      header: 'Satış · nakit · kart',
      className: 'whitespace-nowrap text-right tabular-nums',
      render: (row) => (
        <span className="block text-xs">
          <span className="block text-sm font-bold text-ink">{formatMoney(row.sales, currency)}</span>
          <span className="block text-ink-muted">
            {formatMoney(row.cashNet)} · {formatMoney(row.cardNet)}
          </span>
        </span>
      ),
    },
    {
      key: 'variance',
      header: 'Kasa farkı',
      className: 'whitespace-nowrap text-right tabular-nums',
      render: (row) =>
        row.variance === null ? (
          <span className="text-ink-muted">—</span>
        ) : (
          <span className={`font-bold ${Number(row.variance) < 0 ? 'text-sec-strong' : Number(row.variance) > 0 ? 'text-warning-ink' : 'text-success-ink'}`}>{formatMoney(row.variance, currency)}</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {current.data?.shift && (
        <p className="text-sm">
          Açık vardiyanız var:{' '}
          <Link to={shiftPath(current.data.shift.id)} className="font-semibold text-info-ink underline-offset-2 hover:underline">
            kasayı say ve kapat
          </Link>
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Select label="Durum" value={filters.status} onChange={set('status')} options={STATUS_OPTIONS} />
        {seeAll && <Input label="Garson (e-posta)" name="pos-shifts-waiter" value={filters.waiterEmail} onChange={set('waiterEmail')} />}
        <Input label="İş günü (başlangıç)" name="pos-shifts-from" type="date" value={filters.from} onChange={set('from')} />
        <Input label="İş günü (bitiş)" name="pos-shifts-to" type="date" value={filters.to} onChange={set('to')} error={rangeError ?? undefined} />
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
        emptyTitle="Vardiya yok"
        emptyHint={seeAll ? 'Süzgeci değiştirin ya da garsonların vardiya açmasını bekleyin.' : 'Masa planındaki “Vardiya aç” ile ilk vardiyanızı açın.'}
      />
    </div>
  );
}
