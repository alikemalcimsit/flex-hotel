import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KBS_TEST_BEHAVIORS, KBS_TEST_BEHAVIOR_LABELS, kbsSettingsSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Input, Select } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { kbsKeys } from '../../lib/kbs.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { KbsConnectionTest } from './KbsConnectionTest.jsx';

const BOOLEAN_FIELDS = ['isEnabled', 'sendCheckOut', 'sendRoomChange', 'requireGender', 'requireBirthDate', 'requireParentNames', 'requireBirthPlace', 'citizenIdOnly'];
const TEST_BEHAVIOR_OPTIONS = KBS_TEST_BEHAVIORS.map((value) => ({ value, label: KBS_TEST_BEHAVIOR_LABELS[value] }));
const NOT_READY_HINT = 'yakında — tesis yetkisi ve servis dokümanı gerekiyor';

/**
 * KBS ayarları (modül 58; kaydetmek ve bağlantı denemesi `kbs.manage`, diğerleri salt okunur): açık / kapalı, sağlayıcı
 * (hazır olmayan pasif), tesis kodu, kullanıcı, parola (yalnız yazılır), çıkış / oda değişikliği bildirimi, zorunlu alanlar,
 * test davranışı. Eşzamanlı yazımda bayat kayıt reddedilir.
 */
export function KbsSettingsPage() {
  const can = useCan();
  const query = useQuery({ queryKey: kbsKeys.settings, queryFn: () => api('/kbs/settings') });
  if (!query.data) return <QueryFallback query={query} errorTitle="KBS ayarları yüklenemedi" />;
  return <SettingsForm key={query.data.settings.updatedAt ?? 'default'} data={query.data} canManage={can(PERMISSIONS.KBS_MANAGE)} />;
}

/** @param {any} settings */
const formValues = (settings) => ({
  ...Object.fromEntries(BOOLEAN_FIELDS.map((key) => [key, Boolean(settings[key])])),
  provider: settings.provider,
  facilityCode: settings.facilityCode ?? '',
  username: settings.username ?? '',
  testBehavior: settings.testBehavior,
  password: '',
  clearPassword: false,
});

/** @param {{ data: { settings: any, providers: Array<{ code: string, label: string, ready: boolean }>, secretKeyConfigured: boolean }, canManage: boolean }} props */
function SettingsForm({ data, canManage }) {
  const queryClient = useQueryClient();
  const { settings, providers, secretKeyConfigured } = data;
  const [initial] = useState(() => formValues(settings));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const disabled = !canManage;
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const save = useMutation({
    mutationFn: (body) => apiPut('/kbs/settings', body),
    onSuccess: (result) => {
      queryClient.setQueryData(kbsKeys.settings, result);
      queryClient.invalidateQueries({ queryKey: kbsKeys.all });
      toastSuccess('KBS ayarları kaydedildi');
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: kbsKeys.settings });
    },
  });

  function submit(event) {
    event.preventDefault();
    const body = { ...values, expectedUpdatedAt: settings.updatedAt ?? null, password: values.clearPassword ? null : values.password || null };
    const checked = validateWith(kbsSettingsSchema, body);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  }

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const providerOptions = providers.map((row) => ({ value: row.code, label: row.ready ? row.label : `${row.label} (${NOT_READY_HINT})`, disabled: !row.ready && row.code !== settings.provider }));
  const chosen = providers.find((row) => row.code === values.provider);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {save.isError && (
        <Alert tone="danger" title={save.error.code === 'STALE_WRITE' ? 'Ayar bu arada değişti' : 'Kaydedilmedi'}>
          {save.error.message}
        </Alert>
      )}
      {!secretKeyConfigured && (
        <Alert tone="warning" title="Sunucuda şifreleme anahtarı yok">
          Parola saklanamaz; sistem yöneticisi sunucuya şifreleme anahtarını tanımlamalı.
        </Alert>
      )}
      {settings.isDefault && (
        <Alert tone="info" title="KBS henüz kurulmadı">
          Varsayılanlar gösteriliyor; KBS açılıp kaydedilene kadar girişler bildirilmez.
        </Alert>
      )}
      <Card title="Bağlantı" description="Tesis kodu ve kullanıcı Emniyet / Jandarma'dan alınır. Açıkken girişte belgesi alınan her kişi bildirilir.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox label="KBS açık" name="kbs-enabled" checked={values.isEnabled} onChange={set('isEnabled')} disabled={disabled} className="sm:col-span-2" />
          <div>
            <Select label="Sağlayıcı" name="kbs-provider" options={providerOptions} value={values.provider} onChange={set('provider')} error={errors.provider} disabled={disabled} />
            {chosen && !chosen.ready && <p className="mt-1.5 text-xs text-warning-ink">Bu sağlayıcı {NOT_READY_HINT}; şimdilik Test ortamını seçin.</p>}
          </div>
          {values.provider === 'TEST' && (
            <Select label="Test davranışı" name="kbs-test-behavior" options={TEST_BEHAVIOR_OPTIONS} value={values.testBehavior} onChange={set('testBehavior')} error={errors.testBehavior} disabled={disabled} />
          )}
          <Input label="Tesis kodu" name="kbs-facility" value={values.facilityCode} onChange={set('facilityCode')} error={errors.facilityCode} maxLength={40} autoComplete="off" disabled={disabled} />
          <Input label="Kullanıcı adı" name="kbs-username" value={values.username} onChange={set('username')} error={errors.username} maxLength={80} autoComplete="off" disabled={disabled} />
          {canManage && (
            <div>
              <Input
                label="Parola"
                name="kbs-password"
                type="password"
                autoComplete="new-password"
                placeholder={settings.hasPassword ? 'Değiştirmek için yazın' : 'Parolayı yazın'}
                value={values.password}
                onChange={set('password')}
                error={errors.password}
                disabled={values.clearPassword}
              />
              {settings.hasPassword && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Badge tone="success">Parola kayıtlı</Badge>
                  <Checkbox label="Parolayı sil" name="kbs-clear-password" checked={values.clearPassword} onChange={set('clearPassword')} />
                </div>
              )}
            </div>
          )}
          {!canManage && <p className="text-sm text-ink-soft">Parola: {settings.hasPassword ? 'kayıtlı' : 'girilmemiş'}</p>}
        </div>
      </Card>
      <Card title="Ne bildirilir" description="Giriş her zaman bildirilir; çıkış ve oda değişikliği ayara göre.">
        <div className="flex flex-col gap-2">
          <Checkbox label="Çıkışı bildir" name="kbs-checkout" checked={values.sendCheckOut} onChange={set('sendCheckOut')} disabled={disabled} />
          <Checkbox label="Oda değişikliğini bildir" name="kbs-room-change" checked={values.sendRoomChange} onChange={set('sendRoomChange')} disabled={disabled} />
        </div>
      </Card>
      <Card title="Zorunlu alanlar" description="Belge türü, numara ve uyruk her zaman zorunlu. KBS açıkken aşağıdakiler eksikse giriş yapılamaz.">
        <div className="flex flex-col gap-2">
          <Checkbox label="Cinsiyet" name="kbs-req-gender" checked={values.requireGender} onChange={set('requireGender')} disabled={disabled} />
          <Checkbox label="Doğum tarihi" name="kbs-req-birth-date" checked={values.requireBirthDate} onChange={set('requireBirthDate')} disabled={disabled} />
          <Checkbox label="Anne ve baba adı" name="kbs-req-parents" checked={values.requireParentNames} onChange={set('requireParentNames')} disabled={disabled} />
          <Checkbox label="Doğum yeri" name="kbs-req-birth-place" checked={values.requireBirthPlace} onChange={set('requireBirthPlace')} disabled={disabled} />
          <Checkbox
            label="TC vatandaşına ek alan sorma"
            hint="TC kimlikle bildirilen TC vatandaşının ek bilgileri nüfus kaydından gelir; yalnız kimlik no ve ad istenir."
            name="kbs-citizen-only"
            checked={values.citizenIdOnly}
            onChange={set('citizenIdOnly')}
            disabled={disabled}
          />
        </div>
      </Card>
      {canManage && (
        <Card title="Bağlantı denemesi">
          <KbsConnectionTest isDirty={dirty} />
        </Card>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">{settings.updatedAt ? `Son kayıt ${formatDateTime(settings.updatedAt)}${settings.updatedBy ? ` · ${settings.updatedBy}` : ''}` : 'Henüz kaydedilmedi.'}</p>
        {canManage && (
          <Button type="submit" icon="check" disabled={save.isPending || !dirty}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        )}
      </div>
    </form>
  );
}
