import { useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { DELIVERY_SOURCE_LABELS, DELIVERY_STATUS_LABELS, displayPhone } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { DELIVERY_SOURCE_ICONS, DELIVERY_SOURCE_TONES, DELIVERY_STATUS_TONES, deliveryActions, deliveryOrderPath, doorSummary } from '../../lib/delivery.js';
import { useDeliveryAction, useDeliveryBoard } from '../../lib/deliveryQueries.js';
import { formatMoney } from '../../lib/format.js';
import { usePosTerminal } from '../../lib/pos.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { clockText, dueState } from '../../lib/roomService.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useNow } from '../../lib/useNow.js';
import { AssignCourierDialog, DeliveryCancelDialog, DeliveryDeliverDialog, DeliveryDispatchDialog } from './DeliveryDialogs.jsx';
import { DeliveryTabs } from './DeliveryTabs.jsx';
import { ShiftBar } from './ShiftBar.jsx';

/** Kartlardaki süre yazısı yarım dakikada bir tazelenir. */
const CLOCK_TICK_MS = 30_000;
/** Kanal kopukken pano bu aralıkla okunur. */
const OFFLINE_REFRESH_MS = 30_000;

const COLUMNS = Object.freeze([
  { key: 'kitchen', title: 'Mutfakta', hint: 'Düştü / hazırlanıyor', icon: 'utensils', empty: 'Mutfakta paket yok.' },
  { key: 'ready', title: 'Hazır', hint: 'Kurye bekliyor', icon: 'checkCircle', empty: 'Hazır bekleyen yok.' },
  { key: 'onTheWay', title: 'Yolda', hint: 'Kuryede', icon: 'truck', empty: 'Yolda paket yok.' },
]);

/**
 * Paket servis panosu (modül 42): mutfaktakiler, hazırlar (kurye bekliyor) ve yoldakiler — teslim hedefine göre
 * sıralı, geciken kırmızı; her kartta müşteri, telefon, adres, kalemler, kapıda alınacak ve durumun işlemleri
 * (hazırlanıyor, hazır, kurye ata, yola çıkar, teslim, geri getirildi, iptal). Üstte bugünün özeti; garsonun
 * vardiya çubuğu da buradadır (sipariş alanın vardiyasına açılır, kapı parası kuryenin kasasına girer).
 */
export function DeliveryBoardPage() {
  const { isLive = true } = useOutletContext() ?? {};
  const can = useCan();
  const operate = can(PERMISSIONS.POS_OPERATE);
  const supervise = can(PERMISSIONS.POS_SUPERVISE);
  const { timeZone } = useHotelToday();
  const now = useNow(CLOCK_TICK_MS);
  const terminal = usePosTerminal({ enabled: operate });
  const [params, setParams] = useSearchParams();
  const outlets = (terminal.data?.outlets ?? []).filter((outlet) => outlet.kind === 'DELIVERY');
  const outletId = outlets.some((outlet) => outlet.id === params.get('nokta')) ? params.get('nokta') : '';
  const board = useDeliveryBoard({ outletId }, { refetchInterval: isLive ? false : OFFLINE_REFRESH_MS });
  const [dialog, setDialog] = useState(null);
  const action = useDeliveryAction();
  const close = () => setDialog(null);

  const run = (order, kind) => {
    if (kind === 'preparing' || kind === 'ready' || kind === 'back') {
      const status = kind === 'preparing' ? 'PREPARING' : 'READY';
      action.mutate({ orderId: order.id, path: 'advance', body: { expectedUpdatedAt: order.updatedAt, status }, message: `${order.number}: ${DELIVERY_STATUS_LABELS[status].toLocaleLowerCase('tr-TR')}` });
      return;
    }
    setDialog({ kind, order });
  };

  return (
    <div className="flex flex-col gap-4">
      <DeliveryTabs />
      {operate && terminal.data && <ShiftBar outlets={terminal.data.outlets} currency={terminal.data.currency} />}
      {operate && terminal.isSuccess && outlets.length === 0 && (
        <Alert tone="warning" title="Paket servis noktası tanımlı değil">
          Menü ve tanımlardan türü “Paket servis” olan bir satış noktası ekleyin.
        </Alert>
      )}
      {outlets.length > 1 && (
        <ChoiceChips
          label="Paket servis noktası"
          options={[{ value: '', label: 'Hepsi' }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]}
          value={outletId}
          onChange={(value) => setParams(value ? { nokta: value } : {}, { replace: true })}
        />
      )}
      {board.isPending || board.isError ? (
        <QueryFallback query={board} errorTitle="Pano yüklenemedi" />
      ) : (
        <>
          <Summary board={board.data} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {COLUMNS.map((column) => (
              <BoardColumn
                key={column.key}
                column={column}
                data={board.data.columns[column.key]}
                render={(order) => (
                  <DeliveryCard
                    key={order.id}
                    order={order}
                    now={now}
                    timeZone={timeZone}
                    currency={board.data.currency}
                    actions={deliveryActions(order, { canOperate: operate, canSupervise: supervise })}
                    busy={action.isPending}
                    onAction={(kind) => run(order, kind)}
                  />
                )}
              />
            ))}
          </div>
        </>
      )}
      {dialog?.kind === 'assign' && <AssignCourierDialog order={dialog.order} onClose={close} onDone={close} />}
      {dialog?.kind === 'dispatch' && <DeliveryDispatchDialog order={dialog.order} onClose={close} onDone={close} />}
      {dialog?.kind === 'deliver' && <DeliveryDeliverDialog order={dialog.order} onClose={close} onDone={close} />}
      {dialog?.kind === 'cancel' && <DeliveryCancelDialog order={dialog.order} onClose={close} onDone={close} />}
    </div>
  );
}

/** @param {{ column: any, data: { items: any[], total: number }, render: (order: any) => React.ReactNode }} props */
function BoardColumn({ column, data, render }) {
  return (
    <Card
      title={column.title}
      description={column.hint}
      actions={
        <Badge tone={data.total ? 'info' : 'neutral'} dot={false}>
          <Icon name={column.icon} className="mr-1 size-3" />
          {data.total}
        </Badge>
      }
    >
      {data.items.length === 0 ? <p className="py-6 text-center text-sm text-ink-muted">{column.empty}</p> : <ul className="flex flex-col gap-3">{data.items.map(render)}</ul>}
      {data.total > data.items.length && <p className="mt-2 text-xs text-ink-muted">İlk {data.items.length} gösteriliyor (toplam {data.total}).</p>}
    </Card>
  );
}

/** Bugünün özeti ve politika. @param {{ board: any }} props */
function Summary({ board }) {
  const { today, settings, currency } = board;
  return (
    <section aria-label="Özet" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3 text-sm shadow-soft">
      <span className="flex items-center gap-2 font-semibold text-ink">
        <Icon name="checkCheck" className="size-4 text-success-ink" />
        Bugün teslim {today.delivered}
      </span>
      {today.cancelled > 0 && <span className="text-ink-soft">İptal {today.cancelled}</span>}
      {today.onTimePct !== null && <Badge tone={today.onTimePct >= 90 ? 'success' : today.onTimePct >= 70 ? 'warning' : 'danger'}>Zamanında %{today.onTimePct}</Badge>}
      <span className="text-ink-soft">
        Teslim hedefi {settings.deliveryOrderMinutes} dk
        {Number(settings.deliveryFee) > 0 && ` · paket ücreti ${formatMoney(settings.deliveryFee, currency)}`}
        {Number(settings.deliveryMinOrder) > 0 && ` · en az ${formatMoney(settings.deliveryMinOrder, currency)}`}
      </span>
    </section>
  );
}

const ACTION_BUTTONS = Object.freeze({
  preparing: { label: 'Hazırlanıyor', icon: 'utensils', variant: 'outline' },
  ready: { label: 'Hazır', icon: 'checkCircle', variant: 'outline' },
  assign: { label: 'Kurye ata', icon: 'user', variant: 'outline' },
  dispatch: { label: 'Yola çıkar', icon: 'truck', variant: 'primary' },
  back: { label: 'Geri getirildi', icon: 'rotateCcw', variant: 'ghost' },
  deliver: { label: 'Teslim et', icon: 'checkCheck', variant: 'primary' },
  cancel: { label: 'İptal', icon: 'close', variant: 'ghost' },
});

/**
 * Paket kartı: müşteri, telefon, adres ve tarif, kaynak, hedefe kalan süre, kalemler, kapıda alınacak, kurye ve
 * işlemler.
 * @param {{ order: any, now: number, timeZone: string, currency: string, actions: string[], busy: boolean, onAction: (kind: string) => void }} props
 */
export function DeliveryCard({ order, now, timeZone, currency, actions, busy, onAction }) {
  const due = dueState(order.dueAt, now);
  return (
    <li className={`rounded-item border p-3 ${order.late ? 'border-danger-line bg-danger-soft/40' : 'border-line bg-surface'}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={deliveryOrderPath(order.id)} className="min-w-0">
          <span className="block text-lg font-bold leading-tight text-ink">{order.customerName}</span>
          <span className="block truncate text-xs text-ink-soft">
            <span className="font-mono">{order.number}</span> · {order.outletName}
          </span>
        </Link>
        <Badge tone={DELIVERY_STATUS_TONES[order.status]}>{DELIVERY_STATUS_LABELS[order.status]}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={DELIVERY_SOURCE_TONES[order.source]} dot={false}>
          <Icon name={DELIVERY_SOURCE_ICONS[order.source]} className="mr-1 size-3" />
          {DELIVERY_SOURCE_LABELS[order.source]}
        </Badge>
        <span className={due.tone === 'danger' ? 'font-bold text-danger-ink' : due.tone === 'warning' ? 'font-semibold text-warning-ink' : 'text-ink-soft'}>
          Hedef {clockText(order.dueAt, timeZone)} · {due.text}
        </span>
      </div>
      <address className="mt-2 text-sm not-italic text-ink">
        {order.address}
        {order.addressNote && <span className="block text-xs text-ink-soft">{order.addressNote}</span>}
      </address>
      <a href={`tel:${displayPhone(order.phone)}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-info-ink hover:underline">
        <Icon name="phone" className="size-3" /> {displayPhone(order.phone)}
      </a>
      <ul className="mt-2 flex flex-col gap-0.5 text-sm">
        {order.items.map((item, index) => (
          <li key={`${item.name}:${index}`}>
            <strong className="tabular-nums">{item.quantity}×</strong> {item.name}
            {item.note && <span className="ml-1 text-xs italic text-ink-soft">“{item.note}”</span>}
          </li>
        ))}
      </ul>
      {order.note && <p className="mt-1 text-xs italic text-ink-soft">Not: {order.note}</p>}
      <p className="mt-1 text-xs text-ink-muted">
        Toplam {formatMoney(order.total, currency)} · <strong className="text-ink">{doorSummary(order, (value) => formatMoney(value, currency))}</strong>
        {order.courierEmail && <span> · kurye {order.courierEmail}</span>}
      </p>
      {actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {actions.map((kind) => (
            <Button key={kind} type="button" size="sm" variant={ACTION_BUTTONS[kind].variant} icon={ACTION_BUTTONS[kind].icon} onClick={() => onAction(kind)} disabled={busy}>
              {ACTION_BUTTONS[kind].label}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}
