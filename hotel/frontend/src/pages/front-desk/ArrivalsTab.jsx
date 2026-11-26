import { useState } from 'react';
import { ARRIVAL_VIEWS, RESERVATION_COUNT_CAP } from '@hotelos/hotel-contracts';
import { Badge, Button } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { useT } from '../../i18n/index.jsx';
import { READINESS } from '../../lib/front-desk.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { partyLabel } from '../reservations/reservationTheme.js';
import { CheckInDialog } from './CheckInDialog.jsx';
import { RevertStayDialog } from './RevertStayDialog.jsx';
import { GuestCell, IdentityBadge, StayFilters, useFrontDeskSummary } from './StayParts.jsx';
import { useStayList } from './useStayList.js';

/**
 * Gelecekler (modül 6): girişi bugün olan (ve geç kalan) misafirler — oda,
 * odanın hazırlığı, kimlik durumu; "Giriş yap" tek tık. "Bugün girenler"
 * görünümünde aynı gün yapılan giriş geri alınabilir.
 */
export function ArrivalsTab() {
  const can = useCan();
  const t = useT();
  const canManage = can(PERMISSIONS.STAYS_MANAGE);
  const list = useStayList('arrivals', { views: ARRIVAL_VIEWS, defaultView: 'EXPECTED' });
  const summary = useFrontDeskSummary().data;
  const [checkIn, setCheckIn] = useState(null);
  const [revert, setRevert] = useState(null);
  const expected = list.filters.view === 'EXPECTED';
  const { query } = list;
  const viewLabels = Object.fromEntries(ARRIVAL_VIEWS.map((view) => [view, t(`frontDesk.arrivalView.${view}`)]));

  const columns = [
    { key: 'guest', header: t('frontDesk.list.guest'), render: (row) => <GuestCell row={row} /> },
    {
      key: 'room',
      header: t('frontDesk.list.room'),
      render: (row) =>
        row.room ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-base font-bold tabular-nums">{row.room.number}</span>
            {expected && row.roomState && (
              <Badge tone={READINESS[row.roomState.readiness]?.tone}>{t(`frontDesk.readiness.${row.roomState.readiness}`)}</Badge>
            )}
          </span>
        ) : (
          <Badge tone="warning" dot={false}>{t('frontDesk.arrivals.noRoom')}</Badge>
        ),
    },
    {
      key: 'stay',
      header: t('frontDesk.list.stay'),
      render: (row) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>
            {formatDate(row.checkIn)} – {formatDate(row.checkOut)} <span className="text-xs text-ink-muted">{t('frontDesk.list.nights', { count: row.nights })}</span>
          </span>
          {row.lateArrival && <span className="text-xs font-semibold text-warning-ink">{t('frontDesk.arrivals.lateArrival')}</span>}
        </span>
      ),
    },
    {
      key: 'party',
      header: t('frontDesk.list.party'),
      render: (row) => (
        <span className="whitespace-nowrap text-xs">
          {partyLabel(row.adults, row.children)} · {row.roomType.code} · {row.boardType}
        </span>
      ),
    },
    expected
      ? { key: 'identity', header: t('frontDesk.list.identity'), render: (row) => <IdentityBadge guest={row.guest} /> }
      : {
          key: 'at',
          header: t('frontDesk.list.checkIn'),
          render: (row) => (
            <span className="whitespace-nowrap text-xs">
              <span className="font-semibold text-ink">{row.checkedInTime}</span> · {row.checkedInBy}
            </span>
          ),
        },
    { key: 'notes', header: t('frontDesk.list.notes'), render: (row) => <span className="line-clamp-2 max-w-[16rem] text-xs text-ink-soft">{row.notes ?? ''}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <StayFilters
        views={ARRIVAL_VIEWS}
        labels={viewLabels}
        value={list.filters.view}
        onChange={list.setView}
        counts={{ EXPECTED: summary?.arrivals.expected, CHECKED_IN: summary?.arrivals.checkedIn }}
        searchText={list.searchText}
        onSearch={list.setSearchText}
      />
      {expected && summary?.arrivals.unassigned > 0 && (
        <p className="text-sm text-warning-ink">
          {t('frontDesk.arrivals.unassignedNote', { count: summary.arrivals.unassigned })}
        </p>
      )}
      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        onPageChange={list.setPage}
        emptyTitle={list.filters.search ? t('frontDesk.list.noMatch') : expected ? t('frontDesk.arrivals.emptyExpected') : t('frontDesk.arrivals.emptyCheckedIn')}
        emptyHint={list.filters.search ? t('frontDesk.list.noMatchHint') : undefined}
        rowActions={
          canManage
            ? (row) =>
                expected ? (
                  <Button size="sm" icon="key" onClick={() => setCheckIn(row.id)}>
                    {t('frontDesk.arrivals.checkIn')}
                  </Button>
                ) : row.canRevertCheckIn ? (
                  <Button size="sm" variant="ghost" icon="rotateCcw" onClick={() => setRevert(row)}>
                    {t('frontDesk.list.revert')}
                  </Button>
                ) : null
            : undefined
        }
      />
      {query.data?.meta?.totalCapped && (
        <p className="text-xs text-ink-muted">{t('frontDesk.list.capped', { cap: RESERVATION_COUNT_CAP })}</p>
      )}
      {checkIn && <CheckInDialog reservationId={checkIn} onClose={() => setCheckIn(null)} />}
      {revert && <RevertStayDialog kind="checkIn" stay={revert} onClose={() => setRevert(null)} />}
    </div>
  );
}
