import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SURVEY_FOLLOW_UP_OUTCOME_LABELS, SURVEY_FOLLOW_UP_STATUS_LABELS, SURVEY_FOLLOW_UP_STATUS_TONES, SURVEY_KIND_LABELS, npsCategory } from '@hotelos/hotel-contracts';
import { Badge, Checkbox } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { surveyKeys } from '../../lib/surveys.js';
import { ScoreBadges } from './SurveyResponsesPage.jsx';

const PAGE_SIZE = 25;
const VIEWS = [
  { value: 'ACTIVE', label: 'Açık' },
  { value: 'RESOLVED', label: 'Kapanan' },
  { value: 'ALL', label: 'Hepsi' },
];

/**
 * Düşük puan takipleri (modül 55): açıklar hedef süreye göre (geciken önce, işaretli), kapananlar son kapanan önce;
 * "benimkiler" süzgeci. Satır takibin sayfasını açar.
 */
export function FollowUpsPage() {
  const [view, setView] = useState('ACTIVE');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [view, mine]);
  const filters = { view, mine: mine ? 'true' : undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: surveyKeys.followUps(filters), queryFn: () => api(withQuery('/surveys/follow-ups', filters)), placeholderData: keepPreviousData });
  const counts = list.data?.counts;

  const columns = [
    {
      key: 'guest',
      header: 'Misafir',
      render: (row) => (
        <Link to={`/anketler/takip/${row.id}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.reservation.guestName}</span>
          <span className="block text-xs text-ink-muted">
            {row.reservation.confirmationCode}
            {row.reservation.roomNumber ? ` · ${row.reservation.roomNumber}` : ''} · {SURVEY_KIND_LABELS[row.kind]}
          </span>
        </Link>
      ),
    },
    { key: 'score', header: 'Puan', render: (row) => <ScoreBadges row={{ ...row.response, lowScore: false, npsCategory: npsCategory(row.response.npsScore) }} /> },
    { key: 'comment', header: 'Yorum', render: (row) => (row.response.comment ? <span className="block max-w-sm text-sm text-ink-soft line-clamp-2">{row.response.comment}</span> : <span className="text-ink-muted">—</span>) },
    {
      key: 'status',
      header: 'Durum',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={SURVEY_FOLLOW_UP_STATUS_TONES[row.status]}>{SURVEY_FOLLOW_UP_STATUS_LABELS[row.status]}</Badge>
          <span className="text-xs text-ink-muted">{row.assignedTo ?? 'Kimse üstlenmedi'}</span>
          {row.status === 'RESOLVED' && row.outcome && <span className="text-xs text-ink-muted">{SURVEY_FOLLOW_UP_OUTCOME_LABELS[row.outcome]}</span>}
        </span>
      ),
    },
    {
      key: 'due',
      header: view === 'RESOLVED' ? 'Kapandı' : 'Hedef',
      className: 'whitespace-nowrap',
      render: (row) =>
        view === 'RESOLVED' || row.status === 'RESOLVED' ? (
          formatDateTime(row.resolvedAt)
        ) : (
          <span className="flex flex-col items-start gap-1">
            <span className="tabular-nums">{formatDateTime(row.dueAt)}</span>
            {row.overdue && <Badge tone="danger">Gecikti</Badge>}
          </span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {counts && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryTile label="Açık" value={counts.open} hint="Kimse ilgilenmedi" icon="alertCircle" tone={counts.open ? 'warning' : 'neutral'} />
          <SummaryTile label="İlgileniliyor" value={counts.inProgress} hint="Üstlenildi ya da misafirle görüşüldü" icon="users" />
          <SummaryTile label="Geciken" value={counts.overdue} hint="İçeride 2 saat, çıkmışta 48 saat" icon="clock" tone={counts.overdue ? 'danger' : 'neutral'} />
        </div>
      )}
      <Toolbar>
        <ChoiceChips label="Görünüm" options={VIEWS} value={view} onChange={(value) => value && setView(value)} />
        <Checkbox name="followup-mine" label="Yalnız benimkiler" checked={mine} onChange={(event) => setMine(event.target.checked)} />
      </Toolbar>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={view === 'ACTIVE' ? 'Açık takip yok' : 'Kayıt yok'}
        emptyHint={view === 'ACTIVE' ? 'Düşük puanlı her cevap burada bir takip açar; misafirle görüşüp kapatın.' : undefined}
      />
    </div>
  );
}
