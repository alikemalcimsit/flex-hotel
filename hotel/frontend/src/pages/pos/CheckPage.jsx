import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS, POS_ADJUSTMENT_STATUS_LABELS, POS_CHECK_STATUS_LABELS, POS_STATION_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Icon } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PAYMENT_METHOD_ICONS, methodLabel } from '../../lib/payments.js';
import {
  ADJUSTMENT_STATUS_TONES,
  CHECK_STATUS_TONES,
  POSTING_LABELS,
  POSTING_TONES,
  checkPath,
  dateTimeText,
  elapsedText,
  posKeys,
  timeText,
  usePosCheck,
  usePosLive,
  usePosTerminal,
} from '../../lib/pos.js';
import { groupByOrder } from '../../lib/posCart.js';
import { billSlipHtml, kitchenSlipHtml, printHtml } from '../../lib/posPrint.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { orderPath } from '../../lib/roomService.js';
import { useNow } from '../../lib/useNow.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { AdjustmentDialog, EditCheckDialog, PaymentDialog, PaymentVoidDialog, ReopenDialog, RoomChargeDialog } from './CheckDialogs.jsx';
import { MergeDialog, MoveDialog, SplitDialog, TransferDialog } from './CheckMoveDialogs.jsx';
import { MenuPanel } from './MenuPanel.jsx';

const CLOCK_TICK_MS = 60_000;

/** Yazdırma penceresi açılamadıysa. @param {string} html */
function print(html) {
  if (!printHtml(html)) toastError('Yazdırma penceresi açılamadı; tarayıcının açılır pencere iznini verin.');
}

/**
 * Adisyon ekranı (modül 39): sipariş (menü + sepet + gönder), turlar ve kalemler, ikram /
 * iptal / indirim (şef garson; eşik üstü dört göz), toplam ve vergi dökümü, ödeme (nakit /
 * kart, para üstü), odaya yaz, hatalı ödemenin iptali, bölme / taşıma / birleştirme / devir,
 * hesap ve mutfak fişi, kapanmış adisyonu yeniden açma. Kanal açıkken başka garsonun
 * işlemi de ekrana anında düşer.
 */
export function CheckPage() {
  const { checkId } = useParams();
  usePosLive();
  const query = usePosCheck(checkId);
  const canOperate = useCan()(PERMISSIONS.POS_OPERATE);
  const terminal = usePosTerminal({ enabled: canOperate });
  if (query.isPending || query.isError) return <QueryFallback query={query} errorTitle="Adisyon yüklenemedi" />;
  return <CheckScreen check={query.data} terminal={terminal.data ?? null} />;
}

/** @param {{ check: any, terminal: any }} props */
function CheckScreen({ check, terminal }) {
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const now = useNow(CLOCK_TICK_MS);
  const [dialog, setDialog] = useState(null);
  const operate = can(PERMISSIONS.POS_OPERATE);
  const supervise = can(PERMISSIONS.POS_SUPERVISE);
  const open = check.status === 'OPEN';
  const balance = Number(check.balance);
  const hasLines = check.lines.length > 0;
  const waiting = check.pending.adjustments + check.pending.payments + check.pending.voids;
  // Oda servisi adisyonu (modül 41): siparişle bire bir; bölünmez / taşınmaz / birleşmez, hesabı teslimde kapanır.
  const roomService = check.roomService;
  const settleHere = !roomService || roomService.status === 'DELIVERED';
  const floorPath = roomService ? orderPath(roomService.id) : `/pos/masalar?nokta=${check.outletId}`;

  const replace = (updated) => {
    queryClient.setQueryData(posKeys.check(updated.id), updated);
    queryClient.invalidateQueries({ queryKey: posKeys.all });
  };
  const finish = (updated, message) => {
    setDialog(null);
    replace(updated);
    if (message) toastSuccess(message);
    if (updated.status === 'CLOSED' && check.status === 'OPEN') {
      toastSuccess(`${updated.number} kapandı`);
      navigate(floorPath);
    }
  };
  const action = useMutation({
    mutationFn: ({ path, body }) => apiPost(`/pos/checks/${check.id}/${path}`, body),
    onSuccess: (updated, { message }) => finish(updated, message),
    onError: (error) => {
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: posKeys.check(check.id) });
      toastError(error.message);
    },
  });
  const run = (path, body, message) => action.mutate({ path, body, message });
  const busy = action.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={floorPath} className="flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">
          <Icon name="arrowLeft" className="size-4" /> {roomService ? `Oda servisi ${roomService.number}` : 'Masa planı'}
        </Link>
        <h1 className="text-2xl font-bold text-ink">{roomService ? `Oda ${roomService.roomNumber}` : check.table ? `Masa ${check.table.name}` : 'Masasız'}</h1>
        <span className="font-mono text-sm text-ink-soft">{check.number}</span>
        <Badge tone={CHECK_STATUS_TONES[check.status]}>{POS_CHECK_STATUS_LABELS[check.status]}</Badge>
        {check.billRequestedAt && open && <Badge tone="warning">Hesap istiyor</Badge>}
        <span className="text-sm text-ink-soft">
          {check.outlet.name} · {check.covers} kişi · {check.waiterEmail} · {open ? elapsedText(check.openedAt, now) : dateTimeText(check.openedAt)}
        </span>
        {open && operate && (
          <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setDialog({ kind: 'edit' })}>
            Kişi / not
          </Button>
        )}
      </div>
      {check.note && <p className="text-sm italic text-ink-soft">Not: {check.note}</p>}
      {roomService && !settleHere && (
        <Alert tone="info" title={`Oda servisi siparişi · ${roomService.guestName}`}>
          Hesap teslimde kapanır (kapıda ödeme ve kalanın odaya yazılması oda servisi ekranından). Misafir bir şey daha isterse buradan tur ekleyin; hazır sipariş mutfağa döner, yoldaki siparişe eklenmez.
        </Alert>
      )}
      {check.splitFrom && (
        <p className="text-sm text-ink-soft">
          <Link to={checkPath(check.splitFrom.id)} className="text-info-ink underline-offset-2 hover:underline">
            {check.splitFrom.number}
          </Link>{' '}
          adisyonundan bölündü.
        </p>
      )}
      {waiting > 0 && (
        <Alert tone="warning" title="Onay bekleyen iş var">
          {[
            check.pending.adjustments && `${check.pending.adjustments} düzeltme`,
            check.pending.payments && `${check.pending.payments} ödeme`,
            check.pending.voids && `${check.pending.voids} ödeme iptali`,
          ]
            .filter(Boolean)
            .join(', ')}{' '}
          başka bir yetkilinin kararını bekliyor. Karar gelene kadar adisyon kapanmaz{check.pending.adjustments ? ' ve ödeme alınmaz' : ''}.
        </Alert>
      )}
      {check.status === 'CLOSED' && (
        <Alert tone="success" title={`Kapandı · ${dateTimeText(check.closedAt)}`}>
          {check.closedBy} kapattı (iş günü {check.businessDate}).{check.reopenReason ? ` Daha önce yeniden açıldı: ${check.reopenReason}.` : ''}
        </Alert>
      )}
      {check.status === 'VOID' && <Alert tone="info" title="İptal edildi">{check.note ?? 'Boş adisyon iptal edildi.'}</Alert>}

      <div className={`grid grid-cols-1 gap-4 ${open && operate && terminal ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}`}>
        {open && operate && terminal && <MenuPanel check={check} terminal={terminal} />}
        <div className="flex flex-col gap-4">
          <LinesCard check={check} canSupervise={supervise && open} onAdjust={(kind, line) => setDialog({ kind: 'adjust', adjustKind: kind, line })} />
          <TotalsCard check={check} />
          {operate && (
            <Card title="İşlemler">
              <div className="flex flex-wrap gap-2">
                {open && settleHere && balance > 0 && (
                  <Button type="button" icon="banknote" onClick={() => setDialog({ kind: 'pay' })} disabled={busy || check.pending.adjustments > 0}>
                    Ödeme al
                  </Button>
                )}
                {open && settleHere && balance > 0 && check.outlet.allowRoomCharge && (
                  <Button type="button" variant="outline" icon="bed" onClick={() => setDialog({ kind: 'room' })} disabled={busy || waiting > 0}>
                    Odaya yaz
                  </Button>
                )}
                {open && !roomService && balance > 0 && (
                  <Button type="button" variant="outline" icon="bell" onClick={() => run('bill', { requested: !check.billRequestedAt }, check.billRequestedAt ? 'Hesap isteği geri alındı' : 'Masa “hesap istiyor”')} disabled={busy}>
                    {check.billRequestedAt ? 'Hesap isteğini geri al' : 'Hesap istendi'}
                  </Button>
                )}
                {hasLines && (
                  <Button type="button" variant="outline" icon="fileText" onClick={() => print(billSlipHtml(check))}>
                    Hesap fişi
                  </Button>
                )}
                {open && !roomService && hasLines && (
                  <Button type="button" variant="outline" icon="layers" onClick={() => setDialog({ kind: 'split' })} disabled={busy}>
                    Böl
                  </Button>
                )}
                {open && !roomService && terminal && (
                  <Button type="button" variant="outline" icon="arrowRight" onClick={() => setDialog({ kind: 'move' })} disabled={busy}>
                    Masa değiştir
                  </Button>
                )}
                {open && !roomService && (
                  <Button type="button" variant="outline" icon="link" onClick={() => setDialog({ kind: 'merge' })} disabled={busy}>
                    Birleştir
                  </Button>
                )}
                {open && (
                  <Button type="button" variant="outline" icon="users" onClick={() => setDialog({ kind: 'transfer' })} disabled={busy}>
                    Devret
                  </Button>
                )}
                {open && supervise && Number(check.totals.subtotal) > 0 && (
                  <Button type="button" variant="outline" icon="percent" onClick={() => setDialog({ kind: 'adjust', adjustKind: 'DISCOUNT', line: null })} disabled={busy}>
                    İndirim
                  </Button>
                )}
                {open && settleHere && hasLines && balance === 0 && waiting === 0 && (
                  <Button type="button" icon="checkCheck" onClick={() => run('close', { expectedUpdatedAt: check.updatedAt }, null)} disabled={busy}>
                    Kapat
                  </Button>
                )}
                {open && !hasLines && check.payments.length === 0 && (
                  <Button type="button" variant="dangerSoft" icon="trash" onClick={() => run('void', { expectedUpdatedAt: check.updatedAt }, 'Boş adisyon iptal edildi')} disabled={busy}>
                    Boş adisyonu iptal et
                  </Button>
                )}
                {check.status === 'CLOSED' && supervise && (
                  <Button type="button" variant="outline" icon="rotateCcw" onClick={() => setDialog({ kind: 'reopen' })} disabled={busy}>
                    Yeniden aç
                  </Button>
                )}
              </div>
            </Card>
          )}
          <PaymentsCard check={check} canVoid={operate && open} onVoid={(payment) => setDialog({ kind: 'void', payment })} />
          {check.adjustments.length > 0 && <AdjustmentsCard check={check} />}
        </div>
      </div>

      {dialog?.kind === 'pay' && (
        <PaymentDialog
          check={check}
          onClose={() => setDialog(null)}
          onDone={(result, change) => {
            const message = !result.created
              ? 'Bu ödeme zaten alınmıştı; ikinci kez alınmadı'
              : result.payment.status === 'PENDING'
                ? 'Tutar büyük ödeme eşiğinin üstünde: ödeme onaya gönderildi'
                : `Ödeme alındı${change && Number(change) > 0 ? ` · para üstü ${formatMoney(change, check.currency)}` : ''}`;
            finish(result.check, message);
          }}
        />
      )}
      {dialog?.kind === 'room' && <RoomChargeDialog check={check} onClose={() => setDialog(null)} onDone={(updated) => finish(updated, 'Odaya yazıldı; folyoya işleniyor')} />}
      {dialog?.kind === 'void' && <PaymentVoidDialog check={check} payment={dialog.payment} onClose={() => setDialog(null)} onDone={(updated) => finish(updated, 'İptal isteği onaya gönderildi')} />}
      {dialog?.kind === 'adjust' && (
        <AdjustmentDialog
          check={check}
          kind={dialog.adjustKind}
          line={dialog.line}
          threshold={terminal?.settings.adjustmentApprovalAmount ?? '0'}
          onClose={() => setDialog(null)}
          onDone={(updated) => finish(updated, updated.pending.adjustments > check.pending.adjustments ? 'Onaya gönderildi (dört göz)' : 'Uygulandı')}
        />
      )}
      {dialog?.kind === 'reopen' && <ReopenDialog check={check} onClose={() => setDialog(null)} onDone={(updated) => finish(updated, 'Adisyon yeniden açıldı')} />}
      {dialog?.kind === 'edit' && <EditCheckDialog check={check} onClose={() => setDialog(null)} onDone={(updated) => finish(updated, 'Kaydedildi')} />}
      {dialog?.kind === 'split' && (
        <SplitDialog
          check={check}
          onClose={() => setDialog(null)}
          onDone={({ source, target }) => {
            setDialog(null);
            replace(source);
            queryClient.setQueryData(posKeys.check(target.id), target);
            toastSuccess(`${target.number} açıldı`);
            navigate(checkPath(target.id));
          }}
        />
      )}
      {dialog?.kind === 'move' && terminal && <MoveDialog check={check} tables={terminal.tables} onClose={() => setDialog(null)} onDone={(updated) => finish(updated, 'Masa değişti')} />}
      {dialog?.kind === 'merge' && <MergeDialog check={check} onClose={() => setDialog(null)} onDone={(updated) => finish(updated, 'Adisyonlar birleştirildi')} />}
      {dialog?.kind === 'transfer' && <TransferDialog check={check} onClose={() => setDialog(null)} onDone={(updated) => finish(updated, `Adisyon ${updated.waiterEmail} garsona devredildi`)} />}
    </div>
  );
}

/**
 * Turlar ve kalemler: adet (ikram / iptal / onay bekleyen ayrı), birim fiyat, tutar, not;
 * şef garsona kalem başına ikram / iptal; her tura mutfak fişi.
 * @param {{ check: any, canSupervise: boolean, onAdjust: (kind: 'COMP' | 'VOID', line: any) => void }} props
 */
function LinesCard({ check, canSupervise, onAdjust }) {
  const rounds = groupByOrder(check.lines, check.orders);
  return (
    <Card title="Adisyon" description={rounds.length ? `${rounds.length} tur · ${check.lines.length} kalem` : undefined}>
      {rounds.length === 0 ? (
        <EmptyState icon="utensils" title="Henüz sipariş yok" description="Menüden ürün seçip “Gönder” ile ilk turu açın." />
      ) : (
        <div className="flex flex-col gap-4">
          {rounds.map((round) => (
            <section key={round.orderId} aria-label={`${round.seq}. tur`}>
              <div className="mb-1 flex items-center justify-between gap-2 border-b border-line pb-1">
                <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
                  {round.seq}. tur · {timeText(round.sentAt)}
                </h3>
                <Button type="button" size="sm" variant="ghost" icon="fileText" onClick={() => print(kitchenSlipHtml(check, round.orderId))}>
                  Mutfak fişi
                </Button>
              </div>
              <ul className="divide-y divide-line">
                {round.lines.map((line) => (
                  <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <span className="w-8 text-right font-bold tabular-nums">{line.quantity}×</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-ink">{line.name}</span>
                      <span className="ml-2 text-xs text-ink-muted">{POS_STATION_LABELS[line.station]}</span>
                      {line.note && <span className="block text-xs italic text-ink-soft">“{line.note}”</span>}
                      {(line.compedQuantity > 0 || line.voidedQuantity > 0 || line.pendingQuantity > 0) && (
                        <span className="block text-xs">
                          {line.compedQuantity > 0 && <span className="mr-2 text-success-ink">{line.compedQuantity} ikram</span>}
                          {line.voidedQuantity > 0 && <span className="mr-2 text-sec-strong">{line.voidedQuantity} iptal</span>}
                          {line.pendingQuantity > 0 && <span className="text-warning-ink">{line.pendingQuantity} onay bekliyor</span>}
                        </span>
                      )}
                    </span>
                    <span className="text-xs tabular-nums text-ink-muted">{formatMoney(line.unitPrice)}</span>
                    <span className="w-24 text-right font-bold tabular-nums">{formatMoney(line.total)}</span>
                    {canSupervise && line.freeQuantity > 0 && (
                      <span className="flex gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => onAdjust('COMP', line)}>
                          İkram
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => onAdjust('VOID', line)}>
                          İptal
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Toplam, vergi dökümü, alınan / odaya yazılan ve kalan. @param {{ check: any }} props */
function TotalsCard({ check }) {
  const { totals, currency } = check;
  const row = (label, value, tone = '') => (
    <div key={label} className={`flex justify-between gap-3 ${tone}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
  return (
    <Card>
      <dl className="flex flex-col gap-1 text-sm">
        {row('Ara toplam', formatMoney(totals.subtotal, currency))}
        {Number(totals.compTotal) > 0 && row('İkram (düşüldü)', formatMoney(totals.compTotal, currency), 'text-success-ink')}
        {Number(totals.voidTotal) > 0 && row('İptal (düşüldü)', formatMoney(totals.voidTotal, currency), 'text-ink-muted')}
        {Number(totals.discountTotal) > 0 && row(`İndirim${totals.discountPct ? ` %${totals.discountPct}` : ''}`, `−${formatMoney(totals.discountTotal, currency)}`, 'text-success-ink')}
        {totals.taxes.map((tax) => row(`${tax.name} %${tax.rate}${tax.included ? ' (dahil)' : ''}`, formatMoney(tax.amount, currency), 'text-ink-muted'))}
        <div className="mt-1 flex justify-between gap-3 border-t border-line pt-2 text-lg font-bold">
          <dt>Toplam</dt>
          <dd className="tabular-nums">{formatMoney(totals.grandTotal, currency)}</dd>
        </div>
        {Number(check.paidTotal) > 0 && row('Alınan', `−${formatMoney(check.paidTotal, currency)}`)}
        {Number(check.roomChargeTotal) > 0 && row('Odaya yazılan', `−${formatMoney(check.roomChargeTotal, currency)}`)}
        <div className={`flex justify-between gap-3 text-base font-bold ${Number(check.balance) > 0 ? 'text-warning-ink' : 'text-success-ink'}`}>
          <dt>Kalan</dt>
          <dd className="tabular-nums">{formatMoney(check.balance, currency)}</dd>
        </div>
      </dl>
    </Card>
  );
}

/** Ödemeler ve odaya yazılanlar. @param {{ check: any, canVoid: boolean, onVoid: (payment: any) => void }} props */
function PaymentsCard({ check, canVoid, onVoid }) {
  if (check.payments.length === 0 && check.roomCharges.length === 0) return null;
  return (
    <Card title="Ödemeler">
      <ul className="divide-y divide-line text-sm">
        {check.payments.map((payment) => {
          const voidable = canVoid && payment.kind === 'PAYMENT' && payment.status === 'POSTED' && !payment.voided && !payment.voidPending;
          return (
            <li key={payment.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${payment.voided || payment.status === 'DECLINED' ? 'text-ink-muted' : ''}`}>
              <Icon name={PAYMENT_METHOD_ICONS[payment.method]} className="size-4 text-ink-muted" />
              <span className="font-semibold">
                {PAYMENT_KIND_LABELS[payment.kind]} · {methodLabel(payment.method)}
              </span>
              <span className={`tabular-nums font-bold ${payment.voided ? 'line-through' : ''}`}>{formatMoney(payment.amount, check.currency)}</span>
              <Badge tone={payment.status === 'POSTED' ? 'success' : payment.status === 'PENDING' ? 'violet' : 'neutral'}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge>
              {payment.voidPending && <span className="text-xs text-warning-ink">iptal onay bekliyor</span>}
              {payment.voided && <span className="text-xs">iptal: {payment.voidReason}</span>}
              <span className="text-xs text-ink-muted">
                {timeText(payment.receivedAt)} · {payment.receivedBy}
                {payment.reference ? ` · ${payment.reference}` : ''}
              </span>
              {voidable && (
                <Button type="button" size="sm" variant="ghost" icon="close" className="ml-auto" onClick={() => onVoid(payment)}>
                  Hatalı giriş
                </Button>
              )}
            </li>
          );
        })}
        {check.roomCharges.map((charge) => (
          <li key={charge.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <Icon name="bed" className="size-4 text-ink-muted" />
            <span className="font-semibold">
              Oda {charge.roomNumber} · {charge.guestName}
            </span>
            <span className="font-bold tabular-nums">{formatMoney(charge.amount, check.currency)}</span>
            <Badge tone={POSTING_TONES[charge.posting.status]}>{POSTING_LABELS[charge.posting.status]}</Badge>
            <span className="text-xs text-ink-muted">
              {timeText(charge.chargedAt)} · {charge.chargedBy}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** İkram / iptal / indirim geçmişi. @param {{ check: any }} props */
function AdjustmentsCard({ check }) {
  const names = new Map(check.lines.map((line) => [line.id, line.name]));
  return (
    <Card title="Düzeltmeler" description="İkram, iptal ve indirim kayıtları; eşik üstü olanlar dört göz onaylı.">
      <ul className="divide-y divide-line text-sm">
        {check.adjustments.map((entry) => (
          <li key={entry.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${entry.superseded || entry.status === 'DECLINED' ? 'text-ink-muted' : ''}`}>
            <span className="font-semibold">
              {entry.kindLabel}
              {entry.lineId ? ` · ${entry.quantity} × ${names.get(entry.lineId) ?? 'taşınan kalem'}` : entry.discountPct ? ` %${entry.discountPct}` : ''}
              {entry.waste ? ' (zayi)' : ''}
            </span>
            <span className="tabular-nums">{formatMoney(entry.value, check.currency)}</span>
            <Badge tone={ADJUSTMENT_STATUS_TONES[entry.status]}>{POS_ADJUSTMENT_STATUS_LABELS[entry.status]}</Badge>
            {entry.superseded && <span className="text-xs">yerine yenisi geldi</span>}
            <span className="block w-full text-xs text-ink-muted">
              {entry.reason} · {entry.requestedBy} · {timeText(entry.requestedAt)}
              {entry.decidedBy ? ` · karar ${entry.decidedBy}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
