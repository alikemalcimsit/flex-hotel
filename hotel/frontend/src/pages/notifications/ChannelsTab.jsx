import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  channelConfigSchema,
  MAX_SMS_HEADER_LENGTH,
  NOTIFICATION_CHANNEL_LABELS,
  SMS_PROVIDER_LABELS,
  SMS_PROVIDERS,
  SMTP_SECURITY_LABELS,
  SMTP_SECURITY_MODES,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Icon, Input, Select } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiPut } from '../../lib/api.js';
import { notificationKeys } from '../../lib/notifications.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ChannelTestDialog } from './ChannelTestDialog.jsx';

const SECURITY_OPTIONS = SMTP_SECURITY_MODES.map((value) => ({ value, label: SMTP_SECURITY_LABELS[value] }));
const PROVIDER_OPTIONS = SMS_PROVIDERS.map((value) => ({ value, label: SMS_PROVIDER_LABELS[value] }));

/** Güvenlik seçilince önerilen port (kullanıcı portu elle değiştirmediyse). */
const DEFAULT_PORTS = Object.freeze({ TLS: 465, STARTTLS: 587, NONE: 25 });

/**
 * Bildirim kanalları: otelin kendi SMTP ve SMS hesabı.
 *
 * - Parolalar sunucuda şifreli durur ve ekrana hiç gelmez; alan boş
 *   bırakılırsa kayıtlı parola korunur.
 * - "Test gönder" kayıtlı ayarla gerçek bir ileti yollar; sonuç kanalda
 *   saklanır. Kanal kapalıyken de test yapılabilir (açmadan önce denemek için).
 * - Son gönderim hatası (ör. parola değişmiş) kanalın üstünde görünür.
 */
export function ChannelsTab() {
  const query = useQuery({
    queryKey: notificationKeys.channels,
    queryFn: () => api('/notifications/channels'),
  });
  const [testChannel, setTestChannel] = useState(null);

  if (!query.data) return <QueryFallback query={query} errorTitle="Kanal ayarları yüklenemedi" />;

  const { items, secretKeyConfigured } = query.data;
  const byChannel = Object.fromEntries(items.map((item) => [item.channel, item]));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      {!secretKeyConfigured && (
        <Alert tone="danger" title="Sunucuda şifreleme anahtarı tanımlı değil">
          Parolalar şifrelenmeden saklanmaz; bu yüzden kanal parolası kaydedilemiyor. Sunucu yöneticisi ortam dosyasına
          <code className="mx-1 rounded bg-black/[0.06] px-1">SETTINGS_SECRET_KEY</code>
          eklemeli (üretme komutu <code className="rounded bg-black/[0.06] px-1">.env.example</code> içinde).
        </Alert>
      )}

      <EmailChannelCard key={`EMAIL:${byChannel.EMAIL.updatedAt}`} item={byChannel.EMAIL} onTest={setTestChannel} />
      <SmsChannelCard key={`SMS:${byChannel.SMS.updatedAt}`} item={byChannel.SMS} onTest={setTestChannel} />
      <WhatsAppChannelCard key={`WHATSAPP:${byChannel.WHATSAPP.updatedAt}`} item={byChannel.WHATSAPP} />

      {testChannel && (
        <ChannelTestDialog key={testChannel} channel={testChannel} onClose={() => setTestChannel(null)} />
      )}
    </div>
  );
}

/**
 * Kanal formlarının ortak durumu: alanlar, hatalar, kaydetme.
 * @param {object} item
 * @param {object} initial
 */
function useChannelForm(item, initial) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});

  const mutation = useMutation({
    mutationFn: (values) => apiPut(`/notifications/channels/${item.channel}`, values),
    onSuccess: (saved) => {
      queryClient.setQueryData(notificationKeys.channels, (current) =>
        current
          ? { ...current, items: current.items.map((entry) => (entry.channel === saved.channel ? saved : entry)) }
          : current,
      );
      queryClient.invalidateQueries({ queryKey: notificationKeys.templates });
      toastSuccess(`${NOTIFICATION_CHANNEL_LABELS[item.channel]} ayarı kaydedildi`);
    },
    onError: (error) => {
      toastError(error.message);
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: notificationKeys.channels });
    },
  });

  const setField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const dirty = Object.keys(initial).some((field) => form[field] !== initial[field]);

  /** @param {object} values gönderilecek alanlar */
  function save(values) {
    const payload = {
      ...values,
      channel: item.channel,
      // Boş parola: kayıtlı olan korunur.
      ...(values.password ? { password: values.password } : { password: undefined }),
      expectedUpdatedAt: item.updatedAt,
    };
    const result = validateWith(channelConfigSchema, payload);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }

  return { form, setForm, errors, setField, dirty, save, mutation };
}

/**
 * @param {{
 *   item: object,
 *   title: string,
 *   description: string,
 *   children: React.ReactNode,
 *   footer?: React.ReactNode,
 * }} props
 */
function ChannelCard({ item, title, description, children, footer }) {
  const { timeZone } = useHotelToday();
  const failureCurrent = failureStillRelevant(item);
  return (
    <Card
      title={title}
      description={description}
      actions={<Badge tone={item.enabled ? 'success' : 'neutral'}>{item.enabled ? 'Açık' : 'Kapalı'}</Badge>}
    >
      <div className="flex flex-col gap-5">
        {(item.lastTestAt || failureCurrent) && (
          <div className="flex flex-col gap-2">
            {failureCurrent && (
              <Alert tone="danger" title={`Son gönderim hatası · ${formatDateTime(item.lastFailureAt, timeZone)}`}>
                {item.lastFailureError}
              </Alert>
            )}
            {item.lastTestAt && (
              <p
                className={`flex items-center gap-2 text-xs font-semibold ${
                  item.lastTestOk ? 'text-success-ink' : 'text-sec-strong'
                }`}
              >
                <Icon name={item.lastTestOk ? 'checkCircle' : 'alertCircle'} className="size-4" />
                Son test {formatDateTime(item.lastTestAt, timeZone)}:{' '}
                {item.lastTestOk ? 'başarılı' : `başarısız — ${item.lastTestError ?? 'bilinmeyen hata'}`}
              </p>
            )}
          </div>
        )}
        {children}
        {footer && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">{footer}</div>}
      </div>
    </Card>
  );
}

/**
 * Son gönderim hatası hâlâ geçerli mi? Sonrasında ayar değiştiyse ya da test
 * başarılı olduysa eski hata gösterilmez.
 * @param {{ lastFailureAt: string | null, updatedAt: string | null, secretUpdatedAt: string | null, lastTestAt: string | null, lastTestOk: boolean | null }} item
 */
function failureStillRelevant(item) {
  if (!item.lastFailureAt) return false;
  const failedAt = Date.parse(item.lastFailureAt);
  const after = (value) => Boolean(value) && Date.parse(value) > failedAt;
  if (after(item.updatedAt) || after(item.secretUpdatedAt)) return false;
  return !(item.lastTestOk && after(item.lastTestAt));
}

/**
 * Parola alanı: kayıtlı parola hiç gösterilmez; yazılırsa değiştirilir.
 * @param {{ name: string, label: string, hasSecret: boolean, secretUpdatedAt: string | null, value: string, error?: string, onChange: Function }} props
 */
function SecretInput({ name, label, hasSecret, secretUpdatedAt, value, error, onChange }) {
  const { timeZone } = useHotelToday();
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        label={label}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder={hasSecret ? 'Kayıtlı — değiştirmek için yazın' : ''}
        value={value}
        error={error}
        onChange={onChange}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((shown) => !shown)}
            aria-label={visible ? 'Parolayı gizle' : 'Parolayı göster'}
            aria-pressed={visible}
            className="grid size-9 place-items-center rounded-item text-ink-muted transition-colors duration-200 hover:bg-black/[0.05] hover:text-ink"
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} className="size-[18px]" />
          </button>
        }
      />
      <span className="flex items-center gap-1.5 text-xs text-ink-muted">
        <Icon name="lock" className="size-3.5" />
        {hasSecret
          ? `Parola şifreli kayıtlı${secretUpdatedAt ? ` (${formatDateTime(secretUpdatedAt, timeZone)})` : ''}. Boş bırakırsanız değişmez.`
          : 'Henüz parola kaydedilmedi.'}
      </span>
    </div>
  );
}

function TestButton({ item, dirty, onTest }) {
  const blocked = !item.updatedAt ? 'Önce ayarı kaydedin' : dirty ? 'Kaydedilmemiş değişiklik var; test kayıtlı ayarla yapılır' : null;
  return (
    <>
      {blocked && <span className="text-xs text-ink-muted">{blocked}</span>}
      <Button type="button" variant="outline" icon="send" disabled={Boolean(blocked)} onClick={() => onTest(item.channel)}>
        Test gönder
      </Button>
    </>
  );
}

function SaveButton({ mutation, dirty }) {
  return (
    <Button type="submit" icon="check" disabled={mutation.isPending || !dirty}>
      {mutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
    </Button>
  );
}

/** @param {{ item: object, onTest: (channel: string) => void }} props */
function EmailChannelCard({ item, onTest }) {
  const { settings } = item;
  const { form, setForm, errors, setField, dirty, save, mutation } = useChannelForm(item, {
    enabled: item.enabled,
    host: settings.host,
    port: String(settings.port),
    security: settings.security,
    username: settings.username,
    password: '',
    fromName: settings.fromName,
    fromAddress: settings.fromAddress,
    replyTo: settings.replyTo,
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(form);
      }}
    >
      <ChannelCard
        item={item}
        title="E-posta (SMTP)"
        description="Otelin kendi e-posta hesabı. Sunucu bilgileri e-posta sağlayıcınızın (Google Workspace, Yandex, hosting firması) SMTP ayarlarındadır."
        footer={
          <>
            <TestButton item={item} dirty={dirty} onTest={onTest} />
            <SaveButton mutation={mutation} dirty={dirty} />
          </>
        }
      >
        <Checkbox
          id="email-enabled"
          label="E-posta bildirimleri gönderilsin"
          hint="Kapalıyken sıraya e-posta girmez; test yine yapılabilir."
          checked={form.enabled}
          onChange={setField('enabled')}
        />
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
          <Input label="SMTP sunucusu" name="email-host" placeholder="smtp.alanadiniz.com" value={form.host} error={errors.host} onChange={setField('host')} />
          <Input label="Port" name="email-port" inputMode="numeric" value={form.port} error={errors.port} onChange={setField('port')} />
          <Select
            label="Bağlantı güvenliği"
            name="email-security"
            value={form.security}
            options={SECURITY_OPTIONS}
            error={errors.security}
            onChange={(event) => {
              const security = event.target.value;
              setForm((current) => ({
                ...current,
                security,
                // Port hâlâ önceki modun varsayılanıysa yenisine geçer.
                port: current.port === String(DEFAULT_PORTS[current.security]) ? String(DEFAULT_PORTS[security]) : current.port,
              }));
            }}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Kullanıcı adı"
            name="email-username"
            autoComplete="off"
            placeholder="bildirim@alanadiniz.com"
            value={form.username}
            error={errors.username}
            onChange={setField('username')}
          />
          <SecretInput
            name="email-password"
            label="Parola"
            hasSecret={item.hasSecret}
            secretUpdatedAt={item.secretUpdatedAt}
            value={form.password}
            error={errors.password}
            onChange={setField('password')}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Input label="Gönderen adı" name="email-from-name" placeholder="Otelin adı" value={form.fromName} error={errors.fromName} onChange={setField('fromName')} />
          <Input
            label="Gönderen adresi"
            name="email-from-address"
            type="email"
            value={form.fromAddress}
            error={errors.fromAddress}
            onChange={setField('fromAddress')}
          />
          <Input
            label="Yanıt adresi (isteğe bağlı)"
            name="email-reply-to"
            type="email"
            placeholder="rezervasyon@alanadiniz.com"
            value={form.replyTo}
            error={errors.replyTo}
            onChange={setField('replyTo')}
          />
        </div>
      </ChannelCard>
    </form>
  );
}

/** @param {{ item: object, onTest: (channel: string) => void }} props */
function SmsChannelCard({ item, onTest }) {
  const { settings } = item;
  const { form, errors, setField, dirty, save, mutation } = useChannelForm(item, {
    enabled: item.enabled,
    provider: settings.provider,
    username: settings.username,
    password: '',
    sender: settings.sender,
    quietHoursStart: settings.quietHoursStart ?? '',
    quietHoursEnd: settings.quietHoursEnd ?? '',
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(form);
      }}
    >
      <ChannelCard
        item={item}
        title="SMS"
        description="Otelin SMS sağlayıcı hesabı. Gönderici başlığı sağlayıcıda onaylı olmalıdır; bildirimler bilgilendirme amaçlıdır (ticari ileti izni gerekmez)."
        footer={
          <>
            <TestButton item={item} dirty={dirty} onTest={onTest} />
            <SaveButton mutation={mutation} dirty={dirty} />
          </>
        }
      >
        <Checkbox
          id="sms-enabled"
          label="SMS bildirimleri gönderilsin"
          hint="Kapalıyken sıraya SMS girmez; test yine yapılabilir."
          checked={form.enabled}
          onChange={setField('enabled')}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Select
            label="Sağlayıcı"
            name="sms-provider"
            value={form.provider}
            options={PROVIDER_OPTIONS}
            error={errors.provider}
            onChange={setField('provider')}
          />
          <Input
            label="Gönderici başlığı"
            name="sms-sender"
            maxLength={MAX_SMS_HEADER_LENGTH}
            placeholder="OTELADI"
            value={form.sender}
            error={errors.sender}
            onChange={setField('sender')}
          />
          <Input
            label="Kullanıcı kodu"
            name="sms-username"
            autoComplete="off"
            placeholder="850XXXXXXX"
            value={form.username}
            error={errors.username}
            onChange={setField('username')}
          />
          <SecretInput
            name="sms-password"
            label="API parolası"
            hasSecret={item.hasSecret}
            secretUpdatedAt={item.secretUpdatedAt}
            value={form.password}
            error={errors.password}
            onChange={setField('password')}
          />
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-bold text-ink">Sessiz saatler (isteğe bağlı)</legend>
          <p className="text-xs text-ink-muted">
            Bu saatler arasında sıraya giren SMS, bitiş saatinde gönderilir (otel saatiyle). Gece geç saatte oda
            atanan misafir uyandırılmaz. Boş bırakılırsa her saatte gönderilir.
          </p>
          <div className="grid max-w-md gap-5 sm:grid-cols-2">
            <Input
              label="Başlangıç"
              name="sms-quiet-start"
              type="time"
              value={form.quietHoursStart}
              error={errors.quietHoursStart}
              onChange={setField('quietHoursStart')}
            />
            <Input
              label="Bitiş"
              name="sms-quiet-end"
              type="time"
              value={form.quietHoursEnd}
              error={errors.quietHoursEnd}
              onChange={setField('quietHoursEnd')}
            />
          </div>
        </fieldset>
      </ChannelCard>
    </form>
  );
}

/** @param {{ item: object }} props */
function WhatsAppChannelCard({ item }) {
  const { form, setField, dirty, save, mutation } = useChannelForm(item, { enabled: item.enabled });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save({ enabled: form.enabled });
      }}
    >
      <ChannelCard
        item={item}
        title="WhatsApp"
        description="Otelin WhatsApp Business hattı üzerinden bildirim."
        footer={item.available ? <SaveButton mutation={mutation} dirty={dirty} /> : undefined}
      >
        {item.available ? (
          <Checkbox
            id="whatsapp-enabled"
            label="WhatsApp bildirimleri gönderilsin"
            hint="Metinler Şablonlar sekmesinde; Meta onayı geçit tarafında yürür."
            checked={form.enabled}
            onChange={setField('enabled')}
          />
        ) : (
          <Alert tone="info" title="WhatsApp bildirimleri henüz yok">
            WhatsApp hattı misafirle mesajlaşma için bağlanır (Ayarlar → Mesaj kanalları). Otelin başlattığı bildirim
            (rezervasyon onayı, hatırlatma) WhatsApp kuralı gereği Meta onaylı şablon ister; şablon gönderimi eklenene
            kadar bildirimler e-posta ve SMS ile gider.
          </Alert>
        )}
      </ChannelCard>
    </form>
  );
}
