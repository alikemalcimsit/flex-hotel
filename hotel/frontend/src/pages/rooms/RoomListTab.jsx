import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  HOUSEKEEPING_STATUSES,
  HOUSEKEEPING_STATUS_LABELS,
  housekeepingTransitionError,
  ROOM_CONDITIONS,
  ROOM_CONDITION_LABELS,
  ROOM_OCCUPANCIES,
  ROOM_OCCUPANCY_LABELS,
  roomInputSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select, Textarea } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { BlockTypeBadge, HousekeepingBadge, OccupancyBadge } from '../../components/RoomStateBadges.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { apiPatch } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useCrudResource } from '../../lib/useCrudResource.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { RoomBlocksModal } from './RoomBlocksModal.jsx';
import { useRoomTypes } from './useRoomTypes.js';

const EMPTY_ROOM = { number: '', floor: '1', roomTypeId: '', notes: '' };

/** @param {string} allLabel @param {readonly string[]} values @param {Record<string, string>} labels */
const filterOptions = (allLabel, values, labels) => [
  { value: '', label: allLabel },
  ...values.map((value) => ({ value, label: labels[value] })),
];

const OCCUPANCY_FILTER_OPTIONS = filterOptions('Tüm odalar', ROOM_OCCUPANCIES, ROOM_OCCUPANCY_LABELS);
const HOUSEKEEPING_FILTER_OPTIONS = filterOptions('Tüm durumlar', HOUSEKEEPING_STATUSES, HOUSEKEEPING_STATUS_LABELS);
const CONDITION_FILTER_OPTIONS = filterOptions('Tümü', ROOM_CONDITIONS, ROOM_CONDITION_LABELS);

const EMPTY_FILTERS = Object.freeze({ roomTypeId: '', occupancy: '', housekeepingStatus: '', condition: '' });

/**
 * Oda listesi.
 *
 * Oda durumu üç ayrı sütun: doluluk (yalnızca giriş-çıkış değiştirir, burada
 * salt okunur), kat hizmeti (satırdan değiştirilir) ve bugünkü arıza kaydı.
 * Eskiden bunlar tek bir "durum" listesiydi; misafir içerideyken oda elle
 * "Boş" yapılabiliyordu.
 */
export function RoomListTab() {
  const queryClient = useQueryClient();
  const can = useCan();
  const canManage = can(PERMISSIONS.ROOMS_MANAGE);
  const canOperate = can(PERMISSIONS.ROOMS_OPERATE);
  const { options: roomTypeOptions, roomTypes } = useRoomTypes();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [blocksRoom, setBlocksRoom] = useState(null);

  const resource = useCrudResource({
    basePath: '/rooms',
    queryKey: ['rooms', 'list'],
    labels: { singular: 'Oda' },
    extraParams: Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
  });

  const refreshRooms = () => {
    queryClient.invalidateQueries({ queryKey: ['rooms'] });
  };

  const housekeepingMutation = useMutation({
    mutationFn: ({ room, status }) =>
      apiPatch(`/rooms/${room.id}/housekeeping`, { status, expectedUpdatedAt: room.updatedAt }),
    onSuccess: (updated) => {
      toastSuccess(`${updated.number} numaralı oda: ${HOUSEKEEPING_STATUS_LABELS[updated.housekeepingStatus]}`);
      refreshRooms();
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') refreshRooms();
    },
  });

  const setFilter = (key) => (event) => {
    const { value } = event.target;
    setFilters((current) => ({ ...current, [key]: value }));
    resource.setPage(1);
  };

  const hasFilter = Boolean(resource.search || Object.values(filters).some(Boolean));

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
      key: 'occupancy',
      header: 'Doluluk',
      render: (row) => <OccupancyBadge occupancy={row.occupancy} />,
    },
    {
      key: 'housekeeping',
      header: 'Kat hizmeti',
      render: (row) =>
        canOperate ? (
          <HousekeepingSelect
            room={row}
            disabled={housekeepingMutation.isPending}
            onChange={(status) => housekeepingMutation.mutate({ room: row, status })}
          />
        ) : (
          <HousekeepingBadge status={row.housekeepingStatus} />
        ),
    },
    {
      key: 'condition',
      header: 'Arıza',
      render: (row) => <ConditionCell room={row} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        actions={
          canManage && (
            <Button icon="plus" onClick={() => setEditing(EMPTY_ROOM)} disabled={roomTypes.length === 0}>
              Yeni oda
            </Button>
          )
        }
      >
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Oda numarası…"
          value={resource.search}
          onChange={(event) => resource.setSearch(event.target.value)}
          className="w-full sm:w-40"
        />
        <Select
          name="roomTypeFilter"
          label="Oda tipi"
          value={filters.roomTypeId}
          onChange={setFilter('roomTypeId')}
          options={[{ value: '', label: 'Tüm tipler' }, ...roomTypeOptions]}
          className="w-full sm:w-48"
        />
        <Select
          name="occupancyFilter"
          label="Doluluk"
          value={filters.occupancy}
          onChange={setFilter('occupancy')}
          options={OCCUPANCY_FILTER_OPTIONS}
          className="w-full sm:w-36"
        />
        <Select
          name="housekeepingFilter"
          label="Kat hizmeti"
          value={filters.housekeepingStatus}
          onChange={setFilter('housekeepingStatus')}
          options={HOUSEKEEPING_FILTER_OPTIONS}
          className="w-full sm:w-44"
        />
        <Select
          name="conditionFilter"
          label="Arıza"
          value={filters.condition}
          onChange={setFilter('condition')}
          options={CONDITION_FILTER_OPTIONS}
          className="w-full sm:w-36"
        />
      </Toolbar>

      {roomTypes.length === 0 && canManage && (
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
            <Button variant="outline" size="sm" icon="alertTriangle" onClick={() => setBlocksRoom(row)}>
              Arıza kayıtları{row.openBlockCount > 0 ? ` (${row.openBlockCount})` : ''}
            </Button>
            {canManage && (
              <>
                <Button variant="outline" size="sm" icon="pencil" onClick={() => setEditing(row)}>
                  Düzenle
                </Button>
                <Button variant="dangerSoft" size="sm" icon="trash" onClick={() => setDeleting(row)}>
                  Sil
                </Button>
              </>
            )}
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

      {blocksRoom && (
        <RoomBlocksModal key={blocksRoom.id} room={blocksRoom} canManage={canManage} onClose={() => setBlocksRoom(null)} />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Odayı sil"
        message={`"${deleting?.number}" numaralı oda silinecek. Aktif rezervasyonu varsa ya da silinmesi gelecek rezervasyonları karşılayamayacak hâle getirecekse işlem reddedilir. Açık arıza kayıtları odayla birlikte kapanır.`}
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

/**
 * Satır içi kat hizmeti seçici. Geçilemeyen durum (ör. kirli odaya "Kontrol
 * edildi") listede görünür ama seçilemez — kural sunucuyla aynı fonksiyondan.
 *
 * @param {{ room: { number: string, housekeepingStatus: string }, disabled: boolean, onChange: (status: string) => void }} props
 */
function HousekeepingSelect({ room, disabled, onChange }) {
  const options = HOUSEKEEPING_STATUSES.map((status) => {
    const blocked = housekeepingTransitionError(room.housekeepingStatus, status) !== null;
    return {
      value: status,
      label: blocked ? `${HOUSEKEEPING_STATUS_LABELS[status]} (önce temizlenmeli)` : HOUSEKEEPING_STATUS_LABELS[status],
      disabled: blocked,
    };
  });

  return (
    <Select
      name={`housekeeping-${room.number}`}
      value={room.housekeepingStatus}
      aria-label={`${room.number} numaralı odanın kat hizmeti durumu`}
      onChange={(event) => onChange(event.target.value)}
      options={options}
      disabled={disabled}
      compact
      className="w-44"
    />
  );
}

/**
 * Bugünkü arıza kaydı; yoksa yaklaşan kayıt varsa onu hatırlatır.
 * @param {{ room: { currentBlock: { type: string, endDate: string | null } | null, openBlockCount: number } }} props
 */
function ConditionCell({ room }) {
  if (room.currentBlock) {
    return (
      <span className="flex flex-col items-start gap-1">
        <BlockTypeBadge type={room.currentBlock.type} />
        <span className="whitespace-nowrap text-xs text-ink-muted">
          {room.currentBlock.endDate ? `${formatDate(room.currentBlock.endDate)} tarihinde biter` : 'Süresiz'}
        </span>
      </span>
    );
  }
  if (room.openBlockCount > 0) {
    return <span className="whitespace-nowrap text-xs font-semibold text-ink-muted">Yaklaşan kayıt var</span>;
  }
  return <span className="text-ink-muted">—</span>;
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
      {initial.id && (
        <Alert tone="info" className="mt-5">
          Oda tipini değiştirmek eski tipin envanterini bir azaltır; gelecekteki rezervasyonlar karşılanamayacaksa sistem
          değişikliği reddeder.
        </Alert>
      )}
    </Modal>
  );
}
