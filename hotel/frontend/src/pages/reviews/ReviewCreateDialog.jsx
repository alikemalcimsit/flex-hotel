import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { REVIEW_SOURCE_LABELS, REVIEW_SOURCE_SCALES, REVIEW_SOURCES, reviewCreateSchema } from '@hotelos/hotel-contracts';
import { Input, Select, Textarea } from '@hotelos/ui';
import { apiPost } from '../../lib/api.js';
import { reviewPath } from '../../lib/reviews.js';
import { dayFromToday } from '../../lib/surveys.js';
import { toastSuccess } from '../../store/toast.js';
import { ReviewDialog, useReviewSubmit } from './ReviewDialog.jsx';

const SOURCE_OPTIONS = REVIEW_SOURCES.map((value) => ({ value, label: REVIEW_SOURCE_LABELS[value] }));
const FORM_ID = 'review-create-form';
const HTTP_URL = /^https?:\/\//i;

const EMPTY = Object.freeze({ source: 'GOOGLE', reviewedAt: '', rating: '', authorName: '', title: '', text: '', language: '', url: '', externalId: '', existingReply: '' });

/** Boş metin → null; puan sayıya. @param {typeof EMPTY} values */
function bodyOf(values) {
  const trimmed = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value).trim()]));
  const rating = trimmed.rating === '' ? null : Number(trimmed.rating.replace(',', '.'));
  return {
    source: trimmed.source,
    reviewedAt: trimmed.reviewedAt,
    rating: Number.isFinite(rating) ? rating : trimmed.rating,
    text: trimmed.text || null,
    title: trimmed.title || null,
    authorName: trimmed.authorName || null,
    externalId: trimmed.externalId || null,
    language: trimmed.language ? trimmed.language.toLowerCase() : null,
    url: trimmed.url || null,
    existingReply: trimmed.existingReply || null,
  };
}

/**
 * "Yorum ekle" (modül 54, `reviews.manage`): kaynak, tarih, puan (kaynağın ölçeğinde), yazan, başlık, metin; isteğe bağlı dil,
 * bağlantı, yorum no ve platformdaki cevap. Aynı yorum ikinci kez girilirse sunucu "zaten kayıtlı" der.
 * @param {{ onClose: () => void }} props
 */
export function ReviewCreateDialog({ onClose }) {
  const navigate = useNavigate();
  const [values, setValues] = useState({ ...EMPTY, reviewedAt: dayFromToday(0) });
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const scale = REVIEW_SOURCE_SCALES[values.source];
  const { submit, errors: submitErrors, serverError, busy } = useReviewSubmit({
    schema: reviewCreateSchema,
    request: (body) => apiPost('/reviews', body),
    onSuccess: (review) => {
      toastSuccess('Yorum eklendi');
      onClose();
      navigate(reviewPath(review.id));
    },
  });

  const [urlError, setUrlError] = useState('');
  const errors = urlError ? { ...submitErrors, url: urlError } : submitErrors;

  return (
    <ReviewDialog title="Yorum ekle" formId={FORM_ID} busy={busy} onClose={onClose} submitLabel="Ekle" submitIcon="plus" serverError={serverError} size="lg">
      <form
        id={FORM_ID}
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const body = bodyOf(values);
          // Sunucu yalnız http(s) bağlantı kabul eder.
          const badUrl = body.url && !HTTP_URL.test(body.url);
          setUrlError(badUrl ? 'Bağlantı http:// ya da https:// ile başlamalı' : '');
          if (!badUrl) submit(body);
        }}
      >
        <Select label="Kaynak" name="review-source" options={SOURCE_OPTIONS} value={values.source} onChange={set('source')} error={errors.source} disabled={busy} />
        <Input label="Tarih" name="review-date" type="date" max={dayFromToday(0)} value={values.reviewedAt} onChange={set('reviewedAt')} error={errors.reviewedAt} disabled={busy} />
        <Input label={`Puan (0–${scale})`} name="review-rating" inputMode="decimal" placeholder="Boş bırakılabilir" value={values.rating} onChange={set('rating')} error={errors.rating} disabled={busy} />
        <Input label="Yazan" name="review-author" value={values.authorName} onChange={set('authorName')} error={errors.authorName} maxLength={120} disabled={busy} />
        <Input label="Başlık" name="review-title" value={values.title} onChange={set('title')} error={errors.title} maxLength={300} disabled={busy} className="sm:col-span-2" />
        <Textarea label="Yorum" name="review-text" rows={5} value={values.text} onChange={set('text')} error={errors.text} disabled={busy} className="sm:col-span-2" />
        <Input label="Dil" name="review-language" placeholder="tr, en, de… (boşsa AI bulur)" value={values.language} onChange={set('language')} error={errors.language} maxLength={2} disabled={busy} />
        <Input label="Yorum no" name="review-external" placeholder="Platformdaki kimlik" value={values.externalId} onChange={set('externalId')} error={errors.externalId} maxLength={120} disabled={busy} />
        <Input label="Bağlantı" name="review-url" type="url" placeholder="https://…" value={values.url} onChange={set('url')} error={errors.url} disabled={busy} className="sm:col-span-2" />
        <Textarea label="Platformdaki otel cevabı" name="review-existing" rows={2} placeholder="Zaten cevap verildiyse; yorum cevaplandı sayılır" value={values.existingReply} onChange={set('existingReply')} error={errors.existingReply} disabled={busy} className="sm:col-span-2" />
      </form>
    </ReviewDialog>
  );
}
