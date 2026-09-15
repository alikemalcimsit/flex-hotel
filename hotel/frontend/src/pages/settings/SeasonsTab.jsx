import { useState } from 'react';
import { seasonInputSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { formatDate, formatMultiplier } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { useSettingsResource } from './useSettingsResource.js';

const EMPTY = { name: '', startDate: '', endDate: '', multiplier: '1' };

/** Çarpan rozeti: pahalı sezon turuncu, indirimli sezon mavi, taban fiyat nötr. */
function multiplierTone(multiplier) {
  const value = Number(multiplier);
  if (value > 1) return 'warning';
  if (value < 1) return 'info';
  return 'neutral';
}

export function SeasonsTab() {
  const resource = useSettingsResource({ resource: 'seasons', labels: { singular: 'Sezon' } });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const columns = [
    { key: 'name', header: 'Ad', className: 'font-semibold' },
    { key: 'startDate', header: 'Başlangıç', render: (row) => formatDate(row.startDate) },
    { key: 'endDate', header: 'Bitiş', render: (row) => formatDate(row.endDate) },
    {
      key: 'multiplier',
      header: 'Çarpan',
      render: (row) => (
        <Badge tone={multiplierTone(row.multiplier)} dot={false} className="tabular-nums">
          {formatMultiplier(row.multiplier)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        actions={
          <Button icon="plus" onClick={() => setEditing(EMPTY)}>
            Yeni sezon
          </Button>
        }
      >
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Sezon adına göre ara…"
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
        emptyTitle={resource.search ? 'Aramanızla eşleşen sezon yok' : 'Henüz sezon tanımlanmamış'}
        emptyHint={
          resource.search ? undefined : 'Sezon tanımlanmayan günlerde oda tipinin taban fiyatı geçerli olur (çarpan 1).'
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
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="season-form" icon="check" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="season-form" onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
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
      <Alert tone="warning" className="mt-5">
        Sezonlar birbiriyle çakışamaz — aynı güne iki çarpan düşerse hangi fiyatın geçerli olduğu belirsiz kalır.
        Çakışan tarih girerseniz kayıt reddedilir. Başlangıç ve bitiş günleri sezona dahildir.
      </Alert>
    </Modal>
  );
}
