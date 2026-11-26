import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { blockRoomSchema, ROOM_BLOCK_TYPES } from '@hotelos/hotel-contracts';
import { Alert, Button, EmptyState, ERROR_CLASS, Icon, Input, LABEL_CLASS, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { BlockTypeBadge } from '../../components/RoomStateBadges.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, apiDelete, apiPost, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Modal içindeki listede bir sayfada gösterilen kayıt. */
const BLOCK_PAGE_SIZE = 5;

/** Sekmeler: değer → sözlük anahtarı. */
const SCOPES = Object.freeze([
  { value: 'ACTIVE', labelKey: 'roomPlan.blocks.scopeActive' },
  { value: 'PAST', labelKey: 'roomPlan.blocks.scopePast' },
]);

const STATE_LABEL_KEYS = Object.freeze({
  CURRENT: 'roomPlan.blocks.stateCurrent',
  UPCOMING: 'roomPlan.blocks.stateUpcoming',
  ENDED: 'roomPlan.blocks.stateEnded',
});

/** Kaldırma düğmesinin adı (sözlük anahtarı): başlamamış kayıt iptal edilir, süren kayıt bugün biter. */
const REMOVAL_ACTION_KEYS = Object.freeze({
  CANCEL: 'roomPlan.blocks.cancel',
  END: 'roomPlan.blocks.endToday',
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
  const t = useT();
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
        toastSuccess(t('roomPlan.blocks.cancelled'));
      } else {
        // Sunucu yalnızca arızalı (satış dışı) kaydı bitince odayı kirli yapar.
        toastSuccess(t(block.type === 'OUT_OF_ORDER' ? 'roomPlan.blocks.endedDirty' : 'roomPlan.blocks.ended'));
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
        title={t('roomPlan.blocks.title', { room: room.number })}
        onClose={onClose}
        footer={
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        }
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label={t('roomPlan.blocks.scopeAria')} className="inline-flex gap-1 rounded-control border border-line p-1">
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
                {t(option.labelKey)}
              </button>
            ))}
          </div>
          {canManage && scope === 'ACTIVE' && !showForm && (
            <Button size="sm" icon="plus" onClick={() => setShowForm(true)}>
              {t('roomPlan.blocks.newRecord')}
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
            title={t('roomPlan.blocks.loadFailed')}
            action={
              <Button variant="outline" size="sm" icon="refresh" onClick={() => listQuery.refetch()}>
                {t('common.retry')}
              </Button>
            }
          >
            {listQuery.error.message}
          </Alert>
        )}

        {listQuery.data && items.length === 0 && (
          <EmptyState
            icon="checkCircle"
            title={scope === 'ACTIVE' ? t('roomPlan.blocks.emptyActive') : t('roomPlan.blocks.emptyPast')}
            description={scope === 'ACTIVE' ? t('roomPlan.blocks.emptyActiveHint') : undefined}
          />
        )}

        {items.length > 0 && (
          <ul className={`flex flex-col gap-2.5 transition-opacity duration-200 ${listQuery.isFetching ? 'opacity-60' : ''}`}>
            {items.map((block) => {
              const actionKey = canManage ? REMOVAL_ACTION_KEYS[block.removal] : null;
              return (
                <li key={block.id} className="flex flex-wrap items-start justify-between gap-3 rounded-panel border border-line px-4 py-3.5">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <BlockTypeBadge type={block.type} />
                      <span className="text-xs font-bold text-ink-muted">{STATE_LABEL_KEYS[block.state] ? t(STATE_LABEL_KEYS[block.state]) : block.state}</span>
                    </div>
                    <p className="text-sm font-semibold text-ink">
                      {formatDate(block.startDate)} → {block.endDate ? formatDate(block.endDate) : t('roomPlan.shared.openEnded')}
                      {block.endDate && <span className="font-normal text-ink-muted"> {t('roomPlan.blocks.endExclusive')}</span>}
                    </p>
                    <p className="text-sm text-ink-soft">{block.reason}</p>
                    <p className="text-xs text-ink-muted">{t('roomPlan.blocks.openedBy', { name: block.createdBy })}</p>
                  </div>
                  {actionKey && (
                    <Button variant="dangerSoft" size="sm" onClick={() => setRemoving(block)}>
                      {t(actionKey)}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {meta && meta.totalPages > 1 && (
          <nav aria-label={t('roomPlan.blocks.pages')} className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-ink-muted">{t('roomPlan.blocks.total', { count: meta.total })}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('roomPlan.shared.prev')}
              </Button>
              <span className="text-sm font-semibold text-ink-soft" aria-live="polite">
                {meta.page} / {meta.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
                {t('roomPlan.shared.next')}
                <Icon name="chevronRight" className="size-3.5" />
              </Button>
            </div>
          </nav>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title={removing?.removal === 'END' ? t('roomPlan.blocks.confirmEndTitle') : t('roomPlan.blocks.confirmCancelTitle')}
        message={
          removing?.removal === 'END'
            ? t(removing?.type === 'OUT_OF_ORDER' ? 'roomPlan.blocks.confirmEndMessageDirty' : 'roomPlan.blocks.confirmEndMessage', {
                type: t(`roomPlan.blockType.${removing?.type}`),
              })
            : t('roomPlan.blocks.confirmCancelMessage')
        }
        confirmLabel={removing && REMOVAL_ACTION_KEYS[removing.removal] ? t(REMOVAL_ACTION_KEYS[removing.removal]) : undefined}
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
  const t = useT();
  const { today } = useHotelToday();
  const [form, setForm] = useState({ type: 'OUT_OF_ORDER', startDate: today, endDate: '', reason: '' });
  const [errors, setErrors] = useState({});

  const createMutation = useMutation({
    mutationFn: (values) => apiPost(`/rooms/${roomId}/blocks`, values),
    onSuccess: () => {
      toastSuccess(t('roomPlan.blocks.created'));
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
      setErrors({ startDate: t('roomPlan.blocks.startBeforeToday') });
      return;
    }
    setErrors({});
    createMutation.mutate(values);
  }

  const failure = createMutation.error;

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-panel border border-line bg-surface-muted p-5" noValidate>
      <fieldset>
        <legend className={LABEL_CLASS}>{t('roomPlan.blocks.type')}</legend>
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
                  <span className="block text-sm font-bold text-ink">{t(`roomPlan.blockType.${type}`)}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{t(`roomPlan.blockTypeHint.${type}`)}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.type && <p className={`mt-2 ${ERROR_CLASS}`}>{errors.type}</p>}
      </fieldset>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Input
          label={t('roomPlan.shared.from')}
          name="startDate"
          type="date"
          min={today}
          value={form.startDate}
          onChange={setField('startDate')}
          error={errors.startDate}
        />
        <Input
          label={t('roomPlan.blocks.end')}
          name="endDate"
          type="date"
          min={form.startDate || today}
          value={form.endDate}
          onChange={setField('endDate')}
          error={errors.endDate}
        />
        <Input
          label={t('roomPlan.blocks.reason')}
          name="reason"
          value={form.reason}
          onChange={setField('reason')}
          error={errors.reason}
          placeholder={t('roomPlan.blocks.reasonPlaceholder')}
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
        <Alert tone="danger" className="mt-5" title={t('roomPlan.blocks.overbookTitle')}>
          <p>{failure.message}</p>
          <ul className="mt-2 list-inside list-disc text-xs">
            {failure.details.nights.map((night) => (
              <li key={`${night.roomTypeId}-${night.day}`}>
                {t('roomPlan.blocks.overbookNight', {
                  date: formatDate(night.day),
                  type: night.roomTypeCode,
                  sellable: night.sellable,
                  demand: night.demand,
                })}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <Button variant="outline" onClick={onCancel} disabled={createMutation.isPending} type="button">
          {t('common.cancel')}
        </Button>
        <Button type="submit" icon="lock" disabled={createMutation.isPending}>
          {createMutation.isPending ? t('common.saving') : t('roomPlan.blocks.submit')}
        </Button>
      </div>
    </form>
  );
}
