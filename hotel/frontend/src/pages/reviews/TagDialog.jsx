import { useState } from 'react';
import { REVIEW_DEPARTMENT_LABELS, REVIEW_DEPARTMENTS, SURVEY_SENTIMENT_LABELS, SURVEY_SENTIMENTS, SURVEY_TOPIC_LABELS, SURVEY_TOPICS, reviewTagSchema } from '@hotelos/hotel-contracts';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { MultiChips } from '../../components/MultiChips.jsx';
import { apiPut } from '../../lib/api.js';
import { toastSuccess } from '../../store/toast.js';
import { ReviewDialog, useReviewSubmit } from './ReviewDialog.jsx';

const SENTIMENT_OPTIONS = SURVEY_SENTIMENTS.map((value) => ({ value, label: SURVEY_SENTIMENT_LABELS[value] }));
const TOPIC_OPTIONS = SURVEY_TOPICS.map((value) => ({ value, label: SURVEY_TOPIC_LABELS[value] }));
const DEPARTMENT_OPTIONS = REVIEW_DEPARTMENTS.map((value) => ({ value, label: REVIEW_DEPARTMENT_LABELS[value] }));
const FORM_ID = 'review-tag-form';

/**
 * "Etiketi düzelt" (modül 54, `reviews.manage`): duygu, en çok 5 konu, en çok 4 departman. Personel etiketi AI etiketinin yerine
 * geçer; "Yeniden analiz" onu siler.
 * @param {{ review: any, onClose: () => void }} props
 */
export function TagDialog({ review, onClose }) {
  const [sentiment, setSentiment] = useState(review.analysis.sentiment ?? '');
  const [topics, setTopics] = useState(/** @type {string[]} */ (review.analysis.topics ?? []));
  const [departments, setDepartments] = useState(/** @type {string[]} */ (review.analysis.departments ?? []));
  const { submit, errors, serverError, busy } = useReviewSubmit({
    schema: reviewTagSchema,
    request: (body) => apiPut(`/reviews/${review.id}/tags`, body),
    onSuccess: () => {
      toastSuccess('Etiket kaydedildi');
      onClose();
    },
  });
  return (
    <ReviewDialog title="Etiketi düzelt" formId={FORM_ID} busy={busy} onClose={onClose} submitLabel="Kaydet" serverError={serverError}>
      <form
        id={FORM_ID}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit({ sentiment: sentiment || undefined, topics, departments });
        }}
      >
        <ChoiceChips label="Duygu" options={SENTIMENT_OPTIONS} value={sentiment} onChange={(value) => value && setSentiment(value)} />
        {errors.sentiment && <p className="-mt-3 text-xs font-semibold text-sec-strong">{errors.sentiment}</p>}
        <MultiChips label="Konular (en çok 5)" options={TOPIC_OPTIONS} values={topics} onChange={setTopics} disabled={busy} error={errors.topics} />
        <MultiChips label="Departmanlar (en çok 4)" options={DEPARTMENT_OPTIONS} values={departments} onChange={setDepartments} disabled={busy} error={errors.departments} />
      </form>
    </ReviewDialog>
  );
}
