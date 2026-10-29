import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, STOCK_ITEM_GROUPS, STOCK_ITEM_GROUP_LABELS, updateMinLevelSchema } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPut, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { purchasingKeys, stockKeys } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { quantityStep } from '../../lib/purchasingFormat.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 25;
const GROUP_OPTIONS = [{ value: '', label: 'Bütün gruplar' }, ...STOCK_ITEM_GROUPS.map((group) => ({ value: group, label: STOCK_ITEM_GROUP_LABELS[group] }))];
const VIEW_OPTIONS = [
  { value: '', label: 'Hepsi' },
  { value: 'inStock', label: 'Eldekiler' },
  { value: 'belowMin', label: 'Minimum altı' },
];

/**
 * Stok mevcudu (modül 45): özet (stok değeri, eldeki malzeme, minimum altı, depo), malzeme başına
 * toplam ve depo dağılımı, yoldaki (açık sipariş kalanı), minimum seviye, hareketli ortalama maliyet
 * ve değer. Minimum seviye `stock.manage`; altına düşen satın alma önerisine girer.
 */
export function StockLevelsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.STOCK_MANAGE);
  const { data: hotel } = useHotelContext();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [group, setGroup] = useState('');
  const [view, setView] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  useEffect(() => setPage(1), [search, group, view]);

  const summary = useQuery({ queryKey: stockKeys.summary, queryFn: () => api('/stock/summary') });
  const filters = { search: search || undefined, group: group || undefined, inStock: view === 'inStock' ? 'true' : undefined, belowMin: view === 'belowMin' ? 'true' : undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: stockKeys.levels(filters), queryFn: () => api(withQuery('/stock/levels', filters)), placeholderData: keepPreviousData });
  const currency = hotel?.currency;

  const columns = [
    {
      key: 'name',
      header: 'Malzeme',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">{[row.code, STOCK_ITEM_GROUP_LABELS[row.group], row.isActive ? null : 'pasif'].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    {
      key: 'onHand',
      header: 'Mevcut',
      className: 'text-right tabular-nums',
      render: (row) => (
        <span className="block">
          <span className={`block font-semibold ${row.belowMin ? 'text-warning-ink' : 'text-ink'}`}>{quantityText(row.onHand, row.unit)}</span>
          {row.warehouses.length > 1 && <span className="block text-xs text-ink-muted">{row.warehouses.map((entry) => `${entry.warehouseName} ${quantityText(entry.quantity, row.unit)}`).join(' · ')}</span>}
          {row.warehouses.length === 1 && <span className="block text-xs text-ink-muted">{row.warehouses[0].warehouseName}</span>}
        </span>
      ),
    },
    { key: 'onOrder', header: 'Yolda', className: 'text-right tabular-nums', render: (row) => (Number(row.onOrder) > 0 ? quantityText(row.onOrder, row.unit) : '—') },
    {
      key: 'min',
      header: 'Minimum',
      className: 'text-right tabular-nums',
      render: (row) => (
        <span className="flex items-center justify-end gap-1.5">
          {row.minLevel === null ? <span className="text-ink-muted">izlenmiyor</span> : quantityText(row.minLevel, row.unit)}
          {row.belowMin && <Badge tone="warning">altında</Badge>}
        </span>
      ),
    },
    {
      key: 'cost',
      header: 'Ort. maliyet',
      className: 'text-right tabular-nums',
      render: (row) => (
        <span className="block">
          <span className="block">
            {formatMoney(row.unitCost, currency)}/{KITCHEN_UNIT_LABELS[row.unit]}
          </span>
          {row.costUpdatedAt && <span className="block text-xs text-ink-muted">{formatDate(row.costUpdatedAt)}</span>}
        </span>
      ),
    },
    { key: 'value', header: 'Değer', className: 'text-right tabular-nums font-semibold', render: (row) => formatMoney(row.value, currency) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Stok değeri" value={summary.data ? formatMoney(summary.data.value, currency) : undefined} hint="mevcut × hareketli ortalama maliyet" icon="wallet" />
        <SummaryTile label="Eldeki malzeme" value={summary.data?.inStock} hint="mevcudu 0'dan büyük" icon="package" selected={view === 'inStock'} onClick={() => setView(view === 'inStock' ? '' : 'inStock')} />
        <SummaryTile
          label="Minimum altı"
          value={summary.data?.belowMin}
          hint={summary.data ? `${summary.data.tracked} malzeme izleniyor` : '…'}
          icon="alertTriangle"
          tone={summary.data?.belowMin ? 'warning' : 'neutral'}
          selected={view === 'belowMin'}
          onClick={() => setView(view === 'belowMin' ? '' : 'belowMin')}
        />
        <SummaryTile label="Etkin depo" value={summary.data?.warehouses} hint={summary.data?.lastReceiptAt ? `son giriş ${formatDate(summary.data.lastReceiptAt)}` : 'henüz giriş yok'} icon="building" />
      </div>
      <Toolbar
        actions={
          summary.data?.belowMin > 0 &&
          can(PERMISSIONS.PURCHASING_REQUEST) && (
            <Link to="/satin-alma/oneriler" className="text-sm font-semibold text-ink underline">
              Minimum altındakiler için talep önerileri →
            </Link>
          )
        }
      >
        <Input label="Ara" name="level-search" placeholder="Malzeme adı ya da kodu" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-60" />
        <Select label="Grup" name="level-group" options={GROUP_OPTIONS} value={group} onChange={(event) => setGroup(event.target.value)} className="w-full sm:w-52" />
        <Select label="Görünüm" name="level-view" options={VIEW_OPTIONS} value={view} onChange={(event) => setView(event.target.value)} className="w-full sm:w-40" />
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
        emptyTitle={search || group || view ? 'Eşleşen malzeme yok' : 'Malzeme kartı yok'}
        emptyHint={search || group || view ? undefined : 'Malzeme kartları Mutfak → Malzeme kartları ekranında açılır; stok mal kabulle girer.'}
        rowActions={
          canManage
            ? (row) => (
                <Button type="button" size="sm" variant="ghost" icon="sliders" onClick={() => setEditing(row)}>
                  Minimum
                </Button>
              )
            : undefined
        }
      />
      {editing && <MinLevelDialog item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** @param {{ item: any, onClose: () => void }} props */
function MinLevelDialog({ item, onClose }) {
  const queryClient = useQueryClient();
  const [minLevel, setMinLevel] = useState(item.minLevel ?? '');
  const [error, setError] = useState(null);
  const save = useMutation({
    mutationFn: (body) => apiPut(`/stock/items/${item.stockItemId}/min-level`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stockKeys.all });
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all });
      toastSuccess(`${item.name}: minimum seviye kaydedildi`);
      onClose();
    },
    onError: (failure) => {
      if (failure.fields?.minLevel) setError(failure.fields.minLevel);
      if (failure.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toastError(failure.code === 'STALE_WRITE' ? 'Malzeme bu arada değişti (mal kabul ya da düzenleme); liste yenilendi, tekrar açın.' : failure.message);
    },
  });
  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: item.updatedAt, minLevel: String(minLevel).trim() || null };
    const checked = validateWith(updateMinLevelSchema, body);
    if (!checked.ok) return setError(checked.errors.minLevel ?? 'Değer geçersiz');
    setError(null);
    save.mutate(body);
  }
  const busy = save.isPending;
  return (
    <Modal
      open
      size="sm"
      title={`${item.name} — minimum seviye`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="min-level-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="min-level-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">
          Mevcut {quantityText(item.onHand, item.unit)}. Eldeki + yoldaki + talepteki minimumun altına düşünce satın alma önerisine girer. Boş bırakılırsa izlenmez.
        </p>
        <Input label={`Minimum (${KITCHEN_UNIT_LABELS[item.unit]})`} name="min-level" inputMode="decimal" step={quantityStep(item.unit)} value={minLevel} onChange={(event) => setMinLevel(event.target.value)} error={error ?? undefined} disabled={busy} />
      </form>
    </Modal>
  );
}
