import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { updateYieldSettingsSchema } from '@hotelos/hotel-contracts';
import { Alert, Card, Checkbox, Input } from '@hotelos/ui';
import { FormActions } from '../../components/FormActions.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut } from '../../lib/api.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const QUERY_KEY = ['pricing', 'yield-settings'];

/**
 * Yield kuralları (modül 34): günlük değerlendirmenin eşikleri. Kural tetiklenince
 * fiyat DEĞİŞMEZ — öneri üretilir, onay kuyruğuna düşer; karar personelindir.
 */
export function YieldSettingsTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    enabled: false,
    horizonDays: '30',
    highOccupancyPct: '80',
    highAdjustmentPct: '10',
    lowOccupancyPct: '30',
    lowDaysOut: '7',
    lowAdjustmentPct: '15',
  });
  const [errors, setErrors] = useState({});

  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => api('/pricing/yield-settings') });
  const settings = query.data;

  useEffect(() => {
    if (!settings) return;
    setForm({
      enabled: settings.enabled ?? false,
      horizonDays: String(settings.horizonDays ?? 30),
      highOccupancyPct: String(settings.highOccupancyPct ?? 80),
      highAdjustmentPct: String(settings.highAdjustmentPct ?? 10),
      lowOccupancyPct: String(settings.lowOccupancyPct ?? 30),
      lowDaysOut: String(settings.lowDaysOut ?? 7),
      lowAdjustmentPct: String(settings.lowAdjustmentPct ?? 15),
    });
    setErrors({});
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (values) => apiPut('/pricing/yield-settings', values),
    onSuccess: (updated) => {
      queryClient.setQueryData(QUERY_KEY, updated);
      toastSuccess('Yield kuralları kaydedildi; bir sonraki değerlendirmede uygulanır');
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const setField = (name) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [name]: value }));
  };

  function submit(event) {
    event.preventDefault();
    const result = validateWith(updateYieldSettingsSchema, { ...form, expectedUpdatedAt: settings.updatedAt });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    saveMutation.mutate(result.data);
  }

  if (!settings) return <QueryFallback query={query} errorTitle="Yield kuralları yüklenemedi" />;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Card
        title="Dinamik fiyat kuralları"
        description="Günlük değerlendirme bu eşiklere göre fiyat önerisi üretir. Hiçbir fiyat kendiliğinden değişmez: her öneri onay kuyruğuna düşer, Fiyat önerileri ekranından karar verilir."
      >
        <fieldset disabled={saveMutation.isPending} className="flex flex-col gap-6">
          <Checkbox
            id="yield-enabled"
            label="Kural tabanlı yield açık"
            hint="Kapalıyken öneri üretilmez. Fiyat ajanı (AI) ayrıdır; aktör panelinden yönetilir."
            checked={form.enabled}
            onChange={setField('enabled')}
          />

          <Input
            label="Değerlendirme ufku (gün)"
            name="horizonDays"
            type="number"
            value={form.horizonDays}
            error={errors.horizonDays}
            onChange={setField('horizonDays')}
            className="w-56"
          />

          <div className="rounded-control border border-line p-4">
            <p className="mb-1 text-sm font-bold text-ink">Yüksek doluluk → artış</p>
            <p className="mb-4 text-xs text-ink-muted">
              Örnek: doluluk ≥ %{form.highOccupancyPct || '…'} olan geceler için +%{form.highAdjustmentPct || '…'} önerilir.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Yüksek doluluk eşiği (%)"
                name="highOccupancyPct"
                type="number"
                value={form.highOccupancyPct}
                error={errors.highOccupancyPct}
                onChange={setField('highOccupancyPct')}
              />
              <Input
                label="Artış (%)"
                name="highAdjustmentPct"
                type="number"
                value={form.highAdjustmentPct}
                error={errors.highAdjustmentPct}
                onChange={setField('highAdjustmentPct')}
              />
            </div>
          </div>

          <div className="rounded-control border border-line p-4">
            <p className="mb-1 text-sm font-bold text-ink">Düşük doluluk + son dakika → indirim</p>
            <p className="mb-4 text-xs text-ink-muted">
              Örnek: girişe ≤ {form.lowDaysOut || '…'} gün kala doluluk ≤ %{form.lowOccupancyPct || '…'} ise −%
              {form.lowAdjustmentPct || '…'} önerilir.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Düşük doluluk eşiği (%)"
                name="lowOccupancyPct"
                type="number"
                value={form.lowOccupancyPct}
                error={errors.lowOccupancyPct}
                onChange={setField('lowOccupancyPct')}
              />
              <Input
                label="Son gün sayısı"
                name="lowDaysOut"
                type="number"
                value={form.lowDaysOut}
                error={errors.lowDaysOut}
                onChange={setField('lowDaysOut')}
              />
              <Input
                label="İndirim (%)"
                name="lowAdjustmentPct"
                type="number"
                value={form.lowAdjustmentPct}
                error={errors.lowAdjustmentPct}
                onChange={setField('lowAdjustmentPct')}
              />
            </div>
          </div>

          <Alert tone="info">
            Onaylanan öneri gecelere çarpan olarak işlenir: fiyat planı ya da sezon fiyatının üstüne uygulanır ve kanallara
            (OTA) otomatik gider. Acente kontrat fiyatı, paket ve elle girilen fiyat etkilenmez.
          </Alert>
        </fieldset>
      </Card>

      <FormActions isPending={saveMutation.isPending} updatedAt={settings.updatedAt} />
    </form>
  );
}
