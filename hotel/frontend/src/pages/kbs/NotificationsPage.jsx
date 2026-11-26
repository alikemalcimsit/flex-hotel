import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { KBS_KINDS, KBS_KIND_LABELS, KBS_STATES, KBS_STATE_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { KBS_PAGE_SIZE, kbsKeys, kbsRoomText, kbsStateTone } from '../../lib/kbs.js';
import { useDebounced } from '../../lib/pos.js';

const VIEW_OPTIONS = [
  { value: 'open', label: 'Açık olanlar' },
  { value: 'all', label: 'Hepsi' },
];
const STATE_OPTIONS = [{ value: '', label: 'Hepsi' }, ...KBS_STATES.map((value) => ({ value, label: KBS_STATE_LABELS[value] }))];
const KIND_OPTIONS = [{ value: '', label: 'Hepsi' }, ...KBS_KINDS.map((value) => ({ value, label: KBS_KIND_LABELS[value] }))];

const detailPath = (row) => `/kbs/bildirimler/${row.id}`;

const COLUMNS = [
  {
    key: 'createdAt',
    header: 'Zaman',
    className: 'whitespace-nowrap text-xs',
    render: (row) => (
      <Link to={detailPath(row)} className="font-semibold text-ink hover:underline">
        {formatDateTime(row.createdAt)}
      </Link>
    ),
  },
  { key: 'kind', header: 'Tür', className: 'whitespace-nowrap', render: (row) => KBS_KIND_LABELS[row.kind] ?? row.kind },
  {
    key: 'guest',
    header: 'Misafir',
    render: (row) => (
      <span className="block">
        <span className="block font-semibold text-ink">{row.guestName}</span>
        <span className="block text-xs text-ink-muted">{[row.documentMasked, row.nationality].filter(Boolean).join(' · ') || 'Belge yok'}</span>
      </span>
    ),
  },
  { key: 'room', header: 'Oda', className: 'whitespace-nowrap tabular-nums', render: kbsRoomText },
  {
    key: 'reservation',
    header: 'Rezervasyon',
    className: 'whitespace-nowrap',
    render: (row) =>
      row.confirmationCode ? (
        <Link to={`/rezervasyonlar/${row.reservationId}`} className="font-mono text-xs font-semibold text-ink hover:underline">
          {row.confirmationCode}
        </Link>
      ) : (
        '—'
      ),
  },
  { key: 'state', header: 'Durum', render: (row) => <Badge tone={kbsStateTone(row.state)}>{KBS_STATE_LABELS[row.state] ?? row.state}</Badge> },
  { key: 'attempts', header: 'Deneme', className: 'text-right tabular-nums', render: (row) => row.attempts },
  { key: 'lastMessage', header: 'Son mesaj', className: 'max-w-xs text-xs text-ink-soft', render: (row) => row.lastMessage ?? '—' },
];

/**
 * KBS bildirimleri (modül 58): özet (sırada, gönderilemedi, bugün bildirilen), açık olanlar / durum / tür / tarih / arama
 * süzgeçli liste. Satır ayrıntıya, rezervasyon kodu rezervasyona gider.
 */
export function NotificationsPage() {
  const [view, setView] = useState('open');
  const [state, setState] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [view, state, kind, from, to, search]);

  const filters = {
    open: view === 'open' && !state ? 'true' : undefined,
    state: state || undefined,
    kind: kind || undefined,
    from: from || undefined,
    to: to || undefined,
    search: search || undefined,
    page,
    pageSize: KBS_PAGE_SIZE,
  };
  const list = useQuery({ queryKey: kbsKeys.notifications(filters), queryFn: () => api(withQuery('/kbs/notifications', filters)), placeholderData: keepPreviousData });
  const summary = useQuery({ queryKey: kbsKeys.summary, queryFn: () => api('/kbs/summary') });
  const counts = summary.data;
  /** Özet kutusu süzgeç düğmesi: aynısına yeniden basınca kaldırır. @param {string} next */
  const pickState = (next) => setState((current) => (current === next ? '' : next));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="Sırada" value={counts?.pending} hint="Gönderilmeyi bekleyen" icon="clock" selected={state === 'PENDING'} onClick={() => pickState('PENDING')} />
        <SummaryTile label="Gönderilemedi" value={counts?.failed} hint="Düzeltip tekrar gönderin ya da elle bildirin" icon="alertTriangle" tone={counts?.failed ? 'danger' : 'neutral'} selected={state === 'FAILED'} onClick={() => pickState('FAILED')} />
        <SummaryTile label="Bugün bildirilen" value={counts?.sentToday} hint="Gönderilen ve elle bildirilen" icon="checkCircle" />
      </div>
      <Toolbar>
        <Select label="Görünüm" name="kbs-view" options={VIEW_OPTIONS} value={view} onChange={(event) => setView(event.target.value)} disabled={Boolean(state)} className="w-full sm:w-40" />
        <Select label="Durum" name="kbs-state" options={STATE_OPTIONS} value={state} onChange={(event) => setState(event.target.value)} className="w-full sm:w-44" />
        <Select label="Tür" name="kbs-kind" options={KIND_OPTIONS} value={kind} onChange={(event) => setKind(event.target.value)} className="w-full sm:w-40" />
        <Input label="Başlangıç" name="kbs-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="w-full sm:w-40" />
        <Input label="Bitiş" name="kbs-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-40" />
        <Input label="Ara" name="kbs-search" placeholder="Ad, oda, rezervasyon kodu" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-56" />
      </Toolbar>
      <DataTable
        columns={COLUMNS}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={view === 'open' && !state ? 'Açık bildirim yok' : 'Bildirim yok'}
        emptyHint={view === 'open' && !state ? 'Sırada ya da gönderilemeyen bildirim kalmadı.' : 'Süzgeçlere uyan bildirim bulunamadı.'}
        rowActions={(row) => (
          <Link to={detailPath(row)} className="inline-flex items-center gap-1.5 rounded-item px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.04] hover:text-ink">
            Ayrıntı
          </Link>
        )}
      />
    </div>
  );
}
