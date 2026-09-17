import { Icon } from './Icon.jsx';

/**
 * Boş durum — liste boşken ne olduğunu ve varsa sıradaki adımı söyler.
 *
 * @param {{
 *   icon?: string,
 *   title: string,
 *   description?: string,
 *   action?: React.ReactNode,
 *   className?: string,
 * }} props
 */
export function EmptyState({ icon = 'inbox', title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center px-6 py-10 text-center ${className}`}>
      <span className="mb-4 grid size-14 place-items-center rounded-panel bg-black/[0.04] text-ink-muted">
        <Icon name={icon} className="size-7" />
      </span>
      <p className="text-base font-bold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
