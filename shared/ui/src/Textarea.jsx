import { CONTROL_CLASS, ERROR_CLASS, LABEL_CLASS, controlBorder } from './styles.js';

/**
 * Etiketli çok satırlı metin alanı.
 * @param {{ label?: string, error?: string, className?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>} props
 */
export function Textarea({ label, error, className = '', id, rows = 3, ...rest }) {
  const textareaId = id ?? rest.name;
  const errorId = error && textareaId ? `${textareaId}-error` : undefined;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {label && (
        <label htmlFor={textareaId} className={LABEL_CLASS}>
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={`${CONTROL_CLASS} ${controlBorder(Boolean(error))} resize-y`}
        {...rest}
      />
      {error && (
        <span id={errorId} className={ERROR_CLASS}>
          {error}
        </span>
      )}
    </div>
  );
}
