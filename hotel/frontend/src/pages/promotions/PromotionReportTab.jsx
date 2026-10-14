import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Spinner } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { addDaysIso } from '../../lib/reservations.js';
import { promotionKeys, usePromotionLive } from '../../lib/promotions.js';
import { useHotelToday } from '../../lib/useHotel.js';
import { Figure, ReportPeriod, periodIssue } from './ReportPeriod.jsx';

const PAGE_SIZE = 20;
/** Varsayılan dönem: son 30 gün. */
const DEFAULT_DAYS = 30;

/**
 * Promosyon kullanım raporu (modül 31): dönemde (satış ya da giriş gününe
 * göre) promosyon başına geçerli rezervasyon, iptal / gelmedi, gece, liste
 * tutarı, verilen indirim, net tutar ve kullanılan kupon; en çok indirim
 * verenden. Dönemin toplamı üstte.
 */
export function PromotionReportTab() {
  const { today } = useHotelToday();
  const [period, setPeriod] = useState(() => ({ from: addDaysIso(today, -(DEFAULT_DAYS - 1)), to: today, basis: 'BOOKED' }));
  const [page, setPage] = useState(1);
  usePromotionLive({ withUsage: true });

  const valid = !periodIssue(period);
  const report = useQuery({
    queryKey: promotionKeys.report({ ...period, page }),
    queryFn: () => api(withQuery('/promotions/report', { ...period, page, pageSize: PAGE_SIZE })),
    enabled: valid,
    placeholderData: keepPreviousData,
  });
  const data = report.data;
  const money = (value) => formatMoney(value, data?.currency ?? '');

  const columns = [
    {
      key: 'promotion',
      header: 'Promosyon',
      render: (row) =>
        row.promotion ? (
          <Link to={`/promosyonlar/${row.promotion.id}/kullanim`} className="block min-w-0">
            <span className="block truncate font-semibold text-ink hover:underline">{row.promotion.name}</span>
            <span className="block text-xs text-ink-muted">
              {row.promotion.label} · {row.promotion.requiresCoupon ? 'kuponla' : 'kendiliğinden'}
            </span>
          </Link>
        ) : (
          <span className="text-ink-muted">Silinmiş promosyon</span>
        ),
    },
    { key: 'reservations', header: 'Rezervasyon', className: 'text-right tabular-nums', render: (row) => row.reservations },
    { key: 'cancelled', header: 'İptal / gelmedi', className: 'text-right tabular-nums text-ink-muted', render: (row) => row.cancelled },
    { key: 'nights', header: 'Gece', className: 'text-right tabular-nums', render: (row) => row.nights },
    { key: 'listTotal', header: 'Liste tutarı', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => money(row.listTotal) },
    { key: 'discountTotal', header: 'İndirim', className: 'whitespace-nowrap text-right tabular-nums font-semibold text-success-ink', render: (row) => `−${money(row.discountTotal)}` },
    { key: 'netTotal', header: 'Net', className: 'whitespace-nowrap text-right tabular-nums font-semibold', render: (row) => money(row.netTotal) },
    { key: 'coupons', header: 'Kupon', className: 'text-right tabular-nums', render: (row) => (row.promotion?.requiresCoupon ? row.coupons : '—') },
  ];

  return (
    <div className="flex flex-col gap-5">
      <ReportPeriod
        idPrefix="promotion-report"
        period={period}
        onChange={(next) => {
          setPeriod(next);
          setPage(1);
        }}
      />
      {valid && report.isPending && <Spinner className="py-6" />}
      {report.isError && (
        <Alert tone="danger" title="Rapor yüklenemedi" action={<Button variant="outline" size="sm" icon="refresh" onClick={() => report.refetch()}>Tekrar dene</Button>}>
          {report.error.message}
        </Alert>
      )}
      {data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Figure label="Promosyonlu rezervasyon" value={String(data.totals.reservations)} hint={`${data.totals.nights} gece · ${data.totals.cancelled} iptal / gelmedi`} />
          <Figure label="Liste tutarı" value={money(data.totals.listTotal)} />
          <Figure label="Verilen indirim" value={`−${money(data.totals.discountTotal)}`} hint={Number(data.totals.listTotal) > 0 ? `Liste tutarının %${((Number(data.totals.discountTotal) / Number(data.totals.listTotal)) * 100).toFixed(1).replace('.', ',')}'i` : undefined} />
          <Figure label="Net tutar" value={money(data.totals.netTotal)} hint={data.totals.coupons ? `${data.totals.coupons} kupon kullanıldı` : undefined} />
        </div>
      )}
      {data && report.isFetching && <Badge tone="neutral" className="w-fit">Güncelleniyor…</Badge>}
      <DataTable
        columns={columns}
        rows={valid ? data?.items : []}
        meta={valid ? data?.meta : undefined}
        isLoading={valid && report.isPending}
        isFetching={report.isFetching}
        error={report.isError ? report.error : null}
        onRetry={() => report.refetch()}
        onPageChange={setPage}
        emptyTitle="Bu dönemde promosyonlu rezervasyon yok"
        emptyHint="Dönemi genişletin ya da esası değiştirin (satış / giriş günü)."
      />
    </div>
  );
}
