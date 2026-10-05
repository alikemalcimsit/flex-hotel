import { BUDGET_ITEM_KIND_LABELS, BUDGET_MONTH_LABELS, BUDGET_MONTHS } from '@hotelos/hotel-contracts';
import { cellText, parseCell } from '../../lib/budget.js';

/** Izgarada grupların sırası. */
const KIND_ORDER = Object.freeze(['REVENUE', 'KPI', 'CASH', 'EXPENSE']);
const SHORT_MONTHS = BUDGET_MONTH_LABELS.map((label) => label.slice(0, 3));
const totalFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** Hücre metninin sayısı (toplamlar için; geçersizse 0 — kayıt sözleşmeyle doğrulanır). */
const numberOf = (text) => {
  const value = Number(parseCell(text));
  return Number.isFinite(value) ? value : 0;
};

/**
 * Bütçe ızgarası (modül 27): satır kalem, sütun ay, en sağda yıl toplamı.
 * Gruplar: gelirler, hedefler (doluluk yüzde, ADR), nakit, giderler; gelir ve
 * gider ara toplamı ile brüt faaliyet kârı (gelir − gider). Düzenlenebilirse
 * hücreler metin kutusu (Türkçe biçim: 1.234,50); hata ay adıyla hücrede.
 *
 * @param {{
 *   items: Array<{ item: string, kind: string, unit: string, label: string, archived: boolean }>,
 *   values: Map<string, string[]>,
 *   editable: boolean,
 *   errors: Record<string, string>,
 *   onChange?: (item: string, month: number, text: string) => void,
 *   currency: string,
 * }} props `errors` anahtarı `${item}|${monthIndex}`
 */
export function BudgetGrid({ items, values, editable, errors, onChange, currency }) {
  const groups = KIND_ORDER.map((kind) => ({ kind, rows: items.filter((item) => item.kind === kind) })).filter((group) => group.rows.length > 0);
  const monthTotal = (kind, index) => items.filter((item) => item.kind === kind).reduce((sum, item) => sum + numberOf(values.get(item.item)?.[index] ?? ''), 0);
  const yearOf = (texts) => texts.reduce((sum, text) => sum + numberOf(text), 0);
  const months = Array.from({ length: BUDGET_MONTHS }, (_, index) => index);
  const revenue = months.map((index) => monthTotal('REVENUE', index));
  const expense = months.map((index) => monthTotal('EXPENSE', index));

  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[72rem] border-collapse text-sm">
        <caption className="sr-only">Bütçe planı, kalem × ay ({currency}, vergiler hariç; doluluk yüzde)</caption>
        <thead>
          <tr className="bg-surface-muted text-left text-[0.7rem] uppercase tracking-[0.08em] text-ink-muted">
            <th scope="col" className="sticky left-0 z-10 min-w-[14rem] bg-surface-muted px-3 py-2 font-bold">
              Kalem
            </th>
            {SHORT_MONTHS.map((label, index) => (
              <th key={label} scope="col" className="px-1.5 py-2 text-right font-bold" title={BUDGET_MONTH_LABELS[index]}>
                {label}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-bold">
              Yıl
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRows key={group.kind} group={group} values={values} editable={editable} errors={errors} onChange={onChange} yearOf={yearOf} />
          ))}
          <SummaryRow label="Gelir toplamı" values={revenue} />
          <SummaryRow label="Gider toplamı" values={expense} />
          <SummaryRow label="Brüt faaliyet kârı (gelir − gider)" values={months.map((index) => revenue[index] - expense[index])} strong />
        </tbody>
      </table>
    </div>
  );
}

/** @param {{ group: { kind: string, rows: any[] }, values: Map<string, string[]>, editable: boolean, errors: Record<string, string>, onChange?: Function, yearOf: (texts: string[]) => number }} props */
function GroupRows({ group, values, editable, errors, onChange, yearOf }) {
  return (
    <>
      <tr className="border-t border-line bg-surface">
        <th colSpan={BUDGET_MONTHS + 2} scope="colgroup" className="sticky left-0 bg-surface px-3 pb-1 pt-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">
          {BUDGET_ITEM_KIND_LABELS[group.kind]}
        </th>
      </tr>
      {group.rows.map((item) => {
        const texts = values.get(item.item) ?? Array(BUDGET_MONTHS).fill('');
        const pct = item.unit === 'PCT';
        return (
          <tr key={item.item} className="border-t border-line/60">
            <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-semibold text-ink">
              {item.label}
              {pct && <span className="ml-1 text-xs font-normal text-ink-muted">(%)</span>}
              {item.archived && <span className="ml-1 text-xs font-normal text-ink-muted">(kaldırıldı)</span>}
            </th>
            {texts.map((text, index) => {
              const error = errors[`${item.item}|${index}`];
              return (
                <td key={index} className="px-1 py-1 text-right">
                  {editable ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={text}
                      onChange={(event) => onChange?.(item.item, index, event.target.value)}
                      aria-label={`${item.label}, ${BUDGET_MONTH_LABELS[index]}`}
                      aria-invalid={error ? true : undefined}
                      title={error}
                      className={`w-[5.5rem] rounded-control border bg-surface px-2 py-1 text-right tabular-nums outline-none focus:border-ink ${error ? 'border-danger bg-danger-soft' : 'border-line'}`}
                    />
                  ) : (
                    <span className="tabular-nums">{text}</span>
                  )}
                </td>
              );
            })}
            <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{pct ? '' : totalFormatter.format(yearOf(texts))}</td>
          </tr>
        );
      })}
    </>
  );
}

/** @param {{ label: string, values: number[], strong?: boolean }} props */
function SummaryRow({ label, values, strong = false }) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <tr className={`border-t ${strong ? 'border-line-strong font-bold' : 'border-line font-semibold'} bg-surface-muted`}>
      <th scope="row" className="sticky left-0 z-10 bg-surface-muted px-3 py-2 text-left text-ink">
        {label}
      </th>
      {values.map((value, index) => (
        <td key={index} className={`px-1.5 py-2 text-right tabular-nums ${value < 0 ? 'text-danger-ink' : ''}`}>
          {value === 0 ? '—' : totalFormatter.format(value)}
        </td>
      ))}
      <td className={`px-3 py-2 text-right tabular-nums ${total < 0 ? 'text-danger-ink' : ''}`}>{total === 0 ? '—' : totalFormatter.format(total)}</td>
    </tr>
  );
}

/**
 * Sunucunun satırları → ızgara metinleri.
 * @param {Array<{ item: string }>} items
 * @param {Array<{ item: string, months: Array<string | null> }>} lines
 */
export function gridValues(items, lines) {
  const byItem = new Map(lines.map((line) => [line.item, line.months]));
  return new Map(items.map((item) => [item.item, (byItem.get(item.item) ?? Array(BUDGET_MONTHS).fill(null)).map((value) => cellText(value))]));
}
