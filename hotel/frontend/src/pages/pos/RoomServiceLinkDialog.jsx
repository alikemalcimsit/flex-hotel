import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiDelete, apiPost } from '../../lib/api.js';
import { escapeHtml, printHtml } from '../../lib/posPrint.js';
import { qrSvg } from '../../lib/qr.js';
import { rsKeys } from '../../lib/roomService.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Misafirin oda servisi bağlantısı (modül 41): konaklamaya ve odaya bağlı, imzalı adres; QR kodu (SVG) ve basılı oda
 * kartıyla girişte verilir (misafir sayfası modül 53). Yenilemek eskisini geçersiz kılar, iptal kapatır. Oda
 * değişince ya da çıkışta kendiliğinden geçersizdir. Misafir siparişi politikada kapalıysa bağlantı menüyü gösterir
 * ama sipariş almaz.
 *
 * @param {{ reservationId: string, onClose: () => void }} props
 */
export function RoomServiceLinkDialog({ reservationId, onClose }) {
  const queryClient = useQueryClient();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const query = useQuery({ queryKey: rsKeys.link(reservationId), queryFn: () => api(`/pos/room-service/links/${reservationId}`) });
  const hotel = useHotelContext();
  const done = (message) => (data) => {
    queryClient.setQueryData(rsKeys.link(reservationId), data);
    setConfirmRevoke(false);
    toastSuccess(message);
  };
  const issue = useMutation({ mutationFn: () => apiPost(`/pos/room-service/links/${reservationId}`, {}), onSuccess: done('Bağlantı hazır; eski bağlantı artık çalışmaz'), onError: (error) => toastError(error.message) });
  const revoke = useMutation({ mutationFn: () => apiDelete(`/pos/room-service/links/${reservationId}`), onSuccess: done('Bağlantı iptal edildi'), onError: (error) => toastError(error.message) });
  const busy = issue.isPending || revoke.isPending;
  const data = query.data;
  const link = data?.link ?? null;
  const url = link ? `${window.location.origin}${link.path}` : '';
  // Kitaplığın ürettiği SVG (metin bizim bağlantımız, başlık kaçışlanmış): ekranda ve basılı kartta aynı kod.
  const qr = useMemo(() => (url ? qrSvg(url, { title: `Oda ${data?.roomNumber ?? ''} oda servisi bağlantısı` }) : ''), [url, data?.roomNumber]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess('Bağlantı kopyalandı');
    } catch {
      toastError('Kopyalanamadı; bağlantıyı seçip elle kopyalayın.');
    }
  };
  const printCard = () => {
    const html =
      '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Oda servisi</title>' +
      '<style>body{font-family:system-ui,sans-serif;width:90mm;margin:8mm auto;text-align:center;color:#000}h1{font-size:18px;margin:0 0 2mm}h2{font-size:14px;font-weight:600;margin:0 0 4mm}.qr{width:55mm;height:55mm;margin:0 auto 4mm}.qr svg{width:100%;height:100%}p{font-size:11px;margin:0 0 2mm}.url{word-break:break-all;color:#444;font-size:9px}</style></head><body>' +
      `<h1>${escapeHtml(hotel.data?.name ?? '')}</h1><h2>Oda ${escapeHtml(data.roomNumber ?? '')} · Oda servisi</h2>` +
      `<div class="qr">${qr}</div>` +
      '<p>Menüyü görmek ve sipariş vermek için telefonunuzun kamerasıyla okutun.</p>' +
      '<p>Bağlantı yalnızca bu odada konakladığınız sürece geçerlidir.</p>' +
      `<p class="url">${escapeHtml(url)}</p></body></html>`;
    if (!printHtml(html)) toastError('Yazdırma penceresi açılamadı; tarayıcının açılır pencere iznini verin.');
  };

  return (
    <Modal
      open
      size="md"
      title={`Oda servisi bağlantısı${data?.roomNumber ? ` · oda ${data.roomNumber}` : ''}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Kapat
        </Button>
      }
    >
      {query.isPending && <Spinner label="Bağlantı okunuyor…" className="py-6" />}
      {query.isError && (
        <Alert tone="danger" title="Bağlantı okunamadı" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => query.refetch()}>Tekrar dene</Button>}>
          {query.error.message}
        </Alert>
      )}
      {data && (
        <div className="flex flex-col gap-4">
          {!data.guestOrderingEnabled && <Alert tone="warning" title="Misafir siparişi politikada kapalı">Bağlantı menüyü gösterir ama sipariş almaz (Menü ve tanımlar → politika).</Alert>}
          {!data.stayActive && <Alert tone="info" title="Konaklama içeride değil">Bağlantı yalnızca içerideki misafire verilir.</Alert>}
          {link ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={link.valid ? 'success' : 'danger'}>{link.valid ? 'Geçerli' : 'Geçersiz'}</Badge>
                {link.invalidReason && <span className="text-sm text-danger-ink">{link.invalidReason}</span>}
                <span className="text-xs text-ink-muted">
                  {link.createdBy} verdi{link.lastUsedAt ? ' · misafir açtı' : ' · henüz açılmadı'}
                </span>
              </div>
              {link.valid && <div className="mx-auto size-48 rounded-item border border-line bg-white p-1" dangerouslySetInnerHTML={{ __html: qr }} />}
              <input readOnly value={url} aria-label="Misafirin bağlantısı" className="w-full rounded-control border border-line bg-surface-muted px-3 py-2 font-mono text-xs" onFocus={(event) => event.target.select()} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" icon="link" onClick={copy} disabled={busy || !link.valid}>
                  Kopyala
                </Button>
                <Button type="button" variant="outline" icon="fileText" onClick={printCard} disabled={busy || !link.valid}>
                  Oda kartı yazdır
                </Button>
                {data.stayActive && (
                  <Button type="button" variant="outline" icon="refresh" onClick={() => issue.mutate()} disabled={busy}>
                    {issue.isPending ? 'Yenileniyor…' : 'Yenile'}
                  </Button>
                )}
                {confirmRevoke ? (
                  <Button type="button" variant="danger" icon="close" onClick={() => revoke.mutate()} disabled={busy}>
                    {revoke.isPending ? 'İptal ediliyor…' : 'Evet, iptal et'}
                  </Button>
                ) : (
                  <Button type="button" variant="dangerSoft" icon="close" onClick={() => setConfirmRevoke(true)} disabled={busy}>
                    İptal et
                  </Button>
                )}
              </div>
              <p className="text-xs text-ink-muted">Yenilemek ya da iptal etmek eski bağlantıyı (basılı QR dahil) hemen geçersiz kılar.</p>
            </>
          ) : (
            data.stayActive && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-ink-soft">Bu konaklamanın bağlantısı yok.</p>
                <Button type="button" icon="link" onClick={() => issue.mutate()} disabled={busy}>
                  {issue.isPending ? 'Hazırlanıyor…' : 'Bağlantı ver'}
                </Button>
              </div>
            )
          )}
        </div>
      )}
    </Modal>
  );
}
