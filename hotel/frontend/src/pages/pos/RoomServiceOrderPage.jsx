import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GUEST_REQUEST_STATUS_LABELS, POS_CHECK_STATUS_LABELS, ROOM_SERVICE_SOURCE_LABELS, ROOM_SERVICE_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { formatMoney } from '../../lib/format.js';
import { CHECK_STATUS_TONES, checkPath, usePosLive, usePosTerminal } from '../../lib/pos.js';
import { printHtml, roomServiceSlipHtml } from '../../lib/posPrint.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { ROOM_SERVICE_PATH, RS_SOURCE_TONES, RS_STATUS_TONES, TRAYS_PATH, dayClockText, dueState, orderActions } from '../../lib/roomService.js';
import { useRoomServiceAction, useRoomServiceOrder } from '../../lib/roomServiceQueries.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { useNow } from '../../lib/useNow.js';
import { toastError } from '../../store/toast.js';
import { CancelDialog, DeliverDialog, DispatchDialog, LinesConfirmDialog, RejectDialog } from './RoomServiceDialogs.jsx';
import { RoomServiceLinkDialog } from './RoomServiceLinkDialog.jsx';

const ACTION_LABELS = Object.freeze({
  accept: ['Kabul et', 'check', 'primary'],
  reject: ['Reddet', 'close', 'dangerSoft'],
  release: ['Şimdi mutfağa gönder', 'send', 'primary'],
  preparing: ['Hazırlanıyor', 'utensils', 'outline'],
  ready: ['Hazır', 'checkCircle', 'outline'],
  dispatch: ['Yola çıkar', 'arrowRight', 'outline'],
  back: ['Geri getirildi (odada yok)', 'rotateCcw', 'outline'],
  deliver: ['Teslim et', 'checkCheck', 'primary'],
  cancel: ['İptal et', 'close', 'dangerSoft'],
});

/**
 * Oda servisi siparişi (modül 41): durum ve zaman izi (sipariş, kabul, mutfağa düşüş, hazırlanıyor, hazır, yola
 * çıkış ve götüren, teslim, tepsi; iptal / ret sebebi), kalemler, adisyonun hesabı (adisyon ekranına geçiş — kalem
 * ekleme, ikram oradan), bağlı misafir isteği, işlemler, teslim fişi ve konaklamanın QR bağlantısı.
 */
export function RoomServiceOrderPage() {
  const { orderId } = useParams();
  usePosLive();
  const query = useRoomServiceOrder(orderId);
  if (query.isPending || query.isError) return <QueryFallback query={query} errorTitle="Sipariş yüklenemedi" />;
  return <OrderScreen order={query.data} />;
}

/** @param {{ order: any }} props */
function OrderScreen({ order }) {
  const can = useCan();
  const operate = can(PERMISSIONS.POS_OPERATE);
  const supervise = can(PERMISSIONS.POS_SUPERVISE);
  const terminal = usePosTerminal({ enabled: operate });
  const { timeZone } = useHotelToday();
  const now = useNow(30_000);
  const [dialog, setDialog] = useState(null);
  const action = useRoomServiceAction();
  const close = () => setDialog(null);
  const actions = orderActions(order, { canOperate: operate, canSupervise: supervise });
  const active = !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(order.status);
  const due = active && order.status !== 'REQUESTED' && order.status !== 'SCHEDULED' ? dueState(order.dueAt, now) : null;

  const run = (kind) => {
    if (kind === 'preparing' || kind === 'ready' || kind === 'back') {
      const status = kind === 'preparing' ? 'PREPARING' : 'READY';
      action.mutate({ orderId: order.id, path: 'advance', body: { expectedUpdatedAt: order.updatedAt, status }, message: `${order.number}: ${ROOM_SERVICE_STATUS_LABELS[status].toLocaleLowerCase('tr-TR')}` });
      return;
    }
    setDialog(kind);
  };
  const print = () => {
    if (!printHtml(roomServiceSlipHtml(order, timeZone))) toastError('Yazdırma penceresi açılamadı; tarayıcının açılır pencere iznini verin.');
  };

  const trail = [
    ['Sipariş', order.createdAt, `${ROOM_SERVICE_SOURCE_LABELS[order.source]} · ${order.createdBy}`],
    ['Kabul', order.acceptedAt, order.acceptedBy],
    ['Mutfağa düştü', order.receivedAt, order.check ? `adisyon ${order.check.number} · ${order.check.waiterEmail}` : null],
    ['Hazırlanıyor', order.preparingAt, null],
    ['Hazır', order.readyAt, null],
    ['Yola çıktı', order.dispatchedAt, order.runnerEmail],
    ['Teslim edildi', order.deliveredAt, order.deliveredBy],
    ['Tepsi toplandı', order.trayCollectedAt, order.trayCollectedBy],
    ['Reddedildi', order.rejectedAt, order.rejectReason ? `${order.rejectedBy} · ${order.rejectReason}` : order.rejectedBy],
    ['İptal edildi', order.cancelledAt, order.cancelReason ? `${order.cancelledBy} · ${order.cancelReason}` : order.cancelledBy],
  ].filter(([, at]) => at);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={ROOM_SERVICE_PATH} className="flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
          <Icon name="arrowLeft" className="size-4" /> Oda servisi panosu
        </Link>
        <h1 className="text-2xl font-bold text-ink">Oda {order.movedTo ?? order.roomNumber}</h1>
        <span className="font-mono text-sm text-ink-soft">{order.number}</span>
        <Badge tone={RS_STATUS_TONES[order.status]}>{ROOM_SERVICE_STATUS_LABELS[order.status]}</Badge>
        <Badge tone={RS_SOURCE_TONES[order.source]} dot={false}>{ROOM_SERVICE_SOURCE_LABELS[order.source]}</Badge>
        <span className="text-sm text-ink-soft">
          {order.guestName} · {order.outletName} · {order.covers} kişi
        </span>
      </div>
      {order.movedTo && <Alert tone="warning" title="Misafir oda değiştirdi">Sipariş {order.roomNumber} numaralı odaya verilmişti; teslim {order.movedTo} numaralı odaya.</Alert>}
      {!order.stayActive && active && <Alert tone="danger" title="Misafirin konaklaması bitti">Odaya yazılamaz; teslim edilecekse ödeme kapıda alınır, yoksa iptal edin.</Alert>}
      {order.status === 'SCHEDULED' && (
        <Alert tone="info" title={`Planlı · teslim ${dayClockText(order.deliverAt, timeZone)}`}>
          {dayClockText(order.releaseAt, timeZone)}’de mutfağa düşer (vardiyası açık oda servisi personeline). Gerekirse şimdi gönderin.
        </Alert>
      )}
      {order.trayOverdue && (
        <Alert tone="warning" title="Tepsi toplanmadı" action={<Link to={TRAYS_PATH}><Button size="sm" variant="outline">Tepsiler</Button></Link>}>
          Teslimden bu yana uyarı süresi geçti.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card
            title="Kalemler"
            description={due ? `${order.deliverAt ? `Teslim ${dayClockText(order.deliverAt, timeZone)}` : `Hedef ${dayClockText(order.dueAt, timeZone)}`} · ${due.text}` : undefined}
            actions={
              <Button type="button" size="sm" variant="ghost" icon="fileText" onClick={print}>
                Teslim fişi
              </Button>
            }
          >
            <ul className="divide-y divide-line">
              {order.items.map((item, index) => (
                <li key={`${item.menuItemId}:${index}`} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-8 text-right font-bold tabular-nums">{item.quantity}×</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{item.name}</span>
                    {item.note && <span className="block text-xs italic text-ink-soft">“{item.note}”</span>}
                  </span>
                  <span className="tabular-nums">{formatMoney((Number(item.unitPrice) * item.quantity).toFixed(2), order.currency)}</span>
                </li>
              ))}
            </ul>
            {order.note && <p className="mt-2 text-sm italic text-ink-soft">Not: {order.note}</p>}
            <p className="mt-2 text-xs text-ink-muted">{order.trayExpected ? 'Tepsi bırakılacak (toplama takibinde).' : 'Tepsisiz teslim.'}</p>
          </Card>
          {actions.length > 0 && (
            <Card title="İşlemler">
              <div className="flex flex-wrap gap-2">
                {actions.map((kind) => (
                  <Button key={kind} type="button" variant={ACTION_LABELS[kind][2]} icon={ACTION_LABELS[kind][1]} onClick={() => run(kind)} disabled={action.isPending}>
                    {ACTION_LABELS[kind][0]}
                  </Button>
                ))}
                {operate && order.stayActive && (
                  <Button type="button" variant="ghost" icon="link" onClick={() => setDialog('link')}>
                    Misafirin QR bağlantısı
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-4">
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
                Mutfak {order.durations.kitchen ?? '—'} dk · yol {order.durations.transit ?? '—'} dk · toplam {order.durations.total} dk · {order.durations.onTime ? 'zamanında' : 'gecikmeli'}
              </p>
            )}
          </Card>
          {order.check ? (
            <Card
              title="Hesap"
              actions={
                <Link to={checkPath(order.check.id)}>
                  <Button type="button" size="sm" variant="outline" icon="fileText">
                    Adisyon {order.check.number}
                  </Button>
                </Link>
              }
            >
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-ink-soft">Toplam (tepsi ücreti dahil)</dt>
                <dd className="text-right font-bold tabular-nums">{formatMoney(order.check.grandTotal, order.currency)}</dd>
                {Number(order.check.givenAway) > 0 && (
                  <>
                    <dt className="text-ink-soft">İkram / iptal / indirim</dt>
                    <dd className="text-right tabular-nums">{formatMoney(order.check.givenAway, order.currency)}</dd>
                  </>
                )}
                <dt className="text-ink-soft">Kapıda alınan</dt>
                <dd className="text-right tabular-nums">{formatMoney(order.check.paidTotal, order.currency)}</dd>
                <dt className="text-ink-soft">Odaya yazılan</dt>
                <dd className="text-right tabular-nums">{formatMoney(order.check.roomChargeTotal, order.currency)}</dd>
                <dt className="text-ink-soft">Kalan</dt>
                <dd className="text-right font-bold tabular-nums">{formatMoney(order.check.balance, order.currency)}</dd>
              </dl>
              <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                <Badge tone={CHECK_STATUS_TONES[order.check.status]}>{POS_CHECK_STATUS_LABELS[order.check.status]}</Badge>
                {active ? 'Hesap teslimde kapanır. Misafir bir şey daha isterse adisyondan tur ekleyin (hazır sipariş mutfağa döner).' : null}
              </p>
            </Card>
          ) : (
            <Card title="Hesap">
              <p className="text-sm text-ink-soft">{order.status === 'REQUESTED' ? 'Kabul edilince adisyon açılır.' : order.status === 'SCHEDULED' ? 'Mutfağa düşünce adisyon açılır.' : 'Adisyon açılmadı.'} Tahmini tutar {formatMoney(order.itemsTotal, order.currency)} (oda servisi ücreti hariç).</p>
            </Card>
          )}
          {order.guestRequest && (
            <Card title="Misafir isteği">
              <p className="text-sm">
                <strong>{order.guestRequest.title}</strong> · {GUEST_REQUEST_STATUS_LABELS[order.guestRequest.status]}
              </p>
              <p className="mt-1 text-xs text-ink-muted">Sipariş teslim edilince istek tamamlanır; iptal edilirse yeniden açılır.</p>
            </Card>
          )}
        </div>
      </div>

      {(dialog === 'accept' || dialog === 'release') && <LinesConfirmDialog order={order} terminal={terminal.data ?? null} mode={dialog} onClose={close} onDone={close} />}
      {dialog === 'reject' && <RejectDialog order={order} onClose={close} onDone={close} />}
      {dialog === 'dispatch' && <DispatchDialog order={order} onClose={close} onDone={close} />}
      {dialog === 'deliver' && <DeliverDialog order={order} onClose={close} onDone={close} />}
      {dialog === 'cancel' && <CancelDialog order={order} onClose={close} onDone={close} />}
      {dialog === 'link' && <RoomServiceLinkDialog reservationId={order.reservationId} onClose={close} />}
    </div>
  );
}
