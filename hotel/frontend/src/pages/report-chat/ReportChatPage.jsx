import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MAX_REPORT_QUESTION_LENGTH, REPORT_CHAT_REPORT_LABELS, askReportQuestionSchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, EmptyState, Icon, Spinner, Textarea } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { formatDateTime } from '../../lib/format.js';
import { EXAMPLE_QUESTIONS, SAVED_REPORTS_PATH, downloadReportExcel, isTextAnswer } from '../../lib/reportChat.js';
import { useAskReportQuestion, useReportQuestions } from '../../lib/reportChatQueries.js';
import { validateWith } from '../../lib/validate.js';
import { toastError } from '../../store/toast.js';
import { SaveReportDialog } from './ReportChatDialogs.jsx';
import { ReportResult } from './ReportResult.jsx';

/**
 * Rapor asistanı sohbeti (modül 24). Soru gönderilince "hazırlanıyor" olarak görünür; ajan cevabı arka planda yazar
 * (kanal haber verir, kopuksa yoklanır). Cevap: başlık, dönem, yorum, grafik, tablo; kaydet, Excel, "bunu değiştir"
 * (sonraki soru bu raporun üzerinden devam eder). AI kullanılamıyorsa soru rapor talebi olarak personele iletilir.
 */
export function ReportChatPage() {
  const questions = useReportQuestions();
  const ask = useAskReportQuestion();
  const [text, setText] = useState('');
  const [followUp, setFollowUp] = useState(/** @type {any} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [saving, setSaving] = useState(/** @type {any} */ (null));
  const endRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const inputRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const items = questions.data?.items ?? [];
  const available = questions.data?.available ?? true;
  const last = items.at(-1);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items.length, last?.status]);

  /** @param {string} value */
  function send(value) {
    const checked = validateWith(askReportQuestionSchema, { question: value, followUpOfId: followUp?.id ?? null });
    if (!checked.ok) return setError(checked.errors.question ?? Object.values(checked.errors)[0]);
    setError(null);
    ask.mutate(checked.data, {
      onSuccess: () => {
        setText('');
        setFollowUp(null);
        inputRef.current?.focus();
      },
      onError: (failure) => setError(failure.fields?.question ?? failure.message),
    });
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(text);
    }
  }

  /** @param {any} question */
  function continueFrom(question) {
    setFollowUp(question);
    inputRef.current?.focus();
  }

  if (questions.isPending || questions.isError) return <QueryFallback query={questions} errorTitle="Sohbet yüklenemedi" />;

  return (
    <div className="flex flex-col gap-4">
      {!available && (
        <Alert tone="warning" title="AI asistanı şu an kullanılamıyor">
          {questions.data.reason} Sorunuz rapor talebi olarak rapor sorumlusuna iletilir.
        </Alert>
      )}

      <Card>
        <div className="flex max-h-[65vh] min-h-64 flex-col gap-5 overflow-y-auto pr-1" aria-live="polite">
          {items.length === 0 ? (
            <EmptyState
              icon="sparkles"
              title="Raporunuzu sorun"
              description="Doluluk, oda geliri / ADR / RevPAR, oda tipi ve kaynak kırılımı, 30 günlük tahmin ve bütçe sapması hakkında sorabilirsiniz."
            />
          ) : (
            items.map((question) => <Exchange key={question.id} question={question} onSave={setSaving} onContinue={continueFrom} />)
          )}
          <div ref={endRef} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" aria-label="Örnek sorular">
            {EXAMPLE_QUESTIONS.map((example) => (
              <button
                key={example}
                type="button"
                className="rounded-full border border-line bg-surface-muted px-3 py-1 text-xs font-semibold text-ink-soft transition hover:border-line-strong hover:text-ink"
                onClick={() => {
                  setText(example);
                  inputRef.current?.focus();
                }}
              >
                {example}
              </button>
            ))}
          </div>
          {followUp && (
            <div className="flex items-center gap-2 self-start rounded-full bg-info-soft py-1 pl-3 pr-1 text-xs font-semibold text-info-ink">
              <Icon name="link" className="size-3.5" />
              Devam: {followUp.title ?? followUp.question}
              <button type="button" className="rounded-full p-1 hover:bg-info-line" aria-label="Devamı kaldır" onClick={() => setFollowUp(null)}>
                <Icon name="close" className="size-3.5" />
              </button>
            </div>
          )}
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send(text);
            }}
          >
            <Textarea
              label="Sorunuz"
              name="report-question"
              ref={inputRef}
              rows={2}
              maxLength={MAX_REPORT_QUESTION_LENGTH}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={followUp ? 'Bu raporu nasıl değiştireyim? (ör. aylık göster, geçen yılla karşılaştır)' : 'Ör. geçen ayın haftalık doluluğunu göster'}
              aria-describedby="report-question-help"
              disabled={ask.isPending}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p id="report-question-help" className={`text-xs ${error ? 'text-danger-ink' : 'text-ink-muted'}`}>
                {error ?? `Enter gönderir, Shift+Enter yeni satır · ${text.length}/${MAX_REPORT_QUESTION_LENGTH}`}
              </p>
              <Button type="submit" icon="send" disabled={ask.isPending || text.trim().length === 0}>
                {ask.isPending ? 'Gönderiliyor…' : available ? 'Sor' : 'Rapor talebi gönder'}
              </Button>
            </div>
          </form>
        </div>
      </Card>

      {saving && <SaveReportDialog question={saving} onClose={() => setSaving(null)} />}
    </div>
  );
}

/**
 * Bir soru ve cevabı.
 * @param {{ question: any, onSave: (question: any) => void, onContinue: (question: any) => void }} props
 */
function Exchange({ question, onSave, onContinue }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="max-w-[85%] self-end rounded-card bg-ink px-4 py-2 text-sm text-surface">
        <p className="whitespace-pre-wrap">{question.question}</p>
        <p className="mt-1 text-right text-[11px] text-surface/70">{formatDateTime(question.createdAt)}</p>
      </div>
      <Answer question={question} onSave={onSave} onContinue={onContinue} />
    </div>
  );
}

/** @param {{ question: any, onSave: (question: any) => void, onContinue: (question: any) => void }} props */
function Answer({ question, onSave, onContinue }) {
  if (question.status === 'PENDING') {
    return (
      <div className="flex items-center gap-2 self-start rounded-card border border-line bg-surface-muted px-4 py-3 text-sm text-ink-soft">
        <Spinner label="Hazırlanıyor…" />
      </div>
    );
  }
  if (question.status === 'FAILED') {
    return (
      <Alert tone="warning" title="Cevaplanamadı" className="self-start">
        {question.failureReason}
      </Alert>
    );
  }
  if (isTextAnswer(question)) {
    return (
      <div className="flex max-w-[85%] items-start gap-2 self-start rounded-card border border-line bg-surface-muted px-4 py-3 text-sm">
        <Icon name="bot" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
        <p className="whitespace-pre-wrap">{question.comment}</p>
      </div>
    );
  }

  async function exportExcel() {
    try {
      await downloadReportExcel({ title: question.title, periodLabel: question.periodLabel, dataset: question.dataset });
    } catch (failure) {
      toastError(`Excel hazırlanamadı: ${failure.message}`);
    }
  }

  return (
    <article className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">{question.title}</h3>
          <p className="text-xs text-ink-muted">
            {/* Dönemin adı zaten "Geçen ay (1 Eki – 31 Eki 2026)": raporun adı önde, dönem bir kez. */}
            {REPORT_CHAT_REPORT_LABELS[question.spec?.report] ?? 'Rapor'} · {question.periodLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" icon="link" onClick={() => onContinue(question)}>
            Bunu değiştir
          </Button>
          <Button size="sm" variant="outline" icon="download" onClick={exportExcel}>
            Excel'e aktar
          </Button>
          <Button size="sm" icon="fileText" onClick={() => onSave(question)}>
            Kaydet
          </Button>
        </div>
      </header>
      {question.comment && (
        <p className="flex items-start gap-2 text-sm text-ink-soft">
          <Icon name="sparkles" className="mt-0.5 size-4 shrink-0 text-info" />
          <span className="whitespace-pre-wrap">{question.comment}</span>
        </p>
      )}
      <ReportResult dataset={question.dataset} chart={question.chart} />
      <p className="text-xs text-ink-muted">
        Rakamlar sistemin raporundan; yorum AI tarafından yazıldı.{' '}
        <Link to={SAVED_REPORTS_PATH} className="font-semibold underline-offset-2 hover:underline">
          Kayıtlı raporlar
        </Link>
      </p>
    </article>
  );
}
