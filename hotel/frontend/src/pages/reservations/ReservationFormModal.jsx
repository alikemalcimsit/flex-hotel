import { useMemo, useState } from 'react';
import {
  BOARD_TYPES,
  BOARD_TYPE_LABELS,
  reservationInputSchema,
  updateReservationSchema,
  waitingListInputSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { useBookableRoomTypes, useGuestSearch, useQuote, useReservationActions } from './useReservations.js';

const BOARD_OPTIONS = BOARD_TYPES.map((value) => ({ value, label: BOARD_TYPE_LABELS[value] ?? value }));

function emptyForm(roomTypeId = '') {
  return {
    guestId: null,
    guestName: '',
    guestPhone: '',
    guestEmail: '',
    roomTypeId,
    checkIn: '',
    checkOut: '',
    adults: '2',
    children: '0',
    boardType: 'BB',
    notes: '',
  };
}

/**
 * Yeni / düzenle rezervasyon formu. Fiyat sunucudan önizlenir (`/quote`);
 * seçilen tipte yer yoksa "Bekleyen listeye ekle" öne çıkar.
 *
 * @param {{ reservation?: object, onClose: () => void }} props
 */
export function ReservationFormModal({ reservation, onClose }) {
  const isEdit = Boolean(reservation?.id);
  const roomTypesQuery = useBookableRoomTypes();
  const actions = useReservationActions();

  const [form, setForm] = useState(() =>
    reservation
      ? {
          ...emptyForm(reservation.roomTypeId),
          guestName: reservation.guestName ?? '',
          checkIn: reservation.checkIn ?? '',
          checkOut: reservation.checkOut ?? '',
          adults: String(reservation.adults ?? '2'),
          children: String(reservation.children ?? '0'),
          boardType: reservation.boardType ?? 'BB',
          notes: reservation.notes ?? '',
        }
      : emptyForm(),
  );
  const [errors, setErrors] = useState({});
  const [guestTerm, setGuestTerm] = useState('');

  const roomTypeOptions = useMemo(
    () => [
      { value: '', label: 'Oda tipi seçin…' },
      ...(roomTypesQuery.data ?? []).map((type) => ({ value: type.id, label: `${type.name} (${type.code})` })),
    ],
    [roomTypesQuery.data],
  );

  const quote = useQuote({ roomTypeId: form.roomTypeId, checkIn: form.checkIn, checkOut: form.checkOut });
  const guestSearch = useGuestSearch(isEdit ? '' : guestTerm);
  const noAvailability = quote.data && quote.data.available < 1;
  const isPending = actions.create.isPending || actions.update.isPending || actions.addWaiting.isPending;

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const pickGuest = (guest) => {
    setForm((current) => ({
      ...current,
      guestId: guest.id,
      guestName: guest.name,
      guestPhone: guest.phone ?? '',
      guestEmail: guest.email ?? '',
    }));
    setGuestTerm('');
  };

  function buildPayload(schema) {
    const base = {
      roomTypeId: form.roomTypeId,
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      adults: form.adults,
      children: form.children,
      boardType: form.boardType,
      notes: form.notes || null,
    };
    const values = isEdit
      ? { ...base, expectedUpdatedAt: reservation.updatedAt }
      : {
          ...base,
          guest: {
            id: form.guestId ?? undefined,
            name: form.guestName,
            phone: form.guestPhone || undefined,
            email: form.guestEmail || undefined,
          },
        };
    return validateWith(schema, values);
  }

  function submit(schema, mutation, extra) {
    const result = buildPayload(schema);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(extra ? extra(result.data) : result.data, { onSuccess: onClose });
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (isEdit) submit(updateReservationSchema, actions.update, (body) => ({ id: reservation.id, body }));
    else submit(reservationInputSchema, actions.create);
  }

  const title = isEdit ? 'Rezervasyonu düzenle' : 'Yeni rezervasyon';

  return (
    <Modal
      open
      title={title}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          {!isEdit && noAvailability && (
            <Button
              variant="outline"
              icon="clock"
              disabled={isPending}
              onClick={() => submit(waitingListInputSchema, actions.addWaiting)}
            >
              Bekleyen listeye ekle
            </Button>
          )}
          <Button type="submit" form="reservation-form" icon="check" disabled={isPending || (!isEdit && noAvailability)}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="reservation-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
        {!isEdit && (
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-1 text-sm font-bold text-ink">Misafir</legend>
            <div className="relative sm:col-span-3">
              <Input
                label="Ad soyad"
                name="guestName"
                value={form.guestName}
                onChange={(event) => {
                  setField('guestName')(event);
                  setForm((current) => ({ ...current, guestId: null }));
                  setGuestTerm(event.target.value);
                }}
                error={errors['guest.name'] ?? errors.guestName}
                placeholder="Kayıtlı misafiri aramak için yazın…"
                autoComplete="off"
              />
              {guestTerm.length >= 2 && (guestSearch.data ?? []).length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-card border border-line bg-surface shadow-float">
                  {guestSearch.data.map((guest) => (
                    <li key={guest.id}>
                      <button
                        type="button"
                        onClick={() => pickGuest(guest)}
                        className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-black/[0.04]"
                      >
                        <span className="font-medium text-ink">{guest.name}</span>
                        <span className="text-xs text-ink-muted">{guest.phone || guest.email || '—'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Input label="Telefon" name="guestPhone" value={form.guestPhone} onChange={setField('guestPhone')} error={errors['guest.phone']} />
            <Input
              label="E-posta"
              name="guestEmail"
              type="email"
              value={form.guestEmail}
              onChange={setField('guestEmail')}
              error={errors['guest.email']}
              className="sm:col-span-2"
            />
          </fieldset>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Giriş" name="checkIn" type="date" value={form.checkIn} onChange={setField('checkIn')} error={errors.checkIn} />
          <Input label="Çıkış" name="checkOut" type="date" value={form.checkOut} onChange={setField('checkOut')} error={errors.checkOut} />
          <Select
            label="Oda tipi"
            name="roomTypeId"
            value={form.roomTypeId}
            onChange={setField('roomTypeId')}
            options={roomTypeOptions}
            error={errors.roomTypeId}
          />
          <Select label="Pansiyon" name="boardType" value={form.boardType} onChange={setField('boardType')} options={BOARD_OPTIONS} error={errors.boardType} />
          <Input label="Yetişkin" name="adults" type="number" min="1" value={form.adults} onChange={setField('adults')} error={errors.adults} />
          <Input label="Çocuk" name="children" type="number" min="0" value={form.children} onChange={setField('children')} error={errors.children} />
        </div>

        <Textarea label="Not" name="notes" value={form.notes} onChange={setField('notes')} error={errors.notes} />

        {quote.isFetching && <Spinner label="Fiyat hesaplanıyor…" className="py-2" />}
        {quote.data && (
          <Alert tone={noAvailability ? 'warning' : 'info'}>
            {quote.data.nights} gece · Toplam <strong>{formatMoney(quote.data.total, quote.data.currency)}</strong> ·{' '}
            {noAvailability ? 'Seçilen tarihlerde boş oda yok.' : `${quote.data.available} oda müsait`}
          </Alert>
        )}
      </form>
    </Modal>
  );
}
