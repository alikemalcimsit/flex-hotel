import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  blockRoomSchema,
  ROOM_BLOCK_TYPE_HINTS,
  ROOM_BLOCK_TYPE_LABELS,
  ROOM_BLOCK_TYPES,
} from '@hotelos/hotel-contracts';
import { Alert, Button, EmptyState, ERROR_CLASS, Icon, Input, LABEL_CLASS, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { BlockTypeBadge } from '../../components/RoomStateBadges.jsx';
import { api, apiDelete, apiPost, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Modal içindeki listede bir sayfada gösterilen kayıt. */
const BLOCK_PAGE_SIZE = 5;

const SCOPES = Object.freeze([
  { value: 'ACTIVE', label: 'Süren ve yaklaşan' },
  { value: 'PAST', label: 'Geçmiş' },
]);

const STATE_LABELS = Object.freeze({
  CURRENT: 'Sürüyor',
  UPCOMING: 'Başlayacak',
  ENDED: 'Bitti',
});

/** Kaldırma düğmesinin adı: başlamamış kayıt iptal edilir, süren kayıt bugün biter. */
const REMOVAL_ACTIONS = Object.freeze({
  CANCEL: { label: 'İptal et', confirm: 'İptal et' },
  END: { label: 'Bugün bitir', confirm: 'Bugün bitir' },
});

/**
 * Bir odanın arıza kayıtları: liste, yeni kayıt, bitirme/iptal.
 *
 * Eskiden panelde oda bloklanabiliyor ama blok hiçbir yerde görünmüyor ve
 * kaldırılamıyordu — bloklanan oda arayüzden bir daha açılamıyordu.
 *
 * Geçmiş kayıtlar değişmez: süren kayıt "bitirilir" (bu geceden itibaren oda
 * açılır, önceki geceler arızalı kalır), başlamamış kayıt iptal edilir.
 *
 * @param {{ room: { id: string, number: string }, canManage: boolean, onClose: () => void }} props
 */
export function RoomBlocksModal({ room, canManage, onClose }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [removing, setRemoving] = useState(null);

  const listQuery = useQuery({
    queryKey: ['rooms', 'blocks', room.id, { scope, page }],
    queryFn: () => api(withQuery('/rooms/blocks', { roomId: room.id, scope, page, pageSize: BLOCK_PAGE_SIZE })),
    placeholderData: keepPreviousData,
  });

  // Oda listesi (arıza sütunu, açık kayıt sayısı) ve müsaitlik de değişir.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rooms'] });

  const removeMutation = useMutation({
    mutationFn: (block) => apiDelete(`/rooms/blocks/${block.id}`),
    onSuccess: (result, block) => {
      if (result.mode === 'CANCELLED') {
        toastSuccess('Kayıt iptal edildi');
      } else {
        // Sunucu yalnızca arızalı (satış dışı) kaydı bitince odayı kirli yapar.
        toastSuccess(
          block.type === 'OUT_OF_ORDER'
            ? 'Kayıt bugün itibarıyla bitirildi; oda kirli işaretlendi'
            : 'Kayıt bugün itibarıyla bitirildi',
        );
      }
      setRemoving(null);
      refresh();
    },
  });

  const items = listQuery.data?.items ?? [];
  const meta = listQuery.data?.meta;

  function changeScope(next) {
    setScope(next);
    setPage(1);
    setShowForm(false);
  }

  return (
    <>
      <Modal
        open
        size="lg"
        title={`${room.number} numaralı oda — arıza kayıtları`}
        onClose={onClose}
        footer={
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        }
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Kayıt kapsamı" className="inline-flex gap-1 rounded-control border border-line p-1">
            {SCOPES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={scope === option.value}
                onClick={() => changeScope(option.value)}
                className={`rounded-item px-3.5 py-1.5 text-sm font-semibold transition-colors duration-200 ${
                  scope === option.value ? 'bg-ink text-white' : 'text-ink-muted hover:bg-black/[0.04] hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {canManage && scope === 'ACTIVE' && !showForm && (
            <Button size="sm" icon="plus" onClick={() => setShowForm(true)}>
              Yeni kayıt
            </Button>
          )}
        </div>

        {showForm && (
          <NewBlockForm
            roomId={room.id}
            onCancel={() => setShowForm(false)}
            onCreated={() => {
              setShowForm(false);
              setPage(1);
              refresh();
            }}
          />
        )}

        {listQuery.isPending && <Spinner className="py-8" />}

        {listQuery.isError && (
          <Alert
            tone="danger"
            title="Kayıtlar yüklenemedi"
            action={
              <Button variant="outline" size="sm" icon="refresh" onClick={() => listQuery.refetch()}>
                Tekrar dene
              </Button>
            }
          >
            {listQuery.error.message}
          </Alert>
        )}

        {listQuery.data && items.length === 0 && (
          <EmptyState
            icon="checkCircle"
            title={scope === 'ACTIVE' ? 'Süren ya da yaklaşan arıza kaydı yok' : 'Geçmiş arıza kaydı yok'}
            description={scope === 'ACTIVE' ? 'Oda hizmette; satılabilir ve misafire verilebilir.' : undefined}
          />
        )}

        {items.length > 0 && (
          <ul className={`flex flex-col gap-2.5 transition-opacity duration-200 ${listQuery.isFetching ? 'opacity-60' : ''}`}>
            {items.map((block) => {
              const action = canManage ? REMOVAL_ACTIONS[block.removal] : null;
              return (
                <li key={block.id} className="flex flex-wrap items-start justify-between gap-3 rounded-panel border border-line px-4 py-3.5">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <BlockTypeBadge type={block.type} />
                      <span className="text-xs font-bold text-ink-muted">{STATE_LABELS[block.state]}</span>
                    </div>
                    <p className="text-sm font-semibold text-ink">
                      {formatDate(block.startDate)} → {block.endDate ? formatDate(block.endDate) : 'süresiz'}
                      {block.endDate && <span className="font-normal text-ink-muted"> (bitiş günü dahil değil)</span>}
                    </p>
                    <p className="text-sm text-ink-soft">{block.reason}</p>
                    <p className="text-xs text-ink-muted">Açan: {block.createdBy}</p>
                  </div>
                  {action && (
                    <Button variant="dangerSoft" size="sm" onClick={() => setRemoving(block)}>
                      {action.label}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {meta && meta.totalPages > 1 && (
          <nav aria-label="Kayıt sayfaları" className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-ink-muted">Toplam {meta.total} kayıt</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Önceki
              </Button>
              <span className="text-sm font-semibold text-ink-soft" aria-live="polite">
                {meta.page} / {meta.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
                Sonraki
                <Icon name="chevronRight" className="size-3.5" />
              </Button>
            </div>
          </nav>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title={removing?.removal === 'END' ? 'Kaydı bugün bitir' : 'Kaydı iptal et'}
        message={
          removing?.removal === 'END'
            ? `Kayıt bugün itibarıyla biter; oda bu geceden itibaren misafire verilebilir${
                removing?.type === 'OUT_OF_ORDER' ? ' ve temizlik için kirli işaretlenir' : ''
              }. Önceki geceler "${ROOM_BLOCK_TYPE_LABELS[removing?.type]}" olarak kalır.`
            : 'Henüz başlamamış kayıt tamamen iptal edilir.'
        }
        confirmLabel={removing ? REMOVAL_ACTIONS[removing.removal]?.confirm : undefined}
        isPending={removeMutation.isPending}
        error={removeMutation.error}
        onClose={() => {
          setRemoving(null);
          removeMutation.reset();
        }}
        onConfirm={() => removeMutation.mutate(removing)}
      />
    </>
  );
}

/**
 * @param {{ roomId: string, onCancel: () => void, onCreated: () => void }} props
 */
function NewBlockForm({ roomId, onCancel, onCreated }) {
  const { today } = useHotelToday();
  const [form, setForm] = useState({ type: 'OUT_OF_ORDER', startDate: today, endDate: '', reason: '' });
  const [errors, setErrors] = useState({});

  const createMutation = useMutation({
    mutationFn: (values) => apiPost(`/rooms/${roomId}/blocks`, values),
    onSuccess: () => {
      toastSuccess('Arıza kaydı açıldı');
      onCreated();
    },
    onError: (error) => {
      if (error.details?.field) setErrors({ [error.details.field]: error.message });
      if (!['HAS_RESERVATIONS', 'WOULD_OVERBOOK'].includes(error.code)) toastError(error.message);
    },
  });

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    const values = { ...form, endDate: form.endDate || null };
    const result = validateWith(blockRoomSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (form.startDate < today) {
      setErrors({ startDate: 'Kayıt bugünden önce başlayamaz' });
      return;
    }
    setErrors({});
    createMutation.mutate(values);
  }

  const failure = createMutation.error;

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-panel border border-line bg-surface-muted p-5" noValidate>
      <fieldset>
        <legend className={LABEL_CLASS}>Kayıt tipi</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {ROOM_BLOCK_TYPES.map((type) => {
            const selected = form.type === type;
            return (
              <label
                key={type}
                className={`flex cursor-pointer gap-3 rounded-control border bg-surface p-3.5 transition-colors duration-200 ${
                  selected ? 'border-ink ring-[3px] ring-black/[0.06]' : 'border-line hover:border-line-strong'
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={type}
                  checked={selected}
                  onChange={setField('type')}
                  className="mt-1 size-4 accent-[var(--color-ink)]"
                />
                <span>
                  <span className="block text-sm font-bold text-ink">{ROOM_BLOCK_TYPE_LABELS[type]}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{ROOM_BLOCK_TYPE_HINTS[type]}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.type && <p className={`mt-2 ${ERROR_CLASS}`}>{errors.type}</p>}
      </fieldset>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Input
          label="Başlangıç"
          name="startDate"
          type="date"
          min={today}
          value={form.startDate}
          onChange={setField('startDate')}
          error={errors.startDate}
        />
        <Input
          label="Bitiş (boş = süresiz)"
          name="endDate"
          type="date"
          min={form.startDate || today}
          value={form.endDate}
          onChange={setField('endDate')}
          error={errors.endDate}
        />
        <Input
          label="Sebep"
          name="reason"
          value={form.reason}
          onChange={setField('reason')}
          error={errors.reason}
          placeholder="Su basması, klima arızası, boya…"
          className="sm:col-span-2"
        />
      </div>

      {failure?.code === 'HAS_RESERVATIONS' && (
        <Alert tone="danger" className="mt-5" title={failure.message}>
          <ul className="mt-1 list-inside list-disc text-xs">
            {failure.details.reservations.map((item) => (
              <li key={item.confirmationCode}>
                {item.confirmationCode}: {formatDate(item.checkIn)} → {formatDate(item.checkOut)}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {failure?.code === 'WOULD_OVERBOOK' && (
        <Alert tone="danger" className="mt-5" title="Bu kayıt overbooking'e yol açar">
          <p>{failure.message}</p>
          <ul className="mt-2 list-inside list-disc text-xs">
            {failure.details.nights.map((night) => (
              <li key={`${night.roomTypeId}-${night.day}`}>
                {formatDate(night.day)} ({night.roomTypeCode}): {night.sellable} satılabilir oda, {night.demand} rezervasyon
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <Button variant="outline" onClick={onCancel} disabled={createMutation.isPending} type="button">
          Vazgeç
        </Button>
        <Button type="submit" icon="lock" disabled={createMutation.isPending}>
          {createMutation.isPending ? 'Kaydediliyor…' : 'Kaydı aç'}
        </Button>
      </div>
    </form>
  );
}
