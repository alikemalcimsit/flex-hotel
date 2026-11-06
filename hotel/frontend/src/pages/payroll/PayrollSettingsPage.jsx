import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAY_ELEMENT_EXEMPTION_LABELS, PAY_ELEMENT_EXEMPTIONS, PAY_ELEMENT_KIND_LABELS, PAY_ELEMENT_KINDS, PAYROLL_SECTOR_LABELS, PAYROLL_SECTORS, departmentSchema, payElementSchema, payrollSettingsSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Input, Select } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiDelete, apiPost, apiPut } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { payrollKeys } from '../../lib/payroll.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ParameterSetDialog } from './ParameterSetDialog.jsx';

/**
 * Bordro ayarları (modül 51): işyeri, yasal parametre setleri (hazır setleri yükleme, düzeltme, teyit), ödeme /
 * kesinti kalemleri, departmanlar. Görmek `payroll.view`, değiştirmek `payroll.setup`.
 */
export function PayrollSettingsPage() {
  const can = useCan();
  const canSetup = can(PERMISSIONS.PAYROLL_SETUP);
  return (
    <div className="flex flex-col gap-6">
      <ParametersCard canSetup={canSetup} />
      <div className="grid gap-6 xl:grid-cols-2">
        <WorkplaceCard canSetup={canSetup} />
        <DepartmentsCard canSetup={canSetup} />
      </div>
      <ElementsCard canSetup={canSetup} />
    </div>
  );
}

function useSave(request, success, onDone) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess(success);
      onDone?.();
    },
    onError: (error) => toastError(error.message),
  });
}

function ParametersCard({ canSetup }) {
  const query = useQuery({ queryKey: payrollKeys.parameters, queryFn: () => api('/payroll/parameters') });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const load = useSave(() => apiPost('/payroll/parameters/catalog', {}), 'Hazır setler yüklendi; teyit etmeyi unutmayın');
  const verify = useSave(({ id, verified }) => apiPost(`/payroll/parameters/${id}/verify`, { verified }), 'Teyit güncellendi');
  const remove = useSave((id) => apiDelete(`/payroll/parameters/${id}`), 'Set silindi', () => setDeleting(null));
  if (!query.isSuccess) return <QueryFallback query={query} errorTitle="Parametre setleri okunamadı" />;
  const { items, catalog } = query.data;
  return (
    <Card
      title="Yasal parametreler"
      description="Asgari ücret, SGK taban / tavan ve oranları, gelir vergisi tarifesi, istisnalar, kıdem tavanı. Bir ay, ayın son günü yürürlükte olan setle hesaplanır. Teyit edilmemiş setle hesaplanan bordro onaya gidemez."
      actions={
        canSetup && (
          <div className="flex flex-wrap gap-2">
            {catalog.length > 0 && (
              <Button type="button" size="sm" icon="download" disabled={load.isPending} onClick={() => load.mutate()}>
                Hazır setleri yükle ({catalog.length})
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => setEditing({ template: items[0] ?? null })}>
              Yeni set
            </Button>
          </div>
        )
      }
    >
      {items.length === 0 && (
        <Alert tone="warning" title="Parametre seti yok">
          Bordro hesaplanamaz. "Hazır setleri yükle" FlexAI'nin kaynaklı setlerini kopyalar; değerleri resmî metinle karşılaştırıp teyit edin.
        </Alert>
      )}
      {catalog.length > 0 && items.length > 0 && <p className="mb-3 text-sm text-ink-muted">Yüklenmemiş yeni hazır set var: {catalog.map((row) => row.label).join(', ')}.</p>}
      <ul className="flex flex-col">
        {items.map((set) => (
          <li key={set.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-0">
            <span className="flex flex-col">
              <span className="font-semibold text-ink">
                {set.label} <span className="font-normal text-ink-muted">· {formatDate(set.validFrom)}'den</span>
              </span>
              <span className="text-xs text-ink-muted">
                Asgari ücret {formatMoney(set.values.minWageGross)} · SGK tavan {formatMoney(Number(set.values.sgkCeilingDaily) * 30)} / ay · kıdem tavanı {formatMoney(set.values.severanceCeiling)}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {set.verifiedAt ? <Badge tone="success">Teyit: {set.verifiedBy}</Badge> : <Badge tone="warning">Teyit edilmedi</Badge>}
              {set.locked && <Badge tone="neutral">Onaylı bordroda kullanıldı</Badge>}
              <Button type="button" size="sm" variant="ghost" icon="eye" onClick={() => setEditing({ set, readOnly: !canSetup || set.locked })}>
                {canSetup && !set.locked ? 'Düzelt' : 'Gör'}
              </Button>
              {canSetup && (
                <Button type="button" size="sm" variant={set.verifiedAt ? 'ghost' : 'primary'} icon="check" disabled={verify.isPending || (set.locked && set.verifiedAt)} onClick={() => verify.mutate({ id: set.id, verified: !set.verifiedAt })}>
                  {set.verifiedAt ? 'Teyidi kaldır' : 'Teyit et'}
                </Button>
              )}
              {canSetup && !set.locked && (
                <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(set)}>
                  Sil
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {editing && (editing.readOnly ? <ParameterView set={editing.set} onClose={() => setEditing(null)} /> : <ParameterSetDialog set={editing.set} template={editing.template} onClose={() => setEditing(null)} />)}
      <ConfirmDialog open={Boolean(deleting)} title="Seti sil" message={`${deleting?.label ?? ''} silinir. Bir bordro bu setle hesaplandıysa silinmez.`} isPending={remove.isPending} onConfirm={() => remove.mutate(deleting.id)} onClose={() => setDeleting(null)} />
    </Card>
  );
}

/** Kilitli / salt okunur setin değerleri. */
function ParameterView({ set, onClose }) {
  const v = set.values;
  const pct = (value) => `%${(Number(value) * 100).toLocaleString('tr-TR', { maximumFractionDigits: 3 })}`;
  const rows = [
    ['Brüt asgari ücret', formatMoney(v.minWageGross)],
    ['SGK günlük taban / tavan', `${formatMoney(v.sgkFloorDaily)} / ${formatMoney(v.sgkCeilingDaily)}`],
    ['İşçi SGK + işsizlik', `${pct(v.rates.NORMAL.employeeSgk)} + ${pct(v.rates.NORMAL.employeeUnemployment)}`],
    ['İşveren SGK + işsizlik', `${pct(v.rates.NORMAL.employerSgk)} + ${pct(v.rates.NORMAL.employerUnemployment)}`],
    ['Emekli (SGDP) işçi / işveren', `${pct(v.rates.RETIRED.employeeSgk)} / ${pct(v.rates.RETIRED.employerSgk)}`],
    ['Hazine indirimi', `${Number(v.treasuryPoints.GENERAL).toLocaleString('tr-TR')} puan (imalat ${Number(v.treasuryPoints.MANUFACTURING).toLocaleString('tr-TR')})`],
    ['Gelir vergisi', v.taxBrackets.map((row) => `${row.upTo ? formatMoney(row.upTo) : 'üstü'} ${pct(row.rate)}`).join(' · ')],
    ['Damga vergisi', `binde ${(Number(v.stampDutyRate) * 1000).toLocaleString('tr-TR')}`],
    ['Yemek GV / SGK günlük', `${formatMoney(v.mealGvDaily)} / ${formatMoney(v.mealSgkDaily)}`],
    ['Yol GV günlük', formatMoney(v.transportGvDaily)],
    ['Engellilik (1 / 2 / 3)', `${formatMoney(v.disability['1'])} / ${formatMoney(v.disability['2'])} / ${formatMoney(v.disability['3'])}`],
    ['Kıdem tazminatı tavanı', formatMoney(v.severanceCeiling)],
    ['BES', pct(v.besRate)],
  ];
  return (
    <Modal open size="lg" title={set.label} onClose={onClose}>
      <dl className="flex flex-col text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-t border-line py-1.5 first:border-0">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {set.sources?.length > 0 && (
        <ul className="mt-4 list-disc pl-4 text-xs text-ink-muted">
          {set.sources.map((source, index) => (
            <li key={index}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.label}</a> : source.label}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function WorkplaceCard({ canSetup }) {
  const query = useQuery({ queryKey: payrollKeys.settings, queryFn: () => api('/payroll/settings') });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (query.isSuccess) setForm({ workplaceName: query.data.workplaceName ?? '', sgkWorkplaceNo: query.data.sgkWorkplaceNo ?? '', taxOffice: query.data.taxOffice ?? '', taxNumber: query.data.taxNumber ?? '', sector: query.data.sector, treasuryDiscount: query.data.treasuryDiscount });
  }, [query.isSuccess, query.data]);
  const save = useSave((body) => apiPut('/payroll/settings', body), 'İşyeri ayarları kaydedildi');
  if (!query.isSuccess || !form) return <QueryFallback query={query} errorTitle="Ayarlar okunamadı" />;
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const submit = (event) => {
    event.preventDefault();
    const checked = validateWith(payrollSettingsSchema, { ...form, expectedUpdatedAt: query.data.updatedAt });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  };
  return (
    <Card title="İşyeri" description="Bordro ve pusulada görünür; sektör Hazine indirimi puanını belirler.">
      <form noValidate onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Input label="İşyeri unvanı" value={form.workplaceName} onChange={set('workplaceName')} error={errors.workplaceName} disabled={!canSetup} />
        <Input label="SGK işyeri sicil no" value={form.sgkWorkplaceNo} onChange={set('sgkWorkplaceNo')} error={errors.sgkWorkplaceNo} disabled={!canSetup} />
        <Input label="Vergi dairesi" value={form.taxOffice} onChange={set('taxOffice')} error={errors.taxOffice} disabled={!canSetup} />
        <Input label="Vergi no" value={form.taxNumber} onChange={set('taxNumber')} error={errors.taxNumber} disabled={!canSetup} />
        <Select label="Sektör" options={PAYROLL_SECTORS.map((value) => ({ value, label: PAYROLL_SECTOR_LABELS[value] }))} value={form.sector} onChange={set('sector')} disabled={!canSetup} />
        <div className="pt-6">
          <Checkbox label="5510 Hazine indirimi uygulanır" hint="Teşviksiz, tüm sigorta kollarına tabi çalışanlara" checked={form.treasuryDiscount} onChange={set('treasuryDiscount')} disabled={!canSetup} />
        </div>
        {canSetup && (
          <div className="sm:col-span-2">
            <Button type="submit" icon="check" disabled={save.isPending}>
              Kaydet
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function DepartmentsCard({ canSetup }) {
  const query = useQuery({ queryKey: payrollKeys.departments, queryFn: () => api('/payroll/departments') });
  const [editing, setEditing] = useState(null);
  if (!query.isSuccess) return <QueryFallback query={query} errorTitle="Departmanlar okunamadı" />;
  return (
    <Card
      title="Departmanlar"
      actions={
        canSetup && (
          <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => setEditing({})}>
            Departman
          </Button>
        )
      }
    >
      {query.data.length === 0 ? (
        <p className="text-sm text-ink-muted">Departman yok; personel kartı için en az bir departman gerekir.</p>
      ) : (
        <ul className="flex flex-col text-sm">
          {query.data.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-0">
              <span>
                <span className="font-semibold text-ink">{row.name}</span> <span className="text-xs text-ink-muted">{row.code} · {row.employeeCount} kart{row.isActive ? '' : ' · kullanımda değil'}</span>
              </span>
              {canSetup && (
                <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(row)}>
                  Düzenle
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <SimpleDialog title={editing.id ? 'Departmanı düzenle' : 'Departman ekle'} schema={departmentSchema} initial={{ code: editing.code ?? '', name: editing.name ?? '', isActive: editing.isActive ?? true }} fields={[['code', 'Kod'], ['name', 'Ad']]} checkbox={['isActive', 'Kullanımda']} request={(body) => (editing.id ? apiPut(`/payroll/departments/${editing.id}`, body) : apiPost('/payroll/departments', body))} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ElementsCard({ canSetup }) {
  const query = useQuery({ queryKey: payrollKeys.elements, queryFn: () => api('/payroll/elements') });
  const [editing, setEditing] = useState(null);
  if (!query.isSuccess) return <QueryFallback query={query} errorTitle="Kalemler okunamadı" />;
  const flag = (value) => (value ? '✓' : '—');
  return (
    <Card
      title="Ödeme ve kesinti kalemleri"
      description="Sistem kalemleri kanunun davranışıyla gelir ve değişmez. Otelin kendi kalemi (çocuk yardımı, kira yardımı…) eklenir; SGK, gelir vergisi ve damga vergisine tabi olup olmadığı burada seçilir."
      actions={
        canSetup && (
          <Button type="button" size="sm" variant="outline" icon="plus" onClick={() => setEditing({})}>
            Kalem
          </Button>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1.5 pr-3">Kalem</th>
              <th className="py-1.5 pr-3">Tür</th>
              <th className="py-1.5 pr-3 text-center">SGK</th>
              <th className="py-1.5 pr-3 text-center">GV</th>
              <th className="py-1.5 pr-3 text-center">DV</th>
              <th className="py-1.5 pr-3">İstisna</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {query.data.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="py-2 pr-3">
                  <span className="font-semibold text-ink">{row.name}</span> <span className="text-xs text-ink-muted">{row.code}{row.system ? ' · sistem' : ''}{row.isActive ? '' : ' · kullanımda değil'}</span>
                </td>
                <td className="py-2 pr-3">{PAY_ELEMENT_KIND_LABELS[row.kind]}</td>
                <td className="py-2 pr-3 text-center">{flag(row.sgk)}</td>
                <td className="py-2 pr-3 text-center">{flag(row.gv)}</td>
                <td className="py-2 pr-3 text-center">{flag(row.dv)}</td>
                <td className="py-2 pr-3">{row.exemption === 'NONE' ? '—' : PAY_ELEMENT_EXEMPTION_LABELS[row.exemption]}</td>
                <td className="py-2 text-right">
                  {canSetup && !row.system && (
                    <Button type="button" size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(row)}>
                      Düzenle
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <SimpleDialog
          title={editing.id ? 'Kalemi düzenle' : 'Kalem ekle'}
          schema={payElementSchema}
          initial={{ code: editing.code ?? '', name: editing.name ?? '', kind: editing.kind ?? 'EARNING', sgk: editing.sgk ?? true, gv: editing.gv ?? true, dv: editing.dv ?? true, exemption: editing.exemption ?? 'NONE', isActive: editing.isActive ?? true }}
          fields={[['code', 'Kod', Boolean(editing.id)], ['name', 'Ad']]}
          selects={[
            ['kind', 'Tür', PAY_ELEMENT_KINDS.map((value) => ({ value, label: PAY_ELEMENT_KIND_LABELS[value] }))],
            ['exemption', 'İstisna', PAY_ELEMENT_EXEMPTIONS.map((value) => ({ value, label: PAY_ELEMENT_EXEMPTION_LABELS[value] }))],
          ]}
          checkboxes={[['sgk', 'SGK primine tabi'], ['gv', 'Gelir vergisine tabi'], ['dv', 'Damga vergisine tabi'], ['isActive', 'Kullanımda']]}
          request={(body) => (editing.id ? apiPut(`/payroll/elements/${editing.id}`, body) : apiPost('/payroll/elements', body))}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

/** Küçük ayar formu: metin alanları, seçimler, kutular. */
function SimpleDialog({ title, schema, initial, fields = [], selects = [], checkbox = null, checkboxes = [], request, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const save = useMutation({
    mutationFn: request,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payrollKeys.all });
      toastSuccess('Kaydedildi');
      onClose();
    },
    onError: setServerError,
  });
  const boxes = checkbox ? [checkbox, ...checkboxes] : checkboxes;
  const submit = (event) => {
    event.preventDefault();
    const checked = validateWith(schema, values);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  };
  return (
    <Modal
      open
      title={title}
      onClose={save.isPending ? () => {} : onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            Vazgeç
          </Button>
          <Button type="submit" form="simple-settings-form" icon="check" disabled={save.isPending}>
            Kaydet
          </Button>
        </>
      }
    >
      <form id="simple-settings-form" noValidate onSubmit={submit} className="flex flex-col gap-3">
        {serverError && <Alert tone="danger">{serverError.message}</Alert>}
        {fields.map(([key, label, disabled]) => (
          <Input key={key} label={label} value={values[key]} disabled={disabled} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} error={errors[key]} />
        ))}
        {selects.map(([key, label, options]) => (
          <Select key={key} label={label} options={options} value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} error={errors[key]} />
        ))}
        {boxes.map(([key, label]) => (
          <Checkbox key={key} label={label} checked={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.checked }))} />
        ))}
      </form>
    </Modal>
  );
}
