import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPROVAL_STATUS_LABELS,
  approvalDecisionError,
  approvalTiming,
  denyApprovalSchema,
  grantApprovalSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Spinner, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost } from '../../lib/api.js';
import { approvalKeys } from '../../lib/approvals.js';
import { formatMoney } from '../../lib/format.js';
import { formatDateTime, formatMinutes } from '../../lib/timeFormat.js';
import { useNow } from '../../lib/useNow.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { STATUS_TONES } from './approvalTheme.js';

/** Kalan süre yazısının tazelenmesi. */
const CLOCK_TICK_MS = 30_000;

/**
 * Tek onayın dökümü: özet, gerekçe, tutar, isteyen, isteyenin verdiği veri,
 * varsa onaylanınca devam edecek aktör; karara bağlandıysa kim, ne zaman,
 * hangi notla.
 *
 * Onay ve ret aynı pencerede sorulur (üst üste pencere açılmaz); ret
 * gerekçe ister. Karar bu arada başkası tarafından verildiyse sunucu 409
 * döner, pencere güncel hâli gösterir.
 *
 * @param {{
 *   approvalId: string,
 *   canDecide: boolean,
 *   timeZone: string,
 *   initialMode?: 'view' | 'grant' | 'deny',
 *   onClose: () => void,
 * }} props
 */
export function ApprovalDetailDialog({ approvalId, canDecide, timeZone, initialMode = 'view', onClose }) {
  const queryClient = useQueryClient();
  const now = useNow(CLOCK_TICK_MS);
  /** `view` | `grant` (not isteğe bağlı) | `deny` (gerekçe zorunlu) */
  const [mode, setMode] = useState(canDecide ? initialMode : 'view');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');

  const query = useQuery({
    queryKey: approvalKeys.detail(approvalId),
    queryFn: () => api(`/approvals/${approvalId}`),
  });
  const item = query.data;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: approvalKeys.lists });
    queryClient.invalidateQueries({ queryKey: approvalKeys.summary });
  };

  const decideMutation = useMutation({
    mutationFn: ({ decision, input }) => apiPost(`/approvals/${approvalId}/${decision}`, input),
    onSuccess: (updated, { decision }) => {
      queryClient.setQueryData(approvalKeys.detail(approvalId), (current) => ({ ...(current ?? {}), ...updated }));
      refresh();
      setMode('view');
      toastSuccess(decision === 'grant' ? 'Onaylandı; iş kaldığı yerden devam ediyor' : 'Reddedildi; iş yapılmayacak');
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'NOT_PENDING' || error.code === 'NOT_FOUND') {
        setMode('view');
        queryClient.invalidateQueries({ queryKey: approvalKeys.detail(approvalId) });
        refresh();
      }
    },
  });

  function submit(event) {
    event.preventDefault();
    const schema = mode === 'deny' ? denyApprovalSchema : grantApprovalSchema;
    const result = validateWith(schema, { note });
    if (!result.ok) {
      setNoteError(result.errors.note ?? 'Not geçersiz');
      return;
    }
    setNoteError('');
    decideMutation.mutate({ decision: mode, input: result.data });
  }

  const timing = item ? approvalTiming(item, now) : null;
  const decidable = canDecide && item && approvalDecisionError(item, now) === null;
  const busy = decideMutation.isPending;

  // Satırdan "Onayla" ile açıldı ama kayıt bu arada karara bağlanmış ya da
  // süresi dolmuşsa form gösterilmez; pencere yalnızca dökümü gösterir.
  useEffect(() => {
    if (item && !decidable) setMode('view');
  }, [item, decidable]);

  const back = (
    <Button variant="outline" onClick={() => setMode('view')} disabled={busy}>
      Vazgeç
    </Button>
  );
  const footer =
    item &&
    (mode === 'deny' ? (
      <>
        {back}
        <Button type="submit" form="approval-decision-form" variant="danger" icon="close" disabled={busy}>
          {busy ? 'Reddediliyor…' : 'Reddet'}
        </Button>
      </>
    ) : mode === 'grant' ? (
      <>
        {back}
        <Button type="submit" form="approval-decision-form" icon="check" disabled={busy}>
          {busy ? 'Onaylanıyor…' : 'Evet, onayla'}
        </Button>
      </>
    ) : (
      <>
        {decidable && (
          <Button variant="dangerSoft" icon="close" onClick={() => setMode('deny')}>
            Reddet
          </Button>
        )}
        {decidable && (
          <Button icon="check" onClick={() => setMode('grant')}>
            Onayla
          </Button>
        )}
        <Button variant="outline" onClick={onClose}>
          Kapat
        </Button>
      </>
    ));

  return (
    <Modal open size="lg" title={item ? `${item.typeLabel} — onay` : 'Onay'} onClose={busy ? () => {} : onClose} footer={footer}>
      {query.isPending && <Spinner className="py-10" />}
      {query.isError && (
        <Alert
          tone="danger"
          title="Onay yüklenemedi"
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
              Tekrar dene
            </Button>
          }
        >
          {query.error.message}
        </Alert>
      )}
      {item && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONES[item.status]}>{APPROVAL_STATUS_LABELS[item.status]}</Badge>
            {item.status === 'PENDING' && (
              <Badge tone={timing.expired ? 'neutral' : timing.expiringSoon ? 'danger' : 'info'}>
                {timing.expired
                  ? 'Süresi doldu'
                  : timing.minutesLeft === null
                    ? 'Süresiz'
                    : `Kalan ${formatMinutes(timing.minutesLeft)}`}
              </Badge>
            )}
          </div>

          {item.status === 'PENDING' && timing.expired && (
            <Alert tone="warning" title="Süresi dolmuş">
              Kimse karar vermeden süresi doldu; iş yapılmayacak. Kayıt az sonra geçmişe düşer.
            </Alert>
          )}

          <h3 className="text-lg font-bold text-ink">{item.summary}</h3>
          {item.reason && <p className="text-sm text-ink">{item.reason}</p>}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Field label="Tutar">{item.amount !== null ? formatMoney(item.amount, item.currency ?? '') : '—'}</Field>
            <Field label="İsteyen">{item.actorName ? `${item.actorName} (aktör)` : item.requestedBy}</Field>
            <Field label="İstendi">{formatDateTime(item.createdAt, timeZone)}</Field>
            <Field label="Son karar anı">{item.expiresAt ? formatDateTime(item.expiresAt, timeZone) : 'Süresiz'}</Field>
            {item.entityType && (
              <Field label="İlgili kayıt">
                {item.entityType} · <span className="font-mono text-xs">{item.entityId}</span>
              </Field>
            )}
            {item.pendingAction && (
              <Field label="Onaylanınca devam edecek">
                {item.pendingAction.actorName}
                {item.pendingAction.eventName && (
                  <span className="text-ink-muted"> · {item.pendingAction.eventName}</span>
                )}
                {item.pendingAction.resumedAt && <span className="text-ink-muted"> · devam etti</span>}
              </Field>
            )}
            {item.status !== 'PENDING' && (
              <Field label="Karar">
                {item.decidedBy ?? 'Sistem'} · {formatDateTime(item.decidedAt, timeZone)}
              </Field>
            )}
            {item.note && <Field label="Karar notu">{item.note}</Field>}
          </dl>

          {visibleData(item.data).length > 0 && (
            <section aria-label="İsteğin verisi" className="rounded-item border border-line bg-canvas p-3">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">İsteğin verisi</h4>
              <dl className="grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                {visibleData(item.data).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="truncate text-ink-muted">{key}</dt>
                    <dd className="break-words font-mono text-xs text-ink">{describeValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {mode !== 'view' && (
            <form id="approval-decision-form" onSubmit={submit} className="flex flex-col gap-3">
              <Alert tone={mode === 'deny' ? 'warning' : 'info'} title={mode === 'deny' ? 'Reddediyorsunuz' : 'Onaylıyorsunuz'}>
                {mode === 'deny'
                  ? 'İş yapılmayacak ve bir daha sorulmayacak. Gerekçe isteyene ve denetim izine yazılır.'
                  : 'Sistem işi kaldığı yerden devam ettirir. Bu karar geri alınamaz.'}
              </Alert>
              <Textarea
                label={mode === 'deny' ? 'Ret gerekçesi' : 'Not (isteğe bağlı)'}
                name="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                error={noteError}
                rows={3}
                autoFocus
              />
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

/** @param {{ label: string, children: React.ReactNode }} props */
function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

/**
 * İsteyenin ekranda gösterilecek verisi. Anahtarı "_" ile başlayanlar iç
 * veridir (ör. onaylanınca yeniden işlenecek ham istek) ve gösterilmez.
 * @param {Record<string, unknown> | null | undefined} data
 */
function visibleData(data) {
  return Object.entries(data ?? {}).filter(([key]) => !key.startsWith('_'));
}

/** @param {unknown} value */
function describeValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
