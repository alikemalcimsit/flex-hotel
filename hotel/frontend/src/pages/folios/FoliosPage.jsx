import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FOLIO_LIST_VIEWS, FOLIO_LIST_VIEW_LABELS, RESERVATION_COUNT_CAP } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader } from '../../components/PageHeader.jsx';
import { useT } from '../../i18n/index.jsx';
import { api, apiPost, withQuery } from '../../lib/api.js';
import { FOLIO_STATUS_TONES, balanceTone, folioKeys, folioPath } from '../../lib/folios.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { FOLIOS_CHANNEL } from '../../lib/socket.js';
import { useLiveChannel } from '../../lib/useLiveChannel.js';
import { toastError, toastSuccess } from '../../store/toast.js';
import { folioStatusText } from './labels.js';

/** Canlı tazeleme seyreltme aralığı (liste otelin her folyo haberinde değişir). */
const LIVE_MIN_INTERVAL_MS = 2000;
const PAGE_SIZE = 25;
const OFFLINE_REFRESH_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 300;

const PARAMS = Object.freeze({ view: 'gorunum', search: 'q', page: 'sayfa' });

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
  const t = useT();
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

  // Liste otelin her kalem / ödeme haberinde değişir; yoğun saatte panel başına seyreltilir.
  const { isLive } = useLiveChannel(FOLIOS_CHANNEL, { queryKeys: [folioKeys.lists, folioKeys.roomCharges], minIntervalMs: LIVE_MIN_INTERVAL_MS });

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
      header: t('folio.list.room'),
      render: (row) => <span className="font-bold tabular-nums">{row.stay.room?.number ?? '—'}</span>,
    },
    {
      key: 'guest',
      header: t('folio.list.guest'),
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
      header: t('folio.list.folio'),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="whitespace-nowrap">{row.name}</span>
          <Badge tone={FOLIO_STATUS_TONES[row.status]}>{folioStatusText(row.status)}</Badge>
        </span>
      ),
    },
    {
      key: 'stay',
      header: t('folio.list.stay'),
      render: (row) => (
        <span className="whitespace-nowrap text-xs">
          {formatDate(row.stay.checkIn)} – {formatDate(row.stay.checkOut)}
        </span>
      ),
    },
    {
      key: 'charges',
      header: t('folio.list.charges'),
      className: 'text-right',
      render: (row) => <span className="whitespace-nowrap tabular-nums">{formatMoney(row.chargesTotal, row.currency)}</span>,
    },
    {
      key: 'paid',
      header: t('folio.list.paid'),
      className: 'text-right',
      render: (row) => <span className="whitespace-nowrap tabular-nums">{formatMoney(row.paymentsTotal, row.currency)}</span>,
    },
    {
      key: 'balance',
      header: t('folio.list.balance'),
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
        title={t('folio.list.title')}
        description={t('folio.list.description')}
      />
      <RoomChargeStrip />

      <div className="flex flex-wrap items-end gap-3 rounded-card bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('folio.list.view')}>
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
              {t(`folio.listView.${view}`, FOLIO_LIST_VIEW_LABELS[view])}
            </button>
          ))}
        </div>
        <Input
          label={t('folio.list.search')}
          name="q"
          type="search"
          placeholder={t('folio.list.searchPlaceholder')}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          className="w-full sm:ml-auto sm:w-72"
        />
        <span className="self-center">
          <Badge tone={isLive ? 'success' : 'warning'}>{isLive ? t('common.live') : t('common.notLive')}</Badge>
        </span>
      </div>

      {meta?.totalCapped && (
        <p className="text-xs text-ink-muted">
          {t('folio.list.capped', { cap: RESERVATION_COUNT_CAP })}
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
        emptyTitle={filters.search ? t('folio.list.emptySearch') : t(`folio.list.empty.${filters.view}`)}
        emptyHint={
          filters.search
            ? t('folio.list.emptySearchHint')
            : filters.view === 'IN_HOUSE'
              ? t('folio.list.emptyInHouseHint')
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
  const t = useT();
  const can = useCan();
  const canPost = can(PERMISSIONS.FOLIO_POST);
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: folioKeys.roomCharges, queryFn: () => api('/folios/room-charges') });
  const run = useMutation({
    mutationFn: () => apiPost('/folios/room-charges/run', {}),
    onSuccess: (summary) => {
      toastSuccess(
        summary.items
          ? t('folio.roomCharges.posted', { date: formatDate(summary.night), count: summary.items, amount: formatMoney(summary.total) })
          : t('folio.roomCharges.nothingToPost'),
      );
      queryClient.invalidateQueries({ queryKey: folioKeys.all });
    },
    onError: (error) => toastError(error.message),
  });

  if (status.isPending) return null;
  if (status.isError) {
    return (
      <Alert tone="warning" title={t('folio.roomCharges.loadFailed')} action={<Button size="sm" variant="outline" icon="refresh" onClick={() => status.refetch()}>{t('common.retry')}</Button>}>
        {status.error.message}
      </Alert>
    );
  }

  const { lastRun, dueNight, missingStays, missingNights, currency } = status.data;
  const runButton = canPost && (
    <Button size="sm" icon="refresh" onClick={() => run.mutate()} disabled={run.isPending}>
      {run.isPending ? t('folio.stay.posting') : t('folio.roomCharges.run')}
    </Button>
  );

  if (missingNights > 0) {
    return (
      <Alert tone="warning" title={t('folio.roomCharges.missingTitle', { stays: missingStays, nights: missingNights })} action={runButton}>
        {t('folio.roomCharges.missingBody', { date: formatDate(dueNight) })}
      </Alert>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface-muted px-5 py-3 text-sm">
      <Badge tone="success">{t('folio.roomCharges.upToDate')}</Badge>
      <span className="text-ink-soft">
        {!lastRun
          ? t('folio.roomCharges.neverRun')
          : lastRun.items
            ? t('folio.roomCharges.lastRun', { date: formatDate(lastRun.night), stays: lastRun.stays, count: lastRun.items, amount: formatMoney(lastRun.total, currency) })
            : t('folio.roomCharges.lastRunEmpty', { date: formatDate(lastRun.night) })}
      </span>
    </div>
  );
}
