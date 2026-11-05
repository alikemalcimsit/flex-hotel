import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MISSING_DAY_REASON_CODES, MISSING_DAY_REASONS, attendanceSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPut, withQuery } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { parsePeriod, payrollKeys, periodOptions } from '../../lib/payroll.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { ItemsPanel } from './ItemsPanel.jsx';

const PAGE_SIZE = 50;
const FIELDS = Object.freeze(['missingDays', 'missingReason', 'workedDays', 'overtimeHours', 'holidayDays', 'weeklyRestDays']);

/**
 * Aylık puantaj (modül 51): personel başına eksik gün (SGK nedeniyle), fiilen çalışılan gün (yemek / yol istisnası),
 * fazla çalışma saati, bayram ve hafta tatili çalışması. Değişen satırlar birlikte kaydedilir; ay onaydaysa /
 * onaylıysa sunucu reddeder. Altında ayın ek ödeme / kesinti kalemleri.
 */
export function AttendancePage() {
  const can = useCan();
  const { today } = useHotelToday();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(today.slice(0, 7));
  const { year, month } = parsePeriod(period);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  useEffect(() => {
    setPage(1);
    setDraft({});
    setErrors({});
  }, [period, search, departmentId]);
  const departments = useQuery({ queryKey: payrollKeys.departments, queryFn: () => api('/payroll/departments') });
  const filters = { year, month, search: search || undefined, departmentId: departmentId || undefined, page, pageSize: PAGE_SIZE };
  const grid = useQuery({ queryKey: payrollKeys.attendance(filters), queryFn: () => api(withQuery('/payroll/attendance', filters)), placeholderData: keepPreviousData });
  const canEdit = can(PERMISSIONS.PAYROLL_MANAGE);
  const changed = useMemo(() => Object.keys(draft), [draft]);

  const save = useMutation({
    mutationFn: (rows) => apiPut(withQuery('/payroll/attendance', { year, month }), { rows }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      setDraft({});
      setServerError(null);
      toastSuccess(`${data.saved} satır kaydedildi`);
    },
    onError: setServerError,
  });

  const valueOf = (row, field) => (draft[row.employeeId]?.[field] ?? (row[field] === null ? '' : String(row[field])));
  const edit = (row, field, value) =>
    setDraft((current) => {
      const next = { ...current, [row.employeeId]: { ...Object.fromEntries(FIELDS.map((key) => [key, row[key] === null ? '' : String(row[key])])), ...current[row.employeeId], [field]: value } };
      if (field === 'missingDays' && Number(value) === 0) next[row.employeeId].missingReason = '';
      return next;
    });

  const submit = () => {
    const rows = [];
    const rowErrors = {};
    for (const employeeId of changed) {
      const values = draft[employeeId];
      const body = { employeeId, missingDays: values.missingDays || '0', missingReason: values.missingReason || null, workedDays: values.workedDays === '' ? null : values.workedDays, overtimeHours: values.overtimeHours || '0', holidayDays: values.holidayDays || '0', weeklyRestDays: values.weeklyRestDays || '0' };
      const checked = validateWith(attendanceSchema, body);
      if (checked.ok) rows.push(checked.data);
      else rowErrors[employeeId] = Object.values(checked.errors)[0];
    }
    setErrors(rowErrors);
    if (Object.keys(rowErrors).length === 0 && rows.length) save.mutate(rows);
  };

  const cell = (row, field, props = {}) => <Input aria-label={field} value={valueOf(row, field)} disabled={!canEdit || save.isPending} onChange={(event) => edit(row, field, event.target.value)} className="w-20" inputMode="decimal" {...props} />;
  const columns = [
    {
      key: 'name',
      header: 'Personel',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">
            {row.code} · {row.department} · {row.employmentDays} ücretli gün
          </span>
          {errors[row.employeeId] && <span className="block text-xs text-sec-strong">{errors[row.employeeId]}</span>}
        </span>
      ),
    },
    { key: 'missing', header: 'Eksik gün', render: (row) => cell(row, 'missingDays', { inputMode: 'numeric' }) },
    {
      key: 'reason',
      header: 'Neden',
      render: (row) => (
        <Select compact aria-label="Eksik gün nedeni" disabled={!canEdit || save.isPending || Number(valueOf(row, 'missingDays') || 0) === 0} options={[{ value: '', label: '—' }, ...MISSING_DAY_REASON_CODES.map((code) => ({ value: code, label: `${code} ${MISSING_DAY_REASONS[code]}` }))]} value={valueOf(row, 'missingReason')} onChange={(event) => edit(row, 'missingReason', event.target.value)} className="w-48" />
      ),
    },
    { key: 'worked', header: 'Çalışılan gün', render: (row) => cell(row, 'workedDays', { inputMode: 'numeric', placeholder: String(row.employmentDays - Number(valueOf(row, 'missingDays') || 0)) }) },
    { key: 'overtime', header: 'Fazla mesai (saat)', render: (row) => cell(row, 'overtimeHours') },
    { key: 'holiday', header: 'Bayram (gün)', render: (row) => cell(row, 'holidayDays') },
    { key: 'weekly', header: 'Hafta tatili (gün)', render: (row) => cell(row, 'weeklyRestDays') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Toolbar
        actions={
          canEdit && (
            <Button type="button" icon="check" disabled={!changed.length || save.isPending} onClick={submit}>
              {save.isPending ? 'Kaydediliyor…' : changed.length ? `${changed.length} satırı kaydet` : 'Kaydet'}
            </Button>
          )
        }
      >
        <Select label="Dönem" options={periodOptions(today).map((row) => ({ value: row.value, label: row.label }))} value={period} onChange={(event) => setPeriod(event.target.value)} className="w-full sm:w-40" />
        <Input label="Ara" name="attendance-search" placeholder="Ad ya da sicil" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-52" />
        <Select label="Departman" options={[{ value: '', label: 'Hepsi' }, ...(departments.data ?? []).map((row) => ({ value: row.id, label: row.name }))]} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="w-full sm:w-44" />
      </Toolbar>
      {serverError && (
        <Alert tone="danger" title="Kaydedilmedi">
          {serverError.message}
        </Alert>
      )}
      {changed.length > 0 && <p className="text-xs text-ink-muted">Kaydedilmemiş değişiklik var; sayfa ya da dönem değişirse kaybolur.</p>}
      <DataTable columns={columns} rows={grid.data?.items} meta={grid.data?.meta} isLoading={grid.isPending} isFetching={grid.isFetching} error={grid.isError ? grid.error : null} onRetry={() => grid.refetch()} onPageChange={(next) => (changed.length ? null : setPage(next))} emptyTitle="Bu dönemde çalışan personel yok" />
      <ItemsPanel year={year} month={month} />
    </div>
  );
}
