import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SPA_SLOT_OPTIONS, spaSettingsSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Checkbox, Input, Select, Spinner } from '@hotelos/ui';
import { api, apiPut } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { spaKeys } from '../../lib/spa.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** @param {any} settings */
const toForm = (settings) => ({
  openTime: settings.openTime,
  closeTime: settings.closeTime,
  slotMinutes: String(settings.slotMinutes),
  freeCancelHours: String(settings.freeCancelHours),
  lateCancelFeePct: String(Number(settings.lateCancelFeePct)),
  noShowFeePct: String(Number(settings.noShowFeePct)),
  portalEnabled: settings.portalEnabled,
  portalLeadMinutes: String(settings.portalLeadMinutes),
  portalMaxActive: String(settings.portalMaxActive),
  reminderHours: String(settings.reminderHours),
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
 * Spa ayarları (modül 57): açılış / kapanış ve takvim aralığı, iptal ve gelmedi politikası, misafir portalından
 * randevu, hatırlatma. Herkes görür; değiştirmek `spa.setup` ister. İlk kayıtta satır yoktur (varsayılanlar gösterilir).
 */
export function SpaSettingsPage() {
  const canSetup = useCan()(PERMISSIONS.SPA_SETUP);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: spaKeys.settings, queryFn: () => api('/spa/settings') });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (query.data && !form) setForm(toForm(query.data.settings));
  }, [query.data, form]);
  const save = useMutation({
    mutationFn: (body) => apiPut('/spa/settings', body),
    onSuccess: (data) => {
      queryClient.setQueryData(spaKeys.settings, data);
      queryClient.invalidateQueries({ queryKey: spaKeys.all });
      setForm(toForm(data.settings));
      toastSuccess('Spa ayarları kaydedildi');
    },
    onError: (error) => {
      if (error.fields) setErrors(error.fields);
      toastError(error.message);
      if (error.code === 'STALE_WRITE') {
        setForm(null);
        queryClient.invalidateQueries({ queryKey: spaKeys.settings });
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
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const field = (key, label, hint, extra = {}) => <HintedInput label={label} inputMode="numeric" value={form[key]} onChange={set(key)} error={errors[key]} hint={hint} disabled={!canSetup} {...extra} />;
  function submit(event) {
    event.preventDefault();
    const body = { ...form, expectedUpdatedAt: query.data.settings.updatedAt };
    const checked = validateWith(spaSettingsSchema, body);
    setErrors(checked.ok ? {} : checked.errors);
    if (checked.ok) save.mutate(body);
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      {!query.data.settings.updatedAt && <Alert tone="info">Ayarlar henüz kaydedilmedi; aşağıdakiler varsayılan değerlerdir ve bu hâliyle geçerlidir.</Alert>}

      <Card title="Çalışma saatleri ve takvim" description="Randevu bu saatler arasında verilir; hizmet kapanıştan önce bitmelidir. Terapistlerin kendi çalışma saatleri Tanımlar → Ekip'tedir.">
        <div className="grid gap-4 sm:grid-cols-3">
          <HintedInput label="Açılış" type="time" step={900} value={form.openTime} onChange={set('openTime')} error={errors.openTime} disabled={!canSetup} />
          <HintedInput label="Kapanış" type="time" step={900} value={form.closeTime === '24:00' ? '23:59' : form.closeTime} onChange={set('closeTime')} error={errors.closeTime} disabled={!canSetup} />
          <Select label="Randevu aralığı" value={form.slotMinutes} onChange={set('slotMinutes')} error={errors.slotMinutes} disabled={!canSetup} options={SPA_SLOT_OPTIONS.map((minutes) => ({ value: String(minutes), label: `${minutes} dakika` }))} />
        </div>
      </Card>

      <Card title="İptal ve gelmedi" description="Bedel randevunun fiyatı üzerinden hesaplanır: misafir içerideyse oda hesabına yazılır, değilse bakiyede kalır. Yetkili gerekçeyle silebilir.">
        <div className="grid gap-4 sm:grid-cols-3">
          {field('freeCancelHours', 'Ücretsiz iptal süresi (saat)', 'Randevudan bu kadar saat öncesine kadar iptal bedelsiz. 0: randevu saatine kadar hep bedelsiz.')}
          {field('lateCancelFeePct', 'Geç iptal bedeli (%)', 'Süre geçtikten sonraki iptal.', { inputMode: 'decimal' })}
          {field('noShowFeePct', 'Gelmedi bedeli (%)', 'Haber vermeden gelmeyen misafir.', { inputMode: 'decimal' })}
        </div>
      </Card>

      <Card title="Misafir portalından randevu" description="Misafir yalnız konaklama günlerine ve gerçekten boş saatlere randevu alır; randevu anında kesinleşir, terapist ve oda otomatik atanır, spa'ya zil düşer.">
        <div className="flex flex-col gap-4">
          <Checkbox label="Portaldan randevu açık" hint="Hizmet bazında kapatmak için Tanımlar → Hizmetler'de 'Portaldan alınabilir' işaretini kaldırın." checked={form.portalEnabled} onChange={set('portalEnabled')} disabled={!canSetup} />
          <div className="grid gap-4 sm:grid-cols-2">
            {field('portalLeadMinutes', 'En az kaç dakika önceden', 'Misafir şimdiden bu kadar sonrasına randevu alabilir (hazırlık süresi).')}
            {field('portalMaxActive', 'Konaklama başına açık randevu', 'Aynı anda en çok bu kadar açık randevu / ders kaydı.')}
          </div>
        </div>
      </Card>

      <Card title="Hatırlatma" description='Konaklamaya bağlı randevuya, bildirim kanalları ve "Spa randevu hatırlatması" şablonuyla gider (Ayarlar → Bildirimler). Onay bildirimi randevu açılınca ayrıca gider.'>
        <div className="grid gap-4 sm:grid-cols-2">{field('reminderHours', 'Randevudan kaç saat önce', '0: hatırlatma gönderilmez. Bu süreden kısa süre kala alınan randevuya hatırlatma gitmez.')}</div>
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
