import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FOLIO_ITEMS_PAGE_SIZE, PAYMENTS_PAGE_SIZE, folioActionError } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, EmptyState, Icon, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { FOLIO_STATUS_TONES, balanceTone, folioKeys, folioPath } from '../../lib/folios.js';
import { formatDate, formatMoney, formatPercent } from '../../lib/format.js';
import { MoneyText } from '../../components/MoneyText.jsx';
import { absolute, cashKeys, methodLabel } from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { RESERVATION_STATUS_TONES } from '../../lib/reservations.js';
import { FOLIOS_CHANNEL, RESERVATIONS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { EditPayerDialog, PostChargeDialog, ReopenFolioDialog, VoidItemDialog } from './FolioDialogs.jsx';
import { FolioItemsTable } from './FolioItemsTable.jsx';
import { folioStatusText, itemTypeText, reservationStatusText } from './labels.js';
import { SourceInvoice } from '../invoicing/SourceInvoice.jsx';
import { FolioPayments } from './FolioPayments.jsx';
import { MergeDialog, RoutingDialog, SplitDialog, TransferDialog } from './FolioMoveDialogs.jsx';
import { PaymentDialog, VoidPaymentDialog } from './PaymentDialogs.jsx';

const OFFLINE_REFRESH_MS = 60_000;

/** Başka konaklamanın kimliğiyle gelse de bu ekranı etkileyebilen haberler (kaynak / hedef folyo). */
const CROSS_STAY_EVENTS = new Set(['folio.items.transferred', 'folio.merged', 'folio.routes.changed']);

/**
 * Konaklamanın hesabı tek ekranda (modül 15): folyolar (pencereler) sekme
 * olarak, seçili folyonun dökümü, toplamları, vergi özeti ve ödemeleri.
 *
 * İşlemler yetkiye göre: harcama işle, iptal iste (onaya gider), aktar, böl,
 * birleştir, yönlendir, kapat (`folio.post`); indirim ve yeniden açma
 * (`folio.adjust`); ödeme al (`payment.receive`), iade ve ödeme iptali iste
 * (`payment.refund`, onaya gider). Başka personelin işlemi canlı yansır.
 */
export function StayFolioPage() {
  const t = useT();
  const { reservationId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const can = useCan();
  const canPost = can(PERMISSIONS.FOLIO_POST);

  // Yalnızca bu konaklamanın haberi (ya da konaklamalar arası işler: aktarma, birleştirme,
  // gecenin oda ücretleri) ekranı tazeler; otelin her ödemesinde 2500 panel sormasın.
  const { isLive } = useLiveChannel(FOLIOS_CHANNEL, {
    queryKeys: (payload) =>
      !payload || !payload.reservationId || payload.reservationId === reservationId || CROSS_STAY_EVENTS.has(payload.event)
        ? [folioKeys.all]
        : [],
  });
  useLiveChannel(RESERVATIONS_CHANNEL, {
    queryKeys: (payload) => (payload && payload.reservationId !== reservationId ? [] : [folioKeys.stay(reservationId)]),
  });

  const stayQuery = useQuery({
    queryKey: folioKeys.stay(reservationId),
    queryFn: () => api(`/folios/stays/${reservationId}`),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: folioKeys.all });

  const openFolio = useMutation({
    mutationFn: () => apiPost(`/folios/stays/${reservationId}`, {}),
    onSuccess: () => {
      toastSuccess(t('folio.stay.opened'));
      refresh();
    },
    onError: (error) => toastError(error.message),
  });
  const recordDeposit = useMutation({
    mutationFn: () => apiPost(`/payments/stays/${reservationId}/deposit`, {}),
    onSuccess: (result) => {
      if (result.skipped) toastSuccess(result.skipped);
      else if (result.status === 'PENDING') toastSuccess(t('folio.stay.depositSentForApproval'));
      else toastSuccess(t('folio.stay.depositPosted', { amount: formatMoney(result.amount, result.currency) }));
      refresh();
      queryClient.invalidateQueries({ queryKey: cashKeys.all });
    },
    onError: (error) => toastError(error.message),
  });
  const postNights = useMutation({
    mutationFn: () => apiPost(`/folios/stays/${reservationId}/room-charges`, {}),
    onSuccess: (result) => {
      toastSuccess(result.items ? t('folio.stay.nightsPosted', { count: result.items, amount: formatMoney(result.total) }) : t('folio.stay.noNightsToPost'));
      refresh();
    },
    onError: (error) => toastError(error.message),
  });

  if (!stayQuery.data) return <QueryFallback query={stayQuery} errorTitle={t('folio.stay.loadFailed')} />;
  const { stay, folios, routes, roomCharges, payments } = stayQuery.data;
  const requested = searchParams.get('folyo');
  const selected =
    folios.find((folio) => folio.id === requested) ?? folios.find((folio) => folio.status === 'OPEN') ?? folios[0] ?? null;
  const select = (folioId) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('folyo', folioId);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('folio.stay.title', { guest: stay.guest.name })}
        description={t('folio.stay.description', {
          room: stay.room ? t('folio.stay.room', { number: stay.room.number }) : t('folio.stay.noRoom'),
          code: stay.confirmationCode,
          checkIn: formatDate(stay.checkIn),
          checkOut: formatDate(stay.checkOut),
        })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={RESERVATION_STATUS_TONES[stay.status]}>{reservationStatusText(stay.status)}</Badge>
            <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? t('common.live') : t('common.notLive')}</Badge>
            {can(PERMISSIONS.RESERVATIONS_VIEW) && (
              <Link to={`/rezervasyonlar/${stay.id}`}>
                <Button variant="outline" size="sm" icon="bookOpen">{t('folio.stay.reservation')}</Button>
              </Link>
            )}
          </div>
        }
      />

      {roomCharges.nights > 0 && (
        <Alert
          tone="warning"
          title={t('folio.stay.unpostedTitle', { count: roomCharges.nights, amount: formatMoney(roomCharges.amount, stay.currency) })}
          action={
            canPost && (
              <Button size="sm" icon="refresh" onClick={() => postNights.mutate()} disabled={postNights.isPending}>
                {postNights.isPending ? t('folio.stay.posting') : t('folio.stay.postMissingNights')}
              </Button>
            )
          }
        >
          {roomCharges.throughNight
            ? t('folio.stay.unpostedThrough', { date: formatDate(roomCharges.throughNight) })
            : t('folio.stay.unpostedAll')}{' '}
          {t('folio.stay.unpostedHint')}
        </Alert>
      )}

      <DepositNotice
        deposit={payments?.deposit}
        currency={stay.currency}
        canRecord={can(PERMISSIONS.PAYMENT_RECEIVE)}
        busy={recordDeposit.isPending}
        onRecord={() => recordDeposit.mutate()}
      />

      {folios.length === 0 ? (
        <EmptyState
          icon="fileText"
          title={t('folio.stay.emptyTitle')}
          description={t('folio.stay.emptyDescription')}
          action={
            canPost && (
              <Button icon="plus" onClick={() => openFolio.mutate()} disabled={openFolio.isPending}>
                {openFolio.isPending ? t('folio.stay.opening') : t('folio.stay.openFolio')}
              </Button>
            )
          }
        />
      ) : (
        <>
          <FolioTabs folios={folios} selectedId={selected?.id} onSelect={select} />
          <RoutesLine stay={stay} routes={routes} folios={folios} canEdit={canPost} onChanged={refresh} />
          {selected && (
            <FolioPanel
              key={selected.id}
              folio={selected}
              stay={stay}
              siblings={folios}
              onChanged={refresh}
              onSelect={select}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Pencereler: folyo adı, durum, bakiye.
 * @param {{ folios: object[], selectedId?: string, onSelect: (id: string) => void }} props
 */
function FolioTabs({ folios, selectedId, onSelect }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('folio.stay.tabs')}>
      {folios.map((folio) => {
        const active = folio.id === selectedId;
        return (
          <button
            key={folio.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(folio.id)}
            className={`flex min-w-[10rem] flex-col items-start gap-1 rounded-card border px-4 py-3 text-left transition-colors ${
              active ? 'border-ink bg-surface shadow-card' : 'border-line bg-surface-muted hover:border-line-strong'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-bold text-ink">
              {folio.name}
              {(folio.pendingVoids > 0 || folio.pendingPayments > 0) && (
                <Icon name="clock" className="size-3.5 text-warning-ink" title={t('folio.stay.tabPending')} />
              )}
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={FOLIO_STATUS_TONES[folio.status]}>{folioStatusText(folio.status)}</Badge>
              <span className="text-xs font-semibold tabular-nums text-ink-soft">{formatMoney(folio.balance, folio.currency)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Hangi tip hangi folyoya düşüyor (yalnızca yönlendirme varsa).
 * @param {{ stay: object, routes: object[], folios: object[], canEdit: boolean, onChanged: () => void }} props
 */
function RoutesLine({ stay, routes, folios, canEdit, onChanged }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hasOpen = folios.some((folio) => folio.status === 'OPEN');
  if (routes.length === 0 && (!canEdit || folios.filter((folio) => folio.status === 'OPEN').length < 2)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
      <Icon name="sliders" className="size-4" />
      {routes.length === 0 ? (
        <span>{t('folio.routes.default')}</span>
      ) : (
        routes.map((route) => (
          <span key={route.type} className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs">
            {itemTypeText(route.type)} →{' '}
            {route.folio.reservationId === stay.id ? (
              route.folio.name
            ) : (
              <Link className="text-info-ink underline-offset-2 hover:underline" to={folioPath(route.folio.reservationId, route.folio.id)}>
                {t('folio.routes.otherStay', { room: route.folio.roomNumber ?? '—', name: route.folio.name })}
              </Link>
            )}
          </span>
        ))
      )}
      {canEdit && hasOpen && (
        <Button size="sm" variant="ghost" icon="pencil" onClick={() => setOpen(true)}>{t('folio.routes.edit')}</Button>
      )}
      {open && <RoutingDialog reservationId={stay.id} folios={folios} routes={routes} onClose={() => setOpen(false)} onDone={onChanged} />}
    </div>
  );
}

/**
 * Seçili folyo: toplamlar, işlemler, döküm, vergi özeti, ödemeler.
 * @param {{ folio: object, stay: object, siblings: object[], onChanged: () => void, onSelect: (id: string) => void }} props
 */
function FolioPanel({ folio, stay, siblings, onChanged, onSelect }) {
  const t = useT();
  const can = useCan();
  const canPost = can(PERMISSIONS.FOLIO_POST);
  const canAdjust = can(PERMISSIONS.FOLIO_ADJUST);
  const canReceive = can(PERMISSIONS.PAYMENT_RECEIVE);
  const canRefund = can(PERMISSIONS.PAYMENT_REFUND);
  const queryClient = useQueryClient();
  const [includeVoided, setIncludeVoided] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);

  const detail = useQuery({ queryKey: folioKeys.folio(folio.id), queryFn: () => api(`/folios/${folio.id}`) });
  const items = useInfiniteQuery({
    queryKey: folioKeys.items(folio.id, includeVoided),
    queryFn: ({ pageParam }) =>
      api(withQuery(`/folios/${folio.id}/items`, { cursor: pageParam ?? undefined, limit: FOLIO_ITEMS_PAGE_SIZE, includeVoided })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const payments = useInfiniteQuery({
    queryKey: folioKeys.payments(folio.id),
    queryFn: ({ pageParam }) => api(withQuery(`/folios/${folio.id}/payments`, { cursor: pageParam ?? undefined, limit: PAYMENTS_PAGE_SIZE })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const refundable = payments.data?.pages[0]?.refundable ?? null;

  // Seçili kalem artık bu folyoda değilse (aktarıldı, iptal edildi) seçimden düşer.
  const loadedIds = items.data?.pages.flatMap((page) => page.items.map((item) => item.id)).join(',') ?? '';
  useEffect(() => {
    const present = new Set(loadedIds.split(',').filter(Boolean));
    setSelected((current) => new Set([...current].filter((id) => present.has(id))));
  }, [loadedIds]);

  const close = useMutation({
    mutationFn: () => apiPost(`/folios/${folio.id}/close`, {}),
    onSuccess: () => {
      toastSuccess(t('folio.panel.closed', { name: folio.name }));
      setDialog(null);
      onChanged();
    },
  });

  const open = folio.status === 'OPEN';
  // Sunucunun kuralıyla aynı: düğme neden kapalı olduğunu söyler (sunucu yine denetler).
  const closeBlocked = folioActionError(folio, 'close', {
    balanceZero: Number(folio.balance) === 0,
    pendingVoids: folio.pendingVoids,
    pendingPayments: folio.pendingPayments,
    lastOpenOfInHouseStay: stay.status === 'CHECKED_IN' && !siblings.some((row) => row.id !== folio.id && row.status === 'OPEN'),
  });
  const selectedIds = [...selected];
  const done = () => {
    setSelected(new Set());
    onChanged();
  };
  const paymentDone = () => {
    onChanged();
    queryClient.invalidateQueries({ queryKey: cashKeys.all });
  };
  const paymentTarget = { folioId: folio.id, name: folio.name, currency: folio.currency, balance: folio.balance, refundable };

  return (
    <section className="flex flex-col gap-5 rounded-card bg-surface p-5 shadow-card" aria-label={folio.name}>
      {folio.status === 'TRANSFERRED' && folio.mergedInto && (
        <Alert tone="info" title={t('folio.panel.mergedTitle')}>
          {t('folio.panel.mergedPrefix')}{' '}
          <Link className="font-semibold underline-offset-2 hover:underline" to={folioPath(folio.mergedInto.reservationId, folio.mergedInto.id)}>
            {t('folio.panel.mergedTarget', { room: folio.mergedInto.roomNumber ?? '—', guest: folio.mergedInto.guestName, name: folio.mergedInto.name })}
          </Link>{' '}
          {t('folio.panel.mergedSuffix', { date: formatDate(folio.mergedAt), user: folio.mergedBy })}
        </Alert>
      )}
      {folio.status === 'CLOSED' && (
        <Alert tone="info" title={t('folio.panel.closedTitle', { date: formatDate(folio.closedAt), user: folio.closedBy ?? '' })}>
          {t('folio.panel.closedHint')}
        </Alert>
      )}
      {folio.status === 'CLOSED' && Number(folio.chargesTotal) > 0 && <SourceInvoice kind="folio" id={folio.id} />}

      <Totals folio={folio} detail={detail} />

      {open && (canReceive || canRefund) && (
        <div className="flex flex-wrap items-center gap-2">
          {canReceive && (
            <Button icon="wallet" onClick={() => setDialog({ kind: 'payment' })}>{t('folio.panel.takePayment')}</Button>
          )}
          {canRefund && (
            <span title={refundable !== null && Number(refundable) <= 0 ? t('folio.panel.nothingToRefund') : undefined}>
              <Button variant="outline" icon="rotateCcw" disabled={refundable === null || Number(refundable) <= 0} onClick={() => setDialog({ kind: 'refund' })}>
                {t('folio.panel.refund')}
              </Button>
            </span>
          )}
          {Number(folio.balance) < 0 && (
            <span className="text-sm text-warning-ink">{t('folio.panel.guestCredit', { amount: formatMoney(absolute(folio.balance), folio.currency) })}</span>
          )}
        </div>
      )}

      {open && canPost && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" icon="plus" onClick={() => setDialog({ kind: 'charge' })}>{t('folio.panel.addCharge')}</Button>
          <Button variant="outline" icon="arrowRight" disabled={selectedIds.length === 0} onClick={() => setDialog({ kind: 'transfer' })}>
            {selectedIds.length ? t('folio.panel.transferCount', { count: selectedIds.length }) : t('folio.panel.transfer')}
          </Button>
          <Button variant="outline" icon="layers" onClick={() => setDialog({ kind: 'split' })}>
            {selectedIds.length ? t('folio.panel.splitSelected', { count: selectedIds.length }) : t('folio.panel.newFolio')}
          </Button>
          <Button variant="outline" icon="link" onClick={() => setDialog({ kind: 'merge' })}>{t('folio.panel.merge')}</Button>
          <Button variant="ghost" icon="pencil" onClick={() => setDialog({ kind: 'payer' })}>{t('folio.panel.payer')}</Button>
          <span className="ml-auto" title={closeBlocked ?? undefined}>
            <Button variant="outline" icon="lock" disabled={Boolean(closeBlocked)} onClick={() => setDialog({ kind: 'close' })}>
              {t('folio.panel.closeFolio')}
            </Button>
          </span>
        </div>
      )}
      {open && canPost && closeBlocked && <p className="-mt-3 text-xs text-ink-muted">{t('folio.panel.cannotClose', { reason: closeBlocked })}</p>}
      {folio.status === 'CLOSED' && canAdjust && (
        <div>
          <Button variant="outline" icon="rotateCcw" onClick={() => setDialog({ kind: 'reopen' })}>{t('folio.panel.reopen')}</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-ink">{t('folio.panel.statement')}</h2>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            aria-label={t('folio.panel.showVoided')}
            checked={includeVoided}
            onChange={(event) => setIncludeVoided(event.target.checked)}
            className="size-4 accent-[var(--color-ink)]"
          />
          {t('folio.panel.showVoided')}
        </label>
      </div>
      <FolioItemsTable
        query={items}
        currency={folio.currency}
        selectable={open && canPost}
        selected={selected}
        onToggle={(id) =>
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onToggleAll={(ids) => setSelected(new Set(ids))}
        onVoid={open && canPost ? (item) => setDialog({ kind: 'void', item }) : undefined}
      />

      <FolioPayments query={payments} currency={folio.currency} onVoid={open && canRefund ? (payment) => setDialog({ kind: 'voidPayment', payment }) : undefined} />

      {dialog?.kind === 'charge' && <PostChargeDialog folio={folio} canDiscount={canAdjust} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'void' && <VoidItemDialog folio={folio} item={dialog.item} currency={folio.currency} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'transfer' && <TransferDialog folio={folio} siblings={siblings} itemIds={selectedIds} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'split' && (
        <SplitDialog
          folio={folio}
          itemIds={selectedIds}
          onClose={() => setDialog(null)}
          onDone={(folioId) => {
            done();
            onSelect(folioId);
          }}
        />
      )}
      {dialog?.kind === 'merge' && <MergeDialog folio={folio} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'payer' && <EditPayerDialog folio={folio} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'reopen' && <ReopenFolioDialog folio={folio} onClose={() => setDialog(null)} onDone={done} />}
      {(dialog?.kind === 'payment' || dialog?.kind === 'refund') && (
        <PaymentDialog mode={dialog.kind} target={paymentTarget} onClose={() => setDialog(null)} onDone={paymentDone} />
      )}
      {dialog?.kind === 'voidPayment' && (
        <VoidPaymentDialog payment={dialog.payment} folioCurrency={folio.currency} onClose={() => setDialog(null)} onDone={paymentDone} />
      )}
      <ConfirmDialog
        open={dialog?.kind === 'close'}
        title={t('folio.panel.closeConfirmTitle', { name: folio.name })}
        message={stay.status === 'CHECKED_OUT' ? t('folio.panel.closeConfirmInvoice') : t('folio.panel.closeConfirm')}
        confirmLabel={t('common.close')}
        confirmVariant="primary"
        confirmIcon="lock"
        onConfirm={() => close.mutate()}
        onClose={() => {
          close.reset();
          setDialog(null);
        }}
        isPending={close.isPending}
        error={close.error}
      />
    </section>
  );
}

/**
 * Harcama / ödenen / bakiye ve vergi özeti.
 * @param {{ folio: object, detail: import('@tanstack/react-query').UseQueryResult }} props
 */
function Totals({ folio, detail }) {
  const t = useT();
  const tone = balanceTone(folio.balance);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t('folio.totals.charges')} value={<MoneyText value={folio.chargesTotal} currency={folio.currency} block />} />
        <Stat label={t('folio.totals.paid')} value={<MoneyText value={folio.paymentsTotal} currency={folio.currency} block />} />
        <Stat
          label={Number(folio.balance) < 0 ? t('folio.totals.toRefund') : t('folio.totals.balance')}
          value={<MoneyText value={String(folio.balance).replace('-', '')} currency={folio.currency} block />}
          tone={tone}
        />
      </dl>
      <div className="rounded-item border border-line px-4 py-3 text-sm">
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{t('folio.totals.taxSummary')}</p>
        {detail.isPending ? (
          <Spinner className="py-1" />
        ) : detail.isError ? (
          <p className="text-xs text-sec-strong">{detail.error.message}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-y-0.5">
            <dt className="text-ink-muted">{t('folio.totals.net')}</dt>
            <dd className="text-right tabular-nums">{formatMoney(detail.data.netTotal, folio.currency)}</dd>
            {detail.data.taxSummary.map((tax) => (
              <FragmentPair
                key={`${tax.name}-${tax.rate}-${tax.included}`}
                label={tax.included ? `${tax.name} ${formatPercent(tax.rate)}` : t('folio.totals.taxAdded', { name: tax.name, rate: formatPercent(tax.rate) })}
                value={formatMoney(tax.amount, folio.currency)}
              />
            ))}
            {detail.data.taxSummary.length === 0 && <FragmentPair label={t('folio.totals.tax')} value="—" />}
          </dl>
        )}
      </div>
    </div>
  );
}

/** @param {{ label: string, value: React.ReactNode, tone?: string }} props */
function Stat({ label, value, tone }) {
  const color = tone === 'danger' ? 'text-sec-strong' : tone === 'warning' ? 'text-warning-ink' : tone === 'success' ? 'text-success-ink' : 'text-ink';
  return (
    <div className="rounded-item bg-surface-muted px-4 py-3">
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className={`mt-1 text-lg font-bold tabular-nums sm:text-xl ${color}`}>{value}</dd>
    </div>
  );
}

/** @param {{ label: string, value: string }} props */
function FragmentPair({ label, value }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}

/**
 * Girişte alınan teminat (modül 17): nakit / havale teminatı ödeme olarak
 * işlenir (folyo aktörü; kapalıysa personel düğmeyle). Kart provizyonu ödeme
 * değildir: çıkışta kartla tahsil edilir.
 * @param {{ deposit: any, currency: string, canRecord: boolean, busy: boolean, onRecord: () => void }} props
 */
function DepositNotice({ deposit, currency, canRecord, busy, onRecord }) {
  const t = useT();
  if (!deposit) return null;
  const label = `${methodLabel(deposit.method === 'CARD_PREAUTH' ? 'CARD' : deposit.method)} · ${formatMoney(deposit.amount, currency)}${deposit.reference ? ` · ${deposit.reference}` : ''}`;
  if (deposit.recorded === null) {
    return (
      <Alert tone="info" title={
          deposit.reference
            ? t('folio.deposit.preauthTitleRef', { amount: formatMoney(deposit.amount, currency), reference: deposit.reference })
            : t('folio.deposit.preauthTitle', { amount: formatMoney(deposit.amount, currency) })
        }
      >
        {t('folio.deposit.preauthHint')}
      </Alert>
    );
  }
  if (deposit.recorded === 'POSTED') return null;
  if (deposit.recorded === 'PENDING') {
    return (
      <Alert tone="info" title={t('folio.deposit.pendingTitle')}>
        {t('folio.deposit.pendingBody', { deposit: label })}
      </Alert>
    );
  }
  return (
    <Alert
      tone="warning"
      title={t('folio.deposit.unpostedTitle')}
      action={
        canRecord && (
          <Button size="sm" icon="wallet" onClick={onRecord} disabled={busy}>
            {busy ? t('folio.stay.posting') : t('folio.deposit.post')}
          </Button>
        )
      }
    >
      {t('folio.deposit.unpostedBody', { deposit: label })}
    </Alert>
  );
}
