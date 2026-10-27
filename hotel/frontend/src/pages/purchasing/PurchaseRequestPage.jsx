import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_REQUEST_REASON_LENGTH, PURCHASE_REQUEST_SOURCE_LABELS, PURCHASE_REQUEST_STATUS_LABELS, STOCK_ITEM_GROUP_LABELS, cancelPurchaseRequestSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost } from '../../lib/api.js';
import { banquetKeys, dayText, eventPath } from '../../lib/banquet.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { purchasingKeys, usePurchasingLive } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { printDocument, purchaseRequestHtml } from '../../lib/kitchenPrint.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { REQUEST_STATUS_TONES } from './PurchaseRequestsPage.jsx';

/**
 * Satın alma talebi ekranı: malzeme başına toplam miktar, talep anındaki tahmini birim maliyet ve
 * tutar, etkinlik dökümü (hangi etkinliğin hangi gün ihtiyacı). Açık talep gerekçeyle iptal edilir
 * (`purchasing.request`); A4 çıktı.
 */
export function PurchaseRequestPage() {
  const { requestId } = useParams();
  const can = useCan();
  const queryClient = useQueryClient();
  const { data: hotel } = useHotelContext();
  usePurchasingLive();
  const [cancelling, setCancelling] = useState(false);
  const query = useQuery({ queryKey: purchasingKeys.detail(requestId), queryFn: () => api(`/purchasing/requests/${requestId}`) });

  const cancel = useMutation({
    mutationFn: (body) => apiPost(`/purchasing/requests/${requestId}/cancel`, body),
    onSuccess: (result) => {
      queryClient.setQueryData(purchasingKeys.detail(requestId), result);
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      setCancelling(false);
      toastSuccess(`${result.number} iptal edildi; eksikler banket ihtiyacına geri döndü`);
    },
    onError: (error) => {
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: purchasingKeys.detail(requestId) });
      toastError(error.code === 'STALE_WRITE' ? 'Talep bu arada değişti; ekran yenilendi.' : error.message);
    },
  });

  const back = (
    <Link to="/satin-alma/talepler" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
      <Icon name="arrowLeft" className="size-4" /> Talepler
    </Link>
  );
  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <QueryFallback query={query} errorTitle="Talep yüklenemedi" />
      </div>
    );
  }
  const request = query.data;
  const currency = hotel?.currency;

  function print() {
    if (!printDocument(purchaseRequestHtml(request, { hotelName: hotel?.name ?? '' }))) toastError('Yazdırma penceresi açılamadı; tarayıcının açılır pencere iznini verin.');
  }

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader
        title={request.number}
        description={`${PURCHASE_REQUEST_SOURCE_LABELS[request.source]} · ${request.requestedBy} · ${formatDate(request.createdAt)} · ihtiyaç ${dayText(request.neededBy)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={REQUEST_STATUS_TONES[request.status]}>{PURCHASE_REQUEST_STATUS_LABELS[request.status]}</Badge>
            <Button type="button" variant="outline" icon="fileText" onClick={print}>
              Yazdır
            </Button>
            {can(PERMISSIONS.PURCHASING_REQUEST) && request.status === 'OPEN' && (
              <Button type="button" variant="dangerSoft" icon="close" onClick={() => setCancelling(true)}>
                İptal et
              </Button>
            )}
          </div>
        }
      />
      {request.status === 'CANCELLED' && (
        <Alert tone="info" title="Talep iptal edildi">
          {request.cancelledBy} · {formatDate(request.cancelledAt)} · {request.cancelReason}
        </Alert>
      )}
      {request.note && <Alert tone="info">Not: {request.note}</Alert>}
      <Card title={`${request.items.length} malzeme · ${request.events} etkinlik`} description="Birim maliyet talep anındaki malzeme kartından (KDV hariç); teklif ve sipariş satın alma modülünde.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2 pr-2">Malzeme</th>
                <th className="py-2 pr-2 text-right">Miktar</th>
                <th className="py-2 pr-2 text-right">Tahmini birim</th>
                <th className="py-2 pr-2 text-right">Tahmini tutar</th>
                <th className="py-2 pr-2">İhtiyaç</th>
                <th className="py-2">Etkinlik dökümü</th>
              </tr>
            </thead>
            <tbody>
              {request.items.map((item) => (
                <tr key={item.stockItemId} className="border-b border-line align-top last:border-0">
                  <td className="py-2 pr-2">
                    <span className="block font-semibold text-ink">{item.name}</span>
                    <span className="block text-xs text-ink-muted">{[item.code, STOCK_ITEM_GROUP_LABELS[item.group]].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="py-2 pr-2 text-right font-semibold tabular-nums">{quantityText(item.quantity, item.unit)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(item.unitCost, currency)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(item.cost, currency)}</td>
                  <td className="py-2 pr-2">{dayText(item.neededBy)}</td>
                  <td className="py-2 text-xs">
                    <ul className="flex flex-col gap-0.5">
                      {item.events.map((entry) => (
                        <li key={`${entry.eventId}-${entry.neededBy}`}>
                          {entry.eventId ? (
                            <Link to={eventPath(entry.eventId, 'menu')} className="font-semibold text-ink hover:underline">
                              {entry.code}
                            </Link>
                          ) : (
                            '—'
                          )}{' '}
                          {entry.name} · {quantityText(entry.quantity, item.unit)} · {dayText(entry.neededBy)}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-right text-sm">
          Tahmini toplam <strong className="tabular-nums">{formatMoney(request.estimatedTotal, currency)}</strong>
        </p>
      </Card>
      {cancelling && <CancelDialog busy={cancel.isPending} onConfirm={(reason) => cancel.mutate({ expectedUpdatedAt: request.updatedAt, reason })} onClose={() => setCancelling(false)} />}
    </div>
  );
}

/** @param {{ busy: boolean, onConfirm: (reason: string) => void, onClose: () => void }} props */
function CancelDialog({ busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(cancelPurchaseRequestSchema, { expectedUpdatedAt: new Date().toISOString(), reason });
    if (!checked.ok) return setError(checked.errors.reason ?? 'Gerekçe geçersiz');
    setError(null);
    onConfirm(reason.trim());
  }
  return (
    <Modal
      open
      size="sm"
      title="Talebi iptal et"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="request-cancel-form" variant="danger" icon="close" disabled={busy}>
            {busy ? 'İptal ediliyor…' : 'İptal et'}
          </Button>
        </>
      }
    >
      <form id="request-cancel-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">İptal edilen talebin miktarları banket ihtiyacında yeniden "eksik" görünür.</p>
        <Textarea label="Gerekçe" name="request-cancel-reason" rows={3} maxLength={MAX_REQUEST_REASON_LENGTH} value={reason} onChange={(event) => setReason(event.target.value)} error={error ?? undefined} required disabled={busy} />
      </form>
    </Modal>
  );
}
