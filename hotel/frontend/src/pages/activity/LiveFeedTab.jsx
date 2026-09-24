import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIVITY_LEVEL_FILTER_LABELS, ACTIVITY_LEVEL_FILTERS, ACTIVITY_LIVE_BATCH, ACTIVITY_PAGE_SIZE, EVENT_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Card, EmptyState, Icon, Select, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { activityKeys, dayRange, formatClockSeconds, formatDuration, useActivityStream } from '../../lib/activity.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { ChainLink, DayRangeInputs, JsonBlock, LevelBadge, OlderRows, QueryError, useUrlFilters } from './shared.jsx';

const FILTER_PARAMS = Object.freeze({ actorName: 'aktor', eventName: 'olay', level: 'seviye', from: 'baslangic', to: 'bitis' });
const LEVEL_OPTIONS = [{ value: '', label: 'Tüm seviyeler' }, ...ACTIVITY_LEVEL_FILTERS.map((value) => ({ value, label: ACTIVITY_LEVEL_FILTER_LABELS[value] }))];

/** Canlı gelen satır bu sayıyı aşınca liste baştan yüklenir (tarayıcı şişmesin, arada boşluk kalmasın). */
const MAX_LIVE_ROWS = 300;
/** Duraklatılmışken biriken satır kimliği (fazlasında devam edince liste baştan yüklenir). */
const MAX_BUFFERED_IDS = ACTIVITY_LIVE_BATCH * 2;
/** Liste bu kadar piksel aşağı kaydırılmışsa kullanıcı "okuyor" sayılır; yeni satır yerini kaydırmaz. */
const READING_OFFSET_PX = 48;
/** Socket kopukken ilk sayfanın tazelenme sıklığı. */
const OFFLINE_REFRESH_MS = 30_000;

/**
 * İki listeyi kimliğe göre birleştirir, en yeni önce.
 * @param {object[]} first @param {object[]} second
 */
function mergeRows(first, second) {
  const byId = new Map();
  for (const row of [...first, ...second]) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

const EMPTY_BUFFER = Object.freeze({ ids: [], count: 0, overflow: false });

/**
 * Canlı akış (modül 10): aktörlerin işledikleri, en yeni üstte.
 *
 * - İlk sayfa ve "daha eski" sayfalar HTTP'den, imleçle.
 * - Sunucu yeni satırın **kimliğini** haber verir; ekran o satırları aynı
 *   süzgeçle çeker ve listeye ekler (socket'ten içerik gelmez).
 * - Duraklatınca liste donar; gelenler sayılır, devam edince eklenir.
 * - Liste aşağı kaydırılmışsa (okunuyorsa) yeni satır okunan yeri kaydırmaz;
 *   üstte "N yeni" düğmesi çıkar. En üstteyse yeni satırlar görünür kalır.
 * - Bitiş günü seçiliyse geçmiş bir aralığa bakılıyordur: canlı akış kapanır.
 */
export function LiveFeedTab() {
  const queryClient = useQueryClient();
  const { timeZone } = useHotelToday();
  const filters = useUrlFilters(FILTER_PARAMS);
  const { actorName, eventName, level, from, to } = filters.values;
  const serverFilters = useMemo(
    () => ({
      ...(actorName ? { actorName } : {}),
      ...(eventName ? { eventName } : {}),
      ...(level ? { level } : {}),
      ...dayRange({ from, to }, timeZone),
    }),
    [actorName, eventName, level, from, to, timeZone],
  );
  const filterKey = JSON.stringify(serverFilters);
  const liveEnabled = !to;

  const options = useQuery({ queryKey: activityKeys.options, queryFn: () => api('/activity/options'), staleTime: 5 * 60_000 });

  const [liveRows, setLiveRows] = useState([]);
  const [paused, setPaused] = useState(false);
  const [buffer, setBuffer] = useState(EMPTY_BUFFER);
  const [streamError, setStreamError] = useState(null);
  const [session, setSession] = useState({ warnings: 0, errors: 0 });
  const [unseen, setUnseen] = useState(0);
  const [expanded, setExpanded] = useState(null);

  const history = useInfiniteQuery({
    queryKey: activityKeys.feed(serverFilters),
    queryFn: ({ pageParam }) =>
      api(withQuery('/activity/feed', { ...serverFilters, cursor: pageParam, limit: ACTIVITY_PAGE_SIZE })),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // Süzgeç değişince canlı satırlar ve sayaçlar sıfırlanır.
  useEffect(() => {
    setLiveRows([]);
    setBuffer(EMPTY_BUFFER);
    setUnseen(0);
    setExpanded(null);
  }, [filterKey]);

  /** Listeyi baştan yükler (çok sayıda yeni satır, yeniden bağlanma, sınır aşıldı). */
  const reload = useCallback(() => {
    setLiveRows([]);
    setBuffer(EMPTY_BUFFER);
    setUnseen(0);
    queryClient.resetQueries({ queryKey: activityKeys.feed(serverFilters) });
  }, [queryClient, serverFilters]);

  /** Haberi alınan satırları aynı süzgeçle çeker ve ekler. */
  const fetchIds = useCallback(
    async (ids) => {
      try {
        const data = await api(withQuery('/activity/feed', { ...serverFilters, ids: ids.join(',') }));
        setStreamError(null);
        setLiveRows((current) => {
          const next = mergeRows(data.items, current);
          if (next.length > MAX_LIVE_ROWS) {
            // Boşluk bırakmamak için eski sayfalar yerine liste baştan yüklenir.
            queueMicrotask(reload);
            return current;
          }
          return next;
        });
      } catch (error) {
        setStreamError(error.message);
      }
    },
    [serverFilters, reload],
  );

  const { isLive } = useActivityStream({
    enabled: liveEnabled,
    onSignal: (signal) => {
      setSession((current) => ({ warnings: current.warnings + signal.warnings, errors: current.errors + signal.errors }));
      if (paused) {
        setBuffer((current) => ({
          ids: [...current.ids, ...signal.ids].slice(0, MAX_BUFFERED_IDS),
          count: current.count + signal.count,
          overflow: current.overflow || signal.overflow || current.ids.length + signal.ids.length > MAX_BUFFERED_IDS,
        }));
        return;
      }
      if (signal.overflow) reload();
      else if (signal.ids.length > 0) fetchIds(signal.ids);
    },
    onReconnect: reload,
  });

  function resume() {
    setPaused(false);
    const { ids, overflow } = buffer;
    setBuffer(EMPTY_BUFFER);
    if (overflow) reload();
    else if (ids.length > 0) fetchIds(ids);
  }

  // Socket kopukken liste ara ara tazelenir (canlı akış bir hızlandırıcı);
  // görünen veri korunur, yükleniyor göstergesi çıkmaz.
  const { refetch } = history;
  useEffect(() => {
    if (!liveEnabled || isLive || paused) return undefined;
    const timer = setInterval(() => refetch(), OFFLINE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [liveEnabled, isLive, paused, refetch]);

  const historyRows = useMemo(() => history.data?.pages.flatMap((page) => page.items) ?? [], [history.data]);
  const rows = useMemo(() => mergeRows(liveRows, historyRows), [liveRows, historyRows]);

  // Okuma yerini koru: liste kaydırılmışken üste eklenen satırlar görüneni itmesin.
  const scrollRef = useRef(null);
  const previous = useRef({ height: 0, firstId: null });
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const firstId = rows[0]?.id ?? null;
    const grew = previous.current.firstId && firstId !== previous.current.firstId;
    if (grew && element.scrollTop > READING_OFFSET_PX) {
      const added = rows.findIndex((row) => row.id === previous.current.firstId);
      element.scrollTop += element.scrollHeight - previous.current.height;
      if (added > 0) setUnseen((count) => count + added);
    }
    previous.current = { height: element.scrollHeight, firstId };
  }, [rows]);

  const onScroll = () => {
    if ((scrollRef.current?.scrollTop ?? 0) <= READING_OFFSET_PX && unseen > 0) setUnseen(0);
  };
  const toTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setUnseen(0);
  };

  const actorOptions = [
    { value: '', label: 'Tüm aktörler' },
    ...(options.data?.actors ?? []).map((actor) => ({
      value: actor.name,
      label: actor.title && actor.title !== actor.name ? `${actor.title} (${actor.name})` : actor.name,
    })),
  ];
  const eventOptions = [
    { value: '', label: 'Tüm olaylar' },
    ...(options.data?.events ?? []).map((name) => ({ value: name, label: EVENT_LABELS[name] ? `${EVENT_LABELS[name]} (${name})` : name })),
  ];
  const liveStatus = !liveEnabled
    ? { tone: 'neutral', label: 'Geçmiş aralık (canlı değil)' }
    : paused
      ? { tone: 'warning', label: 'Duraklatıldı' }
      : isLive
        ? { tone: 'success', label: 'Canlı' }
        : { tone: 'warning', label: 'Bağlantı yok · 30 sn\'de bir tazeleniyor' };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_10rem_10rem]">
          <Select label="Aktör" name="feed-actor" value={actorName} options={actorOptions} onChange={(event) => filters.set('actorName', event.target.value)} />
          <Select label="Olay" name="feed-event" value={eventName} options={eventOptions} onChange={(event) => filters.set('eventName', event.target.value)} />
          <Select label="Seviye" name="feed-level" value={level} options={LEVEL_OPTIONS} onChange={(event) => filters.set('level', event.target.value)} />
          <DayRangeInputs idPrefix="feed" from={from} to={to} onChange={(patch) => filters.setMany(patch)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Badge tone={liveStatus.tone}>{liveStatus.label}</Badge>
          {(session.errors > 0 || session.warnings > 0) && (
            <span className="text-xs font-semibold text-ink-muted">
              Açıldığından beri: {session.errors} hata, {session.warnings} uyarı
            </span>
          )}
          <span className="flex-1" />
          {filters.active && (
            <Button variant="ghost" size="sm" icon="close" onClick={filters.clear}>
              Süzgeçleri temizle
            </Button>
          )}
          {liveEnabled &&
            (paused ? (
              <Button size="sm" icon="play" onClick={resume}>
                Devam et{buffer.count > 0 ? ` (${buffer.count} yeni)` : ''}
              </Button>
            ) : (
              <Button variant="outline" size="sm" icon="clock" onClick={() => setPaused(true)}>
                Duraklat
              </Button>
            ))}
          <Button variant="outline" size="sm" icon="refresh" onClick={reload}>
            Yenile
          </Button>
        </div>
        {streamError && <p className="mt-3 text-xs font-semibold text-sec-strong">Yeni satırlar alınamadı: {streamError}. "Yenile" ile tekrar deneyin.</p>}
      </Card>

      {history.isPending ? (
        <Spinner label="Aktivite yükleniyor…" className="py-10" />
      ) : history.isError ? (
        <QueryError query={history} title="Aktivite yüklenemedi" />
      ) : (
        <div className="relative overflow-hidden rounded-card bg-surface shadow-card">
          {unseen > 0 && (
            <button
              type="button"
              onClick={toTop}
              className="absolute left-1/2 top-3 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-1.5 text-xs font-bold text-white shadow-float"
            >
              <Icon name="arrowRight" className="size-4 -rotate-90" />
              {unseen} yeni satır
            </button>
          )}
          <div ref={scrollRef} onScroll={onScroll} role="log" aria-live="off" aria-label="Aktivite akışı" className="max-h-[70vh] overflow-y-auto">
            {rows.length === 0 ? (
              <EmptyState
                icon="zap"
                title={filters.active ? 'Bu süzgeçle kayıt yok' : 'Henüz aktivite yok'}
                description={liveEnabled ? 'Aktörler bir iş yaptıkça burada anında görünür.' : 'Seçili aralıkta aktör işlemi yok.'}
              />
            ) : (
              <ol className="divide-y divide-line">
                {rows.map((row) => (
                  <ActivityRow
                    key={row.id}
                    row={row}
                    timeZone={timeZone}
                    open={expanded === row.id}
                    onToggle={() => setExpanded((current) => (current === row.id ? null : row.id))}
                  />
                ))}
              </ol>
            )}
            <OlderRows query={history} emptyShown={rows.length === 0} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @param {{ row: object, timeZone: string, open: boolean, onToggle: () => void }} props
 */
function ActivityRow({ row, timeZone, open, onToggle }) {
  const tone = row.level === 'ERROR' ? 'bg-danger-soft/40' : row.level === 'WARN' ? 'bg-warning-soft/40' : '';
  return (
    <li className={tone}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-5 py-3 text-left text-sm transition-colors hover:bg-black/[0.03] sm:grid-cols-[4.5rem_5.5rem_11rem_12rem_minmax(0,1fr)_5rem]"
      >
        <time dateTime={row.createdAt} className="font-mono text-xs text-ink-muted tabular-nums">
          {formatClockSeconds(row.createdAt, timeZone)}
        </time>
        <span className="sm:order-none">
          <LevelBadge level={row.level} />
        </span>
        <span className="truncate font-semibold text-ink" title={row.actorName}>
          {row.actorName}
        </span>
        <span className="truncate font-mono text-xs text-ink-soft" title={row.eventName ?? ''}>
          {row.eventName ?? '—'}
        </span>
        <span className="col-span-2 truncate text-ink-soft sm:col-span-1" title={row.message}>
          {row.message}
        </span>
        <span className="text-right font-mono text-xs text-ink-muted tabular-nums">{formatDuration(row.durationMs)}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line bg-surface-muted/40 px-5 py-4">
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{row.message}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
            <span>Olay kimliği: {row.eventId ?? '—'}</span>
            <ChainLink correlationId={row.correlationId} />
          </div>
          <JsonBlock label="Ayrıntı" value={row.meta} />
        </div>
      )}
    </li>
  );
}
