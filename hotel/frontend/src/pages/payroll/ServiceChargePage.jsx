import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SERVICE_CHARGE_METHOD_LABELS, SERVICE_CHARGE_METHODS, serviceChargeSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { MultiChips } from '../../components/MultiChips.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiDelete, apiPut, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { parsePeriod, payrollKeys, periodOptions } from '../../lib/payroll.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Servis payı (modül 51): ayın havuzu puan ya da eşit payla, istenirse çalışılan güne göre dağıtılır; paylar ayın
 * "Servis payı" kalemine yazılır (kuruş artığı en büyük paydan başlanarak dağıtılır, toplam havuza eşit).
 * Ay onaydaysa / onaylıysa dağıtım değişmez.
 */
export function ServiceChargePage() {
  const can = useCan();
  const { today } = useHotelToday();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(today.slice(0, 7));
  const { year, month } = parsePeriod(period);
  const pool = useQuery({ queryKey: payrollKeys.serviceCharge(year, month), queryFn: () => api(withQuery('/payroll/service-charge', { year, month })) });
  const departments = useQuery({ queryKey: payrollKeys.departments, queryFn: () => api('/payroll/departments') });
  const [values, setValues] = useState({ amount: '', method: 'POINTS', daysWeighted: true, departmentIds: [], note: '' });
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (!pool.isSuccess) return;
    const row = pool.data;
    setValues(row ? { amount: row.amount, method: row.method, daysWeighted: row.daysWeighted, departmentIds: row.departmentIds, note: row.note ?? '' } : { amount: '', method: 'POINTS', daysWeighted: true, departmentIds: [], note: '' });
    setErrors({});
  }, [pool.isSuccess, pool.data, period]);
  const canEdit = can(PERMISSIONS.PAYROLL_MANAGE);
  const distribute = useMutation({
    mutationFn: (body) => apiPut('/payroll/service-charge', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess('Servis payı dağıtıldı; ayın bordrosu yeniden hesaplanmalı');
    },
    onError: (error) => {
      if (error.details?.fields) setErrors(error.details.fields);
      toastError(error.message);
    },
  });
  const undo = useMutation({
    mutationFn: () => apiDelete(withQuery('/payroll/service-charge', { year, month })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess('Dağıtım geri alındı');
    },
    onError: (error) => toastError(error.message),
  });
  const submit = (event) => {
    event.preventDefault();
    const checked = validateWith(serviceChargeSchema, { year, month, ...values, note: values.note || null });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    distribute.mutate(checked.data);
  };
  const busy = distribute.isPending || undo.isPending;
  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-xs">
        <Select label="Dönem" options={periodOptions(today).map((row) => ({ value: row.value, label: row.label }))} value={period} onChange={(event) => setPeriod(event.target.value)} />
      </div>
      {!pool.isSuccess ? (
        <QueryFallback query={pool} errorTitle="Servis payı okunamadı" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
          <Card title="Havuz" description="Otelin bu ay topladığı ve personele dağıtacağı servis ücreti.">
            <form noValidate onSubmit={submit} className="flex flex-col gap-3">
              <Input label="Dağıtılacak tutar" inputMode="decimal" value={values.amount} disabled={!canEdit || busy} onChange={(event) => setValues((current) => ({ ...current, amount: event.target.value }))} error={errors.amount} />
              <Select label="Yöntem" options={SERVICE_CHARGE_METHODS.map((value) => ({ value, label: SERVICE_CHARGE_METHOD_LABELS[value] }))} value={values.method} disabled={!canEdit || busy} onChange={(event) => setValues((current) => ({ ...current, method: event.target.value }))} />
              <Checkbox label="Çalışılan güne göre ağırlıklandır" hint="Eksik günü olan payını gün oranında alır" checked={values.daysWeighted} disabled={!canEdit || busy} onChange={(event) => setValues((current) => ({ ...current, daysWeighted: event.target.checked }))} />
              <MultiChips label="Departmanlar" allLabel="Hepsi" options={(departments.data ?? []).filter((row) => row.isActive).map((row) => ({ value: row.id, label: row.name }))} values={values.departmentIds} onChange={(departmentIds) => setValues((current) => ({ ...current, departmentIds }))} disabled={!canEdit || busy} />
              <Textarea label="Not" rows={2} value={values.note} disabled={!canEdit || busy} onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))} />
              {values.method === 'POINTS' && <p className="text-xs text-ink-muted">Puanlar personel kartındaki "Servis payı puanı"ndan; puanı sıfır olan pay almaz.</p>}
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" icon="check" disabled={busy}>
                    {pool.data?.status === 'DISTRIBUTED' ? 'Yeniden dağıt' : 'Dağıt'}
                  </Button>
                  {pool.data?.status === 'DISTRIBUTED' && (
                    <Button type="button" variant="outline" icon="rotateCcw" disabled={busy} onClick={() => undo.mutate()}>
                      Geri al
                    </Button>
                  )}
                </div>
              )}
            </form>
          </Card>
          <Card title="Paylar" description={pool.data?.distributedAt ? `Dağıtım: ${formatDate(pool.data.distributedAt)}` : 'Henüz dağıtılmadı.'}>
            {pool.data?.shares?.length ? (
              <ul className="flex flex-col text-sm">
                {pool.data.shares.map((share) => (
                  <li key={share.employeeId} className="flex justify-between gap-3 border-t border-line py-1.5 first:border-0">
                    <span>{share.employee}</span>
                    <span className="tabular-nums">{formatMoney(share.amount)}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-3 border-t border-line py-2 font-semibold">
                  <span>Toplam ({pool.data.shares.length} kişi)</span>
                  <span className="tabular-nums">{formatMoney(pool.data.shares.reduce((sum, share) => sum + Number(share.amount), 0))}</span>
                </li>
              </ul>
            ) : (
              <Alert tone="info">Dağıtılınca her personelin payı burada görünür ve ayın bordrosuna "Servis payı" kalemiyle girer.</Alert>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
