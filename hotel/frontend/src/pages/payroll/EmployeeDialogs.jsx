import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GARNISHMENT_TYPES,
  GARNISHMENT_TYPE_LABELS,
  INCENTIVE_METHODS,
  INCENTIVE_METHOD_LABELS,
  NOTICE_MODES,
  NOTICE_MODE_LABELS,
  TERMINATION_REASONS,
  TERMINATION_REASON_CODES,
  advanceSchema,
  garnishmentSchema,
  incentiveSchema,
  payrollOpeningSchema,
  terminationDefaults,
  terminationSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, apiPut, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { payrollKeys } from '../../lib/payroll.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/**
 * Personel kartının iletişim kutuları (modül 51): teşvik, avans, icra / nafaka, matrah devri, işten çıkış ve
 * gerekçeli kapatma. Hepsi sözleşmedeki şemayla doğrular; sunucunun alan hataları alanların altına basılır.
 */

/** Ortak form kabuğu. */
function FormDialog({ title, formId, busy, onClose, submitLabel, serverError, children, size = 'md', submitDisabled = false }) {
  return (
    <Modal
      open
      size={size}
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} icon="check" disabled={busy || submitDisabled}>
            {busy ? 'Kaydediliyor…' : submitLabel}
          </Button>
        </>
      }
    >
      {serverError && (
        <Alert tone="danger" title="Yapılmadı" className="mb-4">
          {serverError.message}
        </Alert>
      )}
      {children}
    </Modal>
  );
}

/** Ortak gönderim: şemayla doğrula → istek → tazele → kapat. */
function useDialogSubmit({ schema, request, success, onClose }) {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const mutation = useMutation({
    mutationFn: request,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess(success);
      onClose();
    },
    onError: (error) => {
      setServerError(error);
      if (error.details?.fields) setErrors(error.details.fields);
    },
  });
  const submit = (body) => {
    const checked = schema ? validateWith(schema, body) : { ok: true, data: body };
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setServerError(null);
    mutation.mutate(checked.data);
  };
  return { submit, errors, serverError, busy: mutation.isPending };
}

/** @param {{ employee: any, onClose: () => void }} props */
export function IncentiveDialog({ employee, onClose }) {
  const [values, setValues] = useState({ code: '', label: '', method: 'MIN_WAGE_EMPLOYER_SHARE', points: '', amount: '', validFrom: '', validTo: '' });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const { submit, errors, serverError, busy } = useDialogSubmit({ schema: incentiveSchema, request: (body) => apiPost(`/payroll/employees/${employee.id}/incentives`, body), success: 'Teşvik eklendi', onClose });
  return (
    <FormDialog title="Teşvik ekle" formId="incentive-form" busy={busy} onClose={onClose} submitLabel="Ekle" serverError={serverError}>
      <form
        id="incentive-form"
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ ...values, points: values.points || null, amount: values.amount || null, validTo: values.validTo || null });
        }}
      >
        <Input label="Teşvik kodu" placeholder="6111, 7103…" value={values.code} onChange={set('code')} error={errors.code} />
        <Input label="Açıklama" value={values.label} onChange={set('label')} error={errors.label} />
        <Select label="Hesap" options={INCENTIVE_METHODS.map((value) => ({ value, label: INCENTIVE_METHOD_LABELS[value] }))} value={values.method} onChange={set('method')} error={errors.method} className="sm:col-span-2" />
        {values.method === 'TREASURY_POINTS' && <Input label="Puan" inputMode="decimal" value={values.points} onChange={set('points')} error={errors.points} />}
        {values.method === 'FIXED_AMOUNT' && <Input label="Aylık tutar" inputMode="decimal" value={values.amount} onChange={set('amount')} error={errors.amount} />}
        <Input label="Başlangıç" type="date" value={values.validFrom} onChange={set('validFrom')} error={errors.validFrom} />
        <Input label="Bitiş (boşsa süresiz)" type="date" value={values.validTo} onChange={set('validTo')} error={errors.validTo} />
        <p className="text-xs text-ink-muted sm:col-span-2">Teşvikli ayda 5510 Hazine indirimi ayrıca uygulanmaz; bir ayda tek teşvik geçerlidir.</p>
      </form>
    </FormDialog>
  );
}

/** @param {{ employee: any, today: string, onClose: () => void }} props */
export function AdvanceDialog({ employee, today, onClose }) {
  const can = useCan();
  const canPay = can(PERMISSIONS.PAYROLL_PAY) && can(PERMISSIONS.ACCOUNTING_VIEW);
  const [values, setValues] = useState({ amount: '', paidOn: today, installments: '1', firstMonth: today.slice(0, 7), treasuryAccountId: '', note: '' });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const accounts = useQuery({ queryKey: ['accounting', 'treasury', 'payroll-picker'], queryFn: () => api(withQuery('/accounting/treasury', { pageSize: 100, page: 1 })), enabled: canPay });
  const { submit, errors, serverError, busy } = useDialogSubmit({ schema: advanceSchema, request: (body) => apiPost(`/payroll/employees/${employee.id}/advances`, body), success: 'Avans kaydedildi', onClose });
  const installment = Number(values.amount) > 0 && Number(values.installments) > 0 ? Math.ceil((Number(values.amount) / Number(values.installments)) * 100) / 100 : null;
  return (
    <FormDialog title={`Avans: ${employee.name}`} formId="advance-form" busy={busy} onClose={onClose} submitLabel="Kaydet" serverError={serverError}>
      <form
        id="advance-form"
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ amount: values.amount, paidOn: values.paidOn, installments: values.installments, firstYear: values.firstMonth.slice(0, 4), firstMonth: values.firstMonth.slice(5, 7), treasuryAccountId: values.treasuryAccountId || null, note: values.note || null });
        }}
      >
        <Input label="Tutar" inputMode="decimal" value={values.amount} onChange={set('amount')} error={errors.amount} />
        <Input label="Ödeme günü" type="date" value={values.paidOn} onChange={set('paidOn')} error={errors.paidOn} />
        <Input label="Taksit" inputMode="numeric" value={values.installments} onChange={set('installments')} error={errors.installments} />
        <Input label="İlk mahsup ayı" type="month" value={values.firstMonth} onChange={set('firstMonth')} error={errors.firstMonth ?? errors.firstYear} />
        {canPay && (
          <Select
            label="Ödendiği hesap (muhasebe kaydı)"
            options={[{ value: '', label: 'Muhasebeye işleme (elle kayıtlı)' }, ...(accounts.data?.items ?? []).filter((row) => row.isActive).map((row) => ({ value: row.id, label: `${row.name} (${row.currency})` }))]}
            value={values.treasuryAccountId}
            onChange={set('treasuryAccountId')}
            error={errors.treasuryAccountId}
            className="sm:col-span-2"
          />
        )}
        <Input label="Not" value={values.note} onChange={set('note')} error={errors.note} className="sm:col-span-2" />
        {installment && <p className="text-xs text-ink-muted sm:col-span-2">Aylık mahsup en fazla {formatMoney(installment)}; son taksit kalanı alır. Net yetmezse kalan sonraki aya kalır.</p>}
      </form>
    </FormDialog>
  );
}

/** @param {{ employee: any, onClose: () => void }} props */
export function GarnishmentDialog({ employee, onClose }) {
  const [values, setValues] = useState({ type: 'ICRA', fileNumber: '', authority: '', creditor: '', notifiedOn: '', totalAmount: '', monthlyAmount: '', rate: '0.25', note: '' });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const { submit, errors, serverError, busy } = useDialogSubmit({ schema: garnishmentSchema, request: (body) => apiPost(`/payroll/employees/${employee.id}/garnishments`, body), success: 'Kesinti kaydı açıldı', onClose });
  const icra = values.type === 'ICRA';
  return (
    <FormDialog title={`İcra / nafaka: ${employee.name}`} formId="garnishment-form" busy={busy} onClose={onClose} submitLabel="Kaydet" serverError={serverError}>
      <form
        id="garnishment-form"
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ ...values, totalAmount: icra ? values.totalAmount || null : null, monthlyAmount: icra ? null : values.monthlyAmount || null, rate: icra ? values.rate || null : null, note: values.note || null });
        }}
      >
        <Select label="Tür" options={GARNISHMENT_TYPES.map((value) => ({ value, label: GARNISHMENT_TYPE_LABELS[value] }))} value={values.type} onChange={set('type')} />
        <Input label="Dosya no" value={values.fileNumber} onChange={set('fileNumber')} error={errors.fileNumber} />
        <Input label={icra ? 'İcra dairesi' : 'Mahkeme'} value={values.authority} onChange={set('authority')} error={errors.authority} />
        <Input label="Alacaklı" value={values.creditor} onChange={set('creditor')} error={errors.creditor} />
        <Input label="Tebliğ günü" type="date" value={values.notifiedOn} onChange={set('notifiedOn')} error={errors.notifiedOn} />
        {icra ? (
          <>
            <Input label="Borç tutarı" inputMode="decimal" value={values.totalAmount} onChange={set('totalAmount')} error={errors.totalAmount} />
            <Input label="Kesinti oranı (net ücretin)" inputMode="decimal" value={values.rate} onChange={set('rate')} error={errors.rate} />
          </>
        ) : (
          <Input label="Aylık nafaka" inputMode="decimal" value={values.monthlyAmount} onChange={set('monthlyAmount')} error={errors.monthlyAmount} />
        )}
        <Input label="Not" value={values.note} onChange={set('note')} error={errors.note} className="sm:col-span-2" />
        <p className="text-xs text-ink-muted sm:col-span-2">Nafaka önce kesilir. İcra dosyaları tebliğ sırasıyla, aynı anda yalnız ilki kesilir (net ücretin en az dörtte biri). Kesinti bordro onayında kesinleşir ve dosyanın carisine aktarılır.</p>
      </form>
    </FormDialog>
  );
}

/** @param {{ employee: any, year: number, onClose: () => void }} props */
export function OpeningDialog({ employee, year, onClose }) {
  const existing = employee.openings?.find((row) => row.year === year);
  const [values, setValues] = useState({ year: String(year), gvCumulative: existing?.gvCumulative ?? '', minWageCumulative: existing?.minWageCumulative ?? '', note: existing?.note ?? '' });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const { submit, errors, serverError, busy } = useDialogSubmit({ schema: payrollOpeningSchema, request: (body) => apiPut('/payroll/openings', body), success: 'Matrah devri kaydedildi', onClose });
  return (
    <FormDialog title="Yıl içi matrah devri" formId="opening-form" busy={busy} onClose={onClose} submitLabel="Kaydet" serverError={serverError}>
      <form
        id="opening-form"
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ ...values, employeeId: employee.id, note: values.note || null });
        }}
      >
        <Input label="Yıl" inputMode="numeric" value={values.year} onChange={set('year')} error={errors.year} />
        <span />
        <Input label="Birikmiş GV matrahı" inputMode="decimal" value={values.gvCumulative} onChange={set('gvCumulative')} error={errors.gvCumulative} />
        <Input label="Birikmiş asgari ücret matrahı" inputMode="decimal" value={values.minWageCumulative} onChange={set('minWageCumulative')} error={errors.minWageCumulative} />
        <Input label="Not" value={values.note} onChange={set('note')} error={errors.note} className="sm:col-span-2" />
        <p className="text-xs text-ink-muted sm:col-span-2">Sisteme yıl ortasında geçildiyse bu işverende yıl başından beri oluşan matrahlar (eski programın son bordrosundan). O yılın ilk bordrosu onaylanınca değişmez.</p>
      </form>
    </FormDialog>
  );
}

/** @param {{ employee: any, today: string, onClose: () => void }} props */
export function TerminationDialog({ employee, today, onClose }) {
  const [values, setValues] = useState({ terminationDate: today, reasonCode: '04', severanceEligible: true, noticeMode: 'EMPLOYER_PAYS', unusedLeaveDays: '0', severanceBase: '', overrideReason: '' });
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const body = { ...values, severanceBase: values.severanceBase || null, overrideReason: values.overrideReason || null };
  const { submit, errors, serverError, busy } = useDialogSubmit({ schema: terminationSchema, request: (input) => apiPost(`/payroll/employees/${employee.id}/termination`, input), success: 'İşten çıkış yapıldı; haklar çıkış ayının bordrosuna eklendi', onClose });

  /** Neden değişince varsayılan haklar gelir. */
  const pickReason = (event) => {
    const defaults = terminationDefaults(event.target.value);
    setValues((current) => ({ ...current, reasonCode: event.target.value, severanceEligible: defaults.severance, noticeMode: defaults.notice ? 'EMPLOYER_PAYS' : 'NONE' }));
  };
  const key = JSON.stringify(body);
  useEffect(() => {
    const checked = validateWith(terminationSchema, body);
    if (!checked.ok) return setPreview(null);
    let alive = true;
    const timer = setTimeout(() => {
      apiPost(`/payroll/employees/${employee.id}/termination/preview`, checked.data)
        .then((data) => alive && (setPreview(data), setPreviewError(null)))
        .catch((error) => alive && (setPreview(null), setPreviewError(error)));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, employee.id]);
  return (
    <FormDialog title={`İşten çıkış: ${employee.name}`} size="lg" formId="termination-form" busy={busy} onClose={onClose} submitLabel="Çıkışı yap" serverError={serverError}>
      <form
        id="termination-form"
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit(body);
        }}
      >
        <Input label="Çıkış günü (son çalışılan gün)" type="date" value={values.terminationDate} onChange={set('terminationDate')} error={errors.terminationDate} />
        <Select label="Çıkış nedeni (SGK kodu)" options={TERMINATION_REASON_CODES.map((code) => ({ value: code, label: `${code} · ${TERMINATION_REASONS[code].label}` }))} value={values.reasonCode} onChange={pickReason} error={errors.reasonCode} />
        <Checkbox label="Kıdem tazminatı hakkı var" checked={values.severanceEligible} onChange={set('severanceEligible')} />
        <Select label="İhbar" options={NOTICE_MODES.map((value) => ({ value, label: NOTICE_MODE_LABELS[value] }))} value={values.noticeMode} onChange={set('noticeMode')} error={errors.noticeMode} />
        <Input label="Kullanılmayan yıllık izin (gün)" inputMode="decimal" value={values.unusedLeaveDays} onChange={set('unusedLeaveDays')} error={errors.unusedLeaveDays} />
        <Input label="Kıdeme esas giydirilmiş brüt (boşsa ücret)" inputMode="decimal" value={values.severanceBase} onChange={set('severanceBase')} error={errors.severanceBase} />
        <Textarea label="Varsayılandan farklı seçimin gerekçesi" rows={2} value={values.overrideReason} onChange={set('overrideReason')} error={errors.overrideReason} className="sm:col-span-2" />
      </form>
      {previewError && (
        <Alert tone="warning" title="Hesaplanamadı" className="mt-4">
          {previewError.message}
        </Alert>
      )}
      {preview && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-control bg-surface-muted p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-muted">Hizmet süresi</dt>
            <dd className="font-semibold text-ink">
              {preview.service.years} yıl {preview.service.months} ay {preview.service.days} gün
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Kıdeme esas (tavan {formatMoney(preview.severanceCeiling)})</dt>
            <dd className="font-semibold text-ink tabular-nums">{formatMoney(preview.severanceBase)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Kıdem tazminatı</dt>
            <dd className="font-semibold text-ink tabular-nums">{formatMoney(preview.severanceAmount)}</dd>
            {values.severanceEligible && !preview.severanceEligibleByService && <dd className="text-xs text-sec-strong">Bir yıldan kısa hizmet: kıdem doğmaz</dd>}
          </div>
          <div>
            <dt className="text-xs text-ink-muted">İhbar ({preview.noticeWeeks} hafta)</dt>
            <dd className="font-semibold text-ink tabular-nums">
              {preview.noticeMode === 'EMPLOYEE_PAYS' ? '−' : ''}
              {formatMoney(preview.noticeAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">İzin ücreti</dt>
            <dd className="font-semibold text-ink tabular-nums">{formatMoney(preview.leaveAmount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Aylık brüt (dayanak)</dt>
            <dd className="font-semibold text-ink tabular-nums">{formatMoney(preview.grossSalary)}</dd>
          </div>
          <p className="col-span-full text-xs text-ink-muted">Tutarlar brüttür; vergi ve kesintiler çıkış ayının bordrosunda hesaplanır (kıdemden yalnız damga vergisi).</p>
        </dl>
      )}
    </FormDialog>
  );
}

/** Gerekçeli kapatma (avans iptali, icra / nafaka kapatma). @param {{ title: string, url: string, success: string, onClose: () => void }} props */
export function ReasonDialog({ title, url, success, onClose }) {
  const [reason, setReason] = useState('');
  const { submit, errors, serverError, busy } = useDialogSubmit({ schema: null, request: (body) => apiPost(url, body), success, onClose });
  return (
    <FormDialog title={title} formId="reason-form" busy={busy} onClose={onClose} submitLabel="Onayla" serverError={serverError} submitDisabled={reason.trim().length < 3}>
      <form
        id="reason-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit({ reason });
        }}
      >
        <Textarea label="Gerekçe" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} error={errors.reason} />
      </form>
    </FormDialog>
  );
}
