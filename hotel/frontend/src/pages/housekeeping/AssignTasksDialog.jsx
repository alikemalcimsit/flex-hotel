import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Select, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost } from '../../lib/api.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Toplu atama (kat şefi sabah dağıtımı): işaretli görevler tek görevliye
 * verilir ya da atama kaldırılır (görev havuza döner). Listedeki açık görev
 * yükü şefin dengeli dağıtmasına yardım eder.
 */
export function AssignTasksDialog({ taskIds, onClose, onDone }) {
  const [assignedToId, setAssignedToId] = useState('');

  const staff = useQuery({
    queryKey: ['housekeeping', 'staff'],
    queryFn: () => api('/housekeeping/staff'),
  });

  const mutation = useMutation({
    mutationFn: () => apiPost('/housekeeping/tasks/assign', { taskIds, assignedToId: assignedToId || null }),
    onSuccess: () => {
      toastSuccess(
        assignedToId ? `${taskIds.length} görev atandı` : `${taskIds.length} görevin ataması kaldırıldı`,
      );
      onDone();
    },
    onError: (error) => toastError(error.message),
  });

  return (
    <Modal
      open
      title={`${taskIds.length} görevi ata`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button icon="users" disabled={mutation.isPending || staff.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Atanıyor…' : assignedToId ? 'Ata' : 'Atamayı kaldır'}
          </Button>
        </>
      }
    >
      {staff.isPending ? (
        <Spinner className="py-4" />
      ) : (
        <div className="flex flex-col gap-3">
          <Select
            label="Görevli"
            value={assignedToId}
            onChange={(event) => setAssignedToId(event.target.value)}
            options={[
              { value: '', label: 'Atamayı kaldır (havuza dön)' },
              ...(staff.data ?? []).map((user) => ({
                value: user.id,
                label: `${user.name} (${user.openTasks} açık görev)`,
              })),
            ]}
          />
          {(staff.data ?? []).length === 0 && (
            <p className="text-sm text-ink-muted">
              Kat hizmeti rolünde aktif personel yok. Kullanıcıları Ayarlar → Kullanıcılar ekranından ekleyin.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
