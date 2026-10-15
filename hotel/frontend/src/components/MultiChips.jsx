/**
 * Çoklu seçim çipleri: seçili olanlar koyu. Boş seçim "hepsi" demekse
 * `allLabel` ilk çip olarak durur ve seçimi temizler (promosyon koşulları,
 * prim kuralının oda tipi süzgeci).
 *
 * @param {{ label: string, options: Array<{ value: string, label: string }>, values: string[], onChange: (values: string[]) => void, allLabel?: string, disabled?: boolean, error?: string }} props
 */
export function MultiChips({ label, options, values, onChange, allLabel, disabled = false, error }) {
  const toggle = (value) => (values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const chip = (selected) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 disabled:opacity-50 ${
      selected ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink'
    }`;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {allLabel && (
          <button type="button" aria-pressed={values.length === 0} disabled={disabled} onClick={() => onChange([])} className={chip(values.length === 0)}>
            {allLabel}
          </button>
        )}
        {options.map((option) => (
          <button key={option.value} type="button" aria-pressed={values.includes(option.value)} disabled={disabled} onClick={() => onChange(toggle(option.value))} className={chip(values.includes(option.value))}>
            {option.label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs font-semibold text-sec-strong">{error}</p>}
    </div>
  );
}
