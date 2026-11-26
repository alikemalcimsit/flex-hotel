import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_GATEWAY_ENVIRONMENT_LABELS, PAYMENT_GATEWAY_PROVIDER_LABELS, PAYMENT_LINK_PURPOSE_LABELS, PAYMENT_LINK_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api } from '../../lib/api.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { cardText, gatewayKeys, linkRefundable, linkStatusTone, linkWarning, originLabel } from '../../lib/paymentGateway.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { EventsCard, RefundsCard } from './LinkHistory.jsx';
import { PayUrl } from './PayUrl.jsx';
import { RefundDialog } from './RefundDialog.jsx';
import { useLinkActions } from './useLinkActions.js';

/**
 * Ödeme linki ayrıntısı (modül 50): tutar, durum, bağlantı adresi ("Kopyala"), süre, deneme, kart, ödeme no, folyo.
 * "Gönder" / "İptal et" yalnız ödeme bekleyen linkte (`payment_gateway.send`); "Karta iade" ödenmiş linkte
 * (`payment.refund`, onaya gider). Altta iadeler ve iz.
 */
export function LinkPage() {
  const { linkId } = useParams();
  const can = useCan();
  const [refunding, setRefunding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { send, cancel } = useLinkActions();
  const query = useQuery({ queryKey: gatewayKeys.link(linkId), queryFn: () => api(`/payment-gateway/links/${linkId}`) });
  if (!query.data) return <QueryFallback query={query} errorTitle="Ödeme linki yüklenemedi" />;
  const { link, events, refunds } = query.data;
  const isOpen = link.status === 'OPEN';
  const warning = linkWarning(link);
  const canSend = can(PERMISSIONS.PAYMENT_GATEWAY_SEND) && isOpen;
  const refundable = linkRefundable(link, refunds);
  const canRefund = can(PERMISSIONS.PAYMENT_REFUND) && link.status === 'PAID' && Number(refundable) > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/sanal-pos/linkler" className="text-sm font-semibold text-ink-muted hover:text-ink hover:underline">
          ← İşlemler
        </Link>
        <span className="flex flex-wrap gap-2">
          {canSend && (
            <Button type="button" variant="outline" icon="send" onClick={() => send.mutate(link.id)} disabled={send.isPending}>
              {send.isPending ? 'Gönderiliyor…' : 'Misafire gönder'}
            </Button>
          )}
          {canSend && (
            <Button type="button" variant="outline" icon="close" onClick={() => setCancelling(true)}>
              İptal et
            </Button>
          )}
          {canRefund && (
            <Button type="button" variant="outline" icon="rotateCcw" onClick={() => setRefunding(true)}>
              Karta iade
            </Button>
          )}
        </span>
      </div>
      {warning && (
        <Alert tone={warning.tone} title={warning.title}>
          {warning.text}
        </Alert>
      )}
      <Card title={formatMoney(link.amount, link.currency)} description={link.description ?? undefined} actions={<Badge tone={linkStatusTone(link.status)}>{PAYMENT_LINK_STATUS_LABELS[link.status] ?? link.status}</Badge>}>
        <div className="flex flex-col gap-5">
          <PayUrl url={link.url} />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Field label="Rezervasyon">
              {link.confirmationCode ? <Link to={`/rezervasyonlar/${link.reservationId}`} className="font-mono font-semibold hover:underline">{link.confirmationCode}</Link> : '—'}
              {link.guestName && <span className="block text-xs text-ink-muted">{link.guestName}</span>}
            </Field>
            <Field label="Amaç">{PAYMENT_LINK_PURPOSE_LABELS[link.purpose] ?? link.purpose}</Field>
            <Field label="Kaynak">
              {originLabel(link.origin)}
              {link.createdBy && <span className="block text-xs text-ink-muted">{link.createdBy}</span>}
            </Field>
            <Field label="Oluşturuldu">{formatDateTime(link.createdAt)}</Field>
            <Field label="Son geçerlilik">{formatDateTime(link.expiresAt)}</Field>
            <Field label="Gönderildi">
              {link.sentAt ? formatDateTime(link.sentAt) : '—'}
              {link.sentVia?.length > 0 && <span className="block text-xs text-ink-muted">{link.sentVia.join(', ')}</span>}
            </Field>
            <Field label="Deneme">{link.attempts}</Field>
            <Field label="Kart">
              <span className="font-mono">{cardText(link)}</span>
              {link.installment > 1 && <span className="block text-xs text-ink-muted">{link.installment} taksit</span>}
            </Field>
            <Field label="Sağlayıcı">
              {PAYMENT_GATEWAY_PROVIDER_LABELS[link.provider] ?? link.provider}
              {link.provider !== 'TEST' && <span className="block text-xs text-ink-muted">{PAYMENT_GATEWAY_ENVIRONMENT_LABELS[link.environment] ?? link.environment}</span>}
            </Field>
            <Field label="Ödendi">
              {link.paidAt ? formatDateTime(link.paidAt) : '—'}
              {link.paidAmount && <span className="block text-xs text-ink-muted">{formatMoney(link.paidAmount, link.currency)}</span>}
            </Field>
            <Field label="Ödeme no">
              {link.providerPaymentId ? <span className="font-mono text-xs">{link.providerPaymentId}</span> : '—'}
              {link.paymentId && (
                <Link to={`/folyolar/${link.reservationId}`} className="block text-xs font-semibold text-ink-muted hover:text-ink hover:underline">
                  Folyodaki ödeme
                </Link>
              )}
            </Field>
            <Field label="İade">
              {Number(link.refundedAmount) > 0 ? formatMoney(link.refundedAmount, link.currency) : '—'}
              {link.status === 'PAID' && <span className="block text-xs text-ink-muted">İade edilebilir {formatMoney(refundable, link.currency)}</span>}
            </Field>
          </dl>
        </div>
      </Card>
      <RefundsCard refunds={refunds} currency={link.currency} />
      <EventsCard events={events} />
      {refunding && <RefundDialog link={link} refundable={refundable} onClose={() => setRefunding(false)} />}
      <ConfirmDialog
        open={cancelling}
        title="Linki iptal et"
        message="Misafir bu bağlantıyla artık ödeyemez. Gerekirse yeni link oluşturulur."
        confirmLabel="İptal et"
        confirmIcon="close"
        isPending={cancel.isPending}
        error={cancel.error}
        onClose={() => {
          setCancelling(false);
          cancel.reset();
        }}
        onConfirm={() => cancel.mutate(link.id, { onSuccess: () => setCancelling(false) })}
      />
    </div>
  );
}

/** @param {{ label: string, className?: string, children: React.ReactNode }} props */
function Field({ label, className = '', children }) {
  return (
    <div className={className}>
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
