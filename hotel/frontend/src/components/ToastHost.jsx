import { Icon } from '@hotelos/ui';
import { useToastStore } from '../store/toast.js';

const VARIANTS = {
  success: { icon: 'checkCircle', iconClass: 'bg-success-soft text-success-ink' },
  error: { icon: 'alertCircle', iconClass: 'bg-danger-soft text-danger-ink' },
  info: { icon: 'info', iconClass: 'bg-info-soft text-info-ink' },
};

/**
 * Bildirimlerin basıldığı tek yer; uygulamanın kökünde bir kez render edilir.
 *
 * Canlı bölge boşken de sayfada durur: ekran okuyucular yalnızca önceden var
 * olan bölgeye eklenen metni güvenilir biçimde duyurur.
 */
export function ToastHost() {
  const { toasts, dismiss } = useToastStore();

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-3 sm:left-auto sm:right-6 sm:bottom-6 sm:w-96"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const variant = VARIANTS[toast.variant] ?? VARIANTS.info;
        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex animate-pop-in items-start gap-3 rounded-panel border border-line bg-surface p-3.5 pr-2.5 shadow-float"
          >
            <span className={`grid size-9 shrink-0 place-items-center rounded-item ${variant.iconClass}`}>
              <Icon name={variant.icon} className="size-[18px]" />
            </span>
            <span className="flex-1 self-center text-sm font-semibold leading-snug text-ink">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Bildirimi kapat"
              className="grid size-8 shrink-0 place-items-center rounded-item text-ink-muted transition-colors duration-200 hover:bg-black/[0.05] hover:text-ink"
            >
              <Icon name="close" className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
