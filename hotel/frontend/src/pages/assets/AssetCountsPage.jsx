import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ASSET_COUNT_STATUSES, ASSET_COUNT_STATUS_LABELS, createAssetCountSchema } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { ASSET_COUNT_STATUS_TONES, assetCountPath, parseLocationValue } from '../../lib/assets.js';
import { useAssetCounts, useAssetOptions, useOpenAssetCount } from '../../lib/assetQueries.js';
import { formatDateTime } from '../../lib/format.js';
import { validateWith } from '../../lib/validate.js';
import { AssetDialog, LocationSelect, useAssetAccess } from './AssetFields.jsx';

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [{ value: '', label: 'Hepsi' }, ...ASSET_COUNT_STATUSES.map((value) => ({ value, label: ASSET_COUNT_STATUS_LABELS[value] }))];

/**
 * Demirbaş sayımları (modül 46): açık sayımlar üstte; yeni sayım tüm otel, bir alan ya da bir oda için açılır —
 * açılışta kapsamdaki kullanımdaki kartlar "beklenen" olarak dondurulur.
 */
export function AssetCountsPage() {
  const access = useAssetAccess();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState(false);
  const list = useAssetCounts({ status, page, pageSize: PAGE_SIZE });

  const columns = [
    {
      key: 'count',
      header: 'Sayım',
      render: (row) => (
        <Link to={assetCountPath(row.id)} className="block">
          <span className="block font-semibold text-ink hover:underline">{row.title || row.scopeLabel}</span>
          <span className="block text-xs text-ink-muted">
            <span className="font-mono">{row.number}</span> · {row.scopeLabel}
          </span>
        </Link>
      ),
    },
    {
      key: 'progress',
      header: 'Bulunan / beklenen',
      className: 'whitespace-nowrap tabular-nums',
      render: (row) => (
        <span className="text-sm">
          <strong>{row.foundCount}</strong> / {row.expectedCount}
        </span>
      ),
    },
    {
      key: 'issues',
      header: 'Eksik · fazla',
      className: 'whitespace-nowrap tabular-nums',
      render: (row) => (
        <span className={`text-sm ${row.missingCount ? 'font-semibold text-danger-ink' : 'text-ink-muted'}`}>
          {row.missingCount} · {row.extraCount}
        </span>
      ),
    },
    {
      key: 'time',
      header: 'Açılış / kapanış',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block">
            {formatDateTime(row.openedAt)} · {row.openedBy}
          </span>
          <span className="block text-ink-muted">{row.closedAt ? formatDateTime(row.closedAt) : '—'}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={ASSET_COUNT_STATUS_TONES[row.status]}>{ASSET_COUNT_STATUS_LABELS[row.status]}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Select
          label="Durum"
          name="asset-count-status"
          className="w-full sm:w-56"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
        />
        {access.manage && (
          <Button type="button" icon="plus" onClick={() => setOpening(true)}>
            Yeni sayım
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={status ? 'Bu durumda sayım yok' : 'Henüz sayım yok'}
        emptyHint={access.manage ? 'Yeni sayım açın; etiketleri okuttukça eksikler ve başka yerde bulunanlar listelenir.' : 'Sayım açıldığında burada görünür.'}
      />
      {opening && <OpenCountDialog onClose={() => setOpening(false)} onDone={(count) => navigate(assetCountPath(count.id))} />}
    </div>
  );
}

/**
 * Yeni sayım: başlık (isteğe bağlı) ve kapsam (tüm otel, bir alan ya da bir oda).
 * @param {{ onClose: () => void, onDone: (count: any) => void }} props
 */
function OpenCountDialog({ onClose, onDone }) {
  const options = useAssetOptions();
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [errors, setErrors] = useState({});
  const open = useOpenAssetCount({ onDone });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(createAssetCountSchema, { title: title || null, ...parseLocationValue(scope) });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    open.mutate(checked.data, { onError: (error) => setErrors(error.fields ?? {}) });
  }

  return (
    <AssetDialog id="asset-count-open" title="Yeni sayım" busy={open.isPending} onClose={onClose} submitLabel="Sayımı aç" icon="clipboard" onSubmit={submit}>
      <Input label="Başlık (isteğe bağlı)" name="asset-count-title" value={title} onChange={(event) => setTitle(event.target.value)} error={errors.title} placeholder="ör. Yıl sonu sayımı" disabled={open.isPending} />
      <LocationSelect label="Kapsam" name="asset-count-scope" value={scope} onChange={setScope} options={options.data} placeholder="Tüm otel" error={errors.areaId ?? errors.roomId} disabled={open.isPending || options.isPending} />
      <p className="text-xs text-ink-muted">
        Kapsamdaki kullanımdaki demirbaşlar açılışta "beklenen" olarak dondurulur. Etiketler okutuldukça bulunan, başka yerde bulunan ve kapsam dışından gelen (fazla) ayrılır;
        kapanışta başka yerde bulunanlar istenirse bulunduğu yere taşınır.
      </p>
    </AssetDialog>
  );
}
