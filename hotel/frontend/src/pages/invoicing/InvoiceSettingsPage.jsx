import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EDOC_ENVIRONMENT_LABELS, TEST_TAXPAYER_BEHAVIORS, TEST_TAXPAYER_BEHAVIOR_LABELS, invoiceSettingsSchema, testTaxpayerSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiDelete, apiPost, apiPut } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { invoiceKeys } from '../../lib/invoicing.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const EMPTY = {
  legalName: '',
  taxNumber: '',
  taxOffice: '',
  mersisNo: '',
  tradeRegistryNo: '',
  street: '',
  district: '',
  city: '',
  postalCode: '',
  country: 'Türkiye',
  phone: '',
  email: '',
  website: '',
  eFaturaPrefix: '',
  eArsivPrefix: '',
  provider: 'TEST',
  environment: 'TEST',
  senderAlias: '',
  autoDraft: true,
  footerNote: '',
  bankInfo: '',
};

/**
 * Fatura ayarları (modül 16 / 49): satıcı (otelin işletmesi), e-Fatura ve e-Arşiv serileri, otomatik taslak,
 * entegratör ve ortam, otelin vergilerinin GİB vergi koduna eşlenmesi; test ortamının mükellef listesi.
 */
export function InvoiceSettingsPage() {
  const query = useQuery({ queryKey: invoiceKeys.settings, queryFn: () => api('/invoices/settings') });
  if (!query.data) return <QueryFallback query={query} errorTitle="Fatura ayarları yüklenemedi" />;
  return (
    <div className="flex flex-col gap-6">
      <SettingsForm key={query.data.settings?.updatedAt ?? 'yeni'} data={query.data} />
      <TestTaxpayers data={query.data} />
    </div>
  );
}

/** @param {{ data: any }} props */
function SettingsForm({ data }) {
  const queryClient = useQueryClient();
  const start = { ...EMPTY, startDate: data.today, ...Object.fromEntries(Object.entries(data.settings ?? {}).map(([key, value]) => [key, value ?? (typeof EMPTY[key] === 'boolean' ? EMPTY[key] : '')])) };
  const [form, setForm] = useState(start);
  const [codes, setCodes] = useState(() => Object.fromEntries(data.taxes.map((tax) => [tax.id, tax.code ?? tax.suggested ?? ''])));
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: (body) => apiPut('/invoices/settings', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      toastSuccess('Fatura ayarları kaydedildi');
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
    },
  });
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  function submit(event) {
    event.preventDefault();
    const body = {
      ...form,
      expectedUpdatedAt: data.settings?.updatedAt ?? null,
      taxCodes: Object.entries(codes)
        .filter(([, code]) => code)
        .map(([taxId, code]) => ({ taxId, code })),
    };
    delete body.updatedAt;
    delete body.updatedBy;
    const checked = validateWith(invoiceSettingsSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    if (checked.data.startDate > data.today) return setErrors({ startDate: 'Faturalama başlangıcı bugünden sonra olamaz' });
    setErrors({});
    save.mutate(checked.data);
  }
  const busy = save.isPending;
  const field = (name, label, props = {}) => <Input label={label} value={form[name] ?? ''} onChange={set(name)} error={errors[name]} disabled={busy} {...props} />;
  const unmapped = data.taxes.filter((tax) => !codes[tax.id]);
  const startMovesForward = Boolean(data.settings && form.startDate && form.startDate > data.settings.startDate);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {!data.settings && (
        <Alert tone="info" title="Fatura ayarları girilmemiş">
          Satıcı bilgileri, seriler, faturalama başlangıcı ve vergi kodları girilmeden taslak açılmaz, fatura kesilmez; faturalanacaklar listesi de boş kalır.
        </Alert>
      )}
      <Card title="Satıcı" description="Faturada satıcı olarak görünen işletme: ünvan, vergi kimliği, adres. e-Fatura başvurusundaki bilgilerle aynı olmalı.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('legalName', 'Ünvan', { className: 'sm:col-span-2' })}
          {field('taxNumber', 'Vergi no (şahıs işletmesinde TC kimlik no)', { inputMode: 'numeric' })}
          {field('taxOffice', 'Vergi dairesi')}
          {field('mersisNo', 'MERSİS no', { inputMode: 'numeric' })}
          {field('tradeRegistryNo', 'Ticaret sicil no')}
          {field('street', 'Adres', { className: 'sm:col-span-2' })}
          {field('district', 'İlçe')}
          {field('city', 'İl')}
          {field('postalCode', 'Posta kodu')}
          {field('country', 'Ülke')}
          {field('phone', 'Telefon')}
          {field('email', 'E-posta', { type: 'email' })}
          {field('website', 'Web sitesi')}
        </div>
      </Card>

      <Card title="Seriler, başlangıç ve taslak" description="Numara: seri (3 karakter) + yıl + 9 haneli sıra; e-Fatura ve e-Arşiv ayrı seri. Sıra yıl başında 1'den başlar, kesimde boşluksuz ilerler.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input label="Faturalama başlangıcı (bu günden önce kapananlar önceki sistemde faturalanmış sayılır)" type="date" max={data.today} value={form.startDate ?? ''} onChange={set('startDate')} error={errors.startDate} disabled={busy} className="sm:max-w-xs" />
            {startMovesForward && (
              <p className="mt-1.5 text-xs text-warning-ink">
                Başlangıç ileri alınıyor: {formatDate(data.settings.startDate)} ile {formatDate(form.startDate)} arasında kapanıp faturası kesilmemiş folyo ve etkinlikler faturalanacaklar listesinden çıkar.
              </p>
            )}
          </div>
          {field('eFaturaPrefix', 'e-Fatura serisi (ör. FTR → FTR2026000000001)', { maxLength: 3 })}
          {field('eArsivPrefix', 'e-Arşiv serisi (ör. EAR → EAR2026000000001)', { maxLength: 3 })}
          {field('footerNote', 'Fatura notu (her faturada)', { className: 'sm:col-span-2' })}
          <Textarea label="Banka bilgisi (faturada)" rows={2} className="sm:col-span-2" value={form.bankInfo ?? ''} onChange={set('bankInfo')} error={errors.bankInfo} disabled={busy} />
        </div>
        <div className="mt-3">
          <Checkbox name="invoice-auto-draft" label="Folyo kapanınca fatura taslağı kendiliğinden açılsın" checked={form.autoDraft} onChange={(event) => setForm((current) => ({ ...current, autoDraft: event.target.checked }))} disabled={busy} />
        </div>
        {data.issuedCount > 0 && <p className="mt-2 text-xs text-ink-muted">Seri değişirse yeni seri 1'den başlar; eski seriyle kesilmiş {data.issuedCount} fatura değişmez.</p>}
      </Card>

      <Card title="Entegratör" description="Faturalar özel entegratör üzerinden GİB'e gider. Gerçek entegratör adaptörü eklenince canlı ortam açılır.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Entegratör" options={data.providers.map((provider) => ({ value: provider.name, label: provider.label }))} value={form.provider} onChange={set('provider')} disabled={busy} />
          <Select
            label="Ortam"
            options={[
              { value: 'TEST', label: EDOC_ENVIRONMENT_LABELS.TEST },
              { value: 'LIVE', label: `${EDOC_ENVIRONMENT_LABELS.LIVE} (gerçek entegratör gerekir)` },
            ]}
            value={form.environment}
            onChange={set('environment')}
            error={errors.environment}
            disabled={busy}
          />
          {field('senderAlias', 'Gönderici birim etiketi (entegratör verir)', { placeholder: 'urn:mail:defaultgb@…' })}
        </div>
      </Card>

      <Card title="Vergi kodları" description="Otelin vergi satırları GİB vergi koduna eşlenir: KDV 0015, konaklama vergisi 0059. Eşlenmemiş vergi taşıyan satır faturalanamaz.">
        {data.taxes.length === 0 ? (
          <p className="text-sm text-ink-muted">Otelde tanımlı vergi yok (Ayarlar → Vergiler).</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2">Vergi</th>
                <th className="py-2">Oran</th>
                <th className="py-2">Fiyata</th>
                <th className="py-2">GİB kodu</th>
              </tr>
            </thead>
            <tbody>
              {data.taxes.map((tax) => (
                <tr key={tax.id} className="border-b border-line">
                  <td className="py-2 font-semibold">{tax.name}</td>
                  <td className="py-2 tabular-nums">%{tax.rate}</td>
                  <td className="py-2">{tax.isIncluded ? 'dahil' : 'hariç'}</td>
                  <td className="py-2">
                    <Select
                      aria-label={`${tax.name} GİB kodu`}
                      compact
                      options={[{ value: '', label: 'Eşlenmedi' }, ...data.taxCodes.map((row) => ({ value: row.code, label: `${row.code} · ${row.name}` }))]}
                      value={codes[tax.id] ?? ''}
                      onChange={(event) => setCodes((current) => ({ ...current, [tax.id]: event.target.value }))}
                      disabled={busy}
                      className="w-56"
                    />
                    {!tax.code && tax.suggested && <span className="ml-1 text-xs text-ink-muted">önerilen</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {unmapped.length > 0 && <p className="mt-2 text-xs text-sec-strong">Eşlenmemiş: {unmapped.map((tax) => tax.name).join(', ')}</p>}
        {errors.taxCodes && <p className="mt-2 text-xs font-semibold text-sec-strong">{errors.taxCodes}</p>}
      </Card>

      <div>
        <Button type="submit" icon="check" disabled={busy}>
          {busy ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
      </div>
    </form>
  );
}

const EMPTY_TAXPAYER = { taxNumber: '', title: '', alias: '', behavior: 'ACCEPT' };

/** Test ortamının mükellef listesi: listede olan vergi no e-Fatura alıcısıdır; davranışı GİB cevabını belirler. @param {{ data: any }} props */
function TestTaxpayers({ data }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_TAXPAYER);
  const [editing, setEditing] = useState(null);
  const [errors, setErrors] = useState({});
  const done = (message) => () => {
    queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
    toastSuccess(message);
    setForm(EMPTY_TAXPAYER);
    setEditing(null);
  };
  const save = useMutation({
    mutationFn: (body) => (editing ? apiPut(`/invoices/settings/test-taxpayers/${editing}`, body) : apiPost('/invoices/settings/test-taxpayers', body)),
    onSuccess: done('Test mükellefi kaydedildi'),
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
    },
  });
  const remove = useMutation({ mutationFn: (id) => apiDelete(`/invoices/settings/test-taxpayers/${id}`), onSuccess: done('Test mükellefi silindi'), onError: (error) => toastError(error.message) });
  if (data.settings?.provider !== 'TEST') return null;
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(testTaxpayerSchema, form);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  }
  const busy = save.isPending || remove.isPending;
  return (
    <Card title="Test ortamı mükellefleri" description="Benzetimin GİB kayıtlı kullanıcı listesi: buradaki vergi no e-Fatura mükellefi sayılır (posta kutusu etiketiyle); listede olmayan herkes e-Arşiv alıcısıdır.">
      {data.testTaxpayers.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2 text-sm">
          {data.testTaxpayers.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-item border border-line px-3 py-2">
              <span>
                <span className="font-semibold">{row.title}</span> · <span className="tabular-nums">{row.taxNumber}</span>
                <span className="block text-xs text-ink-muted">{row.alias}</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={row.behavior === 'ACCEPT' ? 'success' : 'warning'}>{TEST_TAXPAYER_BEHAVIOR_LABELS[row.behavior]}</Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon="pencil"
                  onClick={() => {
                    setEditing(row.id);
                    setForm({ taxNumber: row.taxNumber, title: row.title, alias: row.alias, behavior: row.behavior });
                  }}
                  disabled={busy}
                >
                  Düzenle
                </Button>
                <Button type="button" size="sm" variant="ghost" icon="trash" onClick={() => remove.mutate(row.id)} disabled={busy}>
                  Sil
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Input label="Vergi no" inputMode="numeric" value={form.taxNumber} onChange={(event) => setForm((current) => ({ ...current, taxNumber: event.target.value }))} error={errors.taxNumber} disabled={busy} />
        <Input label="Ünvan" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} error={errors.title} disabled={busy} />
        <Input label="Posta kutusu etiketi" placeholder="urn:mail:defaultpk@…" value={form.alias} onChange={(event) => setForm((current) => ({ ...current, alias: event.target.value }))} error={errors.alias} disabled={busy} />
        <Select
          label="Benzetimde GİB"
          options={TEST_TAXPAYER_BEHAVIORS.map((value) => ({ value, label: TEST_TAXPAYER_BEHAVIOR_LABELS[value] }))}
          value={form.behavior}
          onChange={(event) => setForm((current) => ({ ...current, behavior: event.target.value }))}
          disabled={busy}
        />
        <div className="flex gap-2 sm:col-span-4">
          <Button type="submit" size="sm" icon={editing ? 'check' : 'plus'} disabled={busy}>
            {editing ? 'Kaydet' : 'Ekle'}
          </Button>
          {editing && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(null);
                setForm(EMPTY_TAXPAYER);
              }}
              disabled={busy}
            >
              Vazgeç
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
