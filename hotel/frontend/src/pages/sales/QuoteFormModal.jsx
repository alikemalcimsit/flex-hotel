import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BOARD_TYPES, BOARD_TYPE_LABELS, createQuoteSchema, updateQuoteSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, apiPut } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const BOARD_OPTIONS = BOARD_TYPES.map((value) => ({ value, label: BOARD_TYPE_LABELS[value] }));

/** Varsayılan geçerlilik: bugünden 7 gün sonrası. */
function defaultValidUntil() {
  return new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Teklif hazırla / taslak düzenle (modül 36). Fırsatın istenen konaklaması
 * formu önceden doldurur. Fiyat sunucuda kilitlenir; kaydedince dönen gece
 * dökümü ve toplam önizlemede gösterilir.
 *
 * @param {{ lead: object, quote?: object | null, onSaved: () => void, onClose: () => void }} props
 */
export function QuoteFormModal({ lead, quote = null, onSaved, onClose }) {
  const [form, setForm] = useState(() => ({
    checkIn: quote?.checkIn ?? lead.checkIn ?? '',
    checkOut: quote?.checkOut ?? lead.checkOut ?? '',
    roomTypeId: quote?.roomTypeId ?? lead.roomTypeId ?? '',
    boardType: quote?.boardType ?? 'BB',
    adults: String(quote?.adults ?? lead.adults ?? 2),
    children: String(quote?.children ?? lead.children ?? 0),
    validUntil: quote?.validUntil ?? defaultValidUntil(),
    notes: quote?.notes ?? '',
  }));
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(null);

  const roomTypes = useQuery({ queryKey: ['settings', 'room-types', 'all'], queryFn: () => api('/settings/room-types?pageSize=200') });

  const mutation = useMutation({
    mutationFn: (values) => (quote ? apiPut(`/sales/quotes/${quote.id}`, values) : apiPost(`/sales/leads/${lead.id}/quotes`, values)),
    onSuccess: (result) => {
      toastSuccess(quote ? 'Taslak güncellendi (fiyat yeniden kilitlendi)' : `Teklif hazırlandı: ${result.code}`);
      setSaved(result);
    },
    onError: (error) => toastError(error.message),
  });

  const setField = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));

  function save() {
    const body = {
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      roomTypeId: form.roomTypeId,
      boardType: form.boardType,
      adults: form.adults,
      children: form.children,
      validUntil: form.validUntil,
      notes: form.notes,
      ...(quote ? { expectedUpdatedAt: quote.updatedAt } : {}),
    };
    const result = validateWith(quote ? updateQuoteSchema : createQuoteSchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(result.data);
  }

  return (
    <Modal
      open
      title={quote ? `Taslağı düzenle · ${quote.code}` : 'Teklif hazırla'}
      onClose={() => (saved ? onSaved() : onClose())}
      size="lg"
      footer={
        saved ? (
          <Button icon="check" onClick={onSaved}>
            Tamam
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Vazgeç
            </Button>
            <Button icon="check" disabled={mutation.isPending} onClick={save}>
              {mutation.isPending ? 'Fiyat hesaplanıyor…' : 'Fiyatı kilitle ve kaydet'}
            </Button>
          </>
        )
      }
    >
      {saved ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success" title={`Teklif ${saved.code} · ${formatMoney(saved.total, saved.currency)}`}>
            Fiyat bu teklifte kilitlendi; sonradan fiyat değişse de müşteriye verilen söz değişmez.
          </Alert>
          <div className="overflow-x-auto rounded-control border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Gece</th>
                  <th className="px-3 py-2 text-right">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {saved.nights.map((night) => (
                  <tr key={night.date} className="border-t border-line tabular-nums">
                    <td className="px-3 py-1.5">{formatDate(night.date)}</td>
                    <td className="px-3 py-1.5 text-right">{formatMoney(night.amount, saved.currency)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-bold tabular-nums">
                  <td className="px-3 py-1.5">Toplam</td>
                  <td className="px-3 py-1.5 text-right">{formatMoney(saved.total, saved.currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-muted">Geçerlilik: {formatDate(saved.validUntil)} (dahil). PDF'i teklif kartından indirebilirsiniz.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Giriş" name="checkIn" type="date" value={form.checkIn} error={errors.checkIn} onChange={setField('checkIn')} />
            <Input label="Çıkış" name="checkOut" type="date" value={form.checkOut} error={errors.checkOut} onChange={setField('checkOut')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Oda tipi"
              name="roomTypeId"
              value={form.roomTypeId}
              error={errors.roomTypeId}
              onChange={setField('roomTypeId')}
              options={[{ value: '', label: 'Seçin…' }, ...(roomTypes.data?.items ?? []).map((type) => ({ value: type.id, label: type.name }))]}
            />
            <Select label="Pansiyon" name="boardType" value={form.boardType} error={errors.boardType} onChange={setField('boardType')} options={BOARD_OPTIONS} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Yetişkin" name="adults" type="number" min="1" value={form.adults} error={errors.adults} onChange={setField('adults')} />
            <Input label="Çocuk" name="children" type="number" min="0" value={form.children} error={errors.children} onChange={setField('children')} />
            <Input
              label="Son geçerlilik"
              name="validUntil"
              type="date"
              value={form.validUntil}
              error={errors.validUntil}
              onChange={setField('validUntil')}
            />
          </div>
          <Input label="Not (PDF'te görünür)" name="notes" value={form.notes} error={errors.notes} onChange={setField('notes')} />
          <p className="text-xs text-ink-muted">
            Kaydedince fiyat o anki sistem fiyatıyla (plan + onaylı dinamik çarpan dahil) gece gece kilitlenir.
          </p>
        </div>
      )}
    </Modal>
  );
}
