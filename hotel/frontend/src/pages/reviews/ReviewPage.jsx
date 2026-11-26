import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card } from '@hotelos/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { api, apiDelete } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { REVIEWS_BASE_PATH, reviewKeys } from '../../lib/reviews.js';
import { toastSuccess } from '../../store/toast.js';
import { RatingText, SourceBadge } from './ReviewBadges.jsx';
import { ReplyBox } from './ReplyBox.jsx';
import { ReviewAiBox } from './ReviewAiBox.jsx';

const LIST_PATH = `${REVIEWS_BASE_PATH}/liste`;

/**
 * Yorum ayrıntısı (modül 54): tam metin, puan, kaynak bağlantısı; AI kutusu; cevap kutusu; sil (`reviews.manage`, onaylı).
 */
export function ReviewPage() {
  const { reviewId = '' } = useParams();
  const query = useQuery({ queryKey: reviewKeys.review(reviewId), queryFn: () => api(`/reviews/${reviewId}`) });
  const review = query.data;

  return (
    <div className="flex flex-col gap-5">
      <Link to={LIST_PATH} className="text-sm font-semibold text-ink-soft hover:underline">
        ← Yorumlara dön
      </Link>
      {query.isPending || query.isError ? (
        <QueryFallback query={query} errorTitle="Yorum açılamadı" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <ReviewText review={review} />
            <ReplyBox key={`${review.id}-${review.analysis.suggestedReply ? 1 : 0}`} review={review} />
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <ReviewAiBox review={review} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Yorumun kendisi ve sil düğmesi. @param {{ review: any }} props */
function ReviewText({ review }) {
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => apiDelete(`/reviews/${review.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewKeys.all });
      toastSuccess('Yorum silindi');
      navigate(LIST_PATH, { replace: true });
    },
  });
  return (
    <Card
      title={review.title || 'Yorum'}
      description={`${formatDate(review.reviewedAt)}${review.authorName ? ` · ${review.authorName}` : ''}`}
      actions={
        can(PERMISSIONS.REVIEWS_MANAGE) && (
          <Button type="button" size="sm" variant="outline" icon="trash" onClick={() => setConfirming(true)}>
            Sil
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={review.source} />
          <RatingText review={review} />
          {review.ratingPct !== null && <span className="text-xs text-ink-muted">%{review.ratingPct}</span>}
        </div>
        {review.text ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{review.text}</p> : <p className="text-sm text-ink-muted">Yalnız puan verilmiş; metin yok.</p>}
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
          {review.url && (
            <a href={review.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-info-ink hover:underline">
              Platformda aç ↗
            </a>
          )}
          {review.externalId && <span>Yorum no {review.externalId}</span>}
          <span>
            {review.importId ? 'Dosyadan yüklendi' : 'Elle girildi'} · {review.createdBy} · {formatDateTime(review.createdAt)}
          </span>
        </p>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Yorum silinsin mi?"
        message="Yorum, AI etiketi ve cevap kaydı listeden kalkar. Aynı yorum sonra yeniden yüklenebilir."
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirming(false)}
        isPending={remove.isPending}
        error={remove.error}
      />
    </Card>
  );
}
