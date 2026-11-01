import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { HOUSEKEEPING_MANUAL_TYPES, HOUSEKEEPING_PRIORITIES } from '@hotelos/hotel-contracts';
import { Button, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { RoomPicker } from '../../components/RoomPicker.jsx';
import { api, apiPost } from '../../lib/api.js';
import { priorityLabel, taskTypeLabel } from '../../lib/housekeeping.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Elle görev açma (kat şefi). Çıkış ve sabah görevleri otomatik düşer; bu
 * form ara temizlik, detaylı temizlik gibi plan dışı işler içindir. Misafir
 * isteği görevi elle açılmaz — istekten doğar (modül 7).
 */
export function NewTaskDialog({ onClose, onDone }) {
  const [roomId, setRoomId] = useState('');
  const [type, setType] = useState('STAYOVER');
  const [priority, setPriority] = useState('3');
  const [assignedToId, setAssignedToId] = useState('');
  const [notes, setNotes] = useState('');

  const staff = useQuery({
    queryKey: ['housekeeping', 'staff'],
    queryFn: () => api('/housekeeping/staff'),
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiPost('/housekeeping/tasks', {
        roomId,
        type,
        priority: Number(priority),
        assignedToId: assignedToId || null,
        notes: notes.trim() || null,
      }),
    onSuccess: (task) => {
      toastSuccess(`${task.room?.number ?? ''} için görev açıldı`);
      onDone();
      onClose();
    },
    onError: (error) => toastError(error.message),
  });

  return (
    <Modal
      open
      title="Yeni temizlik görevi"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button icon="plus" disabled={mutation.isPending || !roomId} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Açılıyor…' : 'Görevi aç'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RoomPicker label="Oda" value={roomId} onChange={setRoomId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="İş tipi"
            value={type}
            onChange={(event) => setType(event.target.value)}
            options={HOUSEKEEPING_MANUAL_TYPES.map((value) => ({ value, label: taskTypeLabel(value) }))}
          />
          <Select
            label="Öncelik"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            options={HOUSEKEEPING_PRIORITIES.map((value) => ({ value: String(value), label: priorityLabel(value) }))}
          />
        </div>
        <Select
          label="Görevli (isteğe bağlı)"
          value={assignedToId}
          onChange={(event) => setAssignedToId(event.target.value)}
          options={[
            { value: '', label: 'Sonra atanacak' },
            ...(staff.data ?? []).map((user) => ({
              value: user.id,
              label: `${user.name} (${user.openTasks} açık görev)`,
            })),
          ]}
        />
        <Textarea
          label="Not (isteğe bağlı)"
          placeholder="Örn. misafir 14:00'te dönecek, önce banyo"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </Modal>
  );
}
