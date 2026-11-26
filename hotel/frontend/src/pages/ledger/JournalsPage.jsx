import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { JOURNAL_ENTRY_STATUSES, JOURNAL_ENTRY_STATUS_LABELS, JOURNAL_ENTRY_TYPES, JOURNAL_ENTRY_TYPE_LABELS, JOURNAL_PAGE_SIZE, JOURNAL_SOURCES, JOURNAL_SOURCE_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { JOURNAL_STATUS_TONES, ledgerKeys } from '../../lib/ledger.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { GlAccountField } from './GlAccountField.jsx';
import { JournalDialog } from './JournalDialog.jsx';

const withAll = (values, labels, all) => [{ value: '', label: all }, ...values.map((value) => ({ value, label: labels[value] }))];
const TYPE_OPTIONS = withAll(JOURNAL_ENTRY_TYPES, JOURNAL_ENTRY_TYPE_LABELS, 'Hepsi');
const STATUS_OPTIONS = withAll(JOURNAL_ENTRY_STATUSES, JOURNAL_ENTRY_STATUS_LABELS, 'Hepsi');
const SOURCE_OPTIONS = withAll(JOURNAL_SOURCES, JOURNAL_SOURCE_LABELS, 'Bütün kaynaklar');

/**
 * Yevmiye (modül 48): fiş listesi — dönem, tür (otomatik / elle), durum, kaynak, hesap ve arama süzgeci;
 * sayfalı. "Fiş gir" (`ledger.manage`) elle fiş penceresini açar; satır fiş sayfasına gider.
 */
export function JournalsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.LEDGER_MANAGE);
  const { data: hotel } = useHotelContext();
  const currency = hotel?.currency ?? '';
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [account, setAccount] = useState(null);
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  useEffect(() => setPage(1), [search, type, status, source, account?.id, period.from, period.to]);

  const filters = {
    search: search || undefined,
    type: type || undefined,
    status: status || undefined,
    source: source || undefined,
    accountId: account?.id,
    from: period.from || undefined,
    to: period.to || undefined,
    page,
    pageSize: JOURNAL_PAGE_SIZE,
  };
  const list = useQuery({ queryKey: ledgerKeys.journals(filters), queryFn: () => api(withQuery('/ledger/journals', filters)), placeholderData: keepPreviousData });
  const hasFilter = Boolean(search || type || status || source || account || period.from || period.to);

  const columns = [
    {
      key: 'number',
      header: 'Fiş',
      render: (row) => (
        <Link to={`/genel-muhasebe/yevmiye/${row.id}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.number}</span>
          <span className="block text-xs text-ink-muted">
            {JOURNAL_ENTRY_TYPE_LABELS[row.type]} · {row.lineCount} satır
          </span>
        </Link>
      ),
    },
    { key: 'date', header: 'Gün', className: 'whitespace-nowrap', render: (row) => formatDate(row.date) },
    { key: 'source', header: 'Kaynak', render: (row) => <span className="text-ink-soft">{JOURNAL_SOURCE_LABELS[row.source] ?? row.source}</span> },
    {
      key: 'description',
      header: 'Açıklama',
      render: (row) => (
        <span className="block">
          <span className="line-clamp-2 text-ink-soft">{row.description}</span>
          {row.reference && <span className="block text-xs text-ink-muted">belge {row.reference}</span>}
        </span>
      ),
    },
    { key: 'total', header: 'Tutar', className: 'text-right tabular-nums font-semibold whitespace-nowrap', render: (row) => formatMoney(row.total, currency) },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={JOURNAL_STATUS_TONES[row.status]}>{JOURNAL_ENTRY_STATUS_LABELS[row.status]}</Badge>
          {row.reversal && (
            <Link to={`/genel-muhasebe/yevmiye/${row.reversal.id}`} className="text-xs text-ink-muted hover:underline">
              ters fiş {row.reversal.number}
            </Link>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setCreating(true)}>
              Fiş gir
            </Button>
          )
        }
      >
        <Input label="Ara" name="journal-search" placeholder="Fiş no, açıklama, belge no" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-56" />
        <Input label="Başlangıç" type="date" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} className="w-full sm:w-40" />
        <Input label="Bitiş" type="date" value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} className="w-full sm:w-40" />
        <Select label="Tür" options={TYPE_OPTIONS} value={type} onChange={(event) => setType(event.target.value)} className="w-full sm:w-36" />
        <Select label="Durum" options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-36" />
        <Select label="Kaynak" options={SOURCE_OPTIONS} value={source} onChange={(event) => setSource(event.target.value)} className="w-full sm:w-52" />
        <div className="w-full sm:w-72">
          <GlAccountField label="Hesap" value={account} onChange={setAccount} compact />
        </div>
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
        emptyTitle={hasFilter ? 'Eşleşen fiş yok' : 'Yevmiye fişi yok'}
        emptyHint={hasFilter ? undefined : 'Ön muhasebe hareketleri ve gün kapanışı kendiliğinden fiş olur; elle fiş "Fiş gir" ile açılır. Fişlenmemiş hareket için Ayarlar → Eşitle.'}
      />
      {creating && <JournalDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
