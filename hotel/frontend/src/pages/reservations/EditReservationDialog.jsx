import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BOARD_TYPES, BOARD_TYPE_LABELS, updateReservationSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPatch, apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { addDaysIso, reservationKeys } from '../../lib/reservations.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from '../rooms/useRoomTypes.js';

const BOARD_OPTIONS = BOARD_TYPES.map((value) => ({ value, label: BOARD_TYPE_LABELS[value] }));
const QUOTE_DEBOUNCE_MS = 250;

/**
 * Rezervasyonu düzenler.
 *
 * - İçerideki misafirde giriş tarihi ve oda tipi kilitlidir (oda değişikliği
 *   oda planından yapılır); çıkış tarihi uzatılıp kısaltılabilir.
 * - Fiyat kararı: **anlaşılanı koru** (yalnızca eklenen geceler güncel
 *   fiyatla), **sistem fiyatıyla yeniden hesapla** ya da (yetkiliyse) **elle**.
 *   Elle fiyatlı rezervasyonda konaklama değişirse sunucu karar ister.
 * - Yalnızca değişen alanlar gönderilir; kayıt bu arada değiştiyse sunucu
 *   409 döner, sayfa tazelenir.
 * - Yeni tarihler için müsaitlik önizlemesi (rezervasyonun kendi yeri boş sayılır).
 *
 * @param {{ reservation: object, onClose: () => void, onSaved: (updated: object) => void, onError: (error: Error) => void }} props
 */
export function EditReservationDialog({ reservation, onClose, onSaved, onError }) {
  const can = useCan();
  const canOverridePrice = can(PERMISSIONS.RESERVATIONS_PRICE_OVERRIDE);
  const { today } = useHotelToday();
  const { options: roomTypeOptions } = useRoomTypes();
  const inHouse = reservation.status === 'CHECKED_IN';

  const [form, setForm] = useState({
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    roomTypeId: reservation.roomType.id,
    adults: String(reservation.adults),
    children: String(reservation.children),
    boardType: reservation.boardType,
    notes: reservation.notes ?? '',
  });
  /** `KEEP` | `CALCULATED` | `MANUAL` */
  const [priceMode, setPriceMode] = useState('KEEP');
  const [manual, setManual] = useState({ total: '', note: '' });
  const [errors, setErrors] = useState({});
  const [decisionRequired, setDecisionRequired] = useState(false);

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const stayChanged = form.checkIn !== reservation.checkIn || form.checkOut !== reservation.checkOut || form.roomTypeId !== reservation.roomType.id;
  const stayValid = form.checkIn && form.checkOut && form.checkOut > form.checkIn;

  const [quoteInput, setQuoteInput] = useState(null);
  useEffect(() => {
    if (!stayChanged || !stayValid) {
      setQuoteInput(null);
      return undefined;
    }
    const timer = setTimeout(
      () =>
        setQuoteInput({
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          lines: [{ roomTypeId: form.roomTypeId, quantity: 1, adults: Number(form.adults) || 1, children: Number(form.children) || 0 }],
          excludeReservationId: reservation.id,
        }),
      QUOTE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [stayChanged, stayValid, form.checkIn, form.checkOut, form.roomTypeId, form.adults, form.children, reservation.id]);
  const quote = useQuery({
    queryKey: reservationKeys.quote(quoteInput ?? {}),
    queryFn: () => apiPost('/reservations/quote', quoteInput),
    enabled: Boolean(quoteInput),
  });
  const typeQuote = quote.data?.roomTypes.find((type) => type.id === form.roomTypeId);

  const mutation = useMutation({
    mutationFn: (body) => apiPatch(`/reservations/${reservation.id}`, body),
    onSuccess: (updated) => {
      toastSuccess('Rezervasyon güncellendi');
      onSaved(updated);
    },
    onError: (error) => {
      if (error.code === 'PRICE_DECISION_REQUIRED') {
        setDecisionRequired(true);
        return;
      }
      if (error.fields && Object.keys(error.fields).length) {
        setErrors(error.fields);
        return;
      }
      onError(error);
      if (error.code === 'STALE_WRITE') onClose();
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: reservation.updatedAt };
    if (form.checkIn !== reservation.checkIn) body.checkIn = form.checkIn;
    if (form.checkOut !== reservation.checkOut) body.checkOut = form.checkOut;
    if (form.roomTypeId !== reservation.roomType.id) body.roomTypeId = form.roomTypeId;
    if (form.adults !== String(reservation.adults)) body.adults = form.adults;
    if (form.children !== String(reservation.children)) body.children = form.children;
    if (form.boardType !== reservation.boardType) body.boardType = form.boardType;
    if (form.notes !== (reservation.notes ?? '')) body.notes = form.notes;
    if (priceMode === 'CALCULATED') body.price = { mode: 'CALCULATED' };
    if (priceMode === 'MANUAL') body.price = { mode: 'MANUAL', total: manual.total, note: manual.note };

    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    const result = validateWith(updateReservationSchema, body);
    if (!result.ok) {
      setErrors(Object.fromEntries(Object.entries(result.errors).map(([key, message]) => [key.replace(/^price\./, 'price.'), message])));
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
      title={`Düzenle — ${reservation.confirmationCode}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="edit-reservation-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="edit-reservation-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {inHouse && (
          <Alert tone="info" title="Misafir içeride">
            Giriş tarihi ve oda tipi değiştirilemez; çıkış tarihini uzatıp kısaltabilirsiniz. Oda değişikliği için oda planını kullanın.
          </Alert>
        )}
        <div className="flex flex-wrap gap-3">
          <Input label="Giriş" type="date" min={inHouse ? undefined : today} value={form.checkIn} onChange={set('checkIn')} disabled={busy || inHouse} error={errors.checkIn} className="w-full sm:w-44" />
          <Input label="Çıkış" type="date" min={addDaysIso(form.checkIn || today, 1)} value={form.checkOut} onChange={set('checkOut')} disabled={busy} error={errors.checkOut} className="w-full sm:w-44" />
          <Select label="Oda tipi" value={form.roomTypeId} onChange={set('roomTypeId')} options={roomTypeOptions} disabled={busy || inHouse} error={errors.roomTypeId} className="w-full sm:w-64" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Input label="Yetişkin" type="number" min={1} max={20} value={form.adults} onChange={set('adults')} disabled={busy} error={errors.adults} className="w-28" />
          <Input label="Çocuk" type="number" min={0} max={20} value={form.children} onChange={set('children')} disabled={busy} error={errors.children} className="w-28" />
          <Select label="Pansiyon" value={form.boardType} onChange={set('boardType')} options={BOARD_OPTIONS} disabled={busy} className="w-full sm:w-64" />
        </div>

        {stayChanged && stayValid && (
          <div className="rounded-item border border-line bg-canvas p-3 text-sm">
            {quote.isPending && 'Müsaitlik denetleniyor…'}
            {quote.isError && <span className="text-sec-strong">{quote.error.message}</span>}
            {typeQuote && (
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={typeQuote.available > 0 ? 'success' : 'danger'}>
                  {typeQuote.available > 0 ? `Yeni tarihlerde ${typeQuote.available} boş` : 'Yeni tarihlerde yer yok'}
                </Badge>
                <span className="text-ink-muted">Güncel sistem fiyatı: {formatMoney(typeQuote.total, quote.data.currency)}</span>
                {reservation.room && <span className="text-ink-muted">· Oda yeni tarihlere uymazsa ataması kaldırılır.</span>}
              </span>
            )}
          </div>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold text-ink">Fiyat</legend>
          {decisionRequired && (
            <Alert tone="warning" title="Fiyat kararı gerekli">
              Bu rezervasyonun fiyatı elle girilmişti. Yeni konaklama için sistem fiyatını seçin ya da yeni elle fiyat girin.
            </Alert>
          )}
          <PriceOption checked={priceMode === 'KEEP'} onChange={() => setPriceMode('KEEP')} disabled={busy} label="Anlaşılan fiyatı koru" hint="Değişmeyen geceler eski fiyatında kalır; eklenen geceler güncel fiyatla hesaplanır. Oda tipi değişirse tüm geceler yeni tipin fiyatıyla." />
          <PriceOption checked={priceMode === 'CALCULATED'} onChange={() => setPriceMode('CALCULATED')} disabled={busy} label="Güncel sistem fiyatıyla yeniden hesapla" hint={inHouse ? 'İçerideki misafirin geçmiş geceleri değişmez.' : 'Tüm geceler bugünkü taban fiyat ve sezon çarpanıyla.'} />
          {canOverridePrice && (
            <PriceOption checked={priceMode === 'MANUAL'} onChange={() => setPriceMode('MANUAL')} disabled={busy} label="Elle fiyat gir" hint="Toplam gecelere eşit bölünür; gerekçe denetim izine yazılır." />
          )}
          {priceMode === 'MANUAL' && (
            <div className="flex flex-wrap gap-3 pl-6">
              <Input label={`Toplam (${reservation.currency})`} inputMode="decimal" value={manual.total} onChange={(e) => setManual((c) => ({ ...c, total: e.target.value }))} error={errors['price.total']} disabled={busy} className="w-40" />
              <Input label="Gerekçe" value={manual.note} onChange={(e) => setManual((c) => ({ ...c, note: e.target.value }))} error={errors['price.note']} disabled={busy} className="w-full sm:w-72" />
            </div>
          )}
        </fieldset>

        <Textarea label="Not" rows={3} maxLength={2000} value={form.notes} onChange={set('notes')} disabled={busy} error={errors.notes} />
      </form>
    </Modal>
  );
}

/** @param {{ checked: boolean, onChange: () => void, disabled: boolean, label: string, hint: string }} props */
function PriceOption({ checked, onChange, disabled, label, hint }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2 rounded-item border p-2.5 ${checked ? 'border-ink' : 'border-line'}`}>
      <input type="radio" name="price-mode" className="mt-1" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}
