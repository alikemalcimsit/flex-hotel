import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Button, Icon, Spinner } from '@hotelos/ui';
import { FullPageMessage, LanguageSwitch } from '../App.jsx';
import { guestApi, surveyPath } from '../api.js';
import { errorText, useI18n } from '../i18n.jsx';
import { SURVEY_TEXT_MAX } from '../limits.js';
import { useLoad } from '../useLoad.js';

/** Sorunun metni: seçili dil, yoksa Türkçe. @param {Record<string, string>} text @param {string} language */
const textOf = (text, language) => text?.[language]?.trim() || text?.tr || '';

/** @param {any} question @param {any} answer */
const isEmpty = (question, answer) => {
  if (question.type === 'NPS' || question.type === 'RATING') return !Number.isInteger(answer?.score);
  if (question.type === 'CHOICE') return !(answer?.choiceIds?.length > 0);
  return !String(answer?.text ?? '').trim();
};

/** NPS: 0–10 düğmeleri (iki satırda da okunur), uçlarda açıklama. @param {{ value: number | null, onChange: (value: number) => void, invalid: boolean }} props */
function NpsScale({ value, onChange, invalid }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <div className={`grid grid-cols-6 gap-1.5 sm:grid-cols-11 ${invalid ? 'rounded-control ring-2 ring-danger ring-offset-2' : ''}`} role="radiogroup">
        {Array.from({ length: 11 }, (_, score) => (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            onClick={() => onChange(score)}
            className={`h-11 rounded-control border text-sm font-bold tabular-nums transition ${
              value === score ? (score >= 9 ? 'border-success bg-success text-white' : score >= 7 ? 'border-ink bg-ink text-white' : 'border-danger bg-danger text-white') : 'border-line bg-surface text-ink hover:border-line-strong'
            }`}
          >
            {score}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-ink-muted">
        <span>0 · {t('survey.npsLow')}</span>
        <span>10 · {t('survey.npsHigh')}</span>
      </div>
    </div>
  );
}

/** 1–5 yıldız. @param {{ value: number | null, onChange: (value: number) => void, invalid: boolean }} props */
function Stars({ value, onChange, invalid }) {
  const { t } = useI18n();
  return (
    <div className={`flex gap-1 ${invalid ? 'rounded-control ring-2 ring-danger ring-offset-2' : ''}`} role="radiogroup">
      {[1, 2, 3, 4, 5].map((score) => (
        <button key={score} type="button" role="radio" aria-checked={value === score} aria-label={t('survey.star', { n: score })} onClick={() => onChange(score)} className="p-1">
          <Icon name="star" className={`size-9 ${value !== null && score <= value ? 'fill-warning text-warning' : 'text-line-strong'}`} />
        </button>
      ))}
    </div>
  );
}

/** Seçenekler (tekli: radyo, çoklu: onay kutusu). @param {{ question: any, value: string[], onChange: (ids: string[]) => void, language: string, invalid: boolean }} props */
function Choices({ question, value, onChange, language, invalid }) {
  const toggle = (id) => {
    if (!question.multiple) return onChange(value[0] === id ? [] : [id]);
    return onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  };
  return (
    <div className={`flex flex-wrap gap-2 ${invalid ? 'rounded-control ring-2 ring-danger ring-offset-2' : ''}`}>
      {question.options.map((option) => {
        const on = value.includes(option.id);
        return (
          <button key={option.id} type="button" role={question.multiple ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => toggle(option.id)} className={`rounded-full border px-4 py-2 text-sm font-semibold ${on ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink hover:border-line-strong'}`}>
            {textOf(option.label, language)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Misafirin anket sayfası (modül 55), `/misafir/a/<belirteç>`. Oturumsuz; dil misafirin uyruğundan önerilir, üst
 * bardan değişir. Zorunlu soru boşsa gönderilmez (sunucu da denetler). Gönderince teşekkür ve — puandan bağımsız —
 * otelin yorum bağlantıları.
 */
export function SurveyPage() {
  const { token } = useParams();
  const { t, fmt, language, suggest } = useI18n();
  const survey = useLoad(surveyPath(token));
  const [answers, setAnswers] = useState(/** @type {Record<string, any>} */ ({}));
  const [missing, setMissing] = useState(/** @type {Set<string>} */ (new Set()));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const data = survey.data;
  useEffect(() => {
    if (data?.language) suggest(data.language);
  }, [data?.language, suggest]);

  if (survey.loading && !data) return <Spinner label={t('common.loading')} className="py-16" />;
  if (survey.error && !data) return <FullPageMessage error={survey.error} onRetry={survey.error.code === 'NETWORK' ? () => survey.reload() : undefined} />;

  const mid = data.kind === 'MID_STAY';
  const finished = done ?? (data.state === 'ANSWERED' ? { reviewLinks: data.reviewLinks } : null);
  const set = (questionId, patch) => {
    setAnswers((current) => ({ ...current, [questionId]: { ...current[questionId], ...patch } }));
    setMissing((current) => {
      if (!current.has(questionId)) return current;
      const next = new Set(current);
      next.delete(questionId);
      return next;
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    const required = data.questions.filter((question) => question.required && isEmpty(question, answers[question.id])).map((question) => question.id);
    setMissing(new Set(required));
    if (required.length) {
      setError({ code: 'MISSING' });
      document.getElementById(`q-${required[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSending(true);
    setError(null);
    try {
      const payload = data.questions
        .filter((question) => !isEmpty(question, answers[question.id]))
        .map((question) => {
          const answer = answers[question.id];
          if (question.type === 'TEXT') return { questionId: question.id, text: answer.text.trim() };
          if (question.type === 'CHOICE') return { questionId: question.id, choiceIds: answer.choiceIds };
          return { questionId: question.id, score: answer.score };
        });
      setDone(await guestApi(surveyPath(token), { method: 'POST', body: { language, answers: payload } }));
    } catch (failure) {
      if (failure.code === 'SURVEY_ALREADY_ANSWERED') setDone({ reviewLinks: [] });
      else {
        setError(failure);
        // Anket bu arada değiştiyse (soru kalktı / zorunlu soru eklendi) sorular yenilenir, cevaplar soru kimliğiyle korunur.
        if (failure.code === 'SURVEY_CHANGED' || failure.code === 'VALIDATION') await survey.reload({ quiet: true });
        if (failure.code === 'VALIDATION' && failure.fields) setMissing(new Set(Object.keys(failure.fields)));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-4 py-5">
      <header className="flex items-center justify-between gap-3">
        <span className="font-brand text-lg font-bold text-ink">{data.hotel.name}</span>
        <LanguageSwitch />
      </header>

      {data.state === 'EXPIRED' && !finished ? (
        <Alert tone="info" title={t('survey.title')}>
          {t('err.SURVEY_EXPIRED')}
        </Alert>
      ) : finished ? (
        <section className="flex flex-col items-center gap-4 rounded-panel border border-line bg-surface p-6 text-center shadow-soft">
          <Icon name="checkCircle" className="size-12 text-success" />
          <h1 className="font-brand text-2xl font-bold text-ink">{t('survey.thanks')}</h1>
          <p className="text-ink-soft">{t(mid ? 'survey.thanksMid' : 'survey.thanksText')}</p>
          {finished.reviewLinks?.length > 0 && (
            <div className="flex w-full flex-col gap-2 border-t border-line pt-4">
              <p className="text-sm text-ink-muted">{t('survey.review')}</p>
              {finished.reviewLinks.map((link) => (
                <a key={link.site} href={link.url} target="_blank" rel="noopener noreferrer" className="rounded-control border border-line px-4 py-3 text-sm font-semibold text-ink hover:border-line-strong">
                  {t(`survey.review${link.site}`)}
                </a>
              ))}
            </div>
          )}
        </section>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
          <section>
            <h1 className="font-brand text-2xl font-bold text-ink">{t(mid ? 'survey.midTitle' : 'survey.title')}</h1>
            <p className="mt-1 text-ink-soft">{mid ? t('survey.midIntro', { name: data.guestName ?? '' }) : t('survey.intro', { name: data.guestName ?? '', checkIn: fmt.day(data.stay.checkIn), checkOut: fmt.day(data.stay.checkOut) })}</p>
          </section>
          {data.questions.map((question) => {
            const answer = answers[question.id] ?? {};
            const invalid = missing.has(question.id);
            return (
              <fieldset key={question.id} id={`q-${question.id}`} className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4 shadow-soft">
                <legend className="sr-only">{textOf(question.text, language)}</legend>
                <p className="font-semibold text-ink" aria-hidden="true">
                  {textOf(question.text, language)}
                  {question.required && <span className="ml-1 text-xs font-normal text-danger">({t('survey.required')})</span>}
                </p>
                {question.type === 'NPS' && <NpsScale value={answer.score ?? null} onChange={(score) => set(question.id, { score })} invalid={invalid} />}
                {question.type === 'RATING' && <Stars value={answer.score ?? null} onChange={(score) => set(question.id, { score })} invalid={invalid} />}
                {question.type === 'CHOICE' && <Choices question={question} value={answer.choiceIds ?? []} onChange={(choiceIds) => set(question.id, { choiceIds })} language={language} invalid={invalid} />}
                {question.type === 'TEXT' && (
                  <div className="flex flex-col gap-1">
                    <textarea
                      rows={3}
                      maxLength={SURVEY_TEXT_MAX}
                      value={answer.text ?? ''}
                      onChange={(event) => set(question.id, { text: event.target.value })}
                      placeholder={question.required ? '' : t('survey.textPlaceholder')}
                      className={`w-full rounded-control border bg-surface px-3 py-2 text-ink ${invalid ? 'border-danger' : 'border-line'}`}
                    />
                    {(answer.text?.length ?? 0) > SURVEY_TEXT_MAX * 0.8 && <span className="text-right text-xs text-ink-muted">{t('survey.chars', { count: answer.text.length, max: SURVEY_TEXT_MAX })}</span>}
                  </div>
                )}
              </fieldset>
            );
          })}
          {error && <Alert tone={error.code === 'SURVEY_CHANGED' ? 'warning' : 'danger'}>{error.code === 'MISSING' ? t('survey.missing') : errorText(t, error)}</Alert>}
          <Button type="submit" icon="send" disabled={sending} className="w-full py-3 text-base">
            {sending ? t('survey.sending') : t('survey.submit')}
          </Button>
        </form>
      )}
    </main>
  );
}
