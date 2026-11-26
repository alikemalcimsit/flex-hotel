import { LEAVE_TYPE_LABELS, TIMESHEET_MANUAL_STATUSES, TIMESHEET_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Badge } from '@hotelos/ui';
import { minutesText } from '../../lib/hr.js';
import { cellMinutesOf } from '../../lib/hrWeek.js';

const STATUS_OPTIONS = TIMESHEET_MANUAL_STATUSES.map((value) => ({ value, label: TIMESHEET_STATUS_LABELS[value] }));
const SMALL_CONTROL = 'w-full rounded-item border bg-surface px-1.5 py-1 text-xs font-medium text-ink outline-none transition focus:border-ink disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted';

/**
 * Puantaj hücresi (modül 52): durum seçici (Geldi / Gelmedi / Hafta tatili / Resmî tatil); "Geldi"de giriş, çıkış
 * ve mola. İzinli hücre kilitli (izin kaydı belirler), çalışma dönemi dışı hücre boş, ileri tarih pasif. Taslak
 * değişiklik sarı kenarla, alan hatası kırmızı metinle gösterilir.
 *
 * @param {{
 *   cell: { status: string | null, outside?: boolean, clockIn?: string | null, clockOut?: string | null, breakMinutes?: number | string, leaveType?: string | null, saved?: boolean },
 *   dirty: boolean,
 *   disabled: boolean,
 *   future: boolean,
 *   dailyWorkMinutes: number,
 *   error?: string,
 *   onChange: (patch: object) => void,
 *   label: string,
 * }} props
 */
export function TimesheetCell({ cell, dirty, disabled, future, dailyWorkMinutes, error, onChange, label }) {
  if (cell.outside) return <span className="block text-center text-xs text-ink-muted/60">—</span>;
  if (cell.status === 'LEAVE') {
    return (
      <span className="flex flex-col items-center gap-1" title={cell.leaveType ? LEAVE_TYPE_LABELS[cell.leaveType] : 'İzinli'}>
        <Badge tone="info">İzinli</Badge>
        {cell.leaveType && <span className="max-w-[7rem] truncate text-[0.65rem] text-ink-muted">{LEAVE_TYPE_LABELS[cell.leaveType]}</span>}
      </span>
    );
  }
  const locked = disabled || future;
  const minutes = cellMinutesOf(cell, dailyWorkMinutes);
  const border = error ? 'border-sec-strong' : dirty ? 'border-warning-line ring-2 ring-warning-soft' : cell.saved ? 'border-line-strong' : 'border-line';
  return (
    <div className={`flex flex-col gap-1 rounded-item border p-1 ${border}`} title={future ? 'İleri tarihe puantaj girilmez' : undefined}>
      <select aria-label={`${label} durum`} className={`${SMALL_CONTROL} ${cell.status ? '' : 'text-ink-muted'}`} value={cell.status ?? ''} disabled={locked} onChange={(event) => onChange({ status: event.target.value || null })}>
        {!cell.status && <option value="">—</option>}
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {cell.status === 'PRESENT' && (
        <>
          <div className="grid grid-cols-2 gap-1">
            <input aria-label={`${label} giriş`} type="time" step={300} className={`${SMALL_CONTROL} px-1 tabular-nums`} value={cell.clockIn ?? ''} disabled={locked} onChange={(event) => onChange({ clockIn: event.target.value })} />
            <input aria-label={`${label} çıkış`} type="time" step={300} className={`${SMALL_CONTROL} px-1 tabular-nums`} value={cell.clockOut ?? ''} disabled={locked} onChange={(event) => onChange({ clockOut: event.target.value })} />
          </div>
          <div className="flex items-center gap-1">
            <input aria-label={`${label} mola (dakika)`} inputMode="numeric" className={`${SMALL_CONTROL} w-14 text-right tabular-nums`} value={cell.breakMinutes ?? 0} disabled={locked} onChange={(event) => onChange({ breakMinutes: event.target.value.replace(/\D/g, '') })} />
            <span className="text-[0.65rem] text-ink-muted">dk mola</span>
          </div>
          <span className="text-right text-[0.7rem] tabular-nums text-ink-soft">
            {minutesText(minutes.workedMinutes)}
            {minutes.overtimeMinutes > 0 && <span className="text-warning-ink"> +{minutesText(minutes.overtimeMinutes)}</span>}
          </span>
        </>
      )}
      {error && <span className="text-[0.65rem] font-bold text-sec-strong">{error}</span>}
    </div>
  );
}
