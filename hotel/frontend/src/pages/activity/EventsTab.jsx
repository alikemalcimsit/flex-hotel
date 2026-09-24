import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ACTIVITY_PAGE_SIZE, CORRELATION_ID_PATTERN } from '@hotelos/hotel-contracts';
import { Badge, Button, Card, Checkbox, EmptyState, Input, Select, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { activityKeys, actorKindLabel, actorLabel, dayRange, formatClockSeconds } from '../../lib/activity.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { ChainLink, DayRangeInputs, JsonBlock, OlderRows, QueryError, useUrlFilters } from './shared.jsx';

const FILTER_PARAMS = Object.freeze({ name: 'olay', unpublished: 'bekleyen', correlationId: 'zincir', from: 'baslangic', to: 'bitis' });

/**
 * Olaylar (modül 10): sistemde yayınlanan her olay, en yeni üstte. "Yalnızca
 * dağıtılmamış" süzgeci outbox'ta takılı kalanları gösterir — normalde boş
 * olmalı; doluysa dağıtıcı iş (30 sn'de bir) yeniden deniyor demektir.
 * Olay gövdesindeki telefon, e-posta, kimlik gibi alanlar sunucuda maskelenir.
 */
export function EventsTab() {
  const { timeZone } = useHotelToday();
  const filters = useUrlFilters(FILTER_PARAMS);
  const { name, unpublished, correlationId, from, to } = filters.values;
  const [chainDraft, setChainDraft] = useState(correlationId);
  const [chainError, setChainError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const serverFilters = useMemo(
    () => ({
      ...(name ? { name } : {}),
      ...(unpublished ? { unpublished: 'true' } : {}),
      ...(correlationId ? { correlationId } : {}),
      ...dayRange({ from, to }, timeZone),
    }),
    [name, unpublished, correlationId, from, to, timeZone],
  );
  const options = useQuery({ queryKey: activityKeys.options, queryFn: () => api('/activity/options'), staleTime: 5 * 60_000 });
  const query = useInfiniteQuery({
    queryKey: activityKeys.events(serverFilters),
    queryFn: ({ pageParam }) => api(withQuery('/activity/events', { ...serverFilters, cursor: pageParam, limit: ACTIVITY_PAGE_SIZE })),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const eventOptions = [{ value: '', label: 'Tüm olaylar' }, ...(options.data?.events ?? []).map((value) => ({ value, label: value }))];

  function applyChain(event) {
    event.preventDefault();
    const value = chainDraft.trim();
    if (value && !CORRELATION_ID_PATTERN.test(value)) {
      setChainError('Zincir kimliği 8-128 karakter; harf, rakam, nokta, tire, iki nokta');
      return;
    }
    setChainError(null);
    filters.set('correlationId', value);
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_10rem]">
          <Select label="Olay" name="events-name" value={name} options={eventOptions} onChange={(event) => filters.set('name', event.target.value)} />
          <form onSubmit={applyChain} className="flex items-end gap-2">
            <Input
              label="Zincir kimliği"
              name="events-chain"
              value={chainDraft}
              placeholder="Yapıştırıp Enter"
              error={chainError ?? undefined}
              onChange={(event) => setChainDraft(event.target.value)}
              className="min-w-0 flex-1"
            />
          </form>
          <DayRangeInputs idPrefix="events" from={from} to={to} onChange={(patch) => filters.setMany(patch)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Checkbox
            id="events-unpublished"
            label="Yalnızca dağıtılmamış olaylar"
            hint="Kaydedilmiş ama dinleyicilere ulaştırılamamış (outbox'ta bekleyen) olaylar."
            checked={Boolean(unpublished)}
            onChange={(event) => filters.set('unpublished', event.target.checked ? '1' : '')}
          />
          <span className="flex-1" />
          {filters.active && (
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              onClick={() => {
                setChainDraft('');
                filters.clear();
              }}
            >
              Süzgeçleri temizle
            </Button>
          )}
          <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()} disabled={query.isFetching}>
            Yenile
          </Button>
        </div>
      </Card>

      {query.isPending ? (
        <Spinner label="Olaylar yükleniyor…" className="py-10" />
      ) : query.isError ? (
        <QueryError query={query} title="Olaylar yüklenemedi" />
      ) : (
        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          {rows.length === 0 ? (
            <EmptyState
              icon={unpublished ? 'checkCircle' : 'zap'}
              title={unpublished ? 'Dağıtılmayı bekleyen olay yok' : filters.active ? 'Bu süzgeçle olay yok' : 'Henüz olay yok'}
            />
          ) : (
            <ol className="divide-y divide-line">
              {rows.map((row) => {
                const open = expanded === row.id;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : row.id)}
                      className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-5 py-3 text-left text-sm hover:bg-black/[0.03] sm:grid-cols-[4.5rem_minmax(0,1.3fr)_minmax(0,1fr)_4rem_8rem]"
                    >
                      <time dateTime={row.occurredAt} title={formatDateTime(row.occurredAt, timeZone)} className="font-mono text-xs text-ink-muted tabular-nums">
                        {formatClockSeconds(row.occurredAt, timeZone)}
                      </time>
                      <span className="truncate font-mono text-xs font-semibold text-ink">{row.name}</span>
                      <span className="truncate text-ink-soft" title={row.actor}>
                        {actorLabel(row.actor)} <span className="text-xs text-ink-muted">· {actorKindLabel(row.actor)}</span>
                      </span>
                      <span className="text-xs text-ink-muted" title="Zincirdeki derinlik">
                        adım {row.hop}
                      </span>
                      <span>
                        <Badge tone={row.publishedAt ? 'success' : 'warning'}>{row.publishedAt ? 'Dağıtıldı' : 'Bekliyor'}</Badge>
                      </span>
                    </button>
                    {open && (
                      <div className="flex flex-col gap-3 border-t border-line bg-surface-muted/40 px-5 py-4">
                        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                          <span>Kimlik: {row.id}</span>
                          {row.causationId && <span>Sebep olay: {row.causationId}</span>}
                          <span>Dağıtım: {row.publishedAt ? formatDateTime(row.publishedAt, timeZone) : 'henüz yok'}</span>
                          <ChainLink correlationId={row.correlationId} />
                        </div>
                        <JsonBlock label="Gövde (kişisel veri maskeli)" value={row.payload} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <OlderRows query={query} emptyShown={rows.length === 0} />
        </div>
      )}
    </div>
  );
}
