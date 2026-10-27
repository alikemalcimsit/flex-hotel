import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALLERGENS,
  ALLERGEN_LABELS,
  KITCHEN_UNIT_LABELS,
  STOCK_ITEM_GROUPS,
  STOCK_ITEM_GROUP_LABELS,
  STOCK_UNITS,
  createStockItemSchema,
  updateStockItemSchema,
} from '@hotelos/hotel-contracts';
import { Badge, Button, Checkbox, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { MultiChips } from '../../components/MultiChips.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { recipeKeys } from '../../lib/kitchen.js';
import { allergenText } from '../../lib/kitchenFormat.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 25;
const GROUP_OPTIONS = [{ value: '', label: 'Bütün gruplar' }, ...STOCK_ITEM_GROUPS.map((group) => ({ value: group, label: STOCK_ITEM_GROUP_LABELS[group] }))];
const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Kullanımda' },
  { value: 'false', label: 'Pasif' },
  { value: '', label: 'Hepsi' },
];

/**
 * Malzeme kartları (modül 43; 44'ün stok kartının yalın hâli): kod, ad, grup, stok birimi,
 * güncel birim maliyet (KDV hariç), alerjenler, kullanıldığı reçete satırı. Düzenlemek
 * `recipes.manage`. Depo, hareket ve hareketli ortalama maliyet stok modülünde gelir.
 */
export function StockItemsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.RECIPES_MANAGE);
  const { data: hotel } = useHotelContext();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [group, setGroup] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  useEffect(() => setPage(1), [search, group, active]);

  const filters = { search: search || undefined, group: group || undefined, active: active || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: recipeKeys.stock(filters), queryFn: () => api(withQuery('/recipes/stock-items', filters)), placeholderData: keepPreviousData });

  const columns = [
    {
      key: 'name',
      header: 'Malzeme',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.name}</span>
          {row.code && <span className="block font-mono text-xs text-ink-muted">{row.code}</span>}
        </span>
      ),
    },
    { key: 'group', header: 'Grup', render: (row) => STOCK_ITEM_GROUP_LABELS[row.group] },
    {
      key: 'cost',
      header: 'Birim maliyet',
      className: 'text-right tabular-nums',
      render: (row) => (
        <span className="block">
          <span className="block">
            {formatMoney(row.unitCost, hotel?.currency)} / {KITCHEN_UNIT_LABELS[row.unit]}
          </span>
          {Number(row.unitCost) === 0 ? <span className="block text-xs font-semibold text-warning-ink">maliyet girilmemiş</span> : <span className="block text-xs text-ink-muted">{formatDate(row.costUpdatedAt)}</span>}
        </span>
      ),
    },
    { key: 'allergens', header: 'Alerjen', render: (row) => <span className="text-xs text-ink-soft">{allergenText(row.allergens)}</span> },
    { key: 'used', header: 'Reçetede', className: 'text-right tabular-nums', render: (row) => row.usedInRecipes },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Kullanımda' : 'Pasif'}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setEditing('new')}>
              Malzeme ekle
            </Button>
          )
        }
      >
        <Input label="Ara" name="stock-search" placeholder="Ad ya da kod" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-64" />
        <Select label="Grup" name="stock-group" options={GROUP_OPTIONS} value={group} onChange={(event) => setGroup(event.target.value)} className="w-full sm:w-56" />
        <Select label="Durum" name="stock-active" options={ACTIVE_OPTIONS} value={active} onChange={(event) => setActive(event.target.value)} className="w-full sm:w-40" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search || group ? 'Eşleşen malzeme yok' : 'Malzeme kartı yok'}
        emptyHint={canManage && !search && !group ? 'Et, sebze, kuru gıda… her malzemenin stok birimini ve birim maliyetini girin; reçete maliyeti bunlardan hesaplanır.' : undefined}
        rowActions={
          canManage
            ? (row) => (
                <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(row)}>
                  Düzenle
                </Button>
              )
            : undefined
        }
      />
      {editing && <StockItemDialog item={editing === 'new' ? null : editing} currency={hotel?.currency} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** @param {{ item: any | null, currency?: string, onClose: () => void }} props */
function StockItemDialog({ item, currency, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() =>
    item
      ? { code: item.code ?? '', name: item.name, group: item.group, unit: item.unit, unitCost: item.unitCost, allergens: item.allergens, isActive: item.isActive }
      : { code: '', name: '', group: 'DRY_GOODS', unit: 'KG', unitCost: '', allergens: [], isActive: true },
  );
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const save = useMutation({
    mutationFn: (body) => (item ? api(`/recipes/stock-items/${item.id}`, { method: 'PUT', body: JSON.stringify(body) }) : apiPost('/recipes/stock-items', body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.all });
      toastSuccess(item ? 'Malzeme güncellendi' : 'Malzeme eklendi');
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: recipeKeys.all });
      toastError(error.code === 'STALE_WRITE' ? 'Malzeme bu arada değişti; liste yenilendi, tekrar açın.' : error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = item ? { ...values, code: values.code || null, expectedUpdatedAt: item.updatedAt } : { ...values, code: values.code || null };
    const checked = validateWith(item ? updateStockItemSchema : createStockItemSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  const usedHint = item?.usedInRecipes ? `${item.usedInRecipes} reçete satırında kullanılıyor: birim aynı ailede (kg ↔ g, L ↔ ml) değişebilir.` : 'Satın alınan / sayılan birim.';
  return (
    <Modal
      open
      size="md"
      title={item ? item.name : 'Yeni malzeme'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="stock-item-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="stock-item-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Ad" name="stock-name" value={values.name} onChange={set('name')} error={errors.name} required disabled={busy} className="sm:col-span-2" />
        <Input label="Kod (isteğe bağlı)" name="stock-code" value={values.code} onChange={set('code')} error={errors.code} disabled={busy} />
        <Select label="Grup" name="stock-group-field" options={STOCK_ITEM_GROUPS.map((value) => ({ value, label: STOCK_ITEM_GROUP_LABELS[value] }))} value={values.group} onChange={set('group')} error={errors.group} disabled={busy} />
        <div className="flex flex-col gap-1">
          <Select label="Stok birimi" name="stock-unit" options={STOCK_UNITS.map((value) => ({ value, label: KITCHEN_UNIT_LABELS[value] }))} value={values.unit} onChange={set('unit')} error={errors.unit} disabled={busy} />
          <p className="text-xs text-ink-muted">{usedHint}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Input
            label={`Birim maliyet (${currency ?? ''} / ${KITCHEN_UNIT_LABELS[values.unit]}, KDV hariç)`}
            name="stock-cost"
            inputMode="decimal"
            value={values.unitCost}
            onChange={set('unitCost')}
            error={errors.unitCost}
            required
            disabled={busy}
          />
          <p className="text-xs text-ink-muted">Son alış fiyatı; stok modülü gelince hareketli ortalama maliyet buraya yazılır.</p>
        </div>
        <div className="sm:col-span-2">
          <MultiChips
            label="Alerjenler"
            options={ALLERGENS.map((value) => ({ value, label: ALLERGEN_LABELS[value] }))}
            values={values.allergens}
            onChange={(allergens) => setValues((current) => ({ ...current, allergens }))}
            disabled={busy}
            error={errors.allergens}
          />
        </div>
        {item && (
          <Checkbox
            label="Kullanımda"
            hint="Pasif malzeme yeni reçete satırına seçilmez; kayıtlı reçetelerde hesaba girmeye devam eder."
            checked={values.isActive}
            onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
            disabled={busy}
            className="sm:col-span-2"
          />
        )}
      </form>
    </Modal>
  );
}
