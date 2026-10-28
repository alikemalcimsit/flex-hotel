import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { KITCHEN_UNIT_LABELS, POS_STATIONS, POS_STATION_LABELS, RECIPE_KINDS, RECIPE_KIND_LABELS, leadText } from '@hotelos/hotel-contracts';
import { Badge, Button, Checkbox, Input, Select } from '@hotelos/ui';
import { DataTable } from '../../components/DataTable.jsx';
import { Toolbar } from '../../components/Toolbar.jsx';
import { api, withQuery } from '../../lib/api.js';
import { formatMoney } from '../../lib/format.js';
import { recipeKeys } from '../../lib/kitchen.js';
import { FOOD_COST_DANGER_PCT, FOOD_COST_WARNING_PCT, allergenText, foodCostTone, pctText, quantityText } from '../../lib/kitchenFormat.js';
import { PERMISSIONS, useCan } from '../../lib/permissions.js';
import { useDebounced } from '../../lib/pos.js';
import { useHotelContext } from '../../lib/useHotel.js';

const PAGE_SIZE = 25;
const KIND_OPTIONS = [{ value: '', label: 'Hepsi' }, ...RECIPE_KINDS.map((kind) => ({ value: kind, label: RECIPE_KIND_LABELS[kind] }))];
const STATION_OPTIONS = [{ value: '', label: 'Bütün istasyonlar' }, ...POS_STATIONS.filter((station) => station !== 'NONE').map((station) => ({ value: station, label: POS_STATION_LABELS[station] }))];
const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Kullanımda' },
  { value: 'false', label: 'Pasif' },
  { value: '', label: 'Hepsi' },
];

/**
 * Reçeteler (modül 38'in reçete kısmı — modül 43): maliyet ve kâr marjı tablosu. Porsiyon /
 * birim maliyeti güncel malzeme maliyetinden; menü ürününe bağlı yemekte KDV hariç satış
 * fiyatı ve gıda maliyeti yüzdesi (eşik üstü renkli). Satıra tıklayınca reçete ekranı.
 */
export function RecipesPage() {
  const can = useCan();
  const navigate = useNavigate();
  const { data: hotel } = useHotelContext();
  const currency = hotel?.currency;
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText);
  const [kind, setKind] = useState('');
  const [station, setStation] = useState('');
  const [active, setActive] = useState('true');
  const [linked, setLinked] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, kind, station, active, linked]);

  const filters = { search: search || undefined, kind: kind || undefined, station: station || undefined, active: active || undefined, linked: linked ? 'true' : undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: recipeKeys.list(filters), queryFn: () => api(withQuery('/recipes', filters)), placeholderData: keepPreviousData });

  const columns = [
    {
      key: 'name',
      header: 'Reçete',
      render: (row) => (
        <Link to={`/mutfak/receteler/${row.id}`} className="block hover:underline">
          <span className="block font-semibold text-ink">{row.name}</span>
          <span className="block text-xs text-ink-muted">
            {[row.code, row.menuItem ? `Menü: ${row.menuItem.name}` : null].filter(Boolean).join(' · ') || RECIPE_KIND_LABELS[row.kind]}
          </span>
        </Link>
      ),
    },
    {
      key: 'kind',
      header: 'Tür · istasyon',
      render: (row) => (
        <span className="block text-sm">
          <Badge tone={row.kind === 'DISH' ? 'info' : 'violet'}>{RECIPE_KIND_LABELS[row.kind]}</Badge>
          <span className="mt-1 block text-xs text-ink-muted">{POS_STATION_LABELS[row.station]}</span>
        </span>
      ),
    },
    { key: 'yield', header: 'Verim', className: 'tabular-nums', render: (row) => <span className="whitespace-nowrap">{quantityText(row.yieldQuantity, row.yieldUnit)}</span> },
    { key: 'lead', header: 'Hazırlık', render: (row) => <span className="text-xs text-ink-soft">{leadText(row.leadMinutes)}</span> },
    {
      key: 'cost',
      header: 'Maliyet',
      className: 'text-right tabular-nums',
      render: (row) => (
        <span className="block">
          <span className="block font-semibold">
            {formatMoney(row.cost.perUnit, currency)} / {KITCHEN_UNIT_LABELS[row.yieldUnit]}
          </span>
          {row.cost.missing > 0 && <span className="block text-xs font-semibold text-warning-ink">{row.cost.missing} malzemenin maliyeti yok</span>}
        </span>
      ),
    },
    {
      key: 'margin',
      header: 'Satış (KDV hariç) · gıda maliyeti',
      className: 'text-right tabular-nums',
      render: (row) =>
        row.menuItem ? (
          <span className="flex flex-col items-end gap-1">
            <span>{formatMoney(row.menuItem.netPrice, currency)}</span>
            <Badge tone={foodCostTone(row.menuItem.foodCostPct)}>{pctText(row.menuItem.foodCostPct)}</Badge>
          </span>
        ) : (
          <span className="text-xs text-ink-muted">menüye bağlı değil</span>
        ),
    },
    { key: 'allergens', header: 'Alerjen', render: (row) => <span className="text-xs text-ink-soft">{allergenText(row.allergens)}</span> },
    { key: 'status', header: 'Durum', render: (row) => <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Kullanımda' : 'Pasif'}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        actions={
          can(PERMISSIONS.RECIPES_MANAGE) && (
            <Button type="button" icon="plus" onClick={() => navigate('/mutfak/receteler/yeni')}>
              Yeni reçete
            </Button>
          )
        }
      >
        <Input label="Ara" name="recipe-search" placeholder="Reçete adı ya da kod" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full sm:w-60" />
        <Select label="Tür" name="recipe-kind" options={KIND_OPTIONS} value={kind} onChange={(event) => setKind(event.target.value)} className="w-full sm:w-36" />
        <Select label="İstasyon" name="recipe-station" options={STATION_OPTIONS} value={station} onChange={(event) => setStation(event.target.value)} className="w-full sm:w-48" />
        <Select label="Durum" name="recipe-active" options={ACTIVE_OPTIONS} value={active} onChange={(event) => setActive(event.target.value)} className="w-full sm:w-36" />
        <Checkbox label="Yalnız menü ürünleri" hint="Kâr marjı tablosu" name="recipe-linked" checked={linked} onChange={(event) => setLinked(event.target.checked)} className="pb-1" />
      </Toolbar>
      <p className="text-xs text-ink-muted">
        Maliyet güncel malzeme maliyetiyle (KDV hariç). Gıda maliyeti %{FOOD_COST_WARNING_PCT} üstü sarı, %{FOOD_COST_DANGER_PCT} üstü kırmızı: fiyat ya da reçete gözden geçirilmeli.
      </p>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        meta={list.data?.meta}
        isLoading={list.isPending}
        isFetching={list.isFetching}
        error={list.isError ? list.error : null}
        onRetry={() => list.refetch()}
        onPageChange={setPage}
        emptyTitle={search || kind || station || linked ? 'Eşleşen reçete yok' : 'Reçete yok'}
        emptyHint={!search && !kind ? 'Önce malzeme kartlarını, sonra ara ürünleri (sos, fond) ve yemekleri girin; banket menüsü yemek reçetelerinden kurulur.' : undefined}
      />
    </div>
  );
}
