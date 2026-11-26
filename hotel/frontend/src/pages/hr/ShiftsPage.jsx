import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LEAVE_TYPE_LABELS, weekStartOf } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Icon, Select, Spinner } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { hrKeys, minutesText } from '../../lib/hr.js';
import { cellKey, dayHeader, groupByDepartment, groupShiftsByCell, leaveCellsOf, moveWeek, problemSetsOf, shiftLabel, weekDaysOf, weekEndOf, weeklyMinutesOf } from '../../lib/hrWeek.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ShiftDialog } from './ShiftDialog.jsx';

const CHIP_BASE = 'inline-flex w-full items-center justify-center rounded-item border px-1.5 py-1 text-xs font-semibold tabular-nums transition-colors';
const CHIP_TONES = Object.freeze({
  normal: 'border-line bg-surface text-ink hover:border-ink',
  conflict: 'border-sec-strong bg-danger-soft text-sec-strong',
  warning: 'border-warning-line bg-warning-soft text-warning-ink',
});

/**
 * Vardiya çizelgesi (modül 52): hafta seçici (pazartesi başlangıçlı), departman süzgeci; satır personel (departmana
 * göre gruplu), sütun gün (hafta tatili ve resmî tatil işaretli). Hücrede vardiya çipleri (tıkla → düzenle / sil),
 * boş hücreye "+" (`hr.manage`), onaylı izin "İzinli". Çakışma kırmızı; kısa dinlenme ve haftalık aşım sarı uyarı.
 * "Geçen haftayı kopyala" önceki haftanın çizelgesini bu haftaya taşır (çakışan atlanır).
 */
export function ShiftsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.HR_MANAGE);
  const { today } = useHotelToday();
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const [departmentId, setDepartmentId] = useState('');
  const [dialog, setDialog] = useState(null);
  const days = useMemo(() => weekDaysOf(weekStart), [weekStart]);
  const filters = { from: weekStart, to: weekEndOf(weekStart), departmentId: departmentId || undefined };
  const grid = useQuery({ queryKey: hrKeys.shifts(filters), queryFn: () => api(withQuery('/hr/shifts', filters)), placeholderData: keepPreviousData });
  const data = grid.data;

  const copyWeek = useMutation({
    mutationFn: () => apiPost('/hr/shifts/copy-week', { fromWeekStart: moveWeek(weekStart, -1), toWeekStart: weekStart, ...(departmentId ? { departmentId } : {}) }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: hrKeys.all });
      toastSuccess(`${result.copied} vardiya kopyalandı${result.skipped ? `, ${result.skipped} çakışan atlandı` : ''}`);
      setDialog(null);
    },
    onError: (error) => toastError(error.message),
  });

  const view = useMemo(() => {
    if (!data) return null;
    const problems = problemSetsOf(data.problems);
    return {
      groups: groupByDepartment(data.employees, departmentId ? data.departments.filter((row) => row.id === departmentId) : data.departments),
      cells: groupShiftsByCell(data.shifts),
      leaves: leaveCellsOf(data.leaves, days),
      totals: weeklyMinutesOf(data.shifts),
      problems,
      summary: { conflicts: problems.conflicts.size / 2, shortRests: problems.shortRests.size / 2, overloaded: problems.overloaded.size },
    };
  }, [data, days, departmentId]);
  const dayMeta = new Map((data?.days ?? []).map((day) => [day.date, day]));
  const chipTone = (shift) => (view.problems.conflicts.has(shift.id) ? 'conflict' : view.problems.shortRests.has(shift.id) ? 'warning' : 'normal');

  return (
    <div className="flex flex-col gap-6">
      <Toolbar
        actions={
          canManage && (
            <Button type="button" variant="outline" icon="rotateCcw" onClick={() => setDialog({ kind: 'copy' })} disabled={copyWeek.isPending}>
              Geçen haftayı kopyala
            </Button>
          )
        }
      >
        <WeekPicker weekStart={weekStart} today={today} onChange={setWeekStart} />
        <Select label="Departman" name="shift-department-filter" options={[{ value: '', label: 'Hepsi' }, ...(data?.departments ?? []).map((row) => ({ value: row.id, label: row.name }))]} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="w-full sm:w-44" />
      </Toolbar>
      {grid.isError && (
        <Alert tone="danger" title="Çizelge yüklenemedi" action={<Button variant="outline" size="sm" icon="refresh" onClick={() => grid.refetch()}>Tekrar dene</Button>}>
          {grid.error.message}
        </Alert>
      )}
      {view && (view.summary.conflicts > 0 || view.summary.shortRests > 0 || view.summary.overloaded > 0) && (
        <Alert tone={view.summary.conflicts > 0 ? 'danger' : 'warning'} title="Çizelgede uyarı var">
          {[view.summary.conflicts > 0 && `${view.summary.conflicts} çakışan vardiya çifti`, view.summary.shortRests > 0 && `${view.summary.shortRests} kısa dinlenme (11 saatten az)`, view.summary.overloaded > 0 && `${view.summary.overloaded} personelde haftalık norm aşımı (${minutesText(data.settings.weeklyWorkMinutes)} üstü)`].filter(Boolean).join(' · ')}
        </Alert>
      )}
      <div className={`overflow-hidden rounded-card bg-surface shadow-card ${grid.isFetching && !grid.isPending ? 'opacity-60' : ''}`}>
        <div className="overflow-x-auto">
          {grid.isPending && <Spinner className="py-14" />}
          {view && view.groups.length === 0 && <p className="px-6 py-10 text-center text-sm text-ink-muted">Bu haftada çalışan personel yok.</p>}
          {view && view.groups.length > 0 && (
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="border-b border-line bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-surface-muted px-4 py-3 font-bold">Personel</th>
                  {days.map((date) => (
                    <DayHeader key={date} date={date} meta={dayMeta.get(date)} today={today} />
                  ))}
                  <th scope="col" className="px-3 py-3 text-right font-bold">Hafta</th>
                </tr>
              </thead>
              <tbody>
                {view.groups.map((group) => (
                  <GroupRows key={group.id || 'none'} group={group} days={days} view={view} canManage={canManage} chipTone={chipTone} onOpen={(employee, date, shift) => setDialog({ kind: 'shift', employee, date, shift })} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p className="text-xs text-ink-muted">Çipe tıklayınca vardiya düzenlenir ya da silinir; kırmızı çip aynı personelde çakışan vardiya, sarı çip 11 saatten az dinlenme. Satır sonunda haftanın çalışma süresi (mola düşülmüş), normu aşan sarı.</p>
      {dialog?.kind === 'shift' && <ShiftDialog employee={dialog.employee} date={dialog.date} shift={dialog.shift} departments={data?.departments ?? []} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog?.kind === 'copy'}
        title="Geçen haftayı kopyala"
        message={`${formatDate(moveWeek(weekStart, -1))} haftasının vardiyaları${departmentId ? ' (seçili departman)' : ''} ${formatDate(weekStart)} haftasına aynı gün sırasıyla kopyalanır. Bu haftadaki mevcut vardiyalar korunur; çakışanlar atlanır.`}
        confirmLabel="Kopyala"
        confirmVariant="primary"
        confirmIcon="rotateCcw"
        isPending={copyWeek.isPending}
        onConfirm={() => copyWeek.mutate()}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

/** Hafta gezinmesi: önceki / sonraki, bu hafta. @param {{ weekStart: string, today: string, onChange: (weekStart: string) => void }} props */
export function WeekPicker({ weekStart, today, onChange }) {
  const current = weekStartOf(today);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.85rem] font-bold text-ink">Hafta</span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="sm" icon="chevronLeft" aria-label="Önceki hafta" onClick={() => onChange(moveWeek(weekStart, -1))} />
        <span className="min-w-[13rem] text-center text-sm font-semibold tabular-nums text-ink">
          {formatDate(weekStart)} – {formatDate(weekEndOf(weekStart))}
        </span>
        <Button type="button" variant="outline" size="sm" icon="chevronRight" aria-label="Sonraki hafta" onClick={() => onChange(moveWeek(weekStart, 1))} />
        {weekStart !== current && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(current)}>
            Bu hafta
          </Button>
        )}
      </div>
    </div>
  );
}

/** Gün başlığı: kısa gün adı, tarih; tatil adı ya da hafta tatili işareti. @param {{ date: string, meta?: { holiday: string | null, rest: boolean }, today: string }} props */
export function DayHeader({ date, meta, today }) {
  const { weekday, dayText } = dayHeader(date);
  const off = Boolean(meta?.holiday) || Boolean(meta?.rest);
  return (
    <th scope="col" className={`px-2 py-3 text-center font-bold ${off ? 'bg-black/[0.03]' : ''} ${date === today ? 'text-ink' : ''}`} title={meta?.holiday ?? (meta?.rest ? 'Hafta tatili' : undefined)}>
      <span className="block">{weekday}</span>
      <span className={`block text-xs font-semibold normal-case tracking-normal ${date === today ? 'text-ink' : 'text-ink-muted'}`}>{dayText}</span>
      {meta?.holiday && <span className="block max-w-[6rem] truncate text-[0.65rem] font-semibold normal-case tracking-normal text-violet-700">{meta.holiday}</span>}
      {!meta?.holiday && meta?.rest && <span className="block text-[0.65rem] font-semibold normal-case tracking-normal text-ink-muted">Hafta tatili</span>}
    </th>
  );
}

/** Bir departmanın satırları (başlık satırı + personel satırları). */
function GroupRows({ group, days, view, canManage, chipTone, onOpen }) {
  return (
    <>
      <tr className="border-t border-line bg-surface-muted/60">
        <th scope="colgroup" colSpan={days.length + 2} className="sticky left-0 px-4 py-2 text-left text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
          {group.name} · {group.employees.length}
        </th>
      </tr>
      {group.employees.map((employee) => {
        const total = view.totals.get(employee.id) ?? 0;
        const overloaded = view.problems.overloaded.has(employee.id);
        return (
          <tr key={employee.id} className="border-t border-line">
            <th scope="row" className="sticky left-0 z-10 min-w-[11rem] bg-surface px-4 py-2 text-left align-top">
              <span className="block font-semibold text-ink">{employee.name}</span>
              <span className="block text-xs font-normal text-ink-muted">{employee.position}</span>
            </th>
            {days.map((date) => {
              const key = cellKey(employee.id, date);
              const shifts = view.cells.get(key) ?? [];
              const leaveType = view.leaves.get(key);
              return (
                <td key={date} className="min-w-[6.5rem] px-1.5 py-2 align-top">
                  <div className="flex flex-col gap-1">
                    {leaveType && (
                      <span className="inline-flex w-full justify-center rounded-item bg-black/[0.05] px-1.5 py-1 text-xs font-semibold text-ink-muted" title={LEAVE_TYPE_LABELS[leaveType]}>
                        İzinli
                      </span>
                    )}
                    {shifts.map((shift) => (
                      <button key={shift.id} type="button" disabled={!canManage} className={`${CHIP_BASE} ${CHIP_TONES[chipTone(shift)]} disabled:cursor-default`} title={`${shiftLabel(shift)} · ${minutesText(shift.minutes)}${shift.note ? ` · ${shift.note}` : ''}`} onClick={() => onOpen(employee, date, shift)}>
                        {shiftLabel(shift)}
                      </button>
                    ))}
                    {canManage && (
                      <button type="button" aria-label={`${employee.name}, ${formatDate(date)}: vardiya ekle`} className="inline-flex w-full items-center justify-center rounded-item border border-dashed border-line px-1.5 py-1 text-ink-muted transition-colors hover:border-ink hover:text-ink" onClick={() => onOpen(employee, date, null)}>
                        <Icon name="plus" className="size-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              );
            })}
            <td className="px-3 py-2 text-right align-top tabular-nums">{overloaded ? <Badge tone="warning">{minutesText(total)}</Badge> : <span className="text-sm font-semibold text-ink">{total ? minutesText(total) : '—'}</span>}</td>
          </tr>
        );
      })}
    </>
  );
}
