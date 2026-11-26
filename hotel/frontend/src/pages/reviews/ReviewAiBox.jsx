import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REVIEW_ANALYSIS_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Button, Card } from '@hotelos/ui';
import { apiPost } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { reviewKeys, sentimentScoreView } from '../../lib/reviews.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { SentimentBadge, TagChips } from './ReviewBadges.jsx';
import { TagDialog } from './TagDialog.jsx';

/** @param {{ label: string, children: React.ReactNode }} props */
function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
      <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      <span className="min-w-0 text-sm text-ink">{children}</span>
    </div>
  );
}

/**
 * AI kutusu (modül 54): Türkçe özet, duygu + puan, konu, departman, dil, model. "Etiketi düzelt" ve "Yeniden analiz"
 * `reviews.manage` ister; yeniden analiz personel etiketini siler.
 * @param {{ review: any }} props
 */
export function ReviewAiBox({ review }) {
  const can = useCan();
  const canManage = can(PERMISSIONS.REVIEWS_MANAGE);
  const queryClient = useQueryClient();
  const [tagging, setTagging] = useState(false);
  const { analysis } = review;
  const reanalyze = useMutation({
    mutationFn: () => apiPost(`/reviews/${review.id}/reanalyze`, {}),
    onSuccess: (data) => {
      queryClient.setQueryData(reviewKeys.review(review.id), data);
      queryClient.invalidateQueries({ queryKey: reviewKeys.all });
      toastSuccess('Yeniden analize gönderildi');
    },
    onError: (error) => toastError(error.message),
  });
  const score = sentimentScoreView(analysis.score);
  const hasTags = Boolean(analysis.sentiment);

  return (
    <Card
      title="AI analizi"
      description={analysis.manuallyTagged ? 'Etiketi personel koydu.' : 'Duygu, konu ve departman etiketi; özet ve cevap önerisi.'}
      actions={
        canManage && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" icon="pencil" onClick={() => setTagging(true)}>
              Etiketi düzelt
            </Button>
            {review.text && (
              <Button type="button" size="sm" variant="outline" icon="refresh" onClick={() => reanalyze.mutate()} disabled={reanalyze.isPending || analysis.status === 'PENDING'}>
                {reanalyze.isPending ? 'Gönderiliyor…' : 'Yeniden analiz'}
              </Button>
            )}
          </div>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {analysis.status === 'PENDING' && <Alert tone="info">AI analizi bekliyor — ajan kapalıysa Yönetim → Aktörler'den açın. Etiketi elle de koyabilirsiniz.</Alert>}
        {analysis.status === 'FAILED' && <Alert tone="warning">AI bu yorumu analiz edemedi. Yeniden deneyin ya da etiketi elle koyun.</Alert>}
        {analysis.status === 'SKIPPED' && !hasTags && <p className="text-sm text-ink-muted">Metni olmayan yorum analiz edilmez.</p>}
        {analysis.summary && <p className="text-sm leading-relaxed text-ink">{analysis.summary}</p>}
        {hasTags && (
          <>
            <Row label="Duygu">
              <span className="inline-flex flex-wrap items-center gap-2">
                <SentimentBadge analysis={analysis} />
                {analysis.score !== null && <span className="text-xs text-ink-muted">{score.label} (−100…+100)</span>}
              </span>
            </Row>
            <Row label="Konu">{analysis.topics.length ? <TagChips topics={analysis.topics} /> : '—'}</Row>
            <Row label="Departman">{analysis.departments.length ? <TagChips topics={[]} departments={analysis.departments} /> : '—'}</Row>
          </>
        )}
        <Row label="Dil">{review.language ? review.language.toUpperCase() : '—'}</Row>
        <p className="text-xs text-ink-muted">
          {REVIEW_ANALYSIS_STATUS_LABELS[analysis.status] ?? analysis.status}
          {analysis.model ? ` · ${analysis.model}` : ''}
          {analysis.analyzedAt ? ` · ${formatDateTime(analysis.analyzedAt)}` : ''}
        </p>
      </div>
      {tagging && <TagDialog review={review} onClose={() => setTagging(false)} />}
    </Card>
  );
}
