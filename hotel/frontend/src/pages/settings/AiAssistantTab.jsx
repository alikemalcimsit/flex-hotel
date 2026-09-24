import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AI_RESERVATION_STATUS_LABELS,
  AI_RESERVATION_STATUSES,
  aiSettingsSchema,
  MAX_HOTEL_INFO_LENGTH,
  MAX_REPLIES_PER_CONVERSATION_DAY,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Card, Checkbox, Input, Select, Textarea } from '@hotelos/ui';
import { FormActions } from '../../components/FormActions.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut } from '../../lib/api.js';
import { aiKeys } from '../../lib/concierge.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { AiUsageCard } from './AiUsageCard.jsx';

const STATUS_OPTIONS = AI_RESERVATION_STATUSES.map((value) => ({ value, label: AI_RESERVATION_STATUS_LABELS[value] }));
const EMPTY_PRICE = Object.freeze({ input: '', cachedInput: '', output: '' });

/** @param {object} settings sunucudaki ayar */
function formFrom(settings) {
  return {
    enabled: settings.enabled,
    routerModel: settings.routerModel,
    conciergeModel: settings.conciergeModel,
    prices: settings.prices ?? {},
    dailyBudgetUsd: settings.dailyBudgetUsd === '0' ? '' : settings.dailyBudgetUsd,
    reservationStatus: settings.reservationStatus,
    hotelInfo: settings.hotelInfo ?? '',
    maxRepliesPerConversationDay: String(settings.maxRepliesPerConversationDay),
  };
}

/** Formdaki model adları (boşlar ve tekrar hariç) — fiyatı istenen modeller. */
const modelsOf = (form) => [...new Set([form.routerModel.trim(), form.conciergeModel.trim()].filter(Boolean))];

/**
 * AI asistanı (modül 8): WhatsApp ve web chat'te misafirle konuşup rezervasyon
 * alan asistanın ayarı.
 *
 * - Model **anahtarı** ekrana girilmez: sunucunun ortam dosyasında durur;
 *   ekran yalnızca "tanımlı mı" bilgisini gösterir.
 * - Maliyet kodda değil ayarda: modelin fiyatı (1M token başına USD) buradan
 *   girilir; sağlayıcı fiyat değiştirince kod değişmez. Fiyatı girilmemiş
 *   modelle çağrı yapılmaz.
 * - Günlük bütçe dolunca AI yeni mesaja cevap vermez; konuşmalar personele
 *   düşer ve yönetime zil uyarısı gider.
 */
export function AiAssistantTab() {
  const queryClient = useQueryClient();
  const can = useCan();
  const canManage = can(PERMISSIONS.SETTINGS_MANAGE);
  const query = useQuery({ queryKey: aiKeys.settings, queryFn: () => api('/ai/settings') });
  const settings = query.data;
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!settings) return;
    setForm(formFrom(settings));
    setErrors({});
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (values) => apiPut('/ai/settings', values),
    onSuccess: (saved) => {
      queryClient.setQueryData(aiKeys.settings, saved);
      queryClient.invalidateQueries({ queryKey: aiKeys.usageAll });
      toastSuccess(saved.enabled ? 'AI asistanı ayarı kaydedildi' : 'AI asistanı kapalı olarak kaydedildi');
    },
    onError: (error) => {
      toastError(error.message);
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: aiKeys.settings });
    },
  });

  if (!settings || !form) return <QueryFallback query={query} errorTitle="AI asistanı ayarı yüklenemedi" />;

  const models = modelsOf(form);
  const setField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const setPrice = (model, key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({
      ...current,
      prices: { ...current.prices, [model]: { ...EMPTY_PRICE, ...current.prices[model], [key]: value } },
    }));
    setErrors((current) => ({ ...current, [`prices.${model}`]: undefined, [`prices.${model}.${key}`]: undefined }));
  };

  function handleSubmit(event) {
    event.preventDefault();
    const payload = {
      ...form,
      routerModel: form.routerModel.trim(),
      conciergeModel: form.conciergeModel.trim(),
      // Yalnızca seçili modellerin fiyatı gider (eski modelin fiyatı birikmesin).
      prices: Object.fromEntries(models.filter((model) => form.prices[model]).map((model) => [model, form.prices[model]])),
      dailyBudgetUsd: form.dailyBudgetUsd || '0',
      expectedUpdatedAt: settings.updatedAt,
    };
    const result = validateWith(aiSettingsSchema, payload);
    if (!result.ok) {
      setErrors(result.errors);
      toastError('Formda düzeltilecek alanlar var');
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }

  const status = !settings.keyConfigured
    ? { tone: 'neutral', label: 'Anahtar yok' }
    : !settings.agentRunning
      ? { tone: 'warning', label: 'Ajan çalışmıyor' }
      : settings.enabled
        ? { tone: 'success', label: 'Açık' }
        : { tone: 'neutral', label: 'Kapalı' };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      {!settings.keyConfigured && (
        <Alert tone="warning" title="Sunucuda model anahtarı tanımlı değil">
          AI asistanı OpenAI anahtarıyla çalışır; anahtar güvenlik gereği bu ekrana girilmez, sunucunun ortam dosyasına
          <code className="mx-1 rounded bg-black/[0.06] px-1">OPENAI_API_KEY</code>
          olarak eklenir ve sunucu yeniden başlatılır. O zamana kadar ayarlar kaydedilebilir ama AI misafire cevap vermez;
          yeni konuşmalar personele düşer.
        </Alert>
      )}
      {settings.keyConfigured && !settings.agentRunning && (
        <Alert tone="warning" title="Anahtar tanımlı ama AI ajanları çalışmıyor">
          Anahtar sunucu açıldıktan sonra eklenmiş olabilir. Sunucu yeniden başlatılınca ajanlar devreye girer.
        </Alert>
      )}
      {!canManage && (
        <Alert tone="info">Bu ayarı görüntüleyebilirsiniz; değiştirmek için "Ayarları yönet" yetkisi gerekir.</Alert>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <fieldset disabled={!canManage || mutation.isPending} className="flex flex-col gap-6">
          <Card
            title="AI asistanı"
            description="WhatsApp ve web chat'te misafirle konuşur: müsaitlik ve fiyat bakar, teklif hazırlar, misafir açıkça onaylayınca rezervasyonu açar ve onay kodunu yazar. Şikâyet ve personel isteğini size devreder."
            actions={<Badge tone={status.tone}>{status.label}</Badge>}
          >
            <div className="flex flex-col gap-5">
              <Checkbox
                id="ai-enabled"
                label="AI asistanı yeni mesajlara cevap versin"
                hint="Kapalıyken yeni konuşmalar personelde başlar; AI'daki konuşmaya gelen mesaj konuşmayı personele alır."
                checked={form.enabled}
                onChange={setField('enabled')}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Input
                  label="Sınıflandırma modeli (küçük)"
                  name="routerModel"
                  autoComplete="off"
                  placeholder="Sağlayıcıdaki model adı"
                  value={form.routerModel}
                  error={errors.routerModel}
                  onChange={setField('routerModel')}
                />
                <Input
                  label="Konuşma modeli"
                  name="conciergeModel"
                  autoComplete="off"
                  placeholder="Sağlayıcıdaki model adı"
                  value={form.conciergeModel}
                  error={errors.conciergeModel}
                  onChange={setField('conciergeModel')}
                />
              </div>
              <p className="text-xs text-ink-muted">
                Sınıflandırma modeli her misafir mesajının niyetini (rezervasyon, soru, şikâyet, personel isteği) belirler
                ve uzun konuşmaları özetler; ucuz ve hızlı bir model yeter. Konuşma modeli misafire cevap yazar.
              </p>
            </div>
          </Card>

          <Card
            title="Model fiyatları"
            description="Sağlayıcının fiyat sayfasındaki değerler: 1 milyon token başına USD. Maliyet ve günlük bütçe bu fiyatlarla hesaplanır; fiyatı girilmemiş modelle çağrı yapılmaz."
          >
            {models.length === 0 ? (
              <p className="text-sm text-ink-muted">Önce model adlarını girin.</p>
            ) : (
              <div className="flex flex-col gap-5">
                {models.map((model) => {
                  const price = { ...EMPTY_PRICE, ...form.prices[model] };
                  const groupError = errors[`prices.${model}`];
                  return (
                    <fieldset key={model} className="flex flex-col gap-3">
                      <legend className="mb-1 text-sm font-bold text-ink">{model}</legend>
                      <div className="grid gap-5 sm:grid-cols-3">
                        <Input
                          label="Girdi"
                          name={`price-${model}-input`}
                          inputMode="decimal"
                          placeholder="0.40"
                          value={price.input}
                          error={errors[`prices.${model}.input`]}
                          onChange={setPrice(model, 'input')}
                        />
                        <Input
                          label="Önbellekli girdi"
                          name={`price-${model}-cached`}
                          inputMode="decimal"
                          placeholder="0.10"
                          value={price.cachedInput}
                          error={errors[`prices.${model}.cachedInput`]}
                          onChange={setPrice(model, 'cachedInput')}
                        />
                        <Input
                          label="Çıktı"
                          name={`price-${model}-output`}
                          inputMode="decimal"
                          placeholder="1.60"
                          value={price.output}
                          error={errors[`prices.${model}.output`]}
                          onChange={setPrice(model, 'output')}
                        />
                      </div>
                      {groupError && (
                        <p role="alert" className="text-xs font-semibold text-sec-strong">
                          {groupError}
                        </p>
                      )}
                    </fieldset>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="Sınırlar ve rezervasyon" description="Bütçe bir sigortadır: dolunca AI o gün yeni mesaja cevap vermez, konuşmalar personele düşer.">
            <div className="grid gap-5 sm:grid-cols-3">
              <Input
                label="Günlük bütçe (USD)"
                name="dailyBudgetUsd"
                inputMode="decimal"
                placeholder="5.00"
                value={form.dailyBudgetUsd}
                error={errors.dailyBudgetUsd}
                onChange={setField('dailyBudgetUsd')}
              />
              <Input
                label="Konuşma başına günlük AI cevabı"
                name="maxRepliesPerConversationDay"
                type="number"
                min="1"
                max={MAX_REPLIES_PER_CONVERSATION_DAY}
                value={form.maxRepliesPerConversationDay}
                error={errors.maxRepliesPerConversationDay}
                onChange={setField('maxRepliesPerConversationDay')}
              />
              <Select
                label="AI'ın açtığı rezervasyon"
                name="reservationStatus"
                value={form.reservationStatus}
                options={STATUS_OPTIONS}
                error={errors.reservationStatus}
                onChange={setField('reservationStatus')}
              />
            </div>
            <Alert tone="info" className="mt-5">
              {form.reservationStatus === 'PENDING'
                ? 'Misafir onaylayınca rezervasyon opsiyonlu açılır; misafire onay kodu ve "ekibimiz kesinleştirecek" yazılır. Resepsiyon rezervasyonlar ekranından kesinleştirir.'
                : 'Misafir onaylayınca rezervasyon kesin açılır; misafire onay kodu yazılır. Yer yoksa rezervasyon açılmaz, misafire başka seçenek önerilir.'}{' '}
              Sınır, aynı konuşmada bir günde yazılabilecek AI cevabıdır; dolunca konuşma personele geçer.
            </Alert>
          </Card>

          <Card
            title="Misafire anlatılacak otel bilgisi"
            description="Olanaklar, ulaşım, kurallar, sık sorulanlar. AI yalnızca buradaki ve otel ayarlarındaki bilgiyi söyler; burada olmayanı uydurmaz, personele yönlendirir."
          >
            <Textarea
              label="Otel bilgisi"
              name="hotelInfo"
              rows={8}
              maxLength={MAX_HOTEL_INFO_LENGTH}
              placeholder={'Açık havuz 09:00-19:00 (Haziran-Eylül).\nÜcretsiz otopark.\nHavalimanına 25 km; transfer ücretli, resepsiyondan ayarlanır.\nEvcil hayvan kabul edilmez.'}
              value={form.hotelInfo}
              error={errors.hotelInfo}
              onChange={setField('hotelInfo')}
            />
            <p className="mt-2 text-right text-xs text-ink-muted">
              {form.hotelInfo.length} / {MAX_HOTEL_INFO_LENGTH}
            </p>
          </Card>
        </fieldset>

        {canManage && <FormActions isPending={mutation.isPending} updatedAt={settings.updatedAt ?? undefined} />}
      </form>

      <AiUsageCard />
    </div>
  );
}
