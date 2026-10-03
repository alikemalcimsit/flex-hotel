import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  LAUNDRY_EXPRESS_DUE_HOURS,
  LAUNDRY_MAX_QUANTITY,
  LAUNDRY_SERVICES,
  LAUNDRY_STANDARD_DUE_HOURS,
  laundryLinesSchema,
  laundryOrderSchema,
  laundryStatusSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, EmptyState, Input, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, apiPut } from '../../lib/api.js';
import { displayTotals, extrasKeys, serviceLabel, toLocalInput } from '../../lib/extras.js';
import { formatMoney } from '../../lib/format.js';
import { newRequestId } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { RoomFinder, RoomHeader } from './RoomFinder.jsx';

const CANCEL_REASONS = Object.freeze(['Misafir vazgeçti', 'Yanlış sipariş girildi', 'Parçalar teslim alınmadı']);

/** Şimdiden itibaren saat sonrası (formun önerdiği teslim zamanı). */
const hoursFromNow = (hours) => toLocalInput(new Date(Date.now() + hours * 60 * 60 * 1000));

/**
 * Parça listesi: hizmete göre gruplu, büyük +/− (telefonda).
 * @param {{ items: any[], quantities: Map<string, number>, onChange: (id: string, delta: number) => void, disabled: boolean }} props
 */
function LinesEditor({ items, quantities, onChange, disabled }) {
  if (items.length === 0) {
    return <EmptyState icon="layers" title="Çamaşır fiyat listesi boş" description="Parçalar ve fiyatlar Fiyat listeleri sekmesinden girilir." />;
  }
  return (
    <div className="flex flex-col gap-3">
      {LAUNDRY_SERVICES.map((service) => {
        const group = items.filter((item) => item.service === service);
        if (group.length === 0) return null;
        return (
          <div key={service}>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{serviceLabel(service)}</p>
            <ul className="flex flex-col divide-y divide-line rounded-item border border-line">
              {group.map((item) => {
                const quantity = quantities.get(item.id) ?? 0;
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0 text-sm">
                      <span className="font-semibold">{item.name}</span>
                      <span className="ml-2 text-xs text-ink-muted">{formatMoney(item.price)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <button type="button" aria-label={`${item.name} azalt`} disabled={disabled || quantity === 0} onClick={() => onChange(item.id, -1)} className="grid size-10 place-items-center rounded-item border border-line-strong font-bold disabled:opacity-40">−</button>
                      <span className="w-7 text-center font-bold tabular-nums">{quantity}</span>
                      <button type="button" aria-label={`${item.name} artır`} disabled={disabled || quantity >= LAUNDRY_MAX_QUANTITY} onClick={() => onChange(item.id, 1)} className="grid size-10 place-items-center rounded-item border border-ink bg-ink font-bold text-white disabled:opacity-40">+</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** @param {Map<string, number>} current @param {string} id @param {number} delta */
function stepped(current, id, delta) {
  const next = new Map(current);
  next.set(id, Math.min(LAUNDRY_MAX_QUANTITY, Math.max(0, (next.get(id) ?? 0) + delta)));
  return next;
}

/**
 * Yeni çamaşır siparişi: oda aç (odada misafir olmalı), parçaları say,
 * ekspres / teslim zamanı. Ücret teslimde folyoya düşer.
 * @param {{ onClose: () => void, onDone: () => void }} props
 */
export function NewLaundryOrderDialog({ onClose, onDone }) {
  const catalog = useQuery({ queryKey: extrasKeys.activeLaundry, queryFn: () => api('/extras/laundry/items/active'), staleTime: 60_000 });
  return (
    <Modal open size="lg" title="Yeni çamaşır siparişi" onClose={onClose}>
      <RoomFinder>
        {(data) =>
          data.inHouse ? (
            <OrderForm key={data.room.id} data={data} catalog={catalog} onClose={onClose} onDone={onDone} />
          ) : (
            <>
              <RoomHeader data={data} />
              <Alert tone="warning" title="Odada konaklayan misafir yok">Çamaşır siparişi içerideki misafir adına alınır.</Alert>
            </>
          )
        }
      </RoomFinder>
    </Modal>
  );
}

/**
 * @param {{ data: any, catalog: import('@tanstack/react-query').UseQueryResult, onClose: () => void, onDone: () => void }} props
 */
function OrderForm({ data, catalog, onClose, onDone }) {
  const [requestId] = useState(newRequestId);
  const [quantities, setQuantities] = useState(() => new Map());
  const [express, setExpress] = useState(false);
  const [dueAt, setDueAt] = useState(() => hoursFromNow(LAUNDRY_STANDARD_DUE_HOURS));
  const [dueTouched, setDueTouched] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);

  const items = useMemo(() => catalog.data?.items ?? [], [catalog.data]);
  const expressPct = catalog.data?.settings?.expressPct ?? '0';
  const selected = items.filter((item) => quantities.get(item.id) > 0).map((item) => ({ ...item, quantity: quantities.get(item.id) }));
  const totals = displayTotals(selected, express ? expressPct : null);

  const mutation = useMutation({
    mutationFn: (body) => apiPost('/extras/laundry/orders', body),
    onSuccess: (result) => {
      toastSuccess(`${result.order.reference} alındı (oda ${data.room.number}); ücret teslimde folyoya yazılır`);
      onDone();
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields) setErrors(error.fields);
    },
  });
  const busy = mutation.isPending;

  function toggleExpress(next) {
    setExpress(next);
    // Kişi teslim zamanını kendisi değiştirmediyse ekspres / standart süreye göre öner.
    if (!dueTouched) setDueAt(hoursFromNow(next ? LAUNDRY_EXPRESS_DUE_HOURS : LAUNDRY_STANDARD_DUE_HOURS));
  }

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const body = {
      requestId,
      roomId: data.room.id,
      reservationId: data.inHouse.id,
      express,
      dueAt: dueAt ? new Date(dueAt).toISOString() : '',
      lines: selected.map((item) => ({ itemId: item.id, quantity: item.quantity })),
      note: note || null,
    };
    const result = validateWith(laundryOrderSchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <RoomHeader data={data} />
      {serverError && <Alert tone="danger" title="Sipariş alınmadı">{serverError.message}</Alert>}
      {catalog.isPending ? (
        <Spinner className="py-4" />
      ) : catalog.isError ? (
        <Alert tone="danger" title="Fiyat listesi yüklenemedi">{catalog.error.message}</Alert>
      ) : (
        <LinesEditor items={items} quantities={quantities} onChange={(id, delta) => setQuantities((current) => stepped(current, id, delta))} disabled={busy} />
      )}
      {errors.lines && <p className="text-sm text-sec-strong">{errors.lines}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Checkbox
          label={`Ekspres (+%${String(expressPct).replace('.', ',')})`}
          hint="Aynı gün teslim; fark folyoya ayrı satır olarak yazılır"
          checked={express}
          onChange={(event) => toggleExpress(event.target.checked)}
          disabled={busy}
        />
        <Input
          label="Teslim zamanı"
          type="datetime-local"
          value={dueAt}
          onChange={(event) => {
            setDueAt(event.target.value);
            setDueTouched(true);
          }}
          error={errors.dueAt}
          disabled={busy}
        />
      </div>
      <Textarea label="Not (leke, hasar, özel istek)" rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-sm">
          <span className="font-bold tabular-nums">{totals.count}</span> parça · <span className="font-bold tabular-nums">{formatMoney(totals.total)}</span>
          {express && Number(totals.surcharge) > 0 && <span className="ml-1 text-xs text-ink-muted">(ekspres farkı {formatMoney(totals.surcharge)} dahil)</span>}
          <span className="block text-xs text-ink-muted">Liste fiyatı; vergi folyoda hesaplanır. Ücret teslimde folyoya yazılır.</span>
        </span>
        <span className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" icon="check" disabled={busy || totals.count === 0}>{busy ? 'Kaydediliyor…' : 'Siparişi al'}</Button>
        </span>
      </div>
    </form>
  );
}

/**
 * Sayım düzeltmesi (alındı / yıkamada iken): parça adetleri. Siparişte olan
 * parça eski fiyatını korur (sunucu); pasife alınmış parça da sayılabilir.
 * @param {{ order: any, onClose: () => void, onDone: () => void }} props
 */
export function RecountDialog({ order, onClose, onDone }) {
  const catalog = useQuery({ queryKey: extrasKeys.activeLaundry, queryFn: () => api('/extras/laundry/items/active'), staleTime: 60_000 });
  const [quantities, setQuantities] = useState(() => new Map(order.lines.map((line) => [line.itemId, line.quantity])));
  const [note, setNote] = useState(order.note ?? '');
  const [error, setError] = useState(null);
  // Siparişteki satırlar (eski fiyatlarıyla) + listede olup siparişte olmayanlar.
  const items = useMemo(() => {
    const existing = order.lines.map((line) => ({ id: line.itemId, name: line.name, service: line.service, price: line.unitPrice }));
    const known = new Set(existing.map((item) => item.id));
    return [...existing, ...(catalog.data?.items ?? []).filter((item) => !known.has(item.id))];
  }, [order.lines, catalog.data]);

  const mutation = useMutation({
    mutationFn: (body) => apiPut(`/extras/laundry/orders/${order.id}/lines`, body),
    onSuccess: () => {
      toastSuccess(`${order.reference} sayımı güncellendi`);
      onDone();
      onClose();
    },
    onError: (failure) => setError(failure),
  });
  const busy = mutation.isPending;

  function submit(event) {
    event.preventDefault();
    const body = {
      expectedUpdatedAt: order.updatedAt,
      lines: [...quantities.entries()].filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => ({ itemId, quantity })),
      note: note || null,
    };
    const result = validateWith(laundryLinesSchema, body);
    if (!result.ok) {
      setError({ message: result.errors.lines ?? Object.values(result.errors)[0] });
      return;
    }
    mutation.mutate(body);
  }

  return (
    <Modal
      open
      size="lg"
      title={`Sayım — ${order.reference} · oda ${order.roomNumber}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="recount-form" icon="check" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Sayımı kaydet'}</Button>
        </>
      }
    >
      <form id="recount-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone={error.code === 'STALE_WRITE' ? 'warning' : 'danger'} title="Kaydedilmedi">{error.message}</Alert>}
        <LinesEditor items={items} quantities={quantities} onChange={(id, delta) => setQuantities((current) => stepped(current, id, delta))} disabled={busy} />
        <Textarea label="Not" rows={2} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} />
      </form>
    </Modal>
  );
}

/**
 * Durum geçişi: iptal gerekçe ister; teslim onay ister (ücret folyoya yazılır).
 * @param {{ order: any, status: 'IN_PROCESS' | 'READY' | 'DELIVERED' | 'CANCELLED', onClose: () => void, onDone: () => void }} props
 */
export function StatusDialog({ order, status, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const mutation = useMutation({
    mutationFn: (body) => apiPost(`/extras/laundry/orders/${order.id}/status`, body),
    onSuccess: (updated) => {
      toastSuccess(
        status === 'DELIVERED'
          ? `${order.reference} teslim edildi; ${formatMoney(updated.total)} folyoya yazılıyor`
          : status === 'CANCELLED'
            ? `${order.reference} iptal edildi`
            : `${order.reference} güncellendi`,
      );
      onDone();
      onClose();
    },
    onError: (failure) => setError(failure),
  });
  const busy = mutation.isPending;
  const cancelling = status === 'CANCELLED';

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: order.updatedAt, status, reason: cancelling ? reason : null };
    const result = validateWith(laundryStatusSchema, body);
    if (!result.ok) {
      setError({ message: result.errors.reason ?? Object.values(result.errors)[0] });
      return;
    }
    mutation.mutate(body);
  }

  return (
    <Modal
      open
      size="sm"
      title={cancelling ? `İptal — ${order.reference}` : `Teslim — ${order.reference}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="laundry-status-form" variant={cancelling ? 'danger' : 'primary'} icon={cancelling ? 'close' : 'check'} disabled={busy}>
            {busy ? 'Kaydediliyor…' : cancelling ? 'İptal et' : 'Teslim et'}
          </Button>
        </>
      }
    >
      <form id="laundry-status-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {error && <Alert tone={error.code === 'STALE_WRITE' ? 'warning' : 'danger'} title="Kaydedilmedi">{error.message}</Alert>}
        <p className="text-sm text-ink-soft">
          Oda {order.roomNumber} · {order.stay.guestName} · {order.itemCount} parça · <span className="font-bold">{formatMoney(order.total)}</span>
        </p>
        {cancelling ? (
          <>
            <p className="text-xs text-ink-muted">İptal edilen sipariş folyoya yazılmaz.</p>
            <ChoiceChips label="Hazır gerekçeler" options={CANCEL_REASONS.map((value) => ({ value, label: value }))} value={reason} onChange={setReason} disabled={busy} />
            <Textarea label="Gerekçe" rows={2} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
          </>
        ) : (
          <p className="text-sm">
            Teslim edilince ücret misafirin folyosuna yazılır{order.stay.status === 'CHECKED_OUT' ? ' (misafir çıkış yapmış: açık folyosu yoksa folyo yetkilisine görev düşer)' : ''}.
          </p>
        )}
      </form>
    </Modal>
  );
}
