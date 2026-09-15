import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MANUAL_ROOM_STATUSES, ROOM_STATUS_LABELS, blockRoomSchema, roomInputSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { RoomStatusBadge } from '../../components/RoomStatusBadge.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { apiPatch, apiPost } from '../../lib/api.js';
import { useCrudResource } from '../../lib/useCrudResource.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { useRoomTypes } from './useRoomTypes.js';

const EMPTY_ROOM = { number: '', floor: '1', roomTypeId: '', notes: '' };

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Tüm durumlar' },
  ...Object.entries(ROOM_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const MANUAL_STATUS_OPTIONS = MANUAL_ROOM_STATUSES.map((value) => ({
  value,
  label: ROOM_STATUS_LABELS[value],
}));

export function RoomListTab() {
  const queryClient = useQueryClient();
  const { options: roomTypeOptions, roomTypes } = useRoomTypes();

  const [filters, setFilters] = useState({ roomTypeId: '', status: '' });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [blocking, setBlocking] = useState(null);

  const resource = useCrudResource({
    basePath: '/rooms',
    queryKey: ['rooms', 'list'],
    labels: { singular: 'Oda' },
    extraParams: {
      ...(filters.roomTypeId ? { roomTypeId: filters.roomTypeId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
  });

  const refreshRooms = () => {
    queryClient.invalidateQueries({ queryKey: ['rooms'] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status, expectedUpdatedAt }) =>
      apiPatch(`/rooms/${id}/status`, { status, expectedUpdatedAt }),
    onSuccess: () => {
      toastSuccess('Oda durumu güncellendi');
      refreshRooms();
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') refreshRooms();
    },
  });

  const blockMutation = useMutation({
    mutationFn: ({ roomId, values }) => apiPost(`/rooms/${roomId}/blocks`, values),
    onSuccess: () => {
      toastSuccess('Oda bloklandı');
      setBlocking(null);
      refreshRooms();
    },
    onError: (error) => toastError(error.message),
  });

  const hasFilter = Boolean(resource.search || filters.roomTypeId || filters.status);

  const columns = [
    { key: 'number', header: 'Oda', className: 'font-bold' },
    { key: 'floor', header: 'Kat' },
    {
      key: 'roomType',
      header: 'Tip',
      render: (row) =>
        row.roomTypeCode ? (
          <span className="whitespace-nowrap">
            <span className="font-bold">{row.roomTypeCode}</span>
            <span className="text-ink-muted"> — {row.roomTypeName}</span>
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => <RoomStatusBadge status={row.status} />,
    },
    {
      key: 'quickStatus',
      header: 'Durum değiştir',
      render: (row) => (
        <Select
          name={`status-${row.id}`}
          value=""
          aria-label={`${row.number} numaralı odanın durumunu değiştir`}
          onChange={(event) => {
            if (!event.target.value) return;
            statusMutation.mutate({
              id: row.id,
              status: event.target.value,
              expectedUpdatedAt: row.updatedAt,
            });
          }}
          options={[{ value: '', label: 'Seç…' }, ...MANUAL_STATUS_OPTIONS]}
          disabled={statusMutation.isPending}
          compact
          className="w-36"
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        actions={
          <Button icon="plus" onClick={() => setEditing(EMPTY_ROOM)} disabled={roomTypes.length === 0}>
            Yeni oda
          </Button>
        }
      >
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Oda numarası…"
          value={resource.search}
          onChange={(event) => resource.setSearch(event.target.value)}
          className="w-full sm:w-48"
        />
        <Select
          name="roomTypeFilter"
          label="Oda tipi"
          value={filters.roomTypeId}
          onChange={(event) => {
            setFilters((current) => ({ ...current, roomTypeId: event.target.value }));
            resource.setPage(1);
          }}
          options={[{ value: '', label: 'Tüm tipler' }, ...roomTypeOptions]}
          className="w-full sm:w-56"
        />
        <Select
          name="statusFilter"
          label="Durum"
          value={filters.status}
          onChange={(event) => {
            setFilters((current) => ({ ...current, status: event.target.value }));
            resource.setPage(1);
          }}
          options={STATUS_FILTER_OPTIONS}
          className="w-full sm:w-44"
        />
      </Toolbar>

      {roomTypes.length === 0 && (
        <Alert tone="warning" title="Henüz oda tipi tanımlanmamış">
          Oda ekleyebilmek için önce Ayarlar → Oda tipleri bölümünden en az bir tip tanımlayın.
        </Alert>
      )}

      <DataTable
        columns={columns}
        rows={resource.rows}
        meta={resource.meta}
        isLoading={resource.isLoading}
        isFetching={resource.isFetching}
        error={resource.error}
        onRetry={resource.refetch}
        onPageChange={resource.setPage}
        emptyTitle={hasFilter ? 'Eşleşen oda yok' : 'Henüz oda yok'}
        emptyHint={hasFilter ? 'Filtreleri değiştirip tekrar deneyin.' : 'Rezervasyon alabilmek için odaları tanımlayın.'}
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" icon="lock" onClick={() => setBlocking(row)}>
              Blokla
            </Button>
            <Button variant="outline" size="sm" icon="pencil" onClick={() => setEditing(row)}>
              Düzenle
            </Button>
            <Button variant="dangerSoft" size="sm" icon="trash" onClick={() => setDeleting(row)}>
              Sil
            </Button>
          </div>
        )}
      />

      {editing && (
        <RoomFormModal
          key={editing.id ?? 'new'}
          initial={editing}
          roomTypeOptions={roomTypeOptions}
          isPending={resource.createMutation.isPending || resource.updateMutation.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(values) => {
            const mutation = editing.id ? resource.updateMutation : resource.createMutation;
            const payload = editing.id
              ? { id: editing.id, values: { ...values, expectedUpdatedAt: editing.updatedAt } }
              : values;
            mutation.mutate(payload, {
              onSuccess: () => {
                setEditing(null);
                refreshRooms();
              },
            });
          }}
        />
      )}

      {blocking && (
        <BlockRoomModal
          key={blocking.id}
          room={blocking}
          isPending={blockMutation.isPending}
          error={blockMutation.error}
          onClose={() => {
            setBlocking(null);
            blockMutation.reset();
          }}
          onSubmit={(values) => blockMutation.mutate({ roomId: blocking.id, values })}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Odayı sil"
        message={`"${deleting?.number}" numaralı oda silinecek. Aktif rezervasyonu veya bloğu varsa işlem reddedilir.`}
        isPending={resource.deleteMutation.isPending}
        error={resource.deleteMutation.error}
        onClose={() => {
          setDeleting(null);
          resource.deleteMutation.reset();
        }}
        onConfirm={() =>
          resource.deleteMutation.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              refreshRooms();
            },
          })
        }
      />
    </div>
  );
}

function RoomFormModal({ initial, roomTypeOptions, onSubmit, onClose, isPending }) {
  const [form, setForm] = useState({
    number: initial.number ?? '',
    floor: String(initial.floor ?? '1'),
    roomTypeId: initial.roomTypeId ?? roomTypeOptions[0]?.value ?? '',
    notes: initial.notes ?? '',
  });
  const [errors, setErrors] = useState({});

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateWith(roomInputSchema, form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.data);
  }

  return (
    <Modal
      open
      title={initial.id ? 'Odayı düzenle' : 'Yeni oda'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="room-form" icon="check" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="room-form" onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
        <Input label="Oda numarası" name="number" value={form.number} onChange={setField('number')} error={errors.number} />
        <Input label="Kat" name="floor" type="number" value={form.floor} onChange={setField('floor')} error={errors.floor} />
        <Select
          label="Oda tipi"
          name="roomTypeId"
          value={form.roomTypeId}
          onChange={setField('roomTypeId')}
          options={roomTypeOptions}
          error={errors.roomTypeId}
          className="sm:col-span-2"
        />
        <Textarea
          label="Not"
          name="notes"
          value={form.notes}
          onChange={setField('notes')}
          error={errors.notes}
          className="sm:col-span-2"
        />
      </form>
    </Modal>
  );
}

function BlockRoomModal({ room, onSubmit, onClose, isPending, error }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ startDate: today, endDate: '', reason: '' });
  const [errors, setErrors] = useState({});

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateWith(blockRoomSchema, {
      startDate: form.startDate,
      endDate: form.endDate || null,
      reason: form.reason,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.data);
  }

  const conflicts = error?.details?.reservations;

  return (
    <Modal
      open
      title={`${room.number} numaralı odayı blokla`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="block-form" icon="lock" disabled={isPending}>
            {isPending ? 'Bloklanıyor…' : 'Blokla'}
          </Button>
        </>
      }
    >
      <form id="block-form" onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
        <Input
          label="Başlangıç"
          name="startDate"
          type="date"
          value={form.startDate}
          onChange={setField('startDate')}
          error={errors.startDate}
        />
        <Input
          label="Bitiş (boş = süresiz)"
          name="endDate"
          type="date"
          value={form.endDate}
          onChange={setField('endDate')}
          error={errors.endDate}
        />
        <Input
          label="Sebep"
          name="reason"
          value={form.reason}
          onChange={setField('reason')}
          error={errors.reason}
          placeholder="Tadilat, arıza, VIP için ayrıldı…"
          className="sm:col-span-2"
        />
      </form>

      {error && (
        <Alert tone="danger" className="mt-5">
          <p>{error.message}</p>
          {conflicts && (
            <ul className="mt-2 list-inside list-disc text-xs">
              {conflicts.map((item) => (
                <li key={item.confirmationCode}>
                  {item.confirmationCode}: {item.checkIn} → {item.checkOut}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <p className="mt-5 text-xs leading-relaxed text-ink-muted">
        Bloklu oda, blok tarihleri boyunca müsaitlik hesabından düşer. Bitiş boş bırakılırsa blok elle kaldırılana
        kadar sürer.
      </p>
    </Modal>
  );
}
