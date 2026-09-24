import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ACTIVITY_PAGE_SIZE, AUDIT_ACTION_LABELS, AUDIT_ACTIONS, AUDIT_ENTITIES, AUDIT_ENTITY_LABELS, EMAIL_PATTERN } from '@hotelos/hotel-contracts';
import { Button, Card, EmptyState, Input, Select, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { activityKeys, actorKindLabel, actorLabel, dayRange, fieldLabel } from '../../lib/activity.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { AuditValues } from './AuditValues.jsx';
import { ChainLink, DayRangeInputs, OlderRows, QueryError, useUrlFilters } from './shared.jsx';

const FILTER_PARAMS = Object.freeze({ actor: 'kisi', entity: 'tur', entityId: 'kayit', action: 'islem', from: 'baslangic', to: 'bitis' });
const ENTITY_OPTIONS = [
  { value: '', label: 'Tüm kayıt türleri' },
  ...AUDIT_ENTITIES.map((value) => ({ value, label: AUDIT_ENTITY_LABELS[value] })).sort((a, b) => a.label.localeCompare(b.label, 'tr')),
];
const ACTION_OPTIONS = [{ value: '', label: 'Tüm işlemler' }, ...AUDIT_ACTIONS.map((value) => ({ value, label: AUDIT_ACTION_LABELS[value] }))];

/** Aktör adı biçimi (e-posta değilse): "room-worker", "kanal:whatsapp". */
const ACTOR_NAME_PATTERN = /^[a-z0-9:._-]{2,100}$/;

/**
 * Denetim kaydı (modül 10): kim hangi kaydı ne zaman nasıl değiştirdi.
 * Kişi (e-posta ya da aktör adı), kayıt türü, işlem ve gün süzgeçleri; satırdan
 * "bu kişinin değişiklikleri", "bu kaydın geçmişi" ve işlemin zinciri.
 */
export function AuditTab() {
  const { timeZone } = useHotelToday();
  const filters = useUrlFilters(FILTER_PARAMS);
  const { actor, entity, entityId, action, from, to } = filters.values;
  const [actorDraft, setActorDraft] = useState(actor);
  const [actorError, setActorError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const serverFilters = useMemo(
    () => ({
      ...(actor ? { actor } : {}),
      ...(entity ? { entity } : {}),
      ...(entity && entityId ? { entityId } : {}),
      ...(action ? { action } : {}),
      ...dayRange({ from, to }, timeZone),
    }),
    [actor, entity, entityId, action, from, to, timeZone],
  );
  const query = useInfiniteQuery({
    queryKey: activityKeys.audit(serverFilters),
    queryFn: ({ pageParam }) => api(withQuery('/audit', { ...serverFilters, cursor: pageParam, limit: ACTIVITY_PAGE_SIZE })),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];

  function applyActor(event) {
    event.preventDefault();
    const value = actorDraft.trim().toLowerCase();
    if (value && !EMAIL_PATTERN.test(value) && !ACTOR_NAME_PATTERN.test(value)) {
      setActorError('Personelin e-postasını ya da aktör adını yazın');
      return;
    }
    setActorError(null);
    filters.set('actor', value);
  }

  const showPerson = (value) => {
    setActorDraft(value);
    filters.setMany({ actor: value });
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_10rem_10rem]">
          <form onSubmit={applyActor}>
            <Input
              label="Kişi (e-posta ya da aktör)"
              name="audit-actor"
              value={actorDraft}
              placeholder="ornek@otel.com — Enter"
              error={actorError ?? undefined}
              onChange={(event) => setActorDraft(event.target.value)}
            />
          </form>
          <Select
            label="Kayıt türü"
            name="audit-entity"
            value={entity}
            options={ENTITY_OPTIONS}
            onChange={(event) => filters.setMany({ entity: event.target.value, entityId: '' })}
          />
          <Select label="İşlem" name="audit-action" value={action} options={ACTION_OPTIONS} onChange={(event) => filters.set('action', event.target.value)} />
          <DayRangeInputs idPrefix="audit" from={from} to={to} onChange={(patch) => filters.setMany(patch)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          {entity && entityId && (
            <span className="text-xs font-semibold text-ink-soft">
              Yalnızca bu kayıt: {AUDIT_ENTITY_LABELS[entity] ?? entity} · {entityId}
            </span>
          )}
          <span className="flex-1" />
          {filters.active && (
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              onClick={() => {
                setActorDraft('');
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
        <Spinner label="Denetim kaydı yükleniyor…" className="py-10" />
      ) : query.isError ? (
        <QueryError query={query} title="Denetim kaydı yüklenemedi" />
      ) : (
        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          {rows.length === 0 ? (
            <EmptyState icon="fileText" title={filters.active ? 'Bu süzgeçle değişiklik yok' : 'Henüz değişiklik kaydı yok'} />
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
                      className="grid w-full grid-cols-1 gap-x-4 gap-y-1 px-5 py-3 text-left text-sm hover:bg-black/[0.03] sm:grid-cols-[9.5rem_minmax(0,1fr)_6rem_minmax(0,1fr)_minmax(0,1.2fr)]"
                    >
                      <time dateTime={row.createdAt} className="text-xs text-ink-muted tabular-nums">
                        {formatDateTime(row.createdAt, timeZone)}
                      </time>
                      <span className="truncate font-semibold text-ink" title={row.actor}>
                        {actorLabel(row.actor, row.actorLabel)}{' '}
                        <span className="text-xs font-normal text-ink-muted">· {actorKindLabel(row.actor)}</span>
                      </span>
                      <span className="text-ink-soft">{AUDIT_ACTION_LABELS[row.action] ?? row.action}</span>
                      <span className="truncate text-ink-soft" title={row.entityId}>
                        {row.entityLabel}
                      </span>
                      <span className="truncate text-xs text-ink-muted">
                        {row.changedFields.length > 0 ? row.changedFields.map(fieldLabel).join(', ') : '—'}
                      </span>
                    </button>
                    {open && (
                      <div className="flex flex-col gap-4 border-t border-line bg-surface-muted/40 px-5 py-4">
                        <AuditValues row={row} />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="outline" size="sm" icon="user" onClick={() => showPerson(row.actor)}>
                            Bu kişinin değişiklikleri
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            icon="list"
                            onClick={() => filters.setMany({ entity: row.entity, entityId: row.entityId })}
                          >
                            Bu kaydın geçmişi
                          </Button>
                          <ChainLink correlationId={row.correlationId} />
                          <span className="text-xs text-ink-muted">Kayıt kimliği: {row.entityId}</span>
                        </div>
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
