import { useState } from 'react';
import { Link, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PROMOTION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Icon } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { apiPost } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { AVAILABILITY_LABELS, AVAILABILITY_TONES, PROMOTION_STATUS_TONES, promotionKeys, usePromotion, usePromotionLive } from '../../lib/promotions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { usePromotionContext } from './usePromotionContext.js';

const STALE_TEXT = 'Promosyon bu arada başkası tarafından değiştirildi; ekran yenilendi, tekrar deneyin.';

/**
 * Promosyon sayfasının kabuğu (modül 31): başlık, durum eylemleri (yayına al,
 * durdur, sil), yayına almayı engelleyen eksikler ve sekmeler (kurallar,
 * kuponlar, kullanım). Promosyon bir kez yüklenir, sekmelere bağlam olarak
 * verilir; canlı kanal kartı ve kullanımı tazeler.
 */
export function PromotionPage() {
  const { promotionId } = useParams();
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = usePromotion(promotionId);
  const { currency } = usePromotionContext();
  usePromotionLive({ withUsage: true });
  const [confirm, setConfirm] = useState(null);

  const action = useMutation({
    mutationFn: ({ kind, promotion }) =>
      kind === 'delete'
        ? apiPost(`/promotions/${promotion.id}/delete`, { expectedUpdatedAt: promotion.updatedAt })
        : apiPost(`/promotions/${promotion.id}/status`, { expectedUpdatedAt: promotion.updatedAt, status: kind === 'pause' ? 'PAUSED' : 'ACTIVE' }),
    onSuccess: (result, { kind }) => {
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: promotionKeys.all });
      if (kind === 'delete') {
        toastSuccess('Promosyon silindi');
        navigate('/promosyonlar');
        return;
      }
      toastSuccess(kind === 'pause' ? 'Promosyon durduruldu; yeni satışa uygulanmaz' : 'Promosyon yayında');
      queryClient.setQueryData(promotionKeys.detail(result.id), result);
    },
    onError: (error) => {
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: promotionKeys.all });
    },
  });

  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <QueryFallback query={query} errorTitle="Promosyon yüklenemedi" />
      </div>
    );
  }

  const promotion = query.data;
  const canManage = can(PERMISSIONS.PROMOTIONS_MANAGE);
  const base = `/promosyonlar/${promotion.id}`;
  const busy = action.isPending;
  const run = (kind) => action.mutate({ kind, promotion });

  const actions = canManage && (
    <div className="flex flex-wrap gap-2">
      {promotion.status === 'ACTIVE' ? (
        <Button variant="outline" icon="clock" onClick={() => setConfirm('pause')} disabled={busy}>
          Durdur
        </Button>
      ) : (
        <Button icon="send" onClick={() => run('activate')} disabled={busy || promotion.blockers.length > 0}>
          {promotion.status === 'DRAFT' ? 'Yayına al' : 'Yeniden yayına al'}
        </Button>
      )}
      {promotion.status !== 'ACTIVE' && promotion.usage.reservations + promotion.usage.cancelled === 0 && (
        <Button variant="ghost" icon="trash" onClick={() => setConfirm('delete')} disabled={busy}>
          Sil
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <PageHeader title={promotion.name} description={`${promotion.label} · ${promotion.requiresCoupon ? 'Kuponla uygulanır' : 'Kendiliğinden uygulanır'}`} actions={actions} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={PROMOTION_STATUS_TONES[promotion.status]}>{PROMOTION_STATUS_LABELS[promotion.status]}</Badge>
        {promotion.availability && <Badge tone={AVAILABILITY_TONES[promotion.availability]}>{AVAILABILITY_LABELS[promotion.availability]}</Badge>}
        <span className="text-sm text-ink-muted">
          {promotion.usage.reservations} rezervasyon · indirim −{formatMoney(promotion.usage.discountTotal, currency)}
          {promotion.usage.cancelled > 0 && ` · ${promotion.usage.cancelled} iptal / gelmedi`}
        </span>
      </div>
      {promotion.blockers.length > 0 && promotion.status !== 'ACTIVE' && (
        <Alert tone="warning" title="Yayına almadan önce">
          <ul className="list-disc pl-5">
            {promotion.blockers.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      )}
      {promotion.warnings.length > 0 && (
        <Alert tone="info" title="Dikkat">
          <ul className="list-disc pl-5">
            {promotion.warnings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      )}
      <TabNav
        label="Promosyon sayfaları"
        tabs={[
          { to: base, label: 'Kurallar', icon: 'sliders', end: true },
          ...(promotion.requiresCoupon ? [{ to: `${base}/kuponlar`, label: `Kuponlar (${promotion.coupons.total})`, icon: 'percent' }] : []),
          { to: `${base}/kullanim`, label: 'Kullanım', icon: 'chart' },
        ]}
      />
      <Outlet context={{ promotion }} />

      <ConfirmDialog
        open={confirm === 'pause'}
        title="Promosyon durdurulsun mu?"
        message="Durdurulan promosyon yeni satışa uygulanmaz (kuponları da kullanılamaz). Açılmış rezervasyonlar indirimini korur. İstediğinizde yeniden yayına alabilirsiniz."
        confirmLabel="Durdur"
        confirmIcon="clock"
        onConfirm={() => run('pause')}
        onClose={() => setConfirm(null)}
        isPending={busy}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Promosyon silinsin mi?"
        message={`Hiç kullanılmamış promosyon${promotion.coupons.total ? ` ve ${promotion.coupons.total} kuponu` : ''} kalıcı olarak silinir.`}
        confirmLabel="Sil"
        confirmVariant="danger"
        confirmIcon="trash"
        onConfirm={() => run('delete')}
        onClose={() => setConfirm(null)}
        isPending={busy}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/promosyonlar" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
      <Icon name="arrowLeft" className="size-4" />
      Promosyonlar
    </Link>
  );
}

/** Sekmelerin promosyonu okuduğu kanca. */
export function usePromotionOutlet() {
  return useOutletContext();
}
