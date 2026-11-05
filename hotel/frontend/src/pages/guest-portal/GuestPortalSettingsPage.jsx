import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GUEST_PORTAL_DEFAULT_TEXTS,
  GUEST_PORTAL_LANGUAGES,
  GUEST_PORTAL_LANGUAGE_LABELS,
  GUEST_PORTAL_SETTING_LIMITS,
  GUEST_PORTAL_TEXT_KEYS,
  GUEST_PORTAL_TEXT_LABELS,
  GUEST_PORTAL_TEXT_MAX,
  guestPortalSettingsSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Checkbox, Input, Spinner, Textarea } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { api, apiPut } from '../../lib/api.js';
import { guestPortalKeys } from '../../lib/guestPortal.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Alanın altında açıklama satırı. @param {{ hint?: string } & Record<string, any>} props */
function HintedInput({ hint, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      <Input {...props} />
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/** @param {any} data */
const toForm = (data) => ({
  enabled: data.enabled,
  publicBaseUrl: data.publicBaseUrl ?? (typeof window !== 'undefined' ? window.location.origin : ''),
  inviteDaysBefore: String(data.inviteDaysBefore),
  checkinOpenDays: String(data.checkinOpenDays),
  documentRetentionDays: String(data.documentRetentionDays),
  texts: data.texts,
});

/**
 * Misafir portalı ayarları (modül 53): portal açık mı, davet bağlantısının adresi, davet / açılış günleri, belge
 * fotoğraflarının saklama süresi (KVKK) ve misafire gösterilen metinler (dört dil; boş bırakılan varsayılan metne düşer).
 */
export function GuestPortalSettingsPage() {
  const queryClient = useQueryClient();
  const canSetup = useCan()(PERMISSIONS.GUEST_PORTAL_SETUP);
  const query = useQuery({ queryKey: guestPortalKeys.settings, queryFn: () => api('/guest-portal/settings') });
  const [form, setForm] = useState(null);
  const [language, setLanguage] = useState('tr');
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (query.data && !form) setForm(toForm(query.data));
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (body) => apiPut('/guest-portal/settings', body),
    onSuccess: (data) => {
      queryClient.setQueryData(guestPortalKeys.settings, data);
      setForm(toForm(data));
      toastSuccess('Misafir portalı ayarları kaydedildi');
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') {
        setForm(null);
        queryClient.invalidateQueries({ queryKey: guestPortalKeys.settings });
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
  const setText = (key) => (event) => setForm((current) => ({ ...current, texts: { ...current.texts, [language]: { ...current.texts[language], [key]: event.target.value } } }));
  const submit = (event) => {
    event.preventDefault();
    const result = validateWith(guestPortalSettingsSchema, { ...form, expectedUpdatedAt: data.updatedAt });
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) save.mutate({ ...form, expectedUpdatedAt: data.updatedAt });
  };
  const limit = (key) => `${GUEST_PORTAL_SETTING_LIMITS[key].min}–${GUEST_PORTAL_SETTING_LIMITS[key].max}`;
  const missing = data.missingTexts.filter((row) => row.language === language).map((row) => GUEST_PORTAL_TEXT_LABELS[row.key]);

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      <div className="flex items-center justify-between gap-3">
        <Link to="/on-buro/online-check-in" className="text-sm font-semibold text-ink-soft hover:text-ink">
          ← Online check-in
        </Link>
      </div>
      <Card title="Portal ve davet" description="Misafir rezervasyonuna özel bağlantıyla portala girer: online check-in, folyo, istek ve oda servisi.">
        <div className="flex flex-col gap-4">
          <Checkbox label="Misafir portalı açık" checked={form.enabled} onChange={set('enabled')} disabled={!canSetup} hint="Kapalıyken bağlantılar açılmaz, davet gitmez." />
          <HintedInput
            label="Portal adresi (davet bağlantısının tabanı)"
            value={form.publicBaseUrl}
            onChange={set('publicBaseUrl')}
            error={errors.publicBaseUrl}
            placeholder="https://hotel.flexai.tr"
            hint="Panelin misafirin açabileceği adresi, yol olmadan. Boşsa otomatik davet gitmez; personel bağlantıyı yine kopyalayabilir."
            disabled={!canSetup}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <HintedInput label="Davet: girişten kaç gün önce" inputMode="numeric" value={form.inviteDaysBefore} onChange={set('inviteDaysBefore')} error={errors.inviteDaysBefore} hint={`${limit('inviteDaysBefore')}; 0: yalnız elle`} disabled={!canSetup} />
            <HintedInput label="Online check-in kaç gün önce açılır" inputMode="numeric" value={form.checkinOpenDays} onChange={set('checkinOpenDays')} error={errors.checkinOpenDays} hint={limit('checkinOpenDays')} disabled={!canSetup} />
            <HintedInput
              label="Belge fotoğrafı saklama (gün)"
              inputMode="numeric"
              value={form.documentRetentionDays}
              onChange={set('documentRetentionDays')}
              error={errors.documentRetentionDays}
              hint={`${limit('documentRetentionDays')}; çıkıştan (gelmeyende girişten) sonra silinir`}
              disabled={!canSetup}
            />
          </div>
          {!data.webchat.enabled ? (
            <Alert tone="info">Web sohbeti kapalı: portalda sohbet düğmesi görünmez (Ayarlar → Mesaj kanalları).</Alert>
          ) : !data.webchat.originAllowed ? (
            <Alert tone="warning">Portalda sohbetin açılması için portal adresini web sohbeti kanalının izinli site adreslerine ekleyin (Ayarlar → Mesaj kanalları).</Alert>
          ) : null}
        </div>
      </Card>

      <Card title="Misafire gösterilen metinler" description="Boş bırakılan metin varsayılan metne düşer (otelin giriş / çıkış saatiyle). KVKK metnini veri sorumlusu bilgilerinizle hukukçunuza gözden geçirtin.">
        <div className="flex flex-col gap-4">
          <ChoiceChips label="Dil" options={GUEST_PORTAL_LANGUAGES.map((value) => ({ value, label: GUEST_PORTAL_LANGUAGE_LABELS[value] }))} value={language} onChange={setLanguage} />
          {missing.length > 0 && <Alert tone="warning">Bu dilde boş: {missing.join(', ')}. Başka bir dilde kendi metninizi yazdınız; bu dilde otelin İngilizce metni ya da genel varsayılan görünür.</Alert>}
          {GUEST_PORTAL_TEXT_KEYS.map((key) => (
            <Textarea
              key={`${language}-${key}`}
              label={GUEST_PORTAL_TEXT_LABELS[key]}
              rows={key === 'welcome' ? 2 : 6}
              maxLength={GUEST_PORTAL_TEXT_MAX[key]}
              value={form.texts[language]?.[key] ?? ''}
              onChange={setText(key)}
              error={errors[`texts.${language}.${key}`]}
              placeholder={GUEST_PORTAL_DEFAULT_TEXTS[language][key]}
              disabled={!canSetup}
            />
          ))}
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
