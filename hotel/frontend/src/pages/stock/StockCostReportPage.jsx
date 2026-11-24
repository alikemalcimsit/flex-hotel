import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, MAX_STOCK_REPORT_DAYS, STOCK_ITEM_GROUP_LABELS } from '@hotelos/hotel-contracts';
import { Badge, Input, Select } from '@hotelos/ui';
import { ChoiceChips } from '../../components/ChoiceChips.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { SummaryTile } from '../../components/SummaryTile.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { stockKeys, useWarehouses } from '../../lib/kitchen.js';
import { foodCostTone, quantityText } from '../../lib/kitchenFormat.js';
import { useHotelContext } from '../../lib/useHotel.js';

const VIEW_OPTIONS = [
  { value: 'items', label: 'Malzeme bazlı' },
  { value: 'products', label: 'Ürün bazlı' },
];
const DAY_MS = 86_400_000;
const isoDay = (date) => date.toISOString().slice(0, 10);
const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
const FOOD_COST_TONES = Object.freeze({ good: 'success', warning: 'warning', danger: 'danger' });

/**
 * Maliyet raporu (modül 44), değişmez hareket kayıtlarından (her hareket o anki ortalama maliyetle):
 * - **Malzeme bazlı:** dönemde giriş, satış düşümü, çıkış, fire, sayım farkı, transfer (depo süzgecinde net) ve
 *   bugünkü mevcut / değer. Tüketim = satış + çıkış + fire.
 * - **Ürün bazlı:** menü ürünü başına satılan adet, ciro, reçeteden düşen maliyet, brüt kâr, yemek maliyeti %.
 */
export function StockCostReportPage() {
  const { data: hotel } = useHotelContext();
  const currency = hotel?.currency;
  const warehouses = useWarehouses({ includeInactive: true });
  const [view, setView] = useState('items');
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * DAY_MS)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [warehouseId, setWarehouseId] = useState('');
  const [onlyMoved, setOnlyMoved] = useState(true);

  const rangeError = from && to && to < from ? 'Bitiş başlangıçtan önce' : from && to && daysBetween(from, to) > MAX_STOCK_REPORT_DAYS ? `En fazla ${MAX_STOCK_REPORT_DAYS} gün` : null;
  const filters = { from, to, warehouseId: warehouseId || undefined };
  const enabled = Boolean(from && to && !rangeError);
  const items = useQuery({ queryKey: stockKeys.costReport(filters), queryFn: () => api(withQuery('/stock/reports/cost', filters)), enabled: enabled && view === 'items' });
  const products = useQuery({ queryKey: stockKeys.productReport(filters), queryFn: () => api(withQuery('/stock/reports/products', filters)), enabled: enabled && view === 'products' });
  const report = view === 'items' ? items : products;

  const itemRows = useMemo(() => {
    const rows = items.data?.items ?? [];
    if (!onlyMoved) return rows;
    return rows.filter((row) => ['receiptQty', 'saleQty', 'issueQty', 'wasteQty', 'countQty', 'transferQty'].some((key) => Number(row[key]) !== 0));
  }, [items.data, onlyMoved]);

  const signed = (value, unit) => {
    const number = Number(value);
    if (number === 0) return <span className="text-ink-muted">—</span>;
    return `${number > 0 ? '+' : ''}${quantityText(value, unit)}`;
  };
  const qtyCost = (qty, cost, unit, negative = false) =>
    Number(qty) === 0 ? <span className="text-ink-muted">—</span> : (
      <span className="block">
        <span className="block">{quantityText(qty, unit)}</span>
        <span className={`block text-xs ${negative ? 'text-sec-strong' : 'text-ink-muted'}`}>{formatMoney(cost, currency)}</span>
      </span>
    );

  const itemColumns = [
    {
      key: 'name',
      header: 'Malzeme',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">{[row.code, STOCK_ITEM_GROUP_LABELS[row.group]].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    { key: 'receipt', header: 'Giriş', className: 'text-right tabular-nums', render: (row) => qtyCost(row.receiptQty, row.receiptCost, row.unit) },
    { key: 'sale', header: 'Satış düşümü', className: 'text-right tabular-nums', render: (row) => qtyCost(row.saleQty, row.saleCost, row.unit) },
    { key: 'issue', header: 'Çıkış', className: 'text-right tabular-nums', render: (row) => qtyCost(row.issueQty, row.issueCost, row.unit) },
    { key: 'waste', header: 'Fire', className: 'text-right tabular-nums', render: (row) => qtyCost(row.wasteQty, row.wasteCost, row.unit, true) },
    {
      key: 'count',
      header: 'Sayım farkı',
      className: 'text-right tabular-nums',
      render: (row) => (Number(row.countQty) === 0 ? <span className="text-ink-muted">—</span> : (
        <span className="block">
          <span className={`block ${Number(row.countQty) < 0 ? 'text-sec-strong' : 'text-success-ink'}`}>{signed(row.countQty, row.unit)}</span>
          <span className="block text-xs text-ink-muted">{formatMoney(row.countCost, currency)}</span>
        </span>
      )),
    },
    ...(warehouseId ? [{ key: 'transfer', header: 'Transfer (net)', className: 'text-right tabular-nums', render: (row) => signed(row.transferQty, row.unit) }] : []),
    {
      key: 'value',
      header: 'Bugün: mevcut / değer',
      className: 'text-right tabular-nums',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold">{quantityText(row.onHand, row.unit)}</span>
          <span className="block text-xs text-ink-muted">
            {formatMoney(row.value, currency)} · {formatMoney(row.unitCost, currency)}/{KITCHEN_UNIT_LABELS[row.unit]}
          </span>
        </span>
      ),
    },
  ];
  const productColumns = [
    {
      key: 'name',
      header: 'Ürün',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">{[row.code, row.category, row.hasRecipe ? null : 'reçetesiz'].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    { key: 'sold', header: 'Satılan', className: 'text-right tabular-nums', render: (row) => (row.comped ? `${row.sold} (+${row.comped} ikram)` : row.sold) },
    { key: 'revenue', header: 'Ciro', className: 'text-right tabular-nums', render: (row) => formatMoney(row.revenue, currency) },
    { key: 'cost', header: 'Malzeme maliyeti', className: 'text-right tabular-nums', render: (row) => (row.hasRecipe ? formatMoney(row.cost, currency) : <span className="text-ink-muted">reçete yok</span>) },
    { key: 'margin', header: 'Brüt kâr', className: 'text-right tabular-nums font-semibold', render: (row) => formatMoney(row.margin, currency) },
    {
      key: 'pct',
      header: 'Yemek maliyeti',
      className: 'text-right tabular-nums',
      render: (row) => (row.foodCostPct === null ? <span className="text-ink-muted">—</span> : <Badge tone={FOOD_COST_TONES[foodCostTone(Number(row.foodCostPct))] ?? 'neutral'}>%{row.foodCostPct.replace('.', ',')}</Badge>),
    },
  ];

  const totals = report.data?.totals;
  return (
    <div className="flex flex-col gap-4">
      <Toolbar actions={<ChoiceChips label="Görünüm" options={VIEW_OPTIONS} value={view} onChange={setView} />}>
        <Input label="İlk gün" name="report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} error={rangeError ?? undefined} className="w-full sm:w-40" />
        <Input label="Son gün" name="report-to" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-40" />
        <Select
          label="Depo"
          name="report-warehouse"
          options={[{ value: '', label: 'Bütün depolar' }, ...(warehouses.data ?? []).map((row) => ({ value: row.id, label: row.name }))]}
          value={warehouseId}
          onChange={(event) => setWarehouseId(event.target.value)}
          className="w-full sm:w-48"
        />
        {view === 'items' && (
          <Select label="Satırlar" name="report-rows" options={[{ value: 'moved', label: 'Dönemde hareket görenler' }, { value: 'all', label: 'Hepsi (stoklular da)' }]} value={onlyMoved ? 'moved' : 'all'} onChange={(event) => setOnlyMoved(event.target.value === 'moved')} className="w-full sm:w-56" />
        )}
      </Toolbar>
      {view === 'items' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SummaryTile label="Giriş" value={totals ? formatMoney(totals.receiptCost, currency) : undefined} hint="mal kabul, alış fiyatıyla" icon="download" />
          <SummaryTile label="Tüketim" value={totals ? formatMoney(totals.consumptionCost, currency) : undefined} hint={totals ? `satış ${formatMoney(totals.saleCost, currency)} · çıkış ${formatMoney(totals.issueCost, currency)}` : 'satış + çıkış + fire'} icon="utensils" />
          <SummaryTile label="Fire" value={totals ? formatMoney(totals.wasteCost, currency) : undefined} hint="bozulan / dökülen" icon="trash" tone={totals && Number(totals.wasteCost) > 0 ? 'warning' : 'neutral'} />
          <SummaryTile label="Sayım farkı" value={totals ? formatMoney(totals.countCost, currency) : undefined} hint="eksi = kayıp" icon="clipboard" tone={totals && Number(totals.countCost) < 0 ? 'danger' : 'neutral'} />
          <SummaryTile label="Bugünkü değer" value={totals ? formatMoney(totals.value, currency) : undefined} hint={warehouseId ? 'seçili depo' : 'bütün depolar'} icon="wallet" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryTile label="Ciro" value={totals ? formatMoney(totals.revenue, currency) : undefined} hint="kapanan adisyon kalemleri" icon="banknote" />
          <SummaryTile label="Malzeme maliyeti" value={totals ? formatMoney(totals.cost, currency) : undefined} hint="reçeteden düşen" icon="utensils" />
          <SummaryTile label="Brüt kâr" value={totals ? formatMoney(totals.margin, currency) : undefined} hint="ciro − maliyet" icon="wallet" />
          <SummaryTile label="Yemek maliyeti" value={totals?.foodCostPct ? `%${totals.foodCostPct.replace('.', ',')}` : '—'} hint="maliyet / ciro" icon="percent" tone={totals?.foodCostPct ? FOOD_COST_TONES[foodCostTone(Number(totals.foodCostPct))] ?? 'neutral' : 'neutral'} />
        </div>
      )}
      <DataTable
        columns={view === 'items' ? itemColumns : productColumns}
        rows={view === 'items' ? itemRows : products.data?.items}
        isLoading={enabled && report.isPending}
        isFetching={report.isFetching}
        error={report.isError ? report.error : null}
        onRetry={() => report.refetch()}
        emptyTitle={rangeError ? 'Aralığı düzeltin' : view === 'items' ? 'Dönemde hareket yok' : 'Dönemde satış yok'}
        emptyHint={view === 'items' ? 'Mal kabul, satış düşümü, çıkış, fire ve sayım hareketleri burada toplanır.' : 'Adisyon kapandıkça satış ve reçete maliyeti burada toplanır; reçetesi olmayan ürünün maliyeti hesaplanamaz.'}
      />
    </div>
  );
}
