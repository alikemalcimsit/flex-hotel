import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { api } from '../../lib/api.js';
import { chainKeys, switchHotel, withHotelRowIds } from '../../lib/chain.js';
import { formatMoney } from '../../lib/format.js';
import { formatPct } from '../../lib/reports.js';
import { useAuthStore } from '../../store/auth.js';
import { toastError, toastSuccess } from '../../store/toast.js';

/** Pano iki dakikada bir tazelenir (her otel kendi önbelleğiyle hesaplanır; sunucuya yük öngörülebilir). */
const DASHBOARD_REFRESH_MS = 120_000;

/**
 * Zincir panosu: bugünün durumu otel otel — bu geceki doluluk, gelecek / gidecek / konaklayan, bu gecenin net oda
 * geliri, ADR, RevPAR. Para birimine göre toplam. Bir otelin ayrıntısı için o otele geçilir.
 */
export function ChainDashboardTab() {
  const navigate = useNavigate();
  const currentHotelId = useAuthStore((state) => state.hotel?.id);
  const [switching, setSwitching] = useState(null);
  const dashboard = useQuery({ queryKey: chainKeys.dashboard(), queryFn: () => api('/chain/dashboard'), select: withHotelRowIds, refetchInterval: DASHBOARD_REFRESH_MS });

  async function openHotel(row) {
    setSwitching(row.hotelId);
    try {
      await switchHotel(row.hotelId);
      navigate('/');
      toastSuccess(`${row.name} oteline geçildi`);
    } catch (error) {
      toastError(error.message);
    } finally {
      setSwitching(null);
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Otel',
      render: (row) => (
        <div className="min-w-0 max-w-[16rem]">
          <span className="block truncate font-semibold text-ink">{row.name}</span>
          <span className="block truncate text-xs text-ink-muted">{row.code} · {ROLE_LABELS[row.role] ?? row.role}</span>
        </div>
      ),
    },
    // Başlıklar kısa ("bu gece" sayfanın altında yazılı): sütunlar dizüstü ekranda da sığsın.
    {
      key: 'occupancy',
      header: 'Doluluk',
      className: 'whitespace-nowrap text-right tabular-nums',
      render: (row) => (row.error ? '—' : (
        <span>
          <span className={occupancyTone(row)}>{formatPct(row.occupancyPct)}</span>
          <span className="block text-xs text-ink-muted">{row.sold} / {row.sellable} oda</span>
        </span>
      )),
    },
    { key: 'arrivals', header: 'Gelecek', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => (row.error ? '—' : <>{row.arrivals}{row.arrivalsLate > 0 && <span className="block text-xs text-warning-ink">{row.arrivalsLate} gecikmiş</span>}</>) },
    { key: 'departures', header: 'Gidecek', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => (row.error ? '—' : <>{row.departures}{row.departuresOverdue > 0 && <span className="block text-xs text-warning-ink">{row.departuresOverdue} gecikmiş</span>}</>) },
    { key: 'inHouse', header: 'Konaklayan', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => (row.error ? '—' : row.inHouse) },
    { key: 'revenue', header: 'Oda geliri', className: 'whitespace-nowrap text-right tabular-nums', render: (row) => (row.error ? '—' : formatMoney(row.revenue, row.currency)) },
    {
      key: 'adr',
      header: 'ADR · RevPAR',
      className: 'whitespace-nowrap text-right tabular-nums',
      render: (row) => (row.error ? '—' : (
        <span>
          {formatMoney(row.adr, row.currency)}
          <span className="block text-xs text-ink-muted">RevPAR {formatMoney(row.revpar, row.currency)}</span>
        </span>
      )),
    },
    {
      key: 'state',
      header: '',
      render: (row) =>
        row.error ? (
          <Badge tone="danger">{row.error}</Badge>
        ) : row.hotelId === currentHotelId ? (
          <Badge tone="info">Açık otel</Badge>
        ) : (
          <Button size="sm" variant="outline" icon="arrowRight" onClick={() => openHotel(row)} disabled={Boolean(switching)}>
            {switching === row.hotelId ? 'Geçiliyor…' : 'Otele geç'}
          </Button>
        ),
    },
  ];

  const data = dashboard.data;
  return (
    <div className="flex flex-col gap-4">
      {data && data.totals.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.totals.map((total) => (
            <Card key={total.currency}>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{total.hotels} otel · {total.currency}</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-ink">{formatPct(total.occupancyPct)}</p>
              <p className="text-sm text-ink-soft">bu gece doluluk · {total.sold} / {total.sellable} oda</p>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <Figure label="Gelecek" value={total.arrivals} />
                <Figure label="Gidecek" value={total.departures} />
                <Figure label="Konaklayan" value={total.inHouse} />
                <Figure label="Oda geliri" value={formatMoney(total.revenue, total.currency)} />
                <Figure label="ADR" value={formatMoney(total.adr, total.currency)} />
                <Figure label="RevPAR" value={formatMoney(total.revpar, total.currency)} />
              </dl>
            </Card>
          ))}
        </div>
      )}
      {data?.hiddenHotels > 0 && (
        <Alert tone="info">Zincirdeki {data.hiddenHotels} otel, orada zinciri görme yetkiniz olmadığı için gösterilmiyor.</Alert>
      )}
      {data?.failedHotels > 0 && (
        <Alert tone="warning" action={<Button size="sm" variant="outline" icon="refresh" onClick={() => dashboard.refetch()}>Tekrar dene</Button>}>
          {data.failedHotels} otelin rakamları şu an hesaplanamadı; toplamlara katılmadı.
        </Alert>
      )}
      <DataTable
        columns={columns}
        rows={data?.hotels}
        isLoading={dashboard.isPending}
        isFetching={dashboard.isFetching}
        error={dashboard.isError ? dashboard.error : null}
        onRetry={() => dashboard.refetch()}
        emptyTitle="Gösterilecek otel yok"
        emptyHint="Zincirdeki otellerin hiçbirinde zinciri görme yetkiniz yok."
      />
      {data && <p className="text-xs text-ink-muted">Gelir vergiler hariç, bu gecenin kesin ve opsiyonlu rezervasyonlarından. Her otel kendi iş gününde. İki dakikada bir tazelenir.</p>}
    </div>
  );
}

/** Eşik dışı doluluk renklenir (otelin tahmin eşikleri, modül 25). */
function occupancyTone(row) {
  if (row.occupancyPct === null || !row.thresholds) return 'font-semibold text-ink';
  if (row.occupancyPct < row.thresholds.lowPct) return 'font-semibold text-danger-ink';
  if (row.occupancyPct > row.thresholds.highPct) return 'font-semibold text-success-ink';
  return 'font-semibold text-ink';
}

/** @param {{ label: string, value: React.ReactNode }} props */
function Figure({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
