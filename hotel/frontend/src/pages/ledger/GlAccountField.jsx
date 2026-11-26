import { GL_ACCOUNT_CLASS_LABELS } from '@hotelos/hotel-contracts';
import { Button } from '@hotelos/ui';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { glAccountPickerQuery } from '../../lib/ledger.js';

/**
 * Hesap planı alanı (modül 48): seçili hesap kutusu ("kod · ad", temizle) ya da arama seçici. Fiş satırında,
 * kural ekranında ve kasa / banka fişinin karşı hesabında kullanılır; yalnız yaprak ve etkin hesaplar gelir.
 *
 * @param {{
 *   label?: string,
 *   value: { id: string, code: string, name: string, class?: string } | null,
 *   onChange: (account: any | null) => void,
 *   hint?: string,
 *   error?: string,
 *   disabled?: boolean,
 *   compact?: boolean,
 * }} props `compact` tabloda tek satır (etiket gizli)
 */
export function GlAccountField({ label = 'Hesap', value, onChange, hint, error, disabled = false, compact = false }) {
  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        {!compact && <span className="text-sm font-semibold text-ink">{label}</span>}
        <div className="flex items-center justify-between gap-3 rounded-item border border-line-strong bg-surface px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">
              <span className="tabular-nums">{value.code}</span> · {value.name}
            </span>
            {!compact && value.class && <span className="block text-xs text-ink-muted">{GL_ACCOUNT_CLASS_LABELS[value.class] ?? value.class}</span>}
          </span>
          <Button type="button" size="sm" variant="ghost" icon="close" aria-label="Hesabı temizle" onClick={() => onChange(null)} disabled={disabled}>
            {compact ? '' : 'Değiştir'}
          </Button>
        </div>
        {error && <p className="text-xs font-semibold text-sec-strong">{error}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <SearchPicker
        label={label}
        placeholder="Hesap kodu ya da adı"
        queryOf={glAccountPickerQuery}
        itemsOf={(data) => data?.items ?? []}
        renderItem={(item) => (
          <span className="flex w-full items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate font-semibold">
                <span className="tabular-nums">{item.code}</span> · {item.name}
              </span>
            </span>
            <span className="shrink-0 text-xs text-ink-muted">{GL_ACCOUNT_CLASS_LABELS[item.class] ?? ''}</span>
          </span>
        )}
        onPick={onChange}
        emptyText="Eşleşen hesap yok"
        disabled={disabled}
        error={error}
      />
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
