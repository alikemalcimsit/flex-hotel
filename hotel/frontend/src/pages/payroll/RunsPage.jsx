import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYROLL_RUN_KIND_LABELS, PAYROLL_RUN_KINDS, PAYROLL_RUN_STATUS_LABELS, payrollRunCreateSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Select, Textarea } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { PAYROLL_RUN_STATUS_TONES, parsePeriod, payrollKeys, periodOptions } from '../../lib/payroll.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';

const PAGE_SIZE = 24;

/**
 * Bordrolar (modül 51): ay ay aylık ve fark bordroları, durum, toplamlar. "Bordro aç" ayın aylık bordrosunu (ya da
 * onaylı ayın fark bordrosunu) açar.
 */
export function RunsPage() {
  const can = useCan();
  const { today } = useHotelToday();
  const [year, setYear] = useState(today.slice(0, 4));
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState(false);
  useEffect(() => setPage(1), [year]);
  const filters = { year: year || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: payrollKeys.runs(filters), queryFn: () => api(withQuery('/payroll/runs', filters)), placeholderData: keepPreviousData });
  const thisYear = Number(today.slice(0, 4));

  const columns = [
    {
      key: 'number',
      header: 'Bordro',
      render: (row) => (
        <Link to={`/bordro/${row.id}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.period}</span>
          <span className="block text-xs text-ink-muted">
            {row.number} · {PAYROLL_RUN_KIND_LABELS[row.kind]}
          </span>
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={PAYROLL_RUN_STATUS_TONES[row.status]}>{PAYROLL_RUN_STATUS_LABELS[row.status]}</Badge>
          {row.stale && <span className="text-xs text-sec-strong">Yeniden hesaplanmalı</span>}
        </span>
      ),
    },
    { key: 'count', header: 'Personel', className: 'text-right tabular-nums', render: (row) => row.employeeCount || '—' },
    { key: 'gross', header: 'Brüt', className: 'text-right tabular-nums', render: (row) => formatMoney(row.totals.gross) },
    { key: 'payable', header: 'Ödenecek', className: 'text-right tabular-nums font-semibold', render: (row) => formatMoney(row.totals.payable) },
    { key: 'paid', header: 'Ödenen', className: 'text-right tabular-nums', render: (row) => (Number(row.totals.paid) > 0 ? formatMoney(row.totals.paid) : '—') },
    { key: 'cost', header: 'İşveren maliyeti', className: 'text-right tabular-nums', render: (row) => formatMoney(row.totals.cost) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          can(PERMISSIONS.PAYROLL_MANAGE) && (
            <Button type="button" icon="plus" onClick={() => setOpening(true)}>
              Bordro aç
            </Button>
          )
        }
      >
        <Select label="Yıl" options={[{ value: '', label: 'Hepsi' }, ...[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((value) => ({ value: String(value), label: String(value) }))]} value={year} onChange={(event) => setYear(event.target.value)} className="w-full sm:w-32" />
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
        emptyTitle="Bordro yok"
        emptyHint="Ayın bordrosunu açın; puantaj ve ek ödemeler hesaplamadan önce de girilebilir."
      />
      {opening && <OpenRunDialog today={today} onClose={() => setOpening(false)} />}
    </div>
  );
}

/** @param {{ today: string, onClose: () => void }} props */
function OpenRunDialog({ today, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const options = periodOptions(today);
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [kind, setKind] = useState('MONTHLY');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const open = useMutation({
    mutationFn: (body) => apiPost('/payroll/runs', body),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      navigate(`/bordro/${data.id}`);
    },
    onError: setError,
  });
  const submit = (event) => {
    event.preventDefault();
    const checked = validateWith(payrollRunCreateSchema, { ...parsePeriod(period), kind, note: note || null });
    if (!checked.ok) return setError({ message: Object.values(checked.errors)[0] });
    open.mutate(checked.data);
  };
  return (
    <Modal
      open
      title="Bordro aç"
      onClose={open.isPending ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={open.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="open-run-form" icon="check" disabled={open.isPending}>
            Aç
          </Button>
        </>
      }
    >
      <form id="open-run-form" noValidate onSubmit={submit} className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error.message}</Alert>}
        <Select label="Dönem" options={options.map((row) => ({ value: row.value, label: row.label }))} value={period} onChange={(event) => setPeriod(event.target.value)} />
        <Select label="Tür" options={PAYROLL_RUN_KINDS.map((value) => ({ value, label: PAYROLL_RUN_KIND_LABELS[value] }))} value={kind} onChange={(event) => setKind(event.target.value)} />
        {kind === 'SUPPLEMENTARY' && <p className="text-xs text-ink-muted">Fark bordrosu onaylı ayın düzeltmesidir: o aya sonradan eklenecek ödeme / kesinti bu bordroya girilir, ay baştan hesaplanır ve yalnız fark ödenir.</p>}
        <Textarea label="Not" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </form>
    </Modal>
  );
}
