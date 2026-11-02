import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, EmptyState, Spinner } from '@hotelos/ui';
import { apiPatch, api, withQuery } from '../../lib/api.js';
import {
  PRIORITY_TONES,
  TASK_STATUS_TONES,
  priorityLabel,
  sortForCleaner,
  taskStatusLabel,
  taskTypeLabel,
} from '../../lib/housekeeping.js';
import { HOUSEKEEPING_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { useAuthStore } from '../../store/auth.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ReportIssueDialog } from './TaskDialogs.jsx';

const OFFLINE_REFRESH_MS = 30_000;
/** Telefonda eldivenli elle basılacak düğmeler: en az bu yükseklikte. */
const BIG_BUTTON_CLASS = 'min-h-14 flex-1 text-base';

/**
 * Görevlinin telefonu: bugünkü işlerim, büyük düğmelerle
 * "Başladım / Bitti / Sorun var". Sahipsiz görevler havuzda görünür;
 * "Başladım" diyen üstlenir.
 */
export function MyHousekeepingTasksTab() {
  const meId = useAuthStore((state) => state.user?.id);
  const queryClient = useQueryClient();
  const [issueTask, setIssueTask] = useState(null);

  const { isLive } = useLiveChannel(HOUSEKEEPING_CHANNEL, {
    queryKeys: [['housekeeping']],
    minIntervalMs: 1000,
  });

  const list = useQuery({
    queryKey: ['housekeeping', 'my-tasks'],
    // Bugünün tüm görevleri; benimkiler ve havuz istemcide ayrılır (tek istek).
    queryFn: () => api(withQuery('/housekeeping/tasks', { page: 1, pageSize: 100 })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: (previous) => previous,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['housekeeping'] });

  const mutation = useMutation({
    mutationFn: ({ task, action }) => apiPatch(`/housekeeping/tasks/${task.id}/${action}`, { expectedUpdatedAt: task.updatedAt }),
    onSuccess: (_, { task, action }) => {
      toastSuccess(`${task.room?.number ?? ''} ${action === 'start' ? 'başlandı' : 'bitti'}`);
      refresh();
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE' || error.code === 'ASSIGNED_ELSEWHERE') refresh();
    },
  });

  if (list.isPending) return <Spinner className="py-8" />;

  const open = (list.data?.items ?? []).filter((task) => task.status === 'PENDING' || task.status === 'IN_PROGRESS');
  const mine = sortForCleaner(open.filter((task) => task.assignedTo?.id === meId));
  const pool = sortForCleaner(open.filter((task) => !task.assignedTo));
  const doneToday = (list.data?.items ?? []).filter(
    (task) => task.status === 'DONE' && (task.assignedTo?.id === meId || task.completedBy?.id === meId),
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <div className="flex items-center justify-between text-sm text-ink-muted">
        <span>
          Bugün bitirdiğim: <strong className="text-ink">{doneToday}</strong> · üzerimde:{' '}
          <strong className="text-ink">{mine.length}</strong>
        </span>
        <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
      </div>

      {mine.length === 0 && pool.length === 0 ? (
        <EmptyState icon="checkCircle" title="Üzerinizde görev yok" description="Yeni görev düştüğünde burada görünür." />
      ) : (
        <>
          {mine.map((task) => (
            <TaskCard key={task.id} task={task} mutation={mutation} onIssue={() => setIssueTask(task)} />
          ))}
          {pool.length > 0 && (
            <>
              <h2 className="mt-2 text-sm font-bold uppercase tracking-wide text-ink-muted">
                Havuz — sahipsiz görevler ({pool.length})
              </h2>
              {pool.map((task) => (
                <TaskCard key={task.id} task={task} mutation={mutation} onIssue={() => setIssueTask(task)} claimable />
              ))}
            </>
          )}
        </>
      )}

      {issueTask && (
        <ReportIssueDialog
          task={issueTask}
          onClose={() => setIssueTask(null)}
          onDone={() => {
            setIssueTask(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** @param {{ task: object, mutation: object, onIssue: () => void, claimable?: boolean }} props */
function TaskCard({ task, mutation, onIssue, claimable = false }) {
  const busy = mutation.isPending;
  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-black leading-tight">{task.room?.number ?? '—'}</p>
          <p className="text-sm text-ink-muted">
            Kat {task.room?.floor ?? '—'} · {taskTypeLabel(task.type)}
          </p>
        </div>
        <span className="flex flex-col items-end gap-1">
          <Badge tone={TASK_STATUS_TONES[task.status] ?? 'neutral'}>{taskStatusLabel(task.status)}</Badge>
          <Badge tone={PRIORITY_TONES[task.priority] ?? 'neutral'}>{priorityLabel(task.priority)}</Badge>
        </span>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {task.arrivalToday && (
          <Badge tone="info" dot>
            Bugün giriş var — önce bu oda
          </Badge>
        )}
        {task.carriedOver && <Badge tone="warning">Dünden devreden</Badge>}
        {task.issue && <Badge tone="danger">Sorun bildirildi</Badge>}
        {task.guestRequest && <Badge tone="violet">Misafir isteği: {task.guestRequest.title}</Badge>}
      </div>

      {task.notes && <p className="rounded-item bg-surface-muted p-2 text-sm">{task.notes}</p>}

      <div className="flex gap-2">
        {task.status === 'PENDING' && (
          <Button
            className={BIG_BUTTON_CLASS}
            variant="outline"
            disabled={busy}
            onClick={() => mutation.mutate({ task, action: 'start' })}
          >
            {claimable ? 'Üstlen ve başla' : 'Başladım'}
          </Button>
        )}
        <Button className={BIG_BUTTON_CLASS} disabled={busy} onClick={() => mutation.mutate({ task, action: 'complete' })}>
          Bitti
        </Button>
        <Button className={BIG_BUTTON_CLASS} variant="outline" icon="alertTriangle" disabled={busy} onClick={onIssue}>
          Sorun var
        </Button>
      </div>
    </section>
  );
}
