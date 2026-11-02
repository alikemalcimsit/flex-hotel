import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPatch } from '../../lib/api.js';
import { taskActions } from '../../lib/housekeeping.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Görev satırı işlemleri ve küçük diyaloglar: başlat, bitir, sorun bildir,
 * iptal. Sürüm (`expectedUpdatedAt`) her istekte gider; başka panel aynı
 * görevi değiştirdiyse sunucu 409 döner ve liste tazelenir.
 */

/** @param {{ task: object, onDone: () => void, onCancel: () => void }} props */
export function TaskRowActions({ task, onDone, onCancel }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const actions = taskActions(task);

  const mutation = useMutation({
    mutationFn: ({ action }) => apiPatch(`/housekeeping/tasks/${task.id}/${action}`, { expectedUpdatedAt: task.updatedAt }),
    onSuccess: (_, { label }) => {
      toastSuccess(`${task.room?.number ?? ''} ${label}`);
      onDone();
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: ['housekeeping'] });
    },
  });

  if (!can(PERMISSIONS.HOUSEKEEPING_OPERATE) && !can(PERMISSIONS.HOUSEKEEPING_MANAGE)) return null;

  return (
    <span className="flex items-center justify-end gap-1.5">
      {can(PERMISSIONS.HOUSEKEEPING_OPERATE) && actions.canStart && (
        <Button
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ action: 'start', label: 'görevi başlatıldı' })}
        >
          Başlat
        </Button>
      )}
      {can(PERMISSIONS.HOUSEKEEPING_OPERATE) && actions.canComplete && (
        <Button
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ action: 'complete', label: 'görevi tamamlandı' })}
        >
          Bitir
        </Button>
      )}
      {can(PERMISSIONS.HOUSEKEEPING_OPERATE) && actions.canReportIssue && (
        <Button size="sm" variant="outline" icon="alertTriangle" onClick={() => setIssueOpen(true)}>
          Sorun
        </Button>
      )}
      {can(PERMISSIONS.HOUSEKEEPING_MANAGE) && actions.canCancel && (
        <Button size="sm" variant="outline" icon="trash" onClick={onCancel}>
          İptal
        </Button>
      )}
      {issueOpen && (
        <ReportIssueDialog
          task={task}
          onClose={() => setIssueOpen(false)}
          onDone={() => {
            setIssueOpen(false);
            onDone();
          }}
        />
      )}
    </span>
  );
}

/** @param {{ task: object, onClose: () => void, onDone: () => void }} props */
export function ReportIssueDialog({ task, onClose, onDone }) {
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () => apiPatch(`/housekeeping/tasks/${task.id}/issue`, { expectedUpdatedAt: task.updatedAt, note: note.trim() }),
    onSuccess: () => {
      toastSuccess('Sorun bildirildi; teknik servise görev düştü');
      onDone();
    },
    onError: (error) => toastError(error.message),
  });

  return (
    <Modal
      open
      title={`${task.room?.number ?? ''} — sorun bildir`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            icon="alertTriangle"
            disabled={mutation.isPending || note.trim().length === 0}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Gönderiliyor…' : 'Bildir'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          Görev açık kalır; bildirim arıza kaydı açabilen personelin önüne düşer. Oda satış dışı kalacaksa arıza
          kaydını onlar açar.
        </p>
        <Textarea
          label="Sorun nedir?"
          placeholder="Örn. duş başlığı kırık, klima soğutmuyor"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Modal>
  );
}

/** @param {{ task: object, onClose: () => void, onDone: () => void }} props */
export function CancelTaskDialog({ task, onClose, onDone }) {
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => apiPatch(`/housekeeping/tasks/${task.id}/cancel`, { expectedUpdatedAt: task.updatedAt, reason: reason.trim() }),
    onSuccess: () => {
      toastSuccess('Görev iptal edildi');
      onDone();
    },
    onError: (error) => toastError(error.message),
  });

  return (
    <Modal
      open
      title={`${task.room?.number ?? ''} görevini iptal et`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button icon="trash" disabled={mutation.isPending || reason.trim().length === 0} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'İptal ediliyor…' : 'Görevi iptal et'}
          </Button>
        </>
      }
    >
      <Textarea
        label="Sebep"
        placeholder="Örn. oda satış dışı alındı"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </Modal>
  );
}
