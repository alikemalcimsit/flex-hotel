import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DISABILITY_DEGREES, EMPLOYEE_PAYMENT_METHOD_LABELS, EMPLOYEE_PAYMENT_METHODS, INSURANCE_TYPES, INSURANCE_TYPE_LABELS, PAY_BASES, PAY_BASIS_LABELS, employeeCreateSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, apiPut } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { payrollKeys } from '../../lib/payroll.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/** Kartın form değerleri (düzenlemede mevcut karttan). @param {any} employee */
function initialValues(employee) {
  return {
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    nationality: employee?.nationality ?? 'TR',
    nationalId: employee?.nationalId ?? '',
    birthDate: employee?.birthDate ?? '',
    phone: employee?.phone ?? '',
    email: employee?.email ?? '',
    address: employee?.address ?? '',
    departmentId: employee?.department?.id ?? '',
    position: employee?.position ?? '',
    hireDate: employee?.hireDate ?? '',
    insuranceType: employee?.insuranceType ?? 'NORMAL',
    disabilityDegree: employee?.disabilityDegree ? String(employee.disabilityDegree) : '',
    serviceChargePoints: employee?.serviceChargePoints ?? '0',
    notes: employee?.notes ?? '',
    payBasis: employee?.payBasis ?? 'GROSS',
    salary: employee?.salary ?? '',
    paymentMethod: employee?.paymentMethod ?? 'BANK',
    iban: employee?.iban ?? '',
    besEnrolled: employee?.besEnrolled ?? false,
    besRate: employee?.besRate ?? '',
    besOptOutOn: employee?.besOptOutOn ?? '',
  };
}

/**
 * Personel kartı ekle / düzenle (modül 51). Ücret bölümü yalnız `payroll.manage` ile görünür ve gönderilir; kimlik
 * numarası T.C. uyrukluda denetim haneleriyle doğrulanır (sunucu aynı şemayla tekrar doğrular).
 *
 * @param {{ employee?: any, onClose: () => void, onSaved?: (employee: any) => void }} props
 */
export function EmployeeFormDialog({ employee = null, onClose, onSaved }) {
  const can = useCan();
  const withPay = can(PERMISSIONS.PAYROLL_MANAGE);
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => initialValues(employee));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const departments = useQuery({ queryKey: payrollKeys.departments, queryFn: () => api('/payroll/departments') });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const save = useMutation({
    mutationFn: (body) => (employee ? apiPut(`/payroll/employees/${employee.id}`, body) : apiPost('/payroll/employees', body)),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess(employee ? 'Personel kartı kaydedildi' : `${data.code} sicil numarasıyla personel eklendi`);
      onSaved?.(data);
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.details?.fields) setErrors(error.details.fields);
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = {
      ...values,
      birthDate: values.birthDate || null,
      phone: values.phone || null,
      email: values.email || null,
      address: values.address || null,
      notes: values.notes || null,
      disabilityDegree: values.disabilityDegree ? Number(values.disabilityDegree) : null,
      ...(withPay ? { iban: values.iban || null, besRate: values.besRate || null, besOptOutOn: values.besOptOutOn || null } : {}),
    };
    if (!withPay) for (const key of ['payBasis', 'salary', 'paymentMethod', 'iban', 'besEnrolled', 'besRate', 'besOptOutOn']) delete body[key];
    const checked = validateWith(employeeCreateSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setServerError(null);
    save.mutate(employee ? { ...checked.data, expectedUpdatedAt: employee.updatedAt } : checked.data);
  }

  const busy = save.isPending;
  const departmentOptions = [{ value: '', label: 'Seçin' }, ...(departments.data ?? []).filter((row) => row.isActive || row.id === values.departmentId).map((row) => ({ value: row.id, label: row.name }))];
  return (
    <Modal
      open
      size="xl"
      title={employee ? `${employee.code} · ${employee.name}` : 'Personel ekle'}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form="employee-form" icon="check" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        {serverError && (
          <Alert tone="danger" title="Kaydedilmedi">
            {serverError.message}
          </Alert>
        )}
        {departments.isSuccess && departments.data.length === 0 && (
          <Alert tone="warning" title="Departman yok">
            Önce Bordro → Ayarlar → Departmanlar'dan en az bir departman ekleyin.
          </Alert>
        )}
        <fieldset className="grid gap-3 sm:grid-cols-3" disabled={busy}>
          <legend className="mb-2 text-sm font-bold text-ink">Kimlik ve iletişim</legend>
          <Input label="Ad" value={values.firstName} onChange={set('firstName')} error={errors.firstName} autoComplete="off" />
          <Input label="Soyad" value={values.lastName} onChange={set('lastName')} error={errors.lastName} autoComplete="off" />
          <Input label="Uyruk (ülke kodu)" value={values.nationality} maxLength={2} onChange={set('nationality')} error={errors.nationality} />
          <Input label={values.nationality.toUpperCase() === 'TR' ? 'T.C. kimlik no' : 'Kimlik / pasaport no'} value={values.nationalId} inputMode={values.nationality.toUpperCase() === 'TR' ? 'numeric' : 'text'} onChange={set('nationalId')} error={errors.nationalId} autoComplete="off" />
          <Input label="Doğum tarihi" type="date" value={values.birthDate} onChange={set('birthDate')} error={errors.birthDate} />
          <Input label="Telefon" value={values.phone} onChange={set('phone')} error={errors.phone} />
          <Input label="E-posta" type="email" value={values.email} onChange={set('email')} error={errors.email} className="sm:col-span-2" />
          <Input label="Adres" value={values.address} onChange={set('address')} error={errors.address} />
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-3" disabled={busy}>
          <legend className="mb-2 text-sm font-bold text-ink">İş</legend>
          <Select label="Departman" options={departmentOptions} value={values.departmentId} onChange={set('departmentId')} error={errors.departmentId} />
          <Input label="Görev" value={values.position} onChange={set('position')} error={errors.position} />
          <Input label="İşe giriş" type="date" value={values.hireDate} onChange={set('hireDate')} error={errors.hireDate} />
          <Select label="Sigorta" options={INSURANCE_TYPES.map((value) => ({ value, label: INSURANCE_TYPE_LABELS[value] }))} value={values.insuranceType} onChange={set('insuranceType')} error={errors.insuranceType} />
          <Select label="Engellilik derecesi" options={[{ value: '', label: 'Yok' }, ...DISABILITY_DEGREES.map((value) => ({ value: String(value), label: `${value}. derece` }))]} value={values.disabilityDegree} onChange={set('disabilityDegree')} error={errors.disabilityDegree} />
          <Input label="Servis payı puanı" inputMode="decimal" value={values.serviceChargePoints} onChange={set('serviceChargePoints')} error={errors.serviceChargePoints} />
        </fieldset>
        {withPay && (
          <fieldset className="grid gap-3 sm:grid-cols-3" disabled={busy}>
            <legend className="mb-2 text-sm font-bold text-ink">Ücret ve ödeme</legend>
            <Select label="Ücret türü" options={PAY_BASES.map((value) => ({ value, label: PAY_BASIS_LABELS[value] }))} value={values.payBasis} onChange={set('payBasis')} error={errors.payBasis} />
            <Input label={`Aylık ${values.payBasis === 'NET' ? 'net' : 'brüt'} ücret`} inputMode="decimal" value={values.salary} onChange={set('salary')} error={errors.salary} />
            <Select label="Ödeme" options={EMPLOYEE_PAYMENT_METHODS.map((value) => ({ value, label: EMPLOYEE_PAYMENT_METHOD_LABELS[value] }))} value={values.paymentMethod} onChange={set('paymentMethod')} error={errors.paymentMethod} />
            <Input label="IBAN" value={values.iban} onChange={set('iban')} error={errors.iban} placeholder="TR.." className="sm:col-span-2" autoComplete="off" />
            <div className="flex flex-col gap-2 pt-6">
              <Checkbox label="BES otomatik katılım" checked={values.besEnrolled} onChange={set('besEnrolled')} />
            </div>
            {values.besEnrolled && (
              <>
                <Input label="BES oranı (boşsa yasal)" inputMode="decimal" placeholder="0.03" value={values.besRate} onChange={set('besRate')} error={errors.besRate} />
                <Input label="BES cayma günü" type="date" value={values.besOptOutOn} onChange={set('besOptOutOn')} error={errors.besOptOutOn} />
              </>
            )}
            {values.payBasis === 'NET' && <p className="text-xs text-ink-muted sm:col-span-3">Netten anlaşılan ücret her ay, o ayın birikmiş vergi matrahına göre brüte çevrilir; çalışanın eline geçen tutar sabit kalır.</p>}
          </fieldset>
        )}
        <Textarea label="Not" rows={2} value={values.notes} onChange={set('notes')} error={errors.notes} disabled={busy} />
      </form>
    </Modal>
  );
}
