import { useSearchParams } from 'react-router-dom';
import { BUDGET_MAX_YEARS_AHEAD } from '@hotelos/hotel-contracts';
import { Button, Select } from '@hotelos/ui';
import { TabNav } from '../../components/TabNav.jsx';
import { useHotelToday } from '../../lib/useHotel.js';

/** Yıl seçicide bugünden geriye gösterilen yıl sayısı. */
const YEARS_BACK = 3;

/**
 * Bütçe ekranlarının ortak üst şeridi (modül 27): sekmeler ve yıl. Yıl adres
 * çubuğunda (`?yil=`): sekme değişince korunur, paylaşılan bağlantı aynı yılı açar.
 *
 * @returns {{ year: number, setYear: (year: number) => void, currentYear: number }}
 */
export function useBudgetYearParam() {
  const [params, setParams] = useSearchParams();
  const { today } = useHotelToday();
  const currentYear = Number((today ?? new Date().toISOString().slice(0, 10)).slice(0, 4));
  const raw = Number(params.get('yil'));
  const year = Number.isInteger(raw) && raw >= currentYear - YEARS_BACK && raw <= currentYear + BUDGET_MAX_YEARS_AHEAD ? raw : currentYear;
  const setYear = (next) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        copy.set('yil', String(next));
        return copy;
      },
      { replace: true },
    );
  return { year, setYear, currentYear };
}

/** @param {{ year: number }} props */
export function BudgetTabs({ year }) {
  const query = `?yil=${year}`;
  return (
    <TabNav
      label="Bütçe sayfaları"
      tabs={[
        { to: `/butce/plan${query}`, label: 'Bütçe', icon: 'wallet' },
        { to: `/butce/gerceklesen${query}`, label: 'Gerçekleşen giderler', icon: 'fileText' },
        { to: `/butce/sapma${query}`, label: 'Sapma raporu', icon: 'chart' },
      ]}
    />
  );
}

/** @param {{ year: number, currentYear: number, onChange: (year: number) => void }} props */
export function YearPicker({ year, currentYear, onChange }) {
  const options = [];
  for (let value = currentYear - YEARS_BACK; value <= currentYear + BUDGET_MAX_YEARS_AHEAD; value += 1) options.push({ value: String(value), label: String(value) });
  return (
    <div className="flex items-end gap-1.5">
      <Button variant="outline" size="sm" icon="chevronLeft" aria-label="Önceki yıl" disabled={year <= currentYear - YEARS_BACK} onClick={() => onChange(year - 1)} />
      <Select label="Yıl" compact value={String(year)} onChange={(event) => onChange(Number(event.target.value))} options={options} className="w-28" />
      <Button variant="outline" size="sm" icon="chevronRight" aria-label="Sonraki yıl" disabled={year >= currentYear + BUDGET_MAX_YEARS_AHEAD} onClick={() => onChange(year + 1)} />
    </div>
  );
}
