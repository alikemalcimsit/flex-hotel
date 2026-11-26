import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_REVIEW_REPLY, reviewReplySchema } from '@hotelos/hotel-contracts';
import { Alert, Button, Card, Textarea } from '@hotelos/ui';
import { apiPut } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { copyText, reviewKeys } from '../../lib/reviews.js';
import { validateWith } from '../../lib/validate.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { ReplyBadge } from './ReviewBadges.jsx';

const DONE_MESSAGES = Object.freeze({ DRAFT: 'Taslak kaydedildi', REPLIED: 'Cevaplandı olarak işaretlendi', NOT_NEEDED: 'Cevap gerekmiyor olarak işaretlendi' });

/**
 * Cevap kutusu (modül 54): kayıtlı cevap ya da AI'ın önerdiği cevapla dolu düzenlenebilir metin. "Kopyala" herkes için;
 * "Taslak kaydet", "Cevaplandı olarak işaretle", "Cevap gerekmiyor" `reviews.reply` ister. Cevap platformda elle yayınlanır.
 * @param {{ review: any }} props
 */
export function ReplyBox({ review }) {
  const can = useCan();
  const canReply = can(PERMISSIONS.REVIEWS_REPLY);
  const queryClient = useQueryClient();
  const suggested = review.analysis.suggestedReply ?? '';
  const [text, setText] = useState(review.reply.text ?? suggested);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (body) => apiPut(`/reviews/${review.id}/reply`, body),
    onSuccess: (data, body) => {
      queryClient.setQueryData(reviewKeys.review(review.id), data);
      queryClient.invalidateQueries({ queryKey: reviewKeys.all });
      toastSuccess(DONE_MESSAGES[body.status]);
    },
    onError: (failure) => toastError(failure.message),
  });

  /** @param {'DRAFT' | 'REPLIED' | 'NOT_NEEDED'} status */
  const send = (status) => {
    const checked = validateWith(reviewReplySchema, { status, replyText: text });
    if (!checked.ok) return setError(checked.errors.replyText ?? 'Geçersiz cevap');
    setError('');
    save.mutate(checked.data);
  };
  const { reply } = review;
  const usingSuggestion = !reply.text && suggested && text === suggested;

  return (
    <Card title="Cevap" description="Metni düzenleyip kopyalayın, platformda yayınlayın, sonra burada işaretleyin." actions={<ReplyBadge status={reply.status} />}>
      <div className="flex flex-col gap-3">
        {review.existingReply && (
          <div className="rounded-control border border-line bg-surface-muted p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Platformdaki otel cevabı</span>
            <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{review.existingReply}</p>
          </div>
        )}
        {usingSuggestion && <p className="text-xs text-ink-muted">AI'ın önerdiği cevap (yorumun dilinde). Göndermeden önce okuyun.</p>}
        {!text && !suggested && review.analysis.status === 'PENDING' && <p className="text-xs text-ink-muted">AI analizi bitince önerilen cevap burada görünür.</p>}
        <Textarea
          label="Cevap metni"
          name="review-reply"
          rows={7}
          value={text}
          maxLength={MAX_REVIEW_REPLY}
          onChange={(event) => setText(event.target.value)}
          error={error}
          disabled={!canReply || save.isPending}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" icon="clipboard" onClick={() => copyText(text, 'Cevap kopyalandı')} disabled={!text.trim()}>
            Kopyala
          </Button>
          {canReply && (
            <>
              <Button type="button" size="sm" variant="outline" icon="pencil" onClick={() => send('DRAFT')} disabled={save.isPending}>
                Taslak kaydet
              </Button>
              <Button type="button" size="sm" icon="checkCircle" onClick={() => send('REPLIED')} disabled={save.isPending}>
                Cevaplandı olarak işaretle
              </Button>
              <Button type="button" size="sm" variant="outline" icon="close" onClick={() => send('NOT_NEEDED')} disabled={save.isPending}>
                Cevap gerekmiyor
              </Button>
            </>
          )}
          {suggested && text !== suggested && canReply && (
            <Button type="button" size="sm" variant="outline" icon="sparkles" onClick={() => setText(suggested)} disabled={save.isPending}>
              Öneriyi geri getir
            </Button>
          )}
        </div>
        {reply.status === 'REPLIED' && reply.repliedAt && (
          <Alert tone="success">
            {formatDateTime(reply.repliedAt)} · {reply.repliedBy ?? '—'} cevapladı.
          </Alert>
        )}
        {reply.status === 'NOT_NEEDED' && <p className="text-xs text-ink-muted">Cevap gerekmiyor ({reply.repliedBy ?? '—'}).</p>}
      </div>
    </Card>
  );
}
