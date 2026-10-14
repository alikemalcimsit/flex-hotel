import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CHANNEL_BOOKING_STATES,
  CHANNEL_BOOKING_STATE_LABELS,
  CHANNEL_BOOKING_STATUS_LABELS,
  MAX_CHANNEL_NOTE_LENGTH,
  RESERVATION_STATUS_LABELS,
  resolveChannelBookingSchema,
} from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { BOOKING_STATE_TONES, BOOKING_STATUS_TONES, channelKeys, useChannelTime } from '../../lib/channelManager.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { RESERVATION_STATUS_TONES } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useChannelOutlet } from './ChannelPage.jsx';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const STATE_OPTIONS = CHANNEL_BOOKING_STATES.map((value) => ({ value, label: CHANNEL_BOOKING_STATE_LABELS[value] }));

/**
 * Kanal rezervasyonları (modül 33): kanaldan gelen her rezervasyon (OTA ya da
 * takvim kaydı), bizdeki karşılığı (rezervasyon kodları) ve işlenme durumu.
 * "Doğrulanmalı" (iCal fiyatı, para birimi farkı) ve "elle işlenmeli"
 * (eşleşmeyen plan, içerideki misafir) kayıtlar, gereği yapıldıktan sonra
 * notla kapatılır.
 */
export function ChannelBookingsTab() {
  const { channel } = useChannelOutlet();
  const can = useCan();
  const canManage = can(PERMISSIONS.CHANNEL_MANAGER_MANAGE);
  const canOpenReservation = can(PERMISSIONS.RESERVATIONS_VIEW);
  const formatDateTime = useChannelTime();
  const [state, setState] = useState(channel.bookingCounts.ATTENTION ? 'ATTENTION' : channel.bookingCounts.REVIEW ? 'REVIEW' : '');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const filters = { state, search, page };
  const list = useQuery({
    queryKey: channelKeys.bookings(channel.id, filters),
    queryFn: () => api(withQuery(`/channel-manager/${channel.id}/bookings`, { state: state || undefined, search: search || undefined, page, pageSize: PAGE_SIZE })),
    placeholderData: keepPreviousData,
  });

  const columns = [
    {
      key: 'code',
      header: 'Kanal rezervasyonu',
      render: (row) => (
        <span className="block text-xs">
          <span className="block font-mono font-bold text-ink">{row.externalCode ?? '—'}</span>
          <span className="block text-ink-muted">{row.otaName ?? channel.name} · {formatDateTime(row.createdAt)}</span>
        </span>
      ),
    },
    { key: 'guest', header: 'Misafir', render: (row) => <span className="font-semibold">{row.guestName ?? '—'}</span> },
    {
      key: 'stay',
      header: 'Konaklama',
      className: 'whitespace-nowrap text-xs',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{formatDate(row.checkIn)} – {formatDate(row.checkOut)}</span>
          <span className="block text-ink-muted">{row.roomCount} oda{row.amount ? ` · ${formatMoney(row.amount, row.currency ?? '')}` : ''}</span>
        </span>
      ),
    },
    {
      key: 'reservations',
      header: 'Bizde',
      render: (row) =>
        row.reservations.length === 0 ? (
          <span className="text-xs text-ink-muted">Açılmadı</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {row.reservations.map((reservation) => (
              <li key={reservation.id} className="flex flex-wrap items-center gap-1.5">
                {canOpenReservation ? (
                  <Link to={`/rezervasyonlar/${reservation.id}`} className="font-mono text-xs font-bold text-ink hover:underline">{reservation.confirmationCode}</Link>
                ) : (
                  <span className="font-mono text-xs font-bold">{reservation.confirmationCode}</span>
                )}
                <Badge tone={RESERVATION_STATUS_TONES[reservation.status]}>{RESERVATION_STATUS_LABELS[reservation.status]}</Badge>
              </li>
            ))}
          </ul>
        ),
    },
    {
      key: 'state',
      header: 'Durum',
      render: (row) => (
        <span className="flex max-w-xs flex-col items-start gap-1">
          <span className="flex flex-wrap gap-1">
            <Badge tone={BOOKING_STATE_TONES[row.state]}>{CHANNEL_BOOKING_STATE_LABELS[row.state]}</Badge>
            {row.status === 'CANCELLED' && <Badge tone={BOOKING_STATUS_TONES.CANCELLED}>{CHANNEL_BOOKING_STATUS_LABELS.CANCELLED}</Badge>}
          </span>
          {row.stateReason && ['REVIEW', 'ATTENTION'].includes(row.state) && <span className="text-xs text-ink-soft">{row.stateReason}</span>}
          {row.resolutionNote && <span className="text-xs text-ink-muted">Kapatıldı: {row.resolutionNote} ({row.resolvedBy})</span>}
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (row) =>
              ['REVIEW', 'ATTENTION'].includes(row.state) && (
                <Button size="sm" variant="outline" icon="check" onClick={() => setResolving(row)}>
                  Tamam
                </Button>
              ),
          },
        ]
      : []),
  ];

  const filtered = Boolean(state || search);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <ChoiceChips label="Durum" options={STATE_OPTIONS} value={state} onChange={(value) => { setState(value); setPage(1); }} />
        <Input label="Ara" name="channel-booking-search" placeholder="Kanal rezervasyon kodu ya da misafir adı" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="sm:max-w-md" />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Süzgece uyan kanal rezervasyonu yok' : 'Kanaldan henüz rezervasyon gelmedi'}
      />
      {resolving && <ResolveDialog channel={channel} booking={resolving} onClose={() => setResolving(null)} />}
    </div>
  );
}

/**
 * "Doğrulanmalı / elle işlenmeli" kaydı, personel gereğini yaptıktan sonra
 * notla kapatır (ne yapıldığı denetim izine geçer).
 * @param {{ channel: { id: string }, booking: any, onClose: () => void }} props
 */
function ResolveDialog({ channel, booking, onClose }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const resolve = useMutation({
    mutationFn: (payload) => apiPost(`/channel-manager/${channel.id}/bookings/${booking.id}/resolve`, payload),
    onSuccess: () => {
      toastSuccess('Kayıt kapatıldı');
      queryClient.invalidateQueries({ queryKey: channelKeys.all });
      onClose();
    },
    onError: (failure) => {
      setError(failure.fields?.note ?? null);
      toastError(failure.message);
    },
  });
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(resolveChannelBookingSchema, { note });
    if (!checked.ok) {
      setError(checked.errors.note);
      return;
    }
    resolve.mutate(checked.data);
  }
  const busy = resolve.isPending;
  return (
    <Modal
      open
      title={`${booking.externalCode ?? 'Kanal rezervasyonu'} — kapat`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="resolve-form" icon="check" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kapat'}</Button>
        </>
      }
    >
      <form id="resolve-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">{booking.stateReason}</p>
        <Textarea label="Ne yapıldı" name="resolve-note" value={note} onChange={(event) => setNote(event.target.value)} error={error ?? undefined} maxLength={MAX_CHANNEL_NOTE_LENGTH} placeholder="Ör. tutar Airbnb ödemesiyle güncellendi" disabled={busy} />
      </form>
    </Modal>
  );
}
