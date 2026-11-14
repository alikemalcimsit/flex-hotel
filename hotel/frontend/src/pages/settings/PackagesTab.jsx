import { useState } from 'react';
import { BOARD_TYPES, BOARD_TYPE_LABELS, MAX_PACKAGE_COMPONENTS, packageInputSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { useCrudResource } from '../../lib/useCrudResource.js';

const BOARD_OPTIONS = BOARD_TYPES.map((value) => ({ value, label: BOARD_TYPE_LABELS[value] }));

const EMPTY = { code: '', name: '', description: '', boardType: 'HB', nightlyPrice: '', components: [], isActive: true };

/**
 * Paketler (modül 28): oda + ek hizmet (SPA, transfer, ...) demeti. Rezervasyona
 * seçildiğinde pansiyon paketten gelir ve oda gece fiyatı paketin gecelik
 * fiyatından hesaplanır (sezon / plan / promosyon uygulanmaz).
 */
export function PackagesTab() {
  const resource = useCrudResource({ basePath: '/pricing/packages', queryKey: ['pricing', 'packages'], labels: { singular: 'Paket' } });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const columns = [
    { key: 'code', header: 'Kod', className: 'font-semibold' },
    { key: 'name', header: 'Ad' },
    { key: 'boardType', header: 'Pansiyon', render: (row) => <Badge tone="neutral" dot={false}>{BOARD_TYPE_LABELS[row.boardType] ?? row.boardType}</Badge> },
    { key: 'nightlyPrice', header: 'Gecelik', className: 'tabular-nums', render: (row) => formatMoney(row.nightlyPrice) },
    { key: 'components', header: 'Bileşen', render: (row) => `${row.components?.length ?? 0} bileşen` },
    { key: 'isActive', header: 'Durum', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'} dot={false}>{row.isActive ? 'Aktif' : 'Pasif'}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Toolbar
        actions={
          <Button icon="plus" onClick={() => setEditing(EMPTY)}>
            Yeni paket
          </Button>
        }
      >
        <Input
          name="search"
          label="Ara"
          type="search"
          placeholder="Paket adı ya da koduna göre ara…"
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
        emptyTitle={resource.search ? 'Aramanızla eşleşen paket yok' : 'Henüz paket tanımlanmamış'}
        emptyHint={resource.search ? undefined : 'Paket, oda ve ek hizmetleri tek gecelik fiyatta birleştirir; rezervasyon formunda seçilir.'}
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
        <PackageFormModal
          key={editing.id ?? 'new'}
          initial={editing}
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
        title="Paketi sil"
        message={`"${deleting?.name}" paketi silinecek. Bu paketle açılmış rezervasyonların fiyatı değişmez.`}
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

function PackageFormModal({ initial, onSubmit, onClose, isPending }) {
  const [form, setForm] = useState({
    code: initial.code ?? '',
    name: initial.name ?? '',
    description: initial.description ?? '',
    boardType: initial.boardType ?? 'HB',
    nightlyPrice: initial.nightlyPrice ?? '',
    components: (initial.components ?? []).map((component) => ({ label: component.label ?? '', note: component.note ?? '' })),
    isActive: initial.isActive ?? true,
  });
  const [errors, setErrors] = useState({});

  const setField = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const addComponent = () => setForm((current) => ({ ...current, components: [...current.components, { label: '', note: '' }] }));
  const removeComponent = (index) => setForm((current) => ({ ...current, components: current.components.filter((_, i) => i !== index) }));
  const setComponent = (index, key, value) =>
    setForm((current) => ({ ...current, components: current.components.map((component, i) => (i === index ? { ...component, [key]: value } : component)) }));

  function handleSubmit(event) {
    event.preventDefault();
    // Boş bileşen satırları gönderilmez; not boşsa alan dışarı düşer.
    const components = form.components
      .filter((component) => component.label.trim())
      .map((component) => (component.note.trim() ? { label: component.label, note: component.note } : { label: component.label }));
    const result = validateWith(packageInputSchema, { ...form, description: form.description || null, components });
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
      title={initial.id ? 'Paketi düzenle' : 'Yeni paket'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="package-form" icon="check" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="package-form" onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
        <Input label="Kod" name="code" value={form.code} onChange={setField('code')} error={errors.code} placeholder="BALAYI" />
        <Select label="Pansiyon" name="boardType" value={form.boardType} onChange={setField('boardType')} options={BOARD_OPTIONS} error={errors.boardType} />
        <Input label="Paket adı" name="name" value={form.name} onChange={setField('name')} error={errors.name} placeholder="Balayı Paketi" className="sm:col-span-2" />
        <Input label="Gecelik paket fiyatı" name="nightlyPrice" inputMode="decimal" value={form.nightlyPrice} onChange={setField('nightlyPrice')} error={errors.nightlyPrice} placeholder="5000" />
        <div className="flex items-center">
          <Checkbox label="Aktif (satışta seçilebilsin)" name="isActive" checked={form.isActive} onChange={setField('isActive')} />
        </div>
        <Textarea label="Açıklama (opsiyonel)" name="description" value={form.description} onChange={setField('description')} error={errors.description} className="sm:col-span-2" />

        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Bileşenler (SPA, transfer, …)</span>
            <Button type="button" size="sm" variant="outline" icon="plus" onClick={addComponent} disabled={form.components.length >= MAX_PACKAGE_COMPONENTS}>
              Bileşen ekle
            </Button>
          </div>
          {form.components.length === 0 && <p className="text-xs text-ink-muted">Bileşen, pakete dahil hizmetleri gösterir (fiyata zaten dahildir).</p>}
          <div className="flex flex-col gap-2">
            {form.components.map((component, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2 rounded-item border border-line p-2">
                <Input label="Bileşen" value={component.label} onChange={(event) => setComponent(index, 'label', event.target.value)} className="flex-1" placeholder="SPA" />
                <Input label="Not (opsiyonel)" value={component.note} onChange={(event) => setComponent(index, 'note', event.target.value)} className="flex-1" placeholder="çift masaj" />
                <Button type="button" size="sm" variant="dangerSoft" icon="trash" onClick={() => removeComponent(index)}>
                  Sil
                </Button>
              </div>
            ))}
          </div>
        </div>
      </form>
      <Alert tone="info" className="mt-5">
        Paket seçilen rezervasyonda pansiyon paketten gelir ve oda gece fiyatı paketin gecelik fiyatıdır. Sezon, fiyat planı ve
        promosyon uygulanmaz; acente satışı ve elle fiyatla birlikte kullanılmaz.
      </Alert>
    </Modal>
  );
}
