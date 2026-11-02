import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HOUSEKEEPING_TASK_PAGE_SIZE,
  HOUSEKEEPING_TASK_STATUSES,
  HOUSEKEEPING_TASK_TYPES,
} from '@hotelos/hotel-contracts';
import { Badge, Button, Icon, Input, Select } from '@hotelos/ui';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { api, withQuery } from '../../lib/api.js';
import {
  PRIORITY_TONES,
  TASK_STATUS_TONES,
  priorityLabel,
  taskStatusLabel,
  taskTypeLabel,
} from '../../lib/housekeeping.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { HOUSEKEEPING_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { AssignTasksDialog } from './AssignTasksDialog.jsx';
import { NewTaskDialog } from './NewTaskDialog.jsx';
import { CancelTaskDialog, TaskRowActions } from './TaskDialogs.jsx';

const OFFLINE_REFRESH_MS = 60_000;
const LIVE_MIN_INTERVAL_MS = 1500;

const STATUS_OPTIONS = [
  { value: '', label: 'Tüm durumlar' },
  ...HOUSEKEEPING_TASK_STATUSES.map((status) => ({ value: status, label: taskStatusLabel(status) })),
];
const TYPE_OPTIONS = [
  { value: '', label: 'Tüm tipler' },
  ...HOUSEKEEPING_TASK_TYPES.map((type) => ({ value: type, label: taskTypeLabel(type) })),
];

/**
 * Görev panosu: günlük temizlik listesi (şefin masası). Süzgeçler, özet
 * kartlar, çoklu seçimle toplu atama ve satır işlemleri.
 */
export function HousekeepingTasksTab() {
  const can = useCan();
  const queryClient = useQueryClient();

  const [date, setDate] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [floor, setFloor] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);

  const { isLive } = useLiveChannel(HOUSEKEEPING_CHANNEL, {
    queryKeys: [['housekeeping']],
    minIntervalMs: LIVE_MIN_INTERVAL_MS,
  });

  const filters = {
    date: date || undefined,
    status: status || undefined,
    type: type || undefined,
    floor: floor || undefined,
    onlyIssues: onlyIssues || undefined,
    page,
    pageSize: HOUSEKEEPING_TASK_PAGE_SIZE,
  };

  const list = useQuery({
    queryKey: ['housekeeping', 'tasks', filters],
    queryFn: () => api(withQuery('/housekeeping/tasks', filters)),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: (previous) => previous,
  });

  const summary = useQuery({
    queryKey: ['housekeeping', 'summary', date],
    queryFn: () => api(withQuery('/housekeeping/summary', { date: date || undefined })),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });

  const refresh = () => {
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ['housekeeping'] });
  };

  const rows = list.data?.items ?? [];
  const pickStatus = (value) => {
    setStatus(value);
    setPage(1);
    setSelected(new Set());
  };

  const toggleSelected = (taskId) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };
  const openRows = rows.filter((task) => task.status === 'PENDING' || task.status === 'IN_PROGRESS');
  const allOpenSelected = openRows.length > 0 && openRows.every((task) => selected.has(task.id));
  const toggleAll = () => {
    setSelected(allOpenSelected ? new Set() : new Set(openRows.map((task) => task.id)));
  };

  const columns = [
    ...(can(PERMISSIONS.HOUSEKEEPING_MANAGE)
      ? [
          {
            key: 'select',
            header: (
              <input
                type="checkbox"
                aria-label="Açık görevlerin tümünü seç"
                checked={allOpenSelected}
                onChange={toggleAll}
              />
            ),
            render: (task) =>
              task.status === 'PENDING' || task.status === 'IN_PROGRESS' ? (
                <input
                  type="checkbox"
                  aria-label={`${task.room?.number ?? ''} görevini seç`}
                  checked={selected.has(task.id)}
                  onChange={() => toggleSelected(task.id)}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : null,
            className: 'w-8',
          },
        ]
      : []),
    {
      key: 'room',
      header: 'Oda',
      className: 'font-bold',
      render: (task) => (
        <span className="flex items-center gap-2">
          {task.room?.number ?? '—'}
          {task.arrivalToday && (
            <Badge tone="info" dot>
              Bugün giriş var
            </Badge>
          )}
          {task.carriedOver && <Badge tone="warning">Devreden</Badge>}
        </span>
      ),
    },
    { key: 'floor', header: 'Kat', render: (task) => task.room?.floor ?? '—' },
    { key: 'type', header: 'İş', render: (task) => taskTypeLabel(task.type) },
    {
      key: 'priority',
      header: 'Öncelik',
      render: (task) => <Badge tone={PRIORITY_TONES[task.priority] ?? 'neutral'}>{priorityLabel(task.priority)}</Badge>,
    },
    {
      key: 'status',
      header: 'Durum',
      render: (task) => (
        <span className="flex items-center gap-2">
          <Badge tone={TASK_STATUS_TONES[task.status] ?? 'neutral'}>{taskStatusLabel(task.status)}</Badge>
          {task.issue && (
            <Badge tone="danger" dot>
              Sorun
            </Badge>
          )}
          {task.status === 'DONE' && task.inspection === null && task.type !== 'GUEST_REQUEST' && (
            <Badge tone="violet">Kontrol bekliyor</Badge>
          )}
          {task.inspection?.passed === false && <Badge tone="danger">Kontrolden döndü</Badge>}
        </span>
      ),
    },
    { key: 'assignedTo', header: 'Görevli', render: (task) => task.assignedTo?.name ?? '—' },
    {
      key: 'notes',
      header: 'Not',
      className: 'max-w-56 truncate text-ink-muted',
      render: (task) => task.issue?.note ?? task.notes ?? '—',
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Özet kartlar: tıklayınca durum süzgeci. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryTile
          label="Bekleyen"
          value={summary.data?.pending}
          hint="Henüz başlanmadı"
          icon="clock"
          tone="warning"
          selected={status === 'PENDING'}
          onClick={() => pickStatus(status === 'PENDING' ? '' : 'PENDING')}
        />
        <SummaryTile
          label="Temizleniyor"
          value={summary.data?.inProgress}
          hint="Görevli odada"
          icon="refresh"
          selected={status === 'IN_PROGRESS'}
          onClick={() => pickStatus(status === 'IN_PROGRESS' ? '' : 'IN_PROGRESS')}
        />
        <SummaryTile
          label="Biten"
          value={summary.data?.done}
          hint="Bugün tamamlanan"
          icon="checkCircle"
          tone="success"
          selected={status === 'DONE'}
          onClick={() => pickStatus(status === 'DONE' ? '' : 'DONE')}
        />
        <SummaryTile label="Kontrol bekleyen" value={summary.data?.awaitingInspection} hint="Şef onayı bekliyor" icon="eye" />
        <SummaryTile
          label="Sorunlu"
          value={summary.data?.issues}
          hint="Görevli sorun bildirdi"
          icon="alertTriangle"
          tone="danger"
          selected={onlyIssues}
          onClick={() => {
            setOnlyIssues((previous) => !previous);
            setPage(1);
          }}
        />
      </div>

      <Toolbar
        actions={
          <>
            {can(PERMISSIONS.HOUSEKEEPING_MANAGE) && selected.size > 0 && (
              <Button variant="outline" icon="users" onClick={() => setDialog({ kind: 'assign' })}>
                Seçilenleri ata ({selected.size})
              </Button>
            )}
            {can(PERMISSIONS.HOUSEKEEPING_MANAGE) && (
              <Button icon="plus" onClick={() => setDialog({ kind: 'new' })}>
                Yeni görev
              </Button>
            )}
          </>
        }
      >
        <Input
          label="Gün"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setPage(1);
          }}
        />
        <Select label="Durum" value={status} onChange={(event) => pickStatus(event.target.value)} options={STATUS_OPTIONS} />
        <Select
          label="İş tipi"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
          options={TYPE_OPTIONS}
        />
        <Input
          label="Kat"
          type="number"
          value={floor}
          placeholder="Hepsi"
          onChange={(event) => {
            setFloor(event.target.value);
            setPage(1);
          }}
        />
        <Badge tone={isLive ? 'success' : 'warning'} className="ml-auto self-center">
          {isLive ? 'Canlı' : 'Canlı değil'}
        </Badge>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={rows}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle="Bu günde görev yok"
        emptyHint="Çıkış yapan odalar otomatik düşer; sabah üretimi konaklayan odaları ekler."
        rowActions={(task) => (
          <TaskRowActions task={task} onDone={refresh} onCancel={() => setDialog({ kind: 'cancel', task })} />
        )}
      />

      {list.data?.meta?.date && list.data.meta.date !== list.data.meta.today && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Icon name="info" className="h-4 w-4" />
          Geçmiş bir günün kayıtlarına bakıyorsunuz; devreden görevler yalnızca bugünün listesinde görünür.
        </p>
      )}

      {dialog?.kind === 'new' && <NewTaskDialog onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'assign' && (
        <AssignTasksDialog
          taskIds={[...selected]}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'cancel' && (
        <CancelTaskDialog
          task={dialog.task}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
