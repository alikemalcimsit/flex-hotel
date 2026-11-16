import { useState } from 'react';
import { createAssetSchema, depreciationRatePct, updateAssetSchema } from '@hotelos/hotel-contracts';
import { Alert, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { locationValue, parseLocationValue } from '../../lib/assets.js';
import { useAssetAction, useAssetOptions } from '../../lib/assetQueries.js';
import { formatPercent } from '../../lib/format.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { AssetDialog, EmployeeSelect, LocationSelect } from './AssetFields.jsx';

/**
 * Demirbaş kartı formu (modül 46): yeni kart ya da düzeltme. Faydalı ömür kategoriden gelir (değiştirilebilir);
 * alış yılı bu yıldan önceyse sistemden önce ayrılmış amortisman (açılış) yazılır. Kaydedilmiş amortismanı olan
 * kartın finansal alanları kilitlidir (önce son yılın kaydı geri alınır). Konum ve zimmet düzeltmede kendi
 * işlemleriyle değişir (taşı / zimmetle).
 */

/** @param {any} asset */
function initialValues(asset) {
  return {
    name: asset?.name ?? '',
    categoryId: asset?.categoryId ?? '',
    brand: asset?.brand ?? '',
    model: asset?.model ?? '',
    serialNumber: asset?.serialNumber ?? '',
    location: asset ? locationValue(asset) : '',
    employeeId: '',
    purchaseDate: asset?.purchaseDate ?? '',
    cost: asset?.cost ?? '',
    usefulLifeYears: asset?.usefulLifeYears ? String(asset.usefulLifeYears) : '',
    openingAccumulated: asset && Number(asset.openingAccumulated) > 0 ? asset.openingAccumulated : '',
    openingThroughYear: asset?.openingThroughYear ? String(asset.openingThroughYear) : '',
    supplierName: asset?.supplierName ?? '',
    invoiceNumber: asset?.invoiceNumber ?? '',
    warrantyUntil: asset?.warrantyUntil ?? '',
    note: asset?.note ?? '',
  };
}

/** @param {string} value */
const orNull = (value) => (value === '' ? null : value);
/** @param {string} value */
const intOrNull = (value) => (value === '' ? null : Number(value));

/**
 * @param {{ asset?: any, onClose: () => void, onDone?: (asset: any) => void }} props `asset` yoksa yeni kart
 */
export function AssetFormDialog({ asset, onClose, onDone }) {
  const editing = Boolean(asset);
  const locked = Boolean(asset?.financialsLocked);
  const options = useAssetOptions();
  const { today } = useHotelToday();
  const [requestId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState(() => initialValues(asset));
  const [errors, setErrors] = useState({});
  const action = useAssetAction({ onDone: (saved) => (onDone ?? onClose)(saved) });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const categories = options.data?.categories ?? [];
  const purchaseYear = Number(values.purchaseDate.slice(0, 4)) || null;
  const showOpening = Boolean(values.openingAccumulated) || (purchaseYear !== null && purchaseYear < Number(today.slice(0, 4)));
  const life = Number(values.usefulLifeYears);

  /** Kategori seçilince ömür kategorinin varsayılanına gelir (elle yazılmışsa da — kullanıcı sonra değiştirebilir). */
  const pickCategory = (event) => {
    const category = categories.find((item) => item.id === event.target.value);
    setValues((current) => ({ ...current, categoryId: event.target.value, usefulLifeYears: !locked && category ? String(category.usefulLifeYears) : current.usefulLifeYears }));
  };

  function body() {
    const identity = {
      name: values.name,
      categoryId: values.categoryId,
      brand: orNull(values.brand),
      model: orNull(values.model),
      serialNumber: orNull(values.serialNumber),
      supplierName: orNull(values.supplierName),
      invoiceNumber: orNull(values.invoiceNumber),
      warrantyUntil: orNull(values.warrantyUntil),
      note: orNull(values.note),
    };
    const financial = {
      purchaseDate: values.purchaseDate,
      cost: values.cost,
      usefulLifeYears: intOrNull(values.usefulLifeYears),
      openingAccumulated: orNull(values.openingAccumulated),
      openingThroughYear: intOrNull(values.openingThroughYear),
    };
    if (editing) return { expectedUpdatedAt: asset.updatedAt, ...identity, ...(locked ? {} : financial) };
    return { requestId, ...identity, ...financial, ...parseLocationValue(values.location), employeeId: orNull(values.employeeId) };
  }

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(editing ? updateAssetSchema : createAssetSchema, body());
    if (!checked.ok) return setErrors({ ...checked.errors, location: checked.errors.areaId ?? checked.errors.roomId });
    setErrors({});
    action.mutate(
      editing
        ? { assetId: asset.id, path: '', body: checked.data, message: (saved) => `${saved.code} güncellendi` }
        : { path: 'create', body: checked.data, message: (saved) => `${saved.code} kaydedildi` },
      { onError: (failure) => setErrors({ ...failure.fields, location: failure.fields?.areaId ?? failure.fields?.roomId }) },
    );
  }

  const busy = action.isPending;
  if (options.isPending) {
    return (
      <AssetDialog id="asset-form" title={editing ? `Düzelt · ${asset.code}` : 'Yeni demirbaş'} busy onClose={onClose} submitLabel="Kaydet" onSubmit={(event) => event.preventDefault()}>
        <Spinner className="py-6" />
      </AssetDialog>
    );
  }
  return (
    <AssetDialog id="asset-form" size="lg" title={editing ? `Düzelt · ${asset.code}` : 'Yeni demirbaş'} busy={busy} onClose={onClose} submitLabel="Kaydet" onSubmit={submit}>
      {options.isError && <Alert tone="danger" title="Seçenekler okunamadı">{options.error.message}</Alert>}
      {!editing && categories.length === 0 && options.isSuccess && (
        <Alert tone="warning" title="Kategori yok">Önce Tanımlar sekmesinden en az bir kategori (faydalı ömrüyle) ve alan ekleyin.</Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Demirbaş adı" name="asset-name" value={values.name} onChange={set('name')} error={errors.name} disabled={busy} className="sm:col-span-2" />
        <Select label="Kategori" name="asset-category" value={values.categoryId} onChange={pickCategory} options={[{ value: '', label: 'Kategori seçin' }, ...categories.map((item) => ({ value: item.id, label: `${item.name} · ${item.usefulLifeYears} yıl` }))]} error={errors.categoryId} disabled={busy} />
        {!editing ? (
          <LocationSelect value={values.location} onChange={(location) => setValues((current) => ({ ...current, location }))} options={options.data} error={errors.location} disabled={busy} />
        ) : (
          <Input label="Konum" name="asset-location-readonly" value={asset.location?.label ?? ''} disabled readOnly />
        )}
        <Input label="Marka" name="asset-brand" value={values.brand} onChange={set('brand')} error={errors.brand} disabled={busy} />
        <Input label="Model" name="asset-model" value={values.model} onChange={set('model')} error={errors.model} disabled={busy} />
        <Input label="Seri no" name="asset-serial" value={values.serialNumber} onChange={set('serialNumber')} error={errors.serialNumber} disabled={busy} />
        {!editing && (
          <EmployeeSelect label="Zimmet (isteğe bağlı)" value={values.employeeId} onChange={(employeeId) => setValues((current) => ({ ...current, employeeId }))} employees={options.data?.employees} placeholder="Zimmet yok" error={errors.employeeId} disabled={busy} />
        )}
      </div>

      <fieldset className="grid gap-3 rounded-card border border-line p-4 sm:grid-cols-3" disabled={busy || locked}>
        <legend className="px-1 text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Alış ve amortisman</legend>
        {locked && (
          <p className="text-xs text-warning-ink sm:col-span-3">
            Bu kartın {asset.lastPostedYear} yılına kadar amortismanı kaydedildi; alış tarihi, tutar ve ömür değişmez. Düzeltmek için önce son yılın amortisman kaydını geri alın.
          </p>
        )}
        <Input label="Alış tarihi" name="asset-purchase-date" type="date" value={values.purchaseDate} onChange={set('purchaseDate')} error={errors.purchaseDate} />
        <Input label="Tutar (KDV hariç)" name="asset-cost" inputMode="decimal" value={values.cost} onChange={set('cost')} error={errors.cost} placeholder="ör. 18500" />
        <Input
          label={`Faydalı ömür (yıl)${life >= 1 ? ` · oran ${formatPercent(depreciationRatePct(life))}` : ''}`}
          name="asset-life"
          inputMode="numeric"
          value={values.usefulLifeYears}
          onChange={set('usefulLifeYears')}
          error={errors.usefulLifeYears}
          placeholder="kategoriden"
        />
        {showOpening && (
          <>
            <Input label="Önceki yıllarda ayrılan amortisman" name="asset-opening" inputMode="decimal" value={values.openingAccumulated} onChange={set('openingAccumulated')} error={errors.openingAccumulated} placeholder="yoksa boş" className="sm:col-span-2" />
            <Input label="Hangi yıla kadar (dahil)" name="asset-opening-year" inputMode="numeric" value={values.openingThroughYear} onChange={set('openingThroughYear')} error={errors.openingThroughYear} placeholder={String(Number(today.slice(0, 4)) - 1)} />
            <p className="text-xs text-ink-muted sm:col-span-3">Sistemden önce (eski programda / defterde) ayrılmış toplam amortisman. Kalan net değer, ömrün kalan yıllarına eşit dağıtılır.</p>
          </>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Tedarikçi" name="asset-supplier" value={values.supplierName} onChange={set('supplierName')} error={errors.supplierName} disabled={busy} />
        <Input label="Fatura no" name="asset-invoice" value={values.invoiceNumber} onChange={set('invoiceNumber')} error={errors.invoiceNumber} disabled={busy} />
        <Input label="Garanti bitiş" name="asset-warranty" type="date" value={values.warrantyUntil} onChange={set('warrantyUntil')} error={errors.warrantyUntil} disabled={busy} />
      </div>
      <Textarea label="Not" name="asset-note" rows={2} value={values.note} onChange={set('note')} error={errors.note} disabled={busy} />
    </AssetDialog>
  );
}
