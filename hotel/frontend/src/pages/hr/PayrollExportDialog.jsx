import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MISSING_DAY_REASONS } from '@hotelos/hotel-contracts';
import { Alert, Button, Select } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost } from '../../lib/api.js';
import { hrKeys } from '../../lib/hr.js';
import { parsePeriod, payrollKeys, periodOptions } from '../../lib/payroll.js';
import { toastSuccess } from '../../store/toast.js';

/** Sonuç tablosunda gösterilen ilk satır sayısı. */
const PREVIEW_ROWS = 15;

/**
 * Bordroya aktar (modül 52, `hr.manage`): ayın günlük puantajı ve onaylı izinleri 51'in aylık puantajına yazılır
 * (`PayrollAttendance`, kaynak TIMESHEET): eksik gün ve nedeni, çalışılan gün, fazla çalışma saati, bayram ve hafta
 * tatili çalışması. Onaylı / onaydaki ay reddedilir (`PAYROLL_MONTH_LOCKED`); hesaplanmış bordro bayatlar.
 * @param {{ today: string, departments: Array<{ id: string, name: string }>, onClose: () => void }} props
 */
export function PayrollExportDialog({ today, departments, onClose }) {
  const queryClient = useQueryClient();
  const options = periodOptions(today);
  const [period, setPeriod] = useState(options[1]?.value ?? options[0].value);
  const [departmentId, setDepartmentId] = useState('');
  const run = useMutation({
    mutationFn: () => apiPost('/hr/timesheets/export-payroll', { ...parsePeriod(period), departmentId: departmentId || null }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: hrKeys.all });
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess(`${result.exported} personelin puantajı bordroya yazıldı`);
    },
  });
  const result = run.data;
  const busy = run.isPending;
  return (
    <Modal
      open
      size="lg"
      title="Puantajı bordroya aktar"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {result ? 'Kapat' : 'Vazgeç'}
          </Button>
          <Button type="button" icon="upload" onClick={() => run.mutate()} disabled={busy}>
            {busy ? 'Aktarılıyor…' : result ? 'Yeniden aktar' : 'Aktar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Ay" name="export-period" options={options.map((row) => ({ value: row.value, label: row.label }))} value={period} onChange={(event) => setPeriod(event.target.value)} disabled={busy} />
          <Select label="Departman" name="export-department" options={[{ value: '', label: 'Hepsi' }, ...departments.map((row) => ({ value: row.id, label: row.name }))]} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} disabled={busy} />
        </div>
        <p className="text-xs text-ink-muted">Ayda çalışan her personel için satır yazılır: eksik gün (gelmedi + rapor / ücretsiz / doğum izni, en çok 30), çalışılan gün, norm üstü saat, resmî tatilde ve hafta tatilinde çalışılan gün. Elle girilmiş aylık puantaj üzerine yazılır.</p>
        {run.isError && (
          <Alert tone="danger" title={run.error.code === 'PAYROLL_MONTH_LOCKED' ? 'Bordro ayı kilitli' : 'Aktarılamadı'}>
            {run.error.message}
            {run.error.code === 'PAYROLL_MONTH_LOCKED' && (
              <>
                {' '}
                Onaylı ayın düzeltmesi fark bordrosuyla yapılır:{' '}
                <Link to="/bordro" className="font-semibold hover:underline">
                  Bordrolar →
                </Link>
              </>
            )}
          </Alert>
        )}
        {result && (
          <div className="flex flex-col gap-3">
            <Alert tone="success" title={`${result.period}: ${result.exported} satır yazıldı${result.skipped ? `, ${result.skipped} atlandı` : ''}`}>
              Aylık puantaj{' '}
              <Link to="/bordro/puantaj" className="font-semibold hover:underline">
                Bordro → Puantaj ve kalemler
              </Link>{' '}
              sayfasında görülür; bordro hesabı yeniden alınmalı.
            </Alert>
            {result.rows?.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-line text-left text-[0.65rem] uppercase tracking-[0.08em] text-ink-muted">
                    <tr>
                      <th className="py-2 pr-3">Personel</th>
                      <th className="py-2 pr-3 text-right">Eksik gün</th>
                      <th className="py-2 pr-3">Neden</th>
                      <th className="py-2 pr-3 text-right">Çalışılan</th>
                      <th className="py-2 pr-3 text-right">Mesai (saat)</th>
                      <th className="py-2 pr-3 text-right">Bayram</th>
                      <th className="py-2 pr-3 text-right">Hafta tatili</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.rows.slice(0, PREVIEW_ROWS).map((row) => (
                      <tr key={row.employee.id}>
                        <td className="py-1.5 pr-3 font-semibold text-ink">{row.employee.name}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{row.missingDays}</td>
                        <td className="py-1.5 pr-3 text-ink-soft">{row.missingReason ? `${row.missingReason} ${MISSING_DAY_REASONS[row.missingReason] ?? ''}` : '—'}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{row.workedDays}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{row.overtimeHours}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{row.holidayDays}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{row.weeklyRestDays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.rows.length > PREVIEW_ROWS && <p className="mt-2 text-xs text-ink-muted">İlk {PREVIEW_ROWS} satır gösteriliyor ({result.rows.length} personel).</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
