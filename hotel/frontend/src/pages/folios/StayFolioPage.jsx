import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FOLIO_ITEMS_PAGE_SIZE, PAYMENTS_PAGE_SIZE, RESERVATION_STATUS_LABELS, folioActionError } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, EmptyState, Icon, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { FOLIO_STATUS_TONES, balanceTone, folioKeys, folioPath, folioStatusLabel, itemTypeLabel } from '../../lib/folios.js';
import { formatDate, formatMoney, formatPercent } from '../../lib/format.js';
import { absolute, cashKeys, methodLabel } from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { RESERVATION_STATUS_TONES } from '../../lib/reservations.js';
import { FOLIOS_CHANNEL, RESERVATIONS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { EditPayerDialog, PostChargeDialog, ReopenFolioDialog, VoidItemDialog } from './FolioDialogs.jsx';
import { FolioItemsTable } from './FolioItemsTable.jsx';
import { FolioPayments } from './FolioPayments.jsx';
import { MergeDialog, RoutingDialog, SplitDialog, TransferDialog } from './FolioMoveDialogs.jsx';
import { PaymentDialog, VoidPaymentDialog } from './PaymentDialogs.jsx';

const OFFLINE_REFRESH_MS = 60_000;

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
  const { reservationId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const can = useCan();
  const canPost = can(PERMISSIONS.FOLIO_POST);

  const { isLive } = useLiveChannel(FOLIOS_CHANNEL, { queryKeys: [folioKeys.all] });
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
      toastSuccess('Folyo açıldı');
      refresh();
    },
    onError: (error) => toastError(error.message),
  });
  const recordDeposit = useMutation({
    mutationFn: () => apiPost(`/payments/stays/${reservationId}/deposit`, {}),
    onSuccess: (result) => {
      if (result.skipped) toastSuccess(result.skipped);
      else if (result.status === 'PENDING') toastSuccess('Teminat büyük ödeme onayına gönderildi');
      else toastSuccess(`Teminat ödeme olarak işlendi (${formatMoney(result.amount, result.currency)})`);
      refresh();
      queryClient.invalidateQueries({ queryKey: cashKeys.all });
    },
    onError: (error) => toastError(error.message),
  });
  const postNights = useMutation({
    mutationFn: () => apiPost(`/folios/stays/${reservationId}/room-charges`, {}),
    onSuccess: (result) => {
      toastSuccess(result.items ? `${result.items} oda ücreti kalemi işlendi (${formatMoney(result.total)})` : 'İşlenecek gece yoktu');
      refresh();
    },
    onError: (error) => toastError(error.message),
  });

  if (!stayQuery.data) return <QueryFallback query={stayQuery} errorTitle="Folyo yüklenemedi" />;
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
        title={`Folyo — ${stay.guest.name}`}
        description={`${stay.room ? `Oda ${stay.room.number}` : 'Oda atanmadı'} · ${stay.confirmationCode} · ${formatDate(stay.checkIn)} – ${formatDate(stay.checkOut)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={RESERVATION_STATUS_TONES[stay.status]}>{RESERVATION_STATUS_LABELS[stay.status] ?? stay.status}</Badge>
            <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
            {can(PERMISSIONS.RESERVATIONS_VIEW) && (
              <Link to={`/rezervasyonlar/${stay.id}`}>
                <Button variant="outline" size="sm" icon="bookOpen">Rezervasyon</Button>
              </Link>
            )}
          </div>
        }
      />

      {roomCharges.nights > 0 && (
        <Alert
          tone="warning"
          title={`${roomCharges.nights} oda ücreti kalemi henüz işlenmedi (${formatMoney(roomCharges.amount, stay.currency)})`}
          action={
            canPost && (
              <Button size="sm" icon="refresh" onClick={() => postNights.mutate()} disabled={postNights.isPending}>
                {postNights.isPending ? 'İşleniyor…' : 'Eksik oda ücretlerini işle'}
              </Button>
            )
          }
        >
          {roomCharges.throughNight
            ? `${formatDate(roomCharges.throughNight)} gecesine kadar olan geceler ya da sonradan değişen fiyat farkları folyoya yansımamış.`
            : 'Konaklamanın geceleri ya da sonradan değişen fiyat farkları folyoya yansımamış.'}{' '}
          Gece çalışması bunları kendiliğinden işler; beklemeden işleyebilirsiniz (işlenmiş gece yeniden işlenmez).
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
          title="Bu konaklamanın folyosu yok"
          description="Folyo misafir giriş yapınca açılır. Gelmeden önce depozito ya da ücret işlenecekse şimdi açabilirsiniz."
          action={
            canPost && (
              <Button icon="plus" onClick={() => openFolio.mutate()} disabled={openFolio.isPending}>
                {openFolio.isPending ? 'Açılıyor…' : 'Folyo aç'}
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
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Folyolar">
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
                <Icon name="clock" className="size-3.5 text-warning-ink" title="Onay bekleyen iptal ya da ödeme var" />
              )}
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={FOLIO_STATUS_TONES[folio.status]}>{folioStatusLabel(folio.status)}</Badge>
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
  const [open, setOpen] = useState(false);
  const hasOpen = folios.some((folio) => folio.status === 'OPEN');
  if (routes.length === 0 && (!canEdit || folios.filter((folio) => folio.status === 'OPEN').length < 2)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
      <Icon name="sliders" className="size-4" />
      {routes.length === 0 ? (
        <span>Sistem kalemleri ilk açık folyoya düşüyor.</span>
      ) : (
        routes.map((route) => (
          <span key={route.type} className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs">
            {itemTypeLabel(route.type)} →{' '}
            {route.folio.reservationId === stay.id ? (
              route.folio.name
            ) : (
              <Link className="text-info-ink underline-offset-2 hover:underline" to={folioPath(route.folio.reservationId, route.folio.id)}>
                oda {route.folio.roomNumber ?? '—'} · {route.folio.name}
              </Link>
            )}
          </span>
        ))
      )}
      {canEdit && hasOpen && (
        <Button size="sm" variant="ghost" icon="pencil" onClick={() => setOpen(true)}>Yönlendirme</Button>
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
      toastSuccess(`${folio.name} kapandı`);
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
        <Alert tone="info" title="Bu folyo birleştirildi">
          Kalem ve ödemeleri{' '}
          <Link className="font-semibold underline-offset-2 hover:underline" to={folioPath(folio.mergedInto.reservationId, folio.mergedInto.id)}>
            oda {folio.mergedInto.roomNumber ?? '—'} · {folio.mergedInto.guestName} — {folio.mergedInto.name}
          </Link>{' '}
          folyosunda ({formatDate(folio.mergedAt)}, {folio.mergedBy}). Bu konaklamanın sonraki kalemleri oraya düşer.
        </Alert>
      )}
      {folio.status === 'CLOSED' && (
        <Alert tone="info" title={`Folyo kapalı · ${formatDate(folio.closedAt)} · ${folio.closedBy ?? ''}`}>
          Kapalı folyoya kalem işlenmez. Geç gelen bir harcama için yetkili yeniden açabilir.
        </Alert>
      )}

      <Totals folio={folio} detail={detail} />

      {open && (canReceive || canRefund) && (
        <div className="flex flex-wrap items-center gap-2">
          {canReceive && (
            <Button icon="wallet" onClick={() => setDialog({ kind: 'payment' })}>Ödeme al</Button>
          )}
          {canRefund && (
            <span title={refundable !== null && Number(refundable) <= 0 ? 'Bu folyoda iade edilecek ödeme yok' : undefined}>
              <Button variant="outline" icon="rotateCcw" disabled={refundable === null || Number(refundable) <= 0} onClick={() => setDialog({ kind: 'refund' })}>
                İade
              </Button>
            </span>
          )}
          {Number(folio.balance) < 0 && (
            <span className="text-sm text-warning-ink">Misafirin {formatMoney(absolute(folio.balance), folio.currency)} alacağı var: iade edin ya da harcamalara saklayın.</span>
          )}
        </div>
      )}

      {open && canPost && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" icon="plus" onClick={() => setDialog({ kind: 'charge' })}>Harcama ekle</Button>
          <Button variant="outline" icon="arrowRight" disabled={selectedIds.length === 0} onClick={() => setDialog({ kind: 'transfer' })}>
            Aktar{selectedIds.length ? ` (${selectedIds.length})` : ''}
          </Button>
          <Button variant="outline" icon="layers" onClick={() => setDialog({ kind: 'split' })}>
            {selectedIds.length ? `Seçilenlerle yeni folyo (${selectedIds.length})` : 'Yeni folyo'}
          </Button>
          <Button variant="outline" icon="link" onClick={() => setDialog({ kind: 'merge' })}>Birleştir</Button>
          <Button variant="ghost" icon="pencil" onClick={() => setDialog({ kind: 'payer' })}>Ödeyen</Button>
          <span className="ml-auto" title={closeBlocked ?? undefined}>
            <Button variant="outline" icon="lock" disabled={Boolean(closeBlocked)} onClick={() => setDialog({ kind: 'close' })}>
              Folyoyu kapat
            </Button>
          </span>
        </div>
      )}
      {open && canPost && closeBlocked && <p className="-mt-3 text-xs text-ink-muted">Kapatılamaz: {closeBlocked}</p>}
      {folio.status === 'CLOSED' && canAdjust && (
        <div>
          <Button variant="outline" icon="rotateCcw" onClick={() => setDialog({ kind: 'reopen' })}>Yeniden aç</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-ink">Döküm</h2>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            aria-label="İptal edilenleri göster"
            checked={includeVoided}
            onChange={(event) => setIncludeVoided(event.target.checked)}
            className="size-4 accent-[var(--color-ink)]"
          />
          İptal edilenleri göster
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
        title={`${folio.name} kapatılsın mı?`}
        message={`Bakiye sıfır. Kapanınca bu folyoya kalem işlenmez${stay.status === 'CHECKED_OUT' ? '; fatura kesilebilir' : ''}. Yetkili yeniden açabilir.`}
        confirmLabel="Kapat"
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
  const tone = balanceTone(folio.balance);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Harcamalar" value={formatMoney(folio.chargesTotal, folio.currency)} />
        <Stat label="Ödenen" value={formatMoney(folio.paymentsTotal, folio.currency)} />
        <Stat
          label={Number(folio.balance) < 0 ? 'İade edilecek' : 'Bakiye'}
          value={formatMoney(String(folio.balance).replace('-', ''), folio.currency)}
          tone={tone}
        />
      </dl>
      <div className="rounded-item border border-line px-4 py-3 text-sm">
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Vergi özeti</p>
        {detail.isPending ? (
          <Spinner className="py-1" />
        ) : detail.isError ? (
          <p className="text-xs text-sec-strong">{detail.error.message}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-y-0.5">
            <dt className="text-ink-muted">Net</dt>
            <dd className="text-right tabular-nums">{formatMoney(detail.data.netTotal, folio.currency)}</dd>
            {detail.data.taxSummary.map((tax) => (
              <FragmentPair
                key={`${tax.name}-${tax.rate}-${tax.included}`}
                label={`${tax.name} ${formatPercent(tax.rate)}${tax.included ? '' : ' (eklenen)'}`}
                value={formatMoney(tax.amount, folio.currency)}
              />
            ))}
            {detail.data.taxSummary.length === 0 && <FragmentPair label="Vergi" value="—" />}
          </dl>
        )}
      </div>
    </div>
  );
}

/** @param {{ label: string, value: string, tone?: string }} props */
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
  if (!deposit) return null;
  const label = `${methodLabel(deposit.method === 'CARD_PREAUTH' ? 'CARD' : deposit.method)} · ${formatMoney(deposit.amount, currency)}${deposit.reference ? ` · ${deposit.reference}` : ''}`;
  if (deposit.recorded === null) {
    return (
      <Alert tone="info" title={`Kart provizyonu: ${formatMoney(deposit.amount, currency)}${deposit.reference ? ` (${deposit.reference})` : ''}`}>
        Provizyon ödeme değildir; bakiyeye girmez. Çıkışta tutarı kartla tahsil edip provizyonu kapatın.
      </Alert>
    );
  }
  if (deposit.recorded === 'POSTED') return null;
  if (deposit.recorded === 'PENDING') {
    return (
      <Alert tone="info" title="Giriş teminatı onay bekliyor">
        {label} — büyük ödeme eşiğini aştığı için ikinci bir yetkilinin onayını bekliyor; onaylanınca bakiyeye girer.
      </Alert>
    );
  }
  return (
    <Alert
      tone="warning"
      title="Girişte alınan teminat ödeme olarak işlenmedi"
      action={
        canRecord && (
          <Button size="sm" icon="wallet" onClick={onRecord} disabled={busy}>
            {busy ? 'İşleniyor…' : 'Teminatı işle'}
          </Button>
        )
      }
    >
      {label}. Folyo aktörü kapalı ya da henüz çalışmadı; beklemeden işleyebilirsiniz (ikinci kez işlenmez).
    </Alert>
  );
}
