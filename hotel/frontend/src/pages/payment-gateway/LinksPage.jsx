import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PAYMENT_LINK_STATUSES, PAYMENT_LINK_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { GATEWAY_PAGE_SIZE, cardText, gatewayKeys, linkStatusTone, linkWarning, originLabel } from '../../lib/paymentGateway.js';
import { useDebounced } from '../../lib/pos.js';

const STATUS_OPTIONS = [{ value: '', label: 'Hepsi' }, ...PAYMENT_LINK_STATUSES.map((value) => ({ value, label: PAYMENT_LINK_STATUS_LABELS[value] }))];

const detailPath = (row) => `/sanal-pos/linkler/${row.id}`;

const COLUMNS = [
  {
    key: 'createdAt',
    header: 'Oluşturma',
    className: 'whitespace-nowrap text-xs',
    render: (row) => (
      <Link to={detailPath(row)} className="font-semibold text-ink hover:underline">
        {formatDateTime(row.createdAt)}
      </Link>
    ),
  },
  {
    key: 'reservation',
    header: 'Rezervasyon',
    className: 'whitespace-nowrap',
    render: (row) =>
      row.confirmationCode ? (
        <Link to={`/rezervasyonlar/${row.reservationId}`} className="font-mono text-xs font-semibold text-ink hover:underline">
          {row.confirmationCode}
        </Link>
      ) : (
        '—'
      ),
  },
  { key: 'guest', header: 'Misafir', render: (row) => row.guestName ?? '—' },
  { key: 'amount', header: 'Tutar', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => formatMoney(row.amount, row.currency) },
  {
    key: 'status',
    header: 'Durum',
    render: (row) => {
      const warning = linkWarning(row);
      return (
        <span className="block">
          <Badge tone={linkStatusTone(row.status)}>{PAYMENT_LINK_STATUS_LABELS[row.status] ?? row.status}</Badge>
          {warning && <span className={`mt-1 block text-xs ${warning.tone === 'danger' ? 'text-danger-ink' : 'text-warning-ink'}`}>{warning.title}</span>}
        </span>
      );
    },
  },
  { key: 'card', header: 'Kart', className: 'whitespace-nowrap font-mono text-xs', render: cardText },
  { key: 'origin', header: 'Kaynak', className: 'whitespace-nowrap text-xs', render: (row) => originLabel(row.origin) },
  {
    key: 'refunded',
    header: 'İade',
    className: 'whitespace-nowrap text-right tabular-nums',
    render: (row) => (Number(row.refundedAmount) > 0 ? formatMoney(row.refundedAmount, row.currency) : '—'),
  },
];

/**
 * Sanal POS işlemleri (modül 50): özet (bekleyen link, ödenen, iade), durum / tarih / arama süzgeçli ödeme linkleri.
 * Satır ayrıntıya, rezervasyon kodu rezervasyona gider.
 */
export function LinksPage() {
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, from, to, search]);

  const filters = { status: status || undefined, from: from || undefined, to: to || undefined, search: search || undefined, page, pageSize: GATEWAY_PAGE_SIZE };
  const list = useQuery({ queryKey: gatewayKeys.links(filters), queryFn: () => api(withQuery('/payment-gateway/links', filters)), placeholderData: keepPreviousData });
  const summary = list.data?.summary;
  /** Özet kutusu süzgeç düğmesi: aynısına yeniden basınca kaldırır. @param {string} next */
  const pickStatus = (next) => setStatus((current) => (current === next ? '' : next));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="Bekleyen link" value={summary?.open} hint="Misafirin ödemesi bekleniyor" icon="clock" selected={status === 'OPEN'} onClick={() => pickStatus('OPEN')} />
        <SummaryTile label="Ödenen" value={summary?.paid} hint={summary ? `Toplam ${formatMoney(summary.paidAmount)}` : 'Kartla ödenen linkler'} icon="checkCircle" selected={status === 'PAID'} onClick={() => pickStatus('PAID')} />
        <SummaryTile label="Karta iade" value={summary ? formatMoney(summary.refundedAmount) : undefined} hint="Onaylanıp karta iade edilen" icon="rotateCcw" />
      </div>
      <Toolbar>
        <Select label="Durum" name="pg-status" options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-44" />
        <Input label="Başlangıç" name="pg-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="w-full sm:w-40" />
        <Input label="Bitiş" name="pg-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-40" />
        <Input label="Ara" name="pg-search" placeholder="Rezervasyon kodu, soyad, kart son 4" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-64" />
      </Toolbar>
      <DataTable
        columns={COLUMNS}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle="Ödeme linki yok"
        emptyHint={status || from || to || search ? 'Süzgeçlere uyan link bulunamadı.' : 'Rezervasyon ayrıntısındaki "Ödeme linki oluştur" ile başlayın.'}
        rowActions={(row) => (
          <Link to={detailPath(row)} className="inline-flex items-center gap-1.5 rounded-item px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.04] hover:text-ink">
            Ayrıntı
          </Link>
        )}
      />
    </div>
  );
}
