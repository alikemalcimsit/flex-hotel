import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftInputSchema, shiftMinutes } from '@hotelos/hotel-contracts';
import { Alert, Button, Input, Select } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPut } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { employeeName, hrKeys, minutesText } from '../../lib/hr.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/** Vardiya kaydının toplu uç cevabındaki uyarıları kısa metne çevirir. @param {any} warnings @param {string} employeeId */
function warningText(warnings, employeeId) {
  const found = warnings?.[employeeId];
  if (!found) return '';
  const parts = [];
  if (found.shortRests?.length) parts.push('iki vardiya arası 11 saatten az dinlenme');
  if (found.weekOverload?.length) parts.push(`haftalık norm aşımı (${found.weekOverload.map((week) => minutesText(week.minutes)).join(', ')})`);
  return parts.length ? ` — uyarı: ${parts.join('; ')}` : '';
}

/**
 * Vardiya ekle / düzenle / sil (modül 52, `hr.manage`): personel ve gün sabit; departman (varsayılan personelin),
 * başlangıç, bitiş (gece vardiyası ertesi güne taşar), mola, not. Tek vardiya `PUT /hr/shifts` toplu ucuyla yazılır;
 * çakışma sunucudan hata (`SHIFT_OVERLAP`), kısa dinlenme ve haftalık aşım uyarı olarak bildirilir.
 *
 * @param {{
 *   employee: { id: string, name: string, department: { id: string, name: string } | null },
 *   date: string,
 *   departments: Array<{ id: string, name: string }>,
 *   shift?: any | null,
 *   onClose: () => void,
 * }} props
 */
export function ShiftDialog({ employee, date, departments, shift = null, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    departmentId: shift?.departmentId ?? employee.department?.id ?? departments[0]?.id ?? '',
    startTime: shift?.startTime ?? '08:00',
    endTime: shift?.endTime ?? '16:00',
    breakMinutes: String(shift?.breakMinutes ?? 30),
    note: shift?.note ?? '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: (body) => apiPut('/hr/shifts', body),
    onSuccess: (result, body) => {
      queryClient.invalidateQueries({ queryKey: hrKeys.all });
      toastSuccess(body.deletes.length ? 'Vardiya silindi' : `Vardiya kaydedildi${warningText(result.warnings, employee.id)}`);
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
    },
  });

  const preview = values.startTime && values.endTime ? shiftMinutes({ date, startTime: values.startTime, endTime: values.endTime, breakMinutes: Number(values.breakMinutes || 0) }) : 0;
  const overnight = values.startTime && values.endTime && values.endTime <= values.startTime;

  function submit(event) {
    event.preventDefault();
    const body = { id: shift?.id ?? null, employeeId: employee.id, departmentId: values.departmentId, date, startTime: values.startTime, endTime: values.endTime, breakMinutes: values.breakMinutes || '0', note: values.note || null };
    const checked = validateWith(shiftInputSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setServerError(null);
    save.mutate({ upserts: [checked.data], deletes: [] });
  }

  const busy = save.isPending;
  return (
    <Modal
      open
      size="sm"
      title={shift ? 'Vardiyayı düzenle' : 'Vardiya ekle'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          {shift && !confirmDelete && (
            <Button type="button" variant="dangerSoft" icon="trash" onClick={() => setConfirmDelete(true)} disabled={busy} className="mr-auto">
              Sil
            </Button>
          )}
          {shift && confirmDelete && (
            <Button type="button" variant="danger" icon="trash" onClick={() => save.mutate({ upserts: [], deletes: [shift.id] })} disabled={busy} className="mr-auto">
              {busy ? 'Siliniyor…' : 'Evet, sil'}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="shift-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      {serverError && (
        <Alert tone="danger" title={serverError.code === 'SHIFT_OVERLAP' ? 'Vardiya çakışıyor' : 'Kaydedilmedi'} className="mb-4">
          {serverError.message}
        </Alert>
      )}
      <form id="shift-form" noValidate className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <p className="text-sm text-ink-soft sm:col-span-2">
          <span className="font-semibold text-ink">{employeeName(employee)}</span> · {formatDate(date)}
        </p>
        <Select label="Departman" name="shift-department" options={departments.map((row) => ({ value: row.id, label: row.name }))} value={values.departmentId} onChange={set('departmentId')} error={errors.departmentId} className="sm:col-span-2" />
        <Input label="Başlangıç" name="shift-start" type="time" step={300} value={values.startTime} onChange={set('startTime')} error={errors.startTime} />
        <Input label="Bitiş" name="shift-end" type="time" step={300} value={values.endTime} onChange={set('endTime')} error={errors.endTime} />
        <Input label="Mola (dakika)" name="shift-break" inputMode="numeric" value={values.breakMinutes} onChange={set('breakMinutes')} error={errors.breakMinutes} />
        <Input label="Not" name="shift-note" value={values.note} onChange={set('note')} error={errors.note} />
        <p className="text-xs text-ink-muted sm:col-span-2">
          Çalışma {minutesText(preview)}
          {overnight ? ' · gece vardiyası, ertesi güne taşar' : ''}. Aynı personelde çakışma kaydedilmez; 11 saatten az dinlenme ve haftalık 45 saat üstü uyarıdır.
        </p>
      </form>
    </Modal>
  );
}
