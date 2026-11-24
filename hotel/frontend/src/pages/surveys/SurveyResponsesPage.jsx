import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  NPS_CATEGORIES,
  NPS_CATEGORY_LABELS,
  NPS_CATEGORY_TONES,
  SURVEY_FOLLOW_UP_STATUS_LABELS,
  SURVEY_FOLLOW_UP_STATUS_TONES,
  SURVEY_KIND_LABELS,
  SURVEY_KINDS,
  SURVEY_SENTIMENT_LABELS,
  SURVEY_SENTIMENTS,
  SURVEY_SENTIMENT_TONES,
  SURVEY_TOPIC_LABELS,
  SURVEY_TOPICS,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Checkbox, Input, Select, Spinner } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { useDebounced } from '../../lib/pos.js';
import { SURVEY_PERIODS, formatScore, periodOf, ratingTone, surveyKeys } from '../../lib/surveys.js';

const PAGE_SIZE = 25;
const all = (label = 'Hepsi') => ({ value: '', label });

/** NPS ve puan ortalaması rozetleri. @param {{ row: any }} props */
export function ScoreBadges({ row }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {row.npsScore !== null && <Badge tone={NPS_CATEGORY_TONES[row.npsCategory]}>NPS {row.npsScore}</Badge>}
      {row.ratingAverage !== null && <Badge tone={ratingTone(row.ratingAverage) === 'success' ? 'success' : ratingTone(row.ratingAverage) === 'danger' ? 'danger' : 'warning'}>{formatScore(row.ratingAverage)} / 5</Badge>}
      {row.lowScore && <Badge tone="danger">Düşük</Badge>}
    </span>
  );
}

/** AI etiketi: duygu, konular, tek cümle. @param {{ row: any }} props */
function AiTags({ row }) {
  if (row.analysisStatus === 'PENDING') return <span className="text-xs text-ink-muted">AI etiketliyor…</span>;
  if (row.analysisStatus !== 'DONE') return null;
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap gap-1">
        {row.sentiment && <Badge tone={SURVEY_SENTIMENT_TONES[row.sentiment]}>{SURVEY_SENTIMENT_LABELS[row.sentiment]}</Badge>}
        {row.topics.map((topic) => (
          <Badge key={topic} tone="neutral">
            {SURVEY_TOPIC_LABELS[topic] ?? topic}
          </Badge>
        ))}
      </span>
      {row.aiSummary && <span className="text-xs text-ink-muted">{row.aiSummary}</span>}
    </span>
  );
}

/** Cevabın ayrıntısı: bütün cevaplar, yorum, AI etiketi, takip, konaklama. @param {{ responseId: string, onClose: () => void }} props */
function ResponseDialog({ responseId, onClose }) {
  const query = useQuery({ queryKey: surveyKeys.response(responseId), queryFn: () => api(`/surveys/responses/${responseId}`) });
  const data = query.data;
  return (
    <Modal open title="Anket cevabı" onClose={onClose} size="lg" footer={<Button type="button" variant="outline" onClick={onClose}>Kapat</Button>}>
      {query.isPending ? (
        <Spinner label="Yükleniyor…" className="py-8" />
      ) : query.isError ? (
        <Alert tone="danger" action={<Button type="button" size="sm" variant="outline" onClick={() => query.refetch()}>Tekrar dene</Button>}>{query.error.message}</Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link to={`/rezervasyonlar/${data.reservation.id}`} className="font-semibold text-ink hover:underline">
                {data.reservation.guestName} · {data.reservation.confirmationCode}
              </Link>
              <p className="text-xs text-ink-muted">
                {SURVEY_KIND_LABELS[data.kind]} · {formatDate(data.reservation.checkIn)} – {formatDate(data.reservation.checkOut)}
                {data.reservation.roomNumber ? ` · oda ${data.reservation.roomNumber}` : ''} · gönderildi {formatDateTime(data.submittedAt)} · {data.language.toUpperCase()}
              </p>
            </div>
            <ScoreBadges row={data} />
          </div>
          {data.followUp && (
            <Alert tone={data.followUp.status === 'RESOLVED' ? 'success' : 'warning'} action={<Link to={`/anketler/takip/${data.followUp.id}`} className="text-sm font-semibold hover:underline">Takibe git</Link>}>
              Takip: {SURVEY_FOLLOW_UP_STATUS_LABELS[data.followUp.status]}
              {data.followUp.assignedTo ? ` · ${data.followUp.assignedTo}` : ' · kimse üstlenmedi'}
            </Alert>
          )}
          <AiTags row={data} />
          <ul className="divide-y divide-line rounded-card border border-line">
            {data.answers.map((answer) => (
              <li key={answer.questionId} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between">
                <span className="text-sm text-ink-soft">
                  {answer.question}
                  {answer.archived ? <span className="text-xs text-ink-muted"> (arşivde)</span> : null}
                </span>
                <span className="text-sm font-semibold text-ink sm:max-w-[55%] sm:text-right">
                  {answer.type === 'TEXT' ? <span className="whitespace-pre-line font-normal">{answer.text}</span> : answer.type === 'CHOICE' ? answer.choices.join(', ') : `${answer.score}${answer.type === 'NPS' ? ' / 10' : ' / 5'}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">
            Davet {formatDateTime(data.invitation.sentAt)} · açıldı {formatDateTime(data.invitation.openedAt)}
            {data.contact.email ? ` · ${data.contact.email}` : ''}
            {data.contact.phone ? ` · ${data.contact.phone}` : ''}
          </p>
        </div>
      )}
    </Modal>
  );
}

/**
 * Anket cevapları (modül 55): yeniden eskiye; tür, dönem, NPS kategorisi, düşük puan, yorumlu, AI duygu ve konusu,
 * arama (onay kodu, misafir adı, yorum — en az üç karakter). Satır cevabın ayrıntısını açar.
 */
export function SurveyResponsesPage() {
  const [params] = useSearchParams();
  const [kind, setKind] = useState('');
  const [days, setDays] = useState('30');
  const [category, setCategory] = useState('');
  const [sentiment, setSentiment] = useState('');
  const [topic, setTopic] = useState(params.get('topic') ?? '');
  const [lowOnly, setLowOnly] = useState(false);
  const [withComment, setWithComment] = useState(false);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  useEffect(() => setPage(1), [kind, days, category, sentiment, topic, lowOnly, withComment, search]);

  const period = periodOf(days);
  const filters = {
    kind: kind || undefined,
    ...period,
    category: category || undefined,
    sentiment: sentiment || undefined,
    topic: topic || undefined,
    lowOnly: lowOnly ? 'true' : undefined,
    withComment: withComment ? 'true' : undefined,
    search: search.trim().length >= 3 ? search.trim() : undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const list = useQuery({ queryKey: surveyKeys.responses(filters), queryFn: () => api(withQuery('/surveys/responses', filters)), placeholderData: keepPreviousData });
  const filtered = Boolean(kind || category || sentiment || topic || lowOnly || withComment || filters.search);

  const columns = [
    {
      key: 'guest',
      header: 'Misafir',
      render: (row) => (
        <button type="button" className="block text-left hover:underline" onClick={() => setSelected(row.id)}>
          <span className="block font-semibold text-ink">{row.reservation.guestName}</span>
          <span className="block text-xs text-ink-muted">
            {row.reservation.confirmationCode}
            {row.reservation.roomNumber ? ` · ${row.reservation.roomNumber}` : ''} · {SURVEY_KIND_LABELS[row.kind]}
          </span>
        </button>
      ),
    },
    { key: 'date', header: 'Gönderim', className: 'whitespace-nowrap', render: (row) => formatDateTime(row.submittedAt) },
    { key: 'score', header: 'Puan', render: (row) => <ScoreBadges row={row} /> },
    {
      key: 'comment',
      header: 'Yorum',
      render: (row) => (
        <span className="flex max-w-md flex-col gap-1">
          {row.comment ? <span className="text-sm text-ink-soft line-clamp-3">{row.comment}</span> : <span className="text-ink-muted">—</span>}
          <AiTags row={row} />
        </span>
      ),
    },
    {
      key: 'followUp',
      header: 'Takip',
      render: (row) =>
        row.followUp ? (
          <Link to={`/anketler/takip/${row.followUp.id}`}>
            <Badge tone={SURVEY_FOLLOW_UP_STATUS_TONES[row.followUp.status]}>{SURVEY_FOLLOW_UP_STATUS_LABELS[row.followUp.status]}</Badge>
          </Link>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <Select label="Anket" options={[all(), ...SURVEY_KINDS.map((value) => ({ value, label: SURVEY_KIND_LABELS[value] }))]} value={kind} onChange={(event) => setKind(event.target.value)} className="w-full sm:w-48" />
        <Select label="Dönem" options={SURVEY_PERIODS} value={days} onChange={(event) => setDays(event.target.value)} className="w-full sm:w-36" />
        <Select label="NPS" options={[all(), ...NPS_CATEGORIES.map((value) => ({ value, label: NPS_CATEGORY_LABELS[value] }))]} value={category} onChange={(event) => setCategory(event.target.value)} className="w-full sm:w-44" />
        <Select label="Ton (AI)" options={[all(), ...SURVEY_SENTIMENTS.map((value) => ({ value, label: SURVEY_SENTIMENT_LABELS[value] }))]} value={sentiment} onChange={(event) => setSentiment(event.target.value)} className="w-full sm:w-36" />
        <Select label="Konu (AI)" options={[all(), ...SURVEY_TOPICS.map((value) => ({ value, label: SURVEY_TOPIC_LABELS[value] }))]} value={topic} onChange={(event) => setTopic(event.target.value)} className="w-full sm:w-40" />
        <Input label="Ara" name="survey-search" placeholder="Onay kodu, misafir, yorum" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-56" />
        <Checkbox name="survey-low" label="Yalnız düşük puan" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
        <Checkbox name="survey-comment" label="Yalnız yorumlu" checked={withComment} onChange={(event) => setWithComment(event.target.checked)} />
      </Toolbar>
      {searchText.trim().length > 0 && searchText.trim().length < 3 && <p className="text-xs text-ink-muted">Arama en az üç karakterle başlar.</p>}
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Eşleşen cevap yok' : 'Bu dönemde cevap yok'}
        emptyHint={filtered ? undefined : 'Anket cevapları misafir gönderdikçe burada görünür.'}
      />
      {selected && <ResponseDialog responseId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
