import { LEDGER_ACCOUNT_TYPE_LABELS } from '@hotelos/hotel-contracts';
import { Button } from '@hotelos/ui';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { accountPickerQuery } from '../../lib/accounting.js';
import { formatMoney } from '../../lib/format.js';

/**
 * Cari hesap alanı (modül 47): seçili cari kutusu ya da arama seçici. Fişte ve folyo ödemesinde ("Acente / cari",
 * voucher) kullanılır.
 *
 * @param {{
 *   label?: string,
 *   value: { id: string, code: string, name: string, type: string, balance?: string } | null,
 *   onChange: (account: any | null) => void,
 *   hint?: string,
 *   type?: string,
 *   currency?: string,
 *   error?: string,
 *   disabled?: boolean,
 * }} props
 */
export function LedgerAccountField({ label = 'Cari hesap', value, onChange, hint, type, currency = '', error, disabled = false }) {
  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <div className="flex items-center justify-between gap-3 rounded-item border border-line-strong bg-surface px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{value.name}</span>
            <span className="block text-xs text-ink-muted">
              {value.code} · {LEDGER_ACCOUNT_TYPE_LABELS[value.type] ?? value.type}
              {value.balance !== undefined ? ` · bakiye ${formatMoney(value.balance, currency)}` : ''}
            </span>
          </span>
          <Button type="button" size="sm" variant="ghost" icon="close" onClick={() => onChange(null)} disabled={disabled}>
            Değiştir
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
        placeholder="Ünvan, cari kodu ya da vergi no"
        queryOf={accountPickerQuery(type)}
        renderItem={(item) => (
          <span className="flex w-full items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate font-semibold">{item.name}</span>
              <span className="block text-xs text-ink-muted">
                {item.code} · {LEDGER_ACCOUNT_TYPE_LABELS[item.type] ?? item.type}
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{formatMoney(item.balance, currency)}</span>
          </span>
        )}
        onPick={onChange}
        emptyText="Eşleşen cari yok"
        disabled={disabled}
        error={error}
      />
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
