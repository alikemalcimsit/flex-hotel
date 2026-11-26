import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KBS_KIND_LABELS, KBS_STATE_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPost } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { kbsKeys, kbsRoomText, kbsStateTone } from '../../lib/kbs.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ManualDialog } from './ManualDialog.jsx';

/** Zorunlu alan eksikliği kodu: kart düzeltilip tekrar gönderilir. */
const MISSING_FIELDS = 'MISSING_FIELDS';

/**
 * KBS bildirimi ayrıntısı (modül 58): tür, durum, misafir, oda, referans, deneme / sıradaki deneme, son mesaj, bağlı olduğu
 * bildirim ve iz. "Tekrar gönder" (gönderilemedi) ve "Elle bildirildi" (sırada / gönderilemedi) `kbs.send` ister.
 */
export function NotificationPage() {
  const { notificationId } = useParams();
  const can = useCan();
  const queryClient = useQueryClient();
  const [manual, setManual] = useState(false);
  const query = useQuery({ queryKey: kbsKeys.notification(notificationId), queryFn: () => api(`/kbs/notifications/${notificationId}`) });
  const retry = useMutation({
    mutationFn: () => apiPost(`/kbs/notifications/${notificationId}/retry`, {}),
    onSuccess: (result) => {
      queryClient.setQueryData(kbsKeys.notification(notificationId), result);
      queryClient.invalidateQueries({ queryKey: kbsKeys.all });
      toastSuccess('Yeniden sıraya alındı');
    },
    onError: (error) => toastError(error.message),
  });
  if (!query.data) return <QueryFallback query={query} errorTitle="Bildirim yüklenemedi" />;
  const { notification: row, dependsOn, logs } = query.data;
  const canSend = can(PERMISSIONS.KBS_SEND);
  const canRetry = canSend && row.state === 'FAILED';
  const canManual = canSend && ['PENDING', 'FAILED'].includes(row.state);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/kbs/bildirimler" className="text-sm font-semibold text-ink-muted hover:text-ink hover:underline">
          ← Bildirimler
        </Link>
        <span className="flex flex-wrap gap-2">
          {canRetry && (
            <Button type="button" variant="outline" icon="refresh" onClick={() => retry.mutate()} disabled={retry.isPending}>
              {retry.isPending ? 'Gönderiliyor…' : 'Tekrar gönder'}
            </Button>
          )}
          {canManual && (
            <Button type="button" variant="outline" icon="checkCheck" onClick={() => setManual(true)}>
              Elle bildirildi
            </Button>
          )}
        </span>
      </div>
      {row.lastCode === MISSING_FIELDS && (
        <Alert tone="warning" title="Kimlikte eksik alan" action={row.guestId && <Link to={`/misafirler/${row.guestId}`} className="text-sm font-semibold text-ink hover:underline">Misafir kartını aç</Link>}>
          {row.lastMessage ?? 'KBS için zorunlu alan eksik.'} Kartı düzeltip tekrar gönderin.
        </Alert>
      )}
      <Card title={`${KBS_KIND_LABELS[row.kind] ?? row.kind} bildirimi`} actions={<Badge tone={kbsStateTone(row.state)}>{KBS_STATE_LABELS[row.state] ?? row.state}</Badge>}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <Field label="Misafir">
            {row.guestId ? <Link to={`/misafirler/${row.guestId}`} className="font-semibold hover:underline">{row.guestName}</Link> : row.guestName}
            <span className="block text-xs text-ink-muted">{[row.documentMasked, row.nationality].filter(Boolean).join(' · ') || 'Belge yok'}</span>
          </Field>
          <Field label="Oda">{kbsRoomText(row)}</Field>
          <Field label="Rezervasyon">
            {row.confirmationCode ? <Link to={`/rezervasyonlar/${row.reservationId}`} className="font-mono font-semibold hover:underline">{row.confirmationCode}</Link> : '—'}
          </Field>
          <Field label="Açıldı">{formatDateTime(row.createdAt)}</Field>
          <Field label="Deneme">
            {row.attempts}
            {row.nextAttemptAt && ['PENDING', 'SENDING'].includes(row.state) && <span className="block text-xs text-ink-muted">Sıradaki: {formatDateTime(row.nextAttemptAt)}</span>}
          </Field>
          <Field label="Bildirildi">{row.sentAt ? formatDateTime(row.sentAt) : '—'}</Field>
          <Field label="KBS referansı">{row.providerRef ?? '—'}</Field>
          <Field label="Son mesaj">
            {row.lastMessage ?? '—'}
            {row.lastCode && <span className="block font-mono text-xs text-ink-muted">{row.lastCode}</span>}
          </Field>
          <Field label="Bağlı olduğu">
            {dependsOn ? (
              <Link to={`/kbs/bildirimler/${dependsOn.id}`} className="hover:underline">
                {KBS_KIND_LABELS[dependsOn.kind] ?? dependsOn.kind} · {KBS_STATE_LABELS[dependsOn.state] ?? dependsOn.state}
              </Link>
            ) : (
              '—'
            )}
          </Field>
          {row.resolvedNote && (
            <Field label="Elle bildirim notu" className="sm:col-span-3">
              {row.resolvedNote}
              {row.resolvedBy && <span className="block text-xs text-ink-muted">{row.resolvedBy}</span>}
            </Field>
          )}
        </dl>
      </Card>
      <Card title="İz" description="Her deneme ve personel işlemi.">
        {logs.length === 0 ? (
          <p className="text-sm text-ink-muted">Henüz deneme yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th className="py-2 pr-3">Zaman</th>
                  <th className="py-2 pr-3">Sonuç</th>
                  <th className="py-2 pr-3">Kod</th>
                  <th className="py-2 pr-3">Mesaj</th>
                  <th className="py-2">Yapan</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-line align-top">
                    <td className="whitespace-nowrap py-2 pr-3 text-xs">{formatDateTime(log.createdAt)}</td>
                    <td className="py-2 pr-3"><Badge tone={log.ok ? 'success' : 'danger'}>{log.ok ? 'Tamam' : 'Hata'}</Badge></td>
                    <td className="py-2 pr-3 font-mono text-xs">{log.code ?? '—'}</td>
                    <td className="py-2 pr-3 text-ink-soft">{log.message ?? '—'}</td>
                    <td className="py-2 text-xs text-ink-muted">{log.actor ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {manual && <ManualDialog notification={row} onClose={() => setManual(false)} />}
    </div>
  );
}

/** @param {{ label: string, className?: string, children: React.ReactNode }} props */
function Field({ label, className = '', children }) {
  return (
    <div className={className}>
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
