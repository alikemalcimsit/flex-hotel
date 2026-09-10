import { useState } from 'react';
import { seasonInputSchema } from '@hotelos/hotel-contracts';
import { Button, Card, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { formatDate, formatMultiplier } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { useSettingsResource } from './useSettingsResource.js';

const EMPTY = { name: '', startDate: '', endDate: '', multiplier: '1' };

export function SeasonsTab() {
  const resource = useSettingsResource({ resource: 'seasons', labels: { singular: 'Sezon' } });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const columns = [
    { key: 'name', header: 'Ad' },
    { key: 'startDate', header: 'Başlangıç', render: (row) => formatDate(row.startDate) },
    { key: 'endDate', header: 'Bitiş', render: (row) => formatDate(row.endDate) },
    {
      key: 'multiplier',
      header: 'Çarpan',
      render: (row) => {
        const value = Number(row.multiplier);
        const tone = value > 1 ? 'bg-orange-100 text-orange-800' : value < 1 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700';
        return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{formatMultiplier(row.multiplier)}</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          name="search"
          placeholder="Sezon adına göre ara…"
          value={resource.search}
          onChange={(event) => resource.setSearch(event.target.value)}
          className="w-72"
        />
        <Button onClick={() => setEditing(EMPTY)}>Yeni sezon</Button>
      </div>

      <DataTable
        columns={columns}
        rows={resource.rows}
        meta={resource.meta}
        isLoading={resource.isLoading}
        isFetching={resource.isFetching}
        error={resource.error}
        onRetry={resource.refetch}
        onPageChange={resource.setPage}
        emptyTitle={resource.search ? 'Aramanızla eşleşen sezon yok' : 'Henüz sezon tanımlanmamış'}
        emptyHint={
          resource.search ? undefined : 'Sezon tanımlanmayan günlerde oda tipinin taban fiyatı geçerli olur (çarpan 1).'
        }
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
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
        <SeasonFormModal
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
        title="Sezonu sil"
        message={`"${deleting?.name}" sezonu silinecek. Bu tarihlerde taban fiyat (çarpan 1) geçerli olur.`}
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

function SeasonFormModal({ initial, onSubmit, onClose, isPending }) {
  const [form, setForm] = useState({
    name: initial.name ?? '',
    startDate: initial.startDate ?? '',
    endDate: initial.endDate ?? '',
    multiplier: initial.multiplier ?? '1',
  });
  const [errors, setErrors] = useState({});

  const setField = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateWith(seasonInputSchema, form);
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
      title={initial.id ? 'Sezonu düzenle' : 'Yeni sezon'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="season-form" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="season-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Sezon adı"
          name="name"
          value={form.name}
          onChange={setField('name')}
          error={errors.name}
          className="sm:col-span-2"
        />
        <Input
          label="Başlangıç"
          name="startDate"
          type="date"
          value={form.startDate}
          onChange={setField('startDate')}
          error={errors.startDate}
        />
        <Input
          label="Bitiş"
          name="endDate"
          type="date"
          value={form.endDate}
          onChange={setField('endDate')}
          error={errors.endDate}
        />
        <Input
          label="Fiyat çarpanı"
          name="multiplier"
          inputMode="decimal"
          value={form.multiplier}
          onChange={setField('multiplier')}
          error={errors.multiplier}
          placeholder="1.3"
          className="sm:col-span-2"
        />
      </form>
      <Card className="mt-4 border-amber-100 bg-amber-50 p-3 shadow-none">
        <p className="text-xs text-amber-900">
          Sezonlar birbiriyle çakışamaz — aynı güne iki çarpan düşerse hangi fiyatın geçerli olduğu belirsiz kalır.
          Çakışan tarih girerseniz kayıt reddedilir. Başlangıç ve bitiş günleri sezona dahildir.
        </p>
      </Card>
    </Modal>
  );
}
