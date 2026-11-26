import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { REVIEW_DEPARTMENT_LABELS, REVIEW_SOURCE_LABELS, REVIEW_SOURCES, SURVEY_TOPIC_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Card, Icon, Select } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { REVIEWS_BASE_PATH, anomalyText, negativeShare, reviewKeys, sortTopicsByNegative } from '../../lib/reviews.js';
import { WeeklyCountChart, WeeklySentimentChart } from './TrendCharts.jsx';

const WEEK_OPTIONS = ['8', '12', '26', '52'].map((value) => ({ value, label: `${value} hafta` }));
const SOURCE_OPTIONS = [{ value: '', label: 'Bütün kaynaklar' }, ...REVIEW_SOURCES.map((value) => ({ value, label: REVIEW_SOURCE_LABELS[value] }))];
const TH = 'px-3 py-2 font-semibold';

/** @param {Record<string, string>} params */
const listLink = (params) => withQuery(`${REVIEWS_BASE_PATH}/liste`, params);

/**
 * Yorum trendi (modül 54): hafta sayısı ve kaynak; haftalık yorum + ortalama puan, haftalık duygu, konu tablosu (olumsuz paya
 * göre; tıklayınca listeye süzgeçle), departman tablosu, son anomaliler.
 */
export function TrendsPage() {
  const [weeks, setWeeks] = useState('12');
  const [source, setSource] = useState('');
  const params = { weeks: Number(weeks), source: source || undefined };
  const query = useQuery({ queryKey: reviewKeys.trends(params), queryFn: () => api(withQuery('/reviews/trends', params)), placeholderData: keepPreviousData });
  const data = query.data;
  const empty = data && data.weeks.every((row) => row.count === 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <ChoiceChips label="Dönem" options={WEEK_OPTIONS} value={weeks} onChange={(value) => value && setWeeks(value)} required />
        <Select label="Kaynak" name="reviews-trend-source" options={SOURCE_OPTIONS} value={source} onChange={(event) => setSource(event.target.value)} className="w-full sm:w-48" />
        {data && <span className="pb-2 text-xs text-ink-muted">{formatDate(data.from)} – {formatDate(data.to)}</span>}
      </div>
      {query.isPending || query.isError ? (
        <QueryFallback query={query} errorTitle="Trend okunamadı" />
      ) : (
        <>
          <AnomalyList anomalies={data.anomalies} />
          {empty ? (
            <p className="rounded-card border border-line bg-surface p-6 text-sm text-ink-muted">Bu dönemde yorum yok.</p>
          ) : (
            <div className="grid gap-5 xl:grid-cols-2">
              <Card title="Yorum ve puan" description="Haftalık yorum sayısı ve ortalama puan">
                <WeeklyCountChart weeks={data.weeks} />
              </Card>
              <Card title="Duygu" description="Haftalık duygu dağılımı (AI etiketli yorumlar)">
                <WeeklySentimentChart weeks={data.weeks} />
              </Card>
              <TopicTable topics={data.topics} />
              <DepartmentTable departments={data.departments} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** @param {{ topics: any[] }} props */
function TopicTable({ topics }) {
  return (
    <Card title="Konular" description="Olumsuz paya göre; konuya basınca o konunun olumsuz yorumları açılır.">
      {topics.length === 0 ? (
        <p className="text-sm text-ink-muted">Etiketli yorum yok.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-muted">
            <tr className="text-right">
              <th scope="col" className={`${TH} text-left`}>Konu</th>
              <th scope="col" className={TH}>Olumsuz</th>
              <th scope="col" className={TH}>Olumlu</th>
              <th scope="col" className={TH}>Toplam</th>
            </tr>
          </thead>
          <tbody>
            {sortTopicsByNegative(topics).map((row) => (
              <tr key={row.topic} className="border-t border-line text-right tabular-nums">
                <th scope="row" className="px-3 py-2 text-left font-semibold">
                  <Link to={listLink({ topic: row.topic, sentiment: row.negative ? 'NEGATIVE' : '' })} className="hover:underline">
                    {SURVEY_TOPIC_LABELS[row.topic] ?? row.label}
                  </Link>
                </th>
                <td className="px-3 py-2">
                  {row.negative ? <Badge tone="danger">{row.negative} · %{negativeShare(row)}</Badge> : <span className="text-ink-muted">0</span>}
                </td>
                <td className="px-3 py-2">{row.positive}</td>
                <td className="px-3 py-2">
                  <Link to={listLink({ topic: row.topic })} className="hover:underline">
                    {row.count}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** @param {{ departments: Array<{ department: string, count: number, negative: number }> }} props */
function DepartmentTable({ departments }) {
  return (
    <Card title="Departmanlar" description="Yorumlarda adı geçen departmanlar ve olumsuz sayısı.">
      {departments.length === 0 ? (
        <p className="text-sm text-ink-muted">Etiketli yorum yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {departments.map((row) => (
            <li key={row.department} className="flex items-center gap-3 text-sm">
              <Link to={listLink({ department: row.department })} className="w-32 shrink-0 font-semibold text-ink hover:underline">
                {REVIEW_DEPARTMENT_LABELS[row.department] ?? row.department}
              </Link>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <span className="block h-full bg-danger" style={{ width: `${row.count ? (row.negative / row.count) * 100 : 0}%` }} />
              </span>
              <span className="w-24 text-right text-xs tabular-nums text-ink-muted">
                {row.negative} olumsuz / {row.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** @param {{ anomalies: any[] }} props */
function AnomalyList({ anomalies }) {
  if (!anomalies.length) return null;
  return (
    <Card title="Olumsuz konu artışları" description="Son 7 günde bir konuda olumsuz yorum, önceki 4 haftanın ortalamasının en az 2 katı.">
      <ul className="flex flex-col divide-y divide-line">
        {anomalies.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <Link to={listLink({ topic: row.topic })} className="inline-flex items-center gap-2 font-semibold text-ink hover:underline">
              <Icon name="alertTriangle" className="size-4 text-warning-ink" />
              {anomalyText(row)}
            </Link>
            <span className="text-xs text-ink-muted">
              {formatDate(row.weekStart)} haftası · {formatDateTime(row.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
