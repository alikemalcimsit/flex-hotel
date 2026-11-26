import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_LINK_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Spinner } from '@hotelos/ui';
import { api } from '../../lib/api.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { cardText, copyPayLink, gatewayKeys, gatewayMode, linkStatusTone, linkWarning, useGatewayLive } from '../../lib/paymentGateway.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { CreateLinkDialog } from './CreateLinkDialog.jsx';
import { useLinkActions } from './useLinkActions.js';

/**
 * Rezervasyon ayrıntısındaki sanal POS kartı (modül 50, `payment_gateway.view`; sanal POS kapalıysa çizilmez): bu
 * konaklamanın ödeme linkleri (durum, tutar, kopyala, gönder) ve "Ödeme linki oluştur" (`payment_gateway.send`).
 * @param {{ reservationId: string }} props
 */
export function GatewayReservationCard({ reservationId }) {
  useGatewayLive();
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const { send } = useLinkActions();
  const query = useQuery({ queryKey: gatewayKeys.reservation(reservationId), queryFn: () => api(`/payment-gateway/reservations/${reservationId}`) });

  if (query.isPending) return <Card title="Sanal POS"><Spinner label="Yükleniyor…" className="py-4" /></Card>;
  if (query.isError) {
    return (
      <Card title="Sanal POS">
        <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>
          {query.error.message}
        </Alert>
      </Card>
    );
  }
  const { program, currency, suggested, canLink, contact, links } = query.data;
  if (!program.isEnabled) return null;
  const mode = gatewayMode(program);
  const canSend = can(PERMISSIONS.PAYMENT_GATEWAY_SEND);

  return (
    <Card
      title="Sanal POS"
      description={mode.kind === 'live' ? 'Kartla ödeme linkleri' : mode.title}
      actions={
        canSend && canLink ? (
          <Button type="button" size="sm" variant="outline" icon="link" onClick={() => setCreating(true)}>
            Ödeme linki oluştur
          </Button>
        ) : mode.kind !== 'live' ? (
          <Badge tone="warning">Test</Badge>
        ) : undefined
      }
    >
      {links.length === 0 ? (
        <p className="text-sm text-ink-muted">{canLink ? 'Bu konaklama için ödeme linki yok.' : 'İptal edilmiş rezervasyona ödeme linki açılmaz.'}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {links.map((row) => {
            const warning = linkWarning(row);
            return (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <Link to={`/sanal-pos/linkler/${row.id}`} className="font-semibold tabular-nums text-ink hover:underline">
                    {formatMoney(row.amount, row.currency)}
                  </Link>
                  <span className="block text-xs text-ink-muted">
                    {formatDateTime(row.createdAt)}
                    {row.cardLast4 ? ` · ${cardText(row)}` : ''}
                    {warning ? ` · ${warning.title}` : ''}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={linkStatusTone(row.status)}>{PAYMENT_LINK_STATUS_LABELS[row.status] ?? row.status}</Badge>
                  {row.status === 'OPEN' && (
                    <Button type="button" size="sm" variant="ghost" icon="clipboard" onClick={() => copyPayLink(row.url)}>
                      Kopyala
                    </Button>
                  )}
                  {row.status === 'OPEN' && canSend && (
                    <Button type="button" size="sm" variant="ghost" icon="send" onClick={() => send.mutate(row.id)} disabled={send.isPending}>
                      Gönder
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {creating && <CreateLinkDialog reservationId={reservationId} currency={currency} suggested={suggested} program={program} contact={contact} onClose={() => setCreating(false)} />}
    </Card>
  );
}
