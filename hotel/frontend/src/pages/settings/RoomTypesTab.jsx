import { useState } from 'react';
import { roomTypeInputSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { useSettingsResource } from './useSettingsResource.js';

const EMPTY = { code: '', name: '', capacityAdults: '2', capacityChildren: '0', basePrice: '', description: '' };

export function RoomTypesTab() {
  const resource = useSettingsResource({ resource: 'room-types', labels: { singular: 'Oda tipi' } });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const columns = [
    {
      key: 'code',
      header: 'Kod',
      render: (row) => <span className="font-mono text-xs font-bold uppercase">{row.code}</span>,
    },
    { key: 'name', header: 'Ad', className: 'font-semibold' },
    {
      key: 'capacity',
      header: 'Kapasite',
      render: (row) => `${row.capacityAdults} yetişkin${row.capacityChildren > 0 ? ` + ${row.capacityChildren} çocuk` : ''}`,
    },
    {
      key: 'basePrice',
      header: 'Taban fiyat',
      className: 'tabular-nums',
      render: (row) => formatMoney(row.basePrice),
    },
    {
      key: 'roomCount',
      header: 'Oda sayısı',
      render: (row) => (row.roomCount === 0 ? <span className="text-ink-muted">henüz oda yok</span> : row.roomCount),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        actions={
          <Button icon="plus" onClick={() => setEditing(EMPTY)}>
            Yeni oda tipi
          </Button>
        }
      >
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Kod veya ada göre ara…"
          value={resource.search}
          onChange={(event) => resource.setSearch(event.target.value)}
          className="w-full sm:w-80"
        />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={resource.rows}
        meta={resource.meta}
        isLoading={resource.isLoading}
        isFetching={resource.isFetching}
        error={resource.error}
        onRetry={resource.refetch}
        onPageChange={resource.setPage}
        emptyTitle={resource.search ? 'Aramanızla eşleşen oda tipi yok' : 'Henüz oda tipi tanımlanmamış'}
        emptyHint={
          resource.search
            ? 'Farklı bir kod veya ad deneyin.'
            : 'Rezervasyon alabilmek için en az bir oda tipi tanımlamanız gerekir.'
        }
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
        <RoomTypeFormModal
          key={editing.id ?? 'new'}
          initial={editing}
          isPending={resource.createMutation.isPending || resource.updateMutation.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(values) => {
            const mutation = editing.id ? resource.updateMutation : resource.createMutation;
            const payload = editing.id
              ? { id: editing.id, values: { ...values, expectedUpdatedAt: editing.updatedAt } }
              : values;
            mutation.mutate(payload, { onSuccess: () => setEditing(null) });
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Oda tipini sil"
        message={`"${deleting?.name}" oda tipi silinecek. Bu oda tipine bağlı oda veya aktif rezervasyon varsa işlem reddedilir.`}
        isPending={resource.deleteMutation.isPending}
        error={resource.deleteMutation.error}
        onClose={() => {
          setDeleting(null);
          resource.deleteMutation.reset();
        }}
        onConfirm={() =>
          resource.deleteMutation.mutate(deleting.id, {
            onSuccess: () => setDeleting(null),
          })
        }
      />
    </div>
  );
}

function RoomTypeFormModal({ initial, onSubmit, onClose, isPending }) {
  const [form, setForm] = useState({
    code: initial.code ?? '',
    name: initial.name ?? '',
    capacityAdults: String(initial.capacityAdults ?? '2'),
    capacityChildren: String(initial.capacityChildren ?? '0'),
    basePrice: initial.basePrice ?? '',
    description: initial.description ?? '',
  });
  const [errors, setErrors] = useState({});

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    // Sunucunun kullandığı şemanın aynısı; kırpma/büyük harfe çevirme gibi
    // dönüşümleri de şema yapıyor, o yüzden sonucu doğrudan gönderiyoruz.
    const result = validateWith(roomTypeInputSchema, form);
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
      title={initial.id ? 'Oda tipini düzenle' : 'Yeni oda tipi'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="room-type-form" icon="check" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="room-type-form" onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
        <Input label="Kod" name="code" value={form.code} onChange={setField('code')} error={errors.code} />
        <Input label="Ad" name="name" value={form.name} onChange={setField('name')} error={errors.name} />
        <Input
          label="Yetişkin kapasitesi"
          name="capacityAdults"
          type="number"
          min="1"
          value={form.capacityAdults}
          onChange={setField('capacityAdults')}
          error={errors.capacityAdults}
        />
        <Input
          label="Çocuk kapasitesi"
          name="capacityChildren"
          type="number"
          min="0"
          value={form.capacityChildren}
          onChange={setField('capacityChildren')}
          error={errors.capacityChildren}
        />
        <Input
          label="Taban fiyat"
          name="basePrice"
          inputMode="decimal"
          value={form.basePrice}
          onChange={setField('basePrice')}
          error={errors.basePrice}
          placeholder="2500.00"
          className="sm:col-span-2"
        />
        <Textarea
          label="Açıklama"
          name="description"
          value={form.description}
          onChange={setField('description')}
          error={errors.description}
          className="sm:col-span-2"
        />
      </form>
      <Alert tone="info" className="mt-5">
        Taban fiyat, sezon çarpanıyla birlikte rezervasyon fiyatını belirler. Nokta ondalık ayracıdır (2500.50).
      </Alert>
    </Modal>
  );
}
