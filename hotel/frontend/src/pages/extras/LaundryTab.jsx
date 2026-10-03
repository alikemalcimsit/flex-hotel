import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EXTRAS_PAGE_SIZE, LAUNDRY_EDITABLE_STATUSES, LAUNDRY_OPEN_STATUSES, LAUNDRY_VIEWS, LAUNDRY_VIEW_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, EmptyState, Input, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { LAUNDRY_STATUS_TONES, POSTING_LABELS, POSTING_TONES, extrasKeys, laundryStatusLabel, serviceLabel } from '../../lib/extras.js';
import { folioPath } from '../../lib/folios.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { EXTRAS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { NewLaundryOrderDialog, RecountDialog, StatusDialog } from './LaundryDialogs.jsx';

const SEARCH_DEBOUNCE_MS = 300;
const OFFLINE_REFRESH_MS = 60_000;
const LIVE_MIN_INTERVAL_MS = 1500;
const dueFormatter = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Bir sonraki adım: düğme etiketi. Teslim ve iptal onay ister. */
const NEXT_STEP = Object.freeze({
  RECEIVED: { status: 'IN_PROCESS', label: 'Yıkamaya al', icon: 'refresh' },
  IN_PROCESS: { status: 'READY', label: 'Hazır', icon: 'check' },
  READY: { status: 'DELIVERED', label: 'Teslim et', icon: 'checkCheck' },
});

/**
 * Çamaşırhane panosu (modül 19): açık siparişler teslim sırasıyla (geciken
 * kırmızı), gecikenler, teslim edilenler (folyo durumuyla), iptaller; oda no,
 * sipariş no ya da misafir adıyla arama. Sipariş alma, sayım düzeltme, adım
 * ilerletme, teslim ve iptal `laundry.post` ile. Canlı.
 */
export function LaundryTab() {
  const can = useCan();
  const canPost = can(PERMISSIONS.LAUNDRY_POST);
  const queryClient = useQueryClient();
  const [view, setView] = useState('OPEN');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { isLive } = useLiveChannel(EXTRAS_CHANNEL, { queryKeys: [['extras', 'orders']], minIntervalMs: LIVE_MIN_INTERVAL_MS });
  const filters = { view, search, page };
  const list = useQuery({
    queryKey: extrasKeys.orders(filters),
    queryFn: () => api(withQuery('/extras/laundry/orders', { view, search: search || undefined, page, pageSize: EXTRAS_PAGE_SIZE })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: (previous) => previous,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: extrasKeys.all });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Görünüm">
          {LAUNDRY_VIEWS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => {
                setView(value);
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${view === value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
            >
              {LAUNDRY_VIEW_LABELS[value]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Ara" placeholder="Oda no, sipariş no, misafir" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-56" />
          {canPost && <Button icon="plus" onClick={() => setDialog({ kind: 'new' })}>Yeni sipariş</Button>}
          <Badge tone={isLive ? 'success' : 'warning'} className="mb-2">{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
        </div>
      </div>

      {list.isPending ? (
        <Spinner className="py-6" />
      ) : list.isError ? (
        <Alert tone="danger" title="Siparişler yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => list.refetch()}>Tekrar dene</Button>}>
          {list.error.message}
        </Alert>
      ) : list.data.items.length === 0 ? (
        <EmptyState icon="layers" title={search ? 'Aramaya uyan sipariş yok' : 'Bu görünümde sipariş yok'} description={view === 'OPEN' ? 'Yeni sipariş alındıkça burada teslim sırasıyla görünür.' : ''} />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
            {list.data.items.map((order) => (
              <OrderRow key={order.id} order={order} canPost={canPost} canViewFolio={can(PERMISSIONS.FOLIO_VIEW)} onAction={setDialog} />
            ))}
          </ul>
          {list.data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-ink-soft">
              <span>
                {list.data.meta.total}
                {list.data.meta.totalCapped ? '+' : ''} sipariş · sayfa {page} / {list.data.meta.totalPages}
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="outline" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage(page - 1)}>Önceki</Button>
                <Button size="sm" variant="outline" icon="chevronRight" disabled={page >= list.data.meta.totalPages} onClick={() => setPage(page + 1)}>Sonraki</Button>
              </span>
            </div>
          )}
        </>
      )}

      {dialog?.kind === 'new' && <NewLaundryOrderDialog onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'recount' && <RecountDialog order={dialog.order} onClose={() => setDialog(null)} onDone={refresh} />}
      {(dialog?.kind === 'deliver' || dialog?.kind === 'cancel') && (
        <StatusDialog order={dialog.order} status={dialog.kind === 'deliver' ? 'DELIVERED' : 'CANCELLED'} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog?.kind === 'step' && <StepConfirm order={dialog.order} step={dialog.step} onClose={() => setDialog(null)} onDone={refresh} />}
    </div>
  );
}

/**
 * @param {{ order: any, canPost: boolean, canViewFolio: boolean, onAction: (dialog: object) => void }} props
 */
function OrderRow({ order, canPost, canViewFolio, onAction }) {
  const open = LAUNDRY_OPEN_STATUSES.includes(order.status);
  const next = NEXT_STEP[order.status];
  return (
    <li className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm ${order.overdue ? 'bg-danger-soft' : ''}`}>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-bold">Oda {order.roomNumber}</span>
          <span className="font-mono text-xs text-ink-muted">{order.reference}</span>
          <Badge tone={LAUNDRY_STATUS_TONES[order.status]}>{laundryStatusLabel(order.status)}</Badge>
          {order.express && <Badge tone="warning">Ekspres</Badge>}
          {order.overdue && <Badge tone="danger">Gecikti</Badge>}
          {order.posting && <Badge tone={POSTING_TONES[order.posting.status]}>{POSTING_LABELS[order.posting.status]}</Badge>}
        </span>
        <span className="mt-0.5 block text-ink-soft">
          {order.stay.guestName} · {order.lines.map((line) => `${line.quantity} × ${line.name} (${serviceLabel(line.service).toLocaleLowerCase('tr')})`).join(', ')}
        </span>
        <span className="block text-xs text-ink-muted">
          {open ? `Teslim ${dueFormatter.format(new Date(order.dueAt))}` : order.status === 'DELIVERED' ? `Teslim edildi ${dueFormatter.format(new Date(order.deliveredAt))} · ${order.deliveredBy}` : `İptal: ${order.cancelReason} · ${order.cancelledBy}`}
          {order.note ? ` · ${order.note}` : ''}
          {order.stay.status === 'CHECKED_OUT' && open ? ' · misafir çıkış yaptı' : ''}
        </span>
      </span>
      <span className="flex flex-col items-end gap-2">
        <span className="font-bold tabular-nums">{formatMoney(order.total)}</span>
        {canPost && open && (
          <span className="flex flex-wrap justify-end gap-1.5">
            {LAUNDRY_EDITABLE_STATUSES.includes(order.status) && (
              <Button size="sm" variant="ghost" icon="pencil" onClick={() => onAction({ kind: 'recount', order })}>Sayım</Button>
            )}
            <Button size="sm" variant="dangerSoft" icon="close" onClick={() => onAction({ kind: 'cancel', order })}>İptal</Button>
            {next && next.status !== 'DELIVERED' && (
              <Button size="sm" variant="outline" icon={next.icon} onClick={() => onAction({ kind: 'step', order, step: next })}>{next.label}</Button>
            )}
            <Button size="sm" icon="checkCheck" onClick={() => onAction({ kind: 'deliver', order })}>Teslim et</Button>
          </span>
        )}
        {order.posting?.status === 'POSTED' && canViewFolio && (
          <Link className="text-xs font-semibold text-info-ink underline-offset-2 hover:underline" to={folioPath(order.posting.reservationId, order.posting.folioId)}>
            Folyoyu aç
          </Link>
        )}
      </span>
    </li>
  );
}

/**
 * Ara adım (yıkamaya al / hazır): tek dokunuş, sürüm damgasıyla.
 * @param {{ order: any, step: { status: string, label: string }, onClose: () => void, onDone: () => void }} props
 */
function StepConfirm({ order, step, onClose, onDone }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  async function confirm() {
    setPending(true);
    try {
      await apiPost(`/extras/laundry/orders/${order.id}/status`, { expectedUpdatedAt: order.updatedAt, status: step.status });
      toastSuccess(`${order.reference}: ${laundryStatusLabel(step.status).toLocaleLowerCase('tr')}`);
      onDone();
      onClose();
    } catch (failure) {
      setError(failure);
      if (failure.code === 'STALE_WRITE') toastError('Sipariş bu arada değişti; liste tazelendi');
      onDone();
    } finally {
      setPending(false);
    }
  }
  return (
    <ConfirmDialog
      open
      title={`${order.reference} · oda ${order.roomNumber}`}
      message={`Sipariş "${laundryStatusLabel(step.status)}" olarak işaretlensin mi?`}
      confirmLabel={step.label}
      confirmVariant="primary"
      confirmIcon="check"
      onConfirm={confirm}
      onClose={onClose}
      isPending={pending}
      error={error}
    />
  );
}
