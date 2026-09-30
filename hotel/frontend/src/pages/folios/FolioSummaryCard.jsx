import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Spinner } from '@hotelos/ui';
import { api } from '../../lib/api.js';
import { FOLIO_STATUS_TONES, balanceTone, folioKeys, folioPath, folioStatusLabel } from '../../lib/folios.js';
import { formatMoney } from '../../lib/format.js';
import { FOLIOS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';

/**
 * Rezervasyon detayındaki folyo kartı (modül 4'ün folyo bağlantısı): konaklamanın
 * folyoları, bakiyeleri, iptal / gelmedi ücreti dahil; folyo ekranına götürür.
 * Yalnızca folyo görüntüleme yetkisi olana çizilir (çağıran denetler).
 *
 * @param {{ reservationId: string }} props
 */
export function FolioSummaryCard({ reservationId }) {
  useLiveChannel(FOLIOS_CHANNEL, {
    queryKeys: (payload) => (payload && payload.reservationId && payload.reservationId !== reservationId ? [] : [folioKeys.stay(reservationId)]),
  });
  const query = useQuery({ queryKey: folioKeys.stay(reservationId), queryFn: () => api(`/folios/stays/${reservationId}`) });

  return (
    <Card
      title="Folyo"
      actions={
        <Link to={folioPath(reservationId)}>
          <Button size="sm" variant="outline" icon="fileText">Folyoyu aç</Button>
        </Link>
      }
    >
      {query.isPending ? (
        <Spinner className="py-2" />
      ) : query.isError ? (
        <p className="text-sm text-sec-strong">{query.error.message}</p>
      ) : query.data.folios.length === 0 ? (
        <p className="text-sm text-ink-muted">Henüz folyo yok; misafir giriş yapınca açılır.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {query.data.folios.map((folio) => (
            <li key={folio.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link to={folioPath(reservationId, folio.id)} className="font-semibold text-info-ink underline-offset-2 hover:underline">
                {folio.name}
              </Link>
              <span className="flex items-center gap-2">
                <Badge tone={FOLIO_STATUS_TONES[folio.status]}>{folioStatusLabel(folio.status)}</Badge>
                <Badge tone={balanceTone(folio.balance)}>
                  <span className="tabular-nums">{formatMoney(folio.balance, folio.currency)}</span>
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
      {query.data?.roomCharges.nights > 0 && (
        <p className="mt-2 text-xs text-warning-ink">
          {query.data.roomCharges.nights} oda ücreti kalemi henüz işlenmedi ({formatMoney(query.data.roomCharges.amount, query.data.stay.currency)}).
        </p>
      )}
    </Card>
  );
}
