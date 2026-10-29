import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, MAX_PURCHASE_NOTE_LENGTH, MAX_SUPPLIER_LEAD_DAYS, PURCHASE_TAX_RATES, savePurchaseQuoteSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { dayText } from '../../lib/banquet.js';
import { formatMoney } from '../../lib/format.js';
import { purchasingKeys } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const CELL = 'w-full rounded-item border bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-ink disabled:opacity-60';
const cellClass = (error) => `${CELL} ${error ? 'border-sec-strong' : 'border-line-strong'}`;
const TAX_OPTIONS = PURCHASE_TAX_RATES.map((rate) => ({ value: rate, label: `%${rate}` }));

/**
 * Tedarikçi teklifi (modül 45): tedarikçi (yeni teklifte seçici + gruba göre öneriler), termin,
 * geçerlilik, satır fiyatları (KDV hariç, stok biriminde; boş = vermiyor) ve KDV oranı. Siparişe
 * dönmüş / bırakılmış satırlar kilitli gösterilir. Kayıt turun sürüm damgasıyla; tur bu arada
 * değiştiyse (başka teklif, kazanan) pencere kapanır, ekran yenilenir.
 *
 * @param {{ round: any, quote: any | null, defaultTaxRatePct: string, onClose: () => void }} props
 */
export function QuoteDialog({ round, quote, defaultTaxRatePct, onClose }) {
  const queryClient = useQueryClient();
  const { today } = useHotelToday();
  const [supplier, setSupplier] = useState(() => (quote ? { id: quote.supplierId, name: quote.supplierName, leadTimeDays: quote.deliveryDays } : null));
  const [deliveryDays, setDeliveryDays] = useState(quote ? String(quote.deliveryDays) : '');
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? '');
  const [note, setNote] = useState(quote?.note ?? '');
  const cells = new Map((quote?.lines ?? []).map((cell) => [cell.roundLineId, cell]));
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(round.lines.map((line) => [line.id, { unitPrice: cells.get(line.id)?.unitPrice ?? '', taxRatePct: cells.get(line.id)?.taxRatePct ?? defaultTaxRatePct }])),
  );
  const [errors, setErrors] = useState({});
  const quoted = new Set(round.quotes.map((entry) => entry.supplierId));
  const suggestions = useQuery({
    queryKey: [...purchasingKeys.round(round.id), 'supplier-suggestions'],
    queryFn: () => api(`/purchasing/rounds/${round.id}/supplier-suggestions`),
    enabled: !quote,
  });

  const done = (message) => (result) => {
    queryClient.setQueryData(purchasingKeys.round(round.id), result);
    queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
    toastSuccess(message);
    onClose();
  };
  const fail = (error) => {
    if (error.fields) setErrors(error.fields);
    if (error.code === 'STALE_WRITE' || error.code === 'ROUND_STATUS') {
      queryClient.invalidateQueries({ queryKey: purchasingKeys.round(round.id) });
      toastError('Tur bu arada değişti (başka teklif ya da kazanan seçimi); ekran yenilendi, tekrar açın.');
      return onClose();
    }
    toastError(error.message);
  };
  const save = useMutation({ mutationFn: (body) => apiPut(`/purchasing/rounds/${round.id}/quotes/${supplier.id}`, body), onSuccess: done(`${supplier?.name} teklifi kaydedildi`), onError: fail });
  const remove = useMutation({ mutationFn: () => apiPost(`/purchasing/rounds/${round.id}/quotes/${supplier.id}/remove`, { expectedUpdatedAt: round.updatedAt }), onSuccess: done('Teklif turdan çıkarıldı'), onError: fail });

  function pick(entry) {
    setSupplier({ id: entry.id, name: entry.name, leadTimeDays: entry.leadTimeDays });
    if (!deliveryDays) setDeliveryDays(String(entry.leadTimeDays));
  }

  function submit(event) {
    event.preventDefault();
    if (!supplier) return setErrors({ supplier: 'Tedarikçi seçin' });
    // Boş alan sayıya çevrilince 0 olur; "aynı gün teslim" bilinçli girilmeli.
    if (String(deliveryDays).trim() === '') return setErrors({ deliveryDays: 'Termin yazın (aynı gün teslimse 0)' });
    const pending = round.lines.filter((line) => line.state === 'PENDING');
    const body = {
      expectedUpdatedAt: round.updatedAt,
      deliveryDays,
      validUntil: validUntil || null,
      note: note.trim() || null,
      lines: pending.map((line) => ({ roundLineId: line.id, unitPrice: String(prices[line.id].unitPrice).trim(), taxRatePct: prices[line.id].taxRatePct })),
    };
    const checked = validateWith(savePurchaseQuoteSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (validUntil && today && validUntil < today) return setErrors({ validUntil: 'Geçerlilik bugünden önce olamaz' });
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending || remove.isPending;
  const awardedHere = quote ? round.lines.some((line) => line.awardedQuoteLineId && quote.lines.some((cell) => cell.id === line.awardedQuoteLineId)) : false;
  const previewTotal = round.lines.reduce((sum, line) => {
    const price = Number(String(prices[line.id]?.unitPrice ?? '').replace(',', '.'));
    if (!price || line.state !== 'PENDING') return sum;
    const net = Math.round(price * Number(line.quantity) * 100) / 100;
    return sum + net + Math.round(net * Number(prices[line.id].taxRatePct)) / 100;
  }, 0);

  return (
    <Modal
      open
      size="xl"
      title={quote ? `${quote.supplierName} teklifi` : 'Teklif ekle'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          {quote && !awardedHere && (
            <Button type="button" variant="dangerSoft" icon="trash" onClick={() => remove.mutate()} disabled={busy} className="mr-auto">
              Teklifi çıkar
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="quote-form" icon="check" disabled={busy || !supplier}>
            {save.isPending ? 'Kaydediliyor…' : 'Teklifi kaydet'}
          </Button>
        </>
      }
    >
      <form id="quote-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {!quote && (
          <div className="flex flex-col gap-2">
            {supplier ? (
              <div className="flex items-center justify-between gap-2 rounded-item border border-line bg-surface-muted px-3 py-2 text-sm">
                <span>
                  <span className="font-semibold text-ink">{supplier.name}</span> <span className="text-ink-muted">· olağan termin {supplier.leadTimeDays} gün</span>
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSupplier(null)} disabled={busy}>
                  Değiştir
                </Button>
              </div>
            ) : (
              <SearchPicker
                label="Tedarikçi"
                placeholder="Tedarikçi ara (ad / kod / vergi no)"
                queryOf={(search) => ({
                  queryKey: purchasingKeys.suppliers({ search, active: 'true', picker: true }),
                  queryFn: () => api(withQuery('/purchasing/suppliers', { search: search || undefined, active: 'true', page: 1, pageSize: 30 })),
                })}
                itemsOf={(data) => data?.items ?? []}
                renderItem={(entry) => (
                  <span>
                    <span className="font-semibold">{entry.name}</span> <span className="text-xs text-ink-muted">· termin {entry.leadTimeDays} gün · vade {entry.paymentTermDays} gün</span>
                  </span>
                )}
                isDisabled={(entry) => (quoted.has(entry.id) ? 'teklifi var' : null)}
                onPick={pick}
                emptyText="Etkin tedarikçi bulunamadı"
                error={errors.supplier}
                disabled={busy}
              />
            )}
            {!supplier && suggestions.data?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-ink-muted">Bu gruplara tedarik edenler:</span>
                {suggestions.data.map((entry) => (
                  <button key={entry.id} type="button" className="rounded-full border border-line-strong px-2 py-0.5 font-semibold text-ink hover:bg-surface-muted" onClick={() => pick(entry)} disabled={busy}>
                    {entry.name} <span className="font-normal text-ink-muted">({entry.matchingGroups.join(', ')})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label={`Termin (gün, en fazla ${MAX_SUPPLIER_LEAD_DAYS})`} name="quote-delivery" inputMode="numeric" value={deliveryDays} onChange={(event) => setDeliveryDays(event.target.value)} error={errors.deliveryDays} required disabled={busy} />
          <Input label="Geçerlilik (isteğe bağlı)" name="quote-valid" type="date" min={today ?? undefined} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} error={errors.validUntil} disabled={busy} />
          <div className="self-end text-right text-sm">
            Bekleyen satırlar toplamı (KDV dahil) <strong className="block text-lg tabular-nums">{formatMoney(previewTotal.toFixed(2), round.currency)}</strong>
          </div>
        </div>
        {typeof errors.lines === 'string' && <Alert tone="danger">{errors.lines}</Alert>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2 pr-2">Malzeme</th>
                <th className="py-2 pr-2 text-right">Miktar</th>
                <th className="py-2 pr-2">İhtiyaç</th>
                <th className="py-2 pr-2 text-right">Kart maliyeti</th>
                <th className="w-40 py-2 pr-2">Birim fiyat (KDV hariç)</th>
                <th className="w-24 py-2">KDV</th>
              </tr>
            </thead>
            <tbody>
              {round.lines.map((line, index) => {
                const locked = line.state !== 'PENDING';
                const pendingIndex = round.lines.filter((entry) => entry.state === 'PENDING').findIndex((entry) => entry.id === line.id);
                const error = errors[`lines.${pendingIndex}.unitPrice`];
                return (
                  <tr key={line.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-2">
                      <span className="font-semibold text-ink">{line.name}</span>
                      {locked && (
                        <Badge tone="neutral" className="ml-1.5">
                          {line.state === 'ORDERED' ? 'siparişte' : 'bırakıldı'}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{quantityText(line.quantity, line.unit)}</td>
                    <td className="py-2 pr-2">{dayText(line.neededBy)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">
                      {formatMoney(line.currentCost, round.currency)} / {KITCHEN_UNIT_LABELS[line.unit]}
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        aria-label={`${line.name} birim fiyatı`}
                        inputMode="decimal"
                        placeholder="vermiyor"
                        className={cellClass(error)}
                        value={prices[line.id].unitPrice}
                        onChange={(event) => setPrices((current) => ({ ...current, [line.id]: { ...current[line.id], unitPrice: event.target.value } }))}
                        disabled={busy || locked}
                      />
                      {error && <p className="mt-1 text-xs text-sec-strong">{error}</p>}
                    </td>
                    <td className="py-2">
                      <select
                        aria-label={`${line.name} KDV oranı`}
                        className={cellClass(false)}
                        value={prices[line.id].taxRatePct}
                        onChange={(event) => setPrices((current) => ({ ...current, [line.id]: { ...current[line.id], taxRatePct: event.target.value } }))}
                        disabled={busy || locked}
                        data-index={index}
                      >
                        {TAX_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Textarea label="Not (isteğe bağlı)" name="quote-note" rows={2} maxLength={MAX_PURCHASE_NOTE_LENGTH} value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}
