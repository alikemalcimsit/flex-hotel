import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ASSET_WARRANTY_STATES, ASSET_WARRANTY_STATE_LABELS, ASSET_WARRANTY_WINDOWS } from '@hotelos/hotel-contracts';
import { Badge, Select } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { assetPath, warrantyTone } from '../../lib/assets.js';
import { useAssetWarranty } from '../../lib/assetQueries.js';
import { formatDate } from '../../lib/format.js';

const STATE_OPTIONS = ASSET_WARRANTY_STATES.map((value) => ({ value, label: ASSET_WARRANTY_STATE_LABELS[value] }));
const WINDOW_OPTIONS = ASSET_WARRANTY_WINDOWS.map((days) => ({ value: String(days), label: `${days} gün içinde` }));

/**
 * Garantisi bitecekler (modül 46): seçilen pencerede garantisi bitecek kullanımdaki demirbaşlar (en yakın önce) ya da
 * garantisi son bir yılda bitmişler. İlk pencereye giren kart için yetkiliye günde bir zil çalar.
 */
export function AssetWarrantyPage() {
  const [state, setState] = useState('EXPIRING');
  const [windowDays, setWindowDays] = useState(String(ASSET_WARRANTY_WINDOWS[0]));
  const expiring = state === 'EXPIRING';
  const query = useAssetWarranty({ state, ...(expiring ? { withinDays: Number(windowDays) } : {}) });

  const columns = [
    {
      key: 'asset',
      header: 'Demirbaş',
      render: (row) => (
        <Link to={assetPath(row.id)} className="block">
          <span className="block font-semibold text-ink hover:underline">{row.name}</span>
          <span className="block text-xs text-ink-muted">
            <span className="font-mono">{row.code}</span> · {row.categoryName}
          </span>
        </Link>
      ),
    },
    { key: 'location', header: 'Konum', render: (row) => <span className="text-xs">{row.locationLabel}</span> },
    { key: 'supplier', header: 'Tedarikçi', render: (row) => <span className="text-xs">{row.supplierName ?? '—'}</span> },
    { key: 'until', header: 'Garanti bitiş', className: 'whitespace-nowrap', render: (row) => formatDate(row.warrantyUntil) },
    {
      key: 'days',
      header: 'Kalan',
      className: 'whitespace-nowrap',
      render: (row) => (
        <Badge tone={warrantyTone(row.daysLeft)} dot={false}>
          {row.daysLeft < 0 ? `${Math.abs(row.daysLeft)} gün önce bitti` : row.daysLeft === 0 ? 'bugün bitiyor' : `${row.daysLeft} gün`}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <ChoiceChips label="Garanti" options={STATE_OPTIONS} value={state} onChange={setState} required />
        {expiring && <Select label="Pencere" name="warranty-window" className="w-full sm:w-48" value={windowDays} onChange={(event) => setWindowDays(event.target.value)} options={WINDOW_OPTIONS} />}
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.items}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.isError ? query.error : null}
        onRetry={() => query.refetch()}
        emptyTitle={expiring ? `${windowDays} gün içinde garantisi bitecek demirbaş yok` : 'Son bir yılda garantisi biten demirbaş yok'}
        emptyHint="Garanti bitiş tarihi demirbaş kartında yazılır."
      />
    </div>
  );
}
