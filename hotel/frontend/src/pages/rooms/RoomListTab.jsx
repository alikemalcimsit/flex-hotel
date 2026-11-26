import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  HOUSEKEEPING_STATUSES,
  housekeepingTransitionError,
  ROOM_CONDITIONS,
  ROOM_OCCUPANCIES,
  roomInputSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select, Textarea } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { BlockTypeBadge, HousekeepingBadge, OccupancyBadge } from '../../components/RoomStateBadges.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { useT } from '../../i18n/index.jsx';
import { apiPatch } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useCrudResource } from '../../lib/useCrudResource.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { RoomBlocksModal } from './RoomBlocksModal.jsx';
import { useRoomTypes } from './useRoomTypes.js';

const EMPTY_ROOM = { number: '', floor: '1', roomTypeId: '', notes: '' };

/**
 * @param {(key: string) => string} t @param {string} allLabel @param {readonly string[]} values
 * @param {string} prefix sözlük anahtarı öneki (ör. `roomPlan.occupancy.`)
 */
const filterOptions = (t, allLabel, values, prefix) => [
  { value: '', label: allLabel },
  ...values.map((value) => ({ value, label: t(`${prefix}${value}`) })),
];

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
  const t = useT();
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
      toastSuccess(
        t('roomPlan.roomList.housekeepingSaved', {
          room: updated.number,
          status: t(`roomPlan.housekeeping.${updated.housekeepingStatus}`),
        }),
      );
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
    { key: 'number', header: t('roomPlan.roomList.colRoom'), className: 'font-bold' },
    { key: 'floor', header: t('roomPlan.roomList.colFloor') },
    {
      key: 'roomType',
      header: t('roomPlan.roomList.colType'),
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
      header: t('roomPlan.filter.occupancy'),
      render: (row) => <OccupancyBadge occupancy={row.occupancy} />,
    },
    {
      key: 'housekeeping',
      header: t('roomPlan.filter.housekeeping'),
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
      header: t('roomPlan.filter.condition'),
      render: (row) => <ConditionCell room={row} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        actions={
          canManage && (
            <Button icon="plus" onClick={() => setEditing(EMPTY_ROOM)} disabled={roomTypes.length === 0}>
              {t('roomPlan.roomList.newRoom')}
            </Button>
          )
        }
      >
        <Input
          name="search"
          label={t('roomPlan.filter.search')}
          type="search"
          placeholder={t('roomPlan.roomList.searchPlaceholder')}
          value={resource.search}
          onChange={(event) => resource.setSearch(event.target.value)}
          className="w-full sm:w-40"
        />
        <Select
          name="roomTypeFilter"
          label={t('roomPlan.filter.roomType')}
          value={filters.roomTypeId}
          onChange={setFilter('roomTypeId')}
          options={[{ value: '', label: t('roomPlan.filter.allTypes') }, ...roomTypeOptions]}
          className="w-full sm:w-48"
        />
        <Select
          name="occupancyFilter"
          label={t('roomPlan.filter.occupancy')}
          value={filters.occupancy}
          onChange={setFilter('occupancy')}
          options={filterOptions(t, t('roomPlan.filter.allRooms'), ROOM_OCCUPANCIES, 'roomPlan.occupancy.')}
          className="w-full sm:w-36"
        />
        <Select
          name="housekeepingFilter"
          label={t('roomPlan.filter.housekeeping')}
          value={filters.housekeepingStatus}
          onChange={setFilter('housekeepingStatus')}
          options={filterOptions(t, t('roomPlan.filter.allStatuses'), HOUSEKEEPING_STATUSES, 'roomPlan.housekeeping.')}
          className="w-full sm:w-44"
        />
        <Select
          name="conditionFilter"
          label={t('roomPlan.filter.condition')}
          value={filters.condition}
          onChange={setFilter('condition')}
          options={filterOptions(t, t('common.all'), ROOM_CONDITIONS, 'roomPlan.condition.')}
          className="w-full sm:w-36"
        />
      </Toolbar>

      {roomTypes.length === 0 && canManage && (
        <Alert tone="warning" title={t('roomPlan.shared.noRoomTypes')}>
          {t('roomPlan.roomList.noTypesHint')}
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
        emptyTitle={hasFilter ? t('roomPlan.roomList.emptyFiltered') : t('roomPlan.roomList.emptyNone')}
        emptyHint={hasFilter ? t('roomPlan.roomList.emptyFilteredHint') : t('roomPlan.roomList.emptyNoneHint')}
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" icon="alertTriangle" onClick={() => setBlocksRoom(row)}>
              {row.openBlockCount > 0
                ? t('roomPlan.roomList.blocksCount', { count: row.openBlockCount })
                : t('roomPlan.roomList.blocks')}
            </Button>
            {canManage && (
              <>
                <Button variant="outline" size="sm" icon="pencil" onClick={() => setEditing(row)}>
                  {t('roomPlan.roomList.edit')}
                </Button>
                <Button variant="dangerSoft" size="sm" icon="trash" onClick={() => setDeleting(row)}>
                  {t('roomPlan.roomList.delete')}
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
        title={t('roomPlan.roomList.deleteTitle')}
        message={t('roomPlan.roomList.deleteMessage', { room: deleting?.number })}
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
  const t = useT();
  const options = HOUSEKEEPING_STATUSES.map((status) => {
    const blocked = housekeepingTransitionError(room.housekeepingStatus, status) !== null;
    const label = t(`roomPlan.housekeeping.${status}`);
    return {
      value: status,
      label: blocked ? t('roomPlan.roomList.mustCleanFirst', { status: label }) : label,
      disabled: blocked,
    };
  });

  return (
    <Select
      name={`housekeeping-${room.number}`}
      value={room.housekeepingStatus}
      aria-label={t('roomPlan.roomList.housekeepingAria', { room: room.number })}
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
  const t = useT();
  if (room.currentBlock) {
    return (
      <span className="flex flex-col items-start gap-1">
        <BlockTypeBadge type={room.currentBlock.type} />
        <span className="whitespace-nowrap text-xs text-ink-muted">
          {room.currentBlock.endDate
            ? t('roomPlan.roomList.endsOn', { date: formatDate(room.currentBlock.endDate) })
            : t('roomPlan.roomList.openEnded')}
        </span>
      </span>
    );
  }
  if (room.openBlockCount > 0) {
    return <span className="whitespace-nowrap text-xs font-semibold text-ink-muted">{t('roomPlan.roomList.upcoming')}</span>;
  }
  return <span className="text-ink-muted">—</span>;
}

function RoomFormModal({ initial, roomTypeOptions, onSubmit, onClose, isPending }) {
  const t = useT();
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
      title={initial.id ? t('roomPlan.roomList.editTitle') : t('roomPlan.roomList.newRoom')}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="room-form" icon="check" disabled={isPending}>
            {isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id="room-form" onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
        <Input label={t('roomPlan.roomList.number')} name="number" value={form.number} onChange={setField('number')} error={errors.number} />
        <Input label={t('roomPlan.filter.floor')} name="floor" type="number" value={form.floor} onChange={setField('floor')} error={errors.floor} />
        <Select
          label={t('roomPlan.filter.roomType')}
          name="roomTypeId"
          value={form.roomTypeId}
          onChange={setField('roomTypeId')}
          options={roomTypeOptions}
          error={errors.roomTypeId}
          className="sm:col-span-2"
        />
        <Textarea
          label={t('roomPlan.roomList.note')}
          name="notes"
          value={form.notes}
          onChange={setField('notes')}
          error={errors.notes}
          className="sm:col-span-2"
        />
      </form>
      {initial.id && (
        <Alert tone="info" className="mt-5">
          {t('roomPlan.roomList.typeChangeInfo')}
        </Alert>
      )}
    </Modal>
  );
}
