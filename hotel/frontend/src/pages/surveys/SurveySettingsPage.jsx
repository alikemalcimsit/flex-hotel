import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SURVEY_SETTING_LIMITS, surveySettingsSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Checkbox, Input, Spinner } from '@hotelos/ui';
import { api, apiPut } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { surveyKeys } from '../../lib/surveys.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const NUMBERS = Object.freeze(['postStayDelayDays', 'postStaySendHour', 'midStaySendHour', 'midStayMinNights', 'minDaysBetweenSurveys', 'linkValidDays', 'lowNpsThreshold', 'lowRatingThreshold']);

/** @param {any} data */
const toForm = (data) => ({
  postStayEnabled: data.postStayEnabled,
  midStayEnabled: data.midStayEnabled,
  ...Object.fromEntries(NUMBERS.map((key) => [key, String(data[key])])),
  googleReviewUrl: data.googleReviewUrl ?? '',
  tripadvisorReviewUrl: data.tripadvisorReviewUrl ?? '',
});

/** Alanın altında açıklama. @param {{ hint?: string } & Record<string, any>} props */
function HintedInput({ hint, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      <Input {...props} />
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * Anket ayarları (modül 55): iki anketin açık / kapalı ve gönderim zamanı, aynı misafire sıklık, bağlantının süresi,
 * düşük puan eşikleri (takip açar), yorum bağlantıları. Bağlantının tabanı misafir portalı ayarındaki adres; bildirim
 * kanalı ve AI durumu burada uyarı olarak görünür.
 */
export function SurveySettingsPage() {
  const canSetup = useCan()(PERMISSIONS.SURVEYS_SETUP);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: surveyKeys.settings, queryFn: () => api('/surveys/settings') });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (query.data && !form) setForm(toForm(query.data));
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (body) => apiPut('/surveys/settings', body),
    onSuccess: (data) => {
      queryClient.setQueryData(surveyKeys.settings, data);
      setForm(toForm(data));
      toastSuccess('Anket ayarları kaydedildi');
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') {
        setForm(null);
        queryClient.invalidateQueries({ queryKey: surveyKeys.settings });
      }
    },
  });

  if (query.isPending || (!form && !query.isError)) return <Spinner label="Ayarlar yükleniyor…" className="py-10" />;
  if (query.isError) {
    return (
      <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>
        {query.error.message}
      </Alert>
    );
  }
  const data = query.data;
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const limit = (key) => `${SURVEY_SETTING_LIMITS[key].min}–${SURVEY_SETTING_LIMITS[key].max}`;
  const field = (key, label, hint) => <HintedInput label={label} inputMode="numeric" value={form[key]} onChange={set(key)} error={errors[key]} hint={hint ?? limit(key)} disabled={!canSetup} />;
  const submit = (event) => {
    event.preventDefault();
    const body = { ...form, expectedUpdatedAt: data.updatedAt };
    const result = validateWith(surveySettingsSchema, body);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) save.mutate(body);
  };
  const enabled = form.postStayEnabled || form.midStayEnabled;

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      {enabled && !data.publicBaseUrl && (
        <Alert tone="warning" title="Bağlantı adresi yok">
          Anket bağlantısı otelin herkese açık adresiyle kurulur; misafir portalı ayarlarında adres girilmeden anket gitmez.{' '}
          <Link to="/on-buro/online-check-in/ayarlar" className="font-semibold hover:underline">
            Misafir portalı ayarları
          </Link>
        </Alert>
      )}
      {enabled && !data.channelsEnabled && <Alert tone="warning">Açık bildirim kanalı yok (e-posta / SMS): anketler gitmez. Ayarlar → Bildirimler.</Alert>}
      {!data.ai.available && <Alert tone="info">Yorumların AI etiketi ve dönem özeti kapalı: {data.ai.reason} Anket, NPS ve rapor AI'sız da tam çalışır.</Alert>}

      <Card title="Çıkış sonrası anket" description="Çıkış yapmış misafire, çıkış gününden sonra ayardaki saatte gider (en fazla iki gün geç).">
        <div className="flex flex-col gap-4">
          <Checkbox label="Çıkış sonrası anket açık" checked={form.postStayEnabled} onChange={set('postStayEnabled')} disabled={!canSetup} />
          <div className="grid gap-4 sm:grid-cols-2">
            {field('postStayDelayDays', 'Çıkıştan kaç gün sonra', `${limit('postStayDelayDays')}; 0: aynı gün`)}
            {field('postStaySendHour', 'Gönderim saati (otel saatiyle)', `${limit('postStaySendHour')}`)}
          </div>
        </div>
      </Card>

      <Card title="Ara anket" description="İçerideki misafire girişin ertesi günü 1–2 soru: sorun konaklama bitmeden çözülsün. Düşük puan resepsiyonun ziline kritik uyarı düşer.">
        <div className="flex flex-col gap-4">
          <Checkbox label="Ara anket açık" checked={form.midStayEnabled} onChange={set('midStayEnabled')} disabled={!canSetup} />
          <div className="grid gap-4 sm:grid-cols-2">
            {field('midStaySendHour', 'Gönderim saati (otel saatiyle)')}
            {field('midStayMinNights', 'En kısa konaklama (gece)', `${limit('midStayMinNights')}; daha kısaya gitmez`)}
          </div>
        </div>
      </Card>

      <Card title="Gönderim kuralları ve düşük puan" description="Düşük puan takip kaydı açar: kim aradı, ne yapıldı, nasıl kapandı.">
        <div className="grid gap-4 sm:grid-cols-2">
          {field('minDaysBetweenSurveys', 'Aynı misafire en az kaç gün arayla', `${limit('minDaysBetweenSurveys')}; sık gelen misafir her konaklamada anket almasın`)}
          {field('linkValidDays', 'Bağlantı kaç gün geçerli')}
          {field('lowNpsThreshold', 'NPS bu ve altıysa düşük', `${limit('lowNpsThreshold')}; sektörde 0–6 "eleştiren"`)}
          {field('lowRatingThreshold', 'Herhangi bir puan bu ve altıysa düşük', `${limit('lowRatingThreshold')} (1–5 ölçeğinde)`)}
        </div>
      </Card>

      <Card title="Yorum bağlantıları" description="Anketi bitiren her misafire, puanından bağımsız gösterilir. Yalnız memnunlara göstermek Google kurallarına aykırıdır.">
        <div className="grid gap-4 sm:grid-cols-2">
          <HintedInput label="Google yorum bağlantısı" value={form.googleReviewUrl} onChange={set('googleReviewUrl')} error={errors.googleReviewUrl} placeholder="https://g.page/r/…/review" disabled={!canSetup} />
          <HintedInput label="TripAdvisor bağlantısı" value={form.tripadvisorReviewUrl} onChange={set('tripadvisorReviewUrl')} error={errors.tripadvisorReviewUrl} placeholder="https://www.tripadvisor.com/…" disabled={!canSetup} />
        </div>
      </Card>

      {canSetup && (
        <div className="flex justify-end">
          <Button type="submit" icon="check" disabled={save.isPending}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      )}
    </form>
  );
}
