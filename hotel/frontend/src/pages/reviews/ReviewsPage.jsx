import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { REVIEWS_PAGE_SIZE, ratingPctTone, reviewKeys, reviewPath } from '../../lib/reviews.js';
import { RatingText, ReplyBadge, SentimentBadge, SourceBadge, TagChips } from './ReviewBadges.jsx';
import { ReviewCreateDialog } from './ReviewCreateDialog.jsx';
import { ReviewImportDialog } from './ReviewImportDialog.jsx';
import { REVIEW_FILTER_KEYS, ReviewsToolbar } from './ReviewsToolbar.jsx';

const TILE_TONES = Object.freeze({ success: 'neutral', warning: 'warning', danger: 'danger', neutral: 'neutral' });

const COLUMNS = [
  {
    key: 'review',
    header: 'Yorum',
    render: (row) => (
      <Link to={reviewPath(row.id)} className="flex max-w-xl flex-col gap-1 hover:underline-offset-2">
        <span className="flex flex-wrap items-center gap-2">
          <SourceBadge source={row.source} />
          <RatingText review={row} />
          <span className="text-xs text-ink-muted">
            {formatDate(row.reviewedAt)}
            {row.authorName ? ` · ${row.authorName}` : ''}
          </span>
        </span>
        {row.title && <span className="font-semibold text-ink hover:underline">{row.title}</span>}
        {row.text ? <span className="line-clamp-2 text-sm text-ink-soft">{row.text}</span> : <span className="text-xs text-ink-muted">Metin yok</span>}
      </Link>
    ),
  },
  {
    key: 'analysis',
    header: 'AI etiketi',
    render: (row) => (
      <span className="flex max-w-xs flex-col gap-1">
        <SentimentBadge analysis={row.analysis} />
        <TagChips topics={row.analysis.topics ?? []} />
      </span>
    ),
  },
  { key: 'reply', header: 'Cevap', className: 'whitespace-nowrap', render: (row) => <ReplyBadge status={row.reply.status} /> },
];

/**
 * Yorum listesi (modül 54): özet kutuları, süzgeçler (adres satırında: anomali zili `?topic=…` açar),
 * satır → ayrıntı. "Yorum ekle" ve "Dosyadan yükle" `reviews.manage` ister.
 */
export function ReviewsPage() {
  const can = useCan();
  const canManage = can(PERMISSIONS.REVIEWS_MANAGE);
  const [params, setParams] = useSearchParams();
  const [searchText, setSearchText] = useState(params.get('search') ?? '');
  const search = useDebounced(searchText);
  const [dialog, setDialog] = useState(/** @type {'create' | 'import' | null} */ (null));
  const values = Object.fromEntries(REVIEW_FILTER_KEYS.map((key) => [key, params.get(key) ?? '']));
  const page = Number(params.get('page')) || 1;

  /** Süzgeç değişince sayfa başa döner. @param {string} key @param {string} value */
  const setFilter = (key, value) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      return next;
    }, { replace: true });
  const setPage = (next) => setFilter('page', next > 1 ? String(next) : '');
  const toggleFilter = (key, value) => setFilter(key, values[key] === value ? '' : value);

  const filters = {
    ...Object.fromEntries(Object.entries(values).filter(([, value]) => value)),
    search: search || undefined,
    page,
    pageSize: REVIEWS_PAGE_SIZE,
  };
  const list = useQuery({ queryKey: reviewKeys.list(filters), queryFn: () => api(withQuery('/reviews', filters)), placeholderData: keepPreviousData });
  const summary = list.data?.summary;
  const filtered = REVIEW_FILTER_KEYS.some((key) => key !== 'sort' && values[key]) || Boolean(search);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Yorum" value={summary?.total} hint={filtered ? 'Süzgece uyan' : 'Toplam'} icon="message" />
        <SummaryTile label="Ortalama puan" value={summary?.averagePct ?? undefined} hint="100 üzerinden (kaynak ölçeği çevrilir)" icon="star" tone={TILE_TONES[ratingPctTone(summary?.averagePct)]} />
        <SummaryTile
          label="Olumsuz, cevapsız"
          value={summary?.unansweredNegative}
          hint="Olumsuz / karışık; cevap yok ya da taslak"
          icon="alertTriangle"
          tone={summary?.unansweredNegative ? 'danger' : 'neutral'}
          selected={values.sentiment === 'NEGATIVE' && values.replyStatus === 'NONE'}
          onClick={() => {
            const active = values.sentiment === 'NEGATIVE' && values.replyStatus === 'NONE';
            setParams(active ? {} : { sentiment: 'NEGATIVE', replyStatus: 'NONE' }, { replace: true });
          }}
        />
        <SummaryTile label="Analiz bekleyen" value={summary?.pendingAnalysis} hint="AI etiketi bekleniyor" icon="sparkles" selected={values.analysisStatus === 'PENDING'} onClick={() => toggleFilter('analysisStatus', 'PENDING')} />
      </div>
      <ReviewsToolbar
        values={values}
        onChange={setFilter}
        searchText={searchText}
        onSearch={setSearchText}
        actions={
          canManage && (
            <>
              <Button type="button" variant="outline" icon="upload" onClick={() => setDialog('import')}>
                Dosyadan yükle
              </Button>
              <Button type="button" icon="plus" onClick={() => setDialog('create')}>
                Yorum ekle
              </Button>
            </>
          )
        }
      />
      <DataTable
        columns={COLUMNS}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={filtered ? 'Eşleşen yorum yok' : 'Henüz yorum yok'}
        emptyHint={filtered ? 'Süzgeçleri gevşetin.' : canManage ? '"Yorum ekle" ya da "Dosyadan yükle" ile başlayın (Booking / Google dışa aktarımı).' : undefined}
        rowActions={(row) => (
          <Link to={reviewPath(row.id)} className="inline-flex items-center gap-1.5 rounded-item px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.04] hover:text-ink">
            Ayrıntı
          </Link>
        )}
      />
      {dialog === 'create' && <ReviewCreateDialog onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ReviewImportDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

