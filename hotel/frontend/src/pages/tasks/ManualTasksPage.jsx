import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import {
  MANUAL_TASK_KNOWN_MODULES,
  MANUAL_TASK_PAGE_SIZE,
  MANUAL_TASK_STATUS_LABELS,
  MANUAL_TASK_VIEW_LABELS,
  MANUAL_TASK_VIEWS,
} from '@hotelos/hotel-contracts';
import { Badge, Button, Card, EmptyState, Icon, Select, Spinner } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, withQuery } from '../../lib/api.js';
import { taskKeys, taskLinkTargets, useManualTaskScope, useManualTaskSummary } from '../../lib/actors.js';
import { MANUAL_TASKS_CHANNEL } from '../../lib/socket.js';
import { formatDateTime, formatElapsed } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { useNow } from '../../lib/useNow.js';
import { QueryError } from '../activity/shared.jsx';
import { ManualTaskDialog } from './ManualTaskDialog.jsx';
import { STATUS_TONES, TASK_PARAMS } from './taskTheme.js';
import { useTaskAction } from './taskActions.js';

/** Socket kopukken ekranın kendini tazeleme sıklığı. */
const OFFLINE_REFRESH_MS = 60_000;
/** "Kaç dakikadır bekliyor" yazısının akması. */
const CLOCK_TICK_MS = 60_000;
/** Bu kadar süredir kimsenin üstlenmediği görev kırmızı yazılır. */
const STALE_TASK_MINUTES = 60;

const VIEW_OPTIONS = MANUAL_TASK_VIEWS.map((value) => ({ value, label: MANUAL_TASK_VIEW_LABELS[value] }));

/**
 * Manuel görevler (modül 12): aktörün yapamadığı işler — kapalıydı, hata
 * verdi ya da sırası doluydu. Herkes kendi modülününkini görür (oda atama
 * görevi oda işlemleri iznine...). Açıklar en uzun bekleyen üstte; satırdan
 * tek tıkla üstlenilir, pencereden tamamlanır ya da "gerek kalmadı" denir.
 * Zildeki uyarı `?gorev=` ile doğrudan görevi açar.
 */
export function ManualTasksPage() {
  const { timeZone } = useHotelToday();
  const now = useNow(CLOCK_TICK_MS);
  const scope = useManualTaskScope();
  const [params, setParams] = useSearchParams();
  const view = MANUAL_TASK_VIEWS.includes(params.get(TASK_PARAMS.view)) ? params.get(TASK_PARAMS.view) : 'OPEN';
  const module = params.get(TASK_PARAMS.module) ?? '';
  const actor = params.get(TASK_PARAMS.actor) ?? '';
  const detailId = params.get(TASK_PARAMS.detail);
  const [detailMode, setDetailMode] = useState('view');
  const action = useTaskAction();

  const update = useCallback(
    (changes) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const { isLive } = useLiveChannel(MANUAL_TASKS_CHANNEL, {
    queryKeys: (payload) =>
      payload?.taskId ? [taskKeys.lists, taskKeys.summary, taskKeys.detail(payload.taskId)] : [taskKeys.all],
  });
  const summary = useManualTaskSummary().data;
  const filters = { view, module, actor };
  const listQuery = useInfiniteQuery({
    queryKey: taskKeys.list(filters),
    queryFn: ({ pageParam }) =>
      api(
        withQuery('/manual-tasks', {
          view,
          module: module || undefined,
          actor: actor || undefined,
          limit: MANUAL_TASK_PAGE_SIZE,
          cursor: pageParam,
        }),
      ),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });
  const items = listQuery.data?.pages.flatMap((page) => page.items) ?? [];

  // Süzgeçte kişinin görebildiği modüller: bilinenlerden izni olanlar + şu an açık görevi olanlar.
  const moduleNames = [
    ...new Set([
      ...(scope.all ? MANUAL_TASK_KNOWN_MODULES : scope.modules),
      ...(summary?.byModule ?? []).map((entry) => entry.module),
      ...(module ? [module] : []),
    ]),
  ].sort((a, b) => a.localeCompare(b, 'tr'));
  const moduleOptions = [{ value: '', label: 'Tüm modüller' }, ...moduleNames.map((name) => ({ value: name, label: name }))];

  const openDetail = (id, mode = 'view') => {
    setDetailMode(mode);
    update({ [TASK_PARAMS.detail]: id });
  };
  const waiting = summary ? summary.open - summary.claimed : undefined;
  const oldest = summary?.oldestOpenAt ? formatElapsed(summary.oldestOpenAt, now) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Görevler"
        description="Otomasyonun yapamadığı işler: aktör kapalıydı, hata verdi ya da sırası doluydu. Üstlenin, işi yapın, tamamlayın — ya da gerek kalmadıysa gerekçesiyle kapatın."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="Açık görev" value={summary?.open} hint="Tamamlanmayı bekleyen" icon="wrench" tone={summary?.open > 0 ? 'warning' : 'neutral'} />
        <SummaryTile label="Kimse üstlenmedi" value={waiting} hint="Üstlenilmeyi bekleyen" icon="user" tone={waiting > 0 ? 'danger' : 'neutral'} />
        <SummaryTile
          label="En eski görev"
          value={summary ? (oldest ?? 'Yok') : undefined}
          hint={oldest ? 'En uzun bekleyenin süresi' : 'Açık görev yok'}
          icon="clock"
          tone={summary?.open > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Görünüm" name="gorunum" value={view} options={VIEW_OPTIONS} onChange={(event) => update({ [TASK_PARAMS.view]: event.target.value === 'OPEN' ? '' : event.target.value })} className="w-full sm:w-40" />
          <Select label="Modül" name="modul" value={module} options={moduleOptions} onChange={(event) => update({ [TASK_PARAMS.module]: event.target.value })} className="w-full sm:w-56" />
          {actor && (
            <span className="inline-flex items-center gap-2 self-center rounded-full bg-black/[0.05] px-3 py-1 text-xs font-semibold text-ink-soft">
              Aktör: <span className="font-mono">{actor}</span>
              <button type="button" onClick={() => update({ [TASK_PARAMS.actor]: '' })} className="text-ink-muted hover:text-ink" aria-label="Aktör süzgecini kaldır">
                <Icon name="close" className="size-3.5" />
              </button>
            </span>
          )}
          {(module || actor) && (
            <Button variant="ghost" icon="close" onClick={() => update({ [TASK_PARAMS.module]: '', [TASK_PARAMS.actor]: '' })}>
              Süzgeçleri temizle
            </Button>
          )}
          <span className="ml-auto flex items-center gap-2 self-center" aria-live="polite">
            {listQuery.isFetching && !listQuery.isPending && <Spinner label="Yenileniyor…" />}
            <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
          </span>
        </div>
      </Card>

      {listQuery.isPending && <Spinner label="Görevler yükleniyor…" className="py-12" />}
      {listQuery.isError && <QueryError query={listQuery} title="Görevler yüklenemedi" />}
      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState
          icon="checkCircle"
          title={view === 'OPEN' ? 'Açık görev yok' : 'Kapanmış görev yok'}
          description={
            view === 'OPEN'
              ? module || actor
                ? 'Bu süzgeçte bekleyen iş yok.'
                : 'Aktörler her işi kendisi yapıyor; personele düşen iş yok.'
              : 'Tamamlanan ya da gerek kalmadığı için kapatılan görevler burada görünür.'
          }
        />
      )}

      {items.length > 0 && (
        <Card>
          <ul className="divide-y divide-line">
            {items.map((task) => {
              const open = task.status === 'PENDING' || task.status === 'IN_PROGRESS';
              const age = Math.floor((now - Date.parse(task.createdAt)) / 60_000);
              const stale = task.status === 'PENDING' && age >= STALE_TASK_MINUTES;
              const busy = action.isPending && action.variables?.taskId === task.id;
              return (
                <li key={task.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <button type="button" onClick={() => openDetail(task.id)} className="min-w-0 flex-1 text-left">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONES[task.status]}>{MANUAL_TASK_STATUS_LABELS[task.status]}</Badge>
                      <Badge tone="neutral">{task.module}</Badge>
                      {task.assignedTo && open && (
                        <Badge tone={task.mine ? 'info' : 'warning'}>{task.mine ? 'Siz üstlendiniz' : `${task.assignedTo.name ?? 'Biri'} üstlendi`}</Badge>
                      )}
                    </span>
                    <span className="mt-1 block font-semibold text-ink hover:underline">{task.title}</span>
                    {task.description && <span className="mt-0.5 block truncate text-xs text-ink-soft">{task.description}</span>}
                    <span className={`mt-0.5 block text-xs ${stale ? 'font-semibold text-sec-strong' : 'text-ink-muted'}`}>
                      {open
                        ? `${formatElapsed(task.createdAt, now)} önce düştü · ${formatDateTime(task.createdAt, timeZone)}`
                        : `${task.status === 'DONE' ? 'Tamamlayan' : 'Kapatan'}: ${task.resolvedByLabel ?? task.resolvedBy ?? '—'} · ${formatDateTime(task.closedAt, timeZone)}`}
                      {task.event ? ` · ${task.event.label}` : ''}
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {taskLinkTargets(task.links).map((link) => (
                      <Link key={link.key} to={link.to} className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-black/[0.04] hover:text-ink">
                        {link.label}
                      </Link>
                    ))}
                    {open && task.canHandle && task.status === 'PENDING' && (
                      <Button size="sm" variant="outline" icon="user" disabled={busy} onClick={() => action.mutate({ taskId: task.id, action: 'claim' })}>
                        Üstlen
                      </Button>
                    )}
                    {open && task.canHandle && (
                      <Button size="sm" icon="check" disabled={busy} onClick={() => openDetail(task.id, 'complete')}>
                        Tamamla
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <MoreRows query={listQuery} label={view === 'OPEN' ? 'Daha yeni görevler' : 'Daha eski görevler'} />
        </Card>
      )}

      {detailId && (
        <ManualTaskDialog
          key={detailId}
          taskId={detailId}
          timeZone={timeZone}
          initialMode={detailMode}
          onClose={() => {
            setDetailMode('view');
            update({ [TASK_PARAMS.detail]: '' });
          }}
        />
      )}
    </div>
  );
}

/**
 * Listenin alt şeridi. Açık görevler en eskiden yeniye gider (sonraki sayfa
 * daha yeni), kapananlar tersine.
 *
 * @param {{ query: import('@tanstack/react-query').UseInfiniteQueryResult<any>, label: string }} props
 */
function MoreRows({ query, label }) {
  if (query.isFetchingNextPage) return <Spinner label="Yükleniyor…" className="py-4" />;
  if (!query.hasNextPage) return <p className="pt-4 text-center text-xs font-semibold text-ink-muted">Listenin sonu</p>;
  return (
    <div className="flex justify-center pt-3">
      <Button variant="outline" size="sm" icon="arrowDown" onClick={() => query.fetchNextPage()}>
        {label}
      </Button>
    </div>
  );
}
