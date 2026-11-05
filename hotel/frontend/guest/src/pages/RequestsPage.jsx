import { useState } from 'react';
import { Alert, Badge, Button, Select, Spinner, Textarea } from '@hotelos/ui';
import { guestApi, portalPath } from '../api.js';
import { usePortal } from '../App.jsx';
import { errorText, useI18n } from '../i18n.jsx';
import { REQUEST_CATEGORIES } from '../limits.js';
import { useLoad } from '../useLoad.js';

const STATUS_TONES = Object.freeze({ OPEN: 'info', IN_PROGRESS: 'warning', DONE: 'success', CANCELLED: 'neutral' });

/**
 * Misafirin istekleri (konaklamada): konu + açıklama → resepsiyonun istek listesine "Misafir portalı" kaynağıyla düşer.
 * Aynı metin kısa sürede iki kez gönderilse de tek istek olur (sunucu denetler).
 */
export function RequestsPage() {
  const { token } = usePortal();
  const { t, fmt } = useI18n();
  const list = useLoad(portalPath(token, '/requests'), { intervalMs: 60_000 });
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const next = {};
    if (!category) next.category = t('error.required');
    if (description.trim().length < 3) next.description = t('error.required');
    setErrors(next);
    if (Object.keys(next).length) return;
    setSending(true);
    setStatus(null);
    try {
      const data = await guestApi(portalPath(token, '/requests'), { method: 'POST', body: { category, description: description.trim() } });
      list.setData(data);
      setDescription('');
      setCategory('');
      setStatus({ tone: 'success', text: t('requests.sent') });
    } catch (error) {
      setStatus({ tone: 'danger', text: errorText(t, error) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-brand text-2xl font-bold text-ink">{t('requests.title')}</h1>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <Select
          label={t('requests.category')}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          error={errors.category}
          options={[{ value: '', label: t('field.choose') }, ...REQUEST_CATEGORIES.map((value) => ({ value, label: t(`category.${value}`) }))]}
        />
        <Textarea label={t('requests.description')} rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} error={errors.description} placeholder={t('requests.placeholder')} />
        {status && <Alert tone={status.tone}>{status.text}</Alert>}
        <Button type="submit" icon="send" disabled={sending} className="self-end">
          {sending ? t('checkin.submitting') : t('requests.send')}
        </Button>
      </form>

      <section>
        <h2 className="mb-2 font-bold text-ink">{t('requests.list')}</h2>
        {list.loading && !list.data ? (
          <Spinner label={t('common.loading')} className="py-6" />
        ) : list.error && !list.data ? (
          <Alert tone="danger">{errorText(t, list.error)}</Alert>
        ) : list.data.requests.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('requests.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.data.requests.map((request) => (
              <li key={request.id} className="flex items-start justify-between gap-3 rounded-panel border border-line bg-surface p-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold">{t(`category.${request.category}`)}</span>
                  <span className="block text-ink-soft">{request.title}</span>
                  <span className="text-xs text-ink-muted">{fmt.dateTime(request.createdAt)}</span>
                </span>
                <Badge tone={STATUS_TONES[request.status] ?? 'neutral'}>{t(`requestStatus.${request.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
