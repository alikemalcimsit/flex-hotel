import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Card, Icon, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { dayText } from '../../lib/banquet.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { purchasingKeys, usePurchasingLive, useWarehouses } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { useDebounced } from '../../lib/pos.js';

const PAGE_SIZE = 25;

/**
 * Mal kabuller / irsaliyeler (modül 45): numara, irsaliye, kabul günü, tedarikçi, sipariş, depo,
 * tutar (KDV dahil) ve vade. Arama: mal kabul / irsaliye / sipariş no, tedarikçi.
 */
export function ReceiptsPage() {
  const warehouses = useWarehouses({ includeInactive: true });
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, warehouseId, from, to]);

  const invalidRange = from && to && to < from;
  const filters = { search: search || undefined, warehouseId: warehouseId || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: purchasingKeys.receipts(filters), queryFn: () => api(withQuery('/purchasing/receipts', filters)), placeholderData: keepPreviousData, enabled: !invalidRange });

  const columns = [
    {
      key: 'number',
      header: 'Mal kabul',
      render: (row) => (
        <Link to={`/satin-alma/mal-kabul/${row.id}`} className="block hover:underline">
          <span className="block font-mono font-semibold text-ink">{row.number}</span>
          <span className="block text-xs text-ink-muted">İrsaliye {row.waybillNumber}</span>
        </Link>
      ),
    },
    { key: 'on', header: 'Kabul', render: (row) => dayText(row.receivedOn) },
    { key: 'supplier', header: 'Tedarikçi', render: (row) => <span className="font-semibold text-ink">{row.supplier.name}</span> },
    {
      key: 'order',
      header: 'Sipariş',
      render: (row) => (
        <Link to={`/satin-alma/siparisler/${row.order.id}`} className="font-mono hover:underline">
          {row.order.number}
        </Link>
      ),
    },
    { key: 'warehouse', header: 'Depo', render: (row) => row.warehouse.name },
    { key: 'total', header: 'Tutar (KDV dahil)', className: 'text-right tabular-nums', render: (row) => formatMoney(row.grandTotal, row.currency) },
    {
      key: 'due',
      header: 'Vade',
      render: (row) => (
        <span className="flex items-center gap-1.5">
          {dayText(row.dueDate)}
          {row.closedShort && <Badge tone="neutral">eksik kapattı</Badge>}
        </span>
      ),
    },
  ];
  const filtered = search || warehouseId || from || to;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <Input label="Ara" name="receipt-search" placeholder="Mal kabul / irsaliye / sipariş no, tedarikçi" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-72" />
        <Select
          label="Depo"
          name="receipt-warehouse"
          options={[{ value: '', label: 'Bütün depolar' }, ...(warehouses.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]}
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
          className="w-full sm:w-48"
        />
        <Input label="Kabul (ilk)" name="receipt-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} error={invalidRange ? 'Bitiş başlangıçtan önce' : undefined} className="w-full sm:w-40" />
        <Input label="Kabul (son)" name="receipt-to" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-40" />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending && !invalidRange}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Eşleşen mal kabul yok' : 'Mal kabul yok'}
        emptyHint={filtered ? undefined : 'Mal kabul siparişin ekranından girilir; stok o anda depoya girer.'}
      />
    </div>
  );
}

/**
 * Mal kabul belgesi: satırlar (gelen, sipariş, toplam alınan, fiyat, tutar), vade ve depo.
 */
export function ReceiptPage() {
  const { receiptId } = useParams();
  usePurchasingLive();
  const query = useQuery({ queryKey: purchasingKeys.receipt(receiptId), queryFn: () => api(`/purchasing/receipts/${receiptId}`) });
  const back = (
    <Link to="/satin-alma/mal-kabul" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink">
      <Icon name="arrowLeft" className="size-4" /> Mal kabuller
    </Link>
  );
  if (query.isPending || query.isError) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <QueryFallback query={query} errorTitle="Mal kabul yüklenemedi" />
      </div>
    );
  }
  const receipt = query.data;
  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader
        title={`${receipt.number} · ${receipt.supplier.name}`}
        description={`İrsaliye ${receipt.waybillNumber} · kabul ${dayText(receipt.receivedOn)} · ${receipt.warehouse.name} · ${receipt.receivedBy} · ${formatDate(receipt.createdAt)}`}
        actions={
          <Link to={`/satin-alma/siparisler/${receipt.order.id}`} className="font-mono text-sm font-semibold text-ink hover:underline">
            Sipariş {receipt.order.number}
          </Link>
        }
      />
      {receipt.note && <p className="text-sm text-ink-soft">Not: {receipt.note}</p>}
      <Card title={`${receipt.lines.length} kalem`} description={`Tedarikçi borcu ${formatMoney(receipt.grandTotal, receipt.currency)}, vade ${dayText(receipt.dueDate)}.${receipt.closedShort ? ' Bu kabulle sipariş eksik kapatıldı.' : ''}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2 pr-2">Malzeme</th>
                <th className="py-2 pr-2 text-right">Gelen</th>
                <th className="py-2 pr-2 text-right">Sipariş</th>
                <th className="py-2 pr-2 text-right">Birim fiyat</th>
                <th className="py-2 pr-2 text-right">KDV hariç</th>
                <th className="py-2 pr-2 text-right">KDV</th>
                <th className="py-2 text-right">Toplam</th>
              </tr>
            </thead>
            <tbody>
              {receipt.lines.map((line) => (
                <tr key={line.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-2 font-semibold text-ink">{line.name}</td>
                  <td className="py-2 pr-2 text-right font-semibold tabular-nums">{quantityText(line.quantity, line.unit)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">{quantityText(line.ordered, line.unit)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatMoney(line.unitPrice, receipt.currency)}/{KITCHEN_UNIT_LABELS[line.unit]}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(line.netAmount, receipt.currency)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatMoney(line.taxAmount, receipt.currency)} <span className="text-xs text-ink-muted">%{line.taxRatePct}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(line.total, receipt.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-3 flex flex-wrap justify-end gap-6 text-sm">
          <div>
            <dt className="text-ink-muted">KDV hariç</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(receipt.netTotal, receipt.currency)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">KDV</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(receipt.taxTotal, receipt.currency)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Genel toplam</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatMoney(receipt.grandTotal, receipt.currency)}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
