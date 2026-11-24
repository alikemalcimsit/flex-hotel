import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, MANUAL_STOCK_MOVEMENT_KINDS, MANUAL_STOCK_MOVEMENT_KIND_LABELS, MAX_STOCK_MOVEMENT_LINES, manualStockMovementSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { recipeKeys, stockKeys, useWarehouses } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { quantityStep } from '../../lib/purchasingFormat.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const KIND_OPTIONS = MANUAL_STOCK_MOVEMENT_KINDS.map((kind) => ({ value: kind, label: MANUAL_STOCK_MOVEMENT_KIND_LABELS[kind] }));
const KIND_HINTS = Object.freeze({
  ISSUE: 'Departman kullanımı (personel yemeği, kat malzemesi, bar). Depodan düşer, maliyet değişmez.',
  WASTE: 'Bozulan, dökülen, son kullanma tarihi geçen. Sebep zorunlu; maliyet raporunda fire olarak görünür.',
  TRANSFER: 'Kaynak depodan çıkar, hedef depoya girer; kartın toplam mevcudu değişmez.',
});

/**
 * Elle stok hareketi (modül 44): çıkış, fire, depolar arası transfer. Satırlar malzeme arama seçicisiyle eklenir;
 * miktar stok biriminde ("2,5" de olur). Formun ürettiği istek kimliği çift gönderimi tek harekete indirir.
 * Depoda yetersiz stok sunucudan satır hatasıyla döner.
 *
 * @param {{ onClose: () => void }} props
 */
export function ManualMovementDialog({ onClose }) {
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const [requestId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState('ISSUE');
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]);
  const [errors, setErrors] = useState({});

  const warehouseOptions = useMemo(() => [{ value: '', label: 'Depo seçin' }, ...(warehouses.data ?? []).map((row) => ({ value: row.id, label: row.name }))], [warehouses.data]);
  const effectiveWarehouseId = warehouseId || (warehouses.data ?? []).find((row) => row.isDefault)?.id || '';

  const save = useMutation({
    mutationFn: (body) => apiPost('/stock/movements', body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toastSuccess(result.duplicate ? 'Bu hareket zaten kaydedilmişti' : `${MANUAL_STOCK_MOVEMENT_KIND_LABELS[result.kind]}: ${result.lines.length} malzeme kaydedildi`);
      onClose();
    },
    onError: (failure) => {
      if (failure.fields) setErrors(failure.fields);
      toastError(failure.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = {
      requestId,
      kind,
      warehouseId: effectiveWarehouseId || undefined,
      toWarehouseId: kind === 'TRANSFER' ? toWarehouseId || null : null,
      lines: lines.map((line) => ({ stockItemId: line.id, quantity: String(line.quantity).trim() })),
      note: note.trim() || null,
    };
    const checked = validate(body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }
  function validate(body) {
    const result = manualStockMovementSchema.safeParse(body);
    if (result.success) return { ok: true };
    /** @type {Record<string, string>} */
    const fieldErrors = {};
    for (const issue of result.error.issues) fieldErrors[issue.path.join('.')] = issue.message;
    return { ok: false, errors: fieldErrors };
  }
  const addLine = (item) => setLines((current) => (current.some((line) => line.id === item.id) ? current : [...current, { id: item.id, name: item.name, unit: item.unit, onHand: item.onHand, quantity: '' }]));
  const setQuantity = (id, quantity) => setLines((current) => current.map((line) => (line.id === id ? { ...line, quantity } : line)));
  const removeLine = (id) => setLines((current) => current.filter((line) => line.id !== id));
  const busy = save.isPending;
  const lineError = (index, field) => errors[`lines.${index}.${field}`];

  return (
    <Modal
      open
      size="lg"
      title="Stok hareketi gir"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="manual-movement-form" icon="check" disabled={busy || lines.length === 0}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="manual-movement-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink-soft">Hareket türü</span>
          <ChoiceChips label="Hareket türü" options={KIND_OPTIONS} value={kind} onChange={setKind} disabled={busy} />
          <p className="text-xs text-ink-muted">{KIND_HINTS[kind]}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={kind === 'TRANSFER' ? 'Kaynak depo' : 'Depo'} name="movement-warehouse" options={warehouseOptions} value={effectiveWarehouseId} onChange={(event) => setWarehouseId(event.target.value)} error={errors.warehouseId} disabled={busy} />
          {kind === 'TRANSFER' && (
            <Select
              label="Hedef depo"
              name="movement-to-warehouse"
              options={warehouseOptions.filter((option) => option.value !== effectiveWarehouseId)}
              value={toWarehouseId}
              onChange={(event) => setToWarehouseId(event.target.value)}
              error={errors.toWarehouseId}
              disabled={busy}
            />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <SearchPicker
            label="Malzeme ekle"
            placeholder="Malzeme adı ya da kodu"
            queryOf={(search) => ({ queryKey: recipeKeys.stock({ search, picker: true }), queryFn: () => api(withQuery('/recipes/stock-items', { search: search || undefined, page: 1, pageSize: 30 })) })}
            itemsOf={(data) => data?.items ?? []}
            renderItem={(entry) => (
              <span className="flex items-center justify-between gap-3">
                <span className="font-semibold">{entry.name}</span>
                <span className="text-xs text-ink-muted">{quantityText(entry.onHand, entry.unit)} toplam</span>
              </span>
            )}
            isDisabled={(entry) => (lines.some((line) => line.id === entry.id) ? 'Listede' : lines.length >= MAX_STOCK_MOVEMENT_LINES ? `En fazla ${MAX_STOCK_MOVEMENT_LINES} satır` : null)}
            onPick={addLine}
            emptyText="Malzeme bulunamadı"
            disabled={busy}
          />
          {errors.lines && <p className="text-xs text-sec-strong">{errors.lines}</p>}
          {lines.length > 0 && (
            <ul className="divide-y divide-line rounded-item border border-line">
              {lines.map((line, index) => (
                <li key={line.id} className="flex flex-wrap items-end gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{line.name}</span>
                    <span className="block text-xs text-ink-muted">Toplam mevcut {quantityText(line.onHand, line.unit)}</span>
                    {lineError(index, 'stockItemId') && <span className="block text-xs text-sec-strong">{lineError(index, 'stockItemId')}</span>}
                  </span>
                  <Input
                    label={`Miktar (${KITCHEN_UNIT_LABELS[line.unit]})`}
                    name={`movement-qty-${line.id}`}
                    inputMode="decimal"
                    step={quantityStep(line.unit)}
                    value={line.quantity}
                    onChange={(event) => setQuantity(line.id, event.target.value)}
                    error={lineError(index, 'quantity')}
                    className="w-40"
                    disabled={busy}
                  />
                  <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => removeLine(line.id)} disabled={busy}>
                    Çıkar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Textarea label={kind === 'WASTE' ? 'Fire sebebi' : 'Açıklama'} name="movement-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} required={kind === 'WASTE'} disabled={busy} />
        {Object.keys(errors).some((key) => key.startsWith('lines.') && key.endsWith('quantity') && errors[key]?.includes('çıkılamaz')) && (
          <Alert tone="warning" title="Depoda yeterli stok yok">
            Çıkış depodaki mevcuttan fazla olamaz; miktarı düşürün ya da önce transferle stok getirin.
          </Alert>
        )}
      </form>
    </Modal>
  );
}
