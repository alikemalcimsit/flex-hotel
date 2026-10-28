import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MAX_PRODUCTION_DAYS, POS_STATIONS, POS_STATION_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Select } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { banquetKeys, eventPath, shiftDay, wallText, weekdayText } from '../../lib/banquet.js';
import { useFnbLive } from '../../lib/kitchen.js';
import { quantityText } from '../../lib/kitchenFormat.js';
import { printDocument, productionPlanHtml } from '../../lib/kitchenPrint.js';
import { useHotelContext, useHotelToday } from '../../lib/useHotel.js';
import { toastError } from '../../store/toast.js';

const STATION_OPTIONS = [{ value: '', label: 'Bütün istasyonlar' }, ...POS_STATIONS.filter((station) => station !== 'NONE').map((station) => ({ value: station, label: POS_STATION_LABELS[station] }))];
const STATION_TONES = Object.freeze({ HOT: 'danger', COLD: 'sky', BAR: 'violet', PASTRY: 'warning', NONE: 'neutral' });

/** @param {string} from @param {string} to */
const spanDays = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * Mutfak üretim planı (modül 43): kesin etkinliklerin menülerinden, servis saatinden geriye
 * sayılan hazırlık görevleri — gün → saat → görev (istasyon, yemek / ara ürün, miktar, hazır
 * olacağı an, etkinlik). Ara ürün, onu kullanan yemeğin başlangıcından önce, başladığı güne
 * düşer. Kesinleşmemiş menünün görevi "taslak". Mutfak duvarı için A4 çıktı.
 */
export function ProductionTab() {
  const { today } = useHotelToday();
  const { data: hotel } = useHotelContext();
  useFnbLive();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => shiftDay(today, 1));
  const [station, setStation] = useState('');
  const [includeTentative, setIncludeTentative] = useState(false);

  const rangeError = to < from ? 'Bitiş başlangıçtan önce olamaz' : spanDays(from, to) >= MAX_PRODUCTION_DAYS ? `Aralık en fazla ${MAX_PRODUCTION_DAYS} gün` : null;
  const filters = { from, to, station: station || undefined, includeTentative: includeTentative ? 'true' : 'false' };
  const query = useQuery({
    queryKey: banquetKeys.production(filters),
    queryFn: () => api(withQuery('/banquet/fnb/production', filters)),
    enabled: !rangeError && Boolean(from && to),
    placeholderData: keepPreviousData,
  });
  const plan = query.data;

  function print() {
    if (!plan) return;
    if (!printDocument(productionPlanHtml(plan, { hotelName: hotel?.name ?? '', stationLabel: station ? POS_STATION_LABELS[station] : undefined }))) {
      toastError('Yazdırma penceresi açılamadı; tarayıcının açılır pencere iznini verin.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          <Button type="button" variant="outline" icon="fileText" onClick={print} disabled={!plan || plan.counts.tasks === 0}>
            Yazdır
          </Button>
        }
      >
        <Input label="Hazırlık günü (ilk)" name="production-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} error={rangeError ?? undefined} className="w-full sm:w-44" />
        <Input label="Hazırlık günü (son)" name="production-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-44" />
        <Select label="İstasyon" name="production-station" options={STATION_OPTIONS} value={station} onChange={(event) => setStation(event.target.value)} className="w-full sm:w-48" />
        <Checkbox label="Opsiyonlular da" name="production-tentative" checked={includeTentative} onChange={(event) => setIncludeTentative(event.target.checked)} className="pb-1" />
      </Toolbar>

      {rangeError ? (
        <Alert tone="warning">{rangeError}</Alert>
      ) : query.isPending || (query.isError && !plan) ? (
        <QueryFallback query={query} errorTitle="Üretim planı hesaplanamadı" />
      ) : plan.counts.tasks === 0 ? (
        <Card>
          <EmptyState icon="utensils" title="Hazırlık görevi yok" description="Bu günlerde başlayan banket hazırlığı yok. Menüsü olan kesin etkinlik yoksa ya da reçetelerin hazırlık süresi başka güne düşüyorsa burası boştur." />
        </Card>
      ) : (
        <div className={`flex flex-col gap-4 transition-opacity ${query.isFetching ? 'opacity-60' : ''}`}>
          {query.isError && <Alert tone="danger">{query.error.message}</Alert>}
          <p className="text-sm text-ink-soft">
            {plan.counts.tasks} görev · {plan.counts.events} etkinlik · {plan.counts.menus} menü
            {plan.unfinalized > 0 && <span className="font-semibold text-warning-ink"> · {plan.unfinalized} menü mutfağa kesinleşmedi (taslak)</span>}
          </p>
          {plan.days.map((day) => (
            <Card key={day.day} title={weekdayText(day.day)}>
              <ol className="flex flex-col gap-4">
                {day.hours.map((hour) => (
                  <li key={hour.hour} className="grid grid-cols-[4rem_1fr] gap-3">
                    <span className="pt-1 font-mono text-sm font-bold text-ink">{hour.hour}</span>
                    <ul className="flex flex-col divide-y divide-line rounded-panel border border-line">
                      {hour.tasks.map((task) => (
                        <li key={task.key} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs text-ink-muted">{task.startLocal.slice(11, 16)}</span>
                              <Badge tone={STATION_TONES[task.station]} dot={false}>
                                {POS_STATION_LABELS[task.station]}
                              </Badge>
                              <span className="font-semibold text-ink">{task.name}</span>
                              {task.kind === 'PREP' && <Badge tone="violet">ara ürün</Badge>}
                              {!task.menu.finalized && <Badge tone="warning">taslak menü</Badge>}
                            </span>
                            <span className="mt-0.5 block text-xs text-ink-soft">
                              <Link to={eventPath(task.event.id, 'menu')} className="font-semibold hover:underline">
                                {task.event.code}
                              </Link>{' '}
                              {task.event.name} · {task.venueName} · servis {wallText(task.serveLocal)} · {task.menu.guests} kişi
                              {task.usedBy.length > 0 && ` · → ${task.usedBy.join(', ')}`}
                            </span>
                            {task.menu.notes && <span className="mt-0.5 block text-xs text-ink-muted">Not: {task.menu.notes}</span>}
                          </span>
                          <span className="text-right">
                            <span className="block font-semibold tabular-nums">{quantityText(task.quantity, task.unit)}</span>
                            <span className="block text-xs text-ink-muted">hazır {task.readyLocal.slice(11, 16)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
