/**
 * Etiketli açılır liste.
 * @param {{ label?: string, error?: string, className?: string, options: Array<{ value: string, label: string }> } & React.SelectHTMLAttributes<HTMLSelectElement>} props
 */
export function Select({ label, error, className = '', id, options, ...rest }) {
  const selectId = id ?? rest.name;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={`rounded-md border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
          error ? 'border-red-500' : 'border-gray-300'
        }`}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
