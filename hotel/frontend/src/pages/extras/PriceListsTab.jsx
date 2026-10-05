import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LAUNDRY_SERVICES,
  MINIBAR_CATEGORIES,
  MINIBAR_MAX_PAR_LEVEL,
  laundryItemInputSchema,
  laundrySettingsSchema,
  minibarItemInputSchema,
  updateLaundryItemSchema,
  updateMinibarItemSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Input, Select } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiDelete, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { categoryLabel, extrasKeys, serviceLabel } from '../../lib/extras.js';
import { formatMoney } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 25;

/** Katalog türleri: uç, başlık, şemalar, ürün türü alanı. */
const KINDS = Object.freeze({
  MINIBAR: {
    path: '/extras/minibar/items',
    title: 'Minibar ürünleri',
    create: minibarItemInputSchema,
    update: updateMinibarItemSchema,
    empty: { code: '', name: '', category: 'DRINK', price: '', parLevel: '1', active: true, sortOrder: '0' },
  },
  LAUNDRY: {
    path: '/extras/laundry/items',
    title: 'Çamaşırhane fiyat listesi',
    create: laundryItemInputSchema,
    update: updateLaundryItemSchema,
    empty: { code: '', name: '', service: 'WASH', price: '', active: true, sortOrder: '0' },
  },
});

/**
 * Fiyat listeleri (modül 19, `extras.manage`): minibar ürünleri (kategori,
 * fiyat, odadaki standart adet), çamaşırhane (parça × hizmet, fiyat) ve
 * ekspres farkı. Fiyat vergi ayarına göre dahil / hariç yorumlanır. Geçmiş
 * fiş ve siparişler kendi fiyatını sakladığı için değişiklikten etkilenmez.
 */
export function PriceListsTab() {
  return (
    <div className="flex flex-col gap-6">
      <CatalogTable kind="MINIBAR" />
      <CatalogTable kind="LAUNDRY" />
      <ExpressSettings />
    </div>
  );
}

/** @param {{ kind: 'MINIBAR' | 'LAUNDRY' }} props */
function CatalogTable({ kind }) {
  const config = KINDS[kind];
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const filters = { page, includeInactive };
  const list = useQuery({
    queryKey: extrasKeys.catalog(kind, filters),
    queryFn: () => api(withQuery(config.path, { page, pageSize: PAGE_SIZE, includeInactive })),
    placeholderData: (previous) => previous,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: extrasKeys.all });
  const remove = useMutation({
    mutationFn: (item) => apiDelete(`${config.path}/${item.id}`),
    onSuccess: () => {
      toastSuccess(`${deleting.name} listeden kaldırıldı`);
      setDeleting(null);
      refresh();
    },
  });

  const columns = [
    { key: 'code', header: 'Kod', render: (row) => <span className="font-mono text-xs">{row.code}</span> },
    { key: 'name', header: 'Ad', render: (row) => <span className="font-semibold">{row.name}</span> },
    kind === 'MINIBAR'
      ? { key: 'category', header: 'Kategori', render: (row) => categoryLabel(row.category) }
      : { key: 'service', header: 'Hizmet', render: (row) => serviceLabel(row.service) },
    { key: 'price', header: 'Fiyat', className: 'text-right', render: (row) => <span className="tabular-nums">{formatMoney(row.price)}</span> },
    ...(kind === 'MINIBAR' ? [{ key: 'parLevel', header: 'Standart', className: 'text-right', render: (row) => row.parLevel }] : []),
    { key: 'active', header: 'Durum', render: (row) => <Badge tone={row.active ? 'success' : 'neutral'}>{row.active ? 'Satışta' : 'Pasif'}</Badge> },
  ];

  return (
    <Card
      title={config.title}
      actions={
        <span className="flex flex-wrap items-center gap-3">
          <Checkbox label="Pasifleri göster" checked={includeInactive} onChange={(event) => { setIncludeInactive(event.target.checked); setPage(1); }} />
          <Button size="sm" icon="plus" onClick={() => setEditing({ ...config.empty })}>Ekle</Button>
        </span>
      }
    >
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle="Liste boş"
        emptyHint="Ekle düğmesiyle ilk kalemi girin."
        rowActions={(row) => (
          <span className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditing({ ...row, price: row.price, parLevel: String(row.parLevel ?? ''), sortOrder: String(row.sortOrder) })}>Düzenle</Button>
            <Button size="sm" variant="ghost" icon="trash" aria-label={`${row.name} kaldır`} onClick={() => setDeleting(row)} />
          </span>
        )}
      />
      {editing && <ItemDialog kind={kind} initial={editing} onClose={() => setEditing(null)} onDone={refresh} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`${deleting?.name ?? ''} listeden kaldırılsın mı?`}
        message="Geçmiş fiş ve siparişler etkilenmez (kendi ad ve fiyatlarını taşırlar). Kod yeniden kullanılabilir."
        confirmLabel="Kaldır"
        onConfirm={() => remove.mutate(deleting)}
        onClose={() => {
          remove.reset();
          setDeleting(null);
        }}
        isPending={remove.isPending}
        error={remove.error}
      />
    </Card>
  );
}

/**
 * Ekle / düzenle.
 * @param {{ kind: 'MINIBAR' | 'LAUNDRY', initial: any, onClose: () => void, onDone: () => void }} props
 */
function ItemDialog({ kind, initial, onClose, onDone }) {
  const config = KINDS[kind];
  const editing = Boolean(initial.id);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const mutation = useMutation({
    mutationFn: (body) => (editing ? apiPut(`${config.path}/${initial.id}`, body) : apiPost(config.path, body)),
    onSuccess: (saved) => {
      toastSuccess(`${saved.name} kaydedildi`);
      onDone();
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields) setErrors(error.fields);
    },
  });
  const busy = mutation.isPending;
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const body = {
      code: form.code,
      name: form.name,
      ...(kind === 'MINIBAR' ? { category: form.category, parLevel: form.parLevel } : { service: form.service }),
      price: form.price,
      active: form.active,
      sortOrder: form.sortOrder,
      ...(editing ? { expectedUpdatedAt: initial.updatedAt } : {}),
    };
    const result = validateWith(editing ? config.update : config.create, body);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(body);
  }

  return (
    <Modal
      open
      size="md"
      title={editing ? `${initial.name} — düzenle` : `${config.title} — yeni kalem`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button type="submit" form="extras-item-form" icon="check" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</Button>
        </>
      }
    >
      <form id="extras-item-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {serverError && <Alert tone={serverError.code === 'STALE_WRITE' ? 'warning' : 'danger'} title="Kaydedilmedi" className="sm:col-span-2">{serverError.message}</Alert>}
        <Input label="Kod" value={form.code} maxLength={20} onChange={set('code')} error={errors.code} disabled={busy} />
        <Input label="Ad" value={form.name} maxLength={100} onChange={set('name')} error={errors.name} disabled={busy} />
        {kind === 'MINIBAR' ? (
          <Select label="Kategori" value={form.category} onChange={set('category')} options={MINIBAR_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))} error={errors.category} disabled={busy} />
        ) : (
          <Select label="Hizmet" value={form.service} onChange={set('service')} options={LAUNDRY_SERVICES.map((value) => ({ value, label: serviceLabel(value) }))} error={errors.service} disabled={busy} />
        )}
        <Input label="Fiyat" inputMode="decimal" placeholder="ör. 45 ya da 45,50" value={form.price} onChange={set('price')} error={errors.price} disabled={busy} />
        {kind === 'MINIBAR' && (
          <Input label="Odadaki standart adet" type="number" min={0} max={MINIBAR_MAX_PAR_LEVEL} value={form.parLevel} onChange={set('parLevel')} error={errors.parLevel} disabled={busy} />
        )}
        <Input label="Sıra" type="number" min={0} max={9999} value={form.sortOrder} onChange={set('sortOrder')} error={errors.sortOrder} disabled={busy} />
        <Checkbox label="Satışta" hint="Pasif kalem giriş ekranında görünmez" checked={form.active} onChange={set('active')} disabled={busy} />
      </form>
    </Modal>
  );
}

/** Ekspres çamaşır farkı (yüzde). */
function ExpressSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: extrasKeys.laundrySettings, queryFn: () => api('/extras/laundry/settings') });
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (settings.data) setValue(settings.data.expressPct.replace('.', ','));
  }, [settings.data]);
  const mutation = useMutation({
    mutationFn: (body) => apiPut('/extras/laundry/settings', body),
    onSuccess: () => {
      toastSuccess('Ekspres farkı kaydedildi');
      queryClient.invalidateQueries({ queryKey: extrasKeys.all });
    },
    onError: (failure) => {
      if (failure?.code === 'STALE_WRITE') {
        // Başkası bu arada değiştirdi: güncel değer forma gelsin, kullanıcı yeniden karar versin.
        toastError('Ekspres farkı bu arada başkası tarafından değiştirildi; güncel değer yüklendi, tekrar kaydedin.');
        queryClient.invalidateQueries({ queryKey: extrasKeys.laundrySettings });
        return;
      }
      toastError(failure.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const result = validateWith(laundrySettingsSchema, { expressPct: value.replace(',', '.'), expectedUpdatedAt: settings.data?.updatedAt });
    if (!result.ok) {
      setError(result.errors.expressPct ?? 'Geçersiz');
      return;
    }
    setError('');
    mutation.mutate(result.data);
  }

  return (
    <Card title="Ekspres çamaşır" description="Ekspres siparişte parçaların toplamına eklenen yüzde. Açık siparişler alındıkları andaki yüzdeyi korur.">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3" noValidate>
        <Input label="Ekspres farkı (%)" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} error={error} className="w-40" disabled={settings.isPending || mutation.isPending} />
        <Button type="submit" icon="check" disabled={settings.isPending || mutation.isPending}>{mutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}</Button>
      </form>
    </Card>
  );
}
