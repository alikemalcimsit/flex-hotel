/**
 * Hızlı seçim çipleri — tek dokunuşla doldurulan sık değerler (iptal sebebi,
 * uyandırma saati). Seçili çipe tekrar basmak seçimi kaldırır.
 *
 * @param {{
 *   label: string,
 *   options: Array<{ value: string, label: string }>,
 *   value: string,
 *   onChange: (value: string) => void,
 *   disabled?: boolean,
 *   className?: string,
 * }} props
 */
export function ChoiceChips({ label, options, value, onChange, disabled = false, className = '' }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} role="group" aria-label={label}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(selected ? '' : option.value)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 disabled:opacity-50 ${
              selected
                ? 'border-ink bg-ink text-white'
                : 'border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
