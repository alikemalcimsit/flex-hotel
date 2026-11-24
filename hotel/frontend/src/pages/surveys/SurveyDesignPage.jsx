import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GUEST_PORTAL_LANGUAGE_LABELS,
  SURVEY_KIND_LABELS,
  SURVEY_KINDS,
  SURVEY_LANGUAGES,
  SURVEY_MAX_OPTIONS,
  SURVEY_OPTION_TEXT_MAX,
  SURVEY_QUESTION_TEXT_MAX,
  SURVEY_QUESTION_TYPE_LABELS,
  SURVEY_QUESTION_TYPES,
  SURVEY_TOPIC_LABELS,
  SURVEY_TOPICS,
  surveyQuestionInputSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, Input, Select, Spinner } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { Modal } from '../../components/Modal.jsx';
import { api, apiPost, apiPut } from '../../lib/api.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { surveyKeys } from '../../lib/surveys.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** "148 cevap", sınırda "1.000+ cevap" (sunucu sayımı 1.000'de keser). @param {number} count */
const answerLabel = (count) => `${count.toLocaleString('tr-TR')}${count >= 1000 ? '+' : ''} cevap`;
const emptyText = () => Object.fromEntries(SURVEY_LANGUAGES.map((language) => [language, '']));
const blankQuestion = () => ({ type: 'RATING', topic: 'OVERALL', required: false, multiple: false, text: emptyText(), options: [] });

/** Soru ekleme / düzenleme penceresi: tip, konu, dört dilde metin, seçenekler. @param {{ kind: string, version: number, question: any | null, onClose: () => void, onSaved: (data: any) => void }} props */
function QuestionDialog({ kind, version, question, onClose, onSaved }) {
  const answered = question?.answerCount > 0;
  const [form, setForm] = useState(() =>
    question
      ? { type: question.type, topic: question.topic, required: question.required, multiple: question.multiple, text: { ...emptyText(), ...question.text }, options: question.options.map((option) => ({ id: option.id, label: { ...emptyText(), ...option.label } })) }
      : blankQuestion(),
  );
  const [language, setLanguage] = useState('tr');
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: (body) => (question ? apiPut(`/surveys/design/${kind}/questions/${question.id}`, body) : apiPost(`/surveys/design/${kind}/questions`, body)),
    onSuccess: (data) => {
      toastSuccess(question ? 'Soru güncellendi' : 'Soru eklendi');
      onSaved(data);
    },
    onError: (error) => toastError(error.message),
  });
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const setOption = (index, value) => set({ options: form.options.map((option, at) => (at === index ? { ...option, label: { ...option.label, [language]: value } } : option)) });
  const submit = (event) => {
    event.preventDefault();
    const payload = { ...form, options: form.type === 'CHOICE' ? form.options : [] };
    const result = validateWith(surveyQuestionInputSchema, payload);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) save.mutate({ expectedVersion: version, question: payload });
  };
  const textError = errors['text.tr'] ?? errors[`text.${language}`];
  return (
    <Modal
      open
      size="lg"
      title={question ? 'Soruyu düzenle' : 'Soru ekle'}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="survey-question" icon="check" disabled={save.isPending}>
            {save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <form id="survey-question" className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {answered && <Alert tone="info">Bu soru cevaplandı ({answerLabel(question.answerCount)}): tipi değişmez, cevaplanmış seçenek kaldırılamaz (adı değişebilir).</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Tip"
            options={SURVEY_QUESTION_TYPES.map((value) => ({ value, label: SURVEY_QUESTION_TYPE_LABELS[value] }))}
            value={form.type}
            disabled={answered}
            onChange={(event) => set({ type: event.target.value, options: event.target.value === 'CHOICE' && form.options.length < 2 ? [{ label: emptyText() }, { label: emptyText() }] : form.options })}
          />
          <Select label="Konu (rapordaki bölüm)" options={SURVEY_TOPICS.map((value) => ({ value, label: SURVEY_TOPIC_LABELS[value] }))} value={form.topic} onChange={(event) => set({ topic: event.target.value })} />
        </div>
        <div className="flex flex-wrap gap-4">
          <Checkbox label="Zorunlu" checked={form.required} onChange={(event) => set({ required: event.target.checked })} />
          {form.type === 'CHOICE' && <Checkbox label="Birden çok seçenek seçilebilir" checked={form.multiple} onChange={(event) => set({ multiple: event.target.checked })} />}
        </div>
        <ChoiceChips label="Dil" options={SURVEY_LANGUAGES.map((value) => ({ value, label: GUEST_PORTAL_LANGUAGE_LABELS[value] }))} value={language} onChange={(value) => value && setLanguage(value)} />
        <Input
          label={`Soru (${GUEST_PORTAL_LANGUAGE_LABELS[language]})${language === 'tr' ? ' — zorunlu' : ' — boşsa Türkçesi görünür'}`}
          maxLength={SURVEY_QUESTION_TEXT_MAX}
          value={form.text[language]}
          onChange={(event) => set({ text: { ...form.text, [language]: event.target.value } })}
          error={textError}
          placeholder={language === 'tr' ? 'Odanızın konforu' : form.text.tr}
        />
        {form.type === 'CHOICE' && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-ink">Seçenekler ({GUEST_PORTAL_LANGUAGE_LABELS[language]})</span>
            {form.options.map((option, index) => (
              <div key={option.id ?? `yeni-${index}`} className="flex items-end gap-2">
                <Input label={`Seçenek ${index + 1}`} maxLength={SURVEY_OPTION_TEXT_MAX} value={option.label[language]} onChange={(event) => setOption(index, event.target.value)} placeholder={language === 'tr' ? '' : option.label.tr} className="flex-1" />
                <Button type="button" variant="ghost" size="sm" icon="trash" aria-label="Seçeneği kaldır" disabled={form.options.length <= 2} onClick={() => set({ options: form.options.filter((_, at) => at !== index) })} />
              </div>
            ))}
            {errors.options && <p className="text-sm text-danger">{errors.options}</p>}
            {form.options.length < SURVEY_MAX_OPTIONS && (
              <Button type="button" variant="outline" size="sm" icon="plus" onClick={() => set({ options: [...form.options, { label: emptyText() }] })}>
                Seçenek ekle
              </Button>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}

/**
 * Anket soruları (modül 55): iki anket (çıkış sonrası, ara anket); soru ekle / düzenle / sırala / kaldır, arşivdekini
 * geri al. Cevaplanmış soru silinmez, arşive kalkar. Değişiklikler anketin sürümüyle (başkası aynı anda değiştirdiyse
 * "yenileyin"). Düzenleme `surveys.setup` ister.
 */
export function SurveyDesignPage() {
  const canSetup = useCan()(PERMISSIONS.SURVEYS_SETUP);
  const queryClient = useQueryClient();
  const [kind, setKind] = useState('POST_STAY');
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const [removing, setRemoving] = useState(/** @type {any} */ (null));
  const query = useQuery({ queryKey: surveyKeys.design(kind), queryFn: () => api(`/surveys/design/${kind}`) });
  const store = (data) => queryClient.setQueryData(surveyKeys.design(kind), data);
  const onError = (error) => {
    toastError(error.message);
    if (error.code === 'STALE_WRITE') queryClient.invalidateQueries({ queryKey: surveyKeys.design(kind) });
  };
  const reorder = useMutation({ mutationFn: (questionIds) => apiPost(`/surveys/design/${kind}/order`, { expectedVersion: query.data.version, questionIds }), onSuccess: store, onError });
  const remove = useMutation({
    mutationFn: (question) => apiPost(`/surveys/design/${kind}/questions/${question.id}/remove`, { expectedVersion: query.data.version }),
    onSuccess: (data) => {
      store(data);
      setRemoving(null);
      toastSuccess('Soru kaldırıldı');
    },
    onError,
  });
  const restore = useMutation({ mutationFn: (question) => apiPost(`/surveys/design/${kind}/questions/${question.id}/restore`, { expectedVersion: query.data.version }), onSuccess: store, onError });

  const move = (index, delta) => {
    const ids = query.data.questions.map((question) => question.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    reorder.mutate(ids);
  };
  const busy = reorder.isPending || remove.isPending || restore.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ChoiceChips label="Anket" options={SURVEY_KINDS.map((value) => ({ value, label: SURVEY_KIND_LABELS[value] }))} value={kind} onChange={(value) => value && setKind(value)} />
        {canSetup && query.data && (
          <Button type="button" icon="plus" disabled={query.data.questions.length >= query.data.maxQuestions} onClick={() => setEditing({ question: null })}>
            Soru ekle
          </Button>
        )}
      </div>
      {query.isPending ? (
        <Spinner label="Sorular yükleniyor…" className="py-10" />
      ) : query.isError ? (
        <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>
          {query.error.message}
        </Alert>
      ) : (
        <>
          {query.data.missingLanguages.length > 0 && (
            <Alert tone="warning">
              Bazı sorular {query.data.missingLanguages.map((language) => GUEST_PORTAL_LANGUAGE_LABELS[language]).join(', ')} dilinde yazılmamış; o dildeki misafire Türkçesi görünür.
            </Alert>
          )}
          <Card title={SURVEY_KIND_LABELS[kind]} description={kind === 'POST_STAY' ? 'Çıkıştan sonra giden anket: NPS, bölüm puanları, açık uçlu sorular.' : 'Girişin ertesi günü giden kısa anket: konaklama bitmeden sorunu yakalamak için 1–2 soru yeterli.'}>
            <ol className="divide-y divide-line">
              {query.data.questions.map((question, index) => (
                <li key={question.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">
                      {index + 1}. {question.text.tr}
                      {question.required && <span className="text-danger"> *</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <Badge tone="neutral">{SURVEY_QUESTION_TYPE_LABELS[question.type]}</Badge>
                      {SURVEY_TOPIC_LABELS[question.topic]}
                      {question.type === 'CHOICE' && ` · ${question.options.map((option) => option.label.tr).join(' / ')}`}
                      {question.answerCount > 0 && ` · ${answerLabel(question.answerCount)}`}
                    </span>
                  </span>
                  {canSetup && (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" icon="chevronDown" aria-label="Yukarı taşı" className="rotate-180" disabled={busy || index === 0} onClick={() => move(index, -1)} />
                      <Button type="button" variant="ghost" size="sm" icon="chevronDown" aria-label="Aşağı taşı" disabled={busy || index === query.data.questions.length - 1} onClick={() => move(index, 1)} />
                      <Button type="button" variant="outline" size="sm" icon="pencil" onClick={() => setEditing({ question })}>
                        Düzenle
                      </Button>
                      <Button type="button" variant="ghost" size="sm" icon="trash" aria-label="Kaldır" disabled={busy || query.data.questions.length <= 1} onClick={() => setRemoving(question)} />
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </Card>
          {query.data.archived.length > 0 && (
            <Card title="Arşivdeki sorular" description="Cevaplanmış oldukları için silinmediler; geçmiş cevapları raporda durur.">
              <ul className="divide-y divide-line">
                {query.data.archived.map((question) => (
                  <li key={question.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-ink-soft">
                      {question.text.tr} <span className="text-xs text-ink-muted">· {answerLabel(question.answerCount)}</span>
                    </span>
                    {canSetup && (
                      <Button type="button" variant="outline" size="sm" icon="rotateCcw" disabled={busy} onClick={() => restore.mutate(question)}>
                        Geri al
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      {editing && (
        <QuestionDialog
          kind={kind}
          version={query.data.version}
          question={editing.question}
          onClose={() => setEditing(null)}
          onSaved={(data) => {
            store(data);
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title="Soruyu kaldır"
        message={removing?.answerCount ? `Bu soru cevaplandı (${answerLabel(removing.answerCount)}): silinmez, arşive kalkar (geçmiş cevaplar raporda durur). Misafire artık sorulmaz.` : 'Soru henüz cevaplanmadı; silinir.'}
        confirmLabel="Kaldır"
        confirmIcon="trash"
        isPending={remove.isPending}
        onConfirm={() => remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
