import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CALENDAR_DAY_LEAVE_TYPES, LEAVE_TYPES, LEAVE_TYPE_LABELS, LEAVE_TYPE_MAX_DAYS, countLeaveDays, leaveCancelSchema, leaveCreateSchema } from '@hotelos/hotel-contracts';
import { Alert, Input, Select, Textarea } from '@hotelos/ui';
import { api, apiPost } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { employeeName, hrKeys } from '../../lib/hr.js';
import { EmployeeField } from './EmployeeField.jsx';
import { HrFormDialog, useHrDialogSubmit } from './HrFormDialog.jsx';

/**
 * İzin talebi (modül 52). İki kip: İK personel adına (`/hr/leaves`, personel seçici) ya da personel kendi adına
 * (`/hr/me/leaves`, `self`). Gün sayısı istemcide `countLeaveDays` ile önizlenir (hafta tatili ve resmî tatiller
 * ayarlardan); yasal sınırlı türlerde (evlilik, vefat, babalık) sınır aşımı uyarılır — sunucu reddeder.
 *
 * @param {{
 *   onClose: () => void,
 *   self?: boolean,
 *   settings?: { weeklyRestDay: number, publicHolidays: Array<{ date: string }>, leaveApprovalRequired: boolean } | null,
 *   employee?: any | null,
 *   today: string,
 * }} props `settings` verilmezse `/hr/settings` okunur (self sayfası `/hr/me`'den verir)
 */
export function LeaveDialog({ onClose, self = false, settings = null, employee = null, today }) {
  const [picked, setPicked] = useState(employee);
  const [values, setValues] = useState({ type: 'ANNUAL', startDate: today, endDate: today, reason: '' });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const settingsQuery = useQuery({ queryKey: hrKeys.settings, queryFn: () => api('/hr/settings'), enabled: !settings });
  const effective = settings ?? settingsQuery.data?.settings ?? null;
  const { submit, errors, serverError, busy } = useHrDialogSubmit({
    schema: leaveCreateSchema,
    request: (body) => apiPost(self ? '/hr/me/leaves' : '/hr/leaves', body),
    success: (leave) => (leave.status === 'APPROVED' ? 'İzin kaydedildi (onaylı)' : 'İzin talebi onaya gönderildi'),
    onClose,
  });

  const days = useMemo(() => {
    if (!effective || !values.startDate || !values.endDate || values.endDate < values.startDate) return null;
    return countLeaveDays({ type: values.type, startDate: values.startDate, endDate: values.endDate, weeklyRestDay: effective.weeklyRestDay, holidays: effective.publicHolidays.map((holiday) => holiday.date) });
  }, [effective, values.type, values.startDate, values.endDate]);
  const maxDays = LEAVE_TYPE_MAX_DAYS[values.type];
  const overLimit = maxDays !== undefined && days !== null && days > maxDays;
  const byCalendar = CALENDAR_DAY_LEAVE_TYPES.includes(values.type);

  return (
    <HrFormDialog title={self ? 'İzin talebi' : picked ? `İzin gir: ${employeeName(picked)}` : 'İzin gir'} formId="leave-form" busy={busy} onClose={onClose} submitLabel={self || effective?.leaveApprovalRequired ? 'Onaya gönder' : 'Kaydet'} serverError={serverError} submitDisabled={!self && !picked}>
      <form
        id="leave-form"
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ employeeId: self ? null : picked?.id ?? null, type: values.type, startDate: values.startDate, endDate: values.endDate, reason: values.reason || null });
        }}
      >
        {!self && <EmployeeField value={picked} onChange={setPicked} error={errors.employeeId} disabled={busy} className="sm:col-span-2" />}
        <Select label="İzin türü" name="leave-type" options={LEAVE_TYPES.map((value) => ({ value, label: LEAVE_TYPE_LABELS[value] }))} value={values.type} onChange={set('type')} error={errors.type} className="sm:col-span-2" />
        <Input label="Başlangıç" name="leave-start" type="date" value={values.startDate} onChange={set('startDate')} error={errors.startDate} />
        <Input label="Bitiş" name="leave-end" type="date" min={values.startDate} value={values.endDate} onChange={set('endDate')} error={errors.endDate} />
        <Textarea label="Açıklama" name="leave-reason" rows={2} value={values.reason} onChange={set('reason')} error={errors.reason} className="sm:col-span-2" />
        <div className="sm:col-span-2">
          {days !== null ? (
            <p className="text-sm text-ink-soft">
              <span className="font-bold text-ink">{days} gün</span> · {formatDate(values.startDate)} – {formatDate(values.endDate)} ·{' '}
              {byCalendar ? 'takvim günüyle sayılır' : 'iş günü (hafta tatili ve resmî tatiller düşüldü)'}
            </p>
          ) : (
            <p className="text-xs text-ink-muted">{effective ? 'Tarihleri seçince gün sayısı burada görünür.' : 'Ayarlar yükleniyor…'}</p>
          )}
          {overLimit && (
            <Alert tone="warning" className="mt-3">
              {LEAVE_TYPE_LABELS[values.type]} en fazla {maxDays} iş günü; bu talep reddedilir.
            </Alert>
          )}
          {values.type === 'ANNUAL' && days !== null && <p className="mt-1 text-xs text-ink-muted">Yıllık izinde bakiye yetmiyorsa talep reddedilir.</p>}
          {!self && effective && !effective.leaveApprovalRequired && <p className="mt-1 text-xs text-ink-muted">Ayarlarda izin onayı kapalı: İK'nın girdiği izin doğrudan onaylı yazılır.</p>}
        </div>
      </form>
    </HrFormDialog>
  );
}

/**
 * İzin iptali: sebep zorunlu. Bekleyeni isteyen ya da İK, onaylıyı yalnız İK iptal eder (ayı kilitli bordroya
 * girmemişse); kuyruktaki onay isteği konusuz kalır.
 * @param {{ leave: any, onClose: () => void }} props
 */
export function LeaveCancelDialog({ leave, onClose }) {
  const [reason, setReason] = useState('');
  const { submit, errors, serverError, busy } = useHrDialogSubmit({ schema: leaveCancelSchema, request: (body) => apiPost(`/hr/leaves/${leave.id}/cancel`, body), success: 'İzin iptal edildi', onClose });
  return (
    <HrFormDialog title="İzni iptal et" formId="leave-cancel-form" busy={busy} onClose={onClose} submitLabel="İptal et" submitIcon="close" submitVariant="danger" serverError={serverError} size="sm">
      <form
        id="leave-cancel-form"
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ reason });
        }}
      >
        <p className="text-sm text-ink-soft">
          {employeeName(leave.employee)} · {leave.typeLabel} · {formatDate(leave.startDate)} – {formatDate(leave.endDate)} ({leave.days} gün)
        </p>
        <Textarea label="İptal sebebi" name="leave-cancel-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} />
        {leave.status === 'APPROVED' && <p className="text-xs text-ink-muted">Onaylı izin iptalinde o günlerin puantajı "Gelmedi" olur; düzeltmeyi unutmayın.</p>}
      </form>
    </HrFormDialog>
  );
}
