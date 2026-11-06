import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EDOC_RESENDABLE_STATES,
  EDOC_STATES,
  EDOC_STATE_LABELS,
  INVOICE_DOCUMENT_TYPES,
  INVOICE_DOCUMENT_TYPE_LABELS,
  INVOICE_SOURCES,
  INVOICE_SOURCE_LABELS,
  INVOICE_STATUS_LABELS,
} from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { EDOC_STATE_TONES, INVOICE_STATUS_TONES, invoiceKeys } from '../../lib/invoicing.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ManualInvoiceDialog } from './ManualInvoiceDialog.jsx';

const PAGE_SIZE = 25;

/**
 * Faturalar (modül 16 / 49): kesilenler (varsayılan) ya da taslaklar. Kesilenlerde belge türü, GİB durumu, kaynak,
 * dönem ve arama süzgeci; dikkat isteyen e-belgeler üstte sayılır (gönderilemedi / reddedildi / bekleyen).
 * Gönderilemeyen ya da reddedilen e-belge satırdan yeniden gönderilir.
 *
 * @param {{ drafts?: boolean }} props
 */
export function InvoicesPage({ drafts = false }) {
  const can = useCan();
  const canIssue = can(PERMISSIONS.INVOICES_ISSUE);
  const canManage = can(PERMISSIONS.INVOICES_MANAGE);
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [documentType, setDocumentType] = useState('');
  const [edocState, setEdocState] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [manual, setManual] = useState(false);
  useEffect(() => setPage(1), [search, documentType, edocState, status, source, period.from, period.to, drafts]);

  const filters = drafts
    ? { status: 'DRAFT', search: search || undefined, source: source || undefined, page, pageSize: PAGE_SIZE }
    : {
        status: status || undefined,
        documentType: documentType || undefined,
        edocState: edocState || undefined,
        source: source || undefined,
        from: period.from || undefined,
        to: period.to || undefined,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      };
  const list = useQuery({ queryKey: invoiceKeys.list(filters), queryFn: () => api(withQuery('/invoices', filters)), placeholderData: keepPreviousData });
  const counts = list.data?.counts;

  const resend = useMutation({
    mutationFn: (row) => apiPost(`/invoices/${row.id}/resend`, {}),
    onSuccess: (_data, row) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      toastSuccess(`${row.number} yeniden gönderim sırasına alındı`);
    },
    onError: (error) => toastError(error.message),
  });

  const columns = [
    {
      key: 'number',
      header: drafts ? 'Taslak' : 'Fatura',
      render: (row) => (
        <Link to={`/faturalar/${row.id}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.number ?? 'Taslak'}</span>
          <span className="block text-xs text-ink-muted">
            {INVOICE_SOURCE_LABELS[row.source]}
            {row.documentType ? ` · ${INVOICE_DOCUMENT_TYPE_LABELS[row.documentType]}` : ''}
          </span>
        </Link>
      ),
    },
    { key: 'date', header: drafts ? 'Açıldı' : 'Tarih', className: 'whitespace-nowrap', render: (row) => formatDate(drafts ? row.createdAt : row.issueDate) },
    {
      key: 'buyer',
      header: 'Alıcı',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.buyerName ?? '—'}</span>
          {row.buyerTaxNumber && <span className="block text-xs text-ink-muted tabular-nums">{row.buyerTaxNumber}</span>}
        </span>
      ),
    },
    { key: 'total', header: 'Tutar', className: 'text-right tabular-nums font-semibold', render: (row) => formatMoney(row.total, row.currency) },
    ...(drafts
      ? []
      : [
          {
            key: 'status',
            header: 'Durum',
            render: (row) => <Badge tone={INVOICE_STATUS_TONES[row.status]}>{INVOICE_STATUS_LABELS[row.status]}</Badge>,
          },
          {
            key: 'edoc',
            header: 'GİB durumu',
            render: (row) =>
              row.edocState ? (
                <span className="flex flex-col items-start gap-1">
                  <Badge tone={EDOC_STATE_TONES[row.edocState]}>{EDOC_STATE_LABELS[row.edocState]}</Badge>
                  {(row.edocState === 'FAILED' || row.edocState === 'REJECTED') && row.edocMessage && <span className="max-w-56 text-xs text-sec-strong line-clamp-2">{row.edocMessage}</span>}
                  {row.edocState === 'QUEUED' && row.edocAttempts > 0 && <span className="text-xs text-ink-muted">{row.edocAttempts}. deneme bekliyor</span>}
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'action',
            header: '',
            className: 'text-right',
            render: (row) =>
              canIssue && row.status === 'ISSUED' && EDOC_RESENDABLE_STATES.includes(row.edocState) ? (
                <Button type="button" size="sm" variant="outline" icon="send" disabled={resend.isPending} onClick={() => resend.mutate(row)}>
                  Tekrar gönder
                </Button>
              ) : null,
          },
        ]),
  ];

  const tile = (state, label, hint, icon, tone) => (
    <SummaryTile label={label} value={counts?.[state.count]} hint={hint} icon={icon} tone={tone} selected={edocState === state.filter} onClick={() => setEdocState((current) => (current === state.filter ? '' : state.filter))} />
  );

  return (
    <div className="flex flex-col gap-4">
      {!drafts && counts && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tile({ count: 'failed', filter: 'FAILED' }, 'Gönderilemedi', 'Entegratöre ulaşılamadı', 'alertTriangle', counts.failed ? 'danger' : 'neutral')}
          {tile({ count: 'rejected', filter: 'REJECTED' }, 'Reddedildi', 'GİB ya da alıcı reddetti', 'alertCircle', counts.rejected ? 'danger' : 'neutral')}
          <SummaryTile label="Sonuç bekleniyor" value={counts.pending} hint="Sırada ya da entegratörde" icon="clock" />
          <SummaryTile label="İptal onayı bekliyor" value={counts.cancelPending} hint="Onay kuyruğunda" icon="rotateCcw" tone={counts.cancelPending ? 'warning' : 'neutral'} selected={status === 'CANCEL_PENDING'} onClick={() => setStatus((current) => (current === 'CANCEL_PENDING' ? '' : 'CANCEL_PENDING'))} />
        </div>
      )}
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setManual(true)}>
              Serbest fatura
            </Button>
          )
        }
      >
        <Input label="Ara" name="invoice-search" placeholder="Fatura no, alıcı, vergi no" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-52" />
        <Select label="Kaynak" options={[{ value: '', label: 'Hepsi' }, ...INVOICE_SOURCES.map((value) => ({ value, label: INVOICE_SOURCE_LABELS[value] }))]} value={source} onChange={(event) => setSource(event.target.value)} className="w-full sm:w-36" />
        {!drafts && (
          <>
            <Select label="Belge" options={[{ value: '', label: 'Hepsi' }, ...INVOICE_DOCUMENT_TYPES.map((value) => ({ value, label: INVOICE_DOCUMENT_TYPE_LABELS[value] }))]} value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="w-full sm:w-32" />
            <Select label="GİB durumu" options={[{ value: '', label: 'Hepsi' }, ...EDOC_STATES.map((value) => ({ value, label: EDOC_STATE_LABELS[value] }))]} value={edocState} onChange={(event) => setEdocState(event.target.value)} className="w-full sm:w-40" />
            <Input label="Başlangıç" type="date" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} className="w-full sm:w-36" />
            <Input label="Bitiş" type="date" value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} className="w-full sm:w-36" />
          </>
        )}
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
        emptyTitle={drafts ? 'Taslak yok' : search || documentType || edocState || status || source ? 'Eşleşen fatura yok' : 'Kesilmiş fatura yok'}
        emptyHint={drafts ? 'Kapanan folyonun taslağı kendiliğinden açılır; etkinlik ve serbest fatura taslağı Faturalanacaklar ve "Serbest fatura"dan.' : undefined}
      />
      {manual && <ManualInvoiceDialog onClose={() => setManual(false)} />}
    </div>
  );
}

/** Taslaklar sekmesi. */
export function InvoiceDraftsPage() {
  return <InvoicesPage drafts />;
}
