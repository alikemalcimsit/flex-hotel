import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BOARD_TYPES, BOARD_TYPE_LABELS, closeWaitlistSchema, createWaitlistSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { addDaysIso, reservationKeys } from '../../lib/reservations.js';
import { RESERVATIONS_CHANNEL } from '../../lib/socket.js';
import { useHotelSettings, useHotelToday } from '../../lib/useHotel.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';
import { WAITLIST_STATUS_TONES, partyLabel, waitlistStatusLabel } from './reservationTheme.js';

const PAGE_SIZE = 25;
const OFFLINE_REFRESH_MS = 60_000;
const BOARD_OPTIONS = BOARD_TYPES.map((value) => ({ value, label: BOARD_TYPE_LABELS[value] }));

/**
 * Bekleme listesi (modül 4): yer yokken misafir listeye alınır. İptal,
 * gelmedi, tarih kısaltma ya da oda açılınca sistem kayıtları tarar; yer
 * açılan kayıt "Yer açıldı" olur ve rezervasyon yetkilisinin ziline düşer.
 * Personel misafiri arayıp tek tıkla rezervasyona çevirir (form kayıtla dolu
 * açılır; rezervasyon açılınca kayıt kapanır).
 *
 * Varsayılan görünüm açık kayıtlar (en yakın giriş önce); "Kapananlar"
 * çevrilen, vazgeçilen ve tarihi geçenleri gösterir. Zilden gelen bağlantı
 * (`?kayit=`) ilgili satırı vurgular.
 */
export function WaitlistTab() {
  const can = useCan();
  const canManage = can(PERMISSIONS.RESERVATIONS_MANAGE);
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const highlight = params.get('kayit');
  const showClosed = params.get('durum') === 'kapali';
  const page = Math.max(1, Number(params.get('sayfa')) || 1);
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(null);

  const setParam = useCallback(
    (changes) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === undefined || value === '') next.delete(key);
          else next.set(key, String(value));
        }
        return next;
      }),
    [setParams],
  );

  const { isLive } = useLiveChannel(RESERVATIONS_CHANNEL, { queryKeys: [reservationKeys.waitlists] });

  const filters = { open: !showClosed, page };
  const query = useQuery({
    queryKey: reservationKeys.waitlist(filters),
    queryFn: () => api(withQuery('/reservations/waitlist', { open: String(!showClosed), page, pageSize: PAGE_SIZE })),
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  const columns = [
    {
      key: 'name',
      header: 'Misafir',
      render: (row) => (
        <span className={`flex flex-col ${row.id === highlight ? 'font-bold' : ''}`}>
          <span className="font-semibold">{row.name}</span>
          <span className="text-xs text-ink-muted">{[row.phone, row.email].filter(Boolean).join(' · ') || '—'}</span>
        </span>
      ),
    },
    {
      key: 'stay',
      header: 'İstenen',
      render: (row) => (
        <span className="flex flex-col">
          <span className="whitespace-nowrap">{formatDate(row.checkIn)} – {formatDate(row.checkOut)} ({row.nights} gece)</span>
          <span className="text-xs text-ink-muted">{row.roomType.code} · {partyLabel(row.adults, row.children)} · {row.boardType}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col gap-1">
          <Badge tone={WAITLIST_STATUS_TONES[row.status]}>{waitlistStatusLabel(row.status)}</Badge>
          {row.reservation && (
            <Link to={`/rezervasyonlar/${row.reservation.id}`} className="font-mono text-xs text-info-ink hover:underline">
              {row.reservation.confirmationCode}
            </Link>
          )}
          {row.closeReason && <span className="text-xs text-ink-muted">{row.closeReason}</span>}
        </span>
      ),
    },
    { key: 'notes', header: 'Not', render: (row) => <span className="line-clamp-2 text-xs text-ink-muted">{row.notes ?? '—'}</span> },
    { key: 'created', header: 'Eklenen', render: (row) => <span className="text-xs text-ink-muted">{formatDate(row.createdAt)} · {row.createdBy}</span> },
  ];

  const available = query.data?.meta?.available ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {[
          [false, 'Açık kayıtlar'],
          [true, 'Kapananlar'],
        ].map(([closed, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={showClosed === closed}
            onClick={() => setParam({ durum: closed ? 'kapali' : null, sayfa: null })}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${
              showClosed === closed ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'
            }`}
          >
            {label}
          </button>
        ))}
        <Badge tone={isLive ? 'success' : 'warning'} className="ml-2">{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
        {canManage && (
          <Button className="ml-auto" icon="plus" onClick={() => setAdding(true)}>
            Listeye al
          </Button>
        )}
      </div>

      {!showClosed && available > 0 && (
        <Alert tone="success" title={`${available} kayıt için yer açıldı`}>
          Misafiri arayıp "Rezervasyona çevir" ile açın. Yer yeniden dolarsa kayıt kendiliğinden "yer bekliyor"a döner.
        </Alert>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        onPageChange={(next) => setParam({ sayfa: next })}
        emptyTitle={showClosed ? 'Kapanmış kayıt yok' : 'Bekleme listesi boş'}
        emptyHint={showClosed ? undefined : 'Yer olmadığında yeni rezervasyon formundan ya da "Listeye al" ile misafiri ekleyin.'}
        rowActions={
          canManage && !showClosed
            ? (row) => (
                <span className="flex justify-end gap-2">
                  <Link to={`/rezervasyonlar/yeni?bekleme=${row.id}`}>
                    <Button size="sm" variant={row.status === 'AVAILABLE' ? 'primary' : 'outline'} icon="bookOpen">
                      Rezervasyona çevir
                    </Button>
                  </Link>
                  <Button size="sm" variant="ghost" icon="close" onClick={() => setClosing(row)}>
                    Kapat
                  </Button>
                </span>
              )
            : undefined
        }
      />

      {adding && (
        <AddWaitlistDialog
          onClose={() => setAdding(false)}
          onAdded={(entry) => {
            queryClient.invalidateQueries({ queryKey: reservationKeys.waitlists });
            setAdding(false);
            setParam({ kayit: entry.id, durum: null, sayfa: null });
          }}
        />
      )}
      {closing && (
        <CloseWaitlistDialog
          entry={closing}
          onClose={() => setClosing(null)}
          onClosed={() => {
            queryClient.invalidateQueries({ queryKey: reservationKeys.waitlists });
            setClosing(null);
          }}
        />
      )}
    </div>
  );
}

/** @param {{ onClose: () => void, onAdded: (entry: object) => void }} props */
function AddWaitlistDialog({ onClose, onAdded }) {
  const { today } = useHotelToday();
  const hotel = useHotelSettings().data;
  const { options: roomTypeOptions } = useRoomTypes();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    roomTypeId: '',
    checkIn: today,
    checkOut: addDaysIso(today, 1),
    adults: '2',
    children: '0',
    boardType: hotel?.defaultBoardType ?? 'BB',
    notes: '',
  });
  const [errors, setErrors] = useState({});
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const mutation = useMutation({
    mutationFn: (body) => apiPost('/reservations/waitlist', body),
    onSuccess: (entry) => {
      toastSuccess(entry.status === 'AVAILABLE' ? 'Listeye alındı — bu tarihlerde şu an yer var, doğrudan rezervasyon açabilirsiniz' : 'Listeye alındı; yer açılınca zil haber verecek');
      onAdded(entry);
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      toastError(error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = { ...form, notes: form.notes || null };
    const result = validateWith(createWaitlistSchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  const busy = mutation.isPending;
  return (
    <Modal
      open
      size="lg"
      title="Bekleme listesine al"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="add-waitlist-form" icon="check" disabled={busy}>{busy ? 'Ekleniyor…' : 'Listeye al'}</Button>
        </>
      }
    >
      <form id="add-waitlist-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Ad" value={form.firstName} onChange={set('firstName')} error={errors.firstName} disabled={busy} />
          <Input label="Soyad" value={form.lastName} onChange={set('lastName')} error={errors.lastName} disabled={busy} />
          <Input label="Telefon" type="tel" value={form.phone} onChange={set('phone')} error={errors.phone} disabled={busy} />
          <Input label="E-posta" type="email" value={form.email} onChange={set('email')} error={errors.email} disabled={busy} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Input label="Giriş" type="date" min={today} value={form.checkIn} onChange={set('checkIn')} error={errors.checkIn} disabled={busy} className="w-full sm:w-44" />
          <Input label="Çıkış" type="date" min={addDaysIso(form.checkIn || today, 1)} value={form.checkOut} onChange={set('checkOut')} error={errors.checkOut} disabled={busy} className="w-full sm:w-44" />
          <Select label="Oda tipi" value={form.roomTypeId} onChange={set('roomTypeId')} options={[{ value: '', label: 'Seçin' }, ...roomTypeOptions]} error={errors.roomTypeId} disabled={busy} className="w-full sm:w-64" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Input label="Yetişkin" type="number" min={1} max={20} value={form.adults} onChange={set('adults')} error={errors.adults} disabled={busy} className="w-28" />
          <Input label="Çocuk" type="number" min={0} max={20} value={form.children} onChange={set('children')} error={errors.children} disabled={busy} className="w-28" />
          <Select label="Pansiyon" value={form.boardType} onChange={set('boardType')} options={BOARD_OPTIONS} disabled={busy} className="w-full sm:w-64" />
        </div>
        <Textarea label="Not" rows={2} maxLength={2000} value={form.notes} onChange={set('notes')} disabled={busy} />
      </form>
    </Modal>
  );
}

/** @param {{ entry: object, onClose: () => void, onClosed: () => void }} props */
function CloseWaitlistDialog({ entry, onClose, onClosed }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/reservations/waitlist/${entry.id}/close`, body),
    onSuccess: () => {
      toastSuccess('Kayıt kapatıldı');
      onClosed();
    },
    onError: (failure) => {
      toastError(failure.message);
      if (failure.code === 'WAITLIST_CLOSED') onClosed();
    },
  });

  function submit(event) {
    event.preventDefault();
    const result = validateWith(closeWaitlistSchema, { reason });
    if (!result.ok) {
      setError(result.errors.reason ?? 'Sebep yazın');
      return;
    }
    mutation.mutate(result.data);
  }

  const busy = mutation.isPending;
  return (
    <Modal
      open
      size="sm"
      title={`Kaydı kapat — ${entry.name}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="close-waitlist-form" variant="danger" icon="close" disabled={busy}>{busy ? 'Kapatılıyor…' : 'Kapat'}</Button>
        </>
      }
    >
      <form id="close-waitlist-form" onSubmit={submit} noValidate>
        <Textarea label="Sebep" rows={2} maxLength={300} placeholder="Misafir vazgeçti, başka otelde kaldı…" value={reason} onChange={(e) => setReason(e.target.value)} error={error} disabled={busy} autoFocus />
      </form>
    </Modal>
  );
}
