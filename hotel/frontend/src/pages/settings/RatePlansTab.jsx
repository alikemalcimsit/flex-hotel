import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BOARD_TYPES, BOARD_TYPE_LABELS, ratePlanInputSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { useCrudResource } from '../../lib/useCrudResource.js';

const BOARD_OPTIONS = BOARD_TYPES.map((value) => ({ value, label: BOARD_TYPE_LABELS[value] }));

const EMPTY = {
  roomTypeId: '',
  name: '',
  boardType: 'BB',
  startDate: '',
  endDate: '',
  price: '',
  baseOccupancy: '2',
  extraAdultRate: '0',
  childRate: '0',
  minStay: '',
  isActive: true,
};

/**
 * Fiyat planları (modül 28): oda tipi × pansiyon × tarih aralığında sabit
 * gecelik fiyat. Sezon çarpanının yerine geçer; plan olan gecede taban fiyat ×
 * çarpan değil, planın fiyatı (kişi başı ek dahil) uygulanır.
 */
export function RatePlansTab() {
  const resource = useCrudResource({ basePath: '/pricing/rate-plans', queryKey: ['pricing', 'rate-plans'], labels: { singular: 'Fiyat planı' } });
  const roomTypes = useQuery({ queryKey: ['settings', 'room-types', 'all'], queryFn: () => api('/settings/room-types?pageSize=200') });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const columns = [
    { key: 'roomTypeName', header: 'Oda tipi', className: 'font-semibold' },
    { key: 'name', header: 'Ad' },
    { key: 'boardType', header: 'Pansiyon', render: (row) => <Badge tone="neutral" dot={false}>{BOARD_TYPE_LABELS[row.boardType] ?? row.boardType}</Badge> },
    { key: 'period', header: 'Dönem', render: (row) => `${formatDate(row.startDate)} – ${formatDate(row.endDate)}` },
    { key: 'price', header: 'Gecelik', className: 'tabular-nums', render: (row) => formatMoney(row.price) },
    {
      key: 'extras',
      header: 'Kişi başı ek',
      className: 'tabular-nums',
      render: (row) =>
        Number(row.extraAdultRate) || Number(row.childRate)
          ? `+${formatMoney(row.extraAdultRate)} yetişkin · +${formatMoney(row.childRate)} çocuk`
          : '—',
    },
    { key: 'isActive', header: 'Durum', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'} dot={false}>{row.isActive ? 'Aktif' : 'Pasif'}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        actions={
          <Button icon="plus" onClick={() => setEditing(EMPTY)} disabled={!roomTypes.data?.items?.length}>
            Yeni plan
          </Button>
        }
      >
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Plan adına göre ara…"
          value={resource.search}
          onChange={(event) => resource.setSearch(event.target.value)}
          className="w-full sm:w-80"
        />
      </Toolbar>

      {roomTypes.data && !roomTypes.data.items.length && (
        <Alert tone="info" title="Önce oda tipi tanımlayın">
          Fiyat planı bir oda tipine bağlanır. Oda tipleri sekmesinden en az bir oda tipi ekleyin.
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
        emptyTitle={resource.search ? 'Aramanızla eşleşen plan yok' : 'Henüz fiyat planı tanımlanmamış'}
        emptyHint={resource.search ? undefined : 'Plan tanımlanmayan günlerde oda tipinin taban fiyatı × sezon çarpanı geçerli olur.'}
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
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
        <RatePlanFormModal
          key={editing.id ?? 'new'}
          initial={editing}
          roomTypes={roomTypes.data?.items ?? []}
          isPending={resource.createMutation.isPending || resource.updateMutation.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(values) => {
            const mutation = editing.id ? resource.updateMutation : resource.createMutation;
            const payload = editing.id ? { id: editing.id, values: { ...values, expectedUpdatedAt: editing.updatedAt } } : values;
            mutation.mutate(payload, { onSuccess: () => setEditing(null) });
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Fiyat planını sil"
        message={`"${deleting?.name}" planı silinecek. Bu tarihlerde oda tipinin taban fiyatı × sezon çarpanı geçerli olur.`}
        isPending={resource.deleteMutation.isPending}
        error={resource.deleteMutation.error}
        onClose={() => {
          setDeleting(null);
          resource.deleteMutation.reset();
        }}
        onConfirm={() => resource.deleteMutation.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}

function RatePlanFormModal({ initial, roomTypes, onSubmit, onClose, isPending }) {
  const [form, setForm] = useState({
    roomTypeId: initial.roomTypeId ?? '',
    name: initial.name ?? '',
    boardType: initial.boardType ?? 'BB',
    startDate: initial.startDate ?? '',
    endDate: initial.endDate ?? '',
    price: initial.price ?? '',
    baseOccupancy: String(initial.baseOccupancy ?? '2'),
    extraAdultRate: initial.extraAdultRate ?? '0',
    childRate: initial.childRate ?? '0',
    minStay: initial.minStay == null ? '' : String(initial.minStay),
    isActive: initial.isActive ?? true,
  });
  const [errors, setErrors] = useState({});

  const setField = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateWith(ratePlanInputSchema, { ...form, minStay: form.minStay === '' ? null : form.minStay });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.data);
  }

  const roomTypeOptions = [{ value: '', label: 'Oda tipi seçin', disabled: true }, ...roomTypes.map((type) => ({ value: type.id, label: `${type.code} — ${type.name}` }))];

  return (
    <Modal
      open
      title={initial.id ? 'Fiyat planını düzenle' : 'Yeni fiyat planı'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="rate-plan-form" icon="check" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="rate-plan-form" onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
        <Select label="Oda tipi" name="roomTypeId" value={form.roomTypeId} onChange={setField('roomTypeId')} options={roomTypeOptions} error={errors.roomTypeId} />
        <Select label="Pansiyon" name="boardType" value={form.boardType} onChange={setField('boardType')} options={BOARD_OPTIONS} error={errors.boardType} />
        <Input label="Plan adı" name="name" value={form.name} onChange={setField('name')} error={errors.name} placeholder="Ör. Yaz BB" className="sm:col-span-2" />
        <Input label="Başlangıç" name="startDate" type="date" value={form.startDate} onChange={setField('startDate')} error={errors.startDate} />
        <Input label="Bitiş" name="endDate" type="date" value={form.endDate} onChange={setField('endDate')} error={errors.endDate} />
        <Input label="Gecelik fiyat" name="price" inputMode="decimal" value={form.price} onChange={setField('price')} error={errors.price} placeholder="3000" />
        <Input label="Fiyata dahil kişi" name="baseOccupancy" type="number" min={1} max={20} value={form.baseOccupancy} onChange={setField('baseOccupancy')} error={errors.baseOccupancy} />
        <Input label="Kişi başı ek (yetişkin)" name="extraAdultRate" inputMode="decimal" value={form.extraAdultRate} onChange={setField('extraAdultRate')} error={errors.extraAdultRate} placeholder="0" />
        <Input label="Çocuk başı ek" name="childRate" inputMode="decimal" value={form.childRate} onChange={setField('childRate')} error={errors.childRate} placeholder="0" />
        <Input label="En az konaklama (gece, opsiyonel)" name="minStay" type="number" min={1} max={365} value={form.minStay} onChange={setField('minStay')} error={errors.minStay} placeholder="—" />
        <div className="flex items-center sm:col-span-2">
          <Checkbox label="Aktif (satışta kullanılsın)" name="isActive" checked={form.isActive} onChange={setField('isActive')} />
        </div>
      </form>
      <Alert tone="warning" className="mt-5">
        Aynı oda tipi + pansiyon için planların tarihleri çakışamaz — bir geceye tek plan düşmeli. Fiyat, "fiyata dahil kişi"
        sayısı içindir; fazla yetişkin ve çocuk, kişi başı ek tutarlarla eklenir. Başlangıç ve bitiş günleri plana dahildir.
      </Alert>
    </Modal>
  );
}
