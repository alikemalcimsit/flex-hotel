import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, EmptyState, Icon, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { reservationKeys } from '../../lib/reservations.js';
import { RESERVATIONS_CHANNEL } from '../../lib/socket.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { CancelReservationDialog } from './CancelReservationDialog.jsx';
import { EditReservationDialog } from './EditReservationDialog.jsx';
import { NoShowDialog } from './NoShowDialog.jsx';
import { RESERVATION_STATUS_TONES, boardLong, errorHint, partyLabel, sourceLabel, statusLabel } from './reservationTheme.js';

/** Denetim izindeki alan adlarının ekrandaki karşılığı. */
const FIELD_LABELS = Object.freeze({
  status: 'Durum',
  checkIn: 'Giriş',
  checkOut: 'Çıkış',
  roomTypeId: 'Oda tipi',
  roomId: 'Oda',
  adults: 'Yetişkin',
  children: 'Çocuk',
  boardType: 'Pansiyon',
  totalPrice: 'Tutar',
  priceMode: 'Fiyat türü',
  priceNote: 'Fiyat gerekçesi',
  notes: 'Not',
  cancelReason: 'İptal sebebi',
  cancellationFee: 'İptal ücreti',
  noShowFee: 'Gelmedi ücreti',
  roomNumber: 'Oda',
});

/**
 * Rezervasyon detayı (modül 4): bilgiler, gece gece fiyat, durum geçmişi ve
 * işlemler. İşlem düğmeleri sunucunun söylediği izinli işlemlerden
 * (`actions`) çizilir; aynı kural sunucuda yazmadan önce yeniden denetlenir.
 *
 * Başka personel değiştirince (oda atandı, iptal edildi) sayfa canlı tazelenir.
 */
export function ReservationDetailPage() {
  const { reservationId } = useParams();
  const queryClient = useQueryClient();
  const can = useCan();
  const canManage = can(PERMISSIONS.RESERVATIONS_MANAGE);
  const { timeZone } = useHotelToday();
  /** `edit` | `cancel` | `cancelGroup` | `noShow` | `confirm` | `reinstate` */
  const [dialog, setDialog] = useState(null);

  useLiveChannel(RESERVATIONS_CHANNEL, {
    queryKeys: (payload) =>
      !payload || payload.reservationId === reservationId || (payload.reservationId && detail?.groupMembers?.some((member) => member.id === payload.reservationId))
        ? [reservationKeys.detail(reservationId), reservationKeys.history(reservationId)]
        : [],
  });

  const query = useQuery({
    queryKey: reservationKeys.detail(reservationId),
    queryFn: () => api(`/reservations/${reservationId}`),
  });
  const detail = query.data;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: reservationKeys.detail(reservationId) });
    queryClient.invalidateQueries({ queryKey: reservationKeys.history(reservationId) });
    queryClient.invalidateQueries({ queryKey: reservationKeys.lists });
  };

  /** Ortak hata ele alma: eski sürümse sayfayı tazeler. */
  const onActionError = (error) => {
    const hint = errorHint(error.code);
    toastError(hint ? `${error.message} ${hint}` : error.message);
    if (error.code === 'STALE_WRITE' || error.code === 'INVALID_STATUS') refresh();
  };

  const simpleAction = useMutation({
    mutationFn: ({ path }) => apiPost(`/reservations/${reservationId}/${path}`, { expectedUpdatedAt: detail.updatedAt }),
    onSuccess: (updated, { success }) => {
      queryClient.setQueryData(reservationKeys.detail(reservationId), updated);
      refresh();
      setDialog(null);
      toastSuccess(success);
    },
    onError: (error) => {
      setDialog(null);
      onActionError(error);
    },
  });

  if (query.isPending) {
    return (
      <Card>
        <Spinner label="Rezervasyon yükleniyor…" className="py-10" />
      </Card>
    );
  }
  if (query.isError) {
    return (
      <Alert
        tone="danger"
        title={query.error.code === 'NOT_FOUND' ? 'Rezervasyon bulunamadı' : 'Rezervasyon yüklenemedi'}
        action={
          query.error.code === 'NOT_FOUND' ? (
            <Link to="/rezervasyonlar/liste">
              <Button variant="outline" size="sm">Listeye dön</Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>Tekrar dene</Button>
          )
        }
      >
        {query.error.message}
      </Alert>
    );
  }

  const actions = new Set(canManage ? detail.actions : []);
  const currency = detail.currency;
  const closed = ['CANCELLED', 'NO_SHOW'].includes(detail.status);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-card bg-surface p-6 shadow-card">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-bold text-ink">{detail.confirmationCode}</span>
            <Badge tone={RESERVATION_STATUS_TONES[detail.status]}>{statusLabel(detail.status)}</Badge>
            {detail.group && <Badge tone="violet">Grup: {detail.group.name}</Badge>}
            {detail.fromWaitlist && <Badge tone="neutral">Bekleme listesinden</Badge>}
          </span>
          <span className="text-xl font-bold text-ink">{detail.guest?.name}</span>
          <span className="text-sm text-ink-muted">
            {formatDate(detail.checkIn)} – {formatDate(detail.checkOut)} · {detail.nights} gece · {detail.roomType.name}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.has('confirm') && <Button icon="check" onClick={() => setDialog('confirm')}>Onayla</Button>}
          {actions.has('edit') && <Button variant="outline" icon="pencil" onClick={() => setDialog('edit')}>Düzenle</Button>}
          {actions.has('noShow') && <Button variant="outline" icon="alertCircle" onClick={() => setDialog('noShow')}>Gelmedi</Button>}
          {actions.has('cancel') && <Button variant="dangerSoft" icon="close" onClick={() => setDialog('cancel')}>İptal et</Button>}
          {actions.has('reinstate') && <Button variant="outline" icon="rotateCcw" onClick={() => setDialog('reinstate')}>Geri al</Button>}
        </div>
      </div>

      {closed && (
        <Alert tone={detail.status === 'CANCELLED' ? 'danger' : 'warning'} title={detail.status === 'CANCELLED' ? 'İptal edildi' : 'Misafir gelmedi'}>
          {detail.status === 'CANCELLED' ? (
            <>
              {formatDateTime(detail.cancelledAt, timeZone)} · {detail.cancelledBy}. Sebep: {detail.cancelReason}. İptal ücreti:{' '}
              {formatMoney(detail.cancellationFee ?? '0', currency)}.
            </>
          ) : (
            <>
              {formatDateTime(detail.noShowAt, timeZone)} işaretlendi. Gelmedi ücreti: {formatMoney(detail.noShowFee ?? '0', currency)}.
            </>
          )}{' '}
          Ücretin tahsilatı folyo ve ödeme modülünde yapılır.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-5">
          <Card title="Konaklama">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Giriş">{formatDate(detail.checkIn)}</Field>
              <Field label="Çıkış">{formatDate(detail.checkOut)}</Field>
              <Field label="Oda tipi">{detail.roomType.code} — {detail.roomType.name}</Field>
              <Field label="Oda">
                {detail.room ? (
                  <span className="font-semibold">{detail.room.number}</span>
                ) : (
                  <span className="text-ink-muted">Atanmadı</span>
                )}{' '}
                <Link to={`/oda-plani?from=${detail.checkIn}`} className="ml-2 text-xs font-semibold text-info-ink underline-offset-2 hover:underline">
                  Oda planında gör
                </Link>
              </Field>
              <Field label="Kişi">{partyLabel(detail.adults, detail.children)}</Field>
              <Field label="Pansiyon">{boardLong(detail.boardType)}</Field>
              <Field label="Kaynak">{sourceLabel(detail.source)}</Field>
              <Field label="Açan">{detail.createdBy} · {formatDateTime(detail.createdAt, timeZone)}</Field>
              {detail.confirmedAt && <Field label="Onaylandı">{formatDateTime(detail.confirmedAt, timeZone)}</Field>}
              {detail.roomSince && <Field label="Bu odada">{formatDate(detail.roomSince)} tarihinden beri</Field>}
            </dl>
            {detail.notes && (
              <p className="mt-4 whitespace-pre-wrap rounded-item bg-canvas p-3 text-sm text-ink">{detail.notes}</p>
            )}
          </Card>

          <Card title="Misafir">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Ad soyad">{detail.guest.name}</Field>
              <Field label="Uyruk">{detail.guest.nationality ?? '—'}</Field>
              <Field label="Telefon">{detail.guest.phone ?? '—'}</Field>
              <Field label="E-posta">{detail.guest.email ?? '—'}</Field>
            </dl>
          </Card>

          {detail.groupMembers.length > 0 && (
            <Card
              title={`Grup: ${detail.group.name}`}
              description={`Grup kodu ${detail.group.code} · ${detail.groupMembers.length} oda`}
              actions={
                canManage && detail.groupMembers.some((member) => ['PENDING', 'CONFIRMED'].includes(member.status)) ? (
                  <Button size="sm" variant="dangerSoft" icon="close" onClick={() => setDialog('cancelGroup')}>
                    Grubu iptal et
                  </Button>
                ) : null
              }
            >
              <ul className="divide-y divide-line text-sm">
                {detail.groupMembers.map((member) => (
                  <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link to={`/rezervasyonlar/${member.id}`} className={`font-mono text-xs font-bold underline-offset-2 hover:underline ${member.id === detail.id ? 'text-ink' : 'text-info-ink'}`}>
                      {member.confirmationCode}
                    </Link>
                    <span>{member.roomType.code}{member.roomNumber ? ` · ${member.roomNumber}` : ''}</span>
                    <span className="text-xs text-ink-muted">{partyLabel(member.adults, member.children)}</span>
                    <span className="font-semibold">{formatMoney(member.totalPrice, currency)}</span>
                    <Badge tone={RESERVATION_STATUS_TONES[member.status]}>{member.statusLabel}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <History reservationId={reservationId} timeZone={timeZone} currency={currency} />
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Fiyat">
            <table className="w-full text-sm">
              <caption className="sr-only">Gece gece fiyat</caption>
              <tbody className="divide-y divide-line">
                {detail.nightlyRates.map((night) => (
                  <tr key={night.date}>
                    <td className="py-1.5">{formatDate(night.date)}</td>
                    <td className="py-1.5 text-xs text-ink-muted">
                      {night.seasonName ? `${night.seasonName} ×${night.multiplier.replace('.', ',')}` : night.multiplier === null ? 'elle / aktarılan' : ''}
                    </td>
                    <td className="py-1.5 text-right font-semibold">{formatMoney(night.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
              <span className="font-semibold">Toplam</span>
              <span className="text-lg font-bold">{formatMoney(detail.totalPrice, currency)}</span>
            </div>
            {detail.priceMode === 'MANUAL' && (
              <p className="mt-1 text-xs text-warning-ink">Elle girilen fiyat · {detail.priceNote}</p>
            )}
            {detail.taxes.included.map((tax) => (
              <p key={tax.name} className="text-xs text-ink-muted">%{tax.rate} {tax.name} dahil ({formatMoney(tax.amount, currency)})</p>
            ))}
            {detail.taxes.added.map((tax) => (
              <p key={tax.name} className="text-xs text-ink-muted">+ %{tax.rate} {tax.name}: {formatMoney(tax.amount, currency)} (folyoda eklenir)</p>
            ))}
            {detail.cancellationPreview && (
              <p className="mt-2 text-xs text-ink-muted">
                {detail.cancellationPreview.freeUntil
                  ? detail.cancellationPreview.penaltyApplies
                    ? `Şimdi iptal edilirse ${formatMoney(detail.cancellationPreview.fee, currency)} ceza uygulanır.`
                    : `${formatDate(detail.cancellationPreview.freeUntil)} tarihine kadar ücretsiz iptal.`
                  : 'İptal cezası yok.'}
              </p>
            )}
          </Card>
        </div>
      </div>

      {dialog === 'edit' && (
        <EditReservationDialog
          reservation={detail}
          onClose={() => setDialog(null)}
          onSaved={(updated) => {
            queryClient.setQueryData(reservationKeys.detail(reservationId), updated);
            refresh();
            setDialog(null);
          }}
          onError={onActionError}
        />
      )}
      {(dialog === 'cancel' || dialog === 'cancelGroup') && (
        <CancelReservationDialog
          reservation={detail}
          group={dialog === 'cancelGroup'}
          onClose={() => setDialog(null)}
          onDone={() => {
            refresh();
            setDialog(null);
          }}
          onError={onActionError}
        />
      )}
      {dialog === 'noShow' && (
        <NoShowDialog
          reservation={detail}
          onClose={() => setDialog(null)}
          onDone={(updated) => {
            queryClient.setQueryData(reservationKeys.detail(reservationId), updated);
            refresh();
            setDialog(null);
          }}
          onError={onActionError}
        />
      )}
      <ConfirmDialog
        open={dialog === 'confirm'}
        title="Rezervasyonu onayla"
        message="Opsiyonlu rezervasyon kesinleşir ve misafire onay bildirimi gönderilir."
        confirmLabel="Onayla"
        confirmVariant="primary"
        confirmIcon="check"
        isPending={simpleAction.isPending}
        onConfirm={() => simpleAction.mutate({ path: 'confirm', success: 'Rezervasyon onaylandı' })}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'reinstate'}
        title="İptali / gelmediyi geri al"
        message="Rezervasyon yeniden yer tutar (müsaitlik denetlenir). Eski odası bu arada başkasına verildiyse oda ataması kaldırılır; alınmış ücret bilgisi temizlenir."
        confirmLabel="Geri al"
        confirmVariant="primary"
        confirmIcon="rotateCcw"
        isPending={simpleAction.isPending}
        onConfirm={() => simpleAction.mutate({ path: 'reinstate', success: 'Rezervasyon geri alındı' })}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

/** @param {{ label: string, children: React.ReactNode }} props */
function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/**
 * Durum geçmişi (denetim izi), en yeni önce, "daha eski" ile.
 * @param {{ reservationId: string, timeZone: string, currency: string }} props
 */
function History({ reservationId, timeZone, currency }) {
  const query = useInfiniteQuery({
    queryKey: reservationKeys.history(reservationId),
    queryFn: ({ pageParam }) => api(withQuery(`/reservations/${reservationId}/history`, { cursor: pageParam })),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card title="Geçmiş">
      {query.isPending && <Spinner className="py-6" />}
      {query.isError && (
        <Alert tone="danger" title="Geçmiş yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => query.refetch()}>Tekrar dene</Button>}>
          {query.error.message}
        </Alert>
      )}
      {query.data && items.length === 0 && <EmptyState icon="clock" title="Kayıt yok" />}
      <ol className="flex flex-col gap-3">
        {items.map((entry) => (
          <li key={entry.id} className="flex gap-3">
            <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-canvas text-ink-muted">
              <Icon name={entry.action === 'CREATE' ? 'plus' : 'pencil'} className="size-3.5" />
            </span>
            <span className="flex flex-col text-sm">
              <span className="font-semibold text-ink">{describeEntry(entry, currency)}</span>
              <span className="text-xs text-ink-muted">{entry.actor} · {formatDateTime(entry.at, timeZone)}</span>
            </span>
          </li>
        ))}
      </ol>
      {query.hasNextPage && (
        <Button className="mt-3" variant="outline" size="sm" icon="arrowDown" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Yükleniyor…' : 'Daha eski'}
        </Button>
      )}
    </Card>
  );
}

/**
 * @param {{ action: string, before: any, after: any, changedFields: string[] }} entry
 * @param {string} currency
 */
function describeEntry(entry, currency) {
  if (entry.action === 'CREATE') return `Rezervasyon açıldı (${statusLabel(entry.after?.status)})`;
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  if (before.status && after.status && before.status !== after.status) {
    const fee = after.status === 'CANCELLED' ? after.cancellationFee : after.status === 'NO_SHOW' ? after.noShowFee : null;
    return `Durum: ${statusLabel(before.status)} → ${statusLabel(after.status)}${fee ? ` · ücret ${formatMoney(fee, currency)}` : ''}${after.feeWaived ? ' (ücretten vazgeçildi)' : ''}`;
  }
  const show = (field, value) => {
    if (value === null || value === undefined) return '—';
    if (field === 'checkIn' || field === 'checkOut') return formatDate(value);
    if (field === 'totalPrice') return formatMoney(value, currency);
    return String(value);
  };
  const fields = entry.changedFields.length ? entry.changedFields : Object.keys(after).filter((key) => key in FIELD_LABELS);
  const parts = fields
    .filter((field) => FIELD_LABELS[field] && !['roomTypeId', 'roomId', 'roomNumber'].includes(field))
    .map((field) => `${FIELD_LABELS[field]}: ${show(field, before[field])} → ${show(field, after[field])}`);
  if (fields.includes('roomTypeId')) parts.push('Oda tipi değişti');
  if (fields.includes('roomId') || 'roomNumber' in after) {
    parts.push(after.roomNumber ? `Oda: ${after.roomNumber}` : 'Oda ataması kaldırıldı');
  }
  return parts.length ? parts.join(' · ') : 'Güncellendi';
}
