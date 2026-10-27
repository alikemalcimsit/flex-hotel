import { useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { ROOM_SERVICE_SOURCE_LABELS, ROOM_SERVICE_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { formatMoney } from '../../lib/format.js';
import { usePosTerminal } from '../../lib/pos.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { PREP_PATH, RS_SOURCE_ICONS, RS_SOURCE_TONES, RS_STATUS_TONES, TRAYS_PATH, agoText, clockText, dueState, orderActions, orderPath } from '../../lib/roomService.js';
import { useRoomServiceAction, useRoomServiceBoard } from '../../lib/roomServiceQueries.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useNow } from '../../lib/useNow.js';
import { CancelDialog, DeliverDialog, DispatchDialog, LinesConfirmDialog, RejectDialog } from './RoomServiceDialogs.jsx';
import { RoomServiceTabs } from './RoomServiceTabs.jsx';
import { ShiftBar } from './ShiftBar.jsx';

/** Kartlardaki süre yazısı yarım dakikada bir tazelenir. */
const CLOCK_TICK_MS = 30_000;
/** Kanal kopukken pano bu aralıkla okunur. */
const OFFLINE_REFRESH_MS = 30_000;

const COLUMNS = Object.freeze([
  { key: 'requested', title: 'Onay bekleyen', hint: 'Misafirin QR siparişi: kabul ya da ret', icon: 'globe', empty: 'Kabul bekleyen misafir siparişi yok.' },
  { key: 'kitchen', title: 'Mutfakta', hint: 'Düştü / hazırlanıyor', icon: 'utensils', empty: 'Mutfakta sipariş yok.' },
  { key: 'ready', title: 'Hazır', hint: 'Götürülmeyi bekliyor', icon: 'checkCircle', empty: 'Hazır bekleyen yok.' },
  { key: 'onTheWay', title: 'Yolda', hint: 'Odaya gidiyor', icon: 'arrowRight', empty: 'Yolda sipariş yok.' },
]);

/**
 * Oda servisi panosu (modül 41): onay bekleyen misafir siparişleri, mutfaktakiler, hazırlar ve yoldakiler — teslim
 * hedefine göre sıralı, geciken kırmızı; her kartta durumun işlemleri (kabul / ret, hazırlanıyor, hazır, yola çıkar,
 * teslim, iptal). Üstte planlı siparişlerin ve toplanacak tepsilerin sayısı. Garsonun vardiya çubuğu da buradadır
 * (mutfağa düşen sipariş vardiyasına açılır; kapıda ödeme kasasına girer).
 */
export function RoomServiceBoardPage() {
  const { isLive = true } = useOutletContext() ?? {};
  const can = useCan();
  const operate = can(PERMISSIONS.POS_OPERATE);
  const supervise = can(PERMISSIONS.POS_SUPERVISE);
  const { timeZone } = useHotelToday();
  const now = useNow(CLOCK_TICK_MS);
  const terminal = usePosTerminal({ enabled: operate });
  const [params, setParams] = useSearchParams();
  const outlets = (terminal.data?.outlets ?? []).filter((outlet) => outlet.kind === 'ROOM_SERVICE');
  const outletId = outlets.some((outlet) => outlet.id === params.get('nokta')) ? params.get('nokta') : '';
  const board = useRoomServiceBoard({ outletId }, { refetchInterval: isLive ? false : OFFLINE_REFRESH_MS });
  const [dialog, setDialog] = useState(null);
  const action = useRoomServiceAction();
  const close = () => setDialog(null);

  const run = (order, kind) => {
    if (kind === 'preparing' || kind === 'ready' || kind === 'back') {
      const status = kind === 'preparing' ? 'PREPARING' : 'READY';
      action.mutate({ orderId: order.id, path: 'advance', body: { expectedUpdatedAt: order.updatedAt, status }, message: `${order.number}: ${ROOM_SERVICE_STATUS_LABELS[status].toLocaleLowerCase('tr-TR')}` });
      return;
    }
    setDialog({ kind, order });
  };

  return (
    <div className="flex flex-col gap-4">
      <RoomServiceTabs />
      {operate && terminal.data && <ShiftBar outlets={terminal.data.outlets} currency={terminal.data.currency} />}
      {operate && terminal.isSuccess && outlets.length === 0 && (
        <Alert tone="warning" title="Oda servisi noktası tanımlı değil">
          Menü ve tanımlardan türü “Oda servisi” olan bir satış noktası ekleyin (odaya yazmaya açık).
        </Alert>
      )}
      {outlets.length > 1 && (
        <ChoiceChips
          label="Oda servisi noktası"
          options={[{ value: '', label: 'Hepsi' }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]}
          value={outletId}
          onChange={(value) => setParams(value ? { nokta: value } : {}, { replace: true })}
        />
      )}
      {board.isPending || board.isError ? (
        <QueryFallback query={board} errorTitle="Pano yüklenemedi" />
      ) : (
        <>
          <Summary board={board.data} timeZone={timeZone} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
            {COLUMNS.map((column) => {
              const data = board.data.columns[column.key];
              return (
                <Card
                  key={column.key}
                  title={column.title}
                  description={column.hint}
                  actions={
                    <Badge tone={data.total ? 'info' : 'neutral'} dot={false}>
                      <Icon name={column.icon} className="mr-1 size-3" />
                      {data.total}
                    </Badge>
                  }
                >
                  {data.items.length === 0 ? (
                    <p className="py-6 text-center text-sm text-ink-muted">{column.empty}</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {data.items.map((order) => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          now={now}
                          timeZone={timeZone}
                          currency={board.data.currency}
                          actions={orderActions(order, { canOperate: operate, canSupervise: supervise })}
                          busy={action.isPending}
                          onAction={(kind) => run(order, kind)}
                        />
                      ))}
                    </ul>
                  )}
                  {data.total > data.items.length && <p className="mt-2 text-xs text-ink-muted">İlk {data.items.length} gösteriliyor (toplam {data.total}).</p>}
                </Card>
              );
            })}
          </div>
        </>
      )}
      {(dialog?.kind === 'accept' || dialog?.kind === 'release') && <LinesConfirmDialog order={dialog.order} terminal={terminal.data ?? null} mode={dialog.kind} onClose={close} onDone={close} />}
      {dialog?.kind === 'reject' && <RejectDialog order={dialog.order} onClose={close} onDone={close} />}
      {dialog?.kind === 'dispatch' && <DispatchDialog order={dialog.order} onClose={close} onDone={close} />}
      {dialog?.kind === 'deliver' && <DeliverDialog order={dialog.order} onClose={close} onDone={close} />}
      {dialog?.kind === 'cancel' && <CancelDialog order={dialog.order} onClose={close} onDone={close} />}
    </div>
  );
}

/** @param {{ board: any, timeZone: string }} props */
function Summary({ board, timeZone }) {
  const { scheduled, trays, settings } = board;
  return (
    <section aria-label="Özet" className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3 text-sm shadow-soft">
      <Link to={PREP_PATH} className="flex items-center gap-2 font-semibold text-ink hover:underline">
        <Icon name="calendar" className="size-4 text-info-ink" />
        Planlı {scheduled.total}
        {scheduled.next && <span className="font-normal text-ink-soft">· ilki {clockText(scheduled.next.releaseAt, timeZone)}’de mutfağa ({clockText(scheduled.next.deliverAt, timeZone)} teslim)</span>}
      </Link>
      <Link to={TRAYS_PATH} className="flex items-center gap-2 font-semibold text-ink hover:underline">
        <Icon name="checkCheck" className="size-4 text-info-ink" />
        Toplanacak tepsi {trays.pending}
        {trays.overdue > 0 && <Badge tone="danger">{trays.overdue} gecikmiş</Badge>}
      </Link>
      <span className="text-ink-soft">Teslim hedefi {settings.deliveryTargetMinutes} dk · hazırlık payı {settings.prepLeadMinutes} dk</span>
      <Badge tone={settings.guestOrderingEnabled ? 'success' : 'neutral'}>{settings.guestOrderingEnabled ? 'Misafir QR siparişi açık' : 'Misafir QR siparişi kapalı'}</Badge>
    </section>
  );
}

const ACTION_BUTTONS = Object.freeze({
  accept: { label: 'Kabul et', icon: 'check', variant: 'primary' },
  reject: { label: 'Reddet', icon: 'close', variant: 'dangerSoft' },
  release: { label: 'Mutfağa gönder', icon: 'send', variant: 'primary' },
  preparing: { label: 'Hazırlanıyor', icon: 'utensils', variant: 'outline' },
  ready: { label: 'Hazır', icon: 'checkCircle', variant: 'outline' },
  dispatch: { label: 'Yola çıkar', icon: 'arrowRight', variant: 'outline' },
  back: { label: 'Geri getirildi', icon: 'rotateCcw', variant: 'ghost' },
  deliver: { label: 'Teslim et', icon: 'checkCheck', variant: 'primary' },
  cancel: { label: 'İptal', icon: 'close', variant: 'ghost' },
});

/**
 * Sipariş kartı: oda (taşındıysa yeni oda), misafir, kaynak, hedefe kalan süre, kalemler ve not, işlemler.
 * @param {{ order: any, now: number, timeZone: string, currency: string, actions: string[], busy: boolean, onAction: (kind: string) => void }} props
 */
export function OrderCard({ order, now, timeZone, currency, actions, busy, onAction }) {
  const due = dueState(order.dueAt, now);
  return (
    <li className={`rounded-item border p-3 ${order.late ? 'border-danger-line bg-danger-soft/40' : 'border-line bg-surface'}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={orderPath(order.id)} className="min-w-0">
          <span className="block text-lg font-bold leading-tight text-ink">
            Oda {order.movedTo ?? order.roomNumber}
            {order.movedTo && <span className="ml-1 text-xs font-semibold text-warning-ink">(önce {order.roomNumber})</span>}
          </span>
          <span className="block truncate text-xs text-ink-soft">
            {order.guestName} · <span className="font-mono">{order.number}</span>
          </span>
        </Link>
        <Badge tone={RS_STATUS_TONES[order.status]}>{ROOM_SERVICE_STATUS_LABELS[order.status]}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={RS_SOURCE_TONES[order.source]} dot={false}>
          <Icon name={RS_SOURCE_ICONS[order.source]} className="mr-1 size-3" />
          {ROOM_SERVICE_SOURCE_LABELS[order.source]}
        </Badge>
        <span className={due.tone === 'danger' ? 'font-bold text-danger-ink' : due.tone === 'warning' ? 'font-semibold text-warning-ink' : 'text-ink-soft'}>
          {order.deliverAt ? `Teslim ${clockText(order.deliverAt, timeZone)}` : `Hedef ${clockText(order.dueAt, timeZone)}`} · {due.text}
        </span>
        {order.status === 'REQUESTED' && <span className="text-ink-muted">geldi {agoText(order.createdAt, now)}</span>}
        {order.runnerEmail && order.status === 'ON_THE_WAY' && <span className="text-ink-muted">götüren {order.runnerEmail}</span>}
        {!order.stayActive && <Badge tone="danger">Konaklama bitti</Badge>}
      </div>
      <ul className="mt-2 flex flex-col gap-0.5 text-sm">
        {order.items.map((item, index) => (
          <li key={`${item.menuItemId}:${index}`}>
            <strong className="tabular-nums">{item.quantity}×</strong> {item.name}
            {item.note && <span className="ml-1 text-xs italic text-ink-soft">“{item.note}”</span>}
          </li>
        ))}
      </ul>
      {order.note && <p className="mt-1 text-xs italic text-ink-soft">Not: {order.note}</p>}
      <p className="mt-1 text-xs text-ink-muted">
        {order.covers} kişi · {formatMoney(order.itemsTotal, currency)}
        {!order.trayExpected && ' · tepsisiz'}
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

