import { MAX_LOYALTY_TIERS } from '@hotelos/hotel-contracts';
import { Button, Input } from '@hotelos/ui';

/** Yeni satırın geçici anahtarı (kod değişebilir; React anahtarı sabit kalsın). */
let nextRowKey = 0;
/** @param {{ code?: string, name?: string, minPoints?: number | string, multiplier?: string, perks?: string }} tier */
export const tierRow = (tier = {}) => ({
  key: `tier-${(nextRowKey += 1)}`,
  code: tier.code ?? '',
  name: tier.name ?? '',
  minPoints: tier.minPoints === undefined ? '' : String(tier.minPoints),
  multiplier: tier.multiplier === undefined ? '1' : String(tier.multiplier).replace('.', ','),
  perks: tier.perks ?? '',
});
/** Form satırı → şema girdisi. @param {ReturnType<typeof tierRow>} row */
export const tierBody = (row) => ({ code: row.code, name: row.name, minPoints: row.minPoints.trim(), multiplier: row.multiplier.trim().replace(',', '.'), perks: row.perks });

/**
 * Seviyeler tablosu (modül 56): kod, ad, eşik (son 12 ayda kazanılan puan), kazanma çarpanı, avantaj metni;
 * ekle / sil, en çok `MAX_LOYALTY_TIERS`. Bir seviyenin eşiği 0 olmalı (başlangıç).
 * @param {{ rows: Array<ReturnType<typeof tierRow>>, onChange: (rows: Array<ReturnType<typeof tierRow>>) => void, errors: Record<string, string>, disabled: boolean }} props
 */
export function TierEditor({ rows, onChange, errors, disabled }) {
  const update = (key, field) => (event) => onChange(rows.map((row) => (row.key === key ? { ...row, [field]: event.target.value } : row)));
  const remove = (key) => onChange(rows.filter((row) => row.key !== key));
  const add = () => {
    const highest = rows.reduce((max, row) => Math.max(max, Number(row.minPoints) || 0), 0);
    onChange([...rows, tierRow({ minPoints: highest + 1000, multiplier: '1' })]);
  };
  const error = (index, field) => errors[`tiers.${index}.${field}`];

  return (
    <div className="flex flex-col gap-3">
      {errors.tiers && <p className="text-xs font-bold text-sec-strong">{errors.tiers}</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.key} className="grid gap-3 rounded-item border border-line p-3 sm:grid-cols-[8rem_1fr_7rem_6rem_auto] lg:grid-cols-[8rem_10rem_7rem_6rem_1fr_auto]">
            <Input label="Kod" name={`tier-code-${index}`} value={row.code} onChange={update(row.key, 'code')} error={error(index, 'code')} disabled={disabled} />
            <Input label="Ad" name={`tier-name-${index}`} value={row.name} onChange={update(row.key, 'name')} error={error(index, 'name')} disabled={disabled} />
            <Input label="Eşik (puan)" name={`tier-min-${index}`} inputMode="numeric" value={row.minPoints} onChange={update(row.key, 'minPoints')} error={error(index, 'minPoints')} disabled={disabled} />
            <Input label="Çarpan" name={`tier-multiplier-${index}`} inputMode="decimal" value={row.multiplier} onChange={update(row.key, 'multiplier')} error={error(index, 'multiplier')} disabled={disabled} />
            <Input label="Avantaj" name={`tier-perks-${index}`} placeholder="Geç çıkış, oda yükseltme…" value={row.perks} onChange={update(row.key, 'perks')} error={error(index, 'perks')} disabled={disabled} className="sm:col-span-4 lg:col-span-1" />
            {!disabled && (
              <span className="flex items-end">
                <Button type="button" size="sm" variant="ghost" icon="trash" aria-label={`${row.name || 'Seviye'} seviyesini sil`} onClick={() => remove(row.key)} disabled={rows.length <= 1} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {!disabled && (
        <div>
          <Button type="button" size="sm" variant="outline" icon="plus" onClick={add} disabled={rows.length >= MAX_LOYALTY_TIERS}>
            Seviye ekle
          </Button>
        </div>
      )}
    </div>
  );
}
