import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, MAX_PURCHASE_NOTE_LENGTH, MAX_REQUEST_ITEMS, createPurchaseRequestSchema } from '@hotelos/hotel-contracts';
import { Button, Icon, Input, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { purchasingKeys, recipeKeys } from '../../lib/kitchen.js';
import { quantityStep } from '../../lib/purchasingFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const CELL = 'w-full rounded-item border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-ink disabled:opacity-60';
const cellClass = (error) => `${CELL} ${error ? 'border-sec-strong' : 'border-line-strong'}`;

/**
 * Yeni satın alma talebi (modül 45): elle ya da minimum stok önerisinden. Malzeme seçici aktif
 * kartları getirir; miktar stok biriminde (adet / g / ml tam sayı), satır ihtiyaç günü boşsa
 * talebinki. Kaydedince talep ekranına gider.
 *
 * @param {{ source?: 'MANUAL' | 'STOCK', initialLines?: Array<{ stockItemId: string, name: string, unit: string, quantity: string }>, onClose: () => void }} props
 */
export function NewRequestDialog({ source = 'MANUAL', initialLines = [], onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { today } = useHotelToday();
  const [neededBy, setNeededBy] = useState(today ?? '');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState(() => initialLines.map((line) => ({ ...line, neededBy: '' })));
  const [errors, setErrors] = useState({});

  const save = useMutation({
    mutationFn: (body) => apiPost('/purchasing/requests', body),
    onSuccess: (request) => {
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
      toastSuccess(`${request.number} açıldı`);
      onClose();
      navigate(`/satin-alma/talepler/${request.id}`);
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
    },
  });

  const patch = (index, changes) => setLines((current) => current.map((line, at) => (at === index ? { ...line, ...changes } : line)));
  function submit(event) {
    event.preventDefault();
    const body = {
      source,
      neededBy,
      note: note.trim() || null,
      lines: lines.map((line) => ({ stockItemId: line.stockItemId, quantity: String(line.quantity).trim(), neededBy: line.neededBy || null })),
    };
    const checked = validateWith(createPurchaseRequestSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="lg"
      title={source === 'STOCK' ? 'Minimum stok önerisinden talep' : 'Yeni satın alma talebi'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="new-request-form" icon="check" disabled={busy || lines.length === 0}>
            {busy ? 'Açılıyor…' : 'Talebi aç'}
          </Button>
        </>
      }
    >
      <form id="new-request-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="İhtiyaç günü" name="request-needed-by" type="date" min={today ?? undefined} value={neededBy} onChange={(event) => setNeededBy(event.target.value)} error={errors.neededBy} required disabled={busy} />
          <p className="self-end text-xs text-ink-muted">Satırda gün boşsa bu gün geçerli. Teklif turunda aynı malzemenin bütün açık satırları birleşir.</p>
        </div>
        {lines.length < MAX_REQUEST_ITEMS && (
          <SearchPicker
            label="Malzeme ekle"
            placeholder="Malzeme ara (ad / kod)"
            queryOf={(search) => ({ queryKey: recipeKeys.stock({ search, active: 'true', picker: true }), queryFn: () => api(withQuery('/recipes/stock-items', { search: search || undefined, active: 'true', page: 1, pageSize: 30 })) })}
            itemsOf={(data) => data?.items ?? []}
            renderItem={(item) => (
              <span>
                <span className="font-semibold">{item.name}</span> <span className="text-xs text-ink-muted">· {KITCHEN_UNIT_LABELS[item.unit]}</span>
              </span>
            )}
            isDisabled={(item) => (lines.some((line) => line.stockItemId === item.id) ? 'listede' : null)}
            onPick={(item) => setLines((current) => [...current, { stockItemId: item.id, name: item.name, unit: item.unit, quantity: '', neededBy: '' }])}
            emptyText="Aktif malzeme bulunamadı"
            error={typeof errors.lines === 'string' ? errors.lines : undefined}
            disabled={busy}
          />
        )}
        {lines.length === 0 ? (
          <p className="rounded-card border border-dashed border-line-strong p-4 text-center text-sm text-ink-muted">Henüz malzeme yok; yukarıdan arayıp ekleyin.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="py-2 pr-2">Malzeme</th>
                  <th className="w-36 py-2 pr-2">Miktar</th>
                  <th className="w-40 py-2 pr-2">İhtiyaç (isteğe bağlı)</th>
                  <th className="w-10 py-2" aria-label="Sil" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.stockItemId} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2 font-semibold text-ink">{line.name}</td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          aria-label={`${line.name} miktarı`}
                          inputMode="decimal"
                          step={quantityStep(line.unit)}
                          className={cellClass(errors[`lines.${index}.quantity`])}
                          value={line.quantity}
                          onChange={(event) => patch(index, { quantity: event.target.value })}
                          disabled={busy}
                        />
                        <span className="text-xs text-ink-muted">{KITCHEN_UNIT_LABELS[line.unit]}</span>
                      </div>
                      {errors[`lines.${index}.quantity`] && <p className="mt-1 text-xs text-sec-strong">{errors[`lines.${index}.quantity`]}</p>}
                      {errors[`lines.${index}.stockItemId`] && <p className="mt-1 text-xs text-sec-strong">{errors[`lines.${index}.stockItemId`]}</p>}
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        aria-label={`${line.name} ihtiyaç günü`}
                        type="date"
                        min={today ?? undefined}
                        className={cellClass(errors[`lines.${index}.neededBy`])}
                        value={line.neededBy}
                        onChange={(event) => patch(index, { neededBy: event.target.value })}
                        disabled={busy}
                      />
                      {errors[`lines.${index}.neededBy`] && <p className="mt-1 text-xs text-sec-strong">{errors[`lines.${index}.neededBy`]}</p>}
                    </td>
                    <td className="py-2 text-right">
                      <button type="button" className="rounded-item p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink" onClick={() => setLines((current) => current.filter((_, at) => at !== index))} disabled={busy} aria-label={`${line.name} satırını sil`}>
                        <Icon name="trash" className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Textarea label="Not (isteğe bağlı)" name="request-note" rows={2} maxLength={MAX_PURCHASE_NOTE_LENGTH} value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}
