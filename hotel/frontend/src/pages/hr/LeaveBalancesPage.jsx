import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { HR_PAGE_SIZE } from '@hotelos/hotel-contracts';
import { Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { daysText, hrKeys } from '../../lib/hr.js';
import { payrollKeys } from '../../lib/payroll.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { BalanceDetailDialog, LeaveAdjustmentDialog } from './LeaveAdjustmentDialog.jsx';

/**
 * İzin bakiyeleri (modül 52): personel başına yıllık izin hakkı, düzeltme, kullanılan, bekleyen, kalan ve sonraki
 * hak günü; bakiye günü (`asOf`) seçilir. Satıra tıklayınca hak kayıtları ve düzeltmeler; "Düzeltme ekle" (`hr.manage`).
 */
export function LeaveBalancesPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.HR_MANAGE);
  const { today } = useHotelToday();
  const [asOf, setAsOf] = useState(today);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  useEffect(() => setPage(1), [search, departmentId, asOf]);

  const departments = useQuery({ queryKey: payrollKeys.departments, queryFn: () => api('/payroll/departments') });
  const filters = { asOf: asOf || undefined, search: search || undefined, departmentId: departmentId || undefined, page, pageSize: HR_PAGE_SIZE };
  const list = useQuery({ queryKey: hrKeys.balances(filters), queryFn: () => api(withQuery('/hr/leave-balances', filters)), placeholderData: keepPreviousData });
  const rows = (list.data?.items ?? []).map((item) => ({ ...item, id: item.employee.id }));

  const columns = [
    {
      key: 'employee',
      header: 'Personel',
      render: (row) => (
        <button type="button" className="block text-left hover:underline" onClick={() => setDialog({ kind: 'detail', employee: row.employee })}>
          <span className="block font-semibold text-ink">{row.employee.name}</span>
          <span className="block text-xs text-ink-muted">
            {row.employee.code} · işe giriş {formatDate(row.employee.hireDate)}
          </span>
        </button>
      ),
    },
    { key: 'department', header: 'Departman', render: (row) => row.employee.department?.name ?? '—' },
    { key: 'earned', header: 'Hak', className: 'text-right tabular-nums', render: (row) => daysText(row.earned) },
    { key: 'adjusted', header: 'Düzeltme', className: 'text-right tabular-nums', render: (row) => (Number(row.adjusted) > 0 ? `+${daysText(row.adjusted)}` : daysText(row.adjusted)) },
    { key: 'used', header: 'Kullanılan', className: 'text-right tabular-nums', render: (row) => daysText(row.used) },
    { key: 'pending', header: 'Bekleyen', className: 'text-right tabular-nums', render: (row) => (Number(row.pendingDays) > 0 ? <span className="text-warning-ink">{daysText(row.pendingDays)}</span> : '—') },
    { key: 'balance', header: 'Kalan', className: 'text-right tabular-nums', render: (row) => <span className={`font-bold ${Number(row.balance) < 0 ? 'text-sec-strong' : 'text-ink'}`}>{daysText(row.balance)}</span> },
    { key: 'next', header: 'Sonraki hak', className: 'whitespace-nowrap', render: (row) => (row.nextAccrualOn ? formatDate(row.nextAccrualOn) : '—') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Toolbar
        actions={
          canManage && (
            <Button type="button" icon="plus" onClick={() => setDialog({ kind: 'adjust', employee: null })}>
              Düzeltme ekle
            </Button>
          )
        }
      >
        <Input label="Bakiye günü" name="balance-as-of" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} className="w-full sm:w-40" />
        <Input label="Ara" name="balance-search" placeholder="Ad ya da sicil" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-52" />
        <Select label="Departman" name="balance-department" options={[{ value: '', label: 'Hepsi' }, ...(departments.data ?? []).map((row) => ({ value: row.id, label: row.name }))]} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="w-full sm:w-44" />
      </Toolbar>
      <p className="text-xs text-ink-muted">
        Hak 4857 sayılı Kanun md. 53'e göre iş yıl dönümünde doğar (1–5 yıl 14, 5–15 yıl 20, 15+ yıl 26 iş günü; 18 yaş altı / 50 yaş üstü en az 20). Kullanılan yalnız onaylı yıllık izindir; izin talepleri{' '}
        <Link to="/ik/izinler" className="font-semibold hover:underline">
          İzinler
        </Link>{' '}
        sayfasında.
      </p>
      <DataTable columns={columns} rows={rows} meta={list.data?.meta} isLoading={list.isPending} isFetching={list.isFetching} error={list.isError ? list.error : null} onRetry={() => list.refetch()} onPageChange={setPage} emptyTitle="Bu günde çalışan personel yok" />
      {dialog?.kind === 'adjust' && <LeaveAdjustmentDialog today={today} employee={dialog.employee} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'detail' && <BalanceDetailDialog employee={dialog.employee} asOf={asOf} onClose={() => setDialog(null)} onAdjust={canManage ? () => setDialog({ kind: 'adjust', employee: dialog.employee }) : undefined} />}
    </div>
  );
}
