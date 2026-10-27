import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, MAX_PURCHASE_NOTE_LENGTH, STOCK_ITEM_GROUP_LABELS, createBanquetPurchaseRequestSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { banquetKeys } from '../../lib/banquet.js';
import { purchasingKeys } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const CELL = 'w-28 rounded-item border bg-surface px-2 py-1.5 text-right text-sm text-ink outline-none focus:border-ink disabled:opacity-60';

/**
 * Banket eksiğini satın alma talebine çevirir (modül 43 → 45): eksiği olan malzemeler seçili
 * gelir, talep miktarı eksik kadar (ambalaja göre artırılabilir). Sunucu eksiği kilit altında
 * yeniden hesaplar; bu arada değiştiyse talep açılmaz, liste yenilenir.
 *
 * @param {{ scope: { eventId: string } | { from: string, to: string }, rows: any[], onClose: () => void, onCreated?: (request: any) => void }} props
 *   `rows`: ihtiyaç satırları (eksiği olanlar)
 */
export function PurchaseRequestDialog({ scope, rows, onClose, onCreated }) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState(() => rows.map((row) => ({ ...row, selected: true, quantity: row.shortfall })));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});

  const create = useMutation({
    mutationFn: (body) => apiPost('/purchasing/requests/banquet', body),
    onSuccess: (request) => {
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
      toastSuccess(`${request.number} satın alma talebi açıldı · ${request.items.length} malzeme`);
      onCreated?.(request);
      onClose();
    },
    onError: (error) => {
      if (error.code === 'NEEDS_CHANGED') {
        queryClient.invalidateQueries({ queryKey: banquetKeys.all });
        toastError(error.message);
        onClose();
        return;
      }
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
    },
  });

  const chosen = lines.filter((line) => line.selected);
  function submit(event) {
    event.preventDefault();
    const body = {
      ...scope,
      note: note.trim() || null,
      lines: chosen.map((line) => ({ stockItemId: line.stockItemId, quantity: String(line.quantity).trim(), expectedShortfall: line.shortfall })),
    };
    const checked = validateWith(createBanquetPurchaseRequestSchema, body);
    if (!checked.ok) {
      // Satır hataları seçili satırların sırasıyla gelir; ekrandaki satıra eşlenir.
      const mapped = {};
      for (const [path, message] of Object.entries(checked.errors)) {
        const match = /^lines\.(\d+)\./.exec(path);
        mapped[match ? `row.${chosen[Number(match[1])].stockItemId}` : path] = message;
      }
      setErrors(mapped);
      return;
    }
    setErrors({});
    create.mutate(body);
  }

  const busy = create.isPending;
  return (
    <Modal
      open
      size="lg"
      title="Satın alma talebine çevir"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="purchase-request-form" icon="send" disabled={busy || chosen.length === 0}>
            {busy ? 'Açılıyor…' : `Talep aç (${chosen.length})`}
          </Button>
        </>
      }
    >
      <form id="purchase-request-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          Miktar etkinliklere ihtiyaç gününe göre dağıtılır; eksikten fazlası (ambalaj yuvarlaması) en erken ihtiyaca yazılır. Teklif, onay ve sipariş satın alma modülünde.
        </p>
        {errors.lines && <Alert tone="danger">{errors.lines}</Alert>}
        <div className="max-h-[50vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="w-8 py-2" />
                <th className="py-2 pr-2">Malzeme</th>
                <th className="py-2 pr-2 text-right">Eksik</th>
                <th className="py-2 pr-2 text-right">Talep</th>
                <th className="py-2">İhtiyaç</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const error = errors[`row.${line.stockItemId}`];
                return (
                  <tr key={line.stockItemId} className="border-t border-line align-top">
                    <td className="py-2">
                      <input
                        type="checkbox"
                        aria-label={`${line.name} talebe girsin`}
                        checked={line.selected}
                        onChange={(event) => setLines((current) => current.map((entry) => (entry.stockItemId === line.stockItemId ? { ...entry, selected: event.target.checked } : entry)))}
                        disabled={busy}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <span className="block font-semibold text-ink">{line.name}</span>
                      <span className="block text-xs text-ink-muted">{STOCK_ITEM_GROUP_LABELS[line.group]}</span>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{quantityText(line.shortfall, line.unit)}</td>
                    <td className="py-2 pr-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <input
                          aria-label={`${line.name} talep miktarı`}
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(event) => setLines((current) => current.map((entry) => (entry.stockItemId === line.stockItemId ? { ...entry, quantity: event.target.value } : entry)))}
                          disabled={busy || !line.selected}
                          className={`${CELL} ${error ? 'border-sec-strong' : 'border-line-strong'}`}
                        />
                        <span className="text-xs text-ink-muted">{KITCHEN_UNIT_LABELS[line.unit]}</span>
                      </span>
                      {error && <span className="mt-1 block text-xs text-sec-strong">{error}</span>}
                    </td>
                    <td className="py-2 text-xs text-ink-soft">{line.needDay ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Textarea label="Not (isteğe bağlı)" name="purchase-note" rows={2} maxLength={MAX_PURCHASE_NOTE_LENGTH} value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}
