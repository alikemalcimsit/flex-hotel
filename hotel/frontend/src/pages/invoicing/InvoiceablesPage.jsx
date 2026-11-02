import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Checkbox, Input, Select } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { invoiceKeys } from '../../lib/invoicing.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { toastError } from '../../store/toast.js';

const PAGE_SIZE = 25;
const WINDOWS = [
  { value: '7', label: 'Son 7 gün' },
  { value: '30', label: 'Son 30 gün' },
  { value: '90', label: 'Son 90 gün' },
  { value: '366', label: 'Son 1 yıl' },
];

/** Yasal sürenin rozeti: kalan gün ya da gecikme. @param {{ daysLeft: number | null, overdue: boolean }} row */
function DeadlineBadge({ row }) {
  if (row.daysLeft === null) return <span className="text-ink-muted">—</span>;
  if (row.overdue) return <Badge tone="danger">{-row.daysLeft} gün gecikti</Badge>;
  return <Badge tone={row.daysLeft <= 2 ? 'warning' : 'neutral'}>{row.daysLeft === 0 ? 'Son gün bugün' : `${row.daysLeft} gün kaldı`}</Badge>;
}

/**
 * Faturalanacaklar (modül 16 / 49): kapanan folyolar ve faturaya hazır etkinlikler — geçerli faturası olmayanlar,
 * en eski önce. Yasal süre (hizmetten sonra 7 gün) satırda; taslağı olan taslağa, olmayan için taslak açılır.
 */
export function InvoiceablesPage() {
  const can = useCan();
  const canIssue = can(PERMISSIONS.INVOICES_ISSUE) || can(PERMISSIONS.INVOICES_MANAGE);
  const canSetup = can(PERMISSIONS.INVOICES_SETUP);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState('FOLIO');
  const [days, setDays] = useState('30');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [kind, days, overdueOnly, search]);

  const filters = { kind, days, overdueOnly: overdueOnly ? 'true' : undefined, search: search || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: invoiceKeys.invoiceables(filters), queryFn: () => api(withQuery('/invoices/invoiceables', filters)), placeholderData: keepPreviousData });

  const open = useMutation({
    mutationFn: (row) => apiPost('/invoices', row.kind === 'FOLIO' ? { source: 'FOLIO', folioId: row.id } : { source: 'EVENT', eventId: row.id }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      navigate(`/faturalar/${data.invoice.id}`);
    },
    onError: (error) => toastError(error.message),
  });

  const columns = [
    {
      key: 'label',
      header: kind === 'FOLIO' ? 'Oda · misafir' : 'Etkinlik',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.label}</span>
          <span className="block text-xs text-ink-muted">
            {row.party}
            {row.cancellation ? ' · iptal bedeli' : ''}
          </span>
        </span>
      ),
    },
    { key: 'closedAt', header: kind === 'FOLIO' ? 'Kapanış' : 'Gerçekleşme / iptal', render: (row) => formatDate(row.closedAt) },
    { key: 'deadline', header: 'Yasal süre', render: (row) => <DeadlineBadge row={row} /> },
    { key: 'amount', header: 'Tutar', className: 'text-right tabular-nums font-semibold', render: (row) => formatMoney(row.amount, row.currency) },
    {
      key: 'action',
      header: '',
      className: 'text-right',
      render: (row) =>
        row.draftId ? (
          <Button type="button" size="sm" variant="outline" icon="pencil" onClick={() => navigate(`/faturalar/${row.draftId}`)}>
            Taslağa git
          </Button>
        ) : (
          canIssue && (
            <Button type="button" size="sm" icon="plus" disabled={open.isPending} onClick={() => open.mutate(row)}>
              Taslak aç
            </Button>
          )
        ),
    },
  ];

  const notStarted = list.data && list.data.startDate === null;

  return (
    <div className="flex flex-col gap-4">
      {notStarted && (
        <Alert tone="info" title="Faturalama başlamadı">
          Satıcı bilgileri ve faturalama başlangıcı girilince o günden sonra kapanan folyolar ve etkinlikler burada listelenir.{' '}
          {canSetup ? (
            <Link to="/faturalar/ayarlar" className="font-semibold hover:underline">
              Fatura ayarları
            </Link>
          ) : (
            'Fatura ayarlarını yetkili bir yönetici girer.'
          )}
        </Alert>
      )}
      <Toolbar>
        <ChoiceChips
          label="Kaynak"
          options={[
            { value: 'FOLIO', label: 'Kapanan folyolar' },
            { value: 'EVENT', label: 'Etkinlikler' },
          ]}
          value={kind}
          onChange={(value) => value && setKind(value)}
        />
        <Select label="Kapanış" options={WINDOWS} value={days} onChange={(event) => setDays(event.target.value)} className="w-full sm:w-40" />
        <Input label="Ara" name="invoiceable-search" placeholder={kind === 'FOLIO' ? 'Rezervasyon no, misafir, oda' : 'Etkinlik kodu, adı, müşteri'} value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-60" />
        <Checkbox name="invoiceable-overdue" label="Yalnız süresi geçenler" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />
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
        emptyTitle={notStarted ? 'Faturalama başlamadı' : search || overdueOnly ? 'Eşleşen kayıt yok' : 'Faturalanacak bir şey yok'}
        emptyHint={
          !notStarted && !search && !overdueOnly
            ? kind === 'FOLIO'
              ? 'Kapanan her folyonun taslağı kendiliğinden açılır (Taslaklar); bakiyesi sıfır, tutarı olan ve faturası kesilmemiş folyolar burada listelenir.'
              : 'Gerçekleşen ya da iptal bedeli kesinleşen etkinlikler burada; taslak açıp kesin.'
            : undefined
        }
      />
      {list.data?.startDate && <p className="text-xs text-ink-muted">Faturalama başlangıcı {formatDate(list.data.startDate)}: öncesinde kapananlar önceki sistemde faturalanmış sayılır, listelenmez.</p>}
    </div>
  );
}
