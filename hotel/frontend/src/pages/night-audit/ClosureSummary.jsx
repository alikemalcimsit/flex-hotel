import { formatMoney } from '../../lib/format.js';

/**
 * Bir kapanışın günlük özeti (doluluk, oda geliri, ADR, RevPAR, tahsilat) —
 * sihirbazın kapanış sonrası ekranı ve geçmiş ayrıntısı ortak kullanır.
 *
 * @param {{ stats: any, noShowCount?: number }} props
 */
export function ClosureSummary({ stats, noShowCount }) {
  if (!stats) return null;
  const currency = stats.currency ?? '';
  const tiles = [
    { label: 'Doluluk', value: `%${stats.occupancyPct}`, hint: `${stats.roomsSold} / ${stats.roomsSellable} oda` },
    { label: 'Oda geliri', value: formatMoney(stats.roomRevenue, currency), hint: 'Vergi hariç net' },
    { label: 'ADR', value: formatMoney(stats.adr, currency), hint: 'Satılan oda başına' },
    { label: 'RevPAR', value: formatMoney(stats.revpar, currency), hint: 'Satılabilir oda başına' },
    { label: 'Tahsilat', value: formatMoney(stats.collections, currency), hint: 'Günün tahsilatı' },
    ...(noShowCount !== undefined ? [{ label: 'Gelmeyen', value: String(noShowCount), hint: 'Düşülen rezervasyon' }] : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-card border border-transparent bg-surface p-4 shadow-soft">
          <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{tile.label}</span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-ink">{tile.value}</span>
          <span className="mt-0.5 block text-xs text-ink-muted">{tile.hint}</span>
        </div>
      ))}
    </div>
  );
}
