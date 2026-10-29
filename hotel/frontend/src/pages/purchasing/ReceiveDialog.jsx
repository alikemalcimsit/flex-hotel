import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, MAX_OVER_RECEIPT_PCT, MAX_PURCHASE_NOTE_LENGTH, MAX_WAYBILL_LENGTH, receiveGoodsSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { purchasingKeys, stockKeys, useWarehouses } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { quantityStep } from '../../lib/purchasingFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const CELL = 'w-full rounded-item border bg-surface px-2 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-ink disabled:opacity-60';
const cellClass = (error) => `${CELL} ${error ? 'border-sec-strong' : 'border-line-strong'}`;

/**
 * Mal kabul / irsaliye (modül 45): depo (varsayılan önce), irsaliye no, kabul günü, satır başına gelen
 * miktar (varsayılan kalan; tartılan malzemede siparişin %5 fazlasına kadar), "kalanı gelmeyecek"
 * (eksik kapat). Kaydedince stok girer, hareketli ortalama maliyet güncellenir, tedarikçi borcu doğar.
 * Sipariş bu arada değiştiyse (başka kabul) pencere kapanır, ekran yenilenir.
 *
 * @param {{ order: any, onClose: () => void }} props
 */
export function ReceiveDialog({ order, onClose }) {
  const queryClient = useQueryClient();
  const { today } = useHotelToday();
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [waybillNumber, setWaybillNumber] = useState('');
  const [receivedOn, setReceivedOn] = useState(today ?? '');
  const [note, setNote] = useState('');
  const [closeShort, setCloseShort] = useState(false);
  const [quantities, setQuantities] = useState(() => Object.fromEntries(order.lines.map((line) => [line.id, line.remaining === '0' ? '' : line.remaining])));
  const [errors, setErrors] = useState({});
  const chosenWarehouse = warehouseId || warehouses.data?.find((entry) => entry.isDefault)?.id || warehouses.data?.[0]?.id || '';

  const save = useMutation({
    mutationFn: (body) => apiPost(`/purchasing/orders/${order.id}/receipts`, body),
    onSuccess: (receipt) => {
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
      queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toastSuccess(`${receipt.number} kaydedildi: stok girdi, ${formatMoney(receipt.grandTotal, receipt.currency)} borç (vade ${receipt.dueDate.split('-').reverse().join('.')})`);
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE' || error.code === 'ORDER_STATUS') {
        queryClient.invalidateQueries({ queryKey: purchasingKeys.order(order.id) });
        toastError('Sipariş bu arada değişti (başka mal kabul ya da iptal); ekran yenilendi, kalanları kontrol edin.');
        return onClose();
      }
      toastError(error.message);
    },
  });

  const receivable = order.lines.filter((line) => line.receivable !== '0');
  function submit(event) {
    event.preventDefault();
    const body = {
      expectedUpdatedAt: order.updatedAt,
      warehouseId: chosenWarehouse,
      waybillNumber: waybillNumber.trim(),
      receivedOn,
      note: note.trim() || null,
      closeShort,
      lines: receivable.map((line) => ({ orderLineId: line.id, quantity: String(quantities[line.id] ?? '').trim() || '0' })),
    };
    const checked = validateWith(receiveGoodsSchema, body);
    /** @type {Record<string, string>} */
    const local = checked.ok ? {} : { ...checked.errors };
    receivable.forEach((line, index) => {
      const value = Number(String(quantities[line.id] ?? '').replace(',', '.'));
      if (value > Number(line.receivable)) local[`lines.${index}.quantity`] = `En fazla ${quantityText(line.receivable, line.unit)}`;
    });
    if (receivedOn && today && receivedOn > today) local.receivedOn = 'Kabul günü bugünden sonra olamaz';
    if (Object.keys(local).length) return setErrors(local);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  const incomingTotal = receivable.reduce((sum, line) => {
    const quantity = Number(String(quantities[line.id] ?? '').replace(',', '.')) || 0;
    const net = Math.round(quantity * Number(line.unitPrice) * 100) / 100;
    return sum + net + Math.round(net * Number(line.taxRatePct)) / 100;
  }, 0);
  const short = receivable.some((line) => (Number(String(quantities[line.id] ?? '').replace(',', '.')) || 0) < Number(line.remaining));

  return (
    <Modal
      open
      size="xl"
      title={`Mal kabul — ${order.number}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="receive-form" icon="check" disabled={busy || !chosenWarehouse}>
            {busy ? 'Kaydediliyor…' : 'Mal kabulü kaydet'}
          </Button>
        </>
      }
    >
      <form id="receive-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {warehouses.isError && <Alert tone="danger">Depolar yüklenemedi: {warehouses.error.message}</Alert>}
        {warehouses.data && warehouses.data.length === 0 && <Alert tone="warning">Etkin depo yok; önce Stok → Depolar ekranından depo tanımlayın.</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select
            label="Depo"
            name="receive-warehouse"
            options={(warehouses.data ?? []).map((entry) => ({ value: entry.id, label: entry.isDefault ? `${entry.name} (varsayılan)` : entry.name }))}
            value={chosenWarehouse}
            onChange={(event) => setWarehouseId(event.target.value)}
            error={errors.warehouseId}
            disabled={busy || warehouses.isPending}
          />
          <Input label="İrsaliye no" name="receive-waybill" maxLength={MAX_WAYBILL_LENGTH} value={waybillNumber} onChange={(event) => setWaybillNumber(event.target.value)} error={errors.waybillNumber} required disabled={busy} />
          <Input label="Kabul günü" name="receive-on" type="date" max={today ?? undefined} value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} error={errors.receivedOn} required disabled={busy} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2 pr-2">Malzeme</th>
                <th className="py-2 pr-2 text-right">Sipariş</th>
                <th className="py-2 pr-2 text-right">Alınan</th>
                <th className="py-2 pr-2 text-right">Kalan</th>
                <th className="w-40 py-2 pr-2 text-right">Gelen</th>
                <th className="py-2 text-right">Fark</th>
              </tr>
            </thead>
            <tbody>
              {receivable.map((line, index) => {
                const incoming = Number(String(quantities[line.id] ?? '').replace(',', '.')) || 0;
                const diff = incoming - Number(line.remaining);
                const error = errors[`lines.${index}.quantity`];
                return (
                  <tr key={line.id} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-2">
                      <span className="block font-semibold text-ink">{line.name}</span>
                      <span className="block text-xs text-ink-muted">{formatMoney(line.unitPrice, order.currency)} / {KITCHEN_UNIT_LABELS[line.unit]} · KDV %{line.taxRatePct}</span>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{quantityText(line.quantity, line.unit)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{quantityText(line.receivedQuantity, line.unit)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{quantityText(line.remaining, line.unit)}</td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          aria-label={`${line.name} gelen miktar`}
                          inputMode="decimal"
                          step={quantityStep(line.unit)}
                          className={cellClass(error)}
                          value={quantities[line.id] ?? ''}
                          onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                          disabled={busy}
                        />
                        <span className="text-xs text-ink-muted">{KITCHEN_UNIT_LABELS[line.unit]}</span>
                      </div>
                      {error && <p className="mt-1 text-right text-xs text-sec-strong">{error}</p>}
                    </td>
                    <td className={`py-2 text-right tabular-nums ${diff < 0 ? 'text-warning-ink' : diff > 0 ? 'text-info-ink' : 'text-ink-muted'}`}>
                      {diff === 0 ? '—' : `${diff > 0 ? '+' : ''}${quantityText(diff.toFixed(3), line.unit)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {typeof errors.lines === 'string' && <Alert tone="danger">{errors.lines}</Alert>}
        <p className="text-xs text-ink-muted">
          Tartılan / ölçülen malzemede siparişin en fazla %{MAX_OVER_RECEIPT_PCT} fazlası alınabilir; adette fazla teslim alınmaz. Tutarlar sipariş fiyatıyla.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Checkbox
            label="Kalanı gelmeyecek: siparişi eksik kapat"
            hint="Eksik satırlar bekletilmez; sipariş bu kabulle kapanır."
            checked={closeShort}
            onChange={(event) => setCloseShort(event.target.checked)}
            disabled={busy || !short}
          />
          <span className="text-sm">
            Gelen tutar (KDV dahil) <strong className="tabular-nums">{formatMoney(incomingTotal.toFixed(2), order.currency)}</strong>
          </span>
        </div>
        <Textarea label="Not (isteğe bağlı)" name="receive-note" rows={2} maxLength={MAX_PURCHASE_NOTE_LENGTH} value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}
