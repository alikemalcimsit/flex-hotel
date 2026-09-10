/**
 * Etiketli çok satırlı metin alanı.
 * @param {{ label?: string, error?: string, className?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>} props
 */
export function Textarea({ label, error, className = '', id, rows = 3, ...rest }) {
  const textareaId = id ?? rest.name;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label htmlFor={textareaId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        rows={rows}
        className={`rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
          error ? 'border-red-500' : 'border-gray-300'
        }`}
        {...rest}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
