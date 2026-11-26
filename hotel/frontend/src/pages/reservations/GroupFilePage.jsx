import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_BULK_CHECK_INS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Icon, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { useI18n, useT } from '../../i18n/index.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { RESERVATION_STATUS_TONES, reservationKeys } from '../../lib/reservations.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastSuccess } from '../../store/toast.js';
import { boardShort, statusLabel } from './reservationTheme.js';

/**
 * Grup dosyası (modül 30): grubun rezervasyonları, folyo bakiyeleri ve toplu
 * işlemler. Toplu işlemler tek tek işlemin aynı servisinden geçer; başarısız
 * kayıtlar sebebiyle listelenir (ör. odası atanmamış giriş, bakiyesi açık çıkış).
 */

/** Toplu işlem → hangi durumdaki rezervasyonlar seçilebilir. */
const BATCH_ELIGIBLE = Object.freeze({
  assign: (row) => (row.status === 'PENDING' || row.status === 'CONFIRMED') && !row.room,
  checkIn: (row) => (row.status === 'PENDING' || row.status === 'CONFIRMED') && Boolean(row.room),
  checkOut: (row) => row.status === 'CHECKED_IN',
});

export function GroupFilePage() {
  const t = useT();
  const { locale } = useI18n();
  const { groupId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useCan();
  const canManage = can(PERMISSIONS.RESERVATIONS_MANAGE);
  const canStays = can(PERMISSIONS.STAYS_MANAGE);
  const [selected, setSelected] = useState(() => new Set());
  const [batchResult, setBatchResult] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const query = useQuery({ queryKey: reservationKeys.group(groupId), queryFn: () => api(`/reservations/groups/${groupId}`) });

  const refresh = () => {
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: reservationKeys.groups });
    queryClient.invalidateQueries({ queryKey: reservationKeys.lists });
  };

  const batchMutation = useMutation({
    mutationFn: ({ path, body }) => apiPost(path, body),
    onSuccess: (result, { label }) => {
      setBatchResult({ label, result });
      refresh();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (body) => apiPost(`/reservations/groups/${groupId}/cancel`, body),
    onSuccess: (result) => {
      setCancelling(false);
      toastSuccess(t('reservations.groupFile.cancelled', { count: result.cancelled ?? '' }).trim());
      refresh();
    },
  });

  const fallback = <QueryFallback query={query} errorTitle={t('reservations.groupFile.loadFailed')} />;
  if (query.isPending || query.isError) return <div className="flex flex-col gap-6"><BackLink />{fallback}</div>;

  const group = query.data;
  const rows = group.reservations;
  const selectedRows = rows.filter((row) => selected.has(row.id));

  const toggle = (id) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBatch = (kind) => {
    const eligible = selectedRows.filter(BATCH_ELIGIBLE[kind]);
    if (eligible.length === 0) return;
    const items = eligible.map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt }));
    const call = {
      assign: { label: t('reservations.groupFile.batchAssign'), path: '/rooms/assignments/auto-batch', body: { reservationIds: eligible.map((row) => row.id) } },
      checkIn: { label: t('reservations.groupFile.batchCheckIn'), path: '/front-desk/stays/check-in-batch', body: { items } },
      checkOut: { label: t('reservations.groupFile.batchCheckOut'), path: '/front-desk/stays/check-out-batch', body: { items } },
    }[kind];
    setBatchResult(null);
    batchMutation.mutate(call);
  };

  const count = (kind) => selectedRows.filter(BATCH_ELIGIBLE[kind]).length;
  const openRooms = rows.filter((row) => row.status === 'PENDING' || row.status === 'CONFIRMED').length;
  const busy = batchMutation.isPending;

  const columns = [
    ...(canManage || canStays
      ? [
          {
            key: 'select',
            header: '',
            render: (row) => (
              <Checkbox label="" aria-label={t('reservations.groupFile.selectRow', { code: row.confirmationCode })} checked={selected.has(row.id)} onChange={() => toggle(row.id)} disabled={busy} />
            ),
          },
        ]
      : []),
    {
      key: 'code',
      header: t('reservations.groupFile.colCode'),
      render: (row) => (
        <Link to={`/rezervasyonlar/${row.id}`} className="font-mono text-xs font-semibold text-ink hover:underline">
          {row.confirmationCode}
        </Link>
      ),
    },
    { key: 'guest', header: t('reservations.groupFile.colGuest'), className: 'font-semibold', render: (row) => row.guest.name },
    { key: 'roomType', header: t('reservations.groupFile.colRoomType'), render: (row) => row.roomType.code },
    { key: 'room', header: t('reservations.groupFile.colRoom'), render: (row) => row.room?.number ?? <Badge tone="warning" dot={false}>{t('reservations.detail.unassigned')}</Badge> },
    { key: 'stay', header: t('reservations.groupFile.colStay'), render: (row) => `${formatDate(row.checkIn)} – ${formatDate(row.checkOut)}` },
    { key: 'party', header: t('reservations.groupFile.colParty'), className: 'tabular-nums', render: (row) => `${row.adults}+${row.children}` },
    { key: 'board', header: t('reservations.groupFile.colBoard'), render: (row) => boardShort(row.boardType) },
    { key: 'status', header: t('reservations.groupFile.colStatus'), render: (row) => <Badge tone={RESERVATION_STATUS_TONES[row.status]}>{statusLabel(row.status)}</Badge> },
    { key: 'totalPrice', header: t('reservations.groupFile.colPrice'), className: 'tabular-nums text-right', render: (row) => formatMoney(row.totalPrice, row.currency) },
    {
      key: 'balance',
      header: t('reservations.groupFile.colBalance'),
      className: 'tabular-nums text-right',
      render: (row) =>
        Number(row.balance) !== 0 ? <span className="font-semibold text-sec-strong">{formatMoney(row.balance, row.currency)}</span> : formatMoney(row.balance, row.currency),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <PageHeader
        title={group.name}
        description={[group.code, group.notes].filter(Boolean).join(' · ')}
        actions={
          canManage && openRooms > 0 ? (
            <Button variant="dangerSoft" icon="trash" onClick={() => setCancelling(true)} disabled={busy}>
              {t('reservations.detail.cancelGroup')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone="info" dot={false}>{t('reservations.groupFile.rooms', { count: group.summary.rooms })}</Badge>
        {Object.entries(group.summary.byStatus).map(([status, total]) => (
          <Badge key={status} tone={RESERVATION_STATUS_TONES[status]} dot={false}>
            {t('reservations.groupFile.statusCount', { count: total, status: statusLabel(status).toLocaleLowerCase(locale) })}
          </Badge>
        ))}
        <Badge tone="neutral" dot={false}>{t('reservations.groupFile.total', { amount: formatMoney(group.summary.totalPrice, group.summary.currency) })}</Badge>
        {Number(group.summary.openBalance) !== 0 && (
          <Badge tone="warning" dot={false}>{t('reservations.groupFile.openBalance', { amount: formatMoney(group.summary.openBalance, group.summary.currency) })}</Badge>
        )}
      </div>

      {(canManage || canStays) && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Checkbox
              label={selected.size > 0 ? t('reservations.groupFile.selected', { count: selected.size }) : t('reservations.groupFile.selectAll')}
              name="select-all"
              checked={selected.size > 0 && selected.size === rows.length}
              onChange={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((row) => row.id)))}
              disabled={busy}
            />
            <span className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" size="sm" icon="bed" disabled={busy || count('assign') === 0} onClick={() => runBatch('assign')}>
                {t('reservations.groupFile.assignButton', { count: count('assign') })}
              </Button>
              <Button variant="outline" size="sm" icon="key" disabled={busy || count('checkIn') === 0 || count('checkIn') > MAX_BULK_CHECK_INS} onClick={() => runBatch('checkIn')}>
                {t('reservations.groupFile.checkInButton', { count: count('checkIn') })}
              </Button>
              <Button variant="outline" size="sm" icon="checkCircle" disabled={busy || count('checkOut') === 0} onClick={() => runBatch('checkOut')}>
                {t('reservations.groupFile.checkOutButton', { count: count('checkOut') })}
              </Button>
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {t('reservations.groupFile.batchHint')}
          </p>
        </Card>
      )}

      {batchMutation.isError && <Alert tone="danger" title={t('reservations.groupFile.batchFailed')}>{batchMutation.error.message}</Alert>}
      {batchResult && <BatchResultAlert label={batchResult.label} result={batchResult.result} rows={rows} onClose={() => setBatchResult(null)} />}

      <div className="overflow-x-auto rounded-card bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-muted">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`px-4 py-3 font-medium ${column.className ?? ''}`}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-muted">
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-3 ${column.className ?? ''}`}>{column.render ? column.render(row) : row[column.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cancelling && (
        <CancelGroupModal
          openRooms={openRooms}
          isPending={cancelMutation.isPending}
          error={cancelMutation.error}
          onClose={() => {
            setCancelling(false);
            cancelMutation.reset();
          }}
          onConfirm={(reason) => cancelMutation.mutate({ reason, waiveFee: false })}
        />
      )}
    </div>
  );
}

/** Toplu işlem sonucu: başarı sayısı + başarısızların sebebi (onay koduyla). */
function BatchResultAlert({ label, result, rows, onClose }) {
  const t = useT();
  const failures = (result.results ?? []).filter((row) => !row.ok);
  const codeOf = (id) => rows.find((row) => row.id === id)?.confirmationCode ?? id;
  const succeeded = result.succeeded ?? result.assigned ?? 0;
  return (
    <Alert
      tone={failures.length === 0 ? 'success' : 'warning'}
      title={failures.length ? t('reservations.groupFile.resultWithSkipped', { label, succeeded, skipped: failures.length }) : t('reservations.groupFile.result', { label, succeeded })}
      action={<Button variant="ghost" size="sm" onClick={onClose}>{t('common.close')}</Button>}
    >
      {failures.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-sm">
          {failures.map((row) => (
            <li key={row.id}>
              <span className="font-mono text-xs">{codeOf(row.id)}</span>: {row.message}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

function CancelGroupModal({ openRooms, isPending, error, onClose, onConfirm }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      title={t('reservations.detail.cancelGroup')}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="dangerSoft" icon="trash" disabled={isPending || reason.trim().length === 0} onClick={() => onConfirm(reason.trim())}>
            {isPending ? t('reservations.cancel.submitting') : t('reservations.cancel.submitGroup', { count: openRooms })}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        {t('reservations.groupFile.cancelHint')}
      </p>
      <Textarea label={t('reservations.cancel.reasonLabel')} name="reason" rows={2} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-4" />
      {error && <Alert tone="danger" title={t('reservations.groupFile.cancelFailed')} className="mt-4">{error.message}</Alert>}
    </Modal>
  );
}

function BackLink() {
  const t = useT();
  return (
    <Link to="/gruplar" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
      <Icon name="arrowLeft" className="size-4" />
      {t('reservations.groups.title')}
    </Link>
  );
}
