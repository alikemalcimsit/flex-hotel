import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { loyaltyKeys, pointsText, tierProgress } from '../../lib/loyalty.js';

/** Ayardaki seviye listesi (rozet tonu ve ilerleme çubuğu için; hepsi `loyalty.view` ile okunur). */
export function useLoyaltyTiers() {
  const query = useQuery({ queryKey: loyaltyKeys.settings, queryFn: () => api('/loyalty/settings') });
  return { tiers: query.data?.settings?.tiers ?? [], currency: query.data?.currency ?? '' };
}

/**
 * Sonraki seviyeye ilerleme çubuğu (son 12 ayda kazanılan puana göre); en üst seviyede yalnız metin.
 * @param {{ account: { qualifyingPoints: number, tier: { code: string }, nextTier: { name: string, toNext: number } | null }, tiers: Array<{ code: string, minPoints: number }> }} props
 */
export function TierProgress({ account, tiers }) {
  if (!account.nextTier) return <p className="text-xs text-ink-muted">En üst seviyede · son 12 ayda {pointsText(account.qualifyingPoints)}</p>;
  const currentMin = tiers.find((tier) => tier.code === account.tier.code)?.minPoints ?? 0;
  const percent = tierProgress(account.qualifyingPoints, account.nextTier.toNext, currentMin);
  return (
    <div className="flex flex-col gap-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${account.nextTier.name} seviyesine ilerleme`}>
        <div className="h-full rounded-full bg-ink" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-ink-muted">
        {account.nextTier.name} seviyesine {pointsText(account.nextTier.toNext)} kaldı · son 12 ayda {pointsText(account.qualifyingPoints)}
      </p>
    </div>
  );
}
