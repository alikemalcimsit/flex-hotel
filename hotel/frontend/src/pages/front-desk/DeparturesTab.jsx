import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEPARTURE_VIEWS, MAX_BULK_CHECK_OUTS, RESERVATION_COUNT_CAP } from '@hotelos/hotel-contracts';
import { Badge, Button } from '@hotelos/ui';
import { BulkResultAlert, useRowSelection } from '../../components/BulkSelection.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { useT } from '../../i18n/index.jsx';
import { apiPost } from '../../lib/api.js';
import { frontDeskKeys } from '../../lib/front-desk.js';
import { toastError } from '../../store/toast.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { partyLabel } from '../reservations/reservationTheme.js';
import { CheckOutDialog } from './CheckOutDialog.jsx';
import { RevertStayDialog } from './RevertStayDialog.jsx';
import { BalanceCell, GuestCell, StayFilters, useFrontDeskSummary } from './StayParts.jsx';
import { useStayList } from './useStayList.js';

/**
 * Gidecekler (modül 6): çıkışı bugün olan içerideki misafirler; çıkışı
 * geçmiş olanlar (gecikmiş) üstte. Folyo bakiyesi ve alınan teminat satırda
 * görünür; "Çıkış yap" hesabı kapatır. "Bugün çıkanlar"da aynı gün yapılan
 * çıkış geri alınabilir. Kat hizmetleri bu listeyi temizlik sırası için görür.
 */
export function DeparturesTab() {
  const can = useCan();
  const t = useT();
  const canManage = can(PERMISSIONS.STAYS_MANAGE);
  const list = useStayList('departures', { views: DEPARTURE_VIEWS, defaultView: 'EXPECTED' });
  const summary = useFrontDeskSummary().data;
  const [checkOut, setCheckOut] = useState(null);
  const [revert, setRevert] = useState(null);
  const expected = list.filters.view === 'EXPECTED';
  const { query } = list;
  const viewLabels = Object.fromEntries(DEPARTURE_VIEWS.map((view) => [view, t(`frontDesk.departureView.${view}`)]));
  const queryClient = useQueryClient();
  const selection = useRowSelection();
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const { clear } = selection;
  useEffect(() => clear(), [list.filters.view, list.filters.search, list.filters.page, clear]);
  const rows = query.data?.items ?? [];
  // Toplu çıkışa yalnız bakiyesi kapalı olanlar girer (açık bakiye gerekçe ve ayrı yetki ister: tek tek).
  const bulkEligible = (row) => Number(row.balance ?? 0) === 0;
  const bulkCheckOut = useMutation({
    mutationFn: (items) => apiPost('/front-desk/stays/check-out-batch', { items }),
    onSuccess: (data) => {
      setBulkResult(data);
      setConfirmBulk(false);
      clear();
    },
    onError: (error) => toastError(error.message),
    // Yarıda kesilse de işlenenler kalıcıdır: liste her durumda tazelenir.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: frontDeskKeys.lists });
      queryClient.invalidateQueries({ queryKey: frontDeskKeys.summary });
    },
  });
  const labelOf = (id) => {
    const row = rows.find((item) => item.id === id);
    return row ? `${row.room?.number ?? '—'} · ${row.guest?.name ?? row.confirmationCode}` : id;
  };

  const columns = [
    ...(canManage && expected ? [selection.column(rows, bulkEligible, t('frontDesk.departures.bulkIneligible'))] : []),
    {
      key: 'room',
      header: t('frontDesk.list.room'),
      render: (row) => <span className="text-base font-bold tabular-nums">{row.room?.number ?? '—'}</span>,
    },
    { key: 'guest', header: t('frontDesk.list.guest'), render: (row) => <GuestCell row={row} /> },
    {
      key: 'stay',
      header: t('frontDesk.list.stay'),
      render: (row) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>
            {formatDate(row.checkIn)} – {formatDate(row.checkOut)} <span className="text-xs text-ink-muted">{t('frontDesk.list.nights', { count: row.nights })}</span>
          </span>
          {row.overdue && <span className="text-xs font-semibold text-sec-strong">{t('frontDesk.list.overdue')}</span>}
        </span>
      ),
    },
    { key: 'party', header: t('frontDesk.list.party'), render: (row) => <span className="whitespace-nowrap text-xs">{partyLabel(row.adults, row.children)}</span> },
    expected
      ? {
          key: 'balance',
          header: t('frontDesk.list.balance'),
          render: (row) => <BalanceCell balance={row.balance} currency={row.currency} reservationId={row.id} />,
        }
      : {
          key: 'at',
          header: t('frontDesk.list.checkOut'),
          render: (row) => (
            <span className="flex flex-col whitespace-nowrap text-xs">
              <span>
                <span className="font-semibold text-ink">{row.checkedOutTime}</span> · {row.checkedOutBy}
              </span>
              {row.checkoutOpenBalance && <span className="font-semibold text-sec-strong">{t('frontDesk.departures.withBalance', { amount: formatMoney(row.checkoutOpenBalance, row.currency) })}</span>}
            </span>
          ),
        },
    {
      key: 'deposit',
      header: t('frontDesk.list.deposit'),
      render: (row) =>
        row.depositMethod ? (
          <Badge tone="info" dot={false}>
            {t(`frontDesk.depositMethod.${row.depositMethod}`)} · {formatMoney(row.depositAmount, row.currency)}
          </Badge>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <StayFilters
        views={DEPARTURE_VIEWS}
        labels={viewLabels}
        value={list.filters.view}
        onChange={list.setView}
        counts={{ EXPECTED: summary?.departures.expected, CHECKED_OUT: summary?.departures.checkedOut }}
        searchText={list.searchText}
        onSearch={list.setSearchText}
      />
      {bulkResult && <BulkResultAlert title={t('frontDesk.departures.bulkTitle')} result={bulkResult} labelOf={labelOf} onClose={() => setBulkResult(null)} />}
      {canManage && expected && selection.count > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-ink-muted">{t('frontDesk.departures.selected', { count: selection.count })}</span>
          <Button type="button" icon="logout" disabled={bulkCheckOut.isPending || selection.count > MAX_BULK_CHECK_OUTS} onClick={() => setConfirmBulk(true)}>
            {t('frontDesk.departures.bulkSubmit', { count: selection.count })}
          </Button>
        </div>
      )}
      {canManage && expected && selection.count === 0 && rows.length > 0 && (
        <p className="text-xs text-ink-muted">
          {t('frontDesk.departures.bulkHint', { eligible: rows.filter(bulkEligible).length, total: rows.length })}
        </p>
      )}
      {expected && summary?.departures.overdue > 0 && (
        <p className="text-sm text-sec-strong">
          {t('frontDesk.departures.overdueNote', { count: summary.departures.overdue })}
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
        emptyTitle={list.filters.search ? t('frontDesk.list.noMatch') : expected ? t('frontDesk.departures.emptyExpected') : t('frontDesk.departures.emptyCheckedOut')}
        rowActions={
          canManage
            ? (row) =>
                expected ? (
                  <Button size="sm" icon="logout" onClick={() => setCheckOut(row.id)}>
                    {t('frontDesk.departures.checkOut')}
                  </Button>
                ) : row.canRevertCheckOut ? (
                  <Button size="sm" variant="ghost" icon="rotateCcw" onClick={() => setRevert(row)}>
                    {t('frontDesk.list.revert')}
                  </Button>
                ) : null
            : undefined
        }
      />
      {query.data?.meta?.totalCapped && <p className="text-xs text-ink-muted">{t('frontDesk.list.capped', { cap: RESERVATION_COUNT_CAP })}</p>}
      {checkOut && <CheckOutDialog reservationId={checkOut} onClose={() => setCheckOut(null)} />}
      <ConfirmDialog
        open={confirmBulk}
        title={t('frontDesk.departures.confirmTitle', { count: selection.count })}
        message={t('frontDesk.departures.confirmMessage')}
        confirmLabel={t('frontDesk.departures.confirmLabel')}
        confirmVariant="primary"
        confirmIcon="logout"
        isPending={bulkCheckOut.isPending}
        onConfirm={() => bulkCheckOut.mutate(selection.ids.map((id) => ({ id, expectedUpdatedAt: rows.find((row) => row.id === id)?.updatedAt })).filter((item) => item.expectedUpdatedAt))}
        onClose={() => setConfirmBulk(false)}
      />

      {revert && <RevertStayDialog kind="checkOut" stay={revert} onClose={() => setRevert(null)} />}
    </div>
  );
}
