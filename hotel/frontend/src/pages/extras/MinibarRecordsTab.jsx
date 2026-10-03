import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { EXTRAS_PAGE_SIZE } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, EmptyState, Input, Spinner } from '@hotelos/ui';
import { api, withQuery } from '../../lib/api.js';
import { POSTING_LABELS, POSTING_TONES, chargeTargetLabel, extrasKeys } from '../../lib/extras.js';
import { folioPath } from '../../lib/folios.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { EXTRAS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';

const timeFormatter = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
/** Yoğun sayım saatinde açık listeler seyrek tazelensin. */
const LIVE_MIN_INTERVAL_MS = 2000;

/**
 * Minibar kayıtları (modül 19): günün fişleri (son girilen önce), kime
 * yazıldığı ve folyoya gidiş durumu (işlendi / işleniyor / personele düştü /
 * kayıp). Folyo yetkisi olan folyoya geçer; düzeltme orada kalem iptaliyle.
 */
export function MinibarRecordsTab() {
  const can = useCan();
  const [date, setDate] = useState('');
  useLiveChannel(EXTRAS_CHANNEL, { queryKeys: [['extras', 'consumptions']], enabled: !date, minIntervalMs: LIVE_MIN_INTERVAL_MS });
  const list = useInfiniteQuery({
    queryKey: extrasKeys.consumptions({ date }),
    queryFn: ({ pageParam }) => api(withQuery('/extras/minibar/consumptions', { date: date || undefined, cursor: pageParam ?? undefined, limit: EXTRAS_PAGE_SIZE })),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((page) => page.consumptions) ?? [];
  const shownDate = list.data?.pages[0]?.date;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="İş günü" type="date" value={date || shownDate || ''} onChange={(event) => setDate(event.target.value)} className="w-44" />
        {date && <Button variant="outline" icon="calendar" onClick={() => setDate('')}>Bugün</Button>}
      </div>
      {list.isPending ? (
        <Spinner className="py-6" />
      ) : list.isError ? (
        <Alert tone="danger" title="Kayıtlar yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => list.refetch()}>Tekrar dene</Button>}>
          {list.error.message}
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState icon="list" title="Bu gün minibar sayımı yok" description="Sayım girildikçe burada görünür." />
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">Oda {row.roomNumber}</span>
                  <span className="font-mono text-xs text-ink-muted">{row.reference}</span>
                  <Badge tone={POSTING_TONES[row.posting.status]}>{POSTING_LABELS[row.posting.status]}</Badge>
                </span>
                <span className="mt-0.5 block text-ink-soft">{row.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')}</span>
                <span className="block text-xs text-ink-muted">
                  {timeFormatter.format(new Date(row.recordedAt))} · {row.recordedBy} · {chargeTargetLabel(row.chargeTarget)}
                  {row.stay ? ` · ${row.stay.guestName} (${row.stay.confirmationCode})` : ''}
                  {row.lossReason ? ` · ${row.lossReason}` : ''}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="font-bold tabular-nums">{formatMoney(row.totalAmount)}</span>
                {row.posting.status === 'POSTED' && can(PERMISSIONS.FOLIO_VIEW) && (
                  <Link className="text-xs font-semibold text-info-ink underline-offset-2 hover:underline" to={folioPath(row.posting.reservationId, row.posting.folioId)}>
                    Folyoyu aç
                  </Link>
                )}
                {row.posting.status === 'MANUAL' && <span className="text-xs text-warning-ink">Görevler ekranında</span>}
              </span>
            </li>
          ))}
          {list.hasNextPage && (
            <li className="px-4 py-3 text-center">
              <Button size="sm" variant="outline" icon="arrowDown" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla'}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
