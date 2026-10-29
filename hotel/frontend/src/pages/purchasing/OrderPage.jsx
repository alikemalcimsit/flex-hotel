import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, PURCHASE_ORDER_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiBlob, apiPost } from '../../lib/api.js';
import { dayText } from '../../lib/banquet.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { purchasingKeys, usePurchasingLive } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { ORDER_STATUS_TONES } from '../../lib/purchasingFormat.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ReasonDialog } from './ReasonDialog.jsx';
import { ReceiveDialog } from './ReceiveDialog.jsx';

/** PDF bağlantısı bu kadar sonra bırakılır (sekme açılmış olur). */
const PDF_URL_TTL_MS = 60_000;

/**
 * Satın alma siparişi (modül 45): tedarikçi, beklenen teslim, vade, onay durumu, satırlar (sipariş /
 * alınan / kalan, seçim gerekçesi), mal kabuller. Eylemler: PDF, mal kabul (`purchasing.receive`),
 * iptal (onaylı, teslim alınmamış) ve eksik kapatma (kısmen teslim) — `purchasing.manage`.
 */
export function OrderPage() {
  const { orderId } = useParams();
  const can = useCan();
  const queryClient = useQueryClient();
  usePurchasingLive();
  const [receiving, setReceiving] = useState(false);
  const [action, setAction] = useState(null);
  const [opening, setOpening] = useState(false);
  const query = useQuery({ queryKey: purchasingKeys.order(orderId), queryFn: () => api(`/purchasing/orders/${orderId}`) });
  const order = query.data;

  const act = useMutation({
    mutationFn: ({ kind, reason }) => apiPost(`/purchasing/orders/${orderId}/${kind}`, { expectedUpdatedAt: order.updatedAt, reason }),
    onSuccess: (result, { kind }) => {
      queryClient.setQueryData(purchasingKeys.order(orderId), result);
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
      setAction(null);
      toastSuccess(kind === 'cancel' ? `${result.number} iptal edildi; satırlar teklif turuna döndü` : `${result.number} eksik kapatıldı`);
    },
    onError: (error) => {
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: purchasingKeys.order(orderId) });
      toastError(error.code === 'STALE_WRITE' ? 'Sipariş bu arada değişti; ekran yenilendi.' : error.message);
    },
  });

  async function openPdf() {
    setOpening(true);
    // Sekme tıklamayla açılır (açılır pencere engeline takılmasın); PDF gelince adresi verilir.
    const tab = window.open('', '_blank');
    try {
      const blob = await apiBlob(`/purchasing/orders/${orderId}/pdf`);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else {
        const link = window.document.createElement('a');
        link.href = url;
        link.download = `${order.number}.pdf`;
        link.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), PDF_URL_TTL_MS);
    } catch (error) {
      tab?.close();
      toastError(error.message);
    } finally {
      setOpening(false);
    }
  }

  const back = (
    <Link to="/satin-alma/siparisler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
      <Icon name="arrowLeft" className="size-4" /> Siparişler
    </Link>
  );
  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <QueryFallback query={query} errorTitle="Sipariş yüklenemedi" />
      </div>
    );
  }

  const currency = order.currency;
  const canManage = can(PERMISSIONS.PURCHASING_MANAGE);
  const canReceive = can(PERMISSIONS.PURCHASING_RECEIVE) && order.receivable;
  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader
        title={`${order.number} · ${order.supplierName}`}
        description={`${order.createdBy} · ${formatDate(order.createdAt)}${order.round ? ` · tur ${order.round.number}` : ''} · beklenen teslim ${dayText(order.expectedOn)} · vade teslimden ${order.paymentTermDays} gün`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ORDER_STATUS_TONES[order.status]}>{PURCHASE_ORDER_STATUS_LABELS[order.status]}</Badge>
            {order.late && <Badge tone="danger">gecikti</Badge>}
            <Button type="button" variant="outline" icon="fileText" onClick={openPdf} disabled={opening}>
              {opening ? 'Açılıyor…' : 'PDF'}
            </Button>
            {canReceive && (
              <Button type="button" icon="package" onClick={() => setReceiving(true)}>
                Mal kabul
              </Button>
            )}
            {canManage && order.status === 'APPROVED' && (
              <Button type="button" variant="dangerSoft" icon="close" onClick={() => setAction('cancel')}>
                İptal et
              </Button>
            )}
            {canManage && order.status === 'PARTIALLY_RECEIVED' && (
              <Button type="button" variant="outline" icon="checkCheck" onClick={() => setAction('close')}>
                Eksik kapat
              </Button>
            )}
          </div>
        }
      />

      {order.status === 'PENDING_APPROVAL' && (
        <Alert tone="warning" title="Onay bekliyor">
          KDV dahil tutar onay eşiğinde ya da üstünde; başka bir yetkili Onaylar ekranından karar verir. Onaylanmadan tedarikçiye gönderilmez, mal kabul yapılmaz.
          {order.approval?.expiresAt && ` Son karar: ${formatDate(order.approval.expiresAt)} (karar verilmezse reddedilmiş sayılır).`}
        </Alert>
      )}
      {order.status === 'REJECTED' && (
        <Alert tone="danger" title={order.approval?.status === 'EXPIRED' ? 'Onay süresi doldu' : 'Onay reddedildi'}>
          {order.approval?.decidedBy ? `${order.approval.decidedBy} · ${formatDate(order.approval.decidedAt)} · ` : ''}
          {order.approval?.note ?? ''} Satırlar teklif turuna döndü; yeniden kazanan seçilebilir.
        </Alert>
      )}
      {order.status === 'CANCELLED' && (
        <Alert tone="info" title="Sipariş iptal edildi">
          {order.cancelledBy} · {formatDate(order.cancelledAt)} · {order.cancelReason}
        </Alert>
      )}
      {order.status === 'CLOSED' && (
        <Alert tone="info" title="Eksik kapatıldı">
          {order.closedBy} · {formatDate(order.closedAt)} · {order.closeReason}
        </Alert>
      )}
      {order.approval && order.approval.status === 'GRANTED' && (
        <p className="text-sm text-ink-soft">
          Onaylayan: <strong>{order.approvedBy}</strong> · {formatDate(order.approvedAt)}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Tedarikçi" className="lg:col-span-1">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {[
              ['Unvan', order.supplier.name],
              ['Yetkili', order.supplier.contactName],
              ['Telefon', order.supplier.phone],
              ['E-posta', order.supplier.email],
              ['Vergi', [order.supplier.taxOffice, order.supplier.taxNumber].filter(Boolean).join(' / ')],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="text-ink">{value}</dd>
                </div>
              ))}
          </dl>
        </Card>
        <Card title="Tutar" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink-muted">KDV hariç</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatMoney(order.netTotal, currency)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">KDV</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatMoney(order.taxTotal, currency)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Genel toplam</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatMoney(order.grandTotal, currency)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Teslim alınan</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatMoney(order.receivedTotal, currency)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card title={`${order.lines.length} kalem`} description="Birim fiyat KDV hariç, stok biriminde.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2 pr-2">Malzeme</th>
                <th className="py-2 pr-2 text-right">Sipariş</th>
                <th className="py-2 pr-2 text-right">Alınan</th>
                <th className="py-2 pr-2 text-right">Kalan</th>
                <th className="py-2 pr-2 text-right">Birim fiyat</th>
                <th className="py-2 pr-2 text-right">KDV</th>
                <th className="py-2 text-right">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.id} className="border-b border-line align-top last:border-0">
                  <td className="py-2 pr-2">
                    <span className="block font-semibold text-ink">{line.name}</span>
                    <span className="block text-xs text-ink-muted">{[line.code, line.neededBy ? `ihtiyaç ${dayText(line.neededBy)}` : null].filter(Boolean).join(' · ')}</span>
                    {line.awardReason && <span className="block text-xs italic text-ink-soft">En uygun dışı seçim: {line.awardReason}</span>}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{quantityText(line.quantity, line.unit)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{quantityText(line.receivedQuantity, line.unit)}</td>
                  <td className={`py-2 pr-2 text-right tabular-nums ${line.remaining !== '0' ? 'font-semibold text-warning-ink' : 'text-ink-muted'}`}>{quantityText(line.remaining, line.unit)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatMoney(line.unitPrice, currency)}/{KITCHEN_UNIT_LABELS[line.unit]}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">%{line.taxRatePct}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(line.total, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Mal kabuller" description="Her irsaliye stok girişi ve tedarikçi borcudur (vade = kabul günü + tedarikçi vadesi).">
        {order.receiptList.length === 0 ? (
          <p className="text-sm text-ink-muted">Henüz mal kabul yok.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {order.receiptList.map((receipt) => (
              <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link to={`/satin-alma/mal-kabul/${receipt.id}`} className="font-mono font-semibold text-ink hover:underline">
                    {receipt.number}
                  </Link>{' '}
                  <span className="text-ink-muted">
                    · irsaliye {receipt.waybillNumber} · {dayText(receipt.receivedOn)} · {receipt.warehouseName} · {receipt.receivedBy}
                  </span>
                  {receipt.closedShort && (
                    <Badge tone="neutral" className="ml-1.5">
                      eksik kapattı
                    </Badge>
                  )}
                </span>
                <span className="font-semibold tabular-nums">{formatMoney(receipt.grandTotal, currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {receiving && <ReceiveDialog order={order} onClose={() => setReceiving(false)} />}
      {action === 'cancel' && (
        <ReasonDialog
          title="Siparişi iptal et"
          message="Hiç teslim alınmamış onaylı sipariş iptal edilir; satırları teklif turuna döner (yeniden kazanan seçilebilir). Tedarikçiye iptali ayrıca bildirin."
          confirmLabel="İptal et"
          busy={act.isPending}
          onConfirm={(reason) => act.mutate({ kind: 'cancel', reason })}
          onClose={() => setAction(null)}
        />
      )}
      {action === 'close' && (
        <ReasonDialog
          title="Siparişi eksik kapat"
          message="Kalan miktar gelmeyecek: sipariş kapanır, stok ve borç yalnız gelen kadar kalır."
          confirmLabel="Eksik kapat"
          confirmVariant="primary"
          confirmIcon="checkCheck"
          busy={act.isPending}
          onConfirm={(reason) => act.mutate({ kind: 'close', reason })}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}
