import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TAX_APPLIES_TO, createBanquetMenuSchema, updateBanquetMenuSchema } from '@hotelos/hotel-contracts';
import { Badge, Button, Checkbox, Input, Select, Spinner, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { banquetKeys } from '../../lib/banquet.js';
import { TAX_APPLIES_TO_LABELS, formatMoney } from '../../lib/format.js';
import { useFnbLive } from '../../lib/kitchen.js';
import { allergenText, foodCostTone, pctText } from '../../lib/kitchenFormat.js';
import { catalogFormOf, catalogPayloadOf } from '../../lib/menuForm.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { CoursesEditor } from './CoursesEditor.jsx';

const PAGE_SIZE = 25;
const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Satışta' },
  { value: 'false', label: 'Pasif' },
  { value: '', label: 'Hepsi' },
];

/**
 * Set menü kataloğu (modül 43): kurslar, yemekler, kişi başı fiyat (vergi dahil), en az kişi.
 * Reçete görme izni olana kişi başı maliyet ve gıda maliyeti yüzdesi (seçmeli kursta en pahalı
 * seçenekle). Yazmak `banquet.setup`. Etkinliğe seçilince kopyası alınır.
 */
export function MenusTab() {
  const can = useCan();
  const canSetup = can(PERMISSIONS.BANQUET_SETUP);
  const showCost = can(PERMISSIONS.RECIPES_VIEW);
  const { data: hotel } = useHotelContext();
  useFnbLive();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  useEffect(() => setPage(1), [search, active]);

  const filters = { search: search || undefined, active: active || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: banquetKeys.menus(filters), queryFn: () => api(withQuery('/banquet/menus', filters)), placeholderData: keepPreviousData });

  const columns = [
    {
      key: 'name',
      header: 'Set menü',
      render: (row) => (
        <span className="block max-w-sm">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">{[row.code, `${row.courseCount} kurs · ${row.dishCount} yemek`, row.minGuests ? `en az ${row.minGuests} kişi` : null].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Kişi başı',
      className: 'text-right tabular-nums',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold">{formatMoney(row.pricePerPerson, hotel?.currency)}</span>
          <span className="block text-xs text-ink-muted">KDV hariç {formatMoney(row.netPricePerPerson)}</span>
        </span>
      ),
    },
    ...(showCost
      ? [
          {
            key: 'cost',
            header: 'Maliyet · gıda maliyeti',
            className: 'text-right tabular-nums',
            render: (row) => (
              <span className="flex flex-col items-end gap-1">
                <span>{formatMoney(row.cost.perGuest, hotel?.currency)}</span>
                <Badge tone={foodCostTone(row.cost.foodCostPct)}>{pctText(row.cost.foodCostPct)}</Badge>
                {row.cost.missing > 0 && <span className="text-xs font-semibold text-warning-ink">maliyeti eksik malzeme var</span>}
              </span>
            ),
          },
        ]
      : []),
    { key: 'allergens', header: 'Alerjen', render: (row) => <span className="text-xs text-ink-soft">{allergenText(row.allergens)}</span> },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Satışta' : 'Pasif'}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          canSetup && (
            <Button type="button" icon="plus" onClick={() => setEditing({ id: null })}>
              Yeni set menü
            </Button>
          )
        }
      >
        <Input label="Ara" name="menu-search" placeholder="Menü adı ya da kod" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-64" />
        <Select label="Durum" name="menu-active" options={ACTIVE_OPTIONS} value={active} onChange={(event) => setActive(event.target.value)} className="w-full sm:w-40" />
      </Toolbar>
      {showCost && <p className="text-xs text-ink-muted">Maliyet kişi başı, güncel malzeme maliyetiyle (KDV hariç, fazla hazırlık payı hariç); seçmeli kursta en pahalı seçenekle.</p>}
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search ? 'Eşleşen set menü yok' : 'Set menü yok'}
        emptyHint={canSetup && !search ? 'Düğün, gala, toplantı öğle yemeği gibi set menüleri tanımlayın; etkinliğe seçilince kopyası alınır ve fiyat kalemi menüden gelir.' : undefined}
        rowActions={(row) => (
          <Button type="button" size="sm" variant="ghost" icon={canSetup ? 'pencil' : 'eye'} onClick={() => setEditing({ id: row.id })}>
            {canSetup ? 'Düzenle' : 'Göster'}
          </Button>
        )}
      />
      {editing && <CatalogMenuDialog menuId={editing.id} readOnly={!canSetup} currency={hotel?.currency} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** @param {{ menuId: string | null, readOnly: boolean, currency?: string, onClose: () => void }} props */
function CatalogMenuDialog({ menuId, readOnly, currency, onClose }) {
  const detail = useQuery({ queryKey: banquetKeys.menu(menuId), queryFn: () => api(`/banquet/menus/${menuId}`), enabled: Boolean(menuId) });
  if (menuId && (detail.isPending || detail.isError)) {
    return (
      <Modal open size="sm" title="Set menü" onClose={onClose}>
        {detail.isPending ? <Spinner /> : <QueryFallback query={detail} errorTitle="Set menü yüklenemedi" />}
      </Modal>
    );
  }
  return <CatalogMenuForm menu={menuId ? detail.data : null} readOnly={readOnly} currency={currency} onClose={onClose} />;
}

/** @param {{ menu: any | null, readOnly: boolean, currency?: string, onClose: () => void }} props */
function CatalogMenuForm({ menu, readOnly, currency, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => catalogFormOf(menu));
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const save = useMutation({
    mutationFn: (body) => (menu ? api(`/banquet/menus/${menu.id}`, { method: 'PUT', body: JSON.stringify(body) }) : apiPost('/banquet/menus', body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastSuccess(menu ? 'Set menü kaydedildi' : 'Set menü eklendi');
      onClose();
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: banquetKeys.all });
      toastError(error.code === 'STALE_WRITE' ? 'Set menü bu arada değişti; kapatıp yeniden açın.' : error.message);
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = catalogPayloadOf(form, menu?.updatedAt ?? null);
    const checked = validateWith(menu ? updateBanquetMenuSchema : createBanquetMenuSchema, body);
    if (!checked.ok) {
      setErrors(checked.errors);
      toastError('Menüde düzeltilmesi gereken alanlar var');
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  const busy = save.isPending;
  const disabled = readOnly || busy;
  return (
    <Modal
      open
      size="xl"
      title={menu ? menu.name : 'Yeni set menü'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {readOnly ? 'Kapat' : 'Vazgeç'}
          </Button>
          {!readOnly && (
            <Button type="submit" form="catalog-menu-form" icon="check" disabled={busy}>
              {busy ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          )}
        </>
      }
    >
      <form id="catalog-menu-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Input label="Menü adı" name="catalog-name" value={form.name} onChange={set('name')} error={errors.name} required disabled={disabled} className="md:col-span-2" />
          <Input label="Kod" name="catalog-code" value={form.code} onChange={set('code')} error={errors.code} disabled={disabled} />
          <Input label="En az kişi" name="catalog-min" type="number" min={1} value={form.minGuests} onChange={set('minGuests')} error={errors.minGuests} disabled={disabled} />
          <Input label={`Kişi başı fiyat (${currency ?? ''}, vergi dahil)`} name="catalog-price" inputMode="decimal" value={form.pricePerPerson} onChange={set('pricePerPerson')} error={errors.pricePerPerson} required disabled={disabled} />
          <Select label="Vergi kategorisi" name="catalog-tax" options={TAX_APPLIES_TO.map((value) => ({ value, label: TAX_APPLIES_TO_LABELS[value] }))} value={form.taxCategory} onChange={set('taxCategory')} error={errors.taxCategory} disabled={disabled} />
          <Textarea label="Açıklama (teklifte görünmez)" name="catalog-description" rows={2} value={form.description} onChange={set('description')} error={errors.description} disabled={disabled} className="md:col-span-2" />
          {menu && !readOnly && (
            <Checkbox label="Satışta" hint="Pasif menü etkinliğe seçilmez; seçilmiş kopyalar etkilenmez." checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} disabled={busy} className="md:col-span-4" />
          )}
        </div>
        <CoursesEditor courses={form.courses} onChange={(courses) => setForm((current) => ({ ...current, courses }))} withCounts={false} errors={errors} disabled={disabled} currency={currency} />
      </form>
    </Modal>
  );
}
