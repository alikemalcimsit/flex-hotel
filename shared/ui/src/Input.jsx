import { CONTROL_CLASS, ERROR_CLASS, LABEL_CLASS, controlBorder } from './styles.js';

/**
 * Etiketli metin girişi.
 *
 * Hata varken alan `aria-invalid` taşır ve hata metni `aria-describedby` ile
 * alana bağlanır: ekran okuyucu alana gelince hatayı da okur.
 *
 * `trailing` alanın sağ iç kenarına küçük bir denetim koyar (örn. şifreyi
 * göster düğmesi); yazı onun altına kaymasın diye sağ boşluk açılır.
 *
 * @param {{ label?: string, error?: string, trailing?: React.ReactNode, className?: string } & React.InputHTMLAttributes<HTMLInputElement>} props
 */
export function Input({ label, error, trailing, className = '', id, ...rest }) {
  const inputId = id ?? rest.name;
  const errorId = error && inputId ? `${inputId}-error` : undefined;

  const input = (
    <input
      id={inputId}
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
      className={`${CONTROL_CLASS} ${controlBorder(Boolean(error))} ${trailing ? 'pr-12' : ''}`}
      {...rest}
    />
  );

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {label && (
        <label htmlFor={inputId} className={LABEL_CLASS}>
          {label}
        </label>
      )}
      {trailing ? (
        <div className="relative">
          {input}
          <div className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</div>
        </div>
      ) : (
        input
      )}
      {error && (
        <span id={errorId} className={ERROR_CLASS}>
          {error}
        </span>
      )}
    </div>
  );
}
