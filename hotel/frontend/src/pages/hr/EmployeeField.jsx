import { Button } from '@hotelos/ui';
import { SearchPicker } from '../../components/SearchPicker.jsx';
import { employeeName, employeePickerQuery } from '../../lib/hr.js';

/**
 * Personel alanı (modül 52): seçili personel kutusu ("ad · sicil · departman", değiştir) ya da arama seçici
 * (`/payroll/employees?search=`). İzin girişi, bakiye düzeltmesi, belge ekleme ve liste süzgeçlerinde kullanılır.
 *
 * @param {{
 *   label?: string,
 *   value: { id: string, code?: string, name?: string, firstName?: string, lastName?: string, department?: { name: string } | null } | null,
 *   onChange: (employee: any | null) => void,
 *   error?: string,
 *   disabled?: boolean,
 *   compact?: boolean,
 *   className?: string,
 * }} props `compact` süzgeç şeridinde tek satır (etiket gizli değil, kutu kısa)
 */
export function EmployeeField({ label = 'Personel', value, onChange, error, disabled = false, compact = false, className = '' }) {
  if (value) {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <span className="text-[0.85rem] font-bold text-ink">{label}</span>
        <div className={`flex items-center justify-between gap-3 rounded-control border border-line-strong bg-surface px-3 ${compact ? 'py-1.5' : 'py-2'}`}>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{employeeName(value)}</span>
            {!compact && (
              <span className="block text-xs text-ink-muted">
                {value.code}
                {value.department?.name ? ` · ${value.department.name}` : ''}
              </span>
            )}
          </span>
          <Button type="button" size="sm" variant="ghost" icon="close" aria-label="Personeli temizle" onClick={() => onChange(null)} disabled={disabled}>
            {compact ? '' : 'Değiştir'}
          </Button>
        </div>
        {error && <p className="text-xs font-bold text-sec-strong">{error}</p>}
      </div>
    );
  }
  return (
    <div className={className}>
      <SearchPicker
        label={label}
        placeholder="Ad, soyad ya da sicil"
        queryOf={employeePickerQuery}
        itemsOf={(data) => data?.items ?? []}
        renderItem={(item) => (
          <span className="flex w-full items-center justify-between gap-3">
            <span className="block truncate font-semibold">{employeeName(item)}</span>
            <span className="shrink-0 text-xs text-ink-muted">
              {item.code}
              {item.department?.name ? ` · ${item.department.name}` : ''}
            </span>
          </span>
        )}
        onPick={onChange}
        emptyText="Eşleşen personel yok"
        disabled={disabled}
        error={error}
      />
    </div>
  );
}
