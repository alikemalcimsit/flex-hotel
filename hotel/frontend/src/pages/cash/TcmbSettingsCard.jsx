import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COMMON_CURRENCIES, EXCHANGE_RATE_KIND_LABELS, exchangeRateSettingsSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Select, Spinner } from '@hotelos/ui';
import { MultiChips } from '../../components/MultiChips.jsx';
import { Switch } from '../../components/Switch.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, apiPost, apiPut } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { cashKeys } from '../../lib/payments.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/**
 * TCMB kur ayarı (modül 60): otomatik çekme, kur türü, dövizler; "şimdi çek" ve son çekme durumu. Elle girilen kur
 * TCMB'ninkiyle ezilmez (sunucu kuralı). Görmek `cash.view`, değiştirmek / çekmek `exchange_rates.manage`; yalnız
 * kur giren (kasayı göremeyen) kullanıcı ayarı okuyamaz, ona yalnız "şimdi çek" görünür.
 */
export function TcmbSettingsCard() {
  const t = useT();
  const can = useCan();
  const canView = can(PERMISSIONS.CASH_VIEW);
  const canManage = can(PERMISSIONS.EXCHANGE_RATES_MANAGE);
  const settings = useQuery({ queryKey: cashKeys.rateSettings, queryFn: () => api('/exchange-rates/settings'), enabled: canView });

  if (!canView && !canManage) return null;
  return (
    <Card title={t('cash.tcmb.title')} description={t('cash.tcmb.description')} actions={canManage && <FetchNowButton />}>
      {!canView ? null : settings.isPending ? (
        <Spinner className="py-4" />
      ) : settings.isError ? (
        <p className="text-sm text-sec-strong">{settings.error.message}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <LastFetch settings={settings.data.settings} />
          <SettingsForm key={settings.data.settings.updatedAt ?? 'default'} data={settings.data} canManage={canManage} />
        </div>
      )}
    </Card>
  );
}

/** "TCMB'den şimdi çek": sonuç kart içinde mesajla görünür. */
function FetchNowButton() {
  const t = useT();
  const queryClient = useQueryClient();
  const fetchNow = useMutation({
    mutationFn: () => apiPost('/exchange-rates/fetch', {}),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: cashKeys.all });
      const written = result.written?.length ? result.written.join(', ') : t('common.none');
      const text = t('cash.tcmb.fetchResult', { message: result.message ?? '', written });
      if (result.ok) toastSuccess(text);
      else toastError(text);
    },
    onError: (error) => toastError(error.message),
  });
  return (
    <Button size="sm" variant="outline" icon="download" onClick={() => fetchNow.mutate()} disabled={fetchNow.isPending}>
      {fetchNow.isPending ? t('cash.tcmb.fetching') : t('cash.tcmb.fetchNow')}
    </Button>
  );
}

/** @param {{ settings: { lastFetchAt: string | null, lastFetchOk: boolean | null, lastMessage: string | null } }} props */
function LastFetch({ settings }) {
  const t = useT();
  if (!settings.lastFetchAt) return <p className="text-sm text-ink-muted">{t('cash.tcmb.neverFetched')}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-muted">{t('cash.tcmb.lastFetch', { at: formatDateTime(settings.lastFetchAt) })}</span>
      <Badge tone={settings.lastFetchOk ? 'success' : 'danger'}>{settings.lastFetchOk ? t('cash.tcmb.fetchOk') : t('cash.tcmb.fetchFailed')}</Badge>
      {settings.lastMessage && <span className="basis-full text-xs text-ink-soft">{settings.lastMessage}</span>}
    </div>
  );
}

/**
 * @param {{ data: { settings: { autoFetch: boolean, rateKind: string, currencies: string[], isDefault: boolean, updatedAt: string | null, updatedBy: string | null }, kinds: Array<{ code: string, label: string }> }, canManage: boolean }} props
 */
function SettingsForm({ data, canManage }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { settings } = data;
  const [form, setForm] = useState({ autoFetch: settings.autoFetch, rateKind: settings.rateKind, currencies: settings.currencies });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const save = useMutation({
    mutationFn: (body) => apiPut('/exchange-rates/settings', body),
    onSuccess: () => {
      toastSuccess(t('cash.tcmb.saved'));
      queryClient.invalidateQueries({ queryKey: cashKeys.rateSettings });
    },
    onError: (error) => setServerError(error),
  });
  const busy = save.isPending || !canManage;
  const update = (patch) => setForm((current) => ({ ...current, ...patch }));
  const currencyOptions = [...new Set([...COMMON_CURRENCIES, ...settings.currencies])].map((code) => ({ value: code, label: code }));
  const kinds = data.kinds?.length ? data.kinds : Object.entries(EXCHANGE_RATE_KIND_LABELS).map(([code, label]) => ({ code, label }));

  function submit(event) {
    event.preventDefault();
    setServerError(null);
    const checked = validateWith(exchangeRateSettingsSchema, { expectedUpdatedAt: settings.updatedAt ?? null, ...form });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {serverError && <Alert tone="danger" title={t('common.notSaved')}>{serverError.message}</Alert>}
      <div className="flex items-center gap-3 text-sm text-ink-soft">
        <Switch checked={form.autoFetch} onChange={(next) => update({ autoFetch: next })} label={t('cash.tcmb.autoFetch')} disabled={busy} />
        <span>
          {t('cash.tcmb.autoFetch')}
          <span className="block text-xs text-ink-muted">{t('cash.tcmb.autoFetchHint')}</span>
        </span>
      </div>
      <Select
        id="tcmb-rate-kind"
        label={t('cash.tcmb.rateKind')}
        value={form.rateKind}
        onChange={(event) => update({ rateKind: event.target.value })}
        options={kinds.map((kind) => ({ value: kind.code, label: t(`cash.rateKind.${kind.code}`, kind.label) }))}
        error={errors.rateKind}
        disabled={busy}
        className="max-w-xs"
      />
      <MultiChips
        label={t('cash.tcmb.currencies')}
        options={currencyOptions}
        values={form.currencies}
        onChange={(values) => update({ currencies: values })}
        error={errors.currencies}
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-3">
        {canManage && (
          <Button type="submit" icon="check" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        )}
        <span className="text-xs text-ink-muted">
          {settings.isDefault ? t('cash.tcmb.defaults') : t('cash.tcmb.updated', { at: formatDate(settings.updatedAt), by: settings.updatedBy ?? '—' })}
        </span>
      </div>
    </form>
  );
}
