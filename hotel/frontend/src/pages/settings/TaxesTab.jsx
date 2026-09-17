import { useState } from 'react';
import { TAX_APPLIES_TO, taxInputSchema } from '@hotelos/hotel-contracts';
import { Badge, Button, Checkbox, ERROR_CLASS, Input, LABEL_CLASS } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { formatPercent, TAX_APPLIES_TO_LABELS } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { useSettingsResource } from './useSettingsResource.js';

const EMPTY = { name: '', rate: '', isIncluded: true, appliesTo: ['ROOM'] };

export function TaxesTab() {
  const resource = useSettingsResource({ resource: 'taxes', labels: { singular: 'Vergi' } });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const columns = [
    { key: 'name', header: 'Ad', className: 'font-semibold' },
    { key: 'rate', header: 'Oran', className: 'tabular-nums', render: (row) => formatPercent(row.rate) },
    {
      key: 'isIncluded',
      header: 'Fiyata dahil',
      render: (row) => (row.isIncluded ? <Badge tone="success">Dahil</Badge> : <Badge>Hariç</Badge>),
    },
    {
      key: 'appliesTo',
      header: 'Uygulandığı kalemler',
      render: (row) =>
        row.appliesTo.length === 0 ? (
          <span className="text-ink-muted">—</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {row.appliesTo.map((key) => (
              <span key={key} className="rounded-item border border-line px-2 py-0.5 text-xs font-semibold text-ink-soft">
                {TAX_APPLIES_TO_LABELS[key] ?? key}
              </span>
            ))}
          </div>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        actions={
          <Button icon="plus" onClick={() => setEditing(EMPTY)}>
            Yeni vergi
          </Button>
        }
      >
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Vergi adına göre ara…"
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
        emptyTitle={resource.search ? 'Aramanızla eşleşen vergi yok' : 'Henüz vergi tanımlanmamış'}
        emptyHint={resource.search ? undefined : 'KDV gibi vergiler burada tanımlanır ve folyo kalemlerine uygulanır.'}
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
        <TaxFormModal
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
        title="Vergiyi sil"
        message={`"${deleting?.name}" vergisi silinecek. Geçmiş folyo kalemlerinde kullanılmışsa işlem reddedilir.`}
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

function TaxFormModal({ initial, onSubmit, onClose, isPending }) {
  const [form, setForm] = useState({
    name: initial.name ?? '',
    rate: initial.rate ?? '',
    isIncluded: initial.isIncluded ?? true,
    appliesTo: initial.appliesTo ?? ['ROOM'],
  });
  const [errors, setErrors] = useState({});

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const toggleAppliesTo = (key) => {
    setForm((current) => ({
      ...current,
      appliesTo: current.appliesTo.includes(key)
        ? current.appliesTo.filter((item) => item !== key)
        : [...current.appliesTo, key],
    }));
    setErrors((current) => ({ ...current, appliesTo: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    const result = validateWith(taxInputSchema, form);
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
      title={initial.id ? 'Vergiyi düzenle' : 'Yeni vergi'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="tax-form" icon="check" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="tax-form" onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Vergi adı"
            name="name"
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
            error={errors.name}
          />
          <Input
            label="Oran (%)"
            name="rate"
            inputMode="decimal"
            value={form.rate}
            onChange={(event) => setField('rate', event.target.value)}
            error={errors.rate}
            placeholder="10"
          />
        </div>

        <Checkbox
          label="Fiyata dahil"
          name="isIncluded"
          hint="İşaretliyse ilan edilen fiyat vergiyi içerir; değilse vergi folyoya ayrı kalem olarak eklenir."
          checked={form.isIncluded}
          onChange={(event) => setField('isIncluded', event.target.checked)}
        />

        <fieldset className="rounded-panel border border-line p-4">
          <legend className={`px-1.5 ${LABEL_CLASS}`}>Uygulandığı kalem tipleri</legend>
          <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TAX_APPLIES_TO.map((key) => (
              <Checkbox
                key={key}
                name={`appliesTo-${key}`}
                label={TAX_APPLIES_TO_LABELS[key]}
                checked={form.appliesTo.includes(key)}
                onChange={() => toggleAppliesTo(key)}
              />
            ))}
          </div>
          {errors.appliesTo && <p className={`mt-2 ${ERROR_CLASS}`}>{errors.appliesTo}</p>}
        </fieldset>
      </form>
    </Modal>
  );
}
