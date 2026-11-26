import { REVIEW_DEPARTMENT_LABELS, REVIEW_REPLY_STATUS_LABELS, REVIEW_SOURCE_LABELS, SURVEY_SENTIMENT_LABELS, SURVEY_SENTIMENT_TONES, SURVEY_TOPIC_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Icon } from '@hotelos/ui';
import { formatReviewRating, reviewReplyTone, reviewSourceTone, reviewStars, sentimentScoreView } from '../../lib/reviews.js';

/** Misafir yorumları (modül 54) ekranlarının küçük rozetleri: kaynak, puan + yıldız, duygu, konu / departman çipleri, cevap. */

const STAR_SLOTS = [0, 1, 2, 3, 4];

/** @param {{ source: string }} props */
export function SourceBadge({ source }) {
  return (
    <Badge tone={reviewSourceTone(source)} dot={false}>
      {REVIEW_SOURCE_LABELS[source] ?? source}
    </Badge>
  );
}

/** Yıldızlar ve "8,4 / 10". @param {{ review: { rating: number | null, ratingScale: number, ratingPct: number | null } }} props */
export function RatingText({ review }) {
  if (review.rating === null || review.rating === undefined) return <span className="text-xs text-ink-muted">Puansız</span>;
  const filled = reviewStars(review.ratingPct);
  return (
    <span className="inline-flex items-center gap-1.5" title={`%${review.ratingPct}`}>
      <span className="inline-flex" aria-hidden="true">
        {STAR_SLOTS.map((slot) => (
          <Icon key={slot} name="star" className={`size-3.5 ${slot < filled ? 'text-warning' : 'text-line-strong'}`} />
        ))}
      </span>
      <span className="text-sm font-semibold tabular-nums text-ink">{formatReviewRating(review.rating, review.ratingScale)}</span>
    </span>
  );
}

/** Duygu rozeti ve puanı; analiz bitmediyse durum metni. @param {{ analysis: any }} props */
export function SentimentBadge({ analysis }) {
  if (analysis.status === 'PENDING') return <span className="text-xs text-ink-muted">AI etiketliyor…</span>;
  if (analysis.status === 'FAILED') return <Badge tone="warning">Analiz edilemedi</Badge>;
  if (!analysis.sentiment) return null;
  const score = sentimentScoreView(analysis.score);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={SURVEY_SENTIMENT_TONES[analysis.sentiment]}>{SURVEY_SENTIMENT_LABELS[analysis.sentiment]}</Badge>
      {analysis.score !== null && (
        <span className="text-xs font-semibold tabular-nums text-ink-muted" title={score.label}>
          {score.text}
        </span>
      )}
    </span>
  );
}

/** @param {{ topics: string[], departments?: string[] }} props */
export function TagChips({ topics, departments = [] }) {
  if (!topics.length && !departments.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {topics.map((topic) => (
        <Badge key={topic} tone="neutral" dot={false}>
          {SURVEY_TOPIC_LABELS[topic] ?? topic}
        </Badge>
      ))}
      {departments.map((department) => (
        <Badge key={department} tone="violet" dot={false}>
          {REVIEW_DEPARTMENT_LABELS[department] ?? department}
        </Badge>
      ))}
    </span>
  );
}

/** @param {{ status: string }} props */
export function ReplyBadge({ status }) {
  return <Badge tone={reviewReplyTone(status)}>{REVIEW_REPLY_STATUS_LABELS[status] ?? status}</Badge>;
}
