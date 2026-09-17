import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CONVERSATION_CHANNEL_LABELS,
  CONVERSATION_MODE_LABELS,
  RESERVATION_STATUS_LABELS,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Icon, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { requestKeys } from '../../lib/frontOffice.js';
import { formatDate } from '../../lib/format.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { RequestRow } from '../requests/RequestRow.jsx';
import { RequestStatusDialog } from '../requests/RequestStatusDialog.jsx';
import { useRequestActions } from '../requests/useRequestActions.js';
import { LinkStayDialog } from './LinkStayDialog.jsx';

/** Yan panelde gösterilen en fazla istek; fazlası İstekler sayfasında. */
const PANEL_REQUEST_LIMIT = 10;

const STATUSES_WITH_NOTE = new Set(['DONE', 'CANCELLED']);

/**
 * Konuşmanın yan paneli: kiminle konuşuluyor, nerede kalıyor, ne istedi.
 *
 * Resepsiyonist cevap yazarken misafirin odasını, konaklama tarihlerini ve bu
 * konuşmadan açılmış istekleri görmeli — ayrı ekrana geçmeden.
 *
 * @param {{
 *   conversation: object,
 *   timeZone: string,
 *   canReply: boolean,
 *   canManageRequests: boolean,
 *   canViewRequests: boolean,
 *   actions: ReturnType<typeof import('./useConversationActions.js').useConversationActions>,
 *   onCreateRequest: () => void,
 * }} props
 */
export function ConversationDetails({
  conversation,
  timeZone,
  canReply,
  canManageRequests,
  canViewRequests,
  actions,
  onCreateRequest,
}) {
  const navigate = useNavigate();
  const requestActions = useRequestActions();
  const [linking, setLinking] = useState(false);
  const [statusTarget, setStatusTarget] = useState(null);

  const requestsQuery = useQuery({
    queryKey: requestKeys.forConversation(conversation.id),
    queryFn: () =>
      api(
        withQuery('/guest-requests', {
          conversationId: conversation.id,
          view: 'ALL',
          page: 1,
          pageSize: PANEL_REQUEST_LIMIT,
        }),
      ),
    enabled: canViewRequests,
  });

  const mutateStatus = requestActions.changeStatus.mutate;
  const handleStatus = useCallback(
    (request, status) => {
      if (STATUSES_WITH_NOTE.has(status)) setStatusTarget({ request, status });
      else mutateStatus({ request, status });
    },
    [mutateStatus],
  );
  const openRequest = useCallback(
    (request) => navigate(`/istekler?view=ALL&istek=${request.id}`),
    [navigate],
  );

  const stay = conversation.stay;
  const contact = conversation.guestContact;
  const requests = requestsQuery.data?.items ?? [];
  const moreRequests = (requestsQuery.data?.meta.total ?? 0) - requests.length;

  const unlink = () =>
    actions.update.mutate({
      conversation,
      changes: { reservationId: null },
      message: 'Konaklama bağlantısı kaldırıldı',
    });

  return (
    <div className="flex flex-col gap-6 p-5">
      <section aria-labelledby="details-guest">
        <h3 id="details-guest" className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
          Misafir
        </h3>
        {conversation.guest ? (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-bold text-ink">{conversation.guest.name}</span>
            {contact?.phone && (
              <span className="flex items-center gap-1.5 text-ink-soft">
                <Icon name="phone" className="size-3.5 text-ink-muted" />
                {contact.phone}
              </span>
            )}
            {contact?.email && (
              <span className="flex min-w-0 items-center gap-1.5 text-ink-soft">
                <Icon name="mail" className="size-3.5 shrink-0 text-ink-muted" />
                <span className="truncate">{contact.email}</span>
              </span>
            )}
            {contact?.nationality && <span className="text-xs text-ink-muted">Uyruk: {contact.nationality}</span>}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            Misafir kartıyla eşleşmedi. Konaklamaya bağlayınca misafir tanınır.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-muted">
          {CONVERSATION_CHANNEL_LABELS[conversation.channel]} · {conversation.address}
        </p>
      </section>

      <section aria-labelledby="details-stay">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="details-stay" className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
            Konaklama
          </h3>
          {canReply && (
            <button
              type="button"
              onClick={() => setLinking(true)}
              className="rounded-item px-1.5 py-0.5 text-xs font-semibold text-info-ink hover:bg-info-soft"
            >
              {stay ? 'Değiştir' : 'Bağla'}
            </button>
          )}
        </div>
        {stay ? (
          <div className="rounded-panel border border-line bg-surface-muted px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-ink">
                {stay.roomNumber ? `Oda ${stay.roomNumber}` : 'Oda atanmadı'}
              </span>
              <span className="text-xs font-semibold text-ink-soft">
                {RESERVATION_STATUS_LABELS[stay.status] ?? stay.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {stay.confirmationCode} · {formatDate(stay.checkIn)} → {formatDate(stay.checkOut)}
            </p>
            {canReply && (
              <button
                type="button"
                onClick={unlink}
                disabled={actions.update.isPending}
                className="mt-2 text-xs font-semibold text-ink-muted underline-offset-2 hover:text-sec-strong hover:underline disabled:opacity-50"
              >
                Bağlantıyı kaldır
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Bu konuşma bir konaklamaya bağlı değil.</p>
        )}
      </section>

      {canViewRequests && (
        <section aria-labelledby="details-requests">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id="details-requests" className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
              İstekler
              {conversation.openRequestCount > 0 && (
                <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 py-0.5 text-warning-ink">
                  {conversation.openRequestCount} açık
                </span>
              )}
            </h3>
            {canManageRequests && (
              <Button size="sm" variant="outline" icon="plus" onClick={onCreateRequest}>
                İstek
              </Button>
            )}
          </div>
          {requestsQuery.isPending && <Spinner label="İstekler yükleniyor…" className="justify-start py-2" />}
          {requestsQuery.isError && <Alert tone="danger">{requestsQuery.error.message}</Alert>}
          {requestsQuery.isSuccess && requests.length === 0 && (
            <p className="text-sm text-ink-muted">Bu konuşmadan açılmış istek yok.</p>
          )}
          <div className="flex flex-col gap-2">
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                timeZone={timeZone}
                canManage={canManageRequests}
                busy={requestActions.busyId === request.id}
                compact
                showConversationLink={false}
                onOpen={openRequest}
                onStatus={handleStatus}
              />
            ))}
          </div>
          {moreRequests > 0 && (
            <button
              type="button"
              onClick={() => navigate(`/istekler?view=ALL&konusma=${conversation.id}`)}
              className="mt-2 text-xs font-semibold text-info-ink hover:underline"
            >
              {moreRequests} istek daha — İstekler sayfasında
            </button>
          )}
        </section>
      )}

      <section aria-labelledby="details-meta" className="border-t border-line pt-4 text-xs text-ink-muted">
        <h3 id="details-meta" className="sr-only">
          Konuşma bilgisi
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <dt>Yanıtlayan</dt>
          <dd className="text-ink-soft">
            {CONVERSATION_MODE_LABELS[conversation.mode]}
            {!conversation.autoResponderAvailable && ' · AI asistanı henüz bağlı değil'}
          </dd>
          <dt>Kanal</dt>
          <dd className="text-ink-soft">{conversation.channelConnected ? 'Bağlı' : 'Bağlantı bekleniyor'}</dd>
          <dt>Başladı</dt>
          <dd className="text-ink-soft">{formatDateTime(conversation.createdAt, timeZone)}</dd>
          {conversation.closedAt && (
            <>
              <dt>Kapandı</dt>
              <dd className="text-ink-soft">
                {formatDateTime(conversation.closedAt, timeZone)}
                {conversation.closedBy ? ` · ${conversation.closedBy}` : ''}
              </dd>
            </>
          )}
        </dl>
      </section>

      {linking && (
        <LinkStayDialog
          conversation={conversation}
          isPending={actions.update.isPending}
          error={actions.update.error}
          onClose={() => {
            setLinking(false);
            actions.update.reset();
          }}
          onLink={(target, roomNumber) =>
            actions.update.mutate(
              {
                conversation,
                changes: { reservationId: target.reservationId },
                message: `Konuşma Oda ${roomNumber} konaklamasına (${target.confirmationCode}) bağlandı`,
              },
              { onSuccess: () => setLinking(false) },
            )
          }
        />
      )}

      {statusTarget && (
        <RequestStatusDialog
          key={`${statusTarget.request.id}-${statusTarget.status}`}
          request={statusTarget.request}
          status={statusTarget.status}
          isPending={requestActions.changeStatus.isPending}
          onClose={() => setStatusTarget(null)}
          onConfirm={(note) =>
            requestActions.changeStatus.mutate(
              { request: statusTarget.request, status: statusTarget.status, note },
              { onSuccess: () => setStatusTarget(null) },
            )
          }
        />
      )}
    </div>
  );
}
