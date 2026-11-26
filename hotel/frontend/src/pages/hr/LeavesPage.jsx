import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { HR_PAGE_SIZE, LEAVE_STATUSES, LEAVE_STATUS_LABELS, LEAVE_TYPES, LEAVE_TYPE_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { LEAVE_STATUS_TONES, daysText, hrKeys } from '../../lib/hr.js';
import { payrollKeys } from '../../lib/payroll.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { LeaveCancelDialog, LeaveDialog } from './LeaveDialog.jsx';

const withAll = (values, labels) => [{ value: '', label: 'Hepsi' }, ...values.map((value) => ({ value, label: labels[value] }))];
const STATUS_OPTIONS = withAll(LEAVE_STATUSES, LEAVE_STATUS_LABELS);
const TYPE_OPTIONS = withAll(LEAVE_TYPES, LEAVE_TYPE_LABELS);
/** Onay kuyruğunda izin türü süzgeci (bkz. approvals/approvalTheme.js `FILTER_PARAMS`). */
const APPROVAL_QUEUE_PATH = '/onaylar/bekleyen?tur=LEAVE';

/**
 * İzinler (modül 52): arama, dönem, durum, tür ve departman süzgeçli liste; personel kartından `?employeeId=` ile
 * tek personelin izinleri. "İzin gir" (`hr.manage`) personel adına talep açar; satırda "İptal et" ve bekleyen için
 * onay kuyruğu bağlantısı (karar kuyruktan verilir, isteyen onaylayamaz).
 */
export function LeavesPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.HR_MANAGE);
  const { today } = useHotelToday();
  const [params, setParams] = useSearchParams();
  const employeeId = params.get('employeeId') ?? '';
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  useEffect(() => setPage(1), [search, period.from, period.to, status, type, departmentId, employeeId]);

  const departments = useQuery({ queryKey: payrollKeys.departments, queryFn: () => api('/payroll/departments') });
  const filters = { search: search || undefined, from: period.from || undefined, to: period.to || undefined, status: status || undefined, type: type || undefined, departmentId: departmentId || undefined, employeeId: employeeId || undefined, page, pageSize: HR_PAGE_SIZE };
  const list = useQuery({ queryKey: hrKeys.leaves(filters), queryFn: () => api(withQuery('/hr/leaves', filters)), placeholderData: keepPreviousData });
  const pinnedEmployee = employeeId ? list.data?.items?.[0]?.employee : null;

  const columns = [
    {
      key: 'employee',
      header: 'Personel',
      render: (row) => (
        <Link to={`/personel/${row.employee.id}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.employee.name}</span>
          <span className="block text-xs text-ink-muted">
            {row.employee.code}
            {row.employee.department ? ` · ${row.employee.department.name}` : ''}
          </span>
        </Link>
      ),
    },
    { key: 'type', header: 'Tür', render: (row) => row.typeLabel },
    {
      key: 'range',
      header: 'Tarih',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block">
          <span className="block">
            {formatDate(row.startDate)} – {formatDate(row.endDate)}
          </span>
          {row.reason && <span className="block max-w-xs truncate text-xs text-ink-muted">{row.reason}</span>}
        </span>
      ),
    },
    { key: 'days', header: 'Gün', className: 'text-right tabular-nums', render: (row) => daysText(row.days) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={LEAVE_STATUS_TONES[row.status]}>{LEAVE_STATUS_LABELS[row.status]}</Badge> },
    {
      key: 'requested',
      header: 'İsteyen',
      render: (row) => (
        <span className="block text-xs text-ink-soft">
          <span className="block">{row.requestedBy ?? '—'}</span>
          <span className="block text-ink-muted">{formatDateTime(row.requestedAt)}</span>
        </span>
      ),
    },
    { key: 'decision', header: 'Karar', render: (row) => <DecisionCell row={row} /> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setDialog({ kind: 'create' })}>
              İzin gir
            </Button>
          )
        }
      >
        <Input label="Ara" name="leave-search" placeholder="Ad ya da sicil" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-48" />
        <Input label="Başlangıç" name="leave-from" type="date" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} className="w-full sm:w-40" />
        <Input label="Bitiş" name="leave-to" type="date" min={period.from || undefined} value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} className="w-full sm:w-40" />
        <Select label="Durum" name="leave-status" options={STATUS_OPTIONS} value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-40" />
        <Select label="Tür" name="leave-type-filter" options={TYPE_OPTIONS} value={type} onChange={(event) => setType(event.target.value)} className="w-full sm:w-48" />
        <Select label="Departman" name="leave-department" options={[{ value: '', label: 'Hepsi' }, ...(departments.data ?? []).map((row) => ({ value: row.id, label: row.name }))]} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="w-full sm:w-44" />
      </Toolbar>
      {employeeId && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          Yalnız <span className="font-semibold text-ink">{pinnedEmployee?.name ?? 'seçili personelin'}</span> izinleri gösteriliyor.
          <Button type="button" size="sm" variant="ghost" icon="close" onClick={() => setParams({})}>
            Süzgeci kaldır
          </Button>
        </p>
      )}
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle="İzin kaydı yok"
        emptyHint="Süzgeçleri genişletin ya da yeni izin girin."
        rowActions={(row) => (
          <span className="inline-flex flex-wrap justify-end gap-1">
            {row.status === 'PENDING' && (
              <Link to={row.approvalId ? `${APPROVAL_QUEUE_PATH}&onay=${row.approvalId}` : APPROVAL_QUEUE_PATH} className="inline-flex items-center gap-1.5 rounded-item px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.04] hover:text-ink">
                Onay kuyruğu
              </Link>
            )}
            {canManage && (row.status === 'PENDING' || row.status === 'APPROVED') && (
              <Button type="button" size="sm" variant="ghost" icon="close" onClick={() => setDialog({ kind: 'cancel', leave: row })}>
                İptal et
              </Button>
            )}
          </span>
        )}
      />
      {dialog?.kind === 'create' && <LeaveDialog today={today} employee={pinnedEmployee ?? null} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'cancel' && <LeaveCancelDialog leave={dialog.leave} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Karar / iptal hücresi: kim, ne zaman, notu. @param {{ row: any }} props */
function DecisionCell({ row }) {
  if (row.status === 'CANCELLED') {
    return (
      <span className="block text-xs text-ink-soft">
        <span className="block">{row.cancelledBy ?? '—'} · {formatDateTime(row.cancelledAt)}</span>
        {row.cancelReason && <span className="block max-w-xs truncate text-ink-muted">{row.cancelReason}</span>}
      </span>
    );
  }
  if (row.status === 'PENDING' || !row.decidedAt) return <span className="text-xs text-ink-muted">—</span>;
  return (
    <span className="block text-xs text-ink-soft">
      <span className="block">{row.decidedBy ?? '—'} · {formatDateTime(row.decidedAt)}</span>
      {row.decisionNote && <span className="block max-w-xs truncate text-ink-muted">{row.decisionNote}</span>}
    </span>
  );
}
