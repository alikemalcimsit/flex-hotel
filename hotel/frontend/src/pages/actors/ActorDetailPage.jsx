import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, EmptyState, Spinner } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Switch } from '../../components/Switch.jsx';
import { formatDuration } from '../../lib/activity.js';
import { api } from '../../lib/api.js';
import { actorKeys, formatCount } from '../../lib/actors.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { ACTORS_CHANNEL, MANUAL_TASKS_CHANNEL } from '../../lib/socket.js';
import { formatDateTime, formatElapsed } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { useNow } from '../../lib/useNow.js';
import { ChainLink, LevelBadge, QueryError, goBack } from '../activity/shared.jsx';
import { HealthBadge, TypeBadge } from './actorParts.jsx';
import { AgentUsageCard } from './AgentUsageCard.jsx';
import { DisableActorDialog, useActorToggle } from './ToggleActorDialog.jsx';

const STATS_REFRESH_MS = 60_000;
const CLOCK_TICK_MS = 60_000;
const TASKS_MIN_REFRESH_MS = 10_000;

/** Arka plan sırası taşınca ne olur. */
const OVERFLOW_LABELS = Object.freeze({
  fallback: 'iş personele manuel görev olarak düşer',
  skip: 'iş atlanır; aktörün zamanlanmış işi sonra tekrar dener',
});

/**
 * Aktör detayı (modül 12): açıklama, bu oteldeki durum, "kapatırsam ne
 * olur", dinlediği / yayınladığı olaylar (kim yayınlıyor, kim dinliyor),
 * onay gerektiren işler, yeniden deneme politikası, son işler; LLM ajanıysa
 * model ve kullanım kartı.
 */
export function ActorDetailPage() {
  const { name } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const canManage = can(PERMISSIONS.ACTORS_MANAGE);
  const canActivity = can(PERMISSIONS.ACTIVITY_VIEW);
  const { timeZone } = useHotelToday();
  const now = useNow(CLOCK_TICK_MS);
  const [disabling, setDisabling] = useState(false);
  const toggle = useActorToggle();

  useLiveChannel(ACTORS_CHANNEL, { queryKeys: [actorKeys.detail(name)] });
  useLiveChannel(MANUAL_TASKS_CHANNEL, { queryKeys: [actorKeys.detail(name)], minIntervalMs: TASKS_MIN_REFRESH_MS });
  const query = useQuery({
    queryKey: actorKeys.detail(name),
    queryFn: () => api(`/actors/${encodeURIComponent(name)}`),
    refetchInterval: STATS_REFRESH_MS,
  });

  const back = (
    <Button variant="outline" size="sm" icon="arrowLeft" onClick={() => goBack(navigate, '/aktorler')}>
      Geri
    </Button>
  );

  if (query.isPending) return <Spinner label="Aktör yükleniyor…" className="py-16" />;
  if (query.isError) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Aktör" actions={back} />
        <QueryError query={query} title={query.error?.code === 'NOT_FOUND' ? 'Böyle bir aktör yok' : 'Aktör yüklenemedi'} />
      </div>
    );
  }

  const actor = query.data;
  const onToggle = (next) => {
    if (next) toggle.mutate({ name: actor.name, enabled: true });
    else setDisabling(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={actor.title}
        description={actor.description}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {canManage ? (
              <Switch
                checked={actor.enabled}
                onChange={onToggle}
                busy={toggle.isPending}
                showLabel
                label={actor.enabled ? 'Açık' : 'Kapalı'}
              />
            ) : (
              <Badge tone={actor.enabled ? 'success' : 'danger'}>{actor.enabled ? 'Açık' : 'Kapalı'}</Badge>
            )}
            {back}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <TypeBadge type={actor.type} />
        <HealthBadge health={actor.health} />
        <span className="font-mono">{actor.name}</span>
        {actor.packageName && <span className="font-mono">· {actor.packageName}</span>}
      </div>

      {!actor.registered && (
        <Alert tone="info" title="Sunucuda kurulu değil">
          {actor.unavailableReason} Ayarı yine değiştirilebilir; kurulduğu gün geçerli olur.
        </Alert>
      )}
      {!actor.enabled && (
        <Alert tone="warning" title="Bu aktör kapalı">
          İşleri “{actor.fallbackModule}” manuel görevi olarak personele düşüyor.
          {actor.changedBy && (
            <>
              {' '}
              {actor.changedByLabel ?? actor.changedBy} kapattı ({formatDateTime(actor.changedAt, timeZone)})
              {actor.note ? `: “${actor.note}”` : '.'}
            </>
          )}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={`Son 24 saatte iş`} value={formatCount(actor.stats.runs)} hint={actor.stats.lastAt ? `Son iş ${formatElapsed(actor.stats.lastAt, now)} önce` : 'Henüz iş yok'} />
        <Tile
          label="Uyarı · hata"
          value={`${formatCount(actor.stats.warnings)} · ${formatCount(actor.stats.errors)}`}
          hint="Son 24 saat"
          tone={actor.stats.errors > 0 ? 'danger' : actor.stats.warnings > 0 ? 'warning' : null}
        />
        <Tile
          label="Açık manuel görev"
          value={formatCount(actor.openTasks)}
          hint={actor.oldestOpenTaskAt ? `En eskisi ${formatElapsed(actor.oldestOpenTaskAt, now)} önce` : 'Personele düşmüş iş yok'}
          tone={actor.openTasks > 0 ? 'warning' : null}
          to={actor.openTasks > 0 ? `/gorevler?aktor=${encodeURIComponent(actor.name)}` : null}
        />
        <Tile
          label="Sıra (bu sunucu)"
          value={actor.backlog ? `${formatCount(actor.backlog.running)} · ${formatCount(actor.backlog.queued)}` : '—'}
          hint={actor.backlog ? 'Çalışan · sırada bekleyen' : 'Olayı yayıncıyla aynı anda işler'}
          tone={actor.backlog?.queued > 0 ? 'warning' : null}
        />
      </div>

      {actor.llm && <AgentUsageCard actorName={actor.name} llm={actor.llm} />}

      <Card title="Kapatırsam ne olur?">
        <ul className="list-inside list-disc space-y-1.5 text-sm text-ink-soft">
          <li>
            Dinlediği olaylardaki işler <strong className="text-ink">“{actor.fallbackModule}”</strong> manuel görevi olarak o işe yetkili
            personelin önüne düşer; hiçbir iş kaybolmaz.
          </li>
          {actor.type === 'agent' && <li>AI misafire cevap vermez: yeni konuşmalar personelde açılır, süren AI konuşmaları personele geçer.</li>}
          {actor.downstream.length > 0 ? (
            <li>
              Yayınladığı olayları bekleyen aktörler bu olayları ondan almaz:{' '}
              {actor.downstream.map((other, index) => (
                <span key={other.name}>
                  {index > 0 && ', '}
                  <Link to={`/aktorler/${encodeURIComponent(other.name)}`} className="font-semibold text-ink hover:underline">
                    {other.title}
                  </Link>
                </span>
              ))}
              .
            </li>
          ) : (
            <li>Yayınladığı olayları dinleyen başka aktör yok; zincir kesilmez.</li>
          )}
          <li>Personelin onayladığı işler aktör kapalı olsa da yapılır (onay bir kez verilmiştir).</li>
        </ul>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Dinlediği olaylar" description="Bu olaylar gelince aktör çalışır. Yanında olayı yayınlayan diğer aktörler (servisler de yayınlayabilir).">
          <EventList links={actor.subscribes} related={(link) => link.publishedBy} relatedLabel="Yayınlayan" empty="Hiçbir olayı dinlemiyor." />
        </Card>
        <Card title="Yayınladığı olaylar" description="Aktör işini bitirince bu olayları yayınlar. Yanında o olayı dinleyen aktörler.">
          <EventList links={actor.publishes} related={(link) => link.consumedBy} relatedLabel="Dinleyen" empty="Olay yayınlamıyor." />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Onay gerektiren işler" description="Aktör bu işleri kendi başına yapmaz; personelin onayına (Yönetim › Onaylar) götürür.">
          {actor.requiresApproval.length === 0 ? (
            <p className="text-sm text-ink-muted">Bu aktör onaya iş götürmez.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {actor.requiresApproval.map((action) => (
                <li key={action}>
                  <Badge tone="info">{action}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Yeniden deneme politikası">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Fact label="Deneme sayısı">{actor.retry.attempts} kez</Fact>
            <Fact label="Bekleme">
              {formatDuration(actor.retry.backoffMs)} × deneme (artarak)
            </Fact>
            <Fact label="Olmazsa">“{actor.fallbackModule}” manuel görevi</Fact>
            {actor.backgroundLimits ? (
              <Fact label="Arka plan">
                Aynı anda en fazla {actor.backgroundLimits.maxConcurrent} iş, {formatCount(actor.backgroundLimits.maxQueued)} iş sırada; sıra dolarsa{' '}
                {OVERFLOW_LABELS[actor.backgroundLimits.onOverflow] ?? actor.backgroundLimits.onOverflow}.
              </Fact>
            ) : (
              <Fact label="Çalışma">Olayı yayınlayanla aynı anda (kısa, veritabanı içi iş)</Fact>
            )}
          </dl>
          <p className="mt-3 text-xs text-ink-muted">İş kuralı hataları (ör. uygun oda yok) denenmeden doğrudan personele düşer.</p>
        </Card>
      </div>

      <Card
        title="Son işler"
        actions={
          canActivity && (
            <Button variant="outline" size="sm" icon="zap" onClick={() => navigate(`/aktivite/akis?aktor=${encodeURIComponent(actor.name)}`)}>
              Aktivite akışında gör
            </Button>
          )
        }
      >
        {actor.recent.length === 0 ? (
          <EmptyState icon="clock" title="Henüz iş yok" description="Aktör bir olay işledikçe burada görünür." />
        ) : (
          <ol className="divide-y divide-line">
            {actor.recent.map((row) => (
              <li key={row.id} className="grid grid-cols-1 gap-x-4 gap-y-1 py-2.5 text-sm sm:grid-cols-[9rem_6.5rem_minmax(0,1fr)_5rem_5rem] sm:items-center">
                <time dateTime={row.createdAt} className="text-xs tabular-nums text-ink-muted">
                  {formatDateTime(row.createdAt, timeZone)}
                </time>
                <span>
                  <LevelBadge level={row.level} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-ink-soft" title={row.message}>
                    {row.message}
                  </span>
                  {row.eventName && (
                    <span className="block truncate text-xs text-ink-muted" title={row.eventName}>
                      {row.eventLabel}
                    </span>
                  )}
                </span>
                <span className="font-mono text-xs text-ink-muted sm:text-right">{row.durationMs !== null ? formatDuration(row.durationMs) : ''}</span>
                <span className="sm:text-right">{canActivity && <ChainLink correlationId={row.correlationId} compact />}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {disabling && <DisableActorDialog actor={actor} downstream={actor.downstream} onClose={() => setDisabling(false)} />}
    </div>
  );
}

/**
 * @param {{
 *   links: Array<{ event: string, label: string }>,
 *   related: (link: any) => Array<{ name: string, title: string }>,
 *   relatedLabel: string,
 *   empty: string,
 * }} props
 */
function EventList({ links, related, relatedLabel, empty }) {
  if (links.length === 0) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {links.map((link) => {
        const others = related(link);
        return (
          <li key={link.event} className="py-2.5">
            <p className="text-sm font-semibold text-ink">{link.label}</p>
            <p className="font-mono text-[0.7rem] text-ink-muted">{link.event}</p>
            {others.length > 0 && (
              <p className="mt-1 text-xs text-ink-soft">
                {relatedLabel}:{' '}
                {others.map((other, index) => (
                  <span key={other.name}>
                    {index > 0 && ', '}
                    <Link to={`/aktorler/${encodeURIComponent(other.name)}`} className="hover:underline">
                      {other.title}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** @param {{ label: string, value: string, hint: string, tone?: 'danger' | 'warning' | null, to?: string | null }} props */
function Tile({ label, value, hint, tone = null, to = null }) {
  const color = tone === 'danger' ? 'text-sec-strong' : tone === 'warning' ? 'text-warning-ink' : 'text-ink';
  const body = (
    <>
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-ink-muted">{hint}</p>
    </>
  );
  const className = 'block rounded-card bg-surface px-4 py-3 shadow-card';
  return to ? (
    <Link to={to} className={`${className} hover:bg-black/[0.02]`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** @param {{ label: string, children: React.ReactNode }} props */
function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
