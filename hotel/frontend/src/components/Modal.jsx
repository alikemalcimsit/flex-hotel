import { useEffect, useId, useRef } from 'react';
import { Icon } from '@hotelos/ui';

const WIDTHS = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };

/**
 * Form ve onay diyaloglarının kabuğu — Spark Admin'in `.modal-content`'i.
 *
 * Esc ile kapanır, arka plan tıklaması kapatır, açıkken sayfa kaydırması durur
 * ve odak diyalogun içine alınır — form doldururken sekmeyle arkadaki tabloya
 * düşmek istemiyoruz. Kapanınca odak diyaloğu açan düğmeye geri döner.
 *
 * `onClose` bir ref'te tutulur: ebeveyn her çizimde yeni fonksiyon verse de
 * etki yeniden çalışıp odağı ilk alana geri atmaz (yazarken imleç kaçmasın).
 *
 * @param {{ open: boolean, title: string, onClose: () => void, children: React.ReactNode, footer?: React.ReactNode, size?: 'sm' | 'md' | 'lg' }} props
 */
export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  const panelRef = useRef(null);
  const bodyRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Açılışta ilk form alanına geç; alan yoksa (onay diyaloğu) ilk düğmeye.
    const firstField =
      bodyRef.current?.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ??
      panelRef.current?.querySelector('button:not([disabled])');
    firstField?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`my-auto w-full ${WIDTHS[size]} animate-pop-in rounded-card bg-surface shadow-float`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-5 sm:px-7">
          <h2 id={titleId} className="text-lg font-bold leading-snug text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="grid size-9 shrink-0 place-items-center rounded-item text-ink-muted transition-colors duration-200 hover:bg-black/[0.05] hover:text-ink"
          >
            <Icon name="close" className="size-5" />
          </button>
        </div>
        <div ref={bodyRef} className="px-6 py-6 sm:px-7">
          {children}
        </div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-3 rounded-b-card border-t border-line bg-surface-muted px-6 py-4 sm:px-7">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
