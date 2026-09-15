import { useId } from 'react';

/**
 * Kart — Spark Admin'in `.card`'ı: 24px yarıçap, kenarsız, yumuşak gölge.
 *
 * Başlık verilirse kart bir `<section>` olur ve başlığıyla etiketlenir; ekran
 * okuyucu kullanıcısı bölümler arasında başlıkla gezinebilir.
 *
 * @param {{
 *   title?: string,
 *   description?: string,
 *   actions?: React.ReactNode,
 *   className?: string,
 *   children: React.ReactNode,
 * }} props
 */
export function Card({ title, description, actions, className = '', children }) {
  const titleId = useId();
  const classes = `rounded-card bg-surface p-6 shadow-card sm:p-7 ${className}`;

  if (!title) {
    return <div className={classes}>{children}</div>;
  }

  return (
    <section aria-labelledby={titleId} className={classes}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-[1.1rem] font-bold leading-snug text-ink">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
