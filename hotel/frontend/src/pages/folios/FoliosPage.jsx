import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FOLIO_LIST_VIEWS, FOLIO_LIST_VIEW_LABELS, RESERVATION_COUNT_CAP } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { FOLIO_STATUS_TONES, balanceTone, folioKeys, folioPath, folioStatusLabel } from '../../lib/folios.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { FOLIOS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { toastError, toastSuccess } from '../../store/toast.js';

const PAGE_SIZE = 25;
const OFFLINE_REFRESH_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 300;

const PARAMS = Object.freeze({ view: 'gorunum', search: 'q', page: 'sayfa' });

const EMPTY_TITLES = Object.freeze({
  IN_HOUSE: 'İçeride misafir yok ya da folyoları henüz açılmadı',
  OPEN_BALANCE: 'Bakiyesi açık kalan konaklama yok',
  OPEN: 'Açık folyo yok',
  CLOSED: 'Kapanmış folyo yok',
});

/** @param {URLSearchParams} params */
function readFilters(params) {
  const view = params.get(PARAMS.view);
  const page = Number(params.get(PARAMS.page));
  return {
    view: FOLIO_LIST_VIEWS.includes(view) ? view : 'IN_HOUSE',
    search: params.get(PARAMS.search) ?? '',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/**
 * Folyolar (modül 15): konaklamaların hesabı.
 *
 * - Görünümler: içeridekiler (oda sırasıyla), açık bakiye (çıkmış / iptal /
 *   gelmedi ama hesabı kapanmamış — tahsil ya da iade edilecekler), bütün
 *   açıklar, kapananlar.
 * - Arama: misafir adı, onay kodu, oda numarası, ödeyen (şirket) adı.
 * - Üstteki şerit gece oda ücretlerinin durumunu söyler; aktör kapalıyken ya da
 *   gece çalışması beklenmeden personel "Oda ücretlerini işle" der (tekrar
 *   basmak güvenli: işlenmiş gece yeniden işlenmez).
 */
export function FoliosPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);

  const updateParams = useCallback(
    (changes, { resetPage = true, replace = false } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === undefined || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage) next.delete(PARAMS.page);
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  const [searchText, setSearchText] = useState(filters.search);
  useEffect(() => setSearchText(filters.search), [filters.search]);
  useEffect(() => {
    if (searchText === filters.search) return undefined;
    const timer = setTimeout(() => updateParams({ [PARAMS.search]: searchText.trim() }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText, filters.search, updateParams]);

  const { isLive } = useLiveChannel(FOLIOS_CHANNEL, { queryKeys: [folioKeys.lists, folioKeys.roomCharges] });

  const query = useQuery({
    queryKey: folioKeys.list(filters),
    queryFn: () =>
      api(withQuery('/folios', { view: filters.view, search: filters.search || undefined, page: filters.page, pageSize: PAGE_SIZE })),
    placeholderData: keepPreviousData,
    refetchInterval: isLive ? false : OFFLINE_REFRESH_MS,
  });
  const meta = query.data?.meta;

  const columns = [
    {
      key: 'room',
      header: 'Oda',
      render: (row) => <span className="font-bold tabular-nums">{row.stay.room?.number ?? '—'}</span>,
    },
    {
      key: 'guest',
      header: 'Misafir',
      render: (row) => (
        <span className="flex flex-col">
          <Link to={folioPath(row.stay.id, row.id)} className="font-semibold text-info-ink underline-offset-2 hover:underline">
            {row.stay.guest.name}
          </Link>
          <span className="font-mono text-xs text-ink-muted">{row.stay.confirmationCode}</span>
        </span>
      ),
    },
    {
      key: 'folio',
      header: 'Folyo',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="whitespace-nowrap">{row.name}</span>
          <Badge tone={FOLIO_STATUS_TONES[row.status]}>{folioStatusLabel(row.status)}</Badge>
        </span>
      ),
    },
    {
      key: 'stay',
      header: 'Konaklama',
      render: (row) => (
        <span className="whitespace-nowrap text-xs">
          {formatDate(row.stay.checkIn)} – {formatDate(row.stay.checkOut)}
        </span>
      ),
    },
    {
      key: 'charges',
      header: 'Harcama',
      className: 'text-right',
      render: (row) => <span className="whitespace-nowrap tabular-nums">{formatMoney(row.chargesTotal, row.currency)}</span>,
    },
    {
      key: 'paid',
      header: 'Ödenen',
      className: 'text-right',
      render: (row) => <span className="whitespace-nowrap tabular-nums">{formatMoney(row.paymentsTotal, row.currency)}</span>,
    },
    {
      key: 'balance',
      header: 'Bakiye',
      className: 'text-right',
      render: (row) => (
        <Badge tone={balanceTone(row.balance)}>
          <span className="tabular-nums">{formatMoney(row.balance, row.currency)}</span>
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Folyolar"
        description="Konaklamaların hesabı: oda ücretleri, harcamalar, ödemeler. Harcama işleyin, folyoyu bölün ya da birleştirin; kalem iptali ikinci bir yetkilinin onayına gider."
      />
      <RoomChargeStrip />

      <div className="flex flex-wrap items-end gap-3 rounded-card bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Görünüm">
          {FOLIO_LIST_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={filters.view === view}
              onClick={() => updateParams({ [PARAMS.view]: view === 'IN_HOUSE' ? null : view })}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                filters.view === view ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink'
              }`}
            >
              {FOLIO_LIST_VIEW_LABELS[view]}
            </button>
          ))}
        </div>
        <Input
          label="Ara"
          name="q"
          type="search"
          placeholder="Misafir, onay kodu, oda no, şirket…"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          className="w-full sm:ml-auto sm:w-72"
        />
        <span className="self-center">
          <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? 'Canlı' : 'Canlı değil'}</Badge>
        </span>
      </div>

      {meta?.totalCapped && (
        <p className="text-xs text-ink-muted">
          {RESERVATION_COUNT_CAP}'den fazla folyo var; yalnızca ilk {RESERVATION_COUNT_CAP} sayıldı. Eskilere arama ile ulaşın.
        </p>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        meta={meta}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        onPageChange={(page) => updateParams({ [PARAMS.page]: page }, { resetPage: false })}
        emptyTitle={filters.search ? 'Aramaya uyan folyo yok' : EMPTY_TITLES[filters.view]}
        emptyHint={
          filters.search
            ? 'Başka bir ad, oda numarası ya da onay kodu deneyin.'
            : filters.view === 'IN_HOUSE'
              ? 'Folyo misafir giriş yapınca açılır; oda ücretleri her gece işlenir.'
              : undefined
        }
      />
    </div>
  );
}

/**
 * Gece oda ücretleri: son işlenen gece ve eksik kalan geceler. Eksik varsa
 * (aktör kapalı, sunucu gece kapalıydı) yetkili tek düğmeyle işler.
 */
function RoomChargeStrip() {
  const can = useCan();
  const canPost = can(PERMISSIONS.FOLIO_POST);
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: folioKeys.roomCharges, queryFn: () => api('/folios/room-charges') });
  const run = useMutation({
    mutationFn: () => apiPost('/folios/room-charges/run', {}),
    onSuccess: (summary) => {
      toastSuccess(
        summary.items
          ? `${formatDate(summary.night)} gecesine kadar ${summary.items} oda ücreti kalemi işlendi (${formatMoney(summary.total)})`
          : 'İşlenecek oda ücreti yoktu; bütün geceler işlenmiş',
      );
      queryClient.invalidateQueries({ queryKey: folioKeys.all });
    },
    onError: (error) => toastError(error.message),
  });

  if (status.isPending) return null;
  if (status.isError) {
    return (
      <Alert tone="warning" title="Oda ücreti durumu okunamadı" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => status.refetch()}>Tekrar dene</Button>}>
        {status.error.message}
      </Alert>
    );
  }

  const { lastRun, dueNight, missingStays, missingNights, currency } = status.data;
  const runButton = canPost && (
    <Button size="sm" icon="refresh" onClick={() => run.mutate()} disabled={run.isPending}>
      {run.isPending ? 'İşleniyor…' : 'Oda ücretlerini işle'}
    </Button>
  );

  if (missingNights > 0) {
    return (
      <Alert tone="warning" title={`${missingStays} konaklamanın ${missingNights} gecesi folyoya işlenmedi`} action={runButton}>
        {formatDate(dueNight)} gecesine kadar olan oda ücretleri eksik. Folyo aktörü kapalıysa ya da sunucu gece çalışmadıysa buradan işleyin;
        işlenmiş gece yeniden işlenmez.
      </Alert>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-muted px-5 py-3 text-sm">
      <Badge tone="success">Oda ücretleri güncel</Badge>
      <span className="text-ink-soft">
        {!lastRun
          ? 'Henüz gece çalışması yapılmadı.'
          : lastRun.items
            ? `Son çalışma: ${formatDate(lastRun.night)} gecesi · ${lastRun.stays} konaklamaya ${lastRun.items} kalem · ${formatMoney(lastRun.total, currency)}`
            : `Son çalışma: ${formatDate(lastRun.night)} gecesi · işlenecek yeni gece yoktu (hepsi işlenmişti)`}
      </span>
    </div>
  );
}
