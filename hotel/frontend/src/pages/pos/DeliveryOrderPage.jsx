import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DELIVERY_SOURCE_LABELS, DELIVERY_STATUS_LABELS, PAYMENT_STATUS_LABELS, POS_CHECK_STATUS_LABELS, displayPhone } from '@hotelos/hotel-contracts';
import { Badge, Button, Card, Icon } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { DELIVERY_PATH, DELIVERY_SOURCE_TONES, DELIVERY_STATUS_TONES, deliveryActions, doorSummary } from '../../lib/delivery.js';
import { useDeliveryAction, useDeliveryOrder } from '../../lib/deliveryQueries.js';
import { formatMoney } from '../../lib/format.js';
import { methodLabel } from '../../lib/payments.js';
import { CHECK_STATUS_TONES, checkPath, usePosLive } from '../../lib/pos.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { dayClockText, dueState } from '../../lib/roomService.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useNow } from '../../lib/useNow.js';
import { AssignCourierDialog, DeliveryCancelDialog, DeliveryDeliverDialog, DeliveryDispatchDialog } from './DeliveryDialogs.jsx';

const ACTION_LABELS = Object.freeze({
  preparing: ['Hazırlanıyor', 'utensils', 'outline'],
  ready: ['Hazır', 'checkCircle', 'outline'],
  assign: ['Kurye ata', 'user', 'outline'],
  dispatch: ['Yola çıkar', 'truck', 'primary'],
  back: ['Geri getirildi (kapıda yok)', 'rotateCcw', 'outline'],
  deliver: ['Teslim et', 'checkCheck', 'primary'],
  cancel: ['İptal et', 'close', 'dangerSoft'],
});

/**
 * Paket sipariş (modül 42): müşteri, adres, kalemler, kapıda alınacak, zaman izi (sipariş, hazırlanıyor, hazır,
 * kurye, yola çıkış, teslim; iptal sebebi) ve süreler, adisyonun hesabı ve ödemeleri (ön ödeme / kapı), işlemler.
 * Kalem ekleme ve ikram adisyon ekranından (hazır sipariş mutfağa döner, yoldakine eklenmez).
 */
export function DeliveryOrderPage() {
  const { orderId } = useParams();
  usePosLive();
  const query = useDeliveryOrder(orderId);
  if (query.isPending || query.isError) return <QueryFallback query={query} errorTitle="Paket sipariş yüklenemedi" />;
  return <OrderScreen order={query.data} />;
}

/** @param {{ order: any }} props */
function OrderScreen({ order }) {
  const can = useCan();
  const { timeZone } = useHotelToday();
  const now = useNow(30_000);
  const [dialog, setDialog] = useState(null);
  const action = useDeliveryAction();
  const close = () => setDialog(null);
  const actions = deliveryActions(order, { canOperate: can(PERMISSIONS.POS_OPERATE), canSupervise: can(PERMISSIONS.POS_SUPERVISE) });
  const active = !['DELIVERED', 'CANCELLED'].includes(order.status);
  const due = active ? dueState(order.dueAt, now) : null;
  const money = (value) => formatMoney(value, order.currency);

  const run = (kind) => {
    if (kind === 'preparing' || kind === 'ready' || kind === 'back') {
      const status = kind === 'preparing' ? 'PREPARING' : 'READY';
      action.mutate({ orderId: order.id, path: 'advance', body: { expectedUpdatedAt: order.updatedAt, status }, message: `${order.number}: ${DELIVERY_STATUS_LABELS[status].toLocaleLowerCase('tr-TR')}` });
      return;
    }
    setDialog(kind);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={DELIVERY_PATH} className="flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
          <Icon name="arrowLeft" className="size-4" /> Paket servis panosu
        </Link>
        <h1 className="text-2xl font-bold text-ink">{order.customerName}</h1>
        <span className="font-mono text-sm text-ink-soft">{order.number}</span>
        <Badge tone={DELIVERY_STATUS_TONES[order.status]}>{DELIVERY_STATUS_LABELS[order.status]}</Badge>
        <Badge tone={DELIVERY_SOURCE_TONES[order.source]} dot={false}>{DELIVERY_SOURCE_LABELS[order.source]}</Badge>
        <span className="text-sm text-ink-soft">{order.outletName}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <CustomerCard order={order} money={money} />
          <Card title="Kalemler" description={due ? `Hedef ${dayClockText(order.dueAt, timeZone)} · ${due.text}` : undefined}>
            <ul className="divide-y divide-line">
              {order.items.map((item, index) => (
                <li key={`${item.name}:${index}`} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-8 text-right font-bold tabular-nums">{item.quantity}×</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{item.name}</span>
                    {item.note && <span className="block text-xs italic text-ink-soft">“{item.note}”</span>}
                  </span>
                </li>
              ))}
            </ul>
            {order.note && <p className="mt-2 text-sm italic text-ink-soft">Not: {order.note}</p>}
          </Card>
          {actions.length > 0 && (
            <Card title="İşlemler">
              <div className="flex flex-wrap gap-2">
                {actions.map((kind) => (
                  <Button key={kind} type="button" variant={ACTION_LABELS[kind][2]} icon={ACTION_LABELS[kind][1]} onClick={() => run(kind)} disabled={action.isPending}>
                    {ACTION_LABELS[kind][0]}
                  </Button>
                ))}
              </div>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <TrailCard order={order} timeZone={timeZone} />
          <AccountCard order={order} active={active} money={money} timeZone={timeZone} />
        </div>
      </div>

      {dialog === 'assign' && <AssignCourierDialog order={order} onClose={close} onDone={close} />}
      {dialog === 'dispatch' && <DeliveryDispatchDialog order={order} onClose={close} onDone={close} />}
      {dialog === 'deliver' && <DeliveryDeliverDialog order={order} onClose={close} onDone={close} />}
      {dialog === 'cancel' && <DeliveryCancelDialog order={order} onClose={close} onDone={close} />}
    </div>
  );
}

/** Müşteri, adres, telefon ve kapıda alınacak. @param {{ order: any, money: (value: string) => string }} props */
function CustomerCard({ order, money }) {
  return (
    <Card title="Teslim adresi">
      <address className="text-sm not-italic text-ink">
        <strong className="block text-base">{order.customerName}</strong>
        {order.address}
        {order.addressNote && <span className="block text-xs text-ink-soft">Tarif: {order.addressNote}</span>}
      </address>
      <a href={`tel:${displayPhone(order.phone)}`} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-info-ink hover:underline">
        <Icon name="phone" className="size-4" /> {displayPhone(order.phone)}
      </a>
      <p className="mt-2 rounded-item bg-surface-muted px-3 py-2 text-sm">
        <strong>{doorSummary(order, money)}</strong>
        {order.courierEmail && <span className="ml-2 text-ink-soft">· kurye {order.courierEmail}</span>}
      </p>
    </Card>
  );
}

/** Zaman izi ve süreler. @param {{ order: any, timeZone: string }} props */
function TrailCard({ order, timeZone }) {
  const trail = [
    ['Sipariş', order.createdAt, `${DELIVERY_SOURCE_LABELS[order.source]} · ${order.createdBy}`],
    ['Hazırlanıyor', order.preparingAt, null],
    ['Hazır', order.readyAt, null],
    ['Kurye atandı', order.assignedAt, order.courierEmail],
    ['Yola çıktı', order.dispatchedAt, order.courierEmail],
    ['Teslim edildi', order.deliveredAt, order.deliveredBy],
    ['İptal edildi', order.cancelledAt, order.cancelReason ? `${order.cancelledBy} · ${order.cancelReason}` : order.cancelledBy],
  ].filter(([, at]) => at);
  return (
    <Card title="Zaman izi">
      <ol className="flex flex-col gap-2 text-sm">
        {trail.map(([label, at, who]) => (
          <li key={label} className="flex flex-wrap justify-between gap-x-3">
            <span className="font-semibold text-ink">{label}</span>
            <span className="text-ink-soft">
              {dayClockText(at, timeZone)}
              {who && <span className="ml-2 text-xs text-ink-muted">{who}</span>}
            </span>
          </li>
        ))}
      </ol>
      {order.durations.total !== null && (
        <p className="mt-3 text-xs text-ink-muted">
          Mutfak {order.durations.kitchen ?? '—'} dk · bekleme {order.durations.waiting ?? '—'} dk · yol {order.durations.transit ?? '—'} dk · toplam {order.durations.total} dk ·{' '}
          {order.durations.onTime ? 'zamanında' : 'gecikmeli'}
        </p>
      )}
    </Card>
  );
}

/** Adisyonun hesabı ve ödemeleri. @param {{ order: any, active: boolean, money: (value: string) => string, timeZone: string }} props */
function AccountCard({ order, active, money, timeZone }) {
  const { check } = order;
  return (
    <Card
      title="Hesap"
      actions={
        <Link to={checkPath(check.id)}>
          <Button type="button" size="sm" variant="outline" icon="fileText">
            Adisyon {check.number}
          </Button>
        </Link>
      }
    >
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-ink-soft">Toplam (paket ücreti dahil)</dt>
        <dd className="text-right font-bold tabular-nums">{money(check.grandTotal)}</dd>
        {Number(check.givenAway) > 0 && (
          <>
            <dt className="text-ink-soft">İkram / iptal / indirim</dt>
            <dd className="text-right tabular-nums">{money(check.givenAway)}</dd>
          </>
        )}
        <dt className="text-ink-soft">Alınan</dt>
        <dd className="text-right tabular-nums">{money(check.paidTotal)}</dd>
        <dt className="text-ink-soft">Kalan</dt>
        <dd className="text-right font-bold tabular-nums">{money(check.balance)}</dd>
      </dl>
      {order.payments.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-2 text-xs">
          {order.payments.map((payment) => (
            <li key={payment.id} className="flex flex-wrap justify-between gap-x-3">
              <span>
                <strong>{methodLabel(payment.method)}</strong> {money(payment.amount)}
                {payment.reference && <span className="ml-1 text-ink-muted">· {payment.reference}</span>}
                {payment.status !== 'POSTED' && <span className="ml-1 text-warning-ink">· {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}</span>}
              </span>
              <span className="text-ink-muted">
                {dayClockText(payment.receivedAt, timeZone)} · {payment.receivedBy}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
        <Badge tone={CHECK_STATUS_TONES[check.status]}>{POS_CHECK_STATUS_LABELS[check.status]}</Badge>
        {active ? 'Hesap teslimde kapanır. Müşteri bir şey daha isterse adisyondan tur ekleyin (hazır sipariş mutfağa döner).' : null}
      </p>
    </Card>
  );
}
