import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Spinner } from '@hotelos/ui';
import { api } from '../../lib/api.js';
import { FOLIO_STATUS_TONES, balanceTone, folioKeys, folioPath, folioStatusLabel } from '../../lib/folios.js';
import { formatMoney } from '../../lib/format.js';
import { cashKeys } from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { FOLIOS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { PaymentDialog } from './PaymentDialogs.jsx';

/** Gelmeden önce: alınan ödeme ön ödemedir (depozito). */
const ADVANCE_STATUSES = Object.freeze(['PENDING', 'CONFIRMED']);

/**
 * Rezervasyon detayındaki folyo kartı (modül 4'ün folyo bağlantısı): konaklamanın
 * folyoları, bakiyeleri, iptal / gelmedi ücreti dahil; folyo ekranına götürür.
 * Ödeme yetkisi olan buradan ön ödeme / depozito alır (modül 17): folyo yoksa
 * açılır. Yalnızca folyo görüntüleme yetkisi olana çizilir (çağıran denetler).
 *
 * @param {{ reservationId: string }} props
 */
export function FolioSummaryCard({ reservationId }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState(false);
  useLiveChannel(FOLIOS_CHANNEL, {
    queryKeys: (payload) => (payload && payload.reservationId && payload.reservationId !== reservationId ? [] : [folioKeys.stay(reservationId)]),
  });
  const query = useQuery({ queryKey: folioKeys.stay(reservationId), queryFn: () => api(`/folios/stays/${reservationId}`) });

  const data = query.data;
  const openFolios = data?.folios.filter((folio) => folio.status === 'OPEN') ?? [];
  const advance = data ? ADVANCE_STATUSES.includes(data.stay.status) : false;
  // Birden fazla açık pencerede ödeme folyo ekranından ilgili pencereye alınır (sunucu da folyo ister).
  const canPay =
    can(PERMISSIONS.PAYMENT_RECEIVE) && data && openFolios.length <= 1 && (advance || data.stay.status === 'CHECKED_IN' || openFolios.length > 0);

  return (
    <Card
      title="Folyo"
      actions={
        <span className="flex flex-wrap gap-2">
          {canPay && (
            <Button size="sm" icon="wallet" onClick={() => setPaying(true)}>
              {advance ? 'Ön ödeme al' : 'Ödeme al'}
            </Button>
          )}
          <Link to={folioPath(reservationId)}>
            <Button size="sm" variant="outline" icon="fileText">Folyoyu aç</Button>
          </Link>
        </span>
      }
    >
      {query.isPending ? (
        <Spinner className="py-2" />
      ) : query.isError ? (
        <p className="text-sm text-sec-strong">{query.error.message}</p>
      ) : data.folios.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Henüz folyo yok; misafir giriş yapınca açılır.{can(PERMISSIONS.PAYMENT_RECEIVE) && advance ? ' Ön ödeme alınırsa şimdi açılır.' : ''}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {data.folios.map((folio) => (
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
      {data?.roomCharges.nights > 0 && (
        <p className="mt-2 text-xs text-warning-ink">
          {data.roomCharges.nights} oda ücreti kalemi henüz işlenmedi ({formatMoney(data.roomCharges.amount, data.stay.currency)}).
        </p>
      )}
      {data && Number(data.payments?.pendingPayments ?? 0) !== 0 && (
        <p className="mt-2 text-xs text-warning-ink">
          Onay bekleyen ödeme: {formatMoney(data.payments.pendingPayments, data.stay.currency)} (onaylanınca bakiyeye girer).
        </p>
      )}
      {paying && data && (
        <PaymentDialog
          mode="payment"
          target={{ reservationId, name: data.stay.guest.name, currency: data.stay.currency, balance: openFolios[0]?.balance ?? null, advance }}
          onClose={() => setPaying(false)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: folioKeys.all });
            queryClient.invalidateQueries({ queryKey: cashKeys.all });
          }}
        />
      )}
    </Card>
  );
}
