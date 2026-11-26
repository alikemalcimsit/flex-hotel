import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { timesheetInputSchema, weekStartOf } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select, Spinner } from '@hotelos/ui';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPut, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { hrKeys, minutesText } from '../../lib/hr.js';
import { cellKey, rowSummaryOf, timesheetRowOf, weekDaysOf, weekEndOf } from '../../lib/hrWeek.js';
import { payrollKeys } from '../../lib/payroll.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { PayrollExportDialog } from './PayrollExportDialog.jsx';
import { DayHeader, WeekPicker } from './ShiftsPage.jsx';
import { TimesheetCell } from './TimesheetCell.jsx';

/** Sayfada personel sayısı: 7 gün × hücre girişleri ağır; küçük sayfa. */
const PAGE_SIZE = 25;
const ERROR_TITLES = Object.freeze({ PAYROLL_MONTH_LOCKED: 'Bordro ayı kilitli', TIMESHEET_ON_LEAVE: 'İzinli gün' });

/**
 * Günlük puantaj (modül 52): hafta seçici, departman ve arama; personel × gün ızgarası. Hücrede durum (Geldi /
 * Gelmedi / Hafta tatili / Resmî tatil), "Geldi"de giriş, çıkış ve mola; izinli hücre kilitli, dönem dışı boş.
 * Değişen hücreler yerelde birikir, tek "Kaydet" (`PUT /hr/timesheets`); kilitli bordro ayı ve izinli gün hatası
 * uyarıda. Satır sonunda haftanın çalışma ve mesai süresi. "Bordroya aktar" ayın özetini 51'in puantajına yazar.
 */
export function TimesheetsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.HR_MANAGE);
  const { today } = useHotelToday();
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const [departmentId, setDepartmentId] = useState('');
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    setPage(1);
    setDraft({});
    setErrors({});
    setServerError(null);
  }, [weekStart, departmentId, search]);

  const days = useMemo(() => weekDaysOf(weekStart), [weekStart]);
  const departments = useQuery({ queryKey: payrollKeys.departments, queryFn: () => api('/payroll/departments') });
  const filters = { from: weekStart, to: weekEndOf(weekStart), departmentId: departmentId || undefined, search: search || undefined, page, pageSize: PAGE_SIZE };
  const grid = useQuery({ queryKey: hrKeys.timesheets(filters), queryFn: () => api(withQuery('/hr/timesheets', filters)), placeholderData: keepPreviousData });
  const data = grid.data;
  const dailyWorkMinutes = data?.settings.dailyWorkMinutes ?? 450;
  const dayMeta = new Map((data?.days ?? []).map((day) => [day.date, day]));
  const changedKeys = Object.keys(draft);

  const save = useMutation({
    mutationFn: (rows) => apiPut('/hr/timesheets', { rows }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: hrKeys.all });
      setDraft({});
      setErrors({});
      setServerError(null);
      toastSuccess(`${result.saved} gün kaydedildi`);
    },
    onError: setServerError,
  });

  /** Hücre değişikliği: ilk dokunuşta sunucu hücresi taslağa kopyalanır; durum boşa dönerse taslak silinir. */
  const edit = (employeeId, date, base, patch) =>
    setDraft((current) => {
      const key = cellKey(employeeId, date);
      const next = { status: base.status, clockIn: base.clockIn ?? '', clockOut: base.clockOut ?? '', breakMinutes: base.breakMinutes ?? 0, note: base.note ?? '', ...current[key], ...patch };
      if (next.status === null) {
        const { [key]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: next };
    });

  const submit = () => {
    const rows = [];
    const cellErrors = {};
    for (const key of changedKeys) {
      const [employeeId, date] = key.split('|');
      const checked = validateWith(timesheetInputSchema, timesheetRowOf(employeeId, date, draft[key]));
      if (checked.ok) rows.push(checked.data);
      else cellErrors[key] = Object.values(checked.errors)[0];
    }
    setErrors(cellErrors);
    if (Object.keys(cellErrors).length === 0 && rows.length) save.mutate(rows);
  };

  return (
    <div className="flex flex-col gap-6">
      <Toolbar
        actions={
          canManage && (
            <>
              <Button type="button" variant="outline" icon="upload" onClick={() => setExporting(true)}>
                Bordroya aktar
              </Button>
              <Button type="button" icon="check" disabled={!changedKeys.length || save.isPending} onClick={submit}>
                {save.isPending ? 'Kaydediliyor…' : changedKeys.length ? `${changedKeys.length} günü kaydet` : 'Kaydet'}
              </Button>
            </>
          )
        }
      >
        <WeekPicker weekStart={weekStart} today={today} onChange={setWeekStart} />
        <Select label="Departman" name="timesheet-department" options={[{ value: '', label: 'Hepsi' }, ...(departments.data ?? []).map((row) => ({ value: row.id, label: row.name }))]} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="w-full sm:w-44" />
        <Input label="Ara" name="timesheet-search" placeholder="Ad ya da sicil" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-48" />
      </Toolbar>
      {serverError && (
        <Alert tone="danger" title={ERROR_TITLES[serverError.code] ?? 'Kaydedilmedi'}>
          {serverError.message}
          {serverError.code === 'TIMESHEET_ON_LEAVE' && (
            <>
              {' '}
              <Link to="/ik/izinler" className="font-semibold hover:underline">
                İzinler →
              </Link>
            </>
          )}
        </Alert>
      )}
      {changedKeys.length > 0 && <p className="text-xs text-ink-muted">Kaydedilmemiş değişiklik var; hafta ya da süzgeç değişirse kaybolur.</p>}
      {grid.isError && (
        <Alert tone="danger" title="Puantaj yüklenemedi" action={<Button variant="outline" size="sm" icon="refresh" onClick={() => grid.refetch()}>Tekrar dene</Button>}>
          {grid.error.message}
        </Alert>
      )}
      <div className={`overflow-hidden rounded-card bg-surface shadow-card ${grid.isFetching && !grid.isPending ? 'opacity-60' : ''}`}>
        <div className="overflow-x-auto">
          {grid.isPending && <Spinner className="py-14" />}
          {data && data.items.length === 0 && <p className="px-6 py-10 text-center text-sm text-ink-muted">Bu haftada çalışan personel yok.</p>}
          {data && data.items.length > 0 && (
            <table className="w-full min-w-[72rem] text-sm">
              <thead className="border-b border-line bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-surface-muted px-4 py-3 font-bold">Personel</th>
                  {days.map((date) => (
                    <DayHeader key={date} date={date} meta={dayMeta.get(date)} today={today} />
                  ))}
                  <th scope="col" className="px-3 py-3 text-right font-bold">Hafta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((row) => {
                  const drafts = Object.fromEntries(days.filter((date) => draft[cellKey(row.employee.id, date)]).map((date) => [date, draft[cellKey(row.employee.id, date)]]));
                  const summary = rowSummaryOf(row.cells, drafts, dailyWorkMinutes);
                  return (
                    <tr key={row.employee.id}>
                      <th scope="row" className="sticky left-0 z-10 min-w-[11rem] bg-surface px-4 py-2 text-left align-top">
                        <Link to={`/personel/${row.employee.id}`} className="block hover:underline">
                          <span className="block font-semibold text-ink">{row.employee.name}</span>
                          <span className="block text-xs font-normal text-ink-muted">
                            {row.employee.code}
                            {row.employee.department ? ` · ${row.employee.department.name}` : ''}
                          </span>
                        </Link>
                      </th>
                      {days.map((date) => {
                        const key = cellKey(row.employee.id, date);
                        const base = row.cells[date] ?? { status: null, outside: true };
                        const cell = draft[key] ? { ...base, ...draft[key] } : base;
                        return (
                          <td key={date} className="min-w-[8.5rem] px-1.5 py-2 align-top">
                            <TimesheetCell cell={cell} dirty={Boolean(draft[key])} disabled={!canManage || save.isPending} future={date > today} dailyWorkMinutes={dailyWorkMinutes} error={errors[key]} label={`${row.employee.name} ${formatDate(date)}`} onChange={(patch) => edit(row.employee.id, date, base, patch)} />
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right align-top text-xs tabular-nums">
                        <span className="block font-semibold text-ink">{minutesText(summary.worked)}</span>
                        {summary.overtime > 0 && <span className="block text-warning-ink">+{minutesText(summary.overtime)} mesai</span>}
                        <span className="block text-ink-muted">
                          {summary.present} geldi{summary.absent ? ` · ${summary.absent} gelmedi` : ''}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {data?.meta && data.meta.totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5 text-xs">
            <span className="font-semibold text-ink-muted">
              Toplam <span className="text-ink">{data.meta.total}</span> personel
            </span>
            <span className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" icon="chevronLeft" aria-label="Önceki sayfa" disabled={page <= 1 || changedKeys.length > 0} onClick={() => setPage(page - 1)} />
              <span className="font-semibold tabular-nums text-ink-soft">
                {data.meta.page} / {data.meta.totalPages}
              </span>
              <Button type="button" size="sm" variant="outline" icon="chevronRight" aria-label="Sonraki sayfa" disabled={page >= data.meta.totalPages || changedKeys.length > 0} onClick={() => setPage(page + 1)} />
            </span>
          </div>
        )}
      </div>
      <p className="text-xs text-ink-muted">Günlük norm {minutesText(dailyWorkMinutes)}; üstü mesai. Hafta tatili ve resmî tatil kayıt yoksa varsayılan görünür, o gün "Geldi" seçilirse bayram / hafta tatili çalışması sayılır. İzinli günü izin kaydı belirler.</p>
      {exporting && <PayrollExportDialog today={today} departments={departments.data ?? []} onClose={() => setExporting(false)} />}
    </div>
  );
}
