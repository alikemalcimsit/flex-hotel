import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AUDIT_ACTION_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Icon, Spinner } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api } from '../../lib/api.js';
import { activityKeys, actorKindLabel, actorLabel, fieldLabel } from '../../lib/activity.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { goBack, QueryError } from './shared.jsx';

/** Kayıt türü → kaydın kendi ekranı (varsa). */
const RECORD_LINKS = Object.freeze({
  Reservation: (id) => `/rezervasyonlar/${id}`,
  Conversation: (id) => `/mesajlar/${id}`,
});

/**
 * Bir kaydın bütün işlem zincirleri (modül 10): ör. bir rezervasyonun
 * oluşturulması, oda ataması, tarih değişikliği, girişi. En yeni önce; her
 * zincirden ağaç görünümüne geçilir.
 */
export function RecordChainsPage() {
  const { entity, entityId } = useParams();
  const navigate = useNavigate();
  const { timeZone } = useHotelToday();
  const query = useQuery({
    queryKey: activityKeys.record(entity, entityId),
    queryFn: () => api(`/activity/records/${encodeURIComponent(entity)}/${encodeURIComponent(entityId)}`),
  });
  const recordLink = RECORD_LINKS[entity]?.(entityId);
  const actions = (
    <div className="flex flex-wrap gap-2">
      {recordLink && (
        <Button variant="outline" size="sm" icon="arrowRight" onClick={() => navigate(recordLink)}>
          Kayda git
        </Button>
      )}
      <Button variant="outline" size="sm" icon="arrowLeft" onClick={() => goBack(navigate, '/aktivite/akis')}>
        Geri
      </Button>
    </div>
  );

  if (query.isPending) return <Spinner label="İşlem geçmişi yükleniyor…" className="py-16" />;
  if (query.isError) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="İşlem geçmişi" actions={actions} />
        <QueryError query={query} title={query.error?.code === 'NOT_FOUND' ? 'Bu kayda ait işlem izi yok' : 'İşlem geçmişi yüklenemedi'} />
      </div>
    );
  }

  const record = query.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${record.entityLabel} · işlem geçmişi`}
        description="Bu kayda dokunan her işlem ayrı bir zincir: kim başlattı, ne değişti. Zincire tıklayınca bütün adımları (aktörler, süreler, olaylar) görünür."
        actions={actions}
      />
      {record.truncated && <Alert tone="info">Kaydın çok sayıda değişikliği var; en yeni zincirler gösteriliyor.</Alert>}
      <Card>
        <ol className="divide-y divide-line">
          {record.chains.map((chain) => (
            <li key={chain.correlationId}>
              <Link
                to={`/aktivite/zincir/${encodeURIComponent(chain.correlationId)}`}
                className="grid grid-cols-1 gap-x-4 gap-y-1 px-2 py-3 text-sm hover:bg-black/[0.03] sm:grid-cols-[10rem_7rem_minmax(0,1fr)_minmax(0,1.3fr)_1.5rem]"
              >
                <time dateTime={chain.startedAt} className="text-xs text-ink-muted tabular-nums">
                  {formatDateTime(chain.startedAt, timeZone)}
                </time>
                <span className="font-semibold text-ink">{AUDIT_ACTION_LABELS[chain.firstAction] ?? chain.firstAction}</span>
                <span className="truncate text-ink-soft">
                  {actorLabel(chain.actor, chain.actorLabel)} <span className="text-xs text-ink-muted">· {actorKindLabel(chain.actor)}</span>
                </span>
                <span className="truncate text-xs text-ink-muted">
                  {chain.fields.length > 0 ? chain.fields.map(fieldLabel).join(', ') : chain.changes > 1 ? `${chain.changes} değişiklik` : ''}
                </span>
                <Icon name="chevronRight" className="hidden size-4 text-ink-muted sm:block" />
              </Link>
            </li>
          ))}
        </ol>
      </Card>
      <p className="text-xs text-ink-muted">Kayıt kimliği: {record.entityId}</p>
    </div>
  );
}
