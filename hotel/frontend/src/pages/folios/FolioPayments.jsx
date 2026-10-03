import { Badge, Button, Icon, Spinner } from '@hotelos/ui';
import { paymentVoidError } from '@hotelos/hotel-contracts';
import { formatDate, formatMoney } from '../../lib/format.js';
import {
  PAYMENT_METHOD_ICONS,
  PAYMENT_STATUS_TONES,
  absolute,
  formatRate,
  kindLabel,
  methodLabel,
  paymentStatusLabel,
  sourceLabel,
} from '../../lib/payments.js';

/**
 * Folyonun ödemeleri (modül 17): girildiği sırayla tahsilat, iade, iptal
 * kayıtları; onay bekleyen ve reddedilenler durumuyla. Tutar folyonun para
 * birimindedir (dövizde ödemenin kendi tutarı ve kuru yanında). İptal edilen
 * satır üstü çizili; iptal kaydı altında. "İptal iste" yalnızca işlenmiş,
 * iptal edilmemiş satırda.
 *
 * @param {{
 *   query: import('@tanstack/react-query').UseInfiniteQueryResult,
 *   currency: string,
 *   onVoid?: (payment: object) => void,
 * }} props
 */
export function FolioPayments({ query, currency, onVoid }) {
  const pages = query.data?.pages ?? [];
  const rows = pages.flatMap((page) => page.payments);
  const first = pages[0];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold text-ink">Ödemeler</h2>
        {first?.pending > 0 && <Badge tone="warning">{first.pending} onay bekliyor</Badge>}
        {first?.pendingVoids > 0 && <Badge tone="warning">{first.pendingVoids} iptal onayı bekliyor</Badge>}
      </div>
      {query.isPending ? (
        <Spinner className="py-2" />
      ) : query.isError ? (
        <p className="text-sm text-sec-strong">{query.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu folyoya ödeme işlenmemiş.</p>
      ) : (
        <ul className="divide-y divide-line rounded-item border border-line text-sm">
          {rows.map((payment) => (
            <PaymentRow key={payment.id} payment={payment} currency={currency} onVoid={onVoid} />
          ))}
          {query.hasNextPage && (
            <li className="px-4 py-3 text-center">
              <Button size="sm" variant="outline" icon="arrowDown" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla ödeme'}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** @param {{ payment: any, currency: string, onVoid?: (payment: object) => void }} props */
function PaymentRow({ payment, currency, onVoid }) {
  const muted = payment.voided || payment.status === 'DECLINED';
  const foreign = payment.currency !== currency;
  const canVoid = onVoid && !paymentVoidError(payment);
  const negative = Number(payment.folioAmount) < 0;
  return (
    <li className={`flex flex-wrap items-start justify-between gap-2 px-4 py-2.5 ${muted ? 'bg-surface-muted' : ''}`}>
      <span className="flex min-w-0 items-start gap-2">
        <Icon name={payment.kind === 'PAYMENT' ? PAYMENT_METHOD_ICONS[payment.method] : 'rotateCcw'} className="mt-0.5 size-4 shrink-0 text-ink-muted" />
        <span className="min-w-0">
          <span className={`font-semibold ${muted ? 'text-ink-muted line-through' : ''}`}>
            {payment.kind === 'PAYMENT' ? methodLabel(payment.method) : `${kindLabel(payment.kind)} · ${methodLabel(payment.method)}`}
          </span>
          {payment.source !== 'DESK' && payment.kind === 'PAYMENT' && <span className="ml-2 text-xs text-ink-muted">{sourceLabel(payment.source)}</span>}
          {payment.status !== 'POSTED' && (
            <Badge tone={PAYMENT_STATUS_TONES[payment.status]} className="ml-2">{paymentStatusLabel(payment.status)}</Badge>
          )}
          {payment.voided && <Badge tone="neutral" className="ml-2">İptal edildi</Badge>}
          {payment.voidPending && <Badge tone="warning" className="ml-2">İptal onayı bekliyor</Badge>}
          <span className="mt-0.5 block text-xs text-ink-muted">
            {formatDate(payment.receivedAt)} · {payment.receivedBy}
            {payment.reference ? ` · ${payment.reference}` : ''}
            {payment.note ? ` · ${payment.note}` : ''}
          </span>
          {payment.voided && payment.voidReason && (
            <span className="block text-xs text-ink-muted">İptal: {payment.voidReason} · {payment.voidedBy}</span>
          )}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span className={`text-right font-bold tabular-nums ${muted ? 'text-ink-muted line-through' : negative ? 'text-warning-ink' : ''}`}>
          {negative ? '−' : ''}
          {formatMoney(absolute(payment.folioAmount), currency)}
          {foreign && (
            <span className="block text-xs font-normal text-ink-muted">
              {formatMoney(absolute(payment.amount), payment.currency)} × {formatRate(payment.exchangeRate)}
            </span>
          )}
        </span>
        {canVoid && (
          <Button size="sm" variant="dangerSoft" icon="close" onClick={() => onVoid(payment)}>
            İptal iste
          </Button>
        )}
      </span>
    </li>
  );
}
