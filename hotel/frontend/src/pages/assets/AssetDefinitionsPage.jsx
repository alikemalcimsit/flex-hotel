import { useState } from 'react';
import { assetAreaSchema, assetCategorySchema, depreciationRatePct, updateAssetAreaSchema, updateAssetCategorySchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Input, Spinner } from '@hotelos/ui';
import { useAssetAreas, useAssetCategories, useDefinitionSave } from '../../lib/assetQueries.js';
import { formatPercent } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { AssetDialog, useAssetAccess } from './AssetFields.jsx';

/**
 * Demirbaş tanımları (modül 46): kategoriler (faydalı ömür → VUK oranı; yeni karta kopyalanır, mevcut kartlar
 * değişmez) ve alanlar (oda dışı konumlar: lobi, restoran, depo…). Kullanılan tanım silinmez, pasifleştirilir.
 */
export function AssetDefinitionsPage() {
  const access = useAssetAccess();
  const [showInactive, setShowInactive] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Checkbox label="Pasif tanımları da göster" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
      <div className="grid gap-6 xl:grid-cols-2">
        <CategoriesCard includeInactive={showInactive} canManage={access.manage} />
        <AreasCard includeInactive={showInactive} canManage={access.manage} />
      </div>
    </div>
  );
}

/** @param {{ includeInactive: boolean, canManage: boolean }} props */
function CategoriesCard({ includeInactive, canManage }) {
  const query = useAssetCategories(includeInactive);
  const save = useDefinitionSave('categories');
  const [values, setValues] = useState({ name: '', usefulLifeYears: '' });
  const [errors, setErrors] = useState({});
  const [editing, setEditing] = useState(null);
  const life = Number(values.usefulLifeYears);

  function add(event) {
    event.preventDefault();
    const checked = validateWith(assetCategorySchema, values);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(
      { body: checked.data, message: `${checked.data.name} eklendi` },
      { onSuccess: () => setValues({ name: '', usefulLifeYears: '' }), onError: (error) => setErrors(error.fields ?? {}) },
    );
  }

  return (
    <Card title="Kategoriler" description="Faydalı ömür (yıl) VUK amortisman oranını belirler (oran = 1 / ömür) ve yeni karta kopyalanır.">
      {canManage && (
        <form onSubmit={add} noValidate className="mb-4 grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <Input label="Kategori adı" name="asset-category-name" value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} error={errors.name} placeholder="ör. Mobilya" disabled={save.isPending} />
          <Input
            label={`Ömür (yıl)${life >= 1 ? ` · ${formatPercent(depreciationRatePct(life))}` : ''}`}
            name="asset-category-life"
            inputMode="numeric"
            value={values.usefulLifeYears}
            onChange={(event) => setValues((current) => ({ ...current, usefulLifeYears: event.target.value }))}
            error={errors.usefulLifeYears}
            disabled={save.isPending}
          />
          <Button type="submit" icon="plus" disabled={save.isPending}>
            Ekle
          </Button>
        </form>
      )}
      <DefinitionList
        query={query}
        empty="Henüz kategori yok."
        render={(item) => (
          <>
            <span className="font-semibold">{item.name}</span>
            <span className="text-xs text-ink-muted">
              {item.usefulLifeYears} yıl · {formatPercent(depreciationRatePct(item.usefulLifeYears))} · {item.assetCount} kart
            </span>
          </>
        )}
        onEdit={canManage ? setEditing : null}
      />
      {editing && <EditDefinitionDialog kind="categories" item={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

/** @param {{ includeInactive: boolean, canManage: boolean }} props */
function AreasCard({ includeInactive, canManage }) {
  const query = useAssetAreas(includeInactive);
  const save = useDefinitionSave('areas');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState({});
  const [editing, setEditing] = useState(null);

  function add(event) {
    event.preventDefault();
    const checked = validateWith(assetAreaSchema, { name });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate({ body: checked.data, message: `${checked.data.name} eklendi` }, { onSuccess: () => setName(''), onError: (error) => setErrors(error.fields ?? {}) });
  }

  return (
    <Card title="Alanlar" description="Oda dışındaki konumlar. Odalar oda listesinden gelir.">
      {canManage && (
        <form onSubmit={add} noValidate className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Input label="Alan adı" name="asset-area-name" value={name} onChange={(event) => setName(event.target.value)} error={errors.name} placeholder="ör. Lobi" disabled={save.isPending} />
          <Button type="submit" icon="plus" disabled={save.isPending}>
            Ekle
          </Button>
        </form>
      )}
      <DefinitionList
        query={query}
        empty="Henüz alan yok."
        render={(item) => (
          <>
            <span className="font-semibold">{item.name}</span>
            <span className="text-xs text-ink-muted">{item.assetCount} kart</span>
          </>
        )}
        onEdit={canManage ? setEditing : null}
      />
      {editing && <EditDefinitionDialog kind="areas" item={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

/**
 * @param {{ query: any, empty: string, render: (item: any) => React.ReactNode, onEdit: ((item: any) => void) | null }} props
 */
function DefinitionList({ query, empty, render, onEdit }) {
  if (query.isPending) return <Spinner className="py-4" />;
  if (query.isError) return <Alert tone="danger" title="Okunamadı">{query.error.message}</Alert>;
  if (query.data.items.length === 0) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {query.data.items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
          <span className="flex min-w-0 flex-col">{render(item)}</span>
          <span className="flex shrink-0 items-center gap-2">
            {!item.isActive && <Badge tone="neutral">Pasif</Badge>}
            {onEdit && (
              <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => onEdit(item)}>
                Düzelt
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Tanımı düzelt / pasifleştir. Kategori ömrü değişince yalnız yeni kartlar etkilenir.
 * @param {{ kind: 'categories' | 'areas', item: any, onClose: () => void }} props
 */
function EditDefinitionDialog({ kind, item, onClose }) {
  const category = kind === 'categories';
  const save = useDefinitionSave(kind);
  const [values, setValues] = useState({ name: item.name, usefulLifeYears: category ? String(item.usefulLifeYears) : '', isActive: item.isActive });
  const [errors, setErrors] = useState({});

  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: item.updatedAt, name: values.name, isActive: values.isActive, ...(category ? { usefulLifeYears: values.usefulLifeYears } : {}) };
    const checked = validateWith(category ? updateAssetCategorySchema : updateAssetAreaSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    save.mutate({ id: item.id, body: checked.data, message: `${checked.data.name ?? item.name} güncellendi` }, { onSuccess: onClose, onError: (error) => setErrors(error.fields ?? {}) });
  }

  return (
    <AssetDialog id="asset-definition-edit" title={`Düzelt · ${item.name}`} busy={save.isPending} onClose={onClose} submitLabel="Kaydet" onSubmit={submit}>
      <Input label="Ad" name="asset-definition-name" value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} error={errors.name} disabled={save.isPending} />
      {category && (
        <>
          <Input
            label="Faydalı ömür (yıl)"
            name="asset-definition-life"
            inputMode="numeric"
            value={values.usefulLifeYears}
            onChange={(event) => setValues((current) => ({ ...current, usefulLifeYears: event.target.value }))}
            error={errors.usefulLifeYears}
            disabled={save.isPending}
          />
          <p className="text-xs text-ink-muted">Ömür değişikliği yalnız bundan sonra açılan kartlara uygulanır; mevcut kartların ömrü kartlarında kalır.</p>
        </>
      )}
      <Checkbox label="Etkin (yeni kartlarda seçilebilir)" checked={values.isActive} onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))} disabled={save.isPending} />
    </AssetDialog>
  );
}
