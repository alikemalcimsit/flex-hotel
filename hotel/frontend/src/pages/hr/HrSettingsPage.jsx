import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_PUBLIC_HOLIDAYS, WEEKDAY_LABELS, fixedPublicHolidays, hrSettingsSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Checkbox, Input, Select } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { hrKeys } from '../../lib/hr.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/** Dakika ↔ saat metni ("7,5"). */
const hoursText = (minutes) => (minutes / 60).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const minutesOfHours = (text) => Math.round(Number(String(text).replace(',', '.')) * 60);
const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, value) => ({ value: String(value), label }));

/**
 * İK ayarları (modül 52, `hr.manage`): hafta tatili günü, günlük ve haftalık çalışma normu (saat olarak girilir,
 * dakika saklanır), izin onayı, belge hatırlatma günü; resmî tatiller tablosu (ekle / sil, sabit tatilleri yılla
 * doldur — dinî bayramlar elle). Eşzamanlı yazımda bayat kayıt reddedilir.
 */
export function HrSettingsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.HR_MANAGE);
  const query = useQuery({ queryKey: hrKeys.settings, queryFn: () => api('/hr/settings') });
  if (!query.data) return <QueryFallback query={query} errorTitle="Ayarlar yüklenemedi" />;
  return <SettingsForm key={query.data.settings.updatedAt ?? 'default'} data={query.data} canManage={canManage} />;
}

/** @param {{ data: { settings: any, today: string }, canManage: boolean }} props */
function SettingsForm({ data, canManage }) {
  const queryClient = useQueryClient();
  const { settings } = data;
  const [values, setValues] = useState({
    weeklyRestDay: String(settings.weeklyRestDay),
    dailyHours: hoursText(settings.dailyWorkMinutes),
    weeklyHours: hoursText(settings.weeklyWorkMinutes),
    leaveApprovalRequired: settings.leaveApprovalRequired,
    documentReminderDays: String(settings.documentReminderDays),
  });
  const [holidays, setHolidays] = useState(settings.publicHolidays);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });
  const [year, setYear] = useState(data.today.slice(0, 4));
  const [errors, setErrors] = useState({});
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const disabled = !canManage;

  const save = useMutation({
    mutationFn: (body) => apiPut('/hr/settings', body),
    onSuccess: (result) => {
      queryClient.setQueryData(hrKeys.settings, result);
      queryClient.invalidateQueries({ queryKey: hrKeys.all });
      toastSuccess('İK ayarları kaydedildi');
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: hrKeys.settings });
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = {
      expectedUpdatedAt: settings.updatedAt ?? null,
      weeklyRestDay: Number(values.weeklyRestDay),
      dailyWorkMinutes: minutesOfHours(values.dailyHours),
      weeklyWorkMinutes: minutesOfHours(values.weeklyHours),
      publicHolidays: holidays,
      leaveApprovalRequired: values.leaveApprovalRequired,
      documentReminderDays: values.documentReminderDays,
    };
    const checked = validateWith(hrSettingsSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  }

  function addHoliday() {
    if (!newHoliday.date || newHoliday.name.trim().length < 2) return setErrors((current) => ({ ...current, newHoliday: 'Tarih ve ad (en az 2 karakter) girin' }));
    if (holidays.some((holiday) => holiday.date === newHoliday.date)) return setErrors((current) => ({ ...current, newHoliday: 'Bu tarih zaten listede' }));
    setHolidays((current) => [...current, { date: newHoliday.date, name: newHoliday.name.trim() }].sort((a, b) => a.date.localeCompare(b.date)));
    setNewHoliday({ date: '', name: '' });
    setErrors(({ newHoliday: _removed, ...rest }) => rest);
  }

  function addFixed() {
    const existing = new Set(holidays.map((holiday) => holiday.date));
    const added = fixedPublicHolidays(Number(year)).filter((holiday) => !existing.has(holiday.date));
    setHolidays((current) => [...current, ...added].sort((a, b) => a.date.localeCompare(b.date)));
  }

  const dirty = JSON.stringify(holidays) !== JSON.stringify(settings.publicHolidays) || values.weeklyRestDay !== String(settings.weeklyRestDay) || minutesOfHours(values.dailyHours) !== settings.dailyWorkMinutes || minutesOfHours(values.weeklyHours) !== settings.weeklyWorkMinutes || values.leaveApprovalRequired !== settings.leaveApprovalRequired || values.documentReminderDays !== String(settings.documentReminderDays);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {save.isError && (
        <Alert tone="danger" title={save.error.code === 'STALE_WRITE' ? 'Ayar bu arada değişti' : 'Kaydedilmedi'}>
          {save.error.message}
        </Alert>
      )}
      {settings.isDefault && (
        <Alert tone="info" title="Varsayılan ayarlar">
          Henüz kaydedilmiş İK ayarı yok; hafta tatili Pazar, günlük 7,5 ve haftalık 45 saat, izin onayı açık, bu ve gelecek yılın sabit resmî tatilleri geçerli.
        </Alert>
      )}
      <Card title="Çalışma düzeni" description="Hafta tatili ve resmî tatiller izin gün sayımında düşülür, puantajda varsayılan durumdur. Günlük normun üstü mesai, haftalık normun üstü çizelgede uyarıdır.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Hafta tatili günü" name="hr-rest-day" options={WEEKDAY_OPTIONS} value={values.weeklyRestDay} onChange={set('weeklyRestDay')} error={errors.weeklyRestDay} disabled={disabled} />
          <Input label="Günlük norm (saat)" name="hr-daily-hours" inputMode="decimal" value={values.dailyHours} onChange={set('dailyHours')} error={errors.dailyWorkMinutes} disabled={disabled} />
          <Input label="Haftalık norm (saat)" name="hr-weekly-hours" inputMode="decimal" value={values.weeklyHours} onChange={set('weeklyHours')} error={errors.weeklyWorkMinutes} disabled={disabled} />
          <Input label="Belge hatırlatma (gün önce)" name="hr-reminder-days" inputMode="numeric" value={values.documentReminderDays} onChange={set('documentReminderDays')} error={errors.documentReminderDays} disabled={disabled} />
        </div>
        <Checkbox label="İzin talepleri onay kuyruğuna düşsün" hint="Kapalıysa İK'nın girdiği izin doğrudan onaylı yazılır; personelin kendi talebi her durumda onaya gider." name="hr-leave-approval" checked={values.leaveApprovalRequired} onChange={set('leaveApprovalRequired')} disabled={disabled} className="mt-4" />
      </Card>
      <Card
        title="Resmî tatiller"
        description={`Ulusal bayram ve genel tatiller (en fazla ${MAX_PUBLIC_HOLIDAYS}). Sabit tarihliler yıl seçilip eklenir; dinî bayramlar ve arife yarım günleri elle girilir.`}
        actions={
          canManage && (
            <span className="flex items-center gap-2">
              <Input aria-label="Yıl" name="hr-fixed-year" inputMode="numeric" value={year} onChange={(event) => setYear(event.target.value.replace(/\D/g, '').slice(0, 4))} className="w-24" />
              <Button type="button" size="sm" variant="outline" icon="plus" onClick={addFixed} disabled={year.length !== 4}>
                Sabit tatilleri ekle
              </Button>
            </span>
          )
        }
      >
        {errors.publicHolidays && <p className="mb-2 text-xs font-bold text-sec-strong">{errors.publicHolidays}</p>}
        {holidays.length === 0 ? (
          <p className="text-sm text-ink-muted">Tatil yok: izin sayımında yalnız hafta tatili düşülür.</p>
        ) : (
          <ul className="divide-y divide-line">
            {holidays.map((holiday) => (
              <li key={holiday.date} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-semibold tabular-nums text-ink">{formatDate(holiday.date)}</span> <span className="text-ink-soft">· {holiday.name}</span>
                </span>
                {canManage && <Button type="button" size="sm" variant="ghost" icon="trash" aria-label={`${holiday.name} tatilini sil`} onClick={() => setHolidays((current) => current.filter((row) => row.date !== holiday.date))} />}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Input label="Tarih" name="hr-holiday-date" type="date" value={newHoliday.date} onChange={(event) => setNewHoliday((current) => ({ ...current, date: event.target.value }))} className="w-full sm:w-40" />
            <Input label="Ad" name="hr-holiday-name" placeholder="Ramazan Bayramı 1. gün" value={newHoliday.name} onChange={(event) => setNewHoliday((current) => ({ ...current, name: event.target.value }))} error={errors.newHoliday} className="w-full sm:w-72" />
            <Button type="button" variant="outline" icon="plus" onClick={addHoliday}>
              Ekle
            </Button>
          </div>
        )}
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">{settings.updatedAt ? `Son kayıt ${formatDateTime(settings.updatedAt)}${settings.updatedBy ? ` · ${settings.updatedBy}` : ''}` : 'Henüz kaydedilmedi.'}</p>
        {canManage && (
          <Button type="submit" icon="check" disabled={save.isPending || !dirty}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        )}
      </div>
    </form>
  );
}
