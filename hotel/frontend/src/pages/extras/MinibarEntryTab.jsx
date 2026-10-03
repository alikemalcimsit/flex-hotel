import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MINIBAR_CATEGORIES, MINIBAR_MAX_QUANTITY, MINIBAR_ROOM_RECENT_LIMIT, minibarConsumptionSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon, Input, Spinner } from '@hotelos/ui';
import { api, apiPost } from '../../lib/api.js';
import { POSTING_LABELS, POSTING_TONES, categoryLabel, displayTotals, extrasKeys } from '../../lib/extras.js';
import { formatMoney } from '../../lib/format.js';
import { newRequestId } from '../../lib/reservations.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { RoomFinder, RoomHeader } from './RoomFinder.jsx';

const timeFormatter = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

/**
 * Minibar girişi (modül 19), telefonda kullanılmak üzere: oda numarasını yaz,
 * tüketilen ürünlerin adedini +/− ile gir, kime yazılacağını seç, kaydet.
 * Fiş odadaki (ya da yeni ayrılan) misafirin folyosuna kendiliğinden gider;
 * odada kimse yoksa gerekçeyle kayıp yazılır. Aynı odaya son 24 saatte
 * girilen sayımlar uyarı olarak görünür (iki görevli aynı odayı iki kez yazmasın).
 */
export function MinibarEntryTab() {
  const items = useQuery({ queryKey: extrasKeys.activeMinibar, queryFn: () => api('/extras/minibar/items/active'), staleTime: 60_000 });

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <RoomFinder>{(data, reset) => <MinibarSlip key={data.room.id} data={data} items={items} onDone={reset} />}</RoomFinder>
    </div>
  );
}

/**
 * @param {{ data: any, items: import('@tanstack/react-query').UseQueryResult, onDone: () => void }} props
 */
function MinibarSlip({ data, items, onDone }) {
  const queryClient = useQueryClient();
  const [requestId, setRequestId] = useState(newRequestId);
  const [quantities, setQuantities] = useState(() => new Map());
  const [chargeTo, setChargeTo] = useState(data.inHouse ? 'IN_HOUSE' : data.late.length ? 'LATE' : 'NONE');
  const [lateId, setLateId] = useState(data.late[0]?.id ?? null);
  const [lossReason, setLossReason] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);

  const catalog = useMemo(() => items.data ?? [], [items.data]);
  const selected = catalog.filter((item) => quantities.get(item.id) > 0).map((item) => ({ ...item, quantity: quantities.get(item.id) }));
  const totals = displayTotals(selected);

  const mutation = useMutation({
    mutationFn: (body) => apiPost('/extras/minibar/consumptions', body),
    onSuccess: (result) => {
      const { consumption } = result;
      toastSuccess(
        consumption.chargeTarget === 'NONE'
          ? `Oda ${data.room.number}: ${consumption.reference} kayıp olarak kaydedildi`
          : `Oda ${data.room.number}: ${consumption.reference} kaydedildi; folyoya işleniyor`,
      );
      queryClient.invalidateQueries({ queryKey: extrasKeys.all });
      setRequestId(newRequestId());
      onDone();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STAY_CHANGED') queryClient.invalidateQueries({ queryKey: extrasKeys.room(data.room.number) });
    },
  });
  const busy = mutation.isPending;

  const change = (itemId, delta) =>
    setQuantities((current) => {
      const next = new Map(current);
      next.set(itemId, Math.min(MINIBAR_MAX_QUANTITY, Math.max(0, (next.get(itemId) ?? 0) + delta)));
      return next;
    });

  function submit() {
    setServerError(null);
    const body = {
      requestId,
      roomId: data.room.id,
      chargeTo,
      reservationId: chargeTo === 'IN_HOUSE' ? data.inHouse?.id : chargeTo === 'LATE' ? lateId : null,
      lines: selected.map((item) => ({ itemId: item.id, quantity: item.quantity })),
      lossReason: chargeTo === 'NONE' ? lossReason : null,
      note: note || null,
    };
    const result = validateWith(minibarConsumptionSchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  return (
    <div className="flex flex-col gap-4">
      <RoomHeader data={data} />
      <RecentSlips recent={data.recent} />
      {serverError && <Alert tone={serverError.code === 'STAY_CHANGED' ? 'warning' : 'danger'} title="Kaydedilmedi">{serverError.message}</Alert>}

      <ChargeTarget data={data} chargeTo={chargeTo} onChargeTo={setChargeTo} lateId={lateId} onLateId={setLateId} disabled={busy} />
      {chargeTo === 'NONE' && (
        <Input
          label="Kayıp gerekçesi"
          placeholder="ör. Boş odada eksik bulundu, ikram"
          value={lossReason}
          maxLength={300}
          onChange={(event) => setLossReason(event.target.value)}
          error={errors.lossReason}
          disabled={busy}
        />
      )}

      {items.isPending ? (
        <Spinner className="py-6" />
      ) : items.isError ? (
        <Alert tone="danger" title="Ürünler yüklenemedi">{items.error.message}</Alert>
      ) : catalog.length === 0 ? (
        <EmptyState icon="utensils" title="Minibar ürün listesi boş" description="Ürünler ve fiyatlar Fiyat listeleri sekmesinden girilir." />
      ) : (
        <div className="flex flex-col gap-4">
          {MINIBAR_CATEGORIES.map((category) => {
            const group = catalog.filter((item) => item.category === category);
            if (group.length === 0) return null;
            return (
              <Card key={category} title={categoryLabel(category)}>
                <ul className="flex flex-col divide-y divide-line">
                  {group.map((item) => (
                    <QuantityRow key={item.id} item={item} quantity={quantities.get(item.id) ?? 0} onChange={(delta) => change(item.id, delta)} disabled={busy} />
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      {errors.lines && <p className="text-sm text-sec-strong">{errors.lines}</p>}

      <Input label="Not (isteğe bağlı)" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 sm:mx-0 sm:rounded-panel sm:border">
        <span className="text-sm">
          <span className="font-bold tabular-nums">{totals.count}</span> ürün ·{' '}
          <span className="font-bold tabular-nums">{formatMoney(totals.total)}</span>
          <span className="block text-xs text-ink-muted">Liste fiyatı; vergi folyoda hesaplanır</span>
        </span>
        <Button icon={chargeTo === 'NONE' ? 'alertTriangle' : 'check'} onClick={submit} disabled={busy || totals.count === 0}>
          {busy ? 'Kaydediliyor…' : chargeTo === 'NONE' ? 'Kayıp olarak kaydet' : 'Kaydet, folyoya yaz'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Kime yazılacak: odadaki misafir, yeni ayrılan misafir (geç kalem) ya da kayıp.
 * @param {{ data: any, chargeTo: string, onChargeTo: (value: string) => void, lateId: string | null, onLateId: (id: string) => void, disabled: boolean }} props
 */
function ChargeTarget({ data, chargeTo, onChargeTo, lateId, onLateId, disabled }) {
  const options = [
    ...(data.inHouse ? [{ value: 'IN_HOUSE', label: `Odadaki misafir — ${data.inHouse.guestName}` }] : []),
    ...(data.late.length ? [{ value: 'LATE', label: 'Odadan ayrılan misafir (geç kalem)' }] : []),
    { value: 'NONE', label: 'Kimseye yazma (kayıp)' },
  ];
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold text-ink">Kime yazılsın?</legend>
      {options.map((option) => (
        <label key={option.value} className="flex min-h-11 items-center gap-3 rounded-item border border-line px-3 py-2 text-sm has-[:checked]:border-ink">
          <input type="radio" name="charge-to" value={option.value} checked={chargeTo === option.value} onChange={() => onChargeTo(option.value)} className="size-4 accent-[var(--color-ink)]" />
          {option.label}
        </label>
      ))}
      {chargeTo === 'LATE' && (
        <div className="ml-7 flex flex-col gap-1.5">
          {data.late.map((stay) => (
            <label key={stay.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="late-stay" checked={lateId === stay.id} onChange={() => onLateId(stay.id)} className="size-4 accent-[var(--color-ink)]" />
              <span>
                <span className="font-semibold">{stay.guestName}</span> · {stay.confirmationCode} ·{' '}
                {stay.reason === 'MOVED' ? `oda ${stay.roomNumber} odasına taşındı` : `çıkış ${timeFormatter.format(new Date(stay.checkedOutAt))}`}
              </span>
            </label>
          ))}
          <p className="text-xs text-ink-muted">Misafirin folyosu kapandıysa iş folyo yetkilisine görev olarak düşer.</p>
        </div>
      )}
    </fieldset>
  );
}

/**
 * Ürün satırı: büyük +/− düğmeleri (telefonda parmakla).
 * @param {{ item: any, quantity: number, onChange: (delta: number) => void, disabled: boolean }} props
 */
function QuantityRow({ item, quantity, onChange, disabled }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{item.name}</span>
        <span className="text-xs text-ink-muted">
          {formatMoney(item.price)} · standart {item.parLevel}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`${item.name} azalt`}
          disabled={disabled || quantity === 0}
          onClick={() => onChange(-1)}
          className="grid size-11 place-items-center rounded-item border border-line-strong text-lg font-bold disabled:opacity-40"
        >
          −
        </button>
        <span className={`w-8 text-center text-lg font-bold tabular-nums ${quantity ? 'text-ink' : 'text-ink-muted'}`} aria-live="polite">
          {quantity}
        </span>
        <button
          type="button"
          aria-label={`${item.name} artır`}
          disabled={disabled || quantity >= MINIBAR_MAX_QUANTITY}
          onClick={() => onChange(1)}
          className="grid size-11 place-items-center rounded-item border border-ink bg-ink text-lg font-bold text-white disabled:opacity-40"
        >
          +
        </button>
      </span>
    </li>
  );
}

/**
 * Bu odaya son 24 saatte girilen sayımlar (çift girişe karşı).
 * @param {{ recent: any[] }} props
 */
function RecentSlips({ recent }) {
  if (recent.length === 0) return null;
  return (
    <Alert tone="warning" title={`Bu odaya son 24 saatte ${recent.length}${recent.length >= MINIBAR_ROOM_RECENT_LIMIT ? '+' : ''} sayım girildi`}>
      <span className="block">Aynı tüketimi ikinci kez girmeyin; düzeltme folyodaki kalem iptaliyle yapılır.</span>
      <ul className="mt-2 flex flex-col gap-1">
        {recent.map((slip) => (
          <li key={slip.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Icon name="clock" className="size-3.5" />
            <span className="tabular-nums">{timeFormatter.format(new Date(slip.recordedAt))}</span>
            <span>{slip.recordedBy}</span>
            <span className="text-ink-muted">{slip.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')}</span>
            <Badge tone={POSTING_TONES[slip.posting.status]}>{POSTING_LABELS[slip.posting.status]}</Badge>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
