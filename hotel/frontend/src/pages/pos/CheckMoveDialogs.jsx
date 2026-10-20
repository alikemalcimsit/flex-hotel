import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, EmptyState, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { posKeys } from '../../lib/pos.js';
import { selectionTotal, splitLines } from '../../lib/posCart.js';
import { toastError } from '../../store/toast.js';

/**
 * Adisyonu bölme, taşıma, birleştirme ve devir diyalogları (modül 39). Hepsi ekranın
 * gördüğü sürümle gönderilir: arada adisyon değiştiyse sunucu reddeder, ekran tazelenir.
 */

/** @param {{ title: string, busy: boolean, onClose: () => void, onConfirm: () => void, confirmLabel: string, disabled?: boolean, children: React.ReactNode, size?: 'sm' | 'md' }} props */
function ChoiceDialog({ title, busy, onClose, onConfirm, confirmLabel, disabled = false, children, size = 'sm' }) {
  return (
    <Modal
      open
      size={size}
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="button" icon="check" onClick={onConfirm} disabled={busy || disabled}>
            {busy ? 'İşleniyor…' : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/** Seçim listesi düğmesi. @param {{ selected: boolean, onClick: () => void, children: React.ReactNode }} props */
function Option({ selected, onClick, children }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-item border px-3 py-2.5 text-left text-sm ${selected ? 'border-ink bg-surface-muted font-semibold' : 'border-line hover:border-ink'}`}
    >
      {children}
    </button>
  );
}

/**
 * Bölme: her kalemden yeni adisyona taşınacak adet (serbest adedi kadar; ikram / iptal /
 * onay bekleyen hariç). Yeni adisyon aynı masada, aynı garsonda açılır.
 * @param {{ check: any, onClose: () => void, onDone: (result: { source: any, target: any }) => void }} props
 */
export function SplitDialog({ check, onClose, onDone }) {
  const movable = check.lines.filter((line) => line.freeQuantity > 0);
  const [selection, setSelection] = useState({});
  const split = useMutation({
    mutationFn: () => apiPost(`/pos/checks/${check.id}/split`, { expectedUpdatedAt: check.updatedAt, lines: splitLines(selection) }),
    onSuccess: onDone,
    onError: (error) => toastError(error.message),
  });
  const step = (line, delta) =>
    setSelection((current) => ({ ...current, [line.id]: Math.max(0, Math.min(line.freeQuantity, (current[line.id] ?? 0) + delta)) }));
  const chosen = splitLines(selection);
  return (
    <ChoiceDialog title="Adisyonu böl" busy={split.isPending} onClose={onClose} onConfirm={() => split.mutate()} confirmLabel="Yeni adisyona taşı" disabled={chosen.length === 0} size="md">
      {movable.length === 0 ? (
        <EmptyState icon="list" title="Taşınacak kalem yok" description="İkram, iptal ya da onay bekleyen kalemler taşınmaz." />
      ) : (
        <ul className="flex flex-col gap-2">
          {movable.map((line) => (
            <li key={line.id} className="flex items-center gap-3 rounded-item border border-line px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <strong>{line.name}</strong> <span className="text-ink-muted">· {line.freeQuantity} adet · {formatMoney(line.unitPrice)}</span>
              </span>
              <Button type="button" size="sm" variant="outline" aria-label={`${line.name} bir azalt`} onClick={() => step(line, -1)} disabled={!selection[line.id]}>
                −
              </Button>
              <span className="w-6 text-center font-bold tabular-nums">{selection[line.id] ?? 0}</span>
              <Button type="button" size="sm" variant="outline" icon="plus" aria-label={`${line.name} bir artır`} onClick={() => step(line, 1)} disabled={(selection[line.id] ?? 0) >= line.freeQuantity} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-ink-soft">
        Yeni adisyona giden: <strong className="tabular-nums text-ink">{formatMoney(selectionTotal(check.lines, selection), check.currency)}</strong> (indirim ve vergi yeniden hesaplanır). Alınan ödemeler bu adisyonda kalır.
      </p>
    </ChoiceDialog>
  );
}

/**
 * Taşıma: aynı satış noktasının başka masası ya da masasız.
 * @param {{ check: any, tables: Array<{ id: string, name: string, outletId: string, zone: string | null }>, onClose: () => void, onDone: (check: any) => void }} props
 */
export function MoveDialog({ check, tables, onClose, onDone }) {
  const options = useMemo(() => tables.filter((table) => table.outletId === check.outletId && table.id !== check.tableId), [tables, check.outletId, check.tableId]);
  const [tableId, setTableId] = useState(undefined);
  const move = useMutation({
    mutationFn: () => apiPost(`/pos/checks/${check.id}/move`, { expectedUpdatedAt: check.updatedAt, tableId }),
    onSuccess: onDone,
    onError: (error) => toastError(error.message),
  });
  return (
    <ChoiceDialog title="Başka masaya taşı" busy={move.isPending} onClose={onClose} onConfirm={() => move.mutate()} confirmLabel="Taşı" disabled={tableId === undefined}>
      <div role="radiogroup" aria-label="Masalar" className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
        {check.tableId && (
          <Option selected={tableId === null} onClick={() => setTableId(null)}>
            Masasız
          </Option>
        )}
        {options.map((table) => (
          <Option key={table.id} selected={tableId === table.id} onClick={() => setTableId(table.id)}>
            {table.name}
          </Option>
        ))}
      </div>
    </ChoiceDialog>
  );
}

/**
 * Birleştirme: aynı satış noktasının başka açık adisyonu bu adisyona katılır (kalemleri ve
 * kişileri). Ödemesi ya da onay bekleyen işi olan adisyon birleştirilmez.
 * @param {{ check: any, onClose: () => void, onDone: (check: any) => void }} props
 */
export function MergeDialog({ check, onClose, onDone }) {
  const floor = useQuery({ queryKey: posKeys.floor(check.outletId), queryFn: () => api(withQuery('/pos/floor', { outletId: check.outletId })) });
  const candidates = useMemo(() => {
    if (!floor.data) return [];
    return [...floor.data.tables.flatMap((table) => table.checks.map((entry) => ({ ...entry, tableName: table.name }))), ...floor.data.tableless].filter((entry) => entry.id !== check.id);
  }, [floor.data, check.id]);
  const [sourceCheckId, setSource] = useState(null);
  const merge = useMutation({
    mutationFn: () => apiPost(`/pos/checks/${check.id}/merge`, { expectedUpdatedAt: check.updatedAt, sourceCheckId }),
    onSuccess: onDone,
    onError: (error) => toastError(error.message),
  });
  return (
    <ChoiceDialog title="Başka adisyonu buna kat" busy={merge.isPending} onClose={onClose} onConfirm={() => merge.mutate()} confirmLabel="Birleştir" disabled={!sourceCheckId}>
      {floor.isPending && <Spinner className="py-4" />}
      {floor.isError && <Alert tone="danger" title="Adisyonlar okunamadı">{floor.error.message}</Alert>}
      {floor.isSuccess && candidates.length === 0 && <EmptyState icon="list" title="Birleştirilecek adisyon yok" description="Bu satış noktasında başka açık adisyon yok." />}
      <div role="radiogroup" aria-label="Açık adisyonlar" className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {candidates.map((entry) => (
          <Option key={entry.id} selected={sourceCheckId === entry.id} onClick={() => setSource(entry.id)}>
            <span>
              {entry.number} · {entry.tableName ? `masa ${entry.tableName}` : 'masasız'} · {entry.covers} kişi
            </span>
            <span className="tabular-nums">{formatMoney(entry.grandTotal, check.currency)}</span>
          </Option>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-muted">Seçilen adisyon kapanır (iptal: birleştirildi); kalemleri ve ikram / iptal kayıtları buraya taşınır.</p>
    </ChoiceDialog>
  );
}

/**
 * Devir: açık vardiyası olan garsonlardan biri. Kendi adisyonunu garson, başkasınınkini
 * şef garson devreder (sunucu denetler).
 * @param {{ check: any, onClose: () => void, onDone: (check: any) => void }} props
 */
export function TransferDialog({ check, onClose, onDone }) {
  const waiters = useQuery({ queryKey: posKeys.openWaiters, queryFn: () => api('/pos/shifts/open-waiters') });
  const options = (waiters.data?.waiters ?? []).filter((waiter) => waiter.waiterEmail !== check.waiterEmail);
  const [waiterEmail, setWaiter] = useState(null);
  const transfer = useMutation({
    mutationFn: () => apiPost(`/pos/checks/${check.id}/transfer`, { expectedUpdatedAt: check.updatedAt, waiterEmail }),
    onSuccess: onDone,
    onError: (error) => toastError(error.message),
  });
  return (
    <ChoiceDialog title="Adisyonu devret" busy={transfer.isPending} onClose={onClose} onConfirm={() => transfer.mutate()} confirmLabel="Devret" disabled={!waiterEmail}>
      {waiters.isPending && <Spinner className="py-4" />}
      {waiters.isError && <Alert tone="danger" title="Garsonlar okunamadı">{waiters.error.message}</Alert>}
      {waiters.isSuccess && options.length === 0 && <EmptyState icon="users" title="Açık vardiyalı başka garson yok" description="Devralacak garson önce vardiya açmalı." />}
      <div role="radiogroup" aria-label="Garsonlar" className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {options.map((waiter) => (
          <Option key={waiter.shiftId} selected={waiterEmail === waiter.waiterEmail} onClick={() => setWaiter(waiter.waiterEmail)}>
            <span>{waiter.name}</span>
            <span className="text-xs text-ink-muted">{waiter.outletName ?? waiter.waiterEmail}</span>
          </Option>
        ))}
      </div>
    </ChoiceDialog>
  );
}
