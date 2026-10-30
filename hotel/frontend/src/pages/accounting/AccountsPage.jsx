import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LEDGER_ACCOUNT_TYPES, LEDGER_ACCOUNT_TYPE_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { accountingKeys, balanceLabel } from '../../lib/accounting.js';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { AccountDialog } from './AccountDialog.jsx';

const PAGE_SIZE = 25;
const TYPE_OPTIONS = [{ value: '', label: 'Bütün türler' }, ...LEDGER_ACCOUNT_TYPES.map((value) => ({ value, label: LEDGER_ACCOUNT_TYPE_LABELS[value] }))];
const BALANCE_OPTIONS = [
  { value: '', label: 'Hepsi' },
  { value: 'DEBIT', label: 'Borçlu (bize borçlu)' },
  { value: 'CREDIT', label: 'Alacaklı (biz borçluyuz)' },
  { value: 'ANY', label: 'Bakiyeli' },
];
const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Kullanımda' },
  { value: 'false', label: 'Kullanımdan kalkmış' },
  { value: 'all', label: 'Hepsi' },
];
const SORT_OPTIONS = [
  { value: 'name', label: 'Ünvana göre' },
  { value: 'balance', label: 'Bakiyeye göre (en borçlu)' },
  { value: 'code', label: 'Koda göre' },
];

/**
 * Cariler (modül 47): acente ve tedarikçi carileri kartlarından, etkinlik müşterisi ilk kaydında, şirket / şahıs
 * elle açılır. Bakiye borç − alacak: (B) cari bize borçlu, (A) biz cariye borçluyuz. Toplam alacak / borç üstte.
 */
export function AccountsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.ACCOUNTING_MANAGE);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [type, setType] = useState('');
  const [balance, setBalance] = useState('');
  const [active, setActive] = useState('true');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  useEffect(() => setPage(1), [search, type, balance, active, sort]);

  const filters = { search: search || undefined, type: type || undefined, balance: balance || undefined, active, sort, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: accountingKeys.accounts(filters), queryFn: () => api(withQuery('/accounting/accounts', filters)), placeholderData: keepPreviousData });
  const currency = list.data?.currency ?? '';

  const columns = [
    {
      key: 'name',
      header: 'Cari',
      render: (row) => (
        <Link to={`/muhasebe/cariler/${row.id}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">{[row.code, row.taxNumber, row.contactName].filter(Boolean).join(' · ')}</span>
        </Link>
      ),
    },
    { key: 'type', header: 'Tür', render: (row) => <Badge tone={row.type === 'AGENCY' ? 'sky' : row.type === 'SUPPLIER' ? 'violet' : 'neutral'}>{LEDGER_ACCOUNT_TYPE_LABELS[row.type]}</Badge> },
    { key: 'term', header: 'Vade', render: (row) => (row.paymentTermDays ? `${row.paymentTermDays} gün` : 'Peşin') },
    { key: 'last', header: 'Son hareket', render: (row) => (row.lastEntryOn ? formatDate(row.lastEntryOn) : '—') },
    {
      key: 'balance',
      header: 'Bakiye',
      className: 'text-right tabular-nums',
      render: (row) => {
        const label = balanceLabel(row.balance, currency);
        return <span className={label.side === 'DEBIT' ? 'font-semibold text-ink' : label.side === 'CREDIT' ? 'font-semibold text-warning-ink' : 'text-ink-muted'}>{label.text}</span>;
      },
    },
    ...(active === 'true' ? [] : [{ key: 'status', header: 'Durum', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Kullanımda' : 'Kalkmış'}</Badge> }]),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryTile
          label="Alacağımız"
          value={list.data ? formatMoney(list.data.totals.receivable, currency) : undefined}
          hint="Borçlu carilerin toplamı (acente, şirket, etkinlik müşterisi)"
          icon="wallet"
          selected={balance === 'DEBIT'}
          onClick={() => setBalance(balance === 'DEBIT' ? '' : 'DEBIT')}
        />
        <SummaryTile
          label="Borcumuz"
          value={list.data ? formatMoney(list.data.totals.payable, currency) : undefined}
          hint="Alacaklı carilerin toplamı (tedarikçi, avans, prim)"
          icon="coins"
          tone="warning"
          selected={balance === 'CREDIT'}
          onClick={() => setBalance(balance === 'CREDIT' ? '' : 'CREDIT')}
        />
      </div>
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setCreating(true)}>
              Cari aç
            </Button>
          )
        }
      >
        <Input label="Ara" name="account-search" placeholder="Ünvan, kod, vergi no" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-64" />
        <Select label="Tür" name="account-type" options={TYPE_OPTIONS} value={type} onChange={(event) => setType(event.target.value)} className="w-full sm:w-40" />
        <Select label="Bakiye" name="account-balance" options={BALANCE_OPTIONS} value={balance} onChange={(event) => setBalance(event.target.value)} className="w-full sm:w-52" />
        <Select label="Durum" name="account-active" options={ACTIVE_OPTIONS} value={active} onChange={(event) => setActive(event.target.value)} className="w-full sm:w-48" />
        <Select label="Sıra" name="account-sort" options={SORT_OPTIONS} value={sort} onChange={(event) => setSort(event.target.value)} className="w-full sm:w-52" />
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
        emptyTitle={search || type || balance ? 'Eşleşen cari yok' : 'Cari yok'}
        emptyHint={!search && !type && !balance ? 'Acente ve tedarikçi carileri kartlarından kendiliğinden açılır; şirket ya da şahıs carisini "Cari aç" ile ekleyin.' : undefined}
      />
      {creating && <AccountDialog account={null} onClose={() => setCreating(false)} />}
    </div>
  );
}
