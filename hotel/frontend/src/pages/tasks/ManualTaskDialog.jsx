import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  MANUAL_TASK_STATUS_LABELS,
  MAX_MANUAL_TASK_NOTE_LENGTH,
  cancelManualTaskSchema,
  completeManualTaskSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Spinner, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api } from '../../lib/api.js';
import { taskKeys, taskLinkTargets } from '../../lib/actors.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { validateWith } from '../../lib/validate.js';
import { ChainLink, JsonBlock } from '../activity/shared.jsx';
import { STATUS_TONES } from './taskTheme.js';
import { useTaskAction } from './taskActions.js';

/**
 * Tek görevin dökümü: ne yapılacak, hangi aktör neden yapamadı, bağlı
 * kayıtlar (rezervasyon, konuşma), olayın gövdesi (işi yapacak kişi için) ve
 * işlem zinciri. Üstlen / bırak / tamamla / gerek kalmadı aynı pencerede;
 * "gerek kalmadı" gerekçe ister, tamamlama notu isteğe bağlı.
 *
 * @param {{ taskId: string, timeZone: string, initialMode?: 'view' | 'complete' | 'cancel', onClose: () => void }} props
 */
export function ManualTaskDialog({ taskId, timeZone, initialMode = 'view', onClose }) {
  const can = useCan();
  const canActivity = can(PERMISSIONS.ACTIVITY_VIEW);
  const [mode, setMode] = useState(initialMode);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const action = useTaskAction();

  const query = useQuery({ queryKey: taskKeys.detail(taskId), queryFn: () => api(`/manual-tasks/${taskId}`) });
  const task = query.data;
  const open = task && (task.status === 'PENDING' || task.status === 'IN_PROGRESS');
  const actionable = Boolean(open && task.canHandle);
  const busy = action.isPending;

  // Görev bu arada kapandıysa form gösterilmez.
  useEffect(() => {
    if (task && !actionable) setMode('view');
  }, [task, actionable]);

  function run(kind, body) {
    action.mutate(
      { taskId, action: kind, body },
      {
        onSuccess: () => {
          setMode('view');
          setText('');
        },
      },
    );
  }

  function submit(event) {
    event.preventDefault();
    const schema = mode === 'cancel' ? cancelManualTaskSchema : completeManualTaskSchema;
    const field = mode === 'cancel' ? 'reason' : 'note';
    const result = validateWith(schema, { [field]: text });
    if (!result.ok) {
      setError(result.errors[field] ?? 'Geçersiz');
      return;
    }
    setError('');
    run(mode, result.data);
  }

  const cancelForm = (
    <Button variant="outline" onClick={() => setMode('view')} disabled={busy}>
      Vazgeç
    </Button>
  );
  const footer = !task ? (
    <Button variant="outline" onClick={onClose}>
      Kapat
    </Button>
  ) : mode === 'complete' ? (
    <>
      {cancelForm}
      <Button type="submit" form="manual-task-form" icon="check" disabled={busy}>
        {busy ? 'Kaydediliyor…' : 'Tamamlandı'}
      </Button>
    </>
  ) : mode === 'cancel' ? (
    <>
      {cancelForm}
      <Button type="submit" form="manual-task-form" variant="danger" icon="close" disabled={busy}>
        {busy ? 'Kaydediliyor…' : 'Gerek kalmadı'}
      </Button>
    </>
  ) : (
    <>
      {actionable && task.status === 'PENDING' && (
        <Button variant="outline" icon="user" onClick={() => run('claim')} disabled={busy}>
          Üstlen
        </Button>
      )}
      {actionable && task.mine && (
        <Button variant="outline" icon="rotateCcw" onClick={() => run('release')} disabled={busy}>
          Bırak
        </Button>
      )}
      {actionable && (
        <Button variant="dangerSoft" icon="close" onClick={() => setMode('cancel')} disabled={busy}>
          Gerek kalmadı
        </Button>
      )}
      {actionable && (
        <Button icon="check" onClick={() => setMode('complete')} disabled={busy}>
          Tamamla
        </Button>
      )}
      <Button variant="outline" onClick={onClose} disabled={busy}>
        Kapat
      </Button>
    </>
  );

  const links = task ? taskLinkTargets(task.links) : [];

  return (
    <Modal open size="lg" title={task ? task.title : 'Görev'} onClose={busy ? () => {} : onClose} footer={footer}>
      {query.isPending && <Spinner className="py-10" />}
      {query.isError && (
        <Alert
          tone="danger"
          title={query.error?.code === 'NOT_FOUND' ? 'Görev bulunamadı' : 'Görev yüklenemedi'}
          action={
            <Button variant="outline" size="sm" icon="refresh" onClick={() => query.refetch()}>
              Tekrar dene
            </Button>
          }
        >
          {query.error.message}
        </Alert>
      )}
      {task && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONES[task.status]}>{MANUAL_TASK_STATUS_LABELS[task.status]}</Badge>
            <Badge tone="neutral">{task.module}</Badge>
            {task.assignedTo && open && (
              <Badge tone={task.mine ? 'info' : 'warning'}>{task.mine ? 'Siz üstlendiniz' : `${task.assignedTo.name ?? 'Biri'} üstlendi`}</Badge>
            )}
          </div>

          {!task.canHandle && open && <Alert tone="info">Bu görev üzerinde işlem yetkiniz yok; yalnızca görüntüleyebilirsiniz.</Alert>}
          {task.assignedTo && open && !task.mine && task.canHandle && (
            <Alert tone="warning">
              Bu görevi {task.assignedTo.name ?? 'başka biri'} üstlendi. İş acilse yine de tamamlayabilirsiniz; kaydınızda sizin adınız yazar.
            </Alert>
          )}

          {task.description && <p className="text-sm text-ink">{task.description}</p>}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Field label="Açıldı">{formatDateTime(task.createdAt, timeZone)}</Field>
            <Field label="Aktör">
              {task.actorName ? (
                can(PERMISSIONS.ACTORS_VIEW) ? (
                  <Link to={`/aktorler/${encodeURIComponent(task.actorName)}`} className="font-mono text-xs hover:underline">
                    {task.actorName}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">{task.actorName}</span>
                )
              ) : (
                '—'
              )}
            </Field>
            <Field label="Olay">{task.event ? `${task.event.label} (${task.event.name})` : '—'}</Field>
            {task.assignedAt && open && <Field label="Üstlenildi">{formatDateTime(task.assignedAt, timeZone)}</Field>}
            {task.closedAt && (
              <Field label={task.status === 'DONE' ? 'Tamamlayan' : 'Kapatan'}>
                {task.resolvedByLabel ?? task.resolvedBy ?? '—'} · {formatDateTime(task.closedAt, timeZone)}
              </Field>
            )}
            {task.resolution && <Field label={task.status === 'DONE' ? 'Not' : 'Gerekçe'}>{task.resolution}</Field>}
          </dl>

          {(links.length > 0 || (canActivity && task.correlationId)) && (
            <div className="flex flex-wrap items-center gap-2">
              {links.map((link) => (
                <Link
                  key={link.key}
                  to={link.to}
                  className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-black/[0.04] hover:text-ink"
                >
                  {link.label}
                </Link>
              ))}
              {canActivity && <ChainLink correlationId={task.correlationId} />}
            </div>
          )}

          {task.payload && <JsonBlock label="Olayın gövdesi (işi yapmak için gereken bilgiler)" value={task.payload} />}

          {(mode === 'complete' || mode === 'cancel') && (
            <form id="manual-task-form" onSubmit={submit} noValidate className="flex flex-col gap-1.5">
              <Textarea
                label={mode === 'cancel' ? 'Neden gerek kalmadı? (zorunlu)' : 'Not (isteğe bağlı)'}
                name={mode === 'cancel' ? 'reason' : 'note'}
                rows={3}
                maxLength={MAX_MANUAL_TASK_NOTE_LENGTH}
                placeholder={mode === 'cancel' ? 'Ör. rezervasyon iptal edildi' : 'Ör. 204 numaralı oda atandı'}
                value={text}
                onChange={(event) => setText(event.target.value)}
                error={error || undefined}
                disabled={busy}
              />
              <p className="text-right text-xs text-ink-muted">
                {text.length}/{MAX_MANUAL_TASK_NOTE_LENGTH}
              </p>
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
    <div>
      <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
