/**
 * Etiketli metin girişi.
 * @param {{ label?: string, error?: string, className?: string } & React.InputHTMLAttributes<HTMLInputElement>} props
 */
export function Input({ label, error, className = '', id, ...rest }) {
  const inputId = id ?? rest.name;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
          error ? 'border-red-500' : 'border-gray-300'
        }`}
        {...rest}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
