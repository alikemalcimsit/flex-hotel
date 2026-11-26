import { useState } from 'react';
import { IN_HOUSE_SORTS, RESERVATION_COUNT_CAP } from '@hotelos/hotel-contracts';
import { Badge, Button, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { useT } from '../../i18n/index.jsx';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { partyLabel } from '../reservations/reservationTheme.js';
import { CheckOutDialog } from './CheckOutDialog.jsx';
import { RevertStayDialog } from './RevertStayDialog.jsx';
import { BalanceCell, GuestCell, IdentityBadge, StayFilters, useFrontDeskSummary } from './StayParts.jsx';
import { useStayList } from './useStayList.js';

/** @param {string} from "YYYY-MM-DD" @param {string} to */
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Konaklayanlar (modül 6): şu an içeride olan herkes — oda, giriş, kalan
 * gece, refakatçi, plaka, folyo bakiyesi. Buradan da çıkış yapılır; aynı gün
 * yapılan giriş geri alınabilir.
 */
export function InHouseTab() {
  const can = useCan();
  const t = useT();
  const sortOptions = IN_HOUSE_SORTS.map((value) => ({ value, label: t(`frontDesk.inHouseSort.${value}`) }));
  const canManage = can(PERMISSIONS.STAYS_MANAGE);
  const list = useStayList('in-house', { sorts: IN_HOUSE_SORTS, defaultSort: 'CHECK_OUT_ASC' });
  const summary = useFrontDeskSummary().data;
  const [checkOut, setCheckOut] = useState(null);
  const [revert, setRevert] = useState(null);
  const { query } = list;
  const today = query.data?.meta?.businessDate;

  const columns = [
    { key: 'room', header: t('frontDesk.list.room'), render: (row) => <span className="text-base font-bold tabular-nums">{row.room?.number ?? '—'}</span> },
    { key: 'guest', header: t('frontDesk.list.guest'), render: (row) => <GuestCell row={row} /> },
    {
      key: 'in',
      header: t('frontDesk.list.checkIn'),
      render: (row) => (
        <span className="whitespace-nowrap text-xs">
          {formatDate(row.checkIn)} <span className="text-ink-muted">· {row.checkedInTime}</span>
        </span>
      ),
    },
    {
      key: 'out',
      header: t('frontDesk.list.checkOut'),
      render: (row) => {
        const left = today ? daysBetween(today, row.checkOut) : null;
        return (
          <span className="flex flex-col whitespace-nowrap">
            <span>{formatDate(row.checkOut)}</span>
            {row.overdue ? (
              <span className="text-xs font-semibold text-sec-strong">{t('frontDesk.list.overdue')}</span>
            ) : row.departsToday ? (
              <span className="text-xs font-semibold text-warning-ink">{t('frontDesk.inHouse.departsToday')}</span>
            ) : left !== null ? (
              <span className="text-xs text-ink-muted">{t('frontDesk.inHouse.nightsLeft', { count: left })}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'party',
      header: t('frontDesk.list.party'),
      render: (row) => (
        <span className="flex flex-col text-xs">
          <span className="whitespace-nowrap">{partyLabel(row.adults, row.children)}</span>
          <span className="text-ink-muted">{row.companions > 0 ? t('frontDesk.inHouse.companions', { count: row.companions }) : t('frontDesk.inHouse.noCompanions')}</span>
        </span>
      ),
    },
    {
      key: 'identity',
      header: t('frontDesk.inHouse.identityVehicle'),
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <IdentityBadge guest={row.guest} />
          {row.vehiclePlate && <Badge tone="neutral" dot={false}>{row.vehiclePlate}</Badge>}
        </span>
      ),
    },
    { key: 'balance', header: t('frontDesk.list.balance'), render: (row) => <BalanceCell balance={row.balance} currency={row.currency} reservationId={row.id} /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <StayFilters searchText={list.searchText} onSearch={list.setSearchText}>
        <Select label={t('frontDesk.inHouse.sort')} value={list.filters.sort} onChange={(e) => list.setSort(e.target.value)} options={sortOptions} />
        {summary && <span className="pb-2.5 text-sm font-semibold text-ink-soft">{t('frontDesk.inHouse.count', { count: summary.inHouse })}</span>}
      </StayFilters>
      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        onPageChange={list.setPage}
        emptyTitle={list.filters.search ? t('frontDesk.list.noMatch') : t('frontDesk.inHouse.empty')}
        rowActions={
          canManage
            ? (row) => (
                <span className="flex justify-end gap-2">
                  {row.canRevertCheckIn && (
                    <Button size="sm" variant="ghost" icon="rotateCcw" onClick={() => setRevert(row)}>
                      {t('frontDesk.inHouse.revertCheckIn')}
                    </Button>
                  )}
                  <Button size="sm" variant={row.departsToday || row.overdue ? 'primary' : 'outline'} icon="logout" onClick={() => setCheckOut(row.id)}>
                    {t('frontDesk.inHouse.checkOut')}
                  </Button>
                </span>
              )
            : undefined
        }
      />
      {query.data?.meta?.totalCapped && <p className="text-xs text-ink-muted">{t('frontDesk.list.capped', { cap: RESERVATION_COUNT_CAP })}</p>}
      {checkOut && <CheckOutDialog reservationId={checkOut} onClose={() => setCheckOut(null)} />}
      {revert && <RevertStayDialog kind="checkIn" stay={revert} onClose={() => setRevert(null)} />}
    </div>
  );
}
