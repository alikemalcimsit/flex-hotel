import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  API_BOOKING_STATUS_LABELS,
  API_CLIENT_STATUS_LABELS,
  API_SCOPE_LABELS,
  MAX_ACTIVE_API_KEYS_PER_CLIENT,
  MAX_WEBHOOKS_PER_CLIENT,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_STATUS_LABELS,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Icon } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPatch, apiPost } from '../../lib/api.js';
import { CLIENT_STATUS_TONES, KEY_STATE_LABELS, KEY_STATE_TONES, WEBHOOK_STATUS_TONES, integrationKeys, useApiClient, useIntegrationTime } from '../../lib/integrations.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ApiClientDialog } from './ApiClientDialog.jsx';
import { ApiKeyDialog } from './ApiKeyDialog.jsx';
import { SecretReveal } from './SecretReveal.jsx';
import { WebhookDialog } from './WebhookDialog.jsx';

const STALE_TEXT = 'Kayıt bu arada başkası tarafından değiştirildi; ekran yenilendi, tekrar deneyin.';

/**
 * Uygulama kartı (modül 61): ayarlar, anahtarlar (önek, kapsam, son kullanım, iptal) ve webhook abonelikleri (durum,
 * son 24 saatin teslimatları, duraklat / aç, deneme gönder, sır yenile, sil). Anahtar ve sır yalnız oluştururken bir
 * kez gösterilir.
 */
export function ApiClientPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useCan();
  const formatTime = useIntegrationTime();
  const query = useApiClient(clientId);
  const [dialog, setDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [revealed, setRevealed] = useState(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: integrationKeys.all });
  const action = useMutation({
    mutationFn: async ({ kind, target }) => {
      const client = query.data;
      const base = `/integrations/clients/${client.id}`;
      if (kind === 'toggle-client') return apiPatch(base, { expectedUpdatedAt: client.updatedAt, status: client.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
      if (kind === 'delete-client') return api(base, { method: 'DELETE', body: JSON.stringify({ expectedUpdatedAt: client.updatedAt }) });
      if (kind === 'revoke-key') return apiPost(`${base}/keys/${target.id}/revoke`, {});
      if (kind === 'toggle-webhook') return apiPatch(`${base}/webhooks/${target.id}`, { expectedUpdatedAt: target.updatedAt, status: target.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' });
      if (kind === 'test-webhook') return apiPost(`${base}/webhooks/${target.id}/test`, {});
      if (kind === 'rotate-webhook') return apiPost(`${base}/webhooks/${target.id}/rotate-secret`, { expectedUpdatedAt: target.updatedAt });
      if (kind === 'delete-webhook') return api(`${base}/webhooks/${target.id}`, { method: 'DELETE', body: JSON.stringify({ expectedUpdatedAt: target.updatedAt }) });
      throw new Error(`bilinmeyen işlem: ${kind}`);
    },
    onSuccess: (result, { kind }) => {
      setConfirm(null);
      refresh();
      if (kind === 'delete-client') {
        toastSuccess('Uygulama silindi; anahtarları artık çalışmıyor');
        navigate('/entegrasyonlar/uygulamalar');
        return;
      }
      if (kind === 'rotate-webhook') setRevealed(result.secret);
      const messages = {
        'toggle-client': result?.status === 'ACTIVE' ? 'Uygulama açıldı' : 'Uygulama kapatıldı; anahtarları reddediliyor, webhook gönderilmiyor',
        'revoke-key': 'Anahtar iptal edildi; en geç bir dakika içinde reddedilir',
        'toggle-webhook': result?.status === 'ACTIVE' ? 'Abonelik açıldı; bekleyen olaylar gönderiliyor' : 'Abonelik duraklatıldı; yeni olaylar yazılmıyor',
        'test-webhook': 'Deneme olayı sıraya alındı; sonucu teslimat logunda',
        'rotate-webhook': 'Sır yenilendi; eski sır 24 saat ikinci imza olarak gönderilir',
        'delete-webhook': 'Abonelik silindi',
      };
      if (messages[kind]) toastSuccess(messages[kind]);
    },
    onError: (error) => {
      if (error.code === 'STALE_WRITE') refresh();
      toastError(error.code === 'STALE_WRITE' ? STALE_TEXT : error.message);
    },
  });

  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <QueryFallback query={query} errorTitle="Uygulama yüklenemedi" />
      </div>
    );
  }

  const client = query.data;
  const canManage = can(PERMISSIONS.INTEGRATIONS_MANAGE);
  const busy = action.isPending;
  const run = (kind, target) => action.mutate({ kind, target });
  const activeKeys = client.keys.filter((key) => key.state === 'ACTIVE').length;

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <PageHeader
        title={client.name}
        description={client.description ?? 'Açıklama yok'}
        actions={
          canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" icon="pencil" onClick={() => setDialog({ kind: 'client' })} disabled={busy}>Düzenle</Button>
              <Button variant="outline" icon={client.status === 'ACTIVE' ? 'lock' : 'check'} onClick={() => (client.status === 'ACTIVE' ? setConfirm({ kind: 'toggle-client' }) : run('toggle-client'))} disabled={busy}>
                {client.status === 'ACTIVE' ? 'Kapat' : 'Aç'}
              </Button>
              <Button variant="ghost" icon="trash" onClick={() => setConfirm({ kind: 'delete-client' })} disabled={busy}>Sil</Button>
            </div>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <Badge tone={CLIENT_STATUS_TONES[client.status]}>{API_CLIENT_STATUS_LABELS[client.status]}</Badge>
        <span>Dakikada {client.rateLimitPerMinute} istek</span>
        <span aria-hidden>·</span>
        <span>{API_BOOKING_STATUS_LABELS[client.bookingStatus]}</span>
        {client.contactEmail && (
          <>
            <span aria-hidden>·</span>
            <span>{client.contactEmail}</span>
          </>
        )}
      </div>
      {client.status !== 'ACTIVE' && <Alert tone="warning" title="Uygulama kapalı">Anahtarları reddediliyor (403), webhook gönderilmiyor; bekleyen olaylar uygulama açılınca gider.</Alert>}

      <Card
        title="API anahtarları"
        description={`Her ortam / sunucu için ayrı anahtar; sızan anahtar tek başına iptal edilir. En fazla ${MAX_ACTIVE_API_KEYS_PER_CLIENT} geçerli anahtar.`}
        actions={canManage && <Button icon="key" onClick={() => setDialog({ kind: 'key' })} disabled={busy || activeKeys >= MAX_ACTIVE_API_KEYS_PER_CLIENT}>Yeni anahtar</Button>}
      >
        {client.keys.length === 0 ? (
          <p className="text-sm text-ink-muted">Henüz anahtar yok. Dış sistem anahtarsız bağlanamaz.</p>
        ) : (
          <ul className="divide-y divide-line">
            {client.keys.map((key) => (
              <li key={key.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{key.name}</span>
                    <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-ink-soft">{key.display}</code>
                    <Badge tone={KEY_STATE_TONES[key.state]}>{KEY_STATE_LABELS[key.state]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted [overflow-wrap:anywhere]">
                    {key.scopes.map((scope) => API_SCOPE_LABELS[scope]).join(' · ')}
                  </p>
                  <p className="text-xs text-ink-muted">
                    Son kullanım {key.lastUsedAt ? `${formatTime(key.lastUsedAt)}${key.lastUsedIp ? ` (${key.lastUsedIp})` : ''}` : 'hiç'}
                    {key.expiresAt && ` · ${key.state === 'EXPIRED' ? 'süresi doldu' : 'geçerlilik'} ${formatTime(key.expiresAt)}`}
                    {key.revokedAt && ` · ${formatTime(key.revokedAt)} iptal (${key.revokedBy})`}
                  </p>
                </div>
                {canManage && key.state !== 'REVOKED' && (
                  <Button variant="ghost" size="sm" icon="trash" onClick={() => setConfirm({ kind: 'revoke-key', target: key })} disabled={busy}>
                    İptal et
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Webhook abonelikleri"
        description={`Seçilen olaylar adrese imzalı POST olarak gider; başarısızsa ~45 saat boyunca yeniden denenir. En fazla ${MAX_WEBHOOKS_PER_CLIENT} abonelik.`}
        actions={canManage && <Button icon="plus" onClick={() => setDialog({ kind: 'webhook' })} disabled={busy || client.subscriptions.length >= MAX_WEBHOOKS_PER_CLIENT}>Yeni abonelik</Button>}
      >
        {client.subscriptions.length === 0 ? (
          <p className="text-sm text-ink-muted">Abonelik yok: dış sistem değişiklikleri yalnız API'den çekerek öğrenir.</p>
        ) : (
          <ul className="divide-y divide-line">
            {client.subscriptions.map((subscription) => (
              <li key={subscription.id} className="flex flex-col gap-3 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink [overflow-wrap:anywhere]">{subscription.url}</span>
                      <Badge tone={WEBHOOK_STATUS_TONES[subscription.status]}>{WEBHOOK_STATUS_LABELS[subscription.status]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{subscription.events.map((type) => WEBHOOK_EVENT_LABELS[type]).join(' · ')}</p>
                    <p className="text-xs text-ink-muted">
                      Son 24 saat: {subscription.last24h.SUCCEEDED ?? 0} teslim · {(subscription.last24h.RETRYING ?? 0) + (subscription.last24h.PENDING ?? 0)} bekliyor · {subscription.last24h.FAILED ?? 0} teslim edilemedi
                      {subscription.lastSuccessAt && ` · son başarı ${formatTime(subscription.lastSuccessAt)}`}
                    </p>
                    {subscription.previousSecretValidUntil && <p className="text-xs text-info-ink">Eski sır {formatTime(subscription.previousSecretValidUntil)} saatine kadar ikinci imza olarak gidiyor.</p>}
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="outline" size="sm" icon="send" onClick={() => run('test-webhook', subscription)} disabled={busy || subscription.status !== 'ACTIVE' || client.status !== 'ACTIVE'}>Deneme gönder</Button>
                      <Button variant="outline" size="sm" icon={subscription.status === 'ACTIVE' ? 'clock' : 'play'} onClick={() => run('toggle-webhook', subscription)} disabled={busy}>
                        {subscription.status === 'ACTIVE' ? 'Duraklat' : 'Yeniden aç'}
                      </Button>
                      <Button variant="ghost" size="sm" icon="pencil" onClick={() => setDialog({ kind: 'webhook', subscription })} disabled={busy}>Düzenle</Button>
                      <Button variant="ghost" size="sm" icon="rotateCcw" onClick={() => setConfirm({ kind: 'rotate-webhook', target: subscription })} disabled={busy}>Sırrı yenile</Button>
                      <Button variant="ghost" size="sm" icon="trash" onClick={() => setConfirm({ kind: 'delete-webhook', target: subscription })} disabled={busy}>Sil</Button>
                    </div>
                  )}
                </div>
                {subscription.status === 'DISABLED' && (
                  <Alert tone="danger" title="Hatalar yüzünden kapandı">
                    {subscription.disabledReason} Alıcı düzelince "Yeniden aç" deyin; bekleyen olaylar o zaman gönderilir.
                  </Alert>
                )}
                {subscription.status === 'ACTIVE' && subscription.consecutiveFailures > 0 && (
                  <Alert tone="warning" title="Teslimat sorunu">
                    Art arda {subscription.consecutiveFailures} başarısız deneme ({formatTime(subscription.failingSince)} saatinden beri).{' '}
                    <Link className="font-semibold underline" to={`/entegrasyonlar/teslimatlar?subscriptionId=${subscription.id}`}>Teslimatlara bak</Link>
                  </Alert>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog?.kind === 'client' && <ApiClientDialog client={client} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'key' && <ApiKeyDialog client={client} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'webhook' && <WebhookDialog client={client} subscription={dialog.subscription} onClose={() => setDialog(null)} />}
      {revealed && (
        <SecretReveal
          title="Yeni imza sırrı"
          label="İmza sırrı"
          value={revealed}
          hint="Yeni sırrı alıcı sunucuya 24 saat içinde yerleştirin; o süre boyunca teslimatlar hem eski hem yeni sırla imzalanır. Kapatınca bir daha gösterilmez."
          onClose={() => setRevealed(null)}
        />
      )}

      <ConfirmDialog
        open={confirm?.kind === 'toggle-client'}
        title="Uygulama kapatılsın mı?"
        message="Bütün anahtarları 403 alır, webhook gönderilmez (bekleyen olaylar uygulama açılınca gider). Açtığı rezervasyonlar durur."
        confirmLabel="Kapat"
        confirmIcon="lock"
        onConfirm={() => run('toggle-client')}
        onClose={() => setConfirm(null)}
        isPending={busy}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete-client'}
        title="Uygulama silinsin mi?"
        message="Anahtarları iptal edilir, abonelikleri silinir, bekleyen teslimatlar gönderilmez. Geri alınmaz; açtığı rezervasyonlar ve geçmiş log durur."
        confirmLabel="Sil"
        onConfirm={() => run('delete-client')}
        onClose={() => setConfirm(null)}
        isPending={busy}
      />
      <ConfirmDialog
        open={confirm?.kind === 'revoke-key'}
        title="Anahtar iptal edilsin mi?"
        message={`"${confirm?.target?.name ?? ''}" (${confirm?.target?.display ?? ''}) en geç bir dakika içinde reddedilir. Geri alınmaz; yerine yeni anahtar oluşturulur.`}
        confirmLabel="İptal et"
        onConfirm={() => run('revoke-key', confirm.target)}
        onClose={() => setConfirm(null)}
        isPending={busy}
      />
      <ConfirmDialog
        open={confirm?.kind === 'rotate-webhook'}
        title="İmza sırrı yenilensin mi?"
        message="Yeni sır bir kez gösterilir. Eski sır 24 saat ikinci imza olarak gönderilmeye devam eder; alıcı bu sürede yeni sırra geçmeli."
        confirmLabel="Yenile"
        confirmVariant="primary"
        confirmIcon="rotateCcw"
        onConfirm={() => run('rotate-webhook', confirm.target)}
        onClose={() => setConfirm(null)}
        isPending={busy}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete-webhook'}
        title="Abonelik silinsin mi?"
        message="Bekleyen teslimatlar gönderilmez; geçmiş log 30 gün durur."
        confirmLabel="Sil"
        onConfirm={() => run('delete-webhook', confirm.target)}
        onClose={() => setConfirm(null)}
        isPending={busy}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/entegrasyonlar/uygulamalar" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
      <Icon name="arrowLeft" className="size-4" />
      Uygulamalar
    </Link>
  );
}

