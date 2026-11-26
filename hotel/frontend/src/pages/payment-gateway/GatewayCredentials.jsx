import { Badge, Checkbox, Input } from '@hotelos/ui';

/**
 * iyzico anahtarları (modül 50): yalnız yazılır. Boş bırakılırsa kayıtlı olan kalır; "Anahtarları sil" siler. Yetkisi
 * olmayan yalnız kayıtlı olup olmadığını görür.
 * @param {{
 *   values: { apiKey: string, secretKey: string, clearCredentials: boolean }, errors: Record<string, string>,
 *   settings: { hasCredentials: boolean }, canSetup: boolean, onChange: (key: string) => (event: any) => void,
 * }} props
 */
export function GatewayCredentials({ values, errors, settings, canSetup, onChange }) {
  if (!canSetup) return <p className="text-sm text-ink-soft sm:col-span-2">Anahtarlar: {settings.hasCredentials ? 'kayıtlı' : 'girilmemiş'}</p>;
  const placeholder = settings.hasCredentials ? 'Değiştirmek için yazın' : 'Anahtarı yazın';
  return (
    <>
      <Input label="API anahtarı" name="pg-api-key" type="password" autoComplete="new-password" placeholder={placeholder} value={values.apiKey} onChange={onChange('apiKey')} error={errors.apiKey} disabled={values.clearCredentials} />
      <Input label="Gizli anahtar" name="pg-secret-key" type="password" autoComplete="new-password" placeholder={placeholder} value={values.secretKey} onChange={onChange('secretKey')} error={errors.secretKey} disabled={values.clearCredentials} />
      {settings.hasCredentials && (
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Badge tone="success">Anahtarlar kayıtlı</Badge>
          <Checkbox label="Anahtarları sil" name="pg-clear-credentials" checked={values.clearCredentials} onChange={onChange('clearCredentials')} />
        </div>
      )}
    </>
  );
}
