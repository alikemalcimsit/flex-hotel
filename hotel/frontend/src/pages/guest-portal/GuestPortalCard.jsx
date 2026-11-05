import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ONLINE_CHECKIN_STATUS_LABELS, ONLINE_CHECKIN_STATUS_TONES } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { api, apiDelete, apiPost } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { guestPortalKeys, useGuestPortalLive } from '../../lib/guestPortal.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { qrSvg } from '../../lib/qr.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { OnlineCheckinDialog } from './OnlineCheckinDialog.jsx';

/**
 * Rezervasyonun misafir portalı (modül 53): bağlantı (kopyala, QR, yenile, iptal), davet ve online check-in'in
 * durumu. Rezervasyon ayrıntısında görünür (`guest_portal.view`).
 *
 * @param {{ reservationId: string }} props
 */
export function GuestPortalCard({ reservationId }) {
  useGuestPortalLive();
  const queryClient = useQueryClient();
  const can = useCan();
  const canManage = can(PERMISSIONS.GUEST_PORTAL_MANAGE);
  const [showQr, setShowQr] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const link = useQuery({ queryKey: guestPortalKeys.link(reservationId), queryFn: () => api(`/guest-portal/links/${reservationId}`) });
  const online = useQuery({ queryKey: guestPortalKeys.byReservation(reservationId), queryFn: () => api(`/guest-portal/online-checkins/by-reservation/${reservationId}`) });
  const data = link.data;
  const url = data?.link ? (data.link.url ?? `${window.location.origin}${data.link.path}`) : null;
  const qr = useMemo(() => (url && showQr ? qrSvg(url, { title: 'Misafir portalı bağlantısı' }) : ''), [url, showQr]);
  const refresh = (next) => {
    queryClient.setQueryData(guestPortalKeys.link(reservationId), next);
    queryClient.invalidateQueries({ queryKey: guestPortalKeys.link(reservationId) });
  };
  const action = useMutation({
    mutationFn: (kind) =>
      kind === 'revoke' ? apiDelete(`/guest-portal/links/${reservationId}`) : apiPost(kind === 'invite' ? `/guest-portal/links/${reservationId}/invite` : `/guest-portal/links/${reservationId}`, {}),
    onSuccess: (next, kind) => {
      refresh(next);
      setConfirm(null);
      if (kind === 'invite') {
        const { queued, skipped } = next.result;
        if (queued > 0) toastSuccess(`Davet ${queued} kanaldan sıraya alındı${skipped ? ` (${skipped})` : ''}`);
        else toastError(`Davet gönderilemedi: ${skipped ?? 'açık kanal yok'}`);
      } else toastSuccess(kind === 'revoke' ? 'Bağlantı iptal edildi' : 'Yeni bağlantı verildi');
    },
    onError: (error) => toastError(error.message),
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess('Bağlantı kopyalandı');
    } catch {
      toastError('Kopyalanamadı; bağlantıyı elle seçin');
    }
  };

  if (link.isPending) return <Card title="Misafir portalı"><Spinner label="Yükleniyor…" className="py-6" /></Card>;
  if (link.isError) {
    return (
      <Card title="Misafir portalı">
        <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => link.refetch()}>Tekrar dene</Button>}>
          {link.error.message}
        </Alert>
      </Card>
    );
  }
  const checkin = online.data?.onlineCheckin ?? null;

  return (
    <Card
      title="Misafir portalı"
      description="Online check-in, folyo, istek ve oda servisi; misafire özel bağlantıyla."
      actions={checkin ? <Badge tone={ONLINE_CHECKIN_STATUS_TONES[checkin.status]}>{ONLINE_CHECKIN_STATUS_LABELS[checkin.status]}</Badge> : null}
    >
      <div className="flex flex-col gap-3 text-sm">
        {!data.enabled && <Alert tone="info">Misafir portalı ayarlarda kapalı.</Alert>}
        {data.enabled && !data.open && <p className="text-ink-muted">{data.closedReason}.</p>}
        {data.enabled && data.open && (
          <>
            {data.link ? (
              <div className="flex flex-col gap-2">
                <code className="break-all rounded-item bg-surface-muted px-3 py-2 text-xs">{url}</code>
                <p className="text-xs text-ink-muted">
                  Verildi {formatDateTime(data.link.createdAt)} · {data.link.createdBy}
                  {data.link.invitedAt ? ` · davet ${formatDateTime(data.link.invitedAt)}` : ' · davet gönderilmedi'}
                  {data.link.lastUsedAt ? ` · son açılış ${formatDateTime(data.link.lastUsedAt)}` : ''}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" icon="clipboard" onClick={copy}>
                    Kopyala
                  </Button>
                  <Button type="button" size="sm" variant="outline" icon="maximize" onClick={() => setShowQr((value) => !value)}>
                    {showQr ? 'QR\'ı gizle' : 'QR'}
                  </Button>
                  {canManage && (
                    <>
                      <Button type="button" size="sm" icon="send" onClick={() => action.mutate('invite')} disabled={action.isPending || !data.hasContact}>
                        Davet gönder
                      </Button>
                      <Button type="button" size="sm" variant="ghost" icon="refresh" onClick={() => setConfirm('renew')} disabled={action.isPending}>
                        Yenile
                      </Button>
                      <Button type="button" size="sm" variant="ghost" icon="close" onClick={() => setConfirm('revoke')} disabled={action.isPending}>
                        İptal et
                      </Button>
                    </>
                  )}
                </div>
                {!data.hasContact && canManage && <p className="text-xs text-warning-ink">Misafir kartında e-posta ya da telefon yok; bağlantıyı kopyalayıp iletin.</p>}
                {showQr && <div className="size-48 rounded-item border border-line bg-white p-1" dangerouslySetInnerHTML={{ __html: qr }} />}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink-muted">Bu rezervasyona henüz bağlantı verilmedi (davet zamanı gelince kendiliğinden verilir).</span>
                {canManage && (
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" icon="link" onClick={() => action.mutate('issue')} disabled={action.isPending}>
                      Bağlantı ver
                    </Button>
                    <Button type="button" size="sm" icon="send" onClick={() => action.mutate('invite')} disabled={action.isPending || !data.hasContact}>
                      Davet gönder
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {checkin && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <span>
              Online check-in: {checkin.people} kişi, {checkin.photoCount} belge fotoğrafı · {formatDateTime(checkin.submittedAt)}
            </span>
            <Button type="button" size="sm" variant={checkin.status === 'SUBMITTED' ? 'primary' : 'outline'} icon="eye" onClick={() => setReviewing(true)}>
              {checkin.status === 'SUBMITTED' ? 'İncele' : 'Gör'}
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm === 'revoke' ? 'Bağlantıyı iptal et' : 'Yeni bağlantı ver'}
        message={confirm === 'revoke' ? 'Misafirin elindeki bağlantı ve davet artık açılmaz.' : 'Eski bağlantı ve davet artık açılmaz; misafire yenisini iletin.'}
        confirmLabel={confirm === 'revoke' ? 'İptal et' : 'Yenile'}
        isPending={action.isPending}
        onConfirm={() => action.mutate(confirm === 'revoke' ? 'revoke' : 'issue')}
        onClose={() => setConfirm(null)}
      />
      {reviewing && checkin && <OnlineCheckinDialog onlineCheckinId={checkin.id} onClose={() => setReviewing(false)} />}
    </Card>
  );
}
