import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MAX_PROMOTION_REPORT_DAYS, RESERVATION_STATUS_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Input, Select, Spinner } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatDate, formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { promotionKeys } from '../../lib/promotions.js';
import { RESERVATION_STATUS_TONES, addDaysIso } from '../../lib/reservations.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { usePromotionOutlet } from './PromotionPage.jsx';
import { Figure, ReportPeriod, periodIssue } from './ReportPeriod.jsx';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
/**
 * Varsayılan dönemin başı: satış dönemi başlangıcı ya da promosyonun açıldığı gün
 * (hangisi önceyse; satış, kayıttan önceki bir günden başlayacak şekilde tanımlanabilir),
 * en fazla rapor sınırı kadar geriye.
 * @param {{ createdAt: string, bookFrom: string | null }} promotion
 * @param {string} today
 */
function defaultFrom(promotion, today) {
  const created = promotion.createdAt.slice(0, 10);
  const start = promotion.bookFrom && promotion.bookFrom < created ? promotion.bookFrom : created;
  const earliest = addDaysIso(today, -(MAX_PROMOTION_REPORT_DAYS - 1));
  return start > today ? today : start < earliest ? earliest : start;
}

const STATUS_OPTIONS = [{ value: '', label: 'Bütün durumlar' }, ...Object.entries(RESERVATION_STATUS_LABELS).filter(([value]) => value !== 'WAITLISTED').map(([value, label]) => ({ value, label }))];

/**
 * Bir promosyonun kullanımı (modül 31): dönemin özeti (geçerli rezervasyon,
 * indirim, net) ve rezervasyonları — kod, misafir, konaklama, kupon, liste
 * tutarı, indirim. Varsayılan dönem: satış dönemi başlangıcından (ya da açıldığı
 * günden) bugüne, satış gününe göre. Rezervasyon bağlantısı yalnızca rezervasyon görme izni olana.
 */
export function PromotionUsageTab() {
  const { promotion } = usePromotionOutlet();
  const can = useCan();
  const { today } = useHotelToday();
  const [period, setPeriod] = useState(() => ({ from: defaultFrom(promotion, today), to: today, basis: 'BOOKED' }));
  const [status, setStatus] = useState('');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const valid = !periodIssue(period);
  const summary = useQuery({
    queryKey: promotionKeys.report({ ...period, promotionId: promotion.id }),
    queryFn: () => api(withQuery('/promotions/report', { ...period, promotionId: promotion.id, page: 1, pageSize: 1 })),
    enabled: valid,
    placeholderData: keepPreviousData,
  });
  const filters = { ...period, status, search, page };
  const list = useQuery({
    queryKey: promotionKeys.reservations(promotion.id, filters),
    queryFn: () =>
      api(
        withQuery(`/promotions/${promotion.id}/reservations`, {
          ...period,
          status: status || undefined,
          search: search || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
      ),
    enabled: valid,
    placeholderData: keepPreviousData,
  });

  const totals = summary.data?.totals;
  const currency = summary.data?.currency ?? list.data?.meta?.currency ?? '';
  const money = (value) => formatMoney(value, currency);
  const canOpenReservation = can(PERMISSIONS.RESERVATIONS_VIEW);

  const columns = [
    {
      key: 'code',
      header: 'Rezervasyon',
      render: (row) =>
        canOpenReservation ? (
          <Link to={`/rezervasyonlar/${row.id}`} className="font-mono text-xs font-bold text-ink hover:underline">{row.confirmationCode}</Link>
        ) : (
          <span className="font-mono text-xs font-bold">{row.confirmationCode}</span>
        ),
    },
    { key: 'guestName', header: 'Misafir', render: (row) => <span className="font-semibold">{row.guestName ?? '—'}</span> },
    {
      key: 'stay',
      header: 'Konaklama',
      className: 'whitespace-nowrap',
      render: (row) => (
        <span className="block text-xs">
          <span className="block font-semibold text-ink">{formatDate(row.checkIn)} – {formatDate(row.checkOut)}</span>
          <span className="block text-ink-muted">{row.roomType.name} · satış {formatDate(row.createdAt)}</span>
        </span>
      ),
    },
    { key: 'coupon', header: 'Kupon', render: (row) => (row.coupon ? <span className="font-mono text-xs">{row.coupon.code}</span> : <span className="text-ink-muted">—</span>) },
    { key: 'listTotal', header: 'Liste', className: 'whitespace-nowrap text-right tabular-nums text-ink-muted', render: (row) => money(row.listTotal) },
    { key: 'discountTotal', header: 'İndirim', className: 'whitespace-nowrap text-right tabular-nums text-success-ink', render: (row) => `−${money(row.discountTotal)}` },
    { key: 'totalPrice', header: 'Tutar', className: 'whitespace-nowrap text-right tabular-nums font-semibold', render: (row) => money(row.totalPrice) },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={RESERVATION_STATUS_TONES[row.status]}>{RESERVATION_STATUS_LABELS[row.status]}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <ReportPeriod idPrefix="promotion-usage" period={period} onChange={(next) => { setPeriod(next); setPage(1); }} />
      {valid && summary.isPending && <Spinner className="py-4" />}
      {summary.isError && (
        <Alert tone="danger" title="Özet yüklenemedi" action={<Button variant="outline" size="sm" icon="refresh" onClick={() => summary.refetch()}>Tekrar dene</Button>}>
          {summary.error.message}
        </Alert>
      )}
      {totals && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Figure label="Rezervasyon" value={String(totals.reservations)} hint={`${totals.nights} gece · ${totals.cancelled} iptal / gelmedi`} />
          <Figure label="Liste tutarı" value={money(totals.listTotal)} />
          <Figure label="Verilen indirim" value={`−${money(totals.discountTotal)}`} />
          <Figure label="Net tutar" value={money(totals.netTotal)} hint={promotion.requiresCoupon ? `${totals.coupons} farklı kupon` : undefined} />
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <Input label="Ara" name="promotion-usage-search" placeholder="Onay kodu, misafir adı ya da telefon" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
        <Select label="Durum" name="promotion-usage-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} options={STATUS_OPTIONS} />
      </div>
      <DataTable
        columns={columns}
        rows={valid ? list.data?.items : []}
        meta={valid ? list.data?.meta : undefined}
        isLoading={valid && list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search || status ? 'Süzgece uyan rezervasyon yok' : 'Bu dönemde bu promosyonla rezervasyon yok'}
      />
    </div>
  );
}
