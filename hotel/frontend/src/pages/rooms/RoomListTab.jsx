import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MANUAL_ROOM_STATUSES, ROOM_STATUS_LABELS, blockRoomSchema, roomInputSchema } from '@hotelos/hotel-contracts';
import { Button, Card, Input, Select, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { RoomStatusBadge } from '../../components/RoomStatusBadge.jsx';
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

  const columns = [
    { key: 'number', header: 'Oda', className: 'font-medium' },
    { key: 'floor', header: 'Kat' },
    {
      key: 'roomType',
      header: 'Tip',
      render: (row) => (row.roomTypeCode ? `${row.roomTypeCode} — ${row.roomTypeName}` : '—'),
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
          className="w-36"
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            name="search"
            label="Ara"
            placeholder="Oda numarası…"
            value={resource.search}
            onChange={(event) => resource.setSearch(event.target.value)}
            className="w-48"
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
            className="w-56"
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
            className="w-44"
          />
        </div>
        <Button onClick={() => setEditing(EMPTY_ROOM)} disabled={roomTypes.length === 0}>
          Yeni oda
        </Button>
      </div>

      {roomTypes.length === 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            Henüz oda tipi tanımlanmamış. Oda ekleyebilmek için önce Ayarlar → Oda tipleri bölümünden en az bir tip
            tanımlayın.
          </p>
        </Card>
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
        emptyTitle={resource.search || filters.roomTypeId || filters.status ? 'Eşleşen oda yok' : 'Henüz oda yok'}
        emptyHint={
          resource.search || filters.roomTypeId || filters.status
            ? 'Filtreleri değiştirip tekrar deneyin.'
            : 'Rezervasyon alabilmek için odaları tanımlayın.'
        }
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setBlocking(row)}>
              Blokla
            </Button>
            <Button variant="secondary" onClick={() => setEditing(row)}>
              Düzenle
            </Button>
            <Button variant="danger" onClick={() => setDeleting(row)}>
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
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="room-form" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="room-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
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
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="block-form" disabled={isPending}>
            {isPending ? 'Bloklanıyor…' : 'Blokla'}
          </Button>
        </>
      }
    >
      <form id="block-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
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
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error.message}</p>
          {conflicts && (
            <ul className="mt-2 list-inside list-disc text-xs text-red-600">
              {conflicts.map((item) => (
                <li key={item.confirmationCode}>
                  {item.confirmationCode}: {item.checkIn} → {item.checkOut}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Bloklu oda, blok tarihleri boyunca müsaitlik hesabından düşer. Bitiş boş bırakılırsa blok elle kaldırılana
        kadar sürer.
      </p>
    </Modal>
  );
}
