import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EMPLOYEE_STATUSES, EMPLOYEE_STATUS_LABELS, PAY_BASIS_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { EMPLOYEE_STATUS_TONES, payrollKeys, usePayrollLive } from '../../lib/payroll.js';
import { useDebounced } from '../../lib/pos.js';
import { EmployeeFormDialog } from './EmployeeFormDialog.jsx';

const PAGE_SIZE = 25;

/**
 * Personel listesi (modül 51): ad, sicil ya da T.C. kimlik no ile arama; departman ve durum süzgeci. Ücret sütunu
 * yalnız `payroll.view` ile gelir (sunucu göndermez); kimlik numarası izne göre maskeli.
 */
export function EmployeesPage() {
  usePayrollLive();
  const can = useCan();
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [status, setStatus] = useState('ACTIVE');
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  useEffect(() => setPage(1), [search, status, departmentId]);

  const departments = useQuery({ queryKey: payrollKeys.departments, queryFn: () => api('/payroll/departments') });
  const filters = { search: search || undefined, status: status || undefined, departmentId: departmentId || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: payrollKeys.employees(filters), queryFn: () => api(withQuery('/payroll/employees', filters)), placeholderData: keepPreviousData });
  const withPay = can(PERMISSIONS.PAYROLL_VIEW);

  const columns = [
    {
      key: 'name',
      header: 'Personel',
      render: (row) => (
        <Link to={`/personel/${row.id}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted tabular-nums">
            {row.code} · {row.nationalId}
          </span>
        </Link>
      ),
    },
    {
      key: 'job',
      header: 'Departman / görev',
      render: (row) => (
        <span className="block">
          <span className="block text-ink">{row.department?.name}</span>
          <span className="block text-xs text-ink-muted">{row.position}</span>
        </span>
      ),
    },
    { key: 'hire', header: 'İşe giriş', className: 'whitespace-nowrap', render: (row) => formatDate(row.hireDate) },
    ...(withPay ? [{ key: 'salary', header: 'Aylık ücret', className: 'text-right tabular-nums', render: (row) => <span>{formatMoney(row.salary)} <span className="text-xs text-ink-muted">{PAY_BASIS_LABELS[row.payBasis]}</span></span> }] : []),
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={EMPLOYEE_STATUS_TONES[row.status]}>{EMPLOYEE_STATUS_LABELS[row.status]}</Badge>
          {row.terminationDate && <span className="text-xs text-ink-muted">Çıkış {formatDate(row.terminationDate)}</span>}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Personel" description="Personel kartları: kimlik, departman, görev, sigorta türü; ücret ve bordro bilgisi yetkiye göre görünür." />
      <Toolbar
        actions={
          can(PERMISSIONS.EMPLOYEES_MANAGE) && (
            <Button type="button" icon="plus" onClick={() => setAdding(true)}>
              Personel ekle
            </Button>
          )
        }
      >
        <Input label="Ara" name="employee-search" placeholder="Ad, sicil ya da kimlik no" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-60" />
        <Select label="Durum" options={[{ value: '', label: 'Hepsi' }, ...EMPLOYEE_STATUSES.map((value) => ({ value, label: EMPLOYEE_STATUS_LABELS[value] }))]} value={status} onChange={(event) => setStatus(event.target.value)} className="w-full sm:w-36" />
        <Select label="Departman" options={[{ value: '', label: 'Hepsi' }, ...(departments.data ?? []).map((row) => ({ value: row.id, label: row.name }))]} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="w-full sm:w-44" />
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
        emptyTitle={search || departmentId ? 'Eşleşen personel yok' : status === 'TERMINATED' ? 'Ayrılan personel yok' : 'Henüz personel yok'}
        emptyHint={can(PERMISSIONS.EMPLOYEES_MANAGE) && !search ? '"Personel ekle" ile ilk kartı açın; sicil numarası kendiliğinden verilir.' : undefined}
      />
      {adding && <EmployeeFormDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
