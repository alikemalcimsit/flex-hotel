import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SURVEY_KIND_LABELS,
  SURVEY_KINDS,
  SURVEY_QUESTION_TYPE_LABELS,
  SURVEY_SENTIMENT_LABELS,
  SURVEY_SENTIMENT_TONES,
  SURVEY_TOPIC_LABELS,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Select, Spinner } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { SURVEY_PERIODS, formatScore, npsTone, periodOf, ratingTone, surveyKeys } from '../../lib/surveys.js';
import { toastError } from '../../store/toast.js';

const TONE_TEXT = Object.freeze({ success: 'text-success', warning: 'text-warning', danger: 'text-danger', neutral: 'text-ink' });
const signed = (value) => (value === null ? '—' : value > 0 ? `+${value}` : String(value));

/** Tek gösterge kutusu. @param {{ label: string, value: string, hint?: string, tone?: string, children?: any }} props */
function Kpi({ label, value, hint, tone = 'neutral', children = null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      <span className={`font-brand text-3xl font-bold tabular-nums ${TONE_TEXT[tone] ?? TONE_TEXT.neutral}`}>{value}</span>
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
      {children}
    </div>
  );
}

/** Destekçi / pasif / eleştiren payı. @param {{ counts: { promoters: number, passives: number, detractors: number } }} props */
function NpsSplit({ counts }) {
  const total = counts.promoters + counts.passives + counts.detractors;
  if (!total) return null;
  const parts = [
    { key: 'promoters', label: 'Destekçi', value: counts.promoters, color: 'bg-success' },
    { key: 'passives', label: 'Pasif', value: counts.passives, color: 'bg-line-strong' },
    { key: 'detractors', label: 'Eleştiren', value: counts.detractors, color: 'bg-danger' },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={parts.map((part) => `${part.label} ${part.value}`).join(', ')}>
        {parts.map((part) => part.value > 0 && <span key={part.key} className={part.color} style={{ width: `${(part.value / total) * 100}%` }} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {parts.map((part) => (
          <span key={part.key} className="inline-flex items-center gap-1.5">
            <span className={`inline-block size-2 rounded-full ${part.color}`} />
            {part.label} {part.value} (%{Math.round((part.value / total) * 100)})
          </span>
        ))}
      </div>
    </div>
  );
}

/** Puan / NPS dağılımı: değer başına çubuk. @param {{ distribution: Array<{ value: number, count: number }>, nps?: boolean }} props */
function Distribution({ distribution, nps = false }) {
  const max = Math.max(1, ...distribution.map((row) => row.count));
  const colorOf = (value) => (nps ? (value >= 9 ? 'bg-success' : value >= 7 ? 'bg-line-strong' : 'bg-danger') : value >= 4 ? 'bg-success' : value === 3 ? 'bg-line-strong' : 'bg-danger');
  return (
    <div className="flex h-10 items-end gap-0.5" role="img" aria-label={distribution.map((row) => `${row.value}: ${row.count}`).join(', ')}>
      {distribution.map((row) => (
        <span key={row.value} className="flex w-3 flex-col items-center justify-end gap-0.5" title={`${row.value}: ${row.count}`}>
          <span className={`w-full rounded-sm ${colorOf(row.value)}`} style={{ height: `${Math.max(2, (row.count / max) * 32)}px`, opacity: row.count ? 1 : 0.25 }} />
          <span className="text-[9px] leading-none text-ink-muted">{row.value}</span>
        </span>
      ))}
    </div>
  );
}

/** Dönem içi eğilim: kova başına NPS (çubuk; sıfır çizgisi ortada) ve cevap sayısı. @param {{ trend: any[], granularity: string }} props */
function Trend({ trend, granularity }) {
  if (trend.length < 2) return <p className="text-sm text-ink-muted">Eğilim için en az iki {granularity === 'WEEK' ? 'hafta' : 'ay'} gerekir.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex h-36 items-stretch gap-1 overflow-x-auto" role="img" aria-label={trend.map((row) => `${row.bucket}: NPS ${signed(row.nps)}, ${row.responses} cevap`).join('; ')}>
        <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
        {trend.map((row) => {
          const value = row.nps ?? 0;
          const height = `${(Math.abs(value) / 100) * 50}%`;
          return (
            <span key={row.bucket} className="relative flex min-w-7 flex-1 flex-col" title={`${row.bucket} · NPS ${signed(row.nps)} · ${row.responses} cevap`}>
              <span className="flex flex-1 items-end justify-center">{value > 0 && <span className="w-3/5 rounded-t-sm bg-success" style={{ height: `calc(${height} * 2)` }} />}</span>
              <span className="flex flex-1 items-start justify-center">{value < 0 && <span className="w-3/5 rounded-b-sm bg-danger" style={{ height: `calc(${height} * 2)` }} />}</span>
            </span>
          );
        })}
      </div>
      <div className="flex gap-1 overflow-x-auto text-[10px] text-ink-muted">
        {trend.map((row) => (
          <span key={row.bucket} className="min-w-7 flex-1 text-center tabular-nums">
            {row.bucket.slice(5).split('-').reverse().join('.')}
            <span className="block font-semibold text-ink-soft">{signed(row.nps)}</span>
            <span className="block">{row.responses} cevap</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** AI dönem özeti: tema, alıntı, öneri; isteme düğmesi (yalnız ayar izniyle; maliyetli). @param {{ kind: string, period: { from: string, to: string }, comments: number }} props */
function InsightPanel({ kind, period, comments }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const params = { kind, ...period };
  const query = useQuery({ queryKey: surveyKeys.insight(params), queryFn: () => api(withQuery('/surveys/insights', params)) });
  const request = useMutation({
    mutationFn: () => apiPost('/surveys/insights', params),
    onSuccess: (data) => queryClient.setQueryData(surveyKeys.insight(params), data),
    onError: (error) => toastError(error.message),
  });
  const insight = query.data?.insight;
  const pending = insight?.status === 'PENDING';
  const canRequest = can(PERMISSIONS.SURVEYS_SETUP) && query.data?.available && comments > 0 && !pending;
  return (
    <Card
      title="AI özeti"
      description="Dönemin yorumlarından ana temalar, örnek alıntılar ve öneriler (geri bildirim ajanı). Puanları sistem hesaplar."
      actions={
        can(PERMISSIONS.SURVEYS_SETUP) && (
          <Button type="button" size="sm" icon="sparkles" disabled={!canRequest || request.isPending} onClick={() => request.mutate()}>
            {pending ? 'Yazılıyor…' : insight ? 'Yeniden özetle' : 'Özet çıkar'}
          </Button>
        )
      }
    >
      {query.isPending ? (
        <Spinner label="Yükleniyor…" className="py-4" />
      ) : query.isError ? (
        <Alert tone="danger">{query.error.message}</Alert>
      ) : (
        <div className="flex flex-col gap-3">
          {!query.data.available && !insight && <Alert tone="info">AI özeti kullanılamıyor: {query.data.reason}</Alert>}
          {query.data.available && comments === 0 && <p className="text-sm text-ink-muted">Bu dönemde yorumlu cevap yok.</p>}
          {pending && <Spinner label="Özet yazılıyor; birkaç saniye sürer…" className="py-2" />}
          {insight?.status === 'FAILED' && <Alert tone="warning">Özet yazılamadı: {insight.failureReason}</Alert>}
          {insight?.status === 'READY' && (
            <>
              <p className="text-sm leading-relaxed text-ink">{insight.summary}</p>
              {insight.themes.length > 0 && (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {insight.themes.map((theme, index) => (
                    <li key={index} className="flex flex-col gap-1 rounded-control border border-line p-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{theme.title}</span>
                        <Badge tone={SURVEY_SENTIMENT_TONES[theme.sentiment]}>{SURVEY_SENTIMENT_LABELS[theme.sentiment]}</Badge>
                        {theme.share !== null && <span className="text-xs text-ink-muted">yorumların ~%{theme.share}</span>}
                      </span>
                      {theme.quote && <span className="text-sm italic text-ink-soft">“{theme.quote}”</span>}
                    </li>
                  ))}
                </ul>
              )}
              {insight.actions.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Öneriler</h4>
                  <ul className="list-disc pl-5 text-sm text-ink">
                    {insight.actions.map((action, index) => (
                      <li key={index}>{action}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-ink-muted">
                {insight.commentCount} yorum · {insight.model} · {formatDateTime(insight.completedAt)}
                {!query.data.available && ` · yeni özet istenemiyor: ${query.data.reason}`}
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * NPS raporu (modül 55): dönem ve anket türüne göre NPS, cevap oranı, puan ortalaması, düşük puanlar ve açık takipler;
 * soru başına ortalama ve dağılım, konu başına puan, AI'ın etiketlediği konular, eğilim ve AI özeti.
 */
export function SurveyReportPage() {
  const [kind, setKind] = useState('POST_STAY');
  const [days, setDays] = useState('30');
  const period = periodOf(days);
  const params = { kind, ...period };
  const query = useQuery({ queryKey: surveyKeys.report(params), queryFn: () => api(withQuery('/surveys/report', params)), placeholderData: keepPreviousData });
  const report = query.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <ChoiceChips label="Anket" options={SURVEY_KINDS.map((value) => ({ value, label: SURVEY_KIND_LABELS[value] }))} value={kind} onChange={(value) => value && setKind(value)} />
        <Select label="Dönem" options={SURVEY_PERIODS} value={days} onChange={(event) => setDays(event.target.value)} className="w-full sm:w-40" />
      </div>
      {query.isPending ? (
        <Spinner label="Rapor hazırlanıyor…" className="py-10" />
      ) : query.isError ? (
        <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>
          {query.error.message}
        </Alert>
      ) : report.responses === 0 ? (
        <Alert tone="info" title="Bu dönemde cevap yok">
          {report.invitations.sent > 0
            ? `${report.invitations.sent} davet gitti, henüz cevaplanmadı.`
            : 'Anketler Ayarlar sekmesinden açılınca çıkıştan sonra (ve istenirse konaklama içinde) misafire kendiliğinden gider.'}
        </Alert>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kind === 'POST_STAY' ? (
              <Kpi label="NPS" value={signed(report.nps)} tone={npsTone(report.nps)} hint="Destekçi % − eleştiren % (−100…+100)">
                <NpsSplit counts={report.counts} />
              </Kpi>
            ) : (
              <Kpi label="Genel puan" value={formatScore(report.ratingAverage)} tone={ratingTone(report.ratingAverage)} hint="Ara anket, 1–5" />
            )}
            <Kpi
              label="Cevap"
              value={report.responses.toLocaleString('tr-TR')}
              hint={report.invitations.responseRate === null ? 'Dönemde davet yok' : `${report.invitations.sent.toLocaleString('tr-TR')} davetten %${report.invitations.responseRate.toLocaleString('tr-TR')} cevap · ${report.invitations.opened.toLocaleString('tr-TR')} açıldı`}
            />
            {kind === 'POST_STAY' && <Kpi label="Puan ortalaması" value={formatScore(report.ratingAverage)} tone={ratingTone(report.ratingAverage)} hint="Bütün 1–5 puanların ortalaması" />}
            <Kpi label="Düşük puan" value={report.lowScores.toLocaleString('tr-TR')} tone={report.lowScores ? 'danger' : 'neutral'} hint={`Açık takip ${report.followUps.open}${report.followUps.overdue ? ` · ${report.followUps.overdue} gecikmiş` : ''}`}>
              {report.followUps.open > 0 && (
                <Link to="/anketler/takip" className="text-xs font-semibold text-ink-soft hover:underline">
                  Takiplere git →
                </Link>
              )}
            </Kpi>
          </div>

          <Card title="Eğilim" description={report.granularity === 'WEEK' ? 'Haftalık NPS' : 'Aylık NPS'}>
            {kind === 'POST_STAY' ? <Trend trend={report.trend} granularity={report.granularity} /> : <p className="text-sm text-ink-muted">Ara ankette NPS sorusu yok; genel puan üstte.</p>}
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Sorular" description="Soru başına cevap, ortalama ve dağılım (arşivdeki sorular dönemde cevabı varsa görünür).">
              <ul className="divide-y divide-line">
                {report.questions
                  .filter((question) => question.type !== 'TEXT')
                  .map((question) => (
                    <li key={question.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink">{question.text}</span>
                        <span className="text-xs text-ink-muted">
                          {SURVEY_QUESTION_TYPE_LABELS[question.type]} · {SURVEY_TOPIC_LABELS[question.topic] ?? question.topic} · {question.answers} cevap
                          {question.archived ? ' · arşivde' : ''}
                        </span>
                      </span>
                      {question.type === 'CHOICE' ? (
                        <span className="flex min-w-44 flex-col gap-1">
                          {question.options.map((option) => (
                            <span key={option.id} className="flex items-center gap-2 text-xs">
                              <span className="w-24 truncate text-ink-soft">{option.label}</span>
                              <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                                <span className="block h-full bg-info" style={{ width: `${question.answers ? (option.count / question.answers) * 100 : 0}%` }} />
                              </span>
                              <span className="w-8 text-right tabular-nums">{option.count}</span>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="flex items-center gap-3">
                          <Distribution distribution={question.distribution} nps={question.type === 'NPS'} />
                          <span className={`w-12 text-right font-brand text-xl font-bold tabular-nums ${TONE_TEXT[question.type === 'NPS' ? 'neutral' : ratingTone(question.average)]}`}>{formatScore(question.average)}</span>
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </Card>

            <div className="flex flex-col gap-5">
              <Card title="Bölüm puanları" description="Konu başına 1–5 ortalaması (cevap sayısıyla ağırlıklı).">
                {report.topics.length === 0 ? (
                  <p className="text-sm text-ink-muted">Bu dönemde puanlı soru cevabı yok.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {report.topics.map((row) => (
                      <li key={row.topic} className="flex items-center gap-3 text-sm">
                        <span className="w-32 shrink-0 text-ink-soft">{SURVEY_TOPIC_LABELS[row.topic]}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                          <span className={`block h-full ${row.average >= 4.2 ? 'bg-success' : row.average >= 3.2 ? 'bg-warning' : 'bg-danger'}`} style={{ width: `${(row.average / 5) * 100}%` }} />
                        </span>
                        <span className="w-10 text-right font-semibold tabular-nums">{formatScore(row.average)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Yorumlarda geçen konular" description="AI'ın yorumlara verdiği konu etiketleri ve tonları.">
                {report.aiTopics.length === 0 ? (
                  <p className="text-sm text-ink-muted">{report.comments ? 'Yorumlar henüz etiketlenmedi (AI kapalı olabilir).' : 'Bu dönemde yorum yok.'}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {report.aiTopics.map((row) => (
                      <li key={row.topic} className="flex flex-wrap items-center gap-2 text-sm">
                        <Link to={`/anketler/cevaplar?topic=${row.topic}`} className="w-32 shrink-0 font-semibold text-ink hover:underline">
                          {SURVEY_TOPIC_LABELS[row.topic]}
                        </Link>
                        <span className="text-ink-muted">{row.mentions} yorum</span>
                        {row.positive > 0 && <Badge tone="success">{row.positive} olumlu</Badge>}
                        {row.negative > 0 && <Badge tone="danger">{row.negative} olumsuz</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <InsightPanel kind={kind} period={period} comments={report.comments} />
        </>
      )}
    </div>
  );
}
