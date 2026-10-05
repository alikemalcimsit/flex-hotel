import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FORECAST_ALERT_LABELS,
  FORECAST_DAYS,
  FORECAST_THRESHOLD_MAX_PCT,
  FORECAST_THRESHOLD_MIN_GAP_PCT,
  FORECAST_THRESHOLD_MIN_PCT,
  forecastSettingsSchema,
} from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, EmptyState, Input, Spinner } from '@hotelos/ui';
import { Modal } from '../../components/Modal.jsx';
import { apiPut } from '../../lib/api.js';
import { dashboardKeys, longDay } from '../../lib/dashboard.js';
import { ALERT_HINTS, ALERT_STYLE, forecastKeys, signedNights, useForecast } from '../../lib/forecast.js';
import { formatMoney } from '../../lib/format.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { formatChange, formatPct } from '../../lib/reports.js';
import { validateWith } from '../../lib/validate.js';
import { toastSuccess } from '../../store/toast.js';
import { QueryError } from '../activity/shared.jsx';
import { ForecastChart, ForecastTable } from './ForecastChart.jsx';

/**
 * Önümüzdeki 30 gün (modül 25): doluluk tahmini grafiği (eldeki + tahmin),
 * gelir tahmini, kritik günler. Günlük durum ekranının bir bölümü; kendi
 * sorgusuyla yüklenir (bugünün kartlarını bekletmez), günlük durumun canlı
 * kanalıyla tazelenir. Tanımlar `contracts/forecast.js`.
 */
export function ForecastSection() {
  const can = useCan();
  const query = useForecast({ enabled: true });
  const [showTable, setShowTable] = useState(false);
  const [editing, setEditing] = useState(false);
  const data = query.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card
          title={`Önümüzdeki ${data?.days ?? FORECAST_DAYS} gün`}
          description="Doluluk: eldeki rezervasyon (gerçek) ve tahmin. Tahmin = eldeki + geçen yılın aynı günlerinde aynı gün kala gelen net satış (yoksa son haftalar)."
          actions={
            <>
              {can(PERMISSIONS.FORECAST_MANAGE) && (
                <Button variant="ghost" size="sm" icon="settings" onClick={() => setEditing(true)}>
                  Eşikler
                </Button>
              )}
              <Button variant="outline" size="sm" icon={showTable ? 'chart' : 'list'} onClick={() => setShowTable((value) => !value)} aria-pressed={showTable}>
                {showTable ? 'Grafik' : 'Tablo'}
              </Button>
            </>
          }
        >
          {query.isPending && <Spinner label="Tahmin hesaplanıyor…" className="py-12" />}
          {query.isError && <QueryError query={query} title="Tahmin yüklenemedi" />}
          {data && (
            <div className={`flex flex-col gap-3 transition-opacity duration-200 ${query.isFetching && !query.isPending ? 'opacity-60' : ''}`}>
              <BasisNote forecast={data} />
              {data.otherCurrencyNights > 0 && (
                <Alert tone="warning" title={`${data.otherCurrencyNights} gece başka para biriminde`}>
                  Otelin para birimi ({data.currency}) dışındaki rezervasyonlar tahmine karıştırılmadı.
                </Alert>
              )}
              {showTable ? <ForecastTable forecast={data} /> : <ForecastChart forecast={data} />}
            </div>
          )}
        </Card>
        <div className="flex flex-col gap-5">
          <RevenueForecast query={query} />
          <CriticalDays query={query} canOpenPlan={can(PERMISSIONS.ROOMS_VIEW)} />
        </div>
      </div>
      {editing && data && <ThresholdDialog initial={data.settings} onClose={() => setEditing(false)} />}
    </div>
  );
}

/**
 * Tahminin neye dayandığı: güvenilirliği okuyan görsün.
 * @param {{ forecast: any }} props
 */
function BasisNote({ forecast }) {
  const { LAST_YEAR: lastYear, RECENT: recent, NONE: none } = forecast.basisCounts;
  if (none === forecast.days) {
    return (
      <p className="rounded-control bg-surface-muted px-3 py-2 text-sm text-ink-soft">
        Karşılaştırma verisi yok: tahmin şimdilik eldeki rezervasyonla aynı. Sistemde birkaç haftalık geçmiş birikince son haftalardan,
        bir yıl dolunca geçen yılın aynı döneminden tahmin edilir.
      </p>
    );
  }
  const parts = [lastYear > 0 && `${lastYear} gün geçen yılın aynı döneminden`, recent > 0 && `${recent} gün son haftalardan`, none > 0 && `${none} gün eldekiyle aynı (veri yok)`].filter(Boolean);
  return <p className="text-xs text-ink-muted">Tahmin kaynağı: {parts.join(' · ')}.</p>;
}

/** @param {{ query: import('@tanstack/react-query').UseQueryResult<any> }} props */
function RevenueForecast({ query }) {
  const data = query.data;
  return (
    <Card title="Gelir tahmini" description="Oda geliri, vergiler hariç. Eldeki gece fiyatları + beklenen satışın eldeki ortalama fiyatla geliri.">
      {query.isPending && <Spinner label="Hesaplanıyor…" className="py-6" />}
      {query.isError && <p className="text-sm text-danger-ink">Tahmin yüklenemedi.</p>}
      {data && <RevenueFigures forecast={data} />}
    </Card>
  );
}

/** @param {{ forecast: any }} props */
function RevenueFigures({ forecast }) {
  const { totals, currency } = forecast;
  const money = (value) => formatMoney(value, currency);
  const expected = totals.forecast.pickupRevenue;
  const negative = expected.startsWith('-');
  const revenueChange = formatChange(totals.change.revenue, 'pct');
  const occupancyChange = formatChange(totals.change.occupancyPts, 'pts');
  return (
    <dl className="flex flex-col gap-3 text-sm">
      <div>
        <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Tahmini oda geliri</dt>
        <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">{money(totals.forecast.revenue)}</dd>
        <dd className="mt-0.5 text-ink-soft">
          Eldeki {money(totals.onBooks.revenue)} {negative ? '−' : '+'} {negative ? 'iptal / gelmeyen' : 'beklenen'} {money(negative ? expected.slice(1) : expected)}
        </dd>
      </div>
      <div className="flex justify-between gap-3 border-t border-line pt-3">
        <dt className="text-ink-soft">Geçen yıl aynı dönem</dt>
        <dd className="text-right tabular-nums">
          {money(totals.lastYear.revenue)} <span className="text-ink-muted">· {revenueChange.text}</span>
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-ink-soft">Tahmini doluluk</dt>
        <dd className="text-right tabular-nums">
          {formatPct(totals.forecast.occupancyPct)} <span className="text-ink-muted">· eldeki {formatPct(totals.onBooks.occupancyPct)}</span>
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-ink-soft">Geçen yıl doluluk</dt>
        <dd className="text-right tabular-nums">
          {formatPct(totals.lastYear.occupancyPct)} <span className="text-ink-muted">· {occupancyChange.text}</span>
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-ink-soft">Tahmini ADR</dt>
        <dd className="text-right tabular-nums">{totals.forecast.adr === null ? '—' : money(totals.forecast.adr)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-ink-soft">Beklenen ek satış</dt>
        <dd className="text-right tabular-nums">{signedNights(totals.forecast.pickup)} oda gecesi</dd>
      </div>
    </dl>
  );
}

/** @param {{ query: import('@tanstack/react-query').UseQueryResult<any>, canOpenPlan: boolean }} props */
function CriticalDays({ query, canOpenPlan }) {
  const data = query.data;
  return (
    <Card
      title="Kritik günler"
      description={
        data
          ? `Tahmini doluluk yüksek eşiğin (%${data.settings.highPct}) üstünde ya da düşük eşiğin (%${data.settings.lowPct}) altında (düşük doluluk için tahmin gerekir); ya da fazla satış.`
          : undefined
      }
    >
      {query.isPending && <Spinner label="Hesaplanıyor…" className="py-6" />}
      {query.isError && <p className="text-sm text-danger-ink">Tahmin yüklenemedi.</p>}
      {data && data.alerts.length === 0 && (
        <EmptyState
          icon="check"
          title="Kritik gün yok"
          description={
            data.basisCounts.NONE === data.days
              ? 'Yüksek doluluk ve fazla satış yok. Düşük doluluk, karşılaştırma verisi birikip tahmin çıktığında işaretlenir.'
              : `Önümüzdeki ${data.days} günün tahmini doluluğu eşiklerin arasında.`
          }
        />
      )}
      {data && data.alerts.length > 0 && (
        <ul className="flex max-h-[26rem] flex-col divide-y divide-line overflow-y-auto">
          {data.alerts.map((alert) => (
            <li key={alert.date} className="flex flex-col gap-1 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{longDay(alert.date)}</span>
                <Badge tone={ALERT_STYLE[alert.alert].tone}>
                  <span aria-hidden="true">{ALERT_STYLE[alert.alert].glyph}</span> {FORECAST_ALERT_LABELS[alert.alert]}
                </Badge>
              </div>
              <p className="text-sm tabular-nums text-ink-soft">
                Eldeki {formatPct(alert.onBooks.occupancyPct)} ({alert.onBooks.sold}/{alert.sellable}) · tahmin {formatPct(alert.forecast.occupancyPct)}
              </p>
              <p className="text-xs text-ink-muted">
                {ALERT_HINTS[alert.alert]}
                {canOpenPlan && (
                  <>
                    {' '}
                    <Link to={`/oda-plani?from=${alert.date}`} className="font-semibold text-info-ink underline-offset-2 hover:underline">
                      Oda planında aç
                    </Link>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** @param {{ initial: { lowPct: number, highPct: number, updatedAt: string }, onClose: () => void }} props */
function ThresholdDialog({ initial, onClose }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({ lowPct: String(initial.lowPct), highPct: String(initial.highPct) });
  const [errors, setErrors] = useState({});
  const mutation = useMutation({
    mutationFn: (body) => apiPut('/forecast/settings', body),
    onSuccess: async () => {
      // Tahmin ve bugünün doluluk kartı aynı eşikle renklenir: ikisi de tazelensin.
      await refresh();
      toastSuccess('Kritik gün eşikleri kaydedildi');
      onClose();
    },
    // Başkası bu arada değiştirdiyse ekrandaki değerler eskidir: yenisi gelsin.
    onError: (error) => (error?.code === 'STALE_WRITE' ? refresh() : undefined),
  });

  function refresh() {
    return Promise.all([queryClient.invalidateQueries({ queryKey: forecastKeys.all }), queryClient.invalidateQueries({ queryKey: dashboardKeys.today })]);
  }

  function submit(event) {
    event.preventDefault();
    const checked = validateWith(forecastSettingsSchema, { ...values, expectedUpdatedAt: initial.updatedAt });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    mutation.mutate(checked.data);
  }

  return (
    <Modal open size="sm" title="Kritik gün eşikleri" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {mutation.error && (
          <Alert tone="danger" title="Kaydedilemedi">
            {mutation.error.code === 'STALE_WRITE' ? 'Eşikler bu arada başkası tarafından değiştirildi; pencereyi kapatıp yeniden açın.' : mutation.error.message}
          </Alert>
        )}
        <p className="text-sm text-ink-soft">
          Tahmini doluluğu düşük eşiğin altında ya da yüksek eşiğin üstünde olan gün kritik sayılır; bugünün doluluk kartı da düşük eşikle
          uyarır. Eşikler %{FORECAST_THRESHOLD_MIN_PCT}–%{FORECAST_THRESHOLD_MAX_PCT}, aralarında en az {FORECAST_THRESHOLD_MIN_GAP_PCT} puan.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Düşük doluluk (%)" inputMode="numeric" value={values.lowPct} onChange={(event) => setValues({ ...values, lowPct: event.target.value })} error={errors.lowPct} />
          <Input label="Yüksek doluluk (%)" inputMode="numeric" value={values.highPct} onChange={(event) => setValues({ ...values, highPct: event.target.value })} error={errors.highPct} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" icon="check" disabled={mutation.isPending}>
            Kaydet
          </Button>
        </div>
      </form>
    </Modal>
  );
}
