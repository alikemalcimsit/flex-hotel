import { Icon } from './Icon.jsx';
import { CONTROL_CLASS, CONTROL_CLASS_COMPACT, ERROR_CLASS, LABEL_CLASS, controlBorder } from './styles.js';

/**
 * Etiketli açılır liste. Tarayıcının kendi oku yerine ikon setinden bir ok —
 * işletim sistemine göre farklı çizilmesin, diğer alanlarla aynı dursun.
 *
 * `compact` tablo satırı içindeki seçiciler için küçük ölçü. (Ad `size`
 * değil: `size` yerel `<select>` özniteliği, görünen satır sayısı.)
 *
 * Seçenek `disabled` taşıyabilir: o anki durumdan geçilemeyen değer listede
 * görünür ama seçilemez (neden seçilemediği etiketinde yazmalı).
 *
 * @param {{ label?: string, error?: string, compact?: boolean, className?: string, options: Array<{ value: string, label: string, disabled?: boolean }> } & React.SelectHTMLAttributes<HTMLSelectElement>} props
 */
export function Select({ label, error, compact = false, className = '', id, options, ...rest }) {
  const selectId = id ?? rest.name;
  const errorId = error && selectId ? `${selectId}-error` : undefined;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {label && (
        <label htmlFor={selectId} className={LABEL_CLASS}>
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={`${compact ? `${CONTROL_CLASS_COMPACT} pr-8` : `${CONTROL_CLASS} pr-10`} ${controlBorder(Boolean(error))} cursor-pointer appearance-none`}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon
          name="chevronDown"
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted ${
            compact ? 'right-2.5 size-3.5' : 'right-3.5 size-4'
          }`}
        />
      </div>
      {error && (
        <span id={errorId} className={ERROR_CLASS}>
          {error}
        </span>
      )}
    </div>
  );
}
