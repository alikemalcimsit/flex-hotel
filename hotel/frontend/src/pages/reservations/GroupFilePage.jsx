import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BOARD_TYPE_LABELS, MAX_BULK_CHECK_INS, RESERVATION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Icon, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { RESERVATION_STATUS_TONES, reservationKeys } from '../../lib/reservations.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastSuccess } from '../../store/toast.js';

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
      toastSuccess(`${result.cancelled ?? ''} oda iptal edildi`.trim());
      refresh();
    },
  });

  const fallback = <QueryFallback query={query} errorTitle="Grup dosyası yüklenemedi" />;
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
      assign: { label: 'Toplu oda atama', path: '/rooms/assignments/auto-batch', body: { reservationIds: eligible.map((row) => row.id) } },
      checkIn: { label: 'Toplu check-in', path: '/front-desk/stays/check-in-batch', body: { items } },
      checkOut: { label: 'Toplu check-out', path: '/front-desk/stays/check-out-batch', body: { items } },
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
              <Checkbox label="" aria-label={`${row.confirmationCode} seç`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} disabled={busy} />
            ),
          },
        ]
      : []),
    {
      key: 'code',
      header: 'Onay kodu',
      render: (row) => (
        <Link to={`/rezervasyonlar/${row.id}`} className="font-mono text-xs font-semibold text-ink hover:underline">
          {row.confirmationCode}
        </Link>
      ),
    },
    { key: 'guest', header: 'Misafir', className: 'font-semibold', render: (row) => row.guest.name },
    { key: 'roomType', header: 'Oda tipi', render: (row) => row.roomType.code },
    { key: 'room', header: 'Oda', render: (row) => row.room?.number ?? <Badge tone="warning" dot={false}>Atanmadı</Badge> },
    { key: 'stay', header: 'Giriş – çıkış', render: (row) => `${formatDate(row.checkIn)} – ${formatDate(row.checkOut)}` },
    { key: 'party', header: 'Kişi', className: 'tabular-nums', render: (row) => `${row.adults}+${row.children}` },
    { key: 'board', header: 'Pansiyon', render: (row) => BOARD_TYPE_LABELS[row.boardType]?.split(' — ')[0] ?? row.boardType },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={RESERVATION_STATUS_TONES[row.status]}>{RESERVATION_STATUS_LABELS[row.status]}</Badge> },
    { key: 'totalPrice', header: 'Fiyat', className: 'tabular-nums text-right', render: (row) => formatMoney(row.totalPrice, row.currency) },
    {
      key: 'balance',
      header: 'Bakiye',
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
              Grubu iptal et
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone="info" dot={false}>{group.summary.rooms} oda</Badge>
        {Object.entries(group.summary.byStatus).map(([status, total]) => (
          <Badge key={status} tone={RESERVATION_STATUS_TONES[status]} dot={false}>
            {total} {RESERVATION_STATUS_LABELS[status]?.toLocaleLowerCase('tr')}
          </Badge>
        ))}
        <Badge tone="neutral" dot={false}>Toplam {formatMoney(group.summary.totalPrice, group.summary.currency)}</Badge>
        {Number(group.summary.openBalance) !== 0 && (
          <Badge tone="warning" dot={false}>Açık bakiye {formatMoney(group.summary.openBalance, group.summary.currency)}</Badge>
        )}
      </div>

      {(canManage || canStays) && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Checkbox
              label={selected.size > 0 ? `${selected.size} seçili` : 'Tümünü seç'}
              name="select-all"
              checked={selected.size > 0 && selected.size === rows.length}
              onChange={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((row) => row.id)))}
              disabled={busy}
            />
            <span className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" size="sm" icon="bed" disabled={busy || count('assign') === 0} onClick={() => runBatch('assign')}>
                Toplu oda ata ({count('assign')})
              </Button>
              <Button variant="outline" size="sm" icon="key" disabled={busy || count('checkIn') === 0 || count('checkIn') > MAX_BULK_CHECK_INS} onClick={() => runBatch('checkIn')}>
                Toplu check-in ({count('checkIn')})
              </Button>
              <Button variant="outline" size="sm" icon="checkCircle" disabled={busy || count('checkOut') === 0} onClick={() => runBatch('checkOut')}>
                Toplu check-out ({count('checkOut')})
              </Button>
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Toplu giriş kimlik / depozito sormaz: ayrıntı gereken misafir sebeple atlanır, tek tek alınır. Toplu çıkış yalnızca
            bakiyesi kapalı konaklamaları kapatır.
          </p>
        </Card>
      )}

      {batchMutation.isError && <Alert tone="danger" title="Toplu işlem başarısız">{batchMutation.error.message}</Alert>}
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
  const failures = (result.results ?? []).filter((row) => !row.ok);
  const codeOf = (id) => rows.find((row) => row.id === id)?.confirmationCode ?? id;
  const succeeded = result.succeeded ?? result.assigned ?? 0;
  return (
    <Alert
      tone={failures.length === 0 ? 'success' : 'warning'}
      title={`${label}: ${succeeded} başarılı${failures.length ? `, ${failures.length} atlandı` : ''}`}
      action={<Button variant="ghost" size="sm" onClick={onClose}>Kapat</Button>}
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
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      title="Grubu iptal et"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button variant="dangerSoft" icon="trash" disabled={isPending || reason.trim().length === 0} onClick={() => onConfirm(reason.trim())}>
            {isPending ? 'İptal ediliyor…' : `${openRooms} odayı iptal et`}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        Grubun açık (bekleyen / onaylı) odaları birlikte iptal edilir; giriş yapmış ya da kapanmış odalara dokunulmaz.
      </p>
      <Textarea label="İptal sebebi" name="reason" rows={2} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-4" />
      {error && <Alert tone="danger" title="İptal edilemedi" className="mt-4">{error.message}</Alert>}
    </Modal>
  );
}

function BackLink() {
  return (
    <Link to="/gruplar" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
      <Icon name="arrowLeft" className="size-4" />
      Gruplar
    </Link>
  );
}
