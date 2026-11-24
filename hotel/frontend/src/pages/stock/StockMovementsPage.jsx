import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, STOCK_MOVEMENT_KINDS, STOCK_MOVEMENT_KIND_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { recipeKeys, stockKeys, useWarehouses } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { ManualMovementDialog } from './ManualMovementDialog.jsx';

const PAGE_SIZE = 50;
const KIND_OPTIONS = [{ value: '', label: 'Bütün türler' }, ...STOCK_MOVEMENT_KINDS.map((kind) => ({ value: kind, label: STOCK_MOVEMENT_KIND_LABELS[kind] }))];
/** Tür rozeti: giriş yeşil, transfer / sayım nötr-bilgi, çıkış / fire / satış uyarı. */
const KIND_TONES = Object.freeze({ RECEIPT: 'success', TRANSFER_IN: 'info', TRANSFER_OUT: 'info', COUNT_ADJUST: 'violet', SALE: 'sky', ISSUE: 'warning', WASTE: 'danger' });

/**
 * Stok hareketleri (modül 45 + 44): değişmez kayıtlar, en yeni önce — tür, malzeme, depo, miktar, birim
 * maliyet, hareket sonrası mevcut ve ortalama maliyet, kaynak belge (mal kabul, sayım, adisyon; elle harekette
 * not). Filtre: malzeme, depo, tür, gün aralığı (otelin günü). "Hareket gir": çıkış / fire / transfer (`stock.manage`).
 */
export function StockMovementsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.STOCK_MANAGE);
  const { data: hotel } = useHotelContext();
  const warehouses = useWarehouses({ includeInactive: true });
  const [item, setItem] = useState(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [entering, setEntering] = useState(false);
  useEffect(() => setPage(1), [item, warehouseId, kind, from, to]);

  const invalidRange = from && to && to < from;
  const filters = { stockItemId: item?.id, warehouseId: warehouseId || undefined, kind: kind || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: stockKeys.movements(filters), queryFn: () => api(withQuery('/stock/movements', filters)), placeholderData: keepPreviousData, enabled: !invalidRange });
  const currency = hotel?.currency;

  const columns = [
    { key: 'at', header: 'An', className: 'whitespace-nowrap', render: (row) => formatDateTime(row.occurredAt) },
    { key: 'kind', header: 'Tür', render: (row) => <Badge tone={KIND_TONES[row.kind] ?? 'neutral'}>{STOCK_MOVEMENT_KIND_LABELS[row.kind] ?? row.kind}</Badge> },
    {
      key: 'item',
      header: 'Malzeme',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.stockItem.name}</span>
          <span className="block text-xs text-ink-muted">{[row.warehouse.name, row.menuItem?.name].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    { key: 'quantity', header: 'Miktar', className: 'text-right tabular-nums font-semibold', render: (row) => `${Number(row.quantity) > 0 ? '+' : ''}${quantityText(row.quantity, row.stockItem.unit)}` },
    {
      key: 'cost',
      header: 'Birim maliyet',
      className: 'text-right tabular-nums',
      render: (row) => `${formatMoney(row.unitCost, currency)}/${KITCHEN_UNIT_LABELS[row.stockItem.unit]}`,
    },
    { key: 'total', header: 'Tutar', className: 'text-right tabular-nums', render: (row) => formatMoney(row.totalCost, currency) },
    {
      key: 'after',
      header: 'Sonra: mevcut / ort.',
      className: 'text-right tabular-nums',
      render: (row) => (
        <span className="block">
          <span className="block">{quantityText(row.onHandAfter, row.stockItem.unit)}</span>
          <span className="block text-xs text-ink-muted">{formatMoney(row.avgCostAfter, currency)}</span>
        </span>
      ),
    },
    {
      key: 'source',
      header: 'Kaynak',
      render: (row) => {
        const link = row.source.type === 'GoodsReceipt' ? `/satin-alma/mal-kabul/${row.source.id}` : row.source.type === 'StockCount' ? `/stok/sayim/${row.source.id}` : row.source.type === 'PosCheck' ? `/pos/adisyon/${row.source.id}` : null;
        return link && row.source.number ? (
          <span className="block">
            <Link to={link} className="font-mono text-xs font-semibold text-ink hover:underline">
              {row.source.number}
            </Link>
            {row.source.type !== 'PosCheck' && row.note && <span className="block text-xs text-ink-muted">{row.note}</span>}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">{row.note ?? '—'}</span>
        );
      },
    },
  ];
  const filtered = item || warehouseId || kind || from || to;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setEntering(true)}>
              Hareket gir
            </Button>
          )
        }
      >
        <div className="w-full sm:w-72">
          {item ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink-soft">Malzeme</span>
              <div className="flex items-center justify-between gap-2 rounded-item border border-line-strong bg-surface px-3 py-2 text-sm">
                <span className="truncate font-semibold">{item.name}</span>
                <button type="button" className="text-xs text-ink-muted underline hover:text-ink" onClick={() => setItem(null)}>
                  temizle
                </button>
              </div>
            </div>
          ) : (
            <SearchPicker
              label="Malzeme"
              placeholder="Malzeme ara"
              queryOf={(search) => ({ queryKey: recipeKeys.stock({ search, picker: true }), queryFn: () => api(withQuery('/recipes/stock-items', { search: search || undefined, page: 1, pageSize: 30 })) })}
              itemsOf={(data) => data?.items ?? []}
              renderItem={(entry) => <span className="font-semibold">{entry.name}</span>}
              onPick={(entry) => setItem({ id: entry.id, name: entry.name })}
              emptyText="Malzeme bulunamadı"
            />
          )}
        </div>
        <Select
          label="Depo"
          name="movement-warehouse"
          options={[{ value: '', label: 'Bütün depolar' }, ...(warehouses.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]}
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
          className="w-full sm:w-48"
        />
        <Select label="Tür" name="movement-kind" options={KIND_OPTIONS} value={kind} onChange={(event) => setKind(event.target.value)} className="w-full sm:w-48" />
        <Input label="İlk gün" name="movement-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} error={invalidRange ? 'Bitiş başlangıçtan önce' : undefined} className="w-full sm:w-40" />
        <Input label="Son gün" name="movement-to" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-40" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending && !invalidRange}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Eşleşen hareket yok' : 'Stok hareketi yok'}
        emptyHint={filtered ? undefined : 'Mal kabul girişi, adisyon kapanışında satış düşümü, elle çıkış / fire / transfer ve sayım farkı burada listelenir.'}
      />
      {entering && <ManualMovementDialog onClose={() => setEntering(false)} />}
    </div>
  );
}
