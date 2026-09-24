import { useState } from 'react';
import { ARRIVAL_VIEWS, ARRIVAL_VIEW_LABELS, RESERVATION_COUNT_CAP } from '@hotelos/hotel-contracts';
import { Badge, Button } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
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
  const canManage = can(PERMISSIONS.STAYS_MANAGE);
  const list = useStayList('arrivals', { views: ARRIVAL_VIEWS, defaultView: 'EXPECTED' });
  const summary = useFrontDeskSummary().data;
  const [checkIn, setCheckIn] = useState(null);
  const [revert, setRevert] = useState(null);
  const expected = list.filters.view === 'EXPECTED';
  const { query } = list;

  const columns = [
    { key: 'guest', header: 'Misafir', render: (row) => <GuestCell row={row} /> },
    {
      key: 'room',
      header: 'Oda',
      render: (row) =>
        row.room ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-base font-bold tabular-nums">{row.room.number}</span>
            {expected && row.roomState && (
              <Badge tone={READINESS[row.roomState.readiness]?.tone}>{READINESS[row.roomState.readiness]?.label}</Badge>
            )}
          </span>
        ) : (
          <Badge tone="warning" dot={false}>Oda verilmedi</Badge>
        ),
    },
    {
      key: 'stay',
      header: 'Konaklama',
      render: (row) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>
            {formatDate(row.checkIn)} – {formatDate(row.checkOut)} <span className="text-xs text-ink-muted">({row.nights} gece)</span>
          </span>
          {row.lateArrival && <span className="text-xs font-semibold text-warning-ink">Geç geliyor</span>}
        </span>
      ),
    },
    {
      key: 'party',
      header: 'Kişi',
      render: (row) => (
        <span className="whitespace-nowrap text-xs">
          {partyLabel(row.adults, row.children)} · {row.roomType.code} · {row.boardType}
        </span>
      ),
    },
    expected
      ? { key: 'identity', header: 'Kimlik', render: (row) => <IdentityBadge guest={row.guest} /> }
      : {
          key: 'at',
          header: 'Giriş',
          render: (row) => (
            <span className="whitespace-nowrap text-xs">
              <span className="font-semibold text-ink">{row.checkedInTime}</span> · {row.checkedInBy}
            </span>
          ),
        },
    { key: 'notes', header: 'Not', render: (row) => <span className="line-clamp-2 max-w-[16rem] text-xs text-ink-soft">{row.notes ?? ''}</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <StayFilters
        views={ARRIVAL_VIEWS}
        labels={ARRIVAL_VIEW_LABELS}
        value={list.filters.view}
        onChange={list.setView}
        counts={{ EXPECTED: summary?.arrivals.expected, CHECKED_IN: summary?.arrivals.checkedIn }}
        searchText={list.searchText}
        onSearch={list.setSearchText}
      />
      {expected && summary?.arrivals.unassigned > 0 && (
        <p className="text-sm text-warning-ink">
          {summary.arrivals.unassigned} gelecek misafirin odası henüz verilmedi; girişte seçilebilir.
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
        emptyTitle={list.filters.search ? 'Aramaya uyan misafir yok' : expected ? 'Bugün girişi beklenen misafir yok' : 'Bugün henüz giriş yapılmadı'}
        emptyHint={list.filters.search ? 'Ad, onay kodu, telefon ya da oda numarasıyla arayın.' : undefined}
        rowActions={
          canManage
            ? (row) =>
                expected ? (
                  <Button size="sm" icon="key" onClick={() => setCheckIn(row.id)}>
                    Giriş yap
                  </Button>
                ) : row.canRevertCheckIn ? (
                  <Button size="sm" variant="ghost" icon="rotateCcw" onClick={() => setRevert(row)}>
                    Geri al
                  </Button>
                ) : null
            : undefined
        }
      />
      {query.data?.meta?.totalCapped && (
        <p className="text-xs text-ink-muted">{RESERVATION_COUNT_CAP}+ kayıt; aramayla daraltın.</p>
      )}
      {checkIn && <CheckInDialog reservationId={checkIn} onClose={() => setCheckIn(null)} />}
      {revert && <RevertStayDialog kind="checkIn" stay={revert} onClose={() => setRevert(null)} />}
    </div>
  );
}
