import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_SYNC_DAYS, PAYMENT_METHOD_LABELS, TREASURY_CHANNEL_LABELS, TREASURY_KIND_LABELS, TREASURY_METHOD_KIND, accountingSettingsSchema, accountingSyncSchema, treasuryMappingSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Input, Select } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { accountingKeys, monthStart } from '../../lib/accounting.js';
import { api, apiPost, apiPut } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * Muhasebe ayarları (modül 47): başlangıç günü ve ödeme fişi onay eşiği; ön büro / etkinlik / restoran tahsilatının
 * hangi kasaya / bankaya gireceği (yöntem × para birimi); aktör kapalıyken ya da eşleme eksikken kalan otomatik
 * kayıtların eşitlenmesi.
 */
export function AccountingSettingsPage() {
  const can = useCan();
  const canSetup = can(PERMISSIONS.ACCOUNTING_SETUP);
  const canManage = can(PERMISSIONS.ACCOUNTING_MANAGE);
  const query = useQuery({ queryKey: accountingKeys.settings, queryFn: () => api('/accounting/settings') });
  if (!query.data) return <QueryFallback query={query} errorTitle="Ayarlar yüklenemedi" />;
  return (
    <div className="flex flex-col gap-4">
      <SettingsCard data={query.data} canSetup={canSetup} />
      <MappingCard data={query.data} canSetup={canSetup} />
      {canManage && <SyncCard startDate={query.data.settings.startDate} />}
    </div>
  );
}

/** @param {{ data: any, canSetup: boolean }} props */
function SettingsCard({ data, canSetup }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({ startDate: data.settings.startDate, paymentApprovalAmount: data.settings.paymentApprovalAmount });
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: (body) => apiPut('/accounting/settings', body),
    onSuccess: (result) => {
      queryClient.setQueryData(accountingKeys.settings, result);
      queryClient.invalidateQueries({ queryKey: accountingKeys.all });
      setEditing(false);
      toastSuccess('Muhasebe ayarı kaydedildi');
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: accountingKeys.settings });
      toastError(error.message);
    },
  });
  function submit(event) {
    event.preventDefault();
    const body = { expectedUpdatedAt: data.settings.updatedAt, ...values };
    const checked = validateWith(accountingSettingsSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }
  return (
    <Card
      title="Başlangıç ve onay"
      description="Başlangıç gününden (dahil) sonraki tahsilat, mal kabul, prim ve etkinlik bedeli otomatik işlenir; öncesi için cari / kasa / banka açılış bakiyesi girilir. Ödeme fişi eşiğe eşit ya da üstündeyse başka bir yetkili onaylar."
      actions={
        canSetup &&
        !editing && (
          <Button type="button" size="sm" variant="outline" icon="pencil" onClick={() => setEditing(true)}>
            Düzenle
          </Button>
        )
      }
    >
      {editing ? (
        <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label="Başlangıç günü" type="date" max={data.today} value={values.startDate} onChange={(event) => setValues((current) => ({ ...current, startDate: event.target.value }))} error={errors.startDate} disabled={save.isPending} />
          <Input label={`Ödeme fişi onay eşiği (${data.currency}, 0 = onay yok)`} inputMode="decimal" value={values.paymentApprovalAmount} onChange={(event) => setValues((current) => ({ ...current, paymentApprovalAmount: event.target.value }))} error={errors.paymentApprovalAmount} disabled={save.isPending} />
          <div className="flex items-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={save.isPending}>
              Vazgeç
            </Button>
            <Button type="submit" icon="check" disabled={save.isPending}>
              {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <dt className="text-ink-muted">Başlangıç günü</dt>
          <dd className="font-semibold">{formatDate(data.settings.startDate)}</dd>
          <dt className="text-ink-muted">Ödeme fişi onay eşiği</dt>
          <dd className="font-semibold">{Number(data.settings.paymentApprovalAmount) ? formatMoney(data.settings.paymentApprovalAmount, data.currency) : 'Onay yok'}</dd>
        </dl>
      )}
    </Card>
  );
}

/** Eşleme tablosu: kanal × yöntem (× para birimi) → hesap. @param {{ data: any, canSetup: boolean }} props */
function MappingCard({ data, canSetup }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(() => data.mappings.map((row, index) => ({ ...row, key: index })));
  const [errors, setErrors] = useState({});
  const [dirty, setDirty] = useState(false);
  const save = useMutation({
    mutationFn: (body) => apiPut('/accounting/settings/mappings', body),
    onSuccess: (result) => {
      queryClient.setQueryData(accountingKeys.settings, result);
      setRows(result.mappings.map((row, index) => ({ ...row, key: index })));
      setDirty(false);
      toastSuccess('Eşleme kaydedildi; yeni tahsilatlar bu hesaplara girer');
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: accountingKeys.settings });
      toastError(error.message);
    },
  });
  const accountsFor = (method, currency) =>
    data.accounts.filter((account) => account.currency === (currency || data.currency) && (method === 'CASH' ? true : account.kind === TREASURY_METHOD_KIND[method] || account.kind === 'BANK'));
  const update = (key, patch) => {
    setDirty(true);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };
  function addMissing() {
    const next = [...rows];
    for (const { channel, methods } of data.channels) {
      for (const method of methods) {
        if (!next.some((row) => row.channel === channel && row.method === method && row.currency === '')) {
          const suggested = data.accounts.find((account) => account.currency === data.currency && account.kind === TREASURY_METHOD_KIND[method]);
          next.push({ key: Math.random(), channel, method, currency: '', treasuryAccountId: suggested?.id ?? '' });
        }
      }
    }
    setRows(next);
    setDirty(true);
  }
  function submit() {
    const body = { expectedUpdatedAt: data.mappingUpdatedAt, rows: rows.filter((row) => row.treasuryAccountId).map(({ key, ...row }) => row) };
    const checked = validateWith(treasuryMappingSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(body);
  }
  const missing = data.channels.flatMap(({ channel, methods }) => methods.filter((method) => !rows.some((row) => row.channel === channel && row.method === method && row.treasuryAccountId)).map((method) => `${TREASURY_CHANNEL_LABELS[channel]} · ${PAYMENT_METHOD_LABELS[method]}`));

  return (
    <Card
      title="Tahsilat eşlemesi"
      description="Ön büro, etkinlik ve restoran tahsilatının yöntem (ve döviz) başına hangi kasaya / bankaya gireceği. Para birimi boş satır o yöntemin bütün tahsilatını karşılar; dövizli nakit için ayrıca döviz kasası eşleyin, yoksa otel parasına çevrilip girer."
      actions={
        canSetup && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" icon="plus" onClick={addMissing} disabled={save.isPending}>
              Eksik satırları ekle
            </Button>
            <Button type="button" size="sm" icon="check" onClick={submit} disabled={!dirty || save.isPending}>
              {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        )
      }
    >
      {missing.length > 0 && (
        <Alert tone="warning" title="Eşlemesi olmayan tahsilat" className="mb-3">
          {missing.join(' · ')} — bu yöntemle alınan tahsilat muhasebeye işlenemez, "Ön muhasebe" görevine düşer.
        </Alert>
      )}
      {data.accounts.length === 0 ? (
        <p className="text-sm text-ink-muted">Önce Kasa / banka sayfasından hesap ekleyin.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
              <tr>
                <th className="py-2 pr-3">Kanal</th>
                <th className="py-2 pr-3">Yöntem</th>
                <th className="py-2 pr-3">Para birimi</th>
                <th className="py-2 pr-3">Hesap</th>
                {canSetup && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key} className="border-b border-line">
                  <td className="py-2 pr-3">{TREASURY_CHANNEL_LABELS[row.channel]}</td>
                  <td className="py-2 pr-3">{PAYMENT_METHOD_LABELS[row.method]}</td>
                  <td className="py-2 pr-3">
                    {canSetup && row.method === 'CASH' ? (
                      <Input value={row.currency} maxLength={3} placeholder="Hepsi" onChange={(event) => update(row.key, { currency: event.target.value.toUpperCase() })} error={errors[`rows.${index}.currency`]} className="w-24" />
                    ) : (
                      row.currency || 'Hepsi'
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {canSetup ? (
                      <Select
                        value={row.treasuryAccountId}
                        onChange={(event) => update(row.key, { treasuryAccountId: event.target.value })}
                        options={[{ value: '', label: 'Eşleme yok' }, ...accountsFor(row.method, row.currency).map((account) => ({ value: account.id, label: `${account.name} · ${TREASURY_KIND_LABELS[account.kind]} · ${account.currency}` }))]}
                        error={errors[`rows.${index}.treasuryAccountId`]}
                      />
                    ) : (
                      data.accounts.find((account) => account.id === row.treasuryAccountId)?.name ?? '—'
                    )}
                  </td>
                  {canSetup && (
                    <td className="py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        onClick={() => {
                          setDirty(true);
                          setRows((current) => current.filter((candidate) => candidate.key !== row.key));
                        }}
                      >
                        Kaldır
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-ink-muted">
                    Eşleme yok. "Eksik satırları ekle" ile kanal ve yöntem başına satır açın.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {errors.rows && <p className="mt-2 text-xs font-semibold text-sec-strong">{errors.rows}</p>}
        </div>
      )}
    </Card>
  );
}

/** Eksik otomatik kayıtları tamamla. @param {{ startDate: string }} props */
function SyncCard({ startDate }) {
  const queryClient = useQueryClient();
  const { today } = useHotelToday();
  const [period, setPeriod] = useState(() => ({ from: monthStart(today) < startDate ? startDate : monthStart(today), to: today }));
  const [errors, setErrors] = useState({});
  const run = useMutation({
    mutationFn: (body) => apiPost('/accounting/sync', body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: accountingKeys.all });
      toastSuccess(`${result.posted} belge işlendi${result.failed ? `, ${result.failed} belge işlenemedi` : ''}${result.remaining ? `, ${result.remaining} belge kaldı` : ''}`);
    },
    onError: (error) => toastError(error.message),
  });
  function submit(event) {
    event.preventDefault();
    const checked = validateWith(accountingSyncSchema, period);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    run.mutate(period);
  }
  const report = run.data;
  return (
    <Card
      title="Eksik kayıtları eşitle"
      description={`Muhasebe aktörü kapalıyken ya da eşleme eksikken muhasebeye işlenemeyen ödemeleri, mal kabulleri, primleri ve etkinlik bedellerini dönem için işler (en fazla ${MAX_SYNC_DAYS} gün). İşlenmiş belge ikinci kez yazılmaz.`}
    >
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <Input label="Başlangıç" type="date" min={startDate} max={period.to} value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} error={errors.from} disabled={run.isPending} />
        <Input label="Bitiş" type="date" min={period.from} max={today} value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} error={errors.to} disabled={run.isPending} />
        <Button type="submit" icon="refresh" disabled={run.isPending}>
          {run.isPending ? 'Eşitleniyor…' : 'Eşitle'}
        </Button>
      </form>
      {report && (
        <Alert tone={report.failed || report.remaining ? 'warning' : 'success'} title={`${formatDate(report.from)} – ${formatDate(report.to)}`} className="mt-3">
          {report.posted} belge işlendi, {report.skipped} belge zaten işlenmişti ya da etkisizdi{report.failed ? `, ${report.failed} belge işlenemedi` : ''}
          {report.remaining ? `; ${report.remaining} belge bu turda yetişmedi — Eşitle'ye yeniden basın, kaldığı yerden sürer` : ''}.
          {report.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {report.errors.map((error) => (
                <li key={error.id}>
                  {error.message}
                  {error.count > 1 ? ` (${error.count} belge)` : ''}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </Card>
  );
}
