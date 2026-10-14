import { useState } from 'react';
import { Link, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CHANNEL_STATUS_LABELS, CHANNEL_TYPE_LABELS, CHANNEX_ENVIRONMENT_LABELS, ICAL_PROVIDER_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Icon } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { TabNav } from '../../components/TabNav.jsx';
import { apiPost } from '../../lib/api.js';
import { syncSummary } from '../../lib/channelForm.js';
import { CHANNEL_STATUS_TONES, channelKeys, useChannel, useChannelLive, useChannelTime } from '../../lib/channelManager.js';
import { formatPercent } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const STALE_TEXT = 'Kanal bu arada başkası tarafından değiştirildi; ekran yenilendi, tekrar deneyin.';
const SUMMARY_ALERT_TONES = Object.freeze({ success: 'success', warning: 'warning', danger: 'danger', info: 'info', neutral: 'info' });

/**
 * Kanal kartı (modül 33): başlık, eylemler (senkrona al, durdur, şimdi eşitle,
 * sil), senkrona almayı engelleyen eksikler, senkron durumu ve sekmeler
 * (ayarlar, eşleştirme, stop-sale, senkron logu, kanal rezervasyonları).
 * Kanal bir kez yüklenir, sekmelere bağlam olarak verilir; canlı kanal tazeler.
 */
export function ChannelPage() {
  const { channelId } = useParams();
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useChannel(channelId);
  const formatDateTime = useChannelTime();
  useChannelLive();
  const [confirm, setConfirm] = useState(null);

  const action = useMutation({
    mutationFn: ({ kind, channel }) => {
      if (kind === 'delete') return apiPost(`/channel-manager/${channel.id}/delete`, { expectedUpdatedAt: channel.updatedAt });
      if (kind === 'sync') return apiPost(`/channel-manager/${channel.id}/sync`, {});
      return apiPost(`/channel-manager/${channel.id}/status`, { expectedUpdatedAt: channel.updatedAt, status: kind === 'pause' ? 'PAUSED' : 'ACTIVE' });
    },
    onSuccess: (result, { kind, channel }) => {
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: channelKeys.all });
      if (kind === 'delete') {
        toastSuccess('Kanal silindi');
        navigate('/kanallar');
        return;
      }
      if (kind === 'sync') {
        toastSuccess(channel.type === 'CHANNEX' ? 'Tam eşitleme istendi; birkaç saniye içinde gönderilir' : 'Takvim okunuyor; sonuç senkron logunda');
        return;
      }
      toastSuccess(kind === 'pause' ? 'Kanal durduruldu; kanala hiçbir şey gitmiyor' : channel.type === 'CHANNEX' ? 'Kanal senkronda; ilk tam eşitleme birkaç saniye içinde' : 'Kanal senkronda; takvim okunuyor');
      queryClient.setQueryData(channelKeys.detail(result.id), result);
    },
    onError: (error) => {
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: channelKeys.all });
    },
  });

  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <QueryFallback query={query} errorTitle="Kanal yüklenemedi" />
      </div>
    );
  }

  const channel = query.data;
  const canManage = can(PERMISSIONS.CHANNEL_MANAGER_MANAGE);
  const base = `/kanallar/${channel.id}`;
  const busy = action.isPending;
  const run = (kind) => action.mutate({ kind, channel });
  const summary = syncSummary(channel, formatDateTime);
  const { blockers, warnings } = channel.readiness;
  const attention = channel.bookingCounts.ATTENTION + channel.bookingCounts.REVIEW;

  const actions = canManage && (
    <div className="flex flex-wrap gap-2">
      {channel.status === 'ACTIVE' ? (
        <>
          <Button variant="outline" icon="refresh" onClick={() => run('sync')} disabled={busy}>
            {channel.type === 'CHANNEX' ? 'Şimdi tam eşitle' : 'Takvimi şimdi oku'}
          </Button>
          <Button variant="outline" icon="clock" onClick={() => setConfirm('pause')} disabled={busy}>
            Durdur
          </Button>
        </>
      ) : (
        <>
          <Button icon="send" onClick={() => run('activate')} disabled={busy || blockers.length > 0}>
            {channel.status === 'DRAFT' ? 'Senkrona al' : 'Yeniden senkrona al'}
          </Button>
          <Button variant="ghost" icon="trash" onClick={() => setConfirm('delete')} disabled={busy}>
            Sil
          </Button>
        </>
      )}
    </div>
  );

  const subtitle =
    channel.type === 'CHANNEX'
      ? `${CHANNEL_TYPE_LABELS.CHANNEX} · ${CHANNEX_ENVIRONMENT_LABELS[channel.environment]} · ${channel.externalName ?? channel.propertyId} · fiyat farkı ${formatPercent(Number(channel.priceMarkupPercent))} · ${channel.horizonDays} gün`
      : `${CHANNEL_TYPE_LABELS.ICAL} · ${ICAL_PROVIDER_LABELS[channel.provider]} · ${channel.horizonDays} gün`;

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <PageHeader title={channel.name} description={subtitle} actions={actions} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={CHANNEL_STATUS_TONES[channel.status]}>{CHANNEL_STATUS_LABELS[channel.status]}</Badge>
        {channel.type === 'CHANNEX' && <Badge tone={channel.webhookConfigured ? 'success' : 'neutral'}>{channel.webhookConfigured ? 'Webhook kurulu' : 'Webhook yok'}</Badge>}
        {attention > 0 && (
          <Link to={`${base}/rezervasyonlar`}>
            <Badge tone={channel.bookingCounts.ATTENTION ? 'danger' : 'warning'}>{attention} rezervasyon dikkat istiyor</Badge>
          </Link>
        )}
      </div>
      <Alert tone={SUMMARY_ALERT_TONES[summary.tone]} title="Senkron">
        <span className="block">{summary.text}</span>
        {channel.status === 'ACTIVE' && (
          <span className="mt-1 block text-xs text-ink-muted">
            {channel.type === 'CHANNEX'
              ? `Son tam eşitleme ${formatDateTime(channel.sync.lastFullSyncAt)} · son değişiklik gönderimi ${formatDateTime(channel.sync.lastDeltaAt)} · rezervasyonlar en son ${formatDateTime(channel.sync.lastBookingPollAt)} okundu`
              : `Takvimler en son ${formatDateTime(channel.sync.lastIcalImportAt)} okundu`}
          </span>
        )}
      </Alert>
      {blockers.length > 0 && channel.status !== 'ACTIVE' && (
        <Alert tone="warning" title="Senkrona almadan önce">
          <ul className="list-disc pl-5">
            {blockers.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert tone="info" title="Dikkat">
          <ul className="list-disc pl-5">
            {warnings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      )}
      <TabNav
        label="Kanal sayfaları"
        tabs={[
          { to: base, label: 'Ayarlar', icon: 'settings', end: true },
          { to: `${base}/eslestirme`, label: `Eşleştirme (${channel.rooms.length})`, icon: 'link' },
          { to: `${base}/stop-sale`, label: `Stop-sale (${channel.stopSales.length})`, icon: 'lock' },
          { to: `${base}/log`, label: 'Senkron logu', icon: 'server' },
          { to: `${base}/rezervasyonlar`, label: 'Rezervasyonlar', icon: 'inbox' },
        ]}
      />
      <Outlet context={{ channel }} />

      <ConfirmDialog
        open={confirm === 'pause'}
        title="Kanal durdurulsun mu?"
        message={
          channel.type === 'CHANNEX'
            ? 'Durdurulan kanala müsaitlik ve fiyat gitmez, rezervasyonlar okunmaz (Channex bekletir; uzun beklerse uyarı e-postası gönderir). Kanalda satış açık kalır: satışı kapatmak için stop-sale kullanın.'
            : 'Durdurulan kanal takvimimizi okuyamaz ve kanalın takvimi okunmaz. Kanalda satış açık kalır: kapatmak için stop-sale kullanın.'
        }
        confirmLabel="Durdur"
        confirmIcon="clock"
        onConfirm={() => run('pause')}
        onClose={() => setConfirm(null)}
        isPending={busy}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Kanal silinsin mi?"
        message="Kanal ve eşleştirmesi kaldırılır; senkron logu ve kanaldan gelmiş rezervasyonların bağı kalır. Channex webhook'u da kaldırılır."
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
    <Link to="/kanallar" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
      <Icon name="arrowLeft" className="size-4" />
      Kanallar
    </Link>
  );
}

/** Sekmelerin kanalı okuduğu kanca. */
export function useChannelOutlet() {
  return useOutletContext();
}
