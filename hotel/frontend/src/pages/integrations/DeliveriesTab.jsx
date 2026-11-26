import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_DELIVERY_STATUS_LABELS,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_TEST_EVENT,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Select, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { DELIVERY_STATUS_TONES, durationText, integrationKeys, useIntegrationTime } from '../../lib/integrations.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 50;
const LIVE_REFRESH_MS = 15_000;
const eventLabel = (type) => (type === WEBHOOK_TEST_EVENT ? 'Deneme olayı' : WEBHOOK_EVENT_LABELS[type] ?? type);
const STATUS_OPTIONS = [{ value: '', label: 'Bütün durumlar' }, ...WEBHOOK_DELIVERY_STATUSES.map((value) => ({ value, label: WEBHOOK_DELIVERY_STATUS_LABELS[value] }))];
const EVENT_OPTIONS = [{ value: '', label: 'Bütün olaylar' }, ...[...WEBHOOK_EVENTS, WEBHOOK_TEST_EVENT].map((value) => ({ value, label: eventLabel(value) }))];

/**
 * Webhook teslimat logu (modül 61): en yeni önce, imleçle "daha fazla". Süzgeç: uygulama, abonelik (adresten
 * gelinirse), durum, olay. Satıra basınca gövde, denemeler ve alıcının cevabının başı; bitmiş teslimat yeniden
 * gönderilebilir. 30 gün saklanır. Sırada / yeniden denenecek kayıt varken liste kendini tazeler.
 */
export function DeliveriesTab() {
  const [params, setParams] = useSearchParams();
  const formatTime = useIntegrationTime();
  const [openId, setOpenId] = useState(null);
  const filters = {
    clientId: params.get('clientId') ?? '',
    subscriptionId: params.get('subscriptionId') ?? '',
    status: params.get('status') ?? '',
    eventType: params.get('eventType') ?? '',
  };
  const setFilter = (key) => (event) => {
    const next = new URLSearchParams(params);
    if (event.target.value) next.set(key, event.target.value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const clients = useQuery({ queryKey: integrationKeys.clients(), queryFn: () => api('/integrations/clients') });

  const list = useInfiniteQuery({
    queryKey: integrationKeys.deliveries(filters),
    queryFn: ({ pageParam }) =>
      api(
        withQuery('/integrations/deliveries', {
          clientId: filters.clientId || undefined,
          subscriptionId: filters.subscriptionId || undefined,
          status: filters.status || undefined,
          eventType: filters.eventType || undefined,
          cursor: pageParam || undefined,
          limit: PAGE_SIZE,
        }),
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) => {
      const items = query.state.data?.pages.flatMap((page) => page.items) ?? [];
      return items.some((item) => ['PENDING', 'SENDING', 'RETRYING'].includes(item.status)) ? LIVE_REFRESH_MS : false;
    },
  });

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const clientOptions = [{ value: '', label: 'Bütün uygulamalar' }, ...(clients.data ?? []).map((client) => ({ value: client.id, label: client.name }))];
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Select label="Uygulama" name="delivery-client" value={filters.clientId} onChange={setFilter('clientId')} options={clientOptions} />
        <Select label="Durum" name="delivery-status" value={filters.status} onChange={setFilter('status')} options={STATUS_OPTIONS} />
        <Select label="Olay" name="delivery-event" value={filters.eventType} onChange={setFilter('eventType')} options={EVENT_OPTIONS} />
      </div>
      {filters.subscriptionId && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <Badge tone="info">Tek abonelik süzülüyor</Badge>
          <Button variant="ghost" size="sm" icon="close" onClick={() => setFilter('subscriptionId')({ target: { value: '' } })}>Süzgeci kaldır</Button>
        </div>
      )}

      {list.isPending || list.isError ? (
        <QueryFallback query={list} errorTitle="Teslimatlar yüklenemedi" />
      ) : items.length === 0 ? (
        <div className="rounded-card bg-surface p-8 text-center shadow-card">
          <p className="font-semibold text-ink">{filtered ? 'Süzgece uyan teslimat yok' : 'Henüz teslimat yok'}</p>
          <p className="mt-1 text-sm text-ink-muted">{filtered ? 'Süzgeci değiştirin.' : 'Abonelik kurulup seçilen bir olay olunca (ya da "Deneme gönder" ile) burada görünür.'}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setOpenId(item.id)} className="flex w-full flex-col gap-1 px-5 py-3 text-left hover:bg-black/[0.02] sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-40 shrink-0 text-xs text-ink-muted">{formatTime(item.createdAt)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{eventLabel(item.eventType)}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {item.clientName} · {item.url}
                    </span>
                    {item.error && <span className="block text-xs text-danger-ink [overflow-wrap:anywhere]">{item.error}</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                    {item.attempts}/{WEBHOOK_MAX_ATTEMPTS} deneme{item.responseStatus ? ` · ${item.responseStatus}` : ''} · {durationText(item.durationMs)}
                  </span>
                  <Badge tone={DELIVERY_STATUS_TONES[item.status]}>{WEBHOOK_DELIVERY_STATUS_LABELS[item.status]}</Badge>
                </button>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="border-t border-line p-3 text-center">
              <Button variant="outline" size="sm" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla'}
              </Button>
            </div>
          )}
        </div>
      )}
      {openId && <DeliveryDialog deliveryId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/**
 * Teslimat ayrıntısı: giden gövde (imzalı JSON), deneme dökümü, alıcının son cevabının başı; yeniden gönder.
 * @param {{ deliveryId: string, onClose: () => void }} props
 */
function DeliveryDialog({ deliveryId, onClose }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const formatTime = useIntegrationTime();
  const query = useQuery({ queryKey: integrationKeys.delivery(deliveryId), queryFn: () => api(`/integrations/deliveries/${deliveryId}`) });
  const redeliver = useMutation({
    mutationFn: () => apiPost(`/integrations/deliveries/${deliveryId}/redeliver`, {}),
    onSuccess: (delivery) => {
      queryClient.setQueryData(integrationKeys.delivery(deliveryId), delivery);
      queryClient.invalidateQueries({ queryKey: ['integrations', 'deliveries'] });
      toastSuccess('Yeniden sıraya alındı; aynı olay kimliğiyle gönderilir');
    },
    onError: (error) => toastError(error.message),
  });
  const delivery = query.data;
  const finished = delivery && ['SUCCEEDED', 'FAILED'].includes(delivery.status);
  return (
    <Modal
      open
      size="lg"
      title="Teslimat"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Kapat</Button>
          {can(PERMISSIONS.INTEGRATIONS_MANAGE) && (
            <Button icon="send" onClick={() => redeliver.mutate()} disabled={!finished || redeliver.isPending}>
              {redeliver.isPending ? 'Sıraya alınıyor…' : 'Yeniden gönder'}
            </Button>
          )}
        </>
      }
    >
      {query.isPending ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : query.isError ? (
        <Alert tone="danger" title="Yüklenemedi">{query.error.message}</Alert>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={DELIVERY_STATUS_TONES[delivery.status]}>{WEBHOOK_DELIVERY_STATUS_LABELS[delivery.status]}</Badge>
            <span className="font-semibold text-ink">{eventLabel(delivery.eventType)}</span>
            <span className="text-ink-muted">{delivery.clientName}</span>
          </div>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-ink-muted">Adres</dt>
            <dd className="text-ink [overflow-wrap:anywhere]">{delivery.url}</dd>
            <dt className="text-ink-muted">Olay kimliği</dt>
            <dd className="font-mono text-ink [overflow-wrap:anywhere]">{delivery.eventId}</dd>
            <dt className="text-ink-muted">Teslimat kimliği</dt>
            <dd className="font-mono text-ink [overflow-wrap:anywhere]">{delivery.id}</dd>
            <dt className="text-ink-muted">Oluştu</dt>
            <dd className="text-ink">{formatTime(delivery.createdAt)}</dd>
            {delivery.deliveredAt && (
              <>
                <dt className="text-ink-muted">Teslim edildi</dt>
                <dd className="text-ink">{formatTime(delivery.deliveredAt)}</dd>
              </>
            )}
            {delivery.nextAttemptAt && (
              <>
                <dt className="text-ink-muted">Sonraki deneme</dt>
                <dd className="text-ink">{formatTime(delivery.nextAttemptAt)}</dd>
              </>
            )}
          </dl>
          {delivery.attemptLog.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Denemeler</h3>
              <ol className="flex flex-col gap-1 text-xs">
                {delivery.attemptLog.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="flex flex-wrap gap-2">
                    <span className="text-ink-muted">{formatTime(entry.at)}</span>
                    <span className="text-ink">{entry.note ?? (entry.status ? `HTTP ${entry.status}` : 'Bağlantı yok')}</span>
                    {entry.durationMs !== null && entry.durationMs !== undefined && <span className="text-ink-muted">{durationText(entry.durationMs)}</span>}
                    {entry.error && <span className="text-danger-ink [overflow-wrap:anywhere]">{entry.error}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Giden gövde</h3>
            <pre className="max-h-64 overflow-auto rounded-control bg-surface-muted p-3 font-mono text-xs text-ink">{JSON.stringify(delivery.payload, null, 2)}</pre>
          </div>
          {delivery.responseBody && (
            <div>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Alıcının cevabı (başı)</h3>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-control bg-surface-muted p-3 font-mono text-xs text-ink [overflow-wrap:anywhere]">{delivery.responseBody}</pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
