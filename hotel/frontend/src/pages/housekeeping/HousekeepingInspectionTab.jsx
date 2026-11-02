import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, EmptyState, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPatch, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { taskTypeLabel } from '../../lib/housekeeping.js';
import { HOUSEKEEPING_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const OFFLINE_REFRESH_MS = 60_000;
/** Kuyruğun bir seferde gösterilen kısmı; onaylandıkça sıradakiler gelir. */
const INSPECTION_PAGE_SIZE = 100;

/**
 * Kat şefi kontrolü: bitmiş ve henüz kontrol edilmemiş temizlik görevleri.
 * Onayla → oda "Kontrol edildi"; reddet → oda yeniden "Kirli" ve öncelikli
 * düzeltme görevi açılır. Dört göz: temizliği yapan kendi işini onaylayamaz
 * (kural sunucuda; ekran yalnızca hatayı gösterir).
 */
export function HousekeepingInspectionTab() {
  const queryClient = useQueryClient();
  const [reject, setReject] = useState(null);

  const { isLive } = useLiveChannel(HOUSEKEEPING_CHANNEL, {
    queryKeys: [['housekeeping']],
    minIntervalMs: 1500,
  });

  const list = useQuery({
    queryKey: ['housekeeping', 'inspection'],
    // Kontrol bekleyenler sunucuda süzülür: "bitmiş" görevlerin ilk sayfası onaylanmışlarla dolup bekleyeni saklamasın.
    queryFn: () => api(withQuery('/housekeeping/tasks', { awaitingInspection: true, page: 1, pageSize: INSPECTION_PAGE_SIZE })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: (previous) => previous,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['housekeeping'] });

  const approve = useMutation({
    mutationFn: (task) => apiPatch(`/housekeeping/tasks/${task.id}/inspect`, { expectedUpdatedAt: task.updatedAt, passed: true }),
    onSuccess: (result) => {
      toastSuccess(`${result.task.room?.number ?? ''} onaylandı — oda satışa hazır`);
      refresh();
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') refresh();
    },
  });

  if (!list.data) return <QueryFallback query={list} errorTitle="Kontrol listesi yüklenemedi" />;

  const awaiting = list.data.items;
  const awaitingTotal = list.data.meta.total;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-sm text-ink-muted">
        <span>
          Kontrol bekleyen oda: <strong className="text-ink">{awaitingTotal}</strong>
          {awaitingTotal > awaiting.length ? ` · ilk ${awaiting.length} gösteriliyor, onaylandıkça sıradakiler gelir` : ''}
        </span>
        <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
      </div>

      {awaiting.length === 0 ? (
        <EmptyState icon="checkCircle" title="Kontrol bekleyen oda yok" description="Görevli 'Bitti' dedikçe odalar buraya düşer." />
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          {awaiting.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-black">{task.room?.number ?? '—'}</span>
                  <Badge tone="neutral">Kat {task.room?.floor ?? '—'}</Badge>
                  <Badge tone="sky">{taskTypeLabel(task.type)}</Badge>
                  {task.arrivalToday && (
                    <Badge tone="info" dot>
                      Bugün giriş var
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-sm text-ink-muted">
                  Temizleyen: {task.completedBy?.name ?? '—'} · bitti: {task.completedAt ? formatDate(task.completedAt) : '—'}
                  {task.completionNote ? ` · "${task.completionNote}"` : ''}
                </span>
              </span>
              <span className="flex gap-2">
                <Button size="sm" icon="check" disabled={approve.isPending} onClick={() => approve.mutate(task)}>
                  Onayla
                </Button>
                <Button size="sm" variant="outline" icon="close" onClick={() => setReject(task)}>
                  Reddet
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {reject && (
        <RejectDialog
          task={reject}
          onClose={() => setReject(null)}
          onDone={() => {
            setReject(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** @param {{ task: object, onClose: () => void, onDone: () => void }} props */
function RejectDialog({ task, onClose, onDone }) {
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      apiPatch(`/housekeeping/tasks/${task.id}/inspect`, { expectedUpdatedAt: task.updatedAt, passed: false, note: note.trim() }),
    onSuccess: (result) => {
      toastSuccess(
        `${result.task.room?.number ?? ''} kontrolden döndü; düzeltme görevi ${
          result.followUpTask?.assignedTo?.name ? `${result.followUpTask.assignedTo.name} üzerine ` : ''
        }açıldı`,
      );
      onDone();
    },
    onError: (error) => toastError(error.message),
  });

  return (
    <Modal
      open
      title={`${task.room?.number ?? ''} — kontrolden döndür`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button icon="close" disabled={mutation.isPending || note.trim().length === 0} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Gönderiliyor…' : 'Reddet, görevi yeniden aç'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          Oda yeniden "Kirli" olur ve öncelikli bir düzeltme görevi açılır. Sebep görevlinin kartında görünür —
          neyi düzelteceğini bilsin.
        </p>
        <Textarea
          label="Neden reddedildi?"
          placeholder="Örn. banyo yeniden silinecek, çarşaf lekeli"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Modal>
  );
}
