import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ASSET_LIST_STATES, ASSET_LIST_STATE_LABELS, ASSET_STATUS_LABELS, MAX_ASSET_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { useRowSelection } from '../../components/BulkSelection.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ASSET_STATUS_TONES, assetPath, parseLocationValue } from '../../lib/assets.js';
import { useAssetOptions, useAssets } from '../../lib/assetQueries.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { useDebounced } from '../../lib/pos.js';
import { AssetLabelDialog } from './AssetDialogs.jsx';
import { EmployeeSelect, LocationSelect, useAssetAccess } from './AssetFields.jsx';
import { AssetFormDialog } from './AssetFormDialog.jsx';
import { AssetImportDialog } from './AssetImportDialog.jsx';

const PAGE_SIZE = 25;
const STATE_OPTIONS = ASSET_LIST_STATES.map((value) => ({ value, label: ASSET_LIST_STATE_LABELS[value] }));

/**
 * Demirbaş listesi (modül 46): kod / ad / seri no ile arama; durum, kategori, konum ve zimmetle süzme. Seçilenlerin
 * etiketi yazdırılır; yeni kart elle ya da Excel ile açılır. Net değer = maliyet − birikmiş amortisman.
 */
export function AssetsPage() {
  const navigate = useNavigate();
  const access = useAssetAccess();
  const options = useAssetOptions();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [filters, setFilters] = useState({ state: 'ACTIVE', categoryId: '', location: '', employeeId: '' });
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const selection = useRowSelection();
  const { roomId, areaId } = parseLocationValue(filters.location);
  const list = useAssets({
    search,
    state: filters.state,
    categoryId: filters.categoryId || undefined,
    roomId: roomId ?? undefined,
    areaId: areaId ?? undefined,
    employeeId: filters.employeeId || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const update = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    selection.clear();
  };
  const filtered = Boolean(search || filters.categoryId || filters.location || filters.employeeId || filters.state !== 'ACTIVE');
  const categoryOptions = [{ value: '', label: 'Hepsi' }, ...(options.data?.categories ?? []).map((item) => ({ value: item.id, label: item.name }))];

  const columns = [
    ...(access.manage ? [selection.column(list.data?.items ?? [], (row) => row.status === 'ACTIVE', 'Elden çıkarılmış demirbaşın etiketi basılmaz')] : []),
    {
      key: 'asset',
      header: 'Demirbaş',
      render: (row) => (
        <Link to={assetPath(row.id)} className="block">
          <span className="block font-semibold text-ink hover:underline">{row.name}</span>
          <span className="block text-xs text-ink-muted">
            <span className="font-mono">{row.code}</span>
            {[row.brand, row.model, row.serialNumber].filter(Boolean).length > 0 && ` · ${[row.brand, row.model, row.serialNumber].filter(Boolean).join(' · ')}`}
          </span>
        </Link>
      ),
    },
    { key: 'category', header: 'Kategori', render: (row) => <span className="text-xs">{row.category.name}</span> },
    {
      key: 'location',
      header: 'Konum / zimmet',
      render: (row) => (
        <span className="block text-xs">
          <span className="block">{row.location.label}</span>
          {row.employee && <span className="block text-ink-muted">Zimmet: {row.employee.name}</span>}
        </span>
      ),
    },
    { key: 'purchase', header: 'Alış', className: 'whitespace-nowrap', render: (row) => <span className="text-xs">{formatDate(row.purchaseDate)}</span> },
    { key: 'cost', header: 'Maliyet', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => formatMoney(row.cost) },
    { key: 'book', header: 'Net değer', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => <span className="font-semibold">{formatMoney(row.bookValue)}</span> },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={ASSET_STATUS_TONES[row.status]}>{ASSET_STATUS_LABELS[row.status]}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {list.data?.summary ? (
            <>
              <strong className="text-ink">{list.data.summary.count}</strong> demirbaş · toplam maliyet <strong className="text-ink">{formatMoney(list.data.summary.totalCost)}</strong>
            </>
          ) : (
            ' '
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {access.manage && selection.count > 0 && (
            <Button type="button" variant="outline" icon="fileText" onClick={() => setDialog('labels')} disabled={selection.count > MAX_ASSET_LABELS}>
              {selection.count > MAX_ASSET_LABELS ? `En fazla ${MAX_ASSET_LABELS} etiket` : `Etiket yazdır (${selection.count})`}
            </Button>
          )}
          {access.manage && (
            <>
              <Button type="button" variant="outline" icon="upload" onClick={() => setDialog('import')}>
                Excel ile yükle
              </Button>
              <Button type="button" icon="plus" onClick={() => setDialog('create')}>
                Yeni demirbaş
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Input
          label="Ara"
          name="asset-search"
          value={searchText}
          onChange={(event) => {
            setSearchText(event.target.value);
            setPage(1);
            selection.clear();
          }}
          placeholder="Kod, ad ya da seri no"
        />
        <Select label="Durum" name="asset-state" value={filters.state} onChange={(event) => update('state', event.target.value)} options={STATE_OPTIONS} />
        <Select label="Kategori" name="asset-category-filter" value={filters.categoryId} onChange={(event) => update('categoryId', event.target.value)} options={categoryOptions} />
        <LocationSelect name="asset-location-filter" value={filters.location} onChange={(value) => update('location', value)} options={options.data} placeholder="Hepsi" />
        <EmployeeSelect label="Zimmet" name="asset-employee-filter" value={filters.employeeId} onChange={(value) => update('employeeId', value)} employees={options.data?.employees} placeholder="Hepsi" />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={(next) => {
          setPage(next);
          selection.clear();
        }}
        emptyTitle={filtered ? 'Süzgece uyan demirbaş yok' : 'Henüz demirbaş yok'}
        emptyHint={filtered ? 'Aramayı ya da süzgeçleri değiştirin.' : access.manage ? 'Yeni demirbaş ekleyin ya da Excel şablonuyla toplu yükleyin.' : 'Demirbaş kartları açıldıkça burada görünür.'}
      />
      {dialog === 'create' && <AssetFormDialog onClose={() => setDialog(null)} onDone={(asset) => navigate(assetPath(asset.id))} />}
      {dialog === 'import' && <AssetImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'labels' && <AssetLabelDialog ids={selection.ids} onClose={() => setDialog(null)} />}
    </div>
  );
}

