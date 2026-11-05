import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollParameterSetSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Input } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPost, apiPut } from '../../lib/api.js';
import { payrollKeys } from '../../lib/payroll.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';

/** Oran gösterimi (0.14 → 14) ve geri dönüşü. */
const toPercent = (value) => (value === '' || value === null || value === undefined ? '' : String(Number((Number(value) * 100).toFixed(4))));
const fromPercent = (value) => (value === '' ? '' : String(Number((Number(String(value).replace(',', '.')) / 100).toFixed(5))));

/**
 * Yasal parametre seti ekle / düzelt (modül 51). Oranlar yüzde girilir, set kayıtta teyitsiz olur (yeniden teyit
 * gerekir). Onaylı bordronun seti değişmez: yeni yürürlük tarihli set eklenir.
 *
 * @param {{ set?: any, template?: any, onClose: () => void }} props
 */
export function ParameterSetDialog({ set = null, template = null, onClose }) {
  const queryClient = useQueryClient();
  const base = set ?? template;
  const values0 = base?.values;
  const [form, setForm] = useState(() => ({
    validFrom: set?.validFrom ?? '',
    label: set?.label ?? '',
    minWageGross: values0?.minWageGross ?? '',
    sgkFloorDaily: values0?.sgkFloorDaily ?? '',
    sgkCeilingDaily: values0?.sgkCeilingDaily ?? '',
    normalEmployeeSgk: toPercent(values0?.rates?.NORMAL?.employeeSgk),
    normalEmployeeUnemployment: toPercent(values0?.rates?.NORMAL?.employeeUnemployment),
    normalEmployerSgk: toPercent(values0?.rates?.NORMAL?.employerSgk),
    normalEmployerUnemployment: toPercent(values0?.rates?.NORMAL?.employerUnemployment),
    retiredEmployeeSgk: toPercent(values0?.rates?.RETIRED?.employeeSgk),
    retiredEmployerSgk: toPercent(values0?.rates?.RETIRED?.employerSgk),
    treasuryGeneral: values0?.treasuryPoints?.GENERAL ?? '',
    treasuryManufacturing: values0?.treasuryPoints?.MANUFACTURING ?? '',
    stampDutyPermille: values0 ? String(Number((Number(values0.stampDutyRate) * 1000).toFixed(3))) : '',
    brackets: (values0?.taxBrackets ?? [{ upTo: '', rate: '0.15' }, { upTo: null, rate: '0.40' }]).map((row) => ({ upTo: row.upTo ?? '', rate: toPercent(row.rate) })),
    disability1: values0?.disability?.['1'] ?? '',
    disability2: values0?.disability?.['2'] ?? '',
    disability3: values0?.disability?.['3'] ?? '',
    mealGvDaily: values0?.mealGvDaily ?? '',
    mealSgkDaily: values0?.mealSgkDaily ?? '',
    transportGvDaily: values0?.transportGvDaily ?? '',
    severanceCeiling: values0?.severanceCeiling ?? '',
    besPercent: toPercent(values0?.besRate ?? '0.03'),
    sources: base?.sources ?? [],
  }));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const field = (key) => ({ value: form[key], onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })), inputMode: 'decimal' });
  const save = useMutation({
    mutationFn: (body) => (set ? apiPut(`/payroll/parameters/${set.id}`, body) : apiPost('/payroll/parameters', body)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess('Parametre seti kaydedildi; teyit edilene kadar onaya gidecek bordro hesaplanamaz');
      onClose();
    },
    onError: setServerError,
  });
  const submit = (event) => {
    event.preventDefault();
    const body = {
      validFrom: form.validFrom,
      label: form.label,
      sources: form.sources,
      values: {
        minWageGross: form.minWageGross,
        sgkFloorDaily: form.sgkFloorDaily,
        sgkCeilingDaily: form.sgkCeilingDaily,
        rates: {
          NORMAL: { employeeSgk: fromPercent(form.normalEmployeeSgk), employeeUnemployment: fromPercent(form.normalEmployeeUnemployment), employerSgk: fromPercent(form.normalEmployerSgk), employerUnemployment: fromPercent(form.normalEmployerUnemployment) },
          RETIRED: { employeeSgk: fromPercent(form.retiredEmployeeSgk), employeeUnemployment: '0', employerSgk: fromPercent(form.retiredEmployerSgk), employerUnemployment: '0' },
        },
        treasuryPoints: { GENERAL: form.treasuryGeneral, MANUFACTURING: form.treasuryManufacturing },
        stampDutyRate: form.stampDutyPermille === '' ? '' : String(Number((Number(form.stampDutyPermille) / 1000).toFixed(5))),
        taxBrackets: form.brackets.map((row, index) => ({ upTo: index === form.brackets.length - 1 ? null : row.upTo, rate: fromPercent(row.rate) })),
        disability: { 1: form.disability1, 2: form.disability2, 3: form.disability3 },
        mealGvDaily: form.mealGvDaily,
        mealSgkDaily: form.mealSgkDaily,
        transportGvDaily: form.transportGvDaily,
        severanceCeiling: form.severanceCeiling,
        besRate: fromPercent(form.besPercent),
      },
    };
    const checked = validateWith(payrollParameterSetSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  };
  const error = (path) => errors[path] ?? errors[`values.${path}`];
  const bracketRow = (row, index) => (
    <div key={index} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
      <Input label={index === form.brackets.length - 1 ? 'Üstü' : `${index + 1}. dilim üst sınırı`} disabled={index === form.brackets.length - 1} value={index === form.brackets.length - 1 ? '' : row.upTo} inputMode="decimal" onChange={(event) => setForm((current) => ({ ...current, brackets: current.brackets.map((item, at) => (at === index ? { ...item, upTo: event.target.value } : item)) }))} error={error(`taxBrackets.${index}.upTo`)} />
      <Input label="Oran %" value={row.rate} inputMode="decimal" onChange={(event) => setForm((current) => ({ ...current, brackets: current.brackets.map((item, at) => (at === index ? { ...item, rate: event.target.value } : item)) }))} error={error(`taxBrackets.${index}.rate`)} />
      <Button type="button" size="sm" variant="ghost" icon="trash" disabled={form.brackets.length <= 2} onClick={() => setForm((current) => ({ ...current, brackets: current.brackets.filter((_, at) => at !== index) }))}>
        Sil
      </Button>
    </div>
  );
  return (
    <Modal
      open
      size="xl"
      title={set ? `Düzelt: ${set.label}` : 'Yeni parametre seti'}
      onClose={save.isPending ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="parameter-form" icon="check" disabled={save.isPending}>
            Kaydet
          </Button>
        </>
      }
    >
      <form id="parameter-form" noValidate onSubmit={submit} className="flex flex-col gap-5">
        {serverError && <Alert tone="danger">{serverError.message}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Yürürlük günü" type="date" value={form.validFrom} onChange={(event) => setForm((current) => ({ ...current, validFrom: event.target.value }))} error={error('validFrom')} />
          <Input label="Ad" value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} error={error('label')} />
        </div>
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-bold text-ink">Asgari ücret ve SGK sınırları</legend>
          <Input label="Brüt asgari ücret (aylık)" {...field('minWageGross')} error={error('minWageGross')} />
          <Input label="SGK günlük taban" {...field('sgkFloorDaily')} error={error('sgkFloorDaily')} />
          <Input label="SGK günlük tavan" {...field('sgkCeilingDaily')} error={error('sgkCeilingDaily')} />
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-bold text-ink">Prim oranları (%)</legend>
          <Input label="İşçi SGK" {...field('normalEmployeeSgk')} error={error('rates.NORMAL.employeeSgk')} />
          <Input label="İşçi işsizlik" {...field('normalEmployeeUnemployment')} error={error('rates.NORMAL.employeeUnemployment')} />
          <Input label="İşveren SGK" {...field('normalEmployerSgk')} error={error('rates.NORMAL.employerSgk')} />
          <Input label="İşveren işsizlik" {...field('normalEmployerUnemployment')} error={error('rates.NORMAL.employerUnemployment')} />
          <Input label="Emekli: işçi SGDP" {...field('retiredEmployeeSgk')} error={error('rates.RETIRED.employeeSgk')} />
          <Input label="Emekli: işveren SGDP" {...field('retiredEmployerSgk')} error={error('rates.RETIRED.employerSgk')} />
          <Input label="Hazine indirimi (puan)" {...field('treasuryGeneral')} error={error('treasuryPoints.GENERAL')} />
          <Input label="Hazine indirimi imalat (puan)" {...field('treasuryManufacturing')} error={error('treasuryPoints.MANUFACTURING')} />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-bold text-ink">Gelir vergisi tarifesi (ücret, yıllık birikmiş matrah)</legend>
          {form.brackets.map(bracketRow)}
          <div>
            <Button type="button" size="sm" variant="outline" icon="plus" disabled={form.brackets.length >= 8} onClick={() => setForm((current) => ({ ...current, brackets: [...current.brackets.slice(0, -1), { upTo: '', rate: '' }, current.brackets.at(-1)] }))}>
              Dilim ekle
            </Button>
          </div>
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-bold text-ink">İstisna, indirim ve tavanlar</legend>
          <Input label="Damga vergisi (binde)" {...field('stampDutyPermille')} error={error('stampDutyRate')} />
          <Input label="Yemek GV günlük" {...field('mealGvDaily')} error={error('mealGvDaily')} />
          <Input label="Yemek SGK günlük" {...field('mealSgkDaily')} error={error('mealSgkDaily')} />
          <Input label="Yol GV günlük" {...field('transportGvDaily')} error={error('transportGvDaily')} />
          <Input label="Engellilik 1. derece (aylık)" {...field('disability1')} error={error('disability.1')} />
          <Input label="Engellilik 2. derece" {...field('disability2')} error={error('disability.2')} />
          <Input label="Engellilik 3. derece" {...field('disability3')} error={error('disability.3')} />
          <Input label="Kıdem tazminatı tavanı" {...field('severanceCeiling')} error={error('severanceCeiling')} />
          <Input label="BES oranı %" {...field('besPercent')} error={error('besRate')} />
        </fieldset>
        {form.sources.length > 0 && (
          <div className="text-xs text-ink-muted">
            <p className="font-semibold">Kaynaklar</p>
            <ul className="list-disc pl-4">
              {form.sources.map((source, index) => (
                <li key={index}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.label}</a> : source.label}</li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Modal>
  );
}
