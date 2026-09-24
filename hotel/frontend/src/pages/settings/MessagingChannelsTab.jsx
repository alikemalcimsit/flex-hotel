import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_ALLOWED_ORIGINS, webchatChannelSchema, whatsappChannelSchema } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Icon, Input, Textarea } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { API_URL, api, apiPost, apiPut } from '../../lib/api.js';
import { messagingChannelKeys, webhookUrl, widgetSnippet } from '../../lib/concierge.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { formatDateTime } from '../../lib/timeFormat.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Webhook doğrulama token'ı üretilirken kullanılan uzunluk (bayt). */
const VERIFY_TOKEN_BYTES = 24;

/**
 * Mesaj kanalları (modül 8): misafirin otele yazdığı WhatsApp hattı ve web
 * sitesindeki sohbet balonu. Gelen mesajlar Mesajlar ekranına düşer; AI
 * açıksa asistan cevap verir.
 *
 * Sırlar (erişim token'ı, uygulama sırrı, doğrulama token'ı) sunucuda şifreli
 * durur ve ekrana hiç gelmez; alan boş bırakılırsa kayıtlı olan korunur.
 */
export function MessagingChannelsTab() {
  const query = useQuery({ queryKey: messagingChannelKeys.all, queryFn: () => api('/messaging-channels') });
  if (!query.data) return <QueryFallback query={query} errorTitle="Mesaj kanalları yüklenemedi" />;
  const { whatsapp, webchat } = query.data;
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <WhatsAppCard key={`wa:${whatsapp.updatedAt}`} item={whatsapp} />
      <WebchatCard key={`wc:${webchat.updatedAt}:${webchat.publicKey}`} item={webchat} />
    </div>
  );
}

/**
 * Ortak form durumu: alanlar, hatalar, kaydetme.
 * @param {{ initial: object, path: string, schema: object, label: string }} options
 */
function useChannelForm({ initial, path, schema, label }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const mutation = useMutation({
    mutationFn: (values) => apiPut(`/messaging-channels/${path}`, values),
    onSuccess: (saved) => {
      queryClient.setQueryData(messagingChannelKeys.all, (current) => (current ? { ...current, [path]: saved } : current));
      toastSuccess(`${label} ayarı kaydedildi`);
    },
    onError: (error) => {
      toastError(error.message);
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: messagingChannelKeys.all });
    },
  });
  const setField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const dirty = Object.keys(initial).some((field) => form[field] !== initial[field]);

  /** @param {object} payload */
  function save(payload) {
    const result = validateWith(schema, payload);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    mutation.mutate(payload);
  }
  return { form, setForm, errors, setField, dirty, save, mutation };
}

/** Panoya kopyalar; tarayıcı izin vermezse kullanıcı elle seçer. @param {string} text */
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess('Kopyalandı');
  } catch {
    toastError('Kopyalanamadı; metni seçip elle kopyalayın');
  }
}

/** @param {{ label: string, value: string, name: string, multiline?: boolean }} props */
function CopyField({ label, value, name, multiline = false }) {
  const Field = multiline ? Textarea : Input;
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} name={name} value={value} readOnly rows={multiline ? 2 : undefined} onFocus={(event) => event.target.select()} className="font-mono" />
      <div>
        <Button type="button" variant="outline" size="sm" icon="clipboard" onClick={() => copy(value)}>
          Kopyala
        </Button>
      </div>
    </div>
  );
}

/**
 * Sır alanı: kayıtlı değer hiç gösterilmez; yazılırsa değiştirilir.
 * @param {{ name: string, label: string, saved: boolean, value: string, error?: string, onChange: Function, action?: React.ReactNode }} props
 */
function SecretInput({ name, label, saved, value, error, onChange, action }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        label={label}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder={saved ? 'Kayıtlı — değiştirmek için yazın' : ''}
        value={value}
        error={error}
        onChange={onChange}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((shown) => !shown)}
            aria-label={visible ? 'Gizle' : 'Göster'}
            aria-pressed={visible}
            className="grid size-9 place-items-center rounded-item text-ink-muted transition-colors duration-200 hover:bg-black/[0.05] hover:text-ink"
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} className="size-[18px]" />
          </button>
        }
      />
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        <Icon name="lock" className="size-3.5" />
        {saved ? 'Şifreli kayıtlı. Boş bırakırsanız değişmez.' : 'Henüz kaydedilmedi.'}
        {action}
      </span>
    </div>
  );
}

function SaveButton({ mutation, dirty, canManage }) {
  if (!canManage) return null;
  return (
    <Button type="submit" icon="check" disabled={mutation.isPending || !dirty}>
      {mutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
    </Button>
  );
}

/** Rastgele doğrulama token'ı (Meta panelindeki "Verify token" ile aynı girilir). */
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(VERIFY_TOKEN_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/* ─────────────── WhatsApp ─────────────── */

/** @param {{ item: object }} props */
function WhatsAppCard({ item }) {
  const { timeZone } = useHotelToday();
  const canManage = useCan()(PERMISSIONS.SETTINGS_MANAGE);
  const { form, setForm, errors, setField, dirty, save, mutation } = useChannelForm({
    initial: {
      enabled: item.enabled,
      phoneNumberId: item.phoneNumberId ?? '',
      displayPhone: item.displayPhone ?? '',
      graphVersion: item.graphVersion ?? '',
      accessToken: '',
      appSecret: '',
      verifyToken: '',
    },
    path: 'whatsapp',
    schema: whatsappChannelSchema,
    label: 'WhatsApp',
  });
  const status = item.enabled ? (item.lastError ? { tone: 'warning', label: 'Açık · hata var' } : { tone: 'success', label: 'Açık' }) : { tone: 'neutral', label: 'Kapalı' };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save({ ...form, expectedUpdatedAt: item.updatedAt });
      }}
    >
      <Card
        title="WhatsApp Business"
        description="Misafirin otelin WhatsApp hattına yazdığı mesajlar Mesajlar ekranına düşer; cevaplar (sizin ya da AI'ın) aynı hattan gider. Meta WhatsApp Cloud API ile bağlanır."
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      >
        <fieldset disabled={!canManage || mutation.isPending} className="flex flex-col gap-5">
          {!item.secretReadable && (
            <Alert tone="danger" title="Kayıtlı sırlar okunamıyor">
              Sunucunun şifreleme anahtarı (SETTINGS_SECRET_KEY) eksik ya da değişmiş. Anahtar düzeltilene kadar WhatsApp'a
              mesaj gönderilemez; sırları yeniden girip kaydedebilirsiniz.
            </Alert>
          )}
          {item.lastError && (
            <Alert tone="danger" title={`Son hata${item.lastErrorAt ? ` · ${formatDateTime(item.lastErrorAt, timeZone)}` : ''}`}>
              {item.lastError}
            </Alert>
          )}
          <Checkbox
            id="whatsapp-enabled"
            label="WhatsApp hattı açık"
            hint="Kapalıyken cevaplar gönderilmez, sırada bekler; kanal açılınca gönderilir. Gelen mesajlar yine kaydedilir."
            checked={form.enabled}
            onChange={setField('enabled')}
          />
          <div className="grid gap-5 sm:grid-cols-3">
            <Input
              label="Telefon numarası kimliği"
              name="phoneNumberId"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Meta: Phone number ID"
              value={form.phoneNumberId}
              error={errors.phoneNumberId}
              onChange={setField('phoneNumberId')}
            />
            <Input
              label="Numara (gösterim)"
              name="displayPhone"
              placeholder="+90 850 000 00 00"
              value={form.displayPhone}
              error={errors.displayPhone}
              onChange={setField('displayPhone')}
            />
            <Input
              label="Graph API sürümü (isteğe bağlı)"
              name="graphVersion"
              placeholder="Boşsa varsayılan"
              value={form.graphVersion}
              error={errors.graphVersion}
              onChange={setField('graphVersion')}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <SecretInput
              name="accessToken"
              label="Erişim token'ı"
              saved={item.hasAccessToken}
              value={form.accessToken}
              error={errors.accessToken}
              onChange={setField('accessToken')}
            />
            <SecretInput
              name="appSecret"
              label="Uygulama sırrı (App secret)"
              saved={item.hasAppSecret}
              value={form.appSecret}
              error={errors.appSecret}
              onChange={setField('appSecret')}
            />
            <SecretInput
              name="verifyToken"
              label="Webhook doğrulama token'ı"
              saved={item.hasVerifyToken}
              value={form.verifyToken}
              error={errors.verifyToken}
              onChange={setField('verifyToken')}
              action={
                canManage && (
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, verifyToken: randomToken() }))}
                    className="rounded-item px-1 font-semibold text-ink-soft underline underline-offset-2 hover:text-ink"
                  >
                    Rastgele üret
                  </button>
                )
              }
            />
          </div>

          {item.webhookPath ? (
            <section aria-labelledby="wa-webhook" className="flex flex-col gap-3 rounded-control border border-line p-4">
              <h3 id="wa-webhook" className="text-sm font-bold text-ink">
                Meta'da webhook kurulumu
              </h3>
              <CopyField label="Callback URL" name="wa-webhook-url" value={webhookUrl(API_URL, item.webhookPath)} />
              <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-soft">
                <li>Meta uygulamanızda WhatsApp → Configuration → Webhook bölümünü açın.</li>
                <li>Callback URL'e yukarıdaki adresi, Verify token'a buradaki doğrulama token'ını girin.</li>
                <li>"messages" alanına abone olun. Mesajlar ve teslim bildirimleri buraya gelir.</li>
              </ol>
              <p className="text-xs text-ink-muted">
                Son gelen mesaj: {item.lastInboundAt ? formatDateTime(item.lastInboundAt, timeZone) : 'henüz yok'}. WhatsApp
                kuralı: misafir son 24 saatte yazmadıysa serbest metin gönderilemez; o cevap "gönderilemedi" olarak işaretlenir.
              </p>
            </section>
          ) : (
            <Alert tone="info">Kaydedince Meta'ya gireceğiniz webhook adresi burada görünür.</Alert>
          )}
        </fieldset>
        {canManage && (
          <div className="mt-5 flex justify-end border-t border-line pt-4">
            <SaveButton mutation={mutation} dirty={dirty} canManage={canManage} />
          </div>
        )}
      </Card>
    </form>
  );
}

/* ─────────────── Web chat ─────────────── */

/** @param {{ item: object }} props */
function WebchatCard({ item }) {
  const queryClient = useQueryClient();
  const { timeZone } = useHotelToday();
  const canManage = useCan()(PERMISSIONS.SETTINGS_MANAGE);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const { form, errors, setField, dirty, save, mutation } = useChannelForm({
    initial: {
      enabled: item.enabled,
      allowedOrigins: item.allowedOrigins.join('\n'),
      title: item.title,
      greeting: item.greeting ?? '',
      accentColor: item.accentColor,
    },
    path: 'webchat',
    schema: webchatChannelSchema,
    label: 'Web chat',
  });
  const rotate = useMutation({
    mutationFn: () => apiPost('/messaging-channels/webchat/rotate-key', { expectedUpdatedAt: item.updatedAt }),
    onSuccess: (saved) => {
      queryClient.setQueryData(messagingChannelKeys.all, (current) => (current ? { ...current, webchat: saved } : current));
      setConfirmRotate(false);
      toastSuccess('Yeni anahtar üretildi; sitedeki kodu güncelleyin');
    },
    onError: (error) => {
      toastError(error.message);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: messagingChannelKeys.all });
    },
  });
  const origins = form.allowedOrigins
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const originError = Object.entries(errors).find(([field]) => field.startsWith('allowedOrigins'))?.[1];

  return (
    <>
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save({
          enabled: form.enabled,
          allowedOrigins: origins,
          title: form.title,
          greeting: form.greeting,
          accentColor: form.accentColor,
          expectedUpdatedAt: item.updatedAt,
        });
      }}
    >
      <Card
        title="Web sitesi sohbet balonu"
        description="Otelin sitesinin köşesinde açılan sohbet. Misafirin yazdığı Mesajlar ekranına düşer; AI açıksa asistan cevap verir, rezervasyon alır."
        actions={<Badge tone={item.enabled ? 'success' : 'neutral'}>{item.enabled ? 'Açık' : 'Kapalı'}</Badge>}
      >
        <fieldset disabled={!canManage || mutation.isPending} className="flex flex-col gap-5">
          <Checkbox
            id="webchat-enabled"
            label="Balon açık"
            hint="Kapalıyken balon sitede görünür ama 'Sohbet şu anda kullanılamıyor' der."
            checked={form.enabled}
            onChange={setField('enabled')}
          />
          <Textarea
            label={`Balonun çalışacağı site adresleri (her satıra bir tane, en fazla ${MAX_ALLOWED_ORIGINS})`}
            name="allowedOrigins"
            rows={3}
            placeholder={'https://www.otelim.com\nhttps://otelim.com'}
            value={form.allowedOrigins}
            error={originError}
            onChange={setField('allowedOrigins')}
          />
          <p className="-mt-3 text-xs text-ink-muted">
            Başka bir site balonu kopyalayıp otelin AI bütçesini harcayamasın diye yalnızca bu adreslerden bağlanılır.
          </p>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_10rem]">
            <Input label="Başlık" name="title" value={form.title} error={errors.title} onChange={setField('title')} />
            <Input
              label="Karşılama mesajı (isteğe bağlı)"
              name="greeting"
              placeholder="Merhaba! Size nasıl yardımcı olabiliriz?"
              value={form.greeting}
              error={errors.greeting}
              onChange={setField('greeting')}
            />
            <div className="flex items-end gap-2">
              <Input
                label="Renk"
                name="accentColor"
                value={form.accentColor}
                error={errors.accentColor}
                onChange={setField('accentColor')}
                className="min-w-0 flex-1"
              />
              <input
                type="color"
                aria-label="Renk seç"
                value={/^#[0-9a-fA-F]{6}$/.test(form.accentColor) ? form.accentColor : '#000000'}
                onChange={setField('accentColor')}
                className="mb-0.5 h-11 w-11 shrink-0 cursor-pointer rounded-control border border-line bg-surface p-1"
              />
            </div>
          </div>
        </fieldset>

        {item.publicKey ? (
          <section aria-labelledby="wc-embed" className="mt-5 flex flex-col gap-3 rounded-control border border-line p-4">
            <h3 id="wc-embed" className="text-sm font-bold text-ink">
              Siteye eklenecek kod
            </h3>
            <CopyField label="Sitenin </body> etiketinden hemen önce" name="wc-snippet" value={widgetSnippet(API_URL, item.publicKey)} multiline />
            <p className="text-xs text-ink-muted">
              Son mesaj: {item.lastInboundAt ? formatDateTime(item.lastInboundAt, timeZone) : 'henüz yok'}. Anahtar gizli değildir
              (sitede görünür); kötüye kullanılırsa yenileyin — eski kod çalışmayı bırakır.
            </p>
            {canManage && (
              <div>
                <Button type="button" variant="outline" size="sm" icon="refresh" onClick={() => setConfirmRotate(true)}>
                  Anahtarı yenile
                </Button>
              </div>
            )}
          </section>
        ) : (
          <Alert tone="info" className="mt-5">
            Kaydedince sitenize ekleyeceğiniz kod burada görünür.
          </Alert>
        )}

        {canManage && (
          <div className="mt-5 flex justify-end border-t border-line pt-4">
            <SaveButton mutation={mutation} dirty={dirty} canManage={canManage} />
          </div>
        )}
      </Card>
    </form>

      <ConfirmDialog
        open={confirmRotate}
        title="Balon anahtarı yenilensin mi?"
        message="Sitedeki mevcut kod çalışmayı bırakır; yeni kodu sitenize eklemeniz gerekir. Konuşmalar Mesajlar ekranında kalır; misafirin balonu yeni bir sohbet olarak açılır."
        confirmLabel="Yenile"
        confirmVariant="danger"
        confirmIcon="refresh"
        isPending={rotate.isPending}
        error={rotate.error}
        onConfirm={() => rotate.mutate()}
        onClose={() => setConfirmRotate(false)}
      />
    </>
  );
}
