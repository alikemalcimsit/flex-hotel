import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { STOCK_ITEM_GROUPS, STOCK_ITEM_GROUP_LABELS } from '@hotelos/hotel-contracts';
import { Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { purchasingKeys } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { NewRequestDialog } from './NewRequestDialog.jsx';

const PAGE_SIZE = 25;
const GROUP_OPTIONS = [{ value: '', label: 'Bütün gruplar' }, ...STOCK_ITEM_GROUPS.map((group) => ({ value: group, label: STOCK_ITEM_GROUP_LABELS[group] }))];

/**
 * Minimum stok önerileri (modül 45): minimum seviyesi tanımlı malzemelerde öneri = minimum −
 * (eldeki + yoldaki siparişler + henüz siparişe dönmemiş elle / stok talepleri); en kritik önce.
 * Seçilenler (sayfalar arası) "minimum stok" kaynaklı talebe döner; miktar talep formunda
 * düzenlenebilir. Minimum seviye Stok → Mevcut ekranında tanımlanır.
 */
export function SuggestionsPage() {
  const can = useCan();
  const { data: hotel } = useHotelContext();
  const canRequest = can(PERMISSIONS.PURCHASING_REQUEST);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [group, setGroup] = useState('');
  const [page, setPage] = useState(1);
  /** @type {[Map<string, any>, Function]} */
  const [selected, setSelected] = useState(() => new Map());
  const [requesting, setRequesting] = useState(false);
  useEffect(() => setPage(1), [search, group]);

  const filters = { search: search || undefined, group: group || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: purchasingKeys.suggestions(filters), queryFn: () => api(withQuery('/purchasing/suggestions', filters)), placeholderData: keepPreviousData });

  const toggle = (row) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(row.stockItemId)) next.delete(row.stockItemId);
      else next.set(row.stockItemId, row);
      return next;
    });
  const rows = list.data?.items ?? [];
  const allOnPage = rows.length > 0 && rows.every((row) => selected.has(row.stockItemId));
  const togglePage = () =>
    setSelected((current) => {
      const next = new Map(current);
      for (const row of rows) {
        if (allOnPage) next.delete(row.stockItemId);
        else next.set(row.stockItemId, row);
      }
      return next;
    });

  const columns = [
    ...(canRequest
      ? [
          {
            key: 'pick',
            header: 'Seç',
            render: (row) => <input type="checkbox" className="size-4 accent-ink" aria-label={`${row.name} seç`} checked={selected.has(row.stockItemId)} onChange={() => toggle(row)} />,
          },
        ]
      : []),
    {
      key: 'name',
      header: 'Malzeme',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">{[row.code, STOCK_ITEM_GROUP_LABELS[row.group]].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    { key: 'onHand', header: 'Eldeki', className: 'text-right tabular-nums', render: (row) => quantityText(row.onHand, row.unit) },
    { key: 'min', header: 'Minimum', className: 'text-right tabular-nums', render: (row) => quantityText(row.minLevel, row.unit) },
    { key: 'onOrder', header: 'Yolda', className: 'text-right tabular-nums', render: (row) => quantityText(row.onOrder, row.unit) },
    { key: 'requested', header: 'Talepte', className: 'text-right tabular-nums', render: (row) => quantityText(row.requested, row.unit) },
    { key: 'suggested', header: 'Önerilen', className: 'text-right tabular-nums font-semibold', render: (row) => quantityText(row.suggested, row.unit) },
    { key: 'total', header: 'Tahmini', className: 'text-right tabular-nums', render: (row) => formatMoney(row.estimatedTotal, hotel?.currency) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          canRequest && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={togglePage} disabled={rows.length === 0}>
                {allOnPage ? 'Sayfadakileri bırak' : 'Sayfadakileri seç'}
              </Button>
              <Button type="button" icon="plus" onClick={() => setRequesting(true)} disabled={selected.size === 0}>
                {selected.size ? `${selected.size} malzemeden talep aç` : 'Talep aç'}
              </Button>
            </div>
          )
        }
      >
        <Input label="Ara" name="suggestion-search" placeholder="Malzeme adı ya da kodu" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-60" />
        <Select label="Grup" name="suggestion-group" options={GROUP_OPTIONS} value={group} onChange={(event) => setGroup(event.target.value)} className="w-full sm:w-56" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={rows}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search || group ? 'Eşleşen öneri yok' : 'Minimum altında malzeme yok'}
        emptyHint={search || group ? undefined : 'Minimum seviyesi tanımlı malzemeler eldeki + yoldaki + talepteki miktarla karşılanıyor.'}
      />
      <p className="text-xs text-ink-muted">
        Minimum seviyeler <Link to="/stok" className="font-semibold underline">Stok → Mevcut</Link> ekranında tanımlanır. Banket talepleri etkinlik tüketimi içindir, öneriden düşülmez.
      </p>
      {requesting && (
        <NewRequestDialog
          source="STOCK"
          initialLines={[...selected.values()].map((row) => ({ stockItemId: row.stockItemId, name: row.name, unit: row.unit, quantity: row.suggested }))}
          onClose={() => setRequesting(false)}
        />
      )}
    </div>
  );
}
