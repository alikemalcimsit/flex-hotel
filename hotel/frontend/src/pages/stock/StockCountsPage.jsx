import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { STOCK_COUNT_STATUSES, STOCK_COUNT_STATUS_LABELS, createStockCountSchema } from '@hotelos/hotel-contracts';
import { Badge, Button, Select, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { stockKeys, useWarehouses } from '../../lib/kitchen.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelContext } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 25;
export const STOCK_COUNT_STATUS_TONES = Object.freeze({ OPEN: 'info', APPROVED: 'success', CANCELLED: 'neutral' });
const STATUS_OPTIONS = [{ value: '', label: 'Hepsi' }, ...STOCK_COUNT_STATUSES.map((status) => ({ value: status, label: STOCK_COUNT_STATUS_LABELS[status] }))];

/**
 * Stok sayımları (modül 44): depo başına sayım; açılışta mevcutlar dondurulur, sayılan girilir, onayda fark
 * stoğa işler. Depoda aynı anda tek açık sayım. Açmak / saymak / onaylamak `stock.manage`.
 */
export function StockCountsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.STOCK_MANAGE);
  const navigate = useNavigate();
  const { data: hotel } = useHotelContext();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState(false);
  useEffect(() => setPage(1), [status]);
  const filters = { status: status || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: stockKeys.counts(filters), queryFn: () => api(withQuery('/stock/counts', filters)), placeholderData: keepPreviousData });

  const columns = [
    {
      key: 'number',
      header: 'Sayım',
      render: (row) => (
        <Link to={`/stok/sayim/${row.id}`} className="block hover:underline">
          <span className="block font-mono text-sm font-semibold text-ink">{row.number}</span>
          <span className="block text-xs text-ink-muted">{row.warehouse.name}</span>
        </Link>
      ),
    },
    {
      key: 'progress',
      header: 'Satır',
      className: 'text-right tabular-nums',
      render: (row) => (
        <span className="block">
          <span className="block">
            {row.counted} / {row.lines} sayıldı
          </span>
          <span className="block text-xs text-ink-muted">{row.differing} farklı</span>
        </span>
      ),
    },
    {
      key: 'result',
      header: 'Onay sonucu',
      className: 'text-right tabular-nums',
      render: (row) => (row.status === 'APPROVED' ? (
        <span className="block">
          <span className="block">{row.adjustedLines} düzeltme</span>
          <span className={`block text-xs ${Number(row.adjustedValue) < 0 ? 'text-sec-strong' : 'text-ink-muted'}`}>{formatMoney(row.adjustedValue, hotel?.currency)}</span>
        </span>
      ) : '—'),
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
          <span className="block text-ink-muted">{row.approvedAt ? formatDateTime(row.approvedAt) : row.cancelledAt ? formatDateTime(row.cancelledAt) : '—'}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={STOCK_COUNT_STATUS_TONES[row.status]}>{STOCK_COUNT_STATUS_LABELS[row.status]}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setOpening(true)}>
              Sayım aç
            </Button>
          )
        }
      >
        <Select label="Durum" name="stock-count-status" className="w-full sm:w-56" value={status} onChange={(event) => setStatus(event.target.value)} options={STATUS_OPTIONS} />
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
        emptyTitle={status ? 'Bu durumda sayım yok' : 'Henüz sayım yok'}
        emptyHint={canManage ? 'Sayım açın; deponun mevcutları beklenen olarak dondurulur, sayılanı girip onaylayınca fark stoğa işler.' : 'Sayım açıldığında burada görünür.'}
      />
      {opening && <OpenCountDialog onClose={() => setOpening(false)} onDone={(count) => navigate(`/stok/sayim/${count.id}`)} />}
    </div>
  );
}

/** @param {{ onClose: () => void, onDone: (count: any) => void }} props */
function OpenCountDialog({ onClose, onDone }) {
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const effective = warehouseId || (warehouses.data ?? []).find((row) => row.isDefault)?.id || '';
  const open = useMutation({
    mutationFn: (body) => apiPost('/stock/counts', body),
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: stockKeys.all });
      toastSuccess(`${count.number} açıldı: ${count.lines} malzeme sayılacak`);
      onDone(count);
    },
    onError: (failure) => {
      if (failure.fields) setErrors(failure.fields);
      toastError(failure.message);
    },
  });
  function submit(event) {
    event.preventDefault();
    const body = { warehouseId: effective || undefined, note: note.trim() || null };
    const checked = validateWith(createStockCountSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    open.mutate(body);
  }
  const busy = open.isPending;
  return (
    <Modal
      open
      size="sm"
      title="Sayım aç"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="open-count-form" icon="check" disabled={busy}>
            {busy ? 'Açılıyor…' : 'Aç'}
          </Button>
        </>
      }
    >
      <form id="open-count-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">Deponun mevcutları "beklenen" olarak dondurulur. Sayım sürerken giren mal listeyi kaydırmaz; onayda fark o anki mevcuda göre yazılır.</p>
        <Select label="Depo" name="count-warehouse" options={[{ value: '', label: 'Depo seçin' }, ...(warehouses.data ?? []).map((row) => ({ value: row.id, label: row.name }))]} value={effective} onChange={(event) => setWarehouseId(event.target.value)} error={errors.warehouseId} disabled={busy} />
        <Textarea label="Not" name="count-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} error={errors.note} disabled={busy} />
      </form>
    </Modal>
  );
}
