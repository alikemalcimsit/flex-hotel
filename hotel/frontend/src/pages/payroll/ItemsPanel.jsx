import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYROLL_DEDUCTION_LINE_LABELS, payrollItemSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Checkbox, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiDelete, apiPost, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { payrollKeys } from '../../lib/payroll.js';
import { useDebounced } from '../../lib/pos.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Elle girilebilen sistem kalemleri (diğerleri ücretten, puantajdan, çıkıştan, servis payından gelir). */
const MANUAL_SYSTEM = Object.freeze(['BONUS', 'MEAL', 'TRANSPORT', 'RETRO_PAY', 'OTHER_EARNING', 'OTHER_DEDUCTION']);
const SOURCE_LABELS = Object.freeze({ MANUAL: 'Elle', SERVICE_CHARGE: 'Servis payı', TERMINATION: 'İşten çıkış' });
const PAGE_SIZE = 20;

/**
 * Ayın ek ödeme / kesinti kalemleri (modül 51): aylık bordroya ya da (runId ile) fark bordrosuna. Netten girilen
 * ödeme brüte çevrilir (çalışanın eline tam o tutar geçer); kesinti hep netten düşer.
 *
 * @param {{ year: number, month: number, runId?: string | null, locked?: boolean }} props
 */
export function ItemsPanel({ year, month, runId = null, locked = false }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [year, month, runId]);
  const filters = { year, month, runId: runId ?? undefined, page, pageSize: PAGE_SIZE };
  const items = useQuery({ queryKey: payrollKeys.items(filters), queryFn: () => api(withQuery('/payroll/items', filters)), placeholderData: keepPreviousData });
  const remove = useMutation({
    mutationFn: (id) => apiDelete(`/payroll/items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess('Kalem silindi');
    },
    onError: (error) => toastError(error.message),
  });
  const canEdit = can(PERMISSIONS.PAYROLL_MANAGE) && !locked;
  const columns = [
    { key: 'employee', header: 'Personel', render: (row) => row.employee },
    { key: 'element', header: 'Kalem', render: (row) => <span>{row.element.name}<span className="block text-xs text-ink-muted">{SOURCE_LABELS[row.source]}{row.note ? ` · ${row.note}` : ''}</span></span> },
    { key: 'amount', header: 'Tutar', className: 'text-right tabular-nums', render: (row) => `${row.element.kind === 'DEDUCTION' ? '− ' : ''}${formatMoney(row.amount)}${row.isNet && row.element.kind === 'EARNING' ? ' net' : ''}` },
    {
      key: 'action',
      header: '',
      className: 'text-right',
      render: (row) =>
        canEdit && row.source === 'MANUAL' ? (
          <Button type="button" size="sm" variant="ghost" icon="trash" disabled={remove.isPending} onClick={() => remove.mutate(row.id)}>
            Sil
          </Button>
        ) : null,
    },
  ];
  return (
    <Card
      title={runId ? 'Fark bordrosunun kalemleri' : 'Ek ödeme ve kesintiler'}
      description={runId ? 'Onaylı aya sonradan eklenen ödeme / kesinti; ay bu kalemlerle baştan hesaplanır, fark ödenir.' : `Prim, yemek, yol, geçmiş dönem farkı, diğer ödeme / kesinti. Kesinti kalemleri ${Object.values(PAYROLL_DEDUCTION_LINE_LABELS).join(', ').toLocaleLowerCase('tr')} sonrası düşer.`}
      actions={
        canEdit && (
          <Button type="button" size="sm" icon="plus" onClick={() => setAdding(true)}>
            Kalem ekle
          </Button>
        )
      }
    >
      <DataTable columns={columns} rows={items.data?.items} meta={items.data?.meta} isLoading={items.isPending} isFetching={items.isFetching} error={items.isError ? items.error : null} onRetry={() => items.refetch()} onPageChange={setPage} emptyTitle="Kalem yok" />
      {adding && <ItemDialog year={year} month={month} runId={runId} onClose={() => setAdding(false)} />}
    </Card>
  );
}

/** @param {{ year: number, month: number, runId: string | null, onClose: () => void }} props */
function ItemDialog({ year, month, runId, onClose }) {
  const queryClient = useQueryClient();
  const [employeeText, setEmployeeText] = useState('');
  const search = useDebounced(employeeText);
  const [values, setValues] = useState({ employeeId: '', elementId: '', amount: '', isNet: false, note: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const elements = useQuery({ queryKey: payrollKeys.elements, queryFn: () => api('/payroll/elements') });
  const people = useQuery({ queryKey: payrollKeys.attendance({ year, month, search, page: 1, pageSize: 20 }), queryFn: () => api(withQuery('/payroll/attendance', { year, month, search: search || undefined, page: 1, pageSize: 20 })) });
  const usable = (elements.data ?? []).filter((row) => row.isActive && (!row.system || MANUAL_SYSTEM.includes(row.code)));
  const element = usable.find((row) => row.id === values.elementId);
  const save = useMutation({
    mutationFn: (body) => apiPost('/payroll/items', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess('Kalem eklendi');
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.details?.fields) setErrors(error.details.fields);
    },
  });
  const submit = (event) => {
    event.preventDefault();
    const checked = validateWith(payrollItemSchema, { year, month, runId, ...values, note: values.note || null });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  };
  return (
    <Modal
      open
      title="Kalem ekle"
      onClose={save.isPending ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="item-form" icon="check" disabled={save.isPending}>
            Ekle
          </Button>
        </>
      }
    >
      <form id="item-form" noValidate onSubmit={submit} className="flex flex-col gap-3">
        {serverError && <Alert tone="danger">{serverError.message}</Alert>}
        <Input label="Personel ara" value={employeeText} onChange={(event) => setEmployeeText(event.target.value)} placeholder="Ad ya da sicil" />
        <Select label="Personel" options={[{ value: '', label: 'Seçin' }, ...(people.data?.items ?? []).map((row) => ({ value: row.employeeId, label: `${row.code} · ${row.name} (${row.department})` }))]} value={values.employeeId} onChange={(event) => setValues((current) => ({ ...current, employeeId: event.target.value }))} error={errors.employeeId} />
        <Select label="Kalem" options={[{ value: '', label: 'Seçin' }, ...usable.map((row) => ({ value: row.id, label: `${row.name}${row.kind === 'DEDUCTION' ? ' (kesinti)' : ''}` }))]} value={values.elementId} onChange={(event) => setValues((current) => ({ ...current, elementId: event.target.value }))} error={errors.elementId} />
        <Input label="Tutar" inputMode="decimal" value={values.amount} onChange={(event) => setValues((current) => ({ ...current, amount: event.target.value }))} error={errors.amount} />
        {element?.kind === 'EARNING' && <Checkbox label="Net tutar (brüte çevrilsin)" checked={values.isNet} onChange={(event) => setValues((current) => ({ ...current, isNet: event.target.checked }))} />}
        {element?.exemption === 'MEAL' && <p className="text-xs text-ink-muted">Yemek: çalışılan gün × günlük istisna kadarı gelir vergisinden ve SGK'dan istisnadır; aşan kısım vergilenir.</p>}
        <Input label="Not" value={values.note} onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))} error={errors.note} />
      </form>
    </Modal>
  );
}
