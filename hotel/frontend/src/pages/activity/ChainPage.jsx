import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon, Spinner } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api } from '../../lib/api.js';
import { activityKeys, actorKindLabel, actorLabel, fieldLabel, formatAuditValue, formatClockSeconds, formatDuration } from '../../lib/activity.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { goBack, JsonBlock, LevelBadge, QueryError } from './shared.jsx';

/**
 * İşlem zinciri (modül 10): tek tetikle (personelin tıklaması, misafirin
 * mesajı, zamanlanmış iş) başlayan bütün adımlar, ağaç olarak:
 *
 * - **Olay**: ne oldu, kim yayınladı.
 * - **İşleyiş**: hangi aktör işledi, sonuç, ne kadar sürdü.
 * - **Değişiklik**: hangi kayıt nasıl değişti (eski → yeni, denetim izniyle).
 *
 * Her adımın zincirin başından geçen süresi yanında yazar ("+12 ms").
 */
export function ChainPage() {
  const { correlationId } = useParams();
  const navigate = useNavigate();
  const { timeZone } = useHotelToday();
  const query = useQuery({
    queryKey: activityKeys.chain(correlationId),
    queryFn: () => api(`/activity/chains/${encodeURIComponent(correlationId)}`),
  });

  const back = (
    <Button variant="outline" size="sm" icon="arrowLeft" onClick={() => goBack(navigate, '/aktivite/akis')}>
      Geri
    </Button>
  );

  if (query.isPending) return <Spinner label="Zincir yükleniyor…" className="py-16" />;
  if (query.isError) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="İşlem zinciri" actions={back} />
        <QueryError query={query} title={query.error?.code === 'NOT_FOUND' ? 'Bu zincire ait kayıt yok' : 'Zincir yüklenemedi'} />
      </div>
    );
  }

  const chain = query.data;
  const origin = Date.parse(chain.startedAt);
  const trigger = chain.roots[0];
  const triggerActor = trigger ? (trigger.kind === 'HANDLER' ? trigger.actorName : trigger.actor) : null;
  const records = distinctRecords(chain.roots);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="İşlem zinciri"
        description="Bu işlemle başlayan her adım: yayınlanan olaylar, onları işleyen aktörler, değişen kayıtlar. Süreler zincirin başından itibaren."
        actions={back}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Summary label="Başladı" value={formatDateTime(chain.startedAt, timeZone)} />
        <Summary label="Başlatan" value={triggerActor ? `${actorLabel(triggerActor, chain.people[triggerActor])}` : '—'} hint={triggerActor ? actorKindLabel(triggerActor) : null} />
        <Summary label="Toplam süre" value={formatDuration(chain.spanMs)} />
        <Summary label="Adımlar" value={`${chain.counts.events} olay · ${chain.counts.handlers} işleyiş · ${chain.counts.audits} değişiklik`} />
        <Summary
          label="Sonuç"
          value={chain.counts.errors > 0 ? `${chain.counts.errors} hata` : chain.counts.warnings > 0 ? `${chain.counts.warnings} uyarı` : 'Sorunsuz'}
          tone={chain.counts.errors > 0 ? 'danger' : chain.counts.warnings > 0 ? 'warning' : 'success'}
        />
      </div>

      {chain.truncated && (
        <Alert tone="warning" title="Zincir çok uzun">
          Her kaynaktan ilk 500 adım gösteriliyor.
        </Alert>
      )}
      {chain.counts.unpublished > 0 && (
        <Alert tone="warning" title="Dağıtılmamış olay var">
          {chain.counts.unpublished} olay kaydedildi ama henüz dinleyicilere ulaşmadı; dağıtıcı iş yeniden deniyor.
        </Alert>
      )}
      {!chain.valuesIncluded && chain.counts.audits > 0 && (
        <Alert tone="info">Değişikliklerin eski/yeni değerlerini görmek için "Denetim kaydını görüntüle" izni gerekir.</Alert>
      )}

      <Card title="Adımlar">
        <ol className="flex flex-col gap-2">
          {chain.roots.map((node) => (
            <ChainNode key={`${node.kind}:${node.id}`} node={node} origin={origin} people={chain.people} timeZone={timeZone} depth={0} />
          ))}
        </ol>
      </Card>

      {records.length > 0 && (
        <Card title="Bu zincirde değişen kayıtlar" description="Kaydın bütün zincirlerini (ör. bir rezervasyonun oluşturulması, oda ataması, girişi) görmek için tıklayın.">
          <ul className="flex flex-wrap gap-2">
            {records.map((record) => (
              <li key={`${record.entity}:${record.entityId}`}>
                <Link
                  to={`/aktivite/kayit/${encodeURIComponent(record.entity)}/${encodeURIComponent(record.entityId)}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-black/[0.04] hover:text-ink"
                >
                  <Icon name="list" className="size-3.5" />
                  {AUDIT_ENTITY_LABELS[record.entity] ?? record.entity} · {record.entityId.slice(0, 8)}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-xs text-ink-muted">Zincir kimliği: {chain.correlationId}</p>
    </div>
  );
}

/** Ağaçtaki bütün değişikliklerin kayıtları (tekrarsız). */
function distinctRecords(nodes, found = new Map()) {
  for (const node of nodes) {
    if (node.kind === 'AUDIT') found.set(`${node.entity}:${node.entityId}`, { entity: node.entity, entityId: node.entityId });
    if (node.children) distinctRecords(node.children, found);
  }
  return [...found.values()];
}

/** @param {{ label: string, value: string, hint?: string | null, tone?: 'danger' | 'warning' | 'success' }} props */
function Summary({ label, value, hint = null, tone }) {
  const color = tone === 'danger' ? 'text-sec-strong' : tone === 'warning' ? 'text-warning-ink' : tone === 'success' ? 'text-success-ink' : 'text-ink';
  return (
    <div className="rounded-card bg-surface px-4 py-3 shadow-card">
      <p className="text-xs font-semibold text-ink-muted">{label}</p>
      <p className={`mt-1 text-sm font-bold ${color}`}>{value}</p>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

const offset = (at, origin) => `+${formatDuration(Math.max(0, Date.parse(at) - origin))}`;

/**
 * @param {{ node: any, origin: number, people: Record<string, string>, timeZone: string, depth: number }} props
 */
function ChainNode({ node, origin, people, timeZone, depth }) {
  const [open, setOpen] = useState(false);
  const children = node.children ?? [];
  const at = node.kind === 'HANDLER' ? node.startedAt : node.at;

  let icon;
  let body;
  let detail = null;
  if (node.kind === 'EVENT') {
    icon = 'zap';
    body = (
      <>
        <span className="font-mono text-xs font-bold text-ink">{node.name}</span>
        <span className="text-xs text-ink-muted">
          {actorLabel(node.actor, people[node.actor])} yayınladı
        </span>
        {!node.published && <Badge tone="warning">Dağıtılmadı</Badge>}
      </>
    );
    detail = <JsonBlock label="Gövde (kişisel veri maskeli)" value={node.payload} />;
  } else if (node.kind === 'HANDLER') {
    icon = 'bot';
    body = (
      <>
        <span className="font-semibold text-ink">{node.actorName}</span>
        <LevelBadge level={node.level} />
        <span className="min-w-0 flex-1 text-ink-soft">{node.message}</span>
        <span className="font-mono text-xs text-ink-muted" title="İşleyiş süresi">
          {formatDuration(node.durationMs)}
        </span>
      </>
    );
    detail = <JsonBlock label="Ayrıntı" value={node.meta} />;
  } else {
    icon = 'pencil';
    body = (
      <>
        <span className="font-semibold text-ink">{AUDIT_ENTITY_LABELS[node.entity] ?? node.entity}</span>
        <span className="text-ink-soft">{AUDIT_ACTION_LABELS[node.action] ?? node.action}</span>
        <span className="text-xs text-ink-muted">
          {actorLabel(node.actor, people[node.actor])}
          {node.changedFields.length > 0 ? ` · ${node.changedFields.map(fieldLabel).join(', ')}` : ''}
        </span>
      </>
    );
    detail =
      node.values && node.values.length > 0 ? (
        <table className="w-full max-w-2xl text-xs">
          <thead className="text-left text-ink-muted">
            <tr>
              <th className="py-1 pr-3 font-bold">Alan</th>
              <th className="py-1 pr-3 font-bold">Eski</th>
              <th className="py-1 font-bold">Yeni</th>
            </tr>
          </thead>
          <tbody>
            {node.values.map((value) => (
              <tr key={value.field} className="border-t border-line align-top">
                <td className="py-1 pr-3 font-semibold text-ink">{fieldLabel(value.field)}</td>
                <td className="break-all py-1 pr-3 text-ink-soft">{formatAuditValue(value.before)}</td>
                <td className="break-all py-1 text-ink-soft">{formatAuditValue(value.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null;
  }

  const tone =
    node.kind === 'HANDLER' && node.level === 'ERROR'
      ? 'border-danger-line bg-danger-soft/40'
      : node.kind === 'HANDLER' && node.level === 'WARN'
        ? 'border-warning-line bg-warning-soft/40'
        : 'border-line bg-surface';

  return (
    <li className="flex flex-col gap-2">
      <div className={`rounded-control border ${tone}`}>
        <button
          type="button"
          onClick={() => detail && setOpen((value) => !value)}
          aria-expanded={detail ? open : undefined}
          className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm ${detail ? 'hover:bg-black/[0.03]' : 'cursor-default'}`}
        >
          <Icon name={icon} className="size-4 shrink-0 text-ink-muted" />
          <span className="w-16 shrink-0 font-mono text-[0.7rem] text-ink-muted" title={formatClockSeconds(at, timeZone)}>
            {offset(at, origin)}
          </span>
          {body}
        </button>
        {open && detail && <div className="border-t border-line px-3 py-3">{detail}</div>}
      </div>
      {children.length > 0 && (
        <ol className={`flex flex-col gap-2 border-l-2 border-line pl-4 ${depth > 6 ? '' : 'ml-3'}`}>
          {children.map((child) => (
            <ChainNode key={`${child.kind}:${child.id}`} node={child} origin={origin} people={people} timeZone={timeZone} depth={depth + 1} />
          ))}
        </ol>
      )}
    </li>
  );
}
