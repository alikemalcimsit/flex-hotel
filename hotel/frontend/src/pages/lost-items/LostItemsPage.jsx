import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LOST_ITEM_CATEGORIES, LOST_ITEM_PAGE_SIZE, LOST_ITEM_VIEWS, LOST_ITEM_VIEW_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, EmptyState, Input, Select, Spinner } from '@hotelos/ui';
import { PageHeader } from '../../components/PageHeader.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { STATUS_TONES, categoryLabel, disposalLabel, lostItemKeys, lostItemPath, placeText, returnMethodLabel, statusLabel } from '../../lib/lost-items.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { LOST_ITEMS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { RetentionDialog } from './LostItemDialogs.jsx';
import { LostItemFormDialog } from './LostItemFormDialog.jsx';
import { LostItemThumb } from './LostItemPhotos.jsx';

const SEARCH_DEBOUNCE_MS = 300;
const OFFLINE_REFRESH_MS = 60_000;
const LIVE_MIN_INTERVAL_MS = 1500;
const foundFormatter = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const CATEGORY_FILTER = [{ value: '', label: 'Bütün kategoriler' }, ...LOST_ITEM_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))];
const VALUABLE_FILTER = Object.freeze([
  { value: '', label: 'Hepsi' },
  { value: 'true', label: 'Değerli' },
  { value: 'false', label: 'Normal' },
]);

/**
 * Kayıp eşya listesi (modül 21): sayaçlar (saklanan / teslim bekleyen / süresi
 * dolan), görünümler, etiket no / oda / açıklama / misafir araması, kategori,
 * değerli ve tarih süzgeci; sayfalı ve canlı. Kayıt `lost_items.record`,
 * saklama süreleri `lost_items.manage` ile.
 */
export function LostItemsPage() {
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState('OPEN');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [valuable, setValuable] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const { isLive } = useLiveChannel(LOST_ITEMS_CHANNEL, { queryKeys: [lostItemKeys.all], minIntervalMs: LIVE_MIN_INTERVAL_MS });
  const filters = { view, search, category, valuable, from, to, page };
  const list = useQuery({
    queryKey: lostItemKeys.list(filters),
    queryFn: () =>
      api(
        withQuery('/lost-items', {
          view,
          search: search || undefined,
          category: category || undefined,
          valuable: valuable || undefined,
          from: from || undefined,
          to: to || undefined,
          page,
          pageSize: LOST_ITEM_PAGE_SIZE,
        }),
      ),
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
    placeholderData: (previous) => previous,
  });
  const summary = useQuery({ queryKey: lostItemKeys.summary(), queryFn: () => api('/lost-items/summary'), refetchInterval: isLive ? false : OFFLINE_REFRESH_MS });
  const refresh = () => queryClient.invalidateQueries({ queryKey: lostItemKeys.all });

  const choose = (next) => {
    setView(next);
    setPage(1);
  };
  const filtered = Boolean(search || category || valuable || from || to);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kayıp eşya"
        description="Bulunan eşya fotoğrafıyla kaydedilir; sahibi o sırada odada kalanlardan bulunur, teslim ya da kargo izlenir."
        actions={
          <>
            {can(PERMISSIONS.LOST_ITEMS_MANAGE) && (
              <Button variant="outline" icon="clock" onClick={() => setDialog({ kind: 'retention' })}>Saklama süreleri</Button>
            )}
            {can(PERMISSIONS.LOST_ITEMS_RECORD) && (
              <Button icon="plus" onClick={() => setDialog({ kind: 'new' })}>Bulunan eşya kaydet</Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Saklanan" value={summary.data?.open} hint="Depoda ve teslim bekleyen" icon="package" selected={view === 'OPEN'} onClick={() => choose('OPEN')} />
        <SummaryTile label="Teslim bekleyen" value={summary.data?.matched} hint="Sahibi bulundu" icon="user" tone="warning" selected={view === 'MATCHED'} onClick={() => choose('MATCHED')} />
        <SummaryTile
          label="Süresi dolan"
          value={summary.data?.expired}
          hint={summary.data ? `${summary.data.retention.retentionDays} gün · değerli ${summary.data.retention.valuableRetentionDays} gün` : undefined}
          icon="alarm"
          tone={summary.data?.expired ? 'danger' : 'neutral'}
          selected={view === 'EXPIRED'}
          onClick={() => choose('EXPIRED')}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Görünüm">
          {LOST_ITEM_VIEWS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => choose(value)}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${view === value ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'}`}
            >
              {LOST_ITEM_VIEW_LABELS[value]}
            </button>
          ))}
          <Badge tone={isLive ? 'success' : 'warning'} className="ml-auto self-center">{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input label="Ara" placeholder="Etiket no, oda, açıklama, misafir" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="lg:col-span-2" />
          <Select label="Kategori" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} options={CATEGORY_FILTER} />
          <Select label="Değer" value={valuable} onChange={(event) => { setValuable(event.target.value); setPage(1); }} options={VALUABLE_FILTER} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Bulunma (ilk)" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
            <Input label="(son)" type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
          </div>
        </div>
      </div>

      {list.isPending ? (
        <Spinner className="py-6" />
      ) : list.isError ? (
        <Alert tone="danger" title="Liste yüklenemedi" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => list.refetch()}>Tekrar dene</Button>}>
          {list.error.message}
        </Alert>
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon="package"
          title={filtered ? 'Süzgece uyan eşya yok' : 'Bu görünümde eşya yok'}
          description={view === 'OPEN' && !filtered ? 'Bulunan eşya kaydedildikçe burada son bulunan önce görünür.' : ''}
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
            {list.data.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
          {list.data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-ink-soft">
              <span>
                {list.data.meta.total}
                {list.data.meta.totalCapped ? '+' : ''} eşya · sayfa {page} / {list.data.meta.totalPages}
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="outline" icon="chevronLeft" disabled={page <= 1} onClick={() => setPage(page - 1)}>Önceki</Button>
                <Button size="sm" variant="outline" icon="chevronRight" disabled={page >= list.data.meta.totalPages} onClick={() => setPage(page + 1)}>Sonraki</Button>
              </span>
            </div>
          )}
        </>
      )}

      {dialog?.kind === 'new' && (
        <LostItemFormDialog
          onClose={() => setDialog(null)}
          onSaved={(item) => {
            refresh();
            navigate(lostItemPath(item.id));
          }}
        />
      )}
      {dialog?.kind === 'retention' && <RetentionDialog onClose={() => setDialog(null)} onDone={refresh} />}
    </div>
  );
}

/** @param {{ item: any }} props */
function ItemRow({ item }) {
  return (
    <li>
      <Link to={lostItemPath(item.id)} className={`flex items-start gap-3 px-4 py-3 text-sm hover:bg-surface-muted ${item.expired ? 'bg-danger-soft' : ''}`}>
        <LostItemThumb itemId={item.id} photoId={item.coverPhotoId} alt={item.description} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold">{item.reference}</span>
            <Badge tone={STATUS_TONES[item.status]}>{statusLabel(item.status)}</Badge>
            {item.valuable && <Badge tone="violet">Değerli</Badge>}
            {item.expired && <Badge tone="danger">Süresi doldu</Badge>}
          </span>
          <span className="mt-0.5 block truncate font-semibold text-ink">{item.description}</span>
          <span className="block text-xs text-ink-muted">
            {categoryLabel(item.category)} · {placeText(item)} · {foundFormatter.format(new Date(item.foundAt))} · {item.storageLocation}
          </span>
          {item.guest && <span className="block text-xs font-semibold text-ink-soft">Sahibi: {item.guest.name}</span>}
          {item.returned && (
            <span className="block text-xs text-ink-soft">
              {returnMethodLabel(item.returned.method)} · {item.returned.receiverName ?? '—'}
              {item.returned.trackingNumber ? ` · ${item.returned.carrier} ${item.returned.trackingNumber}` : ''} · {formatDate(item.closedAt)}
            </span>
          )}
          {item.disposal && (
            <span className="block text-xs text-ink-soft">
              {disposalLabel(item.disposal.method)} · {formatDate(item.closedAt)}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
