import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { loyaltySettingsSchema, pointsForSpend, pointsValue, tierFor } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Checkbox, Input } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut } from '../../lib/api.js';
import { formatDateTime, formatMoney } from '../../lib/format.js';
import { loyaltyKeys, pointsText } from '../../lib/loyalty.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { TierEditor, tierBody, tierRow } from './TierEditor.jsx';

/** Örnek hesap kutusundaki harcama (TL). */
const SAMPLE_SPEND = 2480;
const toInput = (value) => String(value ?? '').replace('.', ',');
const toDecimal = (text) => String(text).trim().replace(',', '.');
const BOOLEAN_FIELDS = ['isEnabled', 'autoEnroll', 'excludeLedgerPaid', 'earnOnSpa'];
const TEXT_FIELDS = ['programName', 'spendPerPoint', 'pointValue', 'minRedeemPoints', 'maxRedeemPct', 'expiryMonths'];

/**
 * Sadakat ayarları (modül 56, kaydetmek `loyalty.manage`): program açık / kapalı, kazanma oranı, puan değeri, kullanım
 * sınırları, süre, üyelik ve kazanma kuralları; seviyeler. Eşzamanlı yazımda bayat kayıt reddedilir.
 */
export function LoyaltySettingsPage() {
  const can = useCan();
  const query = useQuery({ queryKey: loyaltyKeys.settings, queryFn: () => api('/loyalty/settings') });
  if (!query.data) return <QueryFallback query={query} errorTitle="Ayarlar yüklenemedi" />;
  return <SettingsForm key={query.data.settings.updatedAt ?? 'default'} data={query.data} canManage={can(PERMISSIONS.LOYALTY_MANAGE)} />;
}

/** @param {any} settings */
const formValues = (settings) => ({
  ...Object.fromEntries(BOOLEAN_FIELDS.map((key) => [key, Boolean(settings[key])])),
  programName: settings.programName,
  spendPerPoint: toInput(settings.spendPerPoint),
  pointValue: toInput(settings.pointValue),
  minRedeemPoints: String(settings.minRedeemPoints),
  maxRedeemPct: String(settings.maxRedeemPct),
  expiryMonths: String(settings.expiryMonths),
});

/** @param {{ data: { settings: any, currency: string }, canManage: boolean }} props */
function SettingsForm({ data, canManage }) {
  const queryClient = useQueryClient();
  const { settings, currency } = data;
  const [initial] = useState(() => ({ values: formValues(settings), tiers: settings.tiers.map((tier) => tierRow(tier)) }));
  const [values, setValues] = useState(initial.values);
  const [tiers, setTiers] = useState(initial.tiers);
  const [errors, setErrors] = useState({});
  const disabled = !canManage;
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));

  const save = useMutation({
    mutationFn: (body) => apiPut('/loyalty/settings', body),
    onSuccess: (result) => {
      queryClient.setQueryData(loyaltyKeys.settings, result);
      queryClient.invalidateQueries({ queryKey: loyaltyKeys.all });
      toastSuccess('Sadakat ayarları kaydedildi');
    },
    onError: (error) => {
      if (error.fields && Object.keys(error.fields).length) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: loyaltyKeys.settings });
    },
  });

  const body = () => ({
    expectedUpdatedAt: settings.updatedAt ?? null,
    ...values,
    spendPerPoint: toDecimal(values.spendPerPoint),
    pointValue: toDecimal(values.pointValue),
    tiers: tiers.map(tierBody),
  });

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(loyaltySettingsSchema, body());
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.data);
  }

  const dirty = JSON.stringify(values) !== JSON.stringify(initial.values) || JSON.stringify(tiers.map(tierBody)) !== JSON.stringify(initial.tiers.map(tierBody));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {save.isError && (
        <Alert tone="danger" title={save.error.code === 'STALE_WRITE' ? 'Ayar bu arada değişti' : 'Kaydedilmedi'}>
          {save.error.message}
        </Alert>
      )}
      {settings.isDefault && (
        <Alert tone="info" title="Program henüz kurulmadı">
          Varsayılanlar gösteriliyor; program kaydedilip açılana kadar puan kazanılmaz.
        </Alert>
      )}
      <Card title="Program" description="Kapalıyken puan kazanılmaz ve harcanmaz; mevcut bakiyeler korunur.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox label="Program açık" name="loyalty-enabled" checked={values.isEnabled} onChange={set('isEnabled')} disabled={disabled} />
          <Input label="Program adı" name="loyalty-name" value={values.programName} onChange={set('programName')} error={errors.programName} disabled={disabled} />
        </div>
      </Card>
      <Card title="Kazanma ve kullanım" description="Folyo kapanınca: vergiler hariç, indirimler düşülmüş harcama ÷ oran × seviye çarpanı (aşağı yuvarlanır).">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label={`1 puan için harcama (${currency})`} name="loyalty-spend" inputMode="decimal" value={values.spendPerPoint} onChange={set('spendPerPoint')} error={errors.spendPerPoint} disabled={disabled} />
          <Input label={`Puan değeri (${currency})`} name="loyalty-value" inputMode="decimal" value={values.pointValue} onChange={set('pointValue')} error={errors.pointValue} disabled={disabled} />
          <Input label="Süre (ay, 0 = süresiz)" name="loyalty-expiry" inputMode="numeric" value={values.expiryMonths} onChange={set('expiryMonths')} error={errors.expiryMonths} disabled={disabled} />
          <Input label="En az kullanım (puan)" name="loyalty-min" inputMode="numeric" value={values.minRedeemPoints} onChange={set('minRedeemPoints')} error={errors.minRedeemPoints} disabled={disabled} />
          <Input label="Folyonun en çok %'si" name="loyalty-max-pct" inputMode="numeric" value={values.maxRedeemPct} onChange={set('maxRedeemPct')} error={errors.maxRedeemPct} disabled={disabled} />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Checkbox label="Otomatik üyelik" hint="Kapalıysa yalnız misafir kartından üye yapılan (açık rızalı) misafir kazanır." name="loyalty-auto" checked={values.autoEnroll} onChange={set('autoEnroll')} disabled={disabled} />
          <Checkbox label="Acente / cari ödemeli folyo kazanmaz" name="loyalty-ledger" checked={values.excludeLedgerPaid} onChange={set('excludeLedgerPaid')} disabled={disabled} />
          <Checkbox label="Spa kasasında ödenen randevu kazanır" name="loyalty-spa" checked={values.earnOnSpa} onChange={set('earnOnSpa')} disabled={disabled} />
        </div>
        <SampleBox values={values} tiers={tiers} currency={currency} />
      </Card>
      <Card title="Seviyeler" description="Son 12 ayda kazanılan puana göre; çarpan kazanmaya uygulanır, avantaj metni ön büroda ve misafir portalında görünür.">
        <TierEditor rows={tiers} onChange={setTiers} errors={errors} disabled={disabled} />
      </Card>
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

/** Örnek hesap: başlangıç seviyesinde örnek harcamanın puanı ve karşılığı. @param {{ values: any, tiers: any[], currency: string }} props */
function SampleBox({ values, tiers, currency }) {
  const parsed = tiers.map(tierBody).map((tier) => ({ ...tier, minPoints: Number(tier.minPoints) || 0 }));
  const base = parsed.length ? tierFor(parsed, 0).current : null;
  const spendPerPoint = toDecimal(values.spendPerPoint);
  const pointValue = toDecimal(values.pointValue);
  if (!base || !(Number(spendPerPoint) > 0) || !(Number(pointValue) > 0)) return null;
  const points = pointsForSpend({ spend: SAMPLE_SPEND, spendPerPoint, multiplier: Number(base.multiplier) || 1 });
  return (
    <p className="mt-4 rounded-item bg-surface-muted px-3 py-2 text-sm text-ink-soft">
      Örnek: {formatMoney(SAMPLE_SPEND, currency)} harcama → <span className="font-semibold text-ink">{pointsText(points)}</span> ({base.name || 'başlangıç seviyesi'}), {formatMoney(pointsValue(points, pointValue), currency)} değerinde.
    </p>
  );
}
