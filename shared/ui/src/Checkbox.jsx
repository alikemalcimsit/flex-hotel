/**
 * Etiketli onay kutusu — Spark Admin'in `.form-check-input-custom`'ı: tarayıcı
 * kutusu gizlenip yerine jetonlarla çizilen kutu, işaretliyken koyu zemin +
 * beyaz tik. Tik yalnızca işaretliyken görünür (`peer-checked`).
 *
 * @param {{ label: string, hint?: string, className?: string } & React.InputHTMLAttributes<HTMLInputElement>} props
 */
export function Checkbox({ label, hint, className = '', id, ...rest }) {
  const inputId = id ?? rest.name;
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={inputId}
          type="checkbox"
          className="peer size-[18px] cursor-pointer appearance-none rounded-[6px] border border-black/25 bg-surface transition duration-200 checked:border-ink checked:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
          {...rest}
        />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <label htmlFor={inputId} className="cursor-pointer text-sm font-medium text-ink">
        {label}
        {hint && <span className="mt-0.5 block text-xs font-normal text-ink-muted">{hint}</span>}
      </label>
    </div>
  );
}
