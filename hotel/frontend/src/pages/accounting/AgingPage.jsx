import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AGING_BUCKETS, LEDGER_ACCOUNT_TYPES, LEDGER_ACCOUNT_TYPE_LABELS } from '@hotelos/hotel-contracts';
import { Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { accountingKeys } from '../../lib/accounting.js';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';

const PAGE_SIZE = 25;
const SIDE_OPTIONS = [
  { value: 'DEBIT', label: 'Alacaklarımız (borçlu cariler)' },
  { value: 'CREDIT', label: 'Borçlarımız (alacaklı cariler)' },
];
const TYPE_OPTIONS = [{ value: '', label: 'Bütün türler' }, ...LEDGER_ACCOUNT_TYPES.map((value) => ({ value, label: LEDGER_ACCOUNT_TYPE_LABELS[value] }))];

/**
 * Yaşlandırma raporu (modül 47): açık bakiye vadesine göre dilimlere ayrılır — en eski borç önce kapanmış sayılır
 * (FIFO). Gecikmesi en büyük cari üstte; dip satırı süzgece göre toplam.
 */
export function AgingPage() {
  const [side, setSide] = useState('DEBIT');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [side, type]);
  const filters = { side, type: type || undefined, page, pageSize: PAGE_SIZE };
  const report = useQuery({ queryKey: accountingKeys.aging(filters), queryFn: () => api(withQuery('/accounting/accounts/aging', filters)), placeholderData: keepPreviousData });
  const currency = report.data?.currency ?? '';
  const totals = report.data?.totals;

  const columns = [
    {
      key: 'name',
      header: 'Cari',
      render: (row) => (
        <Link to={`/muhasebe/cariler/${row.accountId}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">
            {row.code} · {LEDGER_ACCOUNT_TYPE_LABELS[row.type]} · en eski vade {formatDate(row.oldestDue)}
          </span>
        </Link>
      ),
    },
    { key: 'open', header: 'Açık', className: 'text-right tabular-nums font-semibold', render: (row) => formatMoney(row.open) },
    ...AGING_BUCKETS.map((bucket) => ({
      key: bucket.key,
      header: bucket.label,
      className: 'text-right tabular-nums',
      render: (row) => {
        const value = Number(row.buckets[bucket.key]);
        return <span className={bucket.key !== 'NOT_DUE' && value > 0 ? 'font-semibold text-sec-strong' : value ? '' : 'text-ink-muted'}>{value ? formatMoney(row.buckets[bucket.key]) : '—'}</span>;
      },
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <Select label="Taraf" name="aging-side" options={SIDE_OPTIONS} value={side} onChange={(event) => setSide(event.target.value)} className="w-full sm:w-72" />
        <Select label="Tür" name="aging-type" options={TYPE_OPTIONS} value={type} onChange={(event) => setType(event.target.value)} className="w-full sm:w-40" />
      </Toolbar>
      {totals && Number(totals.open) > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <div className="rounded-card bg-surface p-4 shadow-soft">
            <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">Toplam açık</span>
            <span className="mt-1 block text-xl font-bold tabular-nums">{formatMoney(totals.open, currency)}</span>
          </div>
          {AGING_BUCKETS.map((bucket) => (
            <div key={bucket.key} className="rounded-card bg-surface p-4 shadow-soft">
              <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{bucket.label}</span>
              <span className={`mt-1 block text-xl font-bold tabular-nums ${bucket.key !== 'NOT_DUE' && Number(totals.buckets[bucket.key]) > 0 ? 'text-sec-strong' : ''}`}>{formatMoney(totals.buckets[bucket.key], currency)}</span>
            </div>
          ))}
        </div>
      )}
      <DataTable
        columns={columns}
        rows={report.data?.items}
        meta={report.data?.meta}
        isLoading={report.isPending}
        isFetching={report.isFetching}
        error={report.isError ? report.error : null}
        onRetry={() => report.refetch()}
        onPageChange={setPage}
        emptyTitle={side === 'DEBIT' ? 'Açık alacak yok' : 'Açık borç yok'}
        emptyHint="Bakiyesi bu yönde olan cari yok."
      />
    </div>
  );
}
