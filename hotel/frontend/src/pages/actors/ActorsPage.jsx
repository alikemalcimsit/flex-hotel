import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, EmptyState, Spinner } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Switch } from '../../components/Switch.jsx';
import { api } from '../../lib/api.js';
import { actorKeys, formatCount, formatUsd } from '../../lib/actors.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { ACTORS_CHANNEL, MANUAL_TASKS_CHANNEL } from '../../lib/socket.js';
import { formatElapsed } from '../../lib/timeFormat.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { useNow } from '../../lib/useNow.js';
import { QueryError } from '../activity/shared.jsx';
import { BudgetBar, HealthBadge, TypeBadge } from './actorParts.jsx';
import { DisableActorDialog, useActorToggle } from './ToggleActorDialog.jsx';

/** Son 24 saat sayaçları ve "son iş" zamanla eskir; bağlantı olsa da dakikada bir tazelenir. */
const STATS_REFRESH_MS = 60_000;
const CLOCK_TICK_MS = 60_000;
/** Görev sayıları her görev haberinde değil, en fazla bu aralıkla tazelenir. */
const TASKS_MIN_REFRESH_MS = 10_000;

/**
 * Aktör paneli (modül 12): her aktör tek satırda — ne olduğu, bu otelde açık
 * mı, son 24 saatte ne yaptı, personele iş düşürüyor mu. Yönetici anahtarla
 * açar / kapatır (kapatma neyin duracağını söyleyip gerekçe sorar). LLM
 * ajanlarının bugünkü harcaması üstte, bütçeyle birlikte.
 */
export function ActorsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.ACTORS_MANAGE);
  const now = useNow(CLOCK_TICK_MS);
  const [disabling, setDisabling] = useState(null);
  const toggle = useActorToggle();

  useLiveChannel(ACTORS_CHANNEL, { queryKeys: [actorKeys.all] });
  useLiveChannel(MANUAL_TASKS_CHANNEL, { queryKeys: [actorKeys.list], minIntervalMs: TASKS_MIN_REFRESH_MS });
  const query = useQuery({ queryKey: actorKeys.list, queryFn: () => api('/actors'), refetchInterval: STATS_REFRESH_MS });

  const onToggle = (actor) => (next) => {
    if (next) toggle.mutate({ name: actor.name, enabled: true });
    else setDisabling(actor);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Aktörler"
        description="İşi kendiliğinden yapan parçalar: oda atama, bildirim, kanal geçitleri, AI ajanları. Kapatılan aktörün işi kaybolmaz; “Görevler”e düşer ve personel elle yapar."
      />

      {query.isPending && <Spinner label="Aktörler yükleniyor…" className="py-16" />}
      {query.isError && <QueryError query={query} title="Aktörler yüklenemedi" />}

      {query.data && (
        <>
          <LlmSummary data={query.data} />
          <Card
            title="Aktörler"
            description={`Sayaçlar son ${query.data.windowHours} saatin. Satıra tıklayınca aktörün ne dinlediği, ne yayınladığı ve kapatılınca neyin duracağı görünür.`}
          >
            {query.data.items.length === 0 ? (
              <EmptyState icon="server" title="Kayıtlı aktör yok" description="Sunucu aktör kaydetmemiş; tüm işler personelde." />
            ) : (
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[56rem] text-sm">
                  <thead className="text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                    <tr>
                      <th scope="col" className="px-2 py-2 font-bold">Aktör</th>
                      <th scope="col" className="px-2 py-2 font-bold">Tür</th>
                      <th scope="col" className="px-2 py-2 font-bold">Paket</th>
                      <th scope="col" className="px-2 py-2 font-bold">Durum</th>
                      <th scope="col" className="px-2 py-2 text-right font-bold">İş · uyarı · hata</th>
                      <th scope="col" className="px-2 py-2 text-right font-bold">Açık görev</th>
                      <th scope="col" className="px-2 py-2 text-right font-bold">Açık / kapalı</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((actor) => (
                      <tr key={actor.name} className="border-t border-line align-top">
                        <td className="max-w-[22rem] px-2 py-3">
                          <Link to={`/aktorler/${encodeURIComponent(actor.name)}`} className="font-bold text-ink hover:underline">
                            {actor.title}
                          </Link>
                          <p className="font-mono text-[0.7rem] text-ink-muted">{actor.name}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{actor.description}</p>
                        </td>
                        <td className="px-2 py-3">
                          <TypeBadge type={actor.type} />
                        </td>
                        <td className="px-2 py-3 font-mono text-xs text-ink-soft">{actor.packageName ?? '—'}</td>
                        <td className="px-2 py-3">
                          <HealthBadge health={actor.health} />
                          <p className="mt-1 text-xs text-ink-muted">
                            {actor.stats.lastAt ? `Son iş ${formatElapsed(actor.stats.lastAt, now)} önce` : 'Henüz iş yok'}
                          </p>
                          {!actor.enabled && actor.changedBy && (
                            <p className="text-xs text-ink-muted" title={actor.note ?? undefined}>
                              {actor.changedByLabel ?? actor.changedBy} kapattı{actor.note ? `: ${actor.note}` : ''}
                            </p>
                          )}
                          {actor.unavailableReason && <p className="text-xs text-ink-muted">{actor.unavailableReason}</p>}
                          {actor.backlog && actor.backlog.queued > 0 && (
                            <p className="text-xs font-semibold text-warning-ink">Sırada {formatCount(actor.backlog.queued)} iş</p>
                          )}
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">
                          {formatCount(actor.stats.runs)} ·{' '}
                          <span className={actor.stats.warnings > 0 ? 'font-semibold text-warning-ink' : ''}>{formatCount(actor.stats.warnings)}</span> ·{' '}
                          <span className={actor.stats.errors > 0 ? 'font-semibold text-sec-strong' : ''}>{formatCount(actor.stats.errors)}</span>
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">
                          {actor.openTasks > 0 ? (
                            <Link to={`/gorevler?aktor=${encodeURIComponent(actor.name)}`} className="font-semibold text-ink underline-offset-2 hover:underline">
                              {formatCount(actor.openTasks)}
                            </Link>
                          ) : (
                            <span className="text-ink-muted">0</span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-right">
                          {canManage ? (
                            <Switch
                              checked={actor.enabled}
                              onChange={onToggle(actor)}
                              busy={toggle.isPending && toggle.variables?.name === actor.name}
                              label={`${actor.title}: ${actor.enabled ? 'açık, kapatmak için' : 'kapalı, açmak için'} tıklayın`}
                            />
                          ) : (
                            <Badge tone={actor.enabled ? 'success' : 'danger'}>{actor.enabled ? 'Açık' : 'Kapalı'}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {disabling && <DisableActorDialog actor={disabling} onClose={() => setDisabling(null)} />}
    </div>
  );
}

/**
 * LLM ajanları: otelin bugünkü AI harcaması, bütçesi ve ajan başına pay.
 * @param {{ data: { llm: any, items: any[] } }} props
 */
function LlmSummary({ data }) {
  const navigate = useNavigate();
  const canSeeSettings = useCan()(PERMISSIONS.SETTINGS_VIEW);
  const agents = data.items.filter((actor) => actor.type === 'agent');
  if (agents.length === 0) return null;
  const { llm } = data;
  return (
    <Card
      title="LLM ajanları — bugün"
      description="Bütçe otelin tamamı için; ajanlar paylaşır. Tutarlar ayardaki model fiyatlarıyla hesaplanan tahmindir, sağlayıcının faturasıyla küçük farklar olabilir."
      actions={
        canSeeSettings && (
          <Button variant="outline" size="sm" icon="settings" onClick={() => navigate('/ayarlar/ai')}>
            AI ayarları
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {!llm.keyConfigured && (
          <Alert tone="info" title="Sunucuda OpenAI anahtarı tanımlı değil">
            Ajanlar çalışmıyor; misafir konuşmaları personelde. Anahtar sunucu ayarına (`OPENAI_API_KEY`) girilince ajanlar başlar.
          </Alert>
        )}
        {llm.keyConfigured && !llm.aiEnabled && (
          <Alert tone="info">AI asistanı bu otelde kapalı (Ayarlar › AI asistanı); ajanlar misafire cevap vermiyor.</Alert>
        )}
        <BudgetBar spent={llm.spentUsd} budget={llm.budgetUsd} label="Bugünkü AI harcamasının bütçeye oranı" />
        <ul className="grid gap-3 sm:grid-cols-2">
          {agents.map((agent) => (
            <li key={agent.name} className="flex items-center justify-between gap-3 rounded-control border border-line px-4 py-3">
              <div>
                <Link to={`/aktorler/${encodeURIComponent(agent.name)}`} className="text-sm font-bold text-ink hover:underline">
                  {agent.title}
                </Link>
                <p className="text-xs text-ink-muted">{agent.enabled ? 'Açık' : 'Kapalı'}</p>
              </div>
              <span className="text-sm font-bold tabular-nums text-ink">{formatUsd(agent.costTodayUsd)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
