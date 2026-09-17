import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  NOTIFICATION_CHANNEL_LABELS,
  notificationTemplateSchema,
  renderTemplate,
  smsInfo,
  TEMPLATE_SAMPLE_VALUES,
  TEMPLATE_VARIABLES,
  TRIGGER_VARIABLES,
} from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Checkbox, Input, Textarea } from '@hotelos/ui';
import { apiPut } from '../../lib/api.js';
import { notificationKeys } from '../../lib/notifications.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const BODY_ROWS = Object.freeze({ EMAIL: 12, SMS: 4, WHATSAPP: 6 });

/**
 * Kapalı metnin sonucu (sunucu: misafirin dilinde açık metin yoksa Türkçeye
 * düşülür; o da yoksa bildirim gitmez).
 */
const ACTIVE_HINTS = Object.freeze({
  tr: 'Kapalıysa Türk misafire bu bildirim gitmez; İngilizce metni olmayan yabancı misafire de gitmez.',
  en: 'Kapalıysa yabancı misafire Türkçe metin gider (o da kapalıysa bildirim gitmez).',
});

/**
 * Tek şablonun düzenleyicisi: konu (e-posta), metin, değişkenler, açık/kapalı
 * ve örnek değerlerle önizleme.
 *
 * Değişken çipi imlecin olduğu yere `{degisken}` ekler (son odaklanan alan:
 * konu ya da metin). SMS'te karakter ve parça sayısı örnek değerlerle
 * hesaplanır; Türkçe harf (ç, ğ, ı, ş, İ) iki karakter sayılır.
 *
 * Kaydederken ekranın gördüğü sürüm gönderilir; başkası bu arada
 * değiştirdiyse kayıt reddedilir ve güncel metin yüklenir.
 *
 * @param {{
 *   item: { key: string, channel: string, language: string, template: object | null, defaultTemplate: { subject: string | null, body: string } | null },
 *   channelAvailable: boolean,
 *   channelEnabled: boolean | null,
 *   onDirtyChange: (dirty: boolean) => void,
 * }} props
 */
export function TemplateEditor({ item, channelAvailable, channelEnabled, onDirtyChange }) {
  const queryClient = useQueryClient();
  const { key, channel, language, template, defaultTemplate } = item;
  const initial = useMemo(
    () => ({
      subject: template?.subject ?? defaultTemplate?.subject ?? '',
      body: template?.body ?? defaultTemplate?.body ?? '',
      isActive: template?.isActive ?? true,
    }),
    [template, defaultTemplate],
  );
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const lastFocused = useRef('body');

  // Önerilen metne göz atmak "değişiklik" değildir; yalnızca elle yapılan düzenleme sorulur.
  const dirty = form.subject !== initial.subject || form.body !== initial.body || form.isActive !== initial.isActive;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const saveMutation = useMutation({
    mutationFn: (values) => apiPut('/notifications/templates', values),
    onSuccess: (saved) => {
      queryClient.setQueryData(notificationKeys.templates, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((entry) =>
                entry.key === saved.key && entry.channel === saved.channel && entry.language === saved.language
                  ? { ...entry, template: saved }
                  : entry,
              ),
            }
          : current,
      );
      toastSuccess('Şablon kaydedildi');
    },
    onError: (error) => {
      toastError(error.message);
      if (error.fields) setErrors(error.fields);
      if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: notificationKeys.templates });
    },
  });

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  function insertVariable(name) {
    const field = channel === 'EMAIL' ? lastFocused.current : 'body';
    const element = (field === 'subject' ? subjectRef : bodyRef).current;
    const token = `{${name}}`;
    const value = form[field] ?? '';
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    setField(field, value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const values = {
      key,
      channel,
      language,
      subject: channel === 'EMAIL' ? form.subject : null,
      body: form.body,
      isActive: form.isActive,
      expectedUpdatedAt: template?.updatedAt ?? null,
    };
    const result = validateWith(notificationTemplateSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    saveMutation.mutate(values);
  }

  const variables = TRIGGER_VARIABLES[key] ?? [];
  const preview = {
    subject: renderTemplate(form.subject, TEMPLATE_SAMPLE_VALUES),
    body: renderTemplate(form.body, TEMPLATE_SAMPLE_VALUES),
  };
  const sms = channel === 'SMS' ? smsInfo(preview.body) : null;
  const channelLabel = NOTIFICATION_CHANNEL_LABELS[channel];
  const restorable =
    defaultTemplate && (form.body !== defaultTemplate.body || (channel === 'EMAIL' && form.subject !== defaultTemplate.subject));

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card
        title={template ? 'Kayıtlı şablon' : 'Yeni şablon'}
        description={
          template
            ? `Son değişiklik: ${new Date(template.updatedAt).toLocaleString('tr-TR')}${template.updatedBy ? ` · ${template.updatedBy}` : ''}`
            : defaultTemplate
              ? 'Bu metin henüz kaydedilmedi; önerilen metinle başlıyor. Kaydedince kullanılmaya başlar.'
              : 'Bu kanal için hazır metin yok; kendi metninizi yazın.'
        }
      >
        <div className="flex flex-col gap-4">
          {channel === 'WHATSAPP' && (
            <Alert tone="info" title={channelAvailable ? 'WhatsApp şablonu' : 'WhatsApp geçidi henüz bağlı değil'}>
              Metin, WhatsApp geçidi (modül 8) bağlandığında kullanılır; işletmenin başlattığı mesajlar için Meta
              onaylı şablon gerekir ve bu onay geçidin işidir. O güne kadar WhatsApp'tan bildirim gitmez.
            </Alert>
          )}
          {channel !== 'WHATSAPP' && channelEnabled === false && (
            <Alert tone="warning">
              {channelLabel} kanalı kapalı: metin kaydedilir ama kanal "Kanallar" sekmesinden açılana kadar gönderilmez.
            </Alert>
          )}

          {channel === 'EMAIL' && (
            <Input
              label="Konu"
              name="subject"
              value={form.subject}
              maxLength={200}
              error={errors.subject}
              onChange={(event) => setField('subject', event.target.value)}
              onFocus={(event) => {
                subjectRef.current = event.target;
                lastFocused.current = 'subject';
              }}
            />
          )}
          <Textarea
            label="Metin"
            name="body"
            rows={BODY_ROWS[channel]}
            value={form.body}
            error={errors.body}
            onChange={(event) => setField('body', event.target.value)}
            onFocus={(event) => {
              bodyRef.current = event.target;
              lastFocused.current = 'body';
            }}
          />

          <div>
            <p className="mb-2 text-xs font-bold text-ink-soft">
              Değişken ekle{channel === 'EMAIL' ? ' (imlecin olduğu alana)' : ''}
            </p>
            <div role="group" aria-label="Şablon değişkenleri" className="flex flex-wrap gap-1.5">
              {variables.map((name) => (
                <button
                  key={name}
                  type="button"
                  title={TEMPLATE_VARIABLES[name]}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertVariable(name)}
                  className="rounded-full border border-line-strong bg-surface px-2.5 py-1 font-mono text-xs text-ink-soft transition-colors hover:border-ink hover:text-ink"
                >
                  {`{${name}}`}
                  <span className="sr-only"> — {TEMPLATE_VARIABLES[name]}</span>
                </button>
              ))}
            </div>
            {key === 'RESERVATION_CONFIRMED' && (
              <p className="mt-2 text-xs text-ink-muted">
                Rezervasyon onayında oda henüz atanmamış olabilir; oda numarası bu metinde kullanılamaz.
              </p>
            )}
          </div>

          <Checkbox
            id={`template-active-${channel}-${language}`}
            label="Bu bildirim gönderilsin"
            hint={ACTIVE_HINTS[language]}
            checked={form.isActive}
            onChange={(event) => setField('isActive', event.target.checked)}
          />

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            {restorable && (
              <Button
                type="button"
                variant="ghost"
                icon="rotateCcw"
                onClick={() => {
                  setField('body', defaultTemplate.body);
                  if (channel === 'EMAIL') setField('subject', defaultTemplate.subject ?? '');
                }}
              >
                Önerilen metne dön
              </Button>
            )}
            {template && dirty && (
              <Button type="button" variant="outline" onClick={() => setForm(initial)} disabled={saveMutation.isPending}>
                Değişiklikleri geri al
              </Button>
            )}
            <Button type="submit" icon="check" disabled={saveMutation.isPending || (template && !dirty)}>
              {saveMutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Önizleme" description="Örnek misafir ve konaklama bilgileriyle.">
        <div className="flex flex-col gap-3">
          <div className="rounded-panel border border-line bg-surface-muted p-4">
            {channel === 'EMAIL' && (
              <p className="mb-2 border-b border-line pb-2 text-sm font-bold text-ink">{preview.subject || 'Konu yok'}</p>
            )}
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft">
              {preview.body || 'Metin boş'}
            </p>
          </div>
          {sms && <SmsMeter info={sms} />}
        </div>
      </Card>
    </form>
  );
}

/**
 * SMS uzunluğu. Parça sayısı ücreti belirler; tahmini (misafir adı uzunsa artar).
 * @param {{ info: ReturnType<typeof smsInfo> }} props
 */
function SmsMeter({ info }) {
  const tone = info.tooLong || info.invalidChars.length > 0 ? 'text-sec-strong' : info.segments > 1 ? 'text-warning-ink' : 'text-ink';
  return (
    <div className="flex flex-col gap-2 text-xs" aria-live="polite">
      <p className={`font-bold tabular-nums ${tone}`}>
        {info.length} / {info.maxLength} karakter · {info.segments} SMS
      </p>
      <p className="text-ink-muted">
        {info.encoding === 'TR'
          ? 'Türkçe karakter var (ç, ğ, ı, ş, İ): her biri 2 karakter sayılır, tek SMS 150 karakter.'
          : 'Standart karakterler: tek SMS 155 karakter.'}{' '}
        Örnek değerlerle hesaplandı; gerçek misafirde değişebilir.
      </p>
      {info.invalidChars.length > 0 && (
        <p className="font-semibold text-sec-strong">SMS'te gönderilemeyen karakter: {info.invalidChars.join(' ')}</p>
      )}
    </div>
  );
}
