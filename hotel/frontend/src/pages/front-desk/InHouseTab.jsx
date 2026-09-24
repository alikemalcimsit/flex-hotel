import { useState } from 'react';
import { IN_HOUSE_SORTS, IN_HOUSE_SORT_LABELS, RESERVATION_COUNT_CAP } from '@hotelos/hotel-contracts';
import { Badge, Button, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { partyLabel } from '../reservations/reservationTheme.js';
import { CheckOutDialog } from './CheckOutDialog.jsx';
import { RevertStayDialog } from './RevertStayDialog.jsx';
import { BalanceCell, GuestCell, IdentityBadge, StayFilters, useFrontDeskSummary } from './StayParts.jsx';
import { useStayList } from './useStayList.js';

const SORT_OPTIONS = IN_HOUSE_SORTS.map((value) => ({ value, label: IN_HOUSE_SORT_LABELS[value] }));

/** @param {string} from "YYYY-MM-DD" @param {string} to */
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Konaklayanlar (modül 6): şu an içeride olan herkes — oda, giriş, kalan
 * gece, refakatçi, plaka, folyo bakiyesi. Buradan da çıkış yapılır; aynı gün
 * yapılan giriş geri alınabilir.
 */
export function InHouseTab() {
  const can = useCan();
  const canManage = can(PERMISSIONS.STAYS_MANAGE);
  const list = useStayList('in-house', { sorts: IN_HOUSE_SORTS, defaultSort: 'CHECK_OUT_ASC' });
  const summary = useFrontDeskSummary().data;
  const [checkOut, setCheckOut] = useState(null);
  const [revert, setRevert] = useState(null);
  const { query } = list;
  const today = query.data?.meta?.businessDate;

  const columns = [
    { key: 'room', header: 'Oda', render: (row) => <span className="text-base font-bold tabular-nums">{row.room?.number ?? '—'}</span> },
    { key: 'guest', header: 'Misafir', render: (row) => <GuestCell row={row} /> },
    {
      key: 'in',
      header: 'Giriş',
      render: (row) => (
        <span className="whitespace-nowrap text-xs">
          {formatDate(row.checkIn)} <span className="text-ink-muted">· {row.checkedInTime}</span>
        </span>
      ),
    },
    {
      key: 'out',
      header: 'Çıkış',
      render: (row) => {
        const left = today ? daysBetween(today, row.checkOut) : null;
        return (
          <span className="flex flex-col whitespace-nowrap">
            <span>{formatDate(row.checkOut)}</span>
            {row.overdue ? (
              <span className="text-xs font-semibold text-sec-strong">Çıkış günü geçti</span>
            ) : row.departsToday ? (
              <span className="text-xs font-semibold text-warning-ink">Bugün çıkıyor</span>
            ) : left !== null ? (
              <span className="text-xs text-ink-muted">{left} gece kaldı</span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'party',
      header: 'Kişi',
      render: (row) => (
        <span className="flex flex-col text-xs">
          <span className="whitespace-nowrap">{partyLabel(row.adults, row.children)}</span>
          <span className="text-ink-muted">{row.companions > 0 ? `${row.companions} refakatçi kayıtlı` : 'Refakatçi kaydı yok'}</span>
        </span>
      ),
    },
    {
      key: 'identity',
      header: 'Kimlik / araç',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <IdentityBadge guest={row.guest} />
          {row.vehiclePlate && <Badge tone="neutral" dot={false}>{row.vehiclePlate}</Badge>}
        </span>
      ),
    },
    { key: 'balance', header: 'Bakiye', render: (row) => <BalanceCell balance={row.balance} currency={row.currency} /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <StayFilters searchText={list.searchText} onSearch={list.setSearchText}>
        <Select label="Sıralama" value={list.filters.sort} onChange={(e) => list.setSort(e.target.value)} options={SORT_OPTIONS} />
        {summary && <span className="pb-2.5 text-sm font-semibold text-ink-soft">İçeride {summary.inHouse} konaklama</span>}
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
        emptyTitle={list.filters.search ? 'Aramaya uyan misafir yok' : 'Şu an içeride misafir yok'}
        rowActions={
          canManage
            ? (row) => (
                <span className="flex justify-end gap-2">
                  {row.canRevertCheckIn && (
                    <Button size="sm" variant="ghost" icon="rotateCcw" onClick={() => setRevert(row)}>
                      Girişi geri al
                    </Button>
                  )}
                  <Button size="sm" variant={row.departsToday || row.overdue ? 'primary' : 'outline'} icon="logout" onClick={() => setCheckOut(row.id)}>
                    Çıkış
                  </Button>
                </span>
              )
            : undefined
        }
      />
      {query.data?.meta?.totalCapped && <p className="text-xs text-ink-muted">{RESERVATION_COUNT_CAP}+ kayıt; aramayla daraltın.</p>}
      {checkOut && <CheckOutDialog reservationId={checkOut} onClose={() => setCheckOut(null)} />}
      {revert && <RevertStayDialog kind="checkIn" stay={revert} onClose={() => setRevert(null)} />}
    </div>
  );
}
