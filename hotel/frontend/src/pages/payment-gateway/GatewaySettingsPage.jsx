import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MAX_GATEWAY_INSTALLMENT,
  MAX_PAYMENT_LINK_TTL_HOURS,
  PAYMENT_GATEWAY_ENVIRONMENTS,
  PAYMENT_GATEWAY_ENVIRONMENT_LABELS,
  PAYMENT_GATEWAY_TEST_BEHAVIORS,
  PAYMENT_GATEWAY_TEST_BEHAVIOR_LABELS,
  WIDGET_PREPAYMENTS,
  WIDGET_PREPAYMENT_LABELS,
  paymentGatewaySettingsSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Checkbox, Input, Select } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { gatewayKeys } from '../../lib/paymentGateway.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { GatewayConnectionTest } from './GatewayConnectionTest.jsx';
import { GatewayCredentials } from './GatewayCredentials.jsx';

const options = (values, labels) => values.map((value) => ({ value, label: labels[value] }));
const ENVIRONMENT_OPTIONS = options(PAYMENT_GATEWAY_ENVIRONMENTS, PAYMENT_GATEWAY_ENVIRONMENT_LABELS);
const TEST_BEHAVIOR_OPTIONS = options(PAYMENT_GATEWAY_TEST_BEHAVIORS, PAYMENT_GATEWAY_TEST_BEHAVIOR_LABELS);
const PREPAYMENT_OPTIONS = options(WIDGET_PREPAYMENTS, WIDGET_PREPAYMENT_LABELS);
const INSTALLMENT_OPTIONS = Array.from({ length: MAX_GATEWAY_INSTALLMENT }, (_, index) => ({ value: String(index + 1), label: index === 0 ? 'Tek çekim' : `${index + 1} taksite kadar` }));

/**
 * Sanal POS ayarları (modül 50; kaydetmek ve bağlantı denemesi `payment_gateway.setup`, diğerleri salt okunur): açık / kapalı,
 * sağlayıcı, ortam, anahtarlar (yalnız yazılır), sunucunun dış adresi, link süresi, taksit, portal ve widget ön ödemesi,
 * test davranışı. Eşzamanlı yazımda bayat kayıt reddedilir.
 */
export function GatewaySettingsPage() {
  const can = useCan();
  const query = useQuery({ queryKey: gatewayKeys.settings, queryFn: () => api('/payment-gateway/settings') });
  if (!query.data) return <QueryFallback query={query} errorTitle="Sanal POS ayarları yüklenemedi" />;
  return <SettingsForm key={query.data.settings.updatedAt ?? 'default'} data={query.data} canSetup={can(PERMISSIONS.PAYMENT_GATEWAY_SETUP)} />;
}

/** @param {any} settings */
const formValues = (settings) => ({
  isEnabled: Boolean(settings.isEnabled),
  provider: settings.provider,
  environment: settings.environment,
  apiPublicUrl: settings.apiPublicUrl ?? '',
  linkTtlHours: String(settings.linkTtlHours),
  maxInstallment: String(settings.maxInstallment),
  allowPortalPayment: Boolean(settings.allowPortalPayment),
  widgetPrepayment: settings.widgetPrepayment,
  testBehavior: settings.testBehavior,
  apiKey: '',
  secretKey: '',
  clearCredentials: false,
});

/** Form → istek gövdesi (sayılar sayıya, boş anahtar null = kayıtlı kalsın). @param {ReturnType<typeof formValues>} values @param {string | null} updatedAt */
const toBody = (values, updatedAt) => ({
  ...values,
  expectedUpdatedAt: updatedAt,
  apiPublicUrl: values.apiPublicUrl.trim() || null,
  linkTtlHours: Number(values.linkTtlHours),
  maxInstallment: Number(values.maxInstallment),
  apiKey: values.clearCredentials ? null : values.apiKey.trim() || null,
  secretKey: values.clearCredentials ? null : values.secretKey.trim() || null,
});

/** @param {{ data: { settings: any, providers: Array<{ code: string, label: string }>, secretKeyConfigured: boolean, portalBaseUrl: string | null }, canSetup: boolean }} props */
function SettingsForm({ data, canSetup }) {
  const queryClient = useQueryClient();
  const { settings, providers, secretKeyConfigured, portalBaseUrl } = data;
  const [initial] = useState(() => formValues(settings));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const disabled = !canSetup;
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const save = useMutation({
    mutationFn: (body) => apiPut('/payment-gateway/settings', body),
    onSuccess: (result) => {
      queryClient.setQueryData(gatewayKeys.settings, result);
      queryClient.invalidateQueries({ queryKey: gatewayKeys.all });
      toastSuccess('Sanal POS ayarları kaydedildi');
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: gatewayKeys.settings });
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = toBody(values, settings.updatedAt ?? null);
    if (Boolean(body.apiKey) !== Boolean(body.secretKey)) return setErrors({ [body.apiKey ? 'secretKey' : 'apiKey']: 'API anahtarı ve gizli anahtar birlikte girilir' });
    const checked = validateWith(paymentGatewaySettingsSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  }

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const providerOptions = providers.map((row) => ({ value: row.code, label: row.label }));
  const isIyzico = values.provider === 'IYZICO';

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {save.isError && (
        <Alert tone="danger" title={save.error.code === 'STALE_WRITE' ? 'Ayar bu arada değişti' : 'Kaydedilmedi'}>
          {save.error.message}
        </Alert>
      )}
      {!secretKeyConfigured && (
        <Alert tone="warning" title="Sunucuda şifreleme anahtarı yok">
          iyzico anahtarları saklanamaz; sistem yöneticisi sunucuya şifreleme anahtarını tanımlamalı. Test ortamı yine çalışır.
        </Alert>
      )}
      {!portalBaseUrl && (
        <Alert tone="warning" title="Misafir portalı adresi yok">
          Ödeme sayfası misafir portalı adresinde açılır. Önce Misafir portalı ayarından portal adresini girin; yoksa link oluşturulamaz.
        </Alert>
      )}
      {settings.isDefault && (
        <Alert tone="info" title="Sanal POS henüz kurulmadı">
          Varsayılanlar gösteriliyor; açılıp kaydedilene kadar ödeme linki oluşturulamaz.
        </Alert>
      )}
      <Card title="Sağlayıcı" description="Misafir kartını sağlayıcının sayfasında girer; kart bilgisi otelin sunucusuna gelmez.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox label="Sanal POS açık" name="pg-enabled" checked={values.isEnabled} onChange={set('isEnabled')} disabled={disabled} className="sm:col-span-2" />
          <Select label="Sağlayıcı" name="pg-provider" options={providerOptions} value={values.provider} onChange={set('provider')} error={errors.provider} disabled={disabled} />
          {isIyzico ? (
            <Select label="Ortam" name="pg-environment" options={ENVIRONMENT_OPTIONS} value={values.environment} onChange={set('environment')} error={errors.environment} disabled={disabled} />
          ) : (
            <Select label="Test davranışı" name="pg-test-behavior" options={TEST_BEHAVIOR_OPTIONS} value={values.testBehavior} onChange={set('testBehavior')} error={errors.testBehavior} disabled={disabled} />
          )}
          {isIyzico && values.environment === 'LIVE' && (
            <Alert tone="warning" title="Canlı ortam" className="sm:col-span-2">
              Misafirin kartından gerçek para çekilir. Üye iş yeri anahtarlarını girin; sandbox anahtarı kabul edilmez.
            </Alert>
          )}
          {isIyzico && <GatewayCredentials values={values} errors={errors} settings={settings} canSetup={canSetup} onChange={set} />}
          <div className="sm:col-span-2">
            <Input
              label="Sunucunun dış adresi"
              name="pg-api-public-url"
              placeholder="https://hotel.flexai.tr/api"
              value={values.apiPublicUrl}
              onChange={set('apiPublicUrl')}
              error={errors.apiPublicUrl}
              maxLength={300}
              autoComplete="off"
              disabled={disabled}
            />
            <p className="mt-1.5 text-xs text-ink-muted">API'nin internetten görünen adresi; ödeme sonucu buraya döner. Açıkken zorunlu.</p>
          </div>
        </div>
      </Card>
      <Card title="Ödeme linki" description="Personelin, portalın ve widget'ın açtığı linkler bu ayarla oluşur.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={`Link süresi (saat, en çok ${MAX_PAYMENT_LINK_TTL_HOURS})`} name="pg-ttl" inputMode="numeric" value={values.linkTtlHours} onChange={set('linkTtlHours')} error={errors.linkTtlHours} disabled={disabled} />
          <Select label="Taksit" name="pg-installment" options={INSTALLMENT_OPTIONS} value={values.maxInstallment} onChange={set('maxInstallment')} error={errors.maxInstallment} disabled={disabled} />
          <Checkbox label="Portalda kartla ödeme" hint="Misafir portalında açık bakiye için “Kartla öde” düğmesi çıkar." name="pg-portal" checked={values.allowPortalPayment} onChange={set('allowPortalPayment')} disabled={disabled} />
          <Select label="Widget ön ödemesi" name="pg-widget" options={PREPAYMENT_OPTIONS} value={values.widgetPrepayment} onChange={set('widgetPrepayment')} error={errors.widgetPrepayment} disabled={disabled} />
        </div>
      </Card>
      {canSetup && (
        <Card title="Bağlantı denemesi">
          <GatewayConnectionTest isDirty={dirty} />
        </Card>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">{settings.updatedAt ? `Son kayıt ${formatDateTime(settings.updatedAt)}${settings.updatedBy ? ` · ${settings.updatedBy}` : ''}` : 'Henüz kaydedilmedi.'}</p>
        {canSetup && (
          <Button type="submit" icon="check" disabled={save.isPending || !dirty}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        )}
      </div>
    </form>
  );
}
