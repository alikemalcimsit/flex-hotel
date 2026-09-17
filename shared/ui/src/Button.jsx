import { Icon } from './Icon.jsx';

/**
 * Görünüm Spark Admin'in `.btn-custom` ailesinden. Kırmızı markanın rengi
 * olduğu için birincil düğme koyu; kırmızı dolgu yalnızca `danger` (silme gibi
 * geri alınamaz işlem) — "Kaydet" ile "Sil" aynı görünmesin.
 *
 * `dangerSoft` tablo satırlarındaki silme düğmesi için: her satırda dolu
 * kırmızı düğme listeyi alarm ekranına çevirir; asıl uyarı onay diyaloğunda.
 */
const VARIANTS = {
  primary: 'border-ink bg-ink text-white hover:bg-black',
  secondary: 'border-black/[0.08] bg-surface-muted text-ink hover:border-black/[0.14] hover:bg-[#efefed]',
  outline: 'border-line-strong bg-surface text-ink hover:border-ink',
  danger: 'border-sec-strong bg-sec-strong text-white hover:border-sec-hover hover:bg-sec-hover',
  dangerSoft: 'border-sec-line bg-surface text-sec-strong hover:border-sec-strong hover:bg-danger-soft',
  ghost: 'border-transparent bg-transparent text-ink-muted hover:bg-black/[0.04] hover:text-ink',
};

const SIZES = {
  sm: 'gap-1.5 rounded-item px-3 py-1.5 text-xs',
  md: 'gap-2 rounded-control px-5 py-2.5 text-sm',
};

const ICON_SIZES = { sm: 'size-3.5', md: 'size-4' };

/**
 * Standart buton.
 * @param {{
 *   variant?: 'primary'|'secondary'|'outline'|'danger'|'dangerSoft'|'ghost',
 *   size?: 'sm'|'md',
 *   icon?: string,
 *   className?: string,
 * } & React.ButtonHTMLAttributes<HTMLButtonElement>} props
 */
export function Button({ variant = 'primary', size = 'md', icon, className = '', children, ...rest }) {
  return (
    <button
      className={`inline-flex items-center justify-center whitespace-nowrap border font-semibold leading-5 transition duration-200 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} className={`${ICON_SIZES[size]} shrink-0`} /> : null}
      {children}
    </button>
  );
}
