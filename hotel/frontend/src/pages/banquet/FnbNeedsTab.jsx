import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EVENT_STATUS_LABELS, MAX_NEEDS_DAYS, STOCK_ITEM_GROUPS, STOCK_ITEM_GROUP_LABELS } from '@hotelos/hotel-contracts';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Select, Spinner } from '@hotelos/ui';
import { QueryFallback } from '../../components/QueryFallback.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { EVENT_STATUS_TONES, banquetKeys, dayText, eventPath, shiftDay } from '../../lib/banquet.js';
import { formatMoney } from '../../lib/format.js';
import { useFnbLive } from '../../lib/kitchen.js';
import { policyPctText, quantityText } from '../../lib/kitchenFormat.js';
import { needsListHtml, printDocument } from '../../lib/kitchenPrint.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useHotelContext, useHotelToday } from '../../lib/useHotel.js';
import { toastError } from '../../store/toast.js';
import { PurchaseRequestDialog } from './PurchaseRequestDialog.jsx';

/** Açılışta önümüzdeki hafta. */
const DEFAULT_SPAN_DAYS = 6;
const GROUP_OPTIONS = [{ value: '', label: 'Bütün gruplar' }, ...STOCK_ITEM_GROUPS.map((group) => ({ value: group, label: STOCK_ITEM_GROUP_LABELS[group] }))];

/** @param {string} from @param {string} to */
const spanDays = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * Banket malzeme ihtiyacı (modül 43): servis günü aralığındaki kesin etkinliklerin bütün menüleri
 * (istenirse opsiyonlular "olası" sütununda), malzeme grubuna göre; talep edilmiş, eksik, mutfakta
 * olması gereken gün. Eksikler satın alma talebine çevrilir; liste yazdırılır (kasap, manav…).
 * Bir malzemenin satırı açılınca etkinlik dökümü gelir.
 */
export function FnbNeedsTab() {
  const can = useCan();
  const { today } = useHotelToday();
  const { data: hotel } = useHotelContext();
  useFnbLive();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => shiftDay(today, DEFAULT_SPAN_DAYS));
  const [includeTentative, setIncludeTentative] = useState(false);
  const [group, setGroup] = useState('');
  const [onlyShort, setOnlyShort] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [requesting, setRequesting] = useState(false);

  const rangeError = to < from ? 'Bitiş başlangıçtan önce olamaz' : spanDays(from, to) >= MAX_NEEDS_DAYS ? `Aralık en fazla ${MAX_NEEDS_DAYS} gün` : null;
  const filters = { from, to, includeTentative: includeTentative ? 'true' : 'false' };
  const query = useQuery({
    queryKey: banquetKeys.needs(filters),
    queryFn: () => api(withQuery('/banquet/fnb/needs', filters)),
    enabled: !rangeError && Boolean(from && to),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const rows = (data?.items ?? []).filter((row) => (!group || row.group === group) && (!onlyShort || Number(row.shortfall) > 0));
  // Talep seçili gruptan açılır: kasap, manav, kuru gıda ayrı taleplere bölünebilir.
  const shortfalls = rows.filter((row) => Number(row.shortfall) > 0);
  const showCost = Boolean(data?.totals);

  function print() {
    if (!data) return;
    if (!printDocument(needsListHtml({ ...data, items: rows }, { hotelName: hotel?.name ?? '' }))) toastError('Yazdırma penceresi açılamadı; tarayıcının açılır pencere iznini verin.');
  }

  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  const columnCount = 6 + (includeTentative ? 1 : 0) + (showCost ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          <>
            <Button type="button" variant="outline" icon="fileText" onClick={print} disabled={!data || rows.length === 0}>
              Yazdır
            </Button>
            {can(PERMISSIONS.PURCHASING_REQUEST) && (
              <Button type="button" icon="send" onClick={() => setRequesting(true)} disabled={!data || shortfalls.length === 0 || query.isFetching}>
                Eksikleri talebe çevir ({shortfalls.length})
              </Button>
            )}
          </>
        }
      >
        <Input label="Servis günü (ilk)" name="needs-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} error={rangeError ?? undefined} className="w-full sm:w-44" />
        <Input label="Servis günü (son)" name="needs-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-44" />
        <Select label="Grup" name="needs-group" options={GROUP_OPTIONS} value={group} onChange={(event) => setGroup(event.target.value)} className="w-full sm:w-52" />
        <div className="flex flex-col gap-1 pb-1">
          <Checkbox label="Opsiyonlular da (olası)" name="needs-tentative" checked={includeTentative} onChange={(event) => setIncludeTentative(event.target.checked)} />
          <Checkbox label="Yalnız eksiği olanlar" name="needs-short" checked={onlyShort} onChange={(event) => setOnlyShort(event.target.checked)} />
        </div>
      </Toolbar>

      {rangeError ? (
        <Alert tone="warning">{rangeError}</Alert>
      ) : query.isPending || (query.isError && !data) ? (
        <QueryFallback query={query} errorTitle="İhtiyaç hesaplanamadı" />
      ) : (
        <Card
          title={`${dayText(data.from)} – ${dayText(data.to)}`}
          description={`${data.events} etkinlik · ${data.menus} menü · fazla hazırlık ${policyPctText(data.overproductionPct)} dahil. Aralık etkinlik seçer: servisi aralığa düşen etkinliğin bütün menüleri hesaba girer. Eksik etkinlik başına: bir etkinlik için fazla istenen (ambalaj) başka etkinliğin eksiğini kapatmaz — teslim günü farklı olabilir.${showCost ? ` Kesin ihtiyacın tahmini maliyeti ${formatMoney(data.totals.cost, hotel?.currency)} (KDV hariç).` : ''}`}
        >
          {query.isError && <Alert tone="danger" className="mb-3">{query.error.message}</Alert>}
          {rows.length === 0 ? (
            <EmptyState icon="package" title={data.items.length ? 'Süzgece uyan malzeme yok' : 'İhtiyaç yok'} description={data.items.length ? undefined : 'Bu aralıkta kesin etkinliğin menüsü yok (opsiyonlular için kutuyu işaretleyin).'} />
          ) : (
            <div className={`overflow-x-auto transition-opacity ${query.isFetching ? 'opacity-60' : ''}`}>
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
                  <tr>
                    <th className="py-2 pr-2">Malzeme</th>
                    <th className="py-2 pr-2 text-right">Kesin</th>
                    {includeTentative && <th className="py-2 pr-2 text-right">Olası</th>}
                    <th className="py-2 pr-2 text-right">Talep edildi</th>
                    <th className="py-2 pr-2 text-right">Eksik</th>
                    <th className="py-2 pr-2">Mutfakta olmalı</th>
                    <th className="py-2 pr-2 text-right">Etkinlik</th>
                    {showCost && <th className="py-2 text-right">Tahmini maliyet</th>}
                  </tr>
                </thead>
                {[...groups].map(([key, list]) => (
                  <tbody key={key}>
                    <tr>
                      <th colSpan={columnCount} className="pb-1 pt-3 text-left text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">
                        {STOCK_ITEM_GROUP_LABELS[key]}
                      </th>
                    </tr>
                    {list.map((row) => (
                      <Fragment key={row.stockItemId}>
                        <tr className="border-b border-line">
                          <td className="py-1.5 pr-2">
                            <button
                              type="button"
                              aria-expanded={expanded === row.stockItemId}
                              onClick={() => setExpanded((current) => (current === row.stockItemId ? null : row.stockItemId))}
                              className="text-left font-semibold text-ink hover:underline"
                            >
                              {row.name}
                            </button>
                            {row.code && <span className="ml-1 font-mono text-xs text-ink-muted">{row.code}</span>}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{quantityText(row.definite, row.unit)}</td>
                          {includeTentative && <td className="py-1.5 pr-2 text-right tabular-nums text-ink-soft">{quantityText(row.tentative, row.unit)}</td>}
                          <td className="py-1.5 pr-2 text-right tabular-nums text-ink-soft">{quantityText(row.requested, row.unit)}</td>
                          <td className={`py-1.5 pr-2 text-right font-semibold tabular-nums ${Number(row.shortfall) > 0 ? 'text-warning-ink' : 'text-success-ink'}`}>
                            {Number(row.shortfall) > 0 ? quantityText(row.shortfall, row.unit) : 'yok'}
                            {Number(row.shortfall) > 0 && Number(row.requested) >= Number(row.definite) && <span className="block text-xs font-normal text-ink-muted">başka etkinliğin eksiği</span>}
                          </td>
                          <td className="py-1.5 pr-2 text-ink-soft">{dayText(row.needDay)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{row.events}</td>
                          {showCost && <td className="py-1.5 text-right tabular-nums">{formatMoney(row.cost)}</td>}
                        </tr>
                        {expanded === row.stockItemId && (
                          <tr>
                            <td colSpan={columnCount} className="bg-surface-muted px-3 py-2">
                              <Breakdown filters={filters} stockItemId={row.stockItemId} unit={row.unit} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </Card>
      )}
      {requesting && data && <PurchaseRequestDialog scope={{ from: data.from, to: data.to }} rows={shortfalls} onClose={() => setRequesting(false)} />}
    </div>
  );
}

/** Malzemenin etkinlik dökümü. @param {{ filters: object, stockItemId: string, unit: string }} props */
function Breakdown({ filters, stockItemId, unit }) {
  const query = useQuery({ queryKey: banquetKeys.needs({ ...filters, stockItemId }), queryFn: () => api(withQuery('/banquet/fnb/needs', { ...filters, stockItemId })) });
  if (query.isPending) return <Spinner label="Döküm hesaplanıyor…" className="justify-start" />;
  if (query.isError) return <p className="text-sm text-sec-strong">Döküm alınamadı: {query.error.message}</p>;
  return (
    <table className="w-full text-xs">
      <thead className="text-left uppercase tracking-[0.06em] text-ink-muted">
        <tr>
          <th className="py-1 pr-2">Etkinlik</th>
          <th className="py-1 pr-2">Durum</th>
          <th className="py-1 pr-2">İlk servis</th>
          <th className="py-1 pr-2 text-right">İhtiyaç</th>
          <th className="py-1 pr-2 text-right">Talep</th>
          <th className="py-1 pr-2 text-right">Eksik</th>
          <th className="py-1">Mutfakta</th>
        </tr>
      </thead>
      <tbody>
        {query.data.breakdown.map((row) => (
          <tr key={row.eventId} className="border-t border-line">
            <td className="py-1 pr-2">
              <Link to={eventPath(row.eventId, 'menu')} className="font-semibold text-ink hover:underline">
                {row.code}
              </Link>{' '}
              {row.name}
            </td>
            <td className="py-1 pr-2">
              <Badge tone={EVENT_STATUS_TONES[row.status]}>{EVENT_STATUS_LABELS[row.status]}</Badge>
            </td>
            <td className="py-1 pr-2">{row.firstServeLocal.replace('T', ' ')}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{quantityText(row.needed, unit)}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{quantityText(row.requested, unit)}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{quantityText(row.shortfall, unit)}</td>
            <td className="py-1">{dayText(row.needDay)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
