import { Icon } from './Icon.jsx';

const TONES = {
  info: { icon: 'info', classes: 'border-info-line bg-info-soft text-info-ink' },
  success: { icon: 'checkCircle', classes: 'border-success-line bg-success-soft text-success-ink' },
  warning: { icon: 'alertTriangle', classes: 'border-warning-line bg-warning-soft text-warning-ink' },
  danger: { icon: 'alertCircle', classes: 'border-danger-line bg-danger-soft text-danger-ink' },
};

/**
 * Uyarı kutusu — Spark Admin'in `.alert-custom` ailesi.
 *
 * `danger` tonu `role="alert"` taşır: işlem başarısız olduğunda ekran okuyucu
 * beklemeden duyurur. Diğer tonlar işi bölmez. Renk tek başına anlam taşımaz;
 * her tonun kendi ikonu var.
 *
 * @param {{
 *   tone?: 'info'|'success'|'warning'|'danger',
 *   title?: string,
 *   action?: React.ReactNode,
 *   className?: string,
 *   children?: React.ReactNode,
 * }} props
 */
export function Alert({ tone = 'info', title, action, className = '', children }) {
  const { icon, classes } = TONES[tone] ?? TONES.info;

  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={`flex items-start gap-3 rounded-control border px-4 py-3.5 text-sm ${classes} ${className}`}
    >
      <Icon name={icon} className="mt-px size-[18px] shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={`${title ? 'mt-0.5' : ''} leading-relaxed`}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
