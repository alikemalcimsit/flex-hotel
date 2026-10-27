import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  POS_OUTLET_KINDS,
  POS_OUTLET_KIND_LABELS,
  POS_STATIONS,
  POS_STATION_LABELS,
  ROOM_SERVICE_POLICY_LIMITS,
  TAX_APPLIES_TO,
  TAX_APPLIES_TO_LABELS,
  bulkPosTablesSchema,
  createMenuCategorySchema,
  createMenuItemSchema,
  createPosOutletSchema,
  createPosTableSchema,
  updatePosSettingsSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { MultiChips } from '../../components/MultiChips.jsx';
import { Switch } from '../../components/Switch.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { posKeys, useDebounced, usePosOutlets } from '../../lib/pos.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 25;
const SECTIONS = Object.freeze([
  { value: 'menu', label: 'Ürünler' },
  { value: 'gruplar', label: 'Menü grupları' },
  { value: 'masalar', label: 'Masalar' },
  { value: 'noktalar', label: 'Satış noktaları' },
  { value: 'politika', label: 'Politika' },
]);

/**
 * Restoran tanımları (modül 39 ve 38'in menü kısmı): ürünler (fiyat vergi dahil, vergi
 * kategorisi, mutfak istasyonu, tükendi), menü grupları (satış noktasına göre kısıt),
 * masalar (toplu ekleme), satış noktaları (odaya yaz açık / kapalı) ve politika (dört göz
 * eşiği, kasa farkı uyarısı). Silme yok: satılan kayıt pasife alınır.
 */
export function SetupPage() {
  const [params, setParams] = useSearchParams();
  const section = SECTIONS.some((entry) => entry.value === params.get('bolum')) ? params.get('bolum') : 'menu';
  return (
    <div className="flex flex-col gap-4">
      <ChoiceChips label="Tanım bölümü" required options={SECTIONS} value={section} onChange={(value) => setParams(value === 'menu' ? {} : { bolum: value }, { replace: true })} />
      {section === 'menu' && <ItemsSection />}
      {section === 'gruplar' && <CategoriesSection />}
      {section === 'masalar' && <TablesSection />}
      {section === 'noktalar' && <OutletsSection />}
      {section === 'politika' && <SettingsSection />}
    </div>
  );
}

/** Kaydet / güncelle kalıbı: başarıda tazele + bildir; hatada alanlar. */
function useSave(onDone, setErrors) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method, body }) => (method === 'PUT' ? apiPut(path, body) : apiPost(path, body)),
    onSuccess: (result, { message }) => {
      queryClient.invalidateQueries({ queryKey: posKeys.all });
      toastSuccess(message);
      onDone(result);
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: posKeys.all });
      toastError(error.message);
    },
  });
}

/** @param {{ id: string, title: string, busy: boolean, onClose: () => void, onSubmit: (event: any) => void, children: React.ReactNode }} props */
function EditDialog({ id, title, busy, onClose, onSubmit, children }) {
  return (
    <Modal
      open
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={id} icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id={id} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {children}
      </form>
    </Modal>
  );
}

/* ══════════════════ Ürünler ══════════════════ */

function ItemsSection() {
  const can = useCan();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [categoryId, setCategoryId] = useState('');
  const [active, setActive] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  useEffect(() => setPage(1), [search, categoryId, active]);
  const categories = useQuery({ queryKey: posKeys.categories, queryFn: () => api('/pos/menu/categories') });
  const filters = { search, categoryId, active, page };
  const list = useQuery({
    queryKey: posKeys.items(filters),
    queryFn: () => api(withQuery('/pos/menu/items', { search: search || undefined, categoryId: categoryId || undefined, active: active || undefined, page, pageSize: PAGE_SIZE })),
    placeholderData: keepPreviousData,
  });
  const queryClient = useQueryClient();
  const soldOut = useMutation({
    mutationFn: ({ id, value }) => apiPut(`/pos/menu/items/${id}/sold-out`, { soldOut: value }),
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: posKeys.all });
      toastSuccess(item.soldOut ? `${item.name} tükendi` : `${item.name} yeniden satışta`);
    },
    onError: (error) => toastError(error.message),
  });
  const categoryOptions = (categories.data?.items ?? []).map((entry) => ({ value: entry.id, label: entry.name }));
  const canToggle = can(PERMISSIONS.POS_SUPERVISE);

  const columns = [
    {
      key: 'name',
      header: 'Ürün',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">
            {row.code ? <span className="font-mono">{row.code}</span> : 'kodsuz'} · {row.categoryName}
          </span>
        </span>
      ),
    },
    { key: 'price', header: 'Fiyat', className: 'text-right tabular-nums', render: (row) => <span className="font-semibold">{formatMoney(row.price)}</span> },
    {
      key: 'tax',
      header: 'Vergi / istasyon',
      render: (row) => (
        <span className="text-xs">
          {TAX_APPLIES_TO_LABELS[row.taxCategory]} · {POS_STATION_LABELS[row.station]}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Durum',
      render: (row) => (
        <span className="flex items-center gap-2">
          {!row.isActive && <Badge tone="neutral">Pasif</Badge>}
          {canToggle ? (
            <Switch checked={row.soldOut} onChange={(value) => soldOut.mutate({ id: row.id, value })} label={`${row.name} tükendi`} showLabel busy={soldOut.isPending && soldOut.variables?.id === row.id} />
          ) : (
            row.soldOut && <Badge tone="danger">Tükendi</Badge>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input label="Ara" name="pos-items-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Ad ya da kod" />
        <Select label="Grup" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} options={[{ value: '', label: 'Bütün gruplar' }, ...categoryOptions]} />
        <Select
          label="Durum"
          value={active}
          onChange={(event) => setActive(event.target.value)}
          options={[
            { value: '', label: 'Hepsi' },
            { value: 'true', label: 'Aktif' },
            { value: 'false', label: 'Pasif' },
          ]}
        />
        <Button type="button" icon="plus" onClick={() => setEditing({})} disabled={categoryOptions.length === 0}>
          Ürün ekle
        </Button>
      </div>
      {categories.isSuccess && categoryOptions.length === 0 && <Alert tone="info" title="Önce menü grubu ekleyin">Ürün bir menü grubuna bağlıdır (ana yemek, içecek…).</Alert>}
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search || categoryId || active ? 'Süzgece uyan ürün yok' : 'Menüde ürün yok'}
        emptyHint="“Ürün ekle” ile fiyatı (vergi dahil), vergi kategorisini ve mutfak istasyonunu girin."
        rowActions={(row) => (
          <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(row)}>
            Düzenle
          </Button>
        )}
      />
      {editing && <ItemDialog item={editing} categories={categoryOptions} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** @param {{ item: any, categories: Array<{ value: string, label: string }>, onClose: () => void }} props */
function ItemDialog({ item, categories, onClose }) {
  const isNew = !item.id;
  const [values, setValues] = useState({
    categoryId: item.categoryId ?? categories[0]?.value ?? '',
    code: item.code ?? '',
    name: item.name ?? '',
    description: item.description ?? '',
    price: item.price ?? '',
    taxCategory: item.taxCategory ?? 'FNB',
    station: item.station ?? 'HOT',
    isActive: item.isActive ?? true,
    sortOrder: String(item.sortOrder ?? 0),
  });
  const [errors, setErrors] = useState({});
  const save = useSave(onClose, setErrors);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(createMenuItemSchema, values);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(
      isNew
        ? { path: '/pos/menu/items', method: 'POST', body: values, message: 'Ürün eklendi' }
        : { path: `/pos/menu/items/${item.id}`, method: 'PUT', body: { ...values, expectedUpdatedAt: item.updatedAt }, message: 'Ürün güncellendi; fiyat yeni siparişlere yansır' },
    );
  }

  const busy = save.isPending;
  return (
    <EditDialog id="pos-item-form" title={isNew ? 'Ürün ekle' : `Ürün: ${item.name}`} busy={busy} onClose={onClose} onSubmit={submit}>
      <Select label="Menü grubu" value={values.categoryId} onChange={set('categoryId')} options={categories} error={errors.categoryId} disabled={busy} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Input label="Ad" name="pos-item-name" value={values.name} onChange={set('name')} error={errors.name} required disabled={busy} />
        <Input label="Kod (isteğe bağlı)" name="pos-item-code" value={values.code} onChange={set('code')} error={errors.code} disabled={busy} />
      </div>
      <Textarea label="Açıklama" name="pos-item-description" rows={2} value={values.description} onChange={set('description')} error={errors.description} disabled={busy} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Fiyat (vergi dahil)" name="pos-item-price" inputMode="decimal" value={values.price} onChange={set('price')} error={errors.price} required disabled={busy} />
        <Select label="Vergi kategorisi" value={values.taxCategory} onChange={set('taxCategory')} options={TAX_APPLIES_TO.map((value) => ({ value, label: TAX_APPLIES_TO_LABELS[value] }))} error={errors.taxCategory} disabled={busy} />
        <Select label="Mutfak istasyonu" value={values.station} onChange={set('station')} options={POS_STATIONS.map((value) => ({ value, label: POS_STATION_LABELS[value] }))} error={errors.station} disabled={busy} />
      </div>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
        <Input label="Sıra" name="pos-item-sort" type="number" min={0} value={values.sortOrder} onChange={set('sortOrder')} error={errors.sortOrder} disabled={busy} />
        <Checkbox label="Satışta (aktif)" checked={values.isActive} onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))} disabled={busy} />
      </div>
    </EditDialog>
  );
}

/* ══════════════════ Menü grupları ══════════════════ */

function CategoriesSection() {
  const categories = useQuery({ queryKey: posKeys.categories, queryFn: () => api('/pos/menu/categories') });
  const outlets = usePosOutlets();
  const [editing, setEditing] = useState(null);
  const outletNames = new Map((outlets.data?.items ?? []).map((outlet) => [outlet.id, outlet.name]));
  return (
    <Card
      title="Menü grupları"
      description="Terminalde ürünleri ayıran gruplar. Satış noktası seçilmezse grup her yerde satılır (ör. puro yalnızca barda)."
      actions={
        <Button type="button" size="sm" icon="plus" onClick={() => setEditing({})}>
          Grup ekle
        </Button>
      }
    >
      {categories.isPending && <Spinner className="py-6" />}
      {categories.isError && <Alert tone="danger" title="Gruplar yüklenemedi">{categories.error.message}</Alert>}
      {categories.isSuccess && categories.data.items.length === 0 && <EmptyState icon="list" title="Menü grubu yok" description="Ana yemek, içecek, tatlı gibi grupları ekleyin." />}
      {categories.data?.items.length > 0 && (
        <ul className="divide-y divide-line">
          {categories.data.items.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="font-semibold text-ink">{entry.name}</span>
              {!entry.isActive && <Badge tone="neutral">Pasif</Badge>}
              <span className="text-xs text-ink-muted">
                {entry.itemCount} ürün · {entry.outletIds.length ? entry.outletIds.map((id) => outletNames.get(id) ?? '?').join(', ') : 'her satış noktası'}
              </span>
              <Button type="button" size="sm" variant="ghost" icon="pencil" className="ml-auto" onClick={() => setEditing(entry)}>
                Düzenle
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <CategoryDialog category={editing} outlets={outlets.data?.items ?? []} onClose={() => setEditing(null)} />}
    </Card>
  );
}

/** @param {{ category: any, outlets: any[], onClose: () => void }} props */
function CategoryDialog({ category, outlets, onClose }) {
  const isNew = !category.id;
  const [values, setValues] = useState({ name: category.name ?? '', sortOrder: String(category.sortOrder ?? 0), isActive: category.isActive ?? true, outletIds: category.outletIds ?? [] });
  const [errors, setErrors] = useState({});
  const save = useSave(onClose, setErrors);

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(createMenuCategorySchema, values);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(
      isNew
        ? { path: '/pos/menu/categories', method: 'POST', body: values, message: 'Grup eklendi' }
        : { path: `/pos/menu/categories/${category.id}`, method: 'PUT', body: { ...values, expectedUpdatedAt: category.updatedAt }, message: 'Grup güncellendi' },
    );
  }

  const busy = save.isPending;
  return (
    <EditDialog id="pos-category-form" title={isNew ? 'Menü grubu ekle' : `Grup: ${category.name}`} busy={busy} onClose={onClose} onSubmit={submit}>
      <Input label="Ad" name="pos-category-name" value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} error={errors.name} required disabled={busy} />
      <MultiChips
        label="Satıldığı yerler"
        allLabel="Her satış noktası"
        options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
        values={values.outletIds}
        onChange={(outletIds) => setValues((current) => ({ ...current, outletIds }))}
        error={errors.outletIds}
        disabled={busy}
      />
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
        <Input label="Sıra" name="pos-category-sort" type="number" min={0} value={values.sortOrder} onChange={(event) => setValues((current) => ({ ...current, sortOrder: event.target.value }))} error={errors.sortOrder} disabled={busy} />
        <Checkbox label="Aktif" checked={values.isActive} onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))} disabled={busy} />
      </div>
    </EditDialog>
  );
}

/* ══════════════════ Masalar ══════════════════ */

function TablesSection() {
  const outlets = usePosOutlets();
  const [outletId, setOutletId] = useState('');
  const [editing, setEditing] = useState(null);
  const [bulk, setBulk] = useState(false);
  const selected = outletId || outlets.data?.items[0]?.id || '';
  const tables = useQuery({ queryKey: posKeys.tables(selected), queryFn: () => api(`/pos/outlets/${selected}/tables`), enabled: Boolean(selected) });
  if (outlets.isPending) return <Spinner className="py-6" />;
  if (!outlets.data?.items.length) return <Alert tone="info" title="Önce satış noktası ekleyin">Masalar bir satış noktasına bağlıdır.</Alert>;
  return (
    <Card
      title="Masalar"
      description="Masa planındaki kutular. Açık adisyonu olan masa başka satış noktasına taşınamaz ve pasife alınamaz."
      actions={
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" icon="layers" onClick={() => setBulk(true)}>
            Toplu ekle
          </Button>
          <Button type="button" size="sm" icon="plus" onClick={() => setEditing({ outletId: selected })}>
            Masa ekle
          </Button>
        </div>
      }
    >
      <ChoiceChips label="Satış noktası" required options={outlets.data.items.map((outlet) => ({ value: outlet.id, label: outlet.name }))} value={selected} onChange={setOutletId} className="mb-3" />
      {tables.isPending && <Spinner className="py-6" />}
      {tables.isError && <Alert tone="danger" title="Masalar yüklenemedi">{tables.error.message}</Alert>}
      {tables.isSuccess && tables.data.items.length === 0 && <EmptyState icon="layers" title="Masa yok" description="“Toplu ekle” ile 1–24 gibi bir aralığı tek seferde ekleyin." />}
      {tables.data?.items.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
          {tables.data.items.map((table) => (
            <li key={table.id}>
              <button
                type="button"
                onClick={() => setEditing(table)}
                className={`flex w-full flex-col rounded-item border px-3 py-2 text-left text-sm hover:border-ink ${table.isActive ? 'border-line' : 'border-dashed border-line-strong text-ink-muted'}`}
              >
                <span className="font-bold">{table.name}</span>
                <span className="text-xs text-ink-muted">
                  {table.seats} kişi{table.zone ? ` · ${table.zone}` : ''}
                  {table.isActive ? '' : ' · pasif'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <TableDialog table={editing} outlets={outlets.data.items} onClose={() => setEditing(null)} />}
      {bulk && <BulkTablesDialog outletId={selected} onClose={() => setBulk(false)} />}
    </Card>
  );
}

/** @param {{ table: any, outlets: any[], onClose: () => void }} props */
function TableDialog({ table, outlets, onClose }) {
  const isNew = !table.id;
  const [values, setValues] = useState({ outletId: table.outletId, name: table.name ?? '', seats: String(table.seats ?? 4), zone: table.zone ?? '', isActive: table.isActive ?? true, sortOrder: String(table.sortOrder ?? 0) });
  const [errors, setErrors] = useState({});
  const save = useSave(onClose, setErrors);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(createPosTableSchema, values);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(
      isNew
        ? { path: '/pos/tables', method: 'POST', body: values, message: 'Masa eklendi' }
        : { path: `/pos/tables/${table.id}`, method: 'PUT', body: { ...values, expectedUpdatedAt: table.updatedAt }, message: 'Masa güncellendi' },
    );
  }

  const busy = save.isPending;
  return (
    <EditDialog id="pos-table-form" title={isNew ? 'Masa ekle' : `Masa ${table.name}`} busy={busy} onClose={onClose} onSubmit={submit}>
      <Select label="Satış noktası" value={values.outletId} onChange={set('outletId')} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} error={errors.outletId} disabled={busy} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Masa adı" name="pos-table-name" value={values.name} onChange={set('name')} error={errors.name} required disabled={busy} />
        <Input label="Kişi" name="pos-table-seats" type="number" min={1} value={values.seats} onChange={set('seats')} error={errors.seats} disabled={busy} />
        <Input label="Bölüm" name="pos-table-zone" value={values.zone} onChange={set('zone')} error={errors.zone} disabled={busy} placeholder="Teras, iç salon…" />
      </div>
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
        <Input label="Sıra" name="pos-table-sort" type="number" min={0} value={values.sortOrder} onChange={set('sortOrder')} error={errors.sortOrder} disabled={busy} />
        <Checkbox label="Aktif" checked={values.isActive} onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))} disabled={busy} />
      </div>
    </EditDialog>
  );
}

/** Toplu masa: önek + aralık (var olan adlar atlanır). @param {{ outletId: string, onClose: () => void }} props */
function BulkTablesDialog({ outletId, onClose }) {
  const [values, setValues] = useState({ outletId, prefix: '', from: '1', to: '20', seats: '4', zone: '' });
  const [errors, setErrors] = useState({});
  const save = useSave(onClose, setErrors);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(bulkPosTablesSchema, values);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate({ path: '/pos/tables/bulk', method: 'POST', body: values, message: 'Masalar eklendi (var olanlar atlandı)' });
  }

  const busy = save.isPending;
  return (
    <EditDialog id="pos-bulk-tables" title="Toplu masa ekle" busy={busy} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="Önek" name="pos-bulk-prefix" value={values.prefix} onChange={set('prefix')} error={errors.prefix} disabled={busy} placeholder="T, B, boş" />
        <Input label="Başlangıç" name="pos-bulk-from" type="number" min={1} value={values.from} onChange={set('from')} error={errors.from} disabled={busy} />
        <Input label="Bitiş" name="pos-bulk-to" type="number" min={1} value={values.to} onChange={set('to')} error={errors.to} disabled={busy} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Kişi" name="pos-bulk-seats" type="number" min={1} value={values.seats} onChange={set('seats')} error={errors.seats} disabled={busy} />
        <Input label="Bölüm" name="pos-bulk-zone" value={values.zone} onChange={set('zone')} error={errors.zone} disabled={busy} />
      </div>
      <p className="text-xs text-ink-muted">
        Örnek: önek “T”, 1–12 → T1 … T12. Tek seferde en fazla 200 masa.
      </p>
    </EditDialog>
  );
}

/* ══════════════════ Satış noktaları ══════════════════ */

function OutletsSection() {
  const outlets = usePosOutlets();
  const [editing, setEditing] = useState(null);
  return (
    <Card
      title="Satış noktaları"
      description="Restoran, lobi bar, havuz bar (masa planı) ve oda servisi (teslim panosu; odaya yazmaya açık). Odaya yaz kapalı noktada ödeme yalnızca nakit / kart."
      actions={
        <Button type="button" size="sm" icon="plus" onClick={() => setEditing({})}>
          Satış noktası ekle
        </Button>
      }
    >
      {outlets.isPending && <Spinner className="py-6" />}
      {outlets.isError && <Alert tone="danger" title="Satış noktaları yüklenemedi">{outlets.error.message}</Alert>}
      {outlets.isSuccess && outlets.data.items.length === 0 && <EmptyState icon="utensils" title="Satış noktası yok" description="İlk satış noktanızı ekleyin; sonra masalar ve menü." />}
      {outlets.data?.items.length > 0 && (
        <ul className="divide-y divide-line">
          {outlets.data.items.map((outlet) => (
            <li key={outlet.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="font-mono text-xs text-ink-muted">{outlet.code}</span>
              <span className="font-semibold text-ink">{outlet.name}</span>
              {!outlet.isActive && <Badge tone="neutral">Pasif</Badge>}
              {outlet.kind === 'ROOM_SERVICE' && <Badge tone="violet" dot={false}>{POS_OUTLET_KIND_LABELS.ROOM_SERVICE}</Badge>}
              <Badge tone={outlet.allowRoomCharge ? 'info' : 'neutral'} dot={false}>
                {outlet.allowRoomCharge ? 'Odaya yaz açık' : 'Odaya yaz kapalı'}
              </Badge>
              <Button type="button" size="sm" variant="ghost" icon="pencil" className="ml-auto" onClick={() => setEditing(outlet)}>
                Düzenle
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && <OutletDialog outlet={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

/** @param {{ outlet: any, onClose: () => void }} props */
function OutletDialog({ outlet, onClose }) {
  const isNew = !outlet.id;
  const [values, setValues] = useState({ code: outlet.code ?? '', name: outlet.name ?? '', kind: outlet.kind ?? 'DINING', allowRoomCharge: outlet.allowRoomCharge ?? true, isActive: outlet.isActive ?? true, sortOrder: String(outlet.sortOrder ?? 0) });
  const [errors, setErrors] = useState({});
  const save = useSave(onClose, setErrors);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(createPosOutletSchema, values);
    if (!checked.ok) return setErrors(checked.errors);
    if (values.kind === 'ROOM_SERVICE' && !values.allowRoomCharge) return setErrors({ allowRoomCharge: 'Oda servisi noktası odaya yazmaya açık olmalı' });
    setErrors({});
    save.mutate(
      isNew
        ? { path: '/pos/outlets', method: 'POST', body: values, message: 'Satış noktası eklendi' }
        : { path: `/pos/outlets/${outlet.id}`, method: 'PUT', body: { ...values, expectedUpdatedAt: outlet.updatedAt }, message: 'Satış noktası güncellendi' },
    );
  }

  const busy = save.isPending;
  return (
    <EditDialog id="pos-outlet-form" title={isNew ? 'Satış noktası ekle' : outlet.name} busy={busy} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Input label="Kod" name="pos-outlet-code" value={values.code} onChange={set('code')} error={errors.code} required disabled={busy} />
        <Input label="Ad" name="pos-outlet-name" value={values.name} onChange={set('name')} error={errors.name} required disabled={busy} />
      </div>
      <ChoiceChips
        label="Tür"
        required
        options={POS_OUTLET_KINDS.map((value) => ({ value, label: POS_OUTLET_KIND_LABELS[value] }))}
        value={values.kind}
        onChange={(kind) => setValues((current) => ({ ...current, kind, allowRoomCharge: kind === 'ROOM_SERVICE' ? true : current.allowRoomCharge }))}
        disabled={busy}
      />
      {values.kind === 'ROOM_SERVICE' && <p className="text-xs text-ink-muted">Oda servisi noktasının masası yoktur; siparişleri teslim panosundadır. Menü grubunu yalnızca bu noktaya açarak kahvaltı kartı gibi oda servisine özel ürünler tanımlanır.</p>}
      <Checkbox
        label="Odaya yaz açık"
        hint={values.kind === 'ROOM_SERVICE' ? 'Oda servisinde zorunlu: teslimde kalan folyoya yazılır.' : 'İçerideki misafirin folyosuna yazılabilir.'}
        checked={values.allowRoomCharge}
        onChange={(event) => setValues((current) => ({ ...current, allowRoomCharge: event.target.checked }))}
        disabled={busy || values.kind === 'ROOM_SERVICE'}
      />
      {errors.allowRoomCharge && <p className="text-xs font-semibold text-danger-ink">{errors.allowRoomCharge}</p>}
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
        <Input label="Sıra" name="pos-outlet-sort" type="number" min={0} value={values.sortOrder} onChange={set('sortOrder')} error={errors.sortOrder} disabled={busy} />
        <Checkbox label="Aktif" checked={values.isActive} onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))} disabled={busy} />
      </div>
    </EditDialog>
  );
}

/* ══════════════════ Politika ══════════════════ */

function SettingsSection() {
  const settings = useQuery({ queryKey: posKeys.settings, queryFn: () => api('/pos/settings') });
  const [values, setValues] = useState(null);
  const [errors, setErrors] = useState({});
  const save = useSave(() => {}, setErrors);
  useEffect(() => {
    if (settings.data) {
      const { adjustmentApprovalAmount, cashVarianceAlert, trayCharge, deliveryTargetMinutes, prepLeadMinutes, trayAlertMinutes, guestOrderingEnabled } = settings.data;
      setValues({ adjustmentApprovalAmount, cashVarianceAlert, trayCharge, deliveryTargetMinutes: String(deliveryTargetMinutes), prepLeadMinutes: String(prepLeadMinutes), trayAlertMinutes: String(trayAlertMinutes), guestOrderingEnabled });
    }
  }, [settings.data]);
  if (settings.isPending || !values) return <Spinner className="py-6" />;
  if (settings.isError) return <Alert tone="danger" title="Politika yüklenemedi">{settings.error.message}</Alert>;

  function submit(event) {
    event.preventDefault();
    const body = { ...values, expectedUpdatedAt: settings.data.updatedAt };
    const checked = validateWith(updatePosSettingsSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate({ path: '/pos/settings', method: 'PUT', body, message: 'Politika kaydedildi' });
  }

  const busy = save.isPending;
  return (
    <Card title="Restoran ve oda servisi politikası" description="Dört göz eşiği, kasa farkı uyarısı ve oda servisi kuralları. Tutarlar otelin para biriminde.">
      <form onSubmit={submit} noValidate className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Onay eşiği (ikram / iptal / indirim)"
          name="pos-approval-amount"
          inputMode="decimal"
          value={values.adjustmentApprovalAmount}
          onChange={(event) => setValues((current) => ({ ...current, adjustmentApprovalAmount: event.target.value }))}
          error={errors.adjustmentApprovalAmount}
          disabled={busy}
        />
        <Input
          label="Kasa farkı uyarısı"
          name="pos-variance-alert"
          inputMode="decimal"
          value={values.cashVarianceAlert}
          onChange={(event) => setValues((current) => ({ ...current, cashVarianceAlert: event.target.value }))}
          error={errors.cashVarianceAlert}
          disabled={busy}
        />
        <p className="text-xs text-ink-muted sm:col-span-2">
          Eşiğe eşit ya da üstündeki düzeltme başka bir yetkili onaylayınca uygulanır (0: onay istenmez). Vardiya kapanışında bu tutarı aşan kasa farkı şef garson / müdüre bildirilir.
        </p>
        <h3 className="mt-2 text-sm font-bold text-ink sm:col-span-2">Oda servisi</h3>
        <Input
          label="Oda servisi ücreti (sipariş başına, 0 = yok)"
          name="pos-tray-charge"
          inputMode="decimal"
          value={values.trayCharge}
          onChange={(event) => setValues((current) => ({ ...current, trayCharge: event.target.value }))}
          error={errors.trayCharge}
          disabled={busy}
        />
        <Input
          label="Teslim hedefi (dakika)"
          name="pos-delivery-target"
          type="number"
          inputMode="numeric"
          min={ROOM_SERVICE_POLICY_LIMITS.deliveryTargetMinutes.min}
          max={ROOM_SERVICE_POLICY_LIMITS.deliveryTargetMinutes.max}
          value={values.deliveryTargetMinutes}
          onChange={(event) => setValues((current) => ({ ...current, deliveryTargetMinutes: event.target.value }))}
          error={errors.deliveryTargetMinutes}
          disabled={busy}
        />
        <Input
          label="Hazırlık payı (ileri saatli sipariş teslimden kaç dakika önce mutfağa düşer)"
          name="pos-prep-lead"
          type="number"
          inputMode="numeric"
          min={ROOM_SERVICE_POLICY_LIMITS.prepLeadMinutes.min}
          max={ROOM_SERVICE_POLICY_LIMITS.prepLeadMinutes.max}
          value={values.prepLeadMinutes}
          onChange={(event) => setValues((current) => ({ ...current, prepLeadMinutes: event.target.value }))}
          error={errors.prepLeadMinutes}
          disabled={busy}
        />
        <Input
          label="Toplanmayan tepsi uyarısı (teslimden sonra, dakika)"
          name="pos-tray-alert"
          type="number"
          inputMode="numeric"
          min={ROOM_SERVICE_POLICY_LIMITS.trayAlertMinutes.min}
          max={ROOM_SERVICE_POLICY_LIMITS.trayAlertMinutes.max}
          value={values.trayAlertMinutes}
          onChange={(event) => setValues((current) => ({ ...current, trayAlertMinutes: event.target.value }))}
          error={errors.trayAlertMinutes}
          disabled={busy}
        />
        <div className="sm:col-span-2">
          <Switch label="Misafir QR bağlantısıyla sipariş verebilir" showLabel checked={values.guestOrderingEnabled} onChange={(guestOrderingEnabled) => setValues((current) => ({ ...current, guestOrderingEnabled }))} disabled={busy} />
          <p className="mt-1 text-xs text-ink-muted">Misafirin siparişi panoda kabul bekler; aynı anda en fazla 3 açık siparişi olur. Oda servisi ücreti adisyonda ayrı kalem olarak görünür; şef garson ikram edebilir.</p>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
