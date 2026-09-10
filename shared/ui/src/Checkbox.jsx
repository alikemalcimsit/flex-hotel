/**
 * Etiketli onay kutusu.
 * @param {{ label: string, hint?: string, className?: string } & React.InputHTMLAttributes<HTMLInputElement>} props
 */
export function Checkbox({ label, hint, className = '', id, ...rest }) {
  const inputId = id ?? rest.name;
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      <input
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
        {...rest}
      />
      <label htmlFor={inputId} className="text-sm text-gray-700">
        {label}
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </label>
    </div>
  );
}
