import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { KBS_KIND_LABELS, KBS_STATE_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { kbsKeys, kbsRoomText, kbsStateTone, useKbsLive } from '../../lib/kbs.js';

/** Kartta gösterilen en çok bildirim. */
const CARD_LIMIT = 50;

/**
 * Rezervasyon ayrıntısındaki KBS kartı (modül 58, `kbs.view`; KBS kapalıysa çizilmez): bu konaklamanın bildirimleri,
 * durum rozetleri ve ayrıntıya bağlantı.
 * @param {{ reservationId: string }} props
 */
export function KbsReservationCard({ reservationId }) {
  useKbsLive();
  const settings = useQuery({ queryKey: kbsKeys.settings, queryFn: () => api('/kbs/settings') });
  const isEnabled = Boolean(settings.data?.settings.isEnabled);
  const list = useQuery({
    queryKey: kbsKeys.reservation(reservationId),
    queryFn: () => api(withQuery('/kbs/notifications', { reservationId, pageSize: CARD_LIMIT })),
    enabled: isEnabled,
  });
  if (!isEnabled) return null;
  if (list.isPending) return <Card title="KBS"><Spinner label="Yükleniyor…" className="py-4" /></Card>;
  if (list.isError) {
    return (
      <Card title="KBS">
        <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => list.refetch()}>Tekrar dene</Button>}>
          {list.error.message}
        </Alert>
      </Card>
    );
  }
  const items = list.data.items;
  const isTest = settings.data.settings.provider === 'TEST';

  return (
    <Card title="KBS" description={isTest ? 'Test ortamı — bildirimler Emniyete gitmiyor' : 'Kimlik bildirimleri'} actions={isTest ? <Badge tone="warning">Test</Badge> : undefined}>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu konaklama için bildirim yok; girişte belgesi alınan her kişi bildirilir.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {items.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <Link to={`/kbs/bildirimler/${row.id}`} className="font-semibold text-ink hover:underline">
                  {KBS_KIND_LABELS[row.kind] ?? row.kind} · {row.guestName}
                </Link>
                <span className="block text-xs text-ink-muted">
                  Oda {kbsRoomText(row)} · {formatDateTime(row.createdAt)}
                  {row.state === 'FAILED' && row.lastMessage ? ` · ${row.lastMessage}` : ''}
                </span>
              </span>
              <Badge tone={kbsStateTone(row.state)}>{KBS_STATE_LABELS[row.state] ?? row.state}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
