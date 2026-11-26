import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { leaveAdjustmentSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Spinner, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { daysText, employeeName, hrKeys } from '../../lib/hr.js';
import { EmployeeField } from './EmployeeField.jsx';
import { HrFormDialog, useHrDialogSubmit } from './HrFormDialog.jsx';

/**
 * Yıllık izin bakiyesi düzeltmesi (modül 52, `hr.manage`): devir izin ya da ek izin artı, kesinti eksi; yarım gün
 * olabilir. Gerekçe zorunlu; düzeltme bakiye detayında ayrı listelenir.
 * @param {{ onClose: () => void, today: string, employee?: any | null }} props
 */
export function LeaveAdjustmentDialog({ onClose, today, employee = null }) {
  const [picked, setPicked] = useState(employee);
  const [values, setValues] = useState({ days: '', effectiveOn: today, reason: '' });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const { submit, errors, serverError, busy } = useHrDialogSubmit({
    schema: leaveAdjustmentSchema,
    request: (body) => apiPost('/hr/leave-adjustments', body),
    success: (result) => `Düzeltme kaydedildi; yeni bakiye ${daysText(result.balance.balance)} gün`,
    onClose,
  });
  return (
    <HrFormDialog title={picked ? `Bakiye düzeltmesi: ${employeeName(picked)}` : 'Bakiye düzeltmesi'} formId="leave-adjustment-form" busy={busy} onClose={onClose} submitLabel="Kaydet" serverError={serverError} submitDisabled={!picked}>
      <form
        id="leave-adjustment-form"
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ employeeId: picked?.id ?? '', days: values.days.replace(',', '.'), effectiveOn: values.effectiveOn, reason: values.reason });
        }}
      >
        <EmployeeField value={picked} onChange={setPicked} error={errors.employeeId} disabled={busy} className="sm:col-span-2" />
        <Input label="Gün (+ ekler, − düşer)" name="adjustment-days" inputMode="decimal" placeholder="örn. 5 ya da -1,5" value={values.days} onChange={set('days')} error={errors.days} />
        <Input label="Geçerlilik günü" name="adjustment-date" type="date" value={values.effectiveOn} onChange={set('effectiveOn')} error={errors.effectiveOn} />
        <Textarea label="Gerekçe" name="adjustment-reason" rows={2} placeholder="Önceki işverenden devir, toplu sözleşme ek izni, hatalı kayıt düzeltmesi…" value={values.reason} onChange={set('reason')} error={errors.reason} className="sm:col-span-2" />
        <p className="text-xs text-ink-muted sm:col-span-2">Bakiye = yıl dönümlerinde doğan hak + düzeltmeler − onaylı yıllık izin. Düzeltme geçerlilik gününden itibaren bakiyeye girer.</p>
      </form>
    </HrFormDialog>
  );
}

/**
 * Bakiye detayı: hak kayıtları (hizmet yılı başına) ve elle düzeltmeler; `asOf` günü itibarıyla.
 * @param {{ employee: { id: string, name?: string }, asOf: string, onClose: () => void, onAdjust?: () => void }} props
 */
export function BalanceDetailDialog({ employee, asOf, onClose, onAdjust }) {
  const query = useQuery({ queryKey: hrKeys.balance(employee.id, asOf), queryFn: () => api(withQuery(`/hr/employees/${employee.id}/leave-balance`, { asOf: asOf || undefined })) });
  const data = query.data;
  return (
    <Modal
      open
      size="lg"
      title={`Yıllık izin bakiyesi: ${employeeName(employee)}`}
      onClose={onClose}
      footer={
        <>
          {onAdjust && (
            <Button type="button" variant="outline" icon="plus" onClick={onAdjust}>
              Düzeltme ekle
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            Kapat
          </Button>
        </>
      }
    >
      {query.isPending && <Spinner className="py-8" />}
      {query.isError && (
        <Alert tone="danger" title="Bakiye okunamadı">
          {query.error.message}
        </Alert>
      )}
      {data && (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <Stat label="Hak" value={data.earned} />
            <Stat label="Düzeltme" value={data.adjusted} signed />
            <Stat label="Kullanılan" value={data.used} />
            <Stat label="Bekleyen" value={data.pendingDays} />
            <Stat label="Kalan" value={data.balance} strong />
          </dl>
          <p className="text-xs text-ink-muted">
            {formatDate(data.asOf)} itibarıyla · işe giriş {formatDate(data.employee.hireDate)}
            {data.employee.terminationDate ? ` · çıkış ${formatDate(data.employee.terminationDate)}` : ''}
          </p>
          <section>
            <h3 className="mb-2 text-sm font-bold text-ink">Hak kayıtları</h3>
            {data.accruals.length === 0 ? (
              <p className="text-sm text-ink-muted">Henüz hak doğmadı: yıllık izin hakkı birinci iş yılı tamamlanınca doğar.</p>
            ) : (
              <SmallTable
                headers={['Hizmet yılı', 'Hak günü', 'Gün']}
                rows={data.accruals.map((row) => ({ id: `${row.serviceYear}`, cells: [`${row.serviceYear}. yıl`, formatDate(row.earnedOn), daysText(row.days)] }))}
              />
            )}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-bold text-ink">Düzeltmeler</h3>
            {data.adjustments.length === 0 ? <p className="text-sm text-ink-muted">Düzeltme yok.</p> : <SmallTable headers={['Geçerlilik', 'Gün', 'Gerekçe', 'Kaydeden']} rows={data.adjustments.map((row) => ({ id: row.id, cells: [formatDate(row.effectiveOn), signedDays(row.days), row.reason, `${row.createdBy ?? '—'} · ${formatDateTime(row.createdAt)}`] }))} />}
          </section>
        </div>
      )}
    </Modal>
  );
}

/** @param {number} value */
const signedDays = (value) => (Number(value) > 0 ? `+${daysText(value)}` : daysText(value));

/** @param {{ label: string, value: number, signed?: boolean, strong?: boolean }} props */
function Stat({ label, value, signed = false, strong = false }) {
  return (
    <div className="rounded-item bg-surface-muted px-3 py-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'text-lg font-bold text-ink' : 'font-semibold text-ink'}`}>{signed ? signedDays(value) : daysText(value)}</dd>
    </div>
  );
}

/** @param {{ headers: string[], rows: Array<{ id: string, cells: React.ReactNode[] }> }} props */
function SmallTable({ headers, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            {headers.map((header) => (
              <th key={header} className="py-1.5 pr-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line">
              {row.cells.map((cell, index) => (
                <td key={headers[index]} className="py-2 pr-3 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
