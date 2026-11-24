import { useState } from 'react';
import {
  ASSET_A4_LABELS_PER_SHEET,
  ASSET_DISPOSAL_TYPES,
  ASSET_DISPOSAL_TYPE_LABELS,
  ASSET_LABEL_FORMATS,
  ASSET_LABEL_FORMAT_LABELS,
  assignAssetSchema,
  disposalResult,
  disposeAssetSchema,
  returnAssetSchema,
  transferAssetSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Input, Select, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { assetLabelsHtml, locationValue, parseLocationValue } from '../../lib/assets.js';
import { fetchAssetLabels, useAssetAction, useAssetOptions } from '../../lib/assetQueries.js';
import { formatMoney } from '../../lib/format.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { AssetDialog, EmployeeSelect, LocationSelect } from './AssetFields.jsx';

/**
 * Demirbaş kartının işlem diyalogları (modül 46): taşı, zimmetle, iade al, elden çıkar ve etiket yazdır. Girdiler
 * sunucunun şemasıyla önceden doğrulanır; sunucu hatası alanın altına ve bildirime düşer.
 */

const LABEL_FORMAT_OPTIONS = ASSET_LABEL_FORMATS.map((value) => ({ value, label: ASSET_LABEL_FORMAT_LABELS[value] }));
const DISPOSAL_OPTIONS = ASSET_DISPOSAL_TYPES.map((value) => ({ value, label: ASSET_DISPOSAL_TYPE_LABELS[value] }));

/** @param {(errors: Record<string, string>) => void} setErrors */
const fieldErrors = (setErrors) => (error) => setErrors(error.fields ?? {});

/**
 * Taşı: başka bir odaya ya da alana (geçmişe eski / yeni yer yazılır).
 * @param {{ asset: any, onClose: () => void }} props
 */
export function TransferAssetDialog({ asset, onClose }) {
  const options = useAssetOptions();
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const action = useAssetAction({ onDone: onClose });
  const current = locationValue(asset);

  function submit(event) {
    event.preventDefault();
    if (location === current) return setErrors({ location: 'Demirbaş zaten burada' });
    const checked = validateWith(transferAssetSchema, { expectedUpdatedAt: asset.updatedAt, ...parseLocationValue(location), note: note || null });
    if (!checked.ok) return setErrors({ location: checked.errors.areaId ?? checked.errors.roomId, note: checked.errors.note });
    setErrors({});
    action.mutate({ assetId: asset.id, path: 'transfer', body: checked.data, message: (saved) => `${saved.code} → ${saved.location.label}` }, { onError: fieldErrors(setErrors) });
  }

  return (
    <AssetDialog id="asset-transfer" title={`Taşı · ${asset.code}`} busy={action.isPending} onClose={onClose} submitLabel="Taşı" icon="arrowRight" onSubmit={submit}>
      <p className="text-sm text-ink-soft">
        {asset.name} · şu an <strong>{asset.location.label}</strong>
      </p>
      <LocationSelect label="Yeni konum" value={location} onChange={setLocation} options={options.data} error={errors.location} disabled={action.isPending || options.isPending} />
      <Input label="Not (isteğe bağlı)" name="asset-transfer-note" value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={action.isPending} />
    </AssetDialog>
  );
}

/**
 * Zimmetle: bordro personel kartına (zimmetliyse yenisine devredilir).
 * @param {{ asset: any, onClose: () => void }} props
 */
export function AssignAssetDialog({ asset, onClose }) {
  const options = useAssetOptions();
  const [employeeId, setEmployeeId] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const action = useAssetAction({ onDone: onClose });
  const employees = (options.data?.employees ?? []).filter((employee) => employee.id !== asset.employee?.id);

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(assignAssetSchema, { expectedUpdatedAt: asset.updatedAt, employeeId, note: note || null });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    action.mutate({ assetId: asset.id, path: 'assign', body: checked.data, message: (saved) => `${saved.code} → ${saved.employee?.name ?? 'zimmet'}` }, { onError: fieldErrors(setErrors) });
  }

  return (
    <AssetDialog id="asset-assign" title={`Zimmetle · ${asset.code}`} busy={action.isPending} onClose={onClose} submitLabel="Zimmetle" icon="user" onSubmit={submit}>
      <p className="text-sm text-ink-soft">
        {asset.name}
        {asset.employee ? ` · şu an ${asset.employee.name} zimmetinde (devredilir)` : ''}
      </p>
      <EmployeeSelect value={employeeId} onChange={setEmployeeId} employees={employees} error={errors.employeeId} disabled={action.isPending || options.isPending} />
      {options.isSuccess && employees.length === 0 && <p className="text-xs text-warning-ink">Çalışan personel kartı yok; personel Personel ekranından eklenir.</p>}
      <Input label="Not (isteğe bağlı)" name="asset-assign-note" value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={action.isPending} />
    </AssetDialog>
  );
}

/**
 * Zimmetten iade al.
 * @param {{ asset: any, onClose: () => void }} props
 */
export function ReturnAssetDialog({ asset, onClose }) {
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const action = useAssetAction({ onDone: onClose });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(returnAssetSchema, { expectedUpdatedAt: asset.updatedAt, note: note || null });
    if (!checked.ok) return setErrors(checked.errors);
    action.mutate({ assetId: asset.id, path: 'return', body: checked.data, message: (saved) => `${saved.code} iade alındı` }, { onError: fieldErrors(setErrors) });
  }

  return (
    <AssetDialog id="asset-return" title={`İade al · ${asset.code}`} busy={action.isPending} onClose={onClose} submitLabel="İade alındı" icon="rotateCcw" onSubmit={submit}>
      <p className="text-sm text-ink-soft">
        {asset.name} · {asset.employee?.name} ({asset.employee?.code}) zimmetinden iade alınır.
      </p>
      <Input label="Not (isteğe bağlı)" name="asset-return-note" value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={action.isPending} />
    </AssetDialog>
  );
}

/**
 * Elden çıkar (satış / hurda / kayıp): net değer ve satıştaki kâr / zarar önizlemesi. VUK: elden çıkarıldığı yıl
 * amortisman ayrılmaz; kalan net değer o yıl gider olur. Geri alınamaz.
 * @param {{ asset: any, onClose: () => void }} props
 */
export function DisposeAssetDialog({ asset, onClose }) {
  const { today } = useHotelToday();
  const [values, setValues] = useState({ type: 'SCRAPPED', disposedOn: today, price: '', reason: '' });
  const [errors, setErrors] = useState({});
  const action = useAssetAction({ onDone: onClose });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const sold = values.type === 'SOLD';
  const priceText = values.price.replace(',', '.');
  const preview = disposalResult({ cost: asset.cost, accumulated: asset.accumulated, price: sold && /^\d+(\.\d{1,2})?$/.test(priceText) ? priceText : null });
  const gain = Number(preview.gainLoss);

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(disposeAssetSchema, { expectedUpdatedAt: asset.updatedAt, ...values, price: sold ? values.price : null });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    action.mutate({ assetId: asset.id, path: 'dispose', body: checked.data, message: (saved) => `${saved.code} elden çıkarıldı` }, { onError: fieldErrors(setErrors) });
  }

  return (
    <AssetDialog id="asset-dispose" title={`Elden çıkar · ${asset.code}`} busy={action.isPending} onClose={onClose} submitLabel="Elden çıkar" icon="trash" variant="danger" onSubmit={submit}>
      <p className="text-sm text-ink-soft">{asset.name}</p>
      <ChoiceChips label="Tür" options={DISPOSAL_OPTIONS} value={values.type} onChange={(type) => setValues((current) => ({ ...current, type, price: type === 'SOLD' ? current.price : '' }))} disabled={action.isPending} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Tarih" name="asset-disposed-on" type="date" value={values.disposedOn} onChange={set('disposedOn')} error={errors.disposedOn} disabled={action.isPending} />
        {sold && <Input label="Satış bedeli (KDV hariç)" name="asset-disposal-price" inputMode="decimal" value={values.price} onChange={set('price')} error={errors.price} disabled={action.isPending} />}
      </div>
      <Textarea label="Açıklama" name="asset-disposal-reason" rows={2} value={values.reason} onChange={set('reason')} error={errors.reason} disabled={action.isPending} placeholder="ör. Tamiri ekonomik değil, hurdaya ayrıldı" />
      <dl className="grid grid-cols-2 gap-2 rounded-card bg-surface-muted p-3 text-sm">
        <dt className="text-ink-muted">Maliyet</dt>
        <dd className="text-right tabular-nums">{formatMoney(asset.cost)}</dd>
        <dt className="text-ink-muted">Birikmiş amortisman</dt>
        <dd className="text-right tabular-nums">{formatMoney(asset.accumulated)}</dd>
        <dt className="font-semibold">Net değer</dt>
        <dd className="text-right font-semibold tabular-nums">{formatMoney(preview.bookValue)}</dd>
        {sold && (
          <>
            <dt className="font-semibold">{gain >= 0 ? 'Satış kârı' : 'Satış zararı'}</dt>
            <dd className={`text-right font-semibold tabular-nums ${gain >= 0 ? 'text-success-ink' : 'text-danger-ink'}`}>{formatMoney(String(Math.abs(gain)))}</dd>
          </>
        )}
      </dl>
      <Alert tone="warning" title="Geri alınamaz">
        Elden çıkarıldığı yıl amortisman ayrılmaz; kalan net değer o yılın gideri olur. Zimmet varsa kalkar.
      </Alert>
    </AssetDialog>
  );
}

/**
 * Etiket yazdır: kâğıt (termal 50 × 30 ya da A4 3 × 8) ve A4'te başlangıç konumu. Pencere tıklama anında açılır
 * (açılır pencere engeline takılmasın), etiket bilgileri gelince belge yazılıp yazdırılır.
 * @param {{ ids: string[], onClose: () => void }} props
 */
export function AssetLabelDialog({ ids, onClose }) {
  const [format, setFormat] = useState(ASSET_LABEL_FORMATS[0]);
  const [start, setStart] = useState('1');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const a4 = format === 'A4_3x8';

  async function submit(event) {
    event.preventDefault();
    const position = Number(start);
    if (a4 && (!Number.isInteger(position) || position < 1 || position > ASSET_A4_LABELS_PER_SHEET)) return setError(`Başlangıç 1–${ASSET_A4_LABELS_PER_SHEET} arası olmalı`);
    const view = window.open('', '_blank', 'width=900,height=700');
    if (!view) return setError('Yazdırma penceresi açılamadı; tarayıcının açılır pencere iznini verin.');
    setBusy(true);
    setError(null);
    try {
      const labels = await fetchAssetLabels(ids);
      view.document.open();
      view.document.write(assetLabelsHtml({ items: labels.items, hotelName: labels.hotelName, format, start: position, origin: window.location.origin }));
      view.document.close();
      view.focus();
      view.print();
      onClose();
    } catch (failure) {
      view.close();
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AssetDialog id="asset-labels" title={`Etiket yazdır · ${ids.length} demirbaş`} busy={busy} onClose={onClose} submitLabel="Yazdır" icon="fileText" onSubmit={submit}>
      <Select label="Kâğıt" name="asset-label-format" value={format} onChange={(event) => setFormat(event.target.value)} options={LABEL_FORMAT_OPTIONS} disabled={busy} />
      {a4 && (
        <Input
          label={`Başlangıç konumu (1–${ASSET_A4_LABELS_PER_SHEET})`}
          name="asset-label-start"
          inputMode="numeric"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          disabled={busy}
        />
      )}
      <p className="text-xs text-ink-muted">
        Etikette QR (telefon kamerasıyla okutunca kart açılır; sayımda 2D okuyucuyla okutulur), demirbaş kodu ve adı basılır.
        {a4 ? ' Yarım kalmış A4 sayfasında ilk boş etiketin sırasını yazın (soldan sağa, yukarıdan aşağı).' : ' Yazıcının kâğıt boyutunu 50 × 30 mm, kenar boşluğunu sıfır seçin.'}
      </p>
      {error && <Alert tone="danger" title="Yazdırılamadı">{error}</Alert>}
    </AssetDialog>
  );
}
