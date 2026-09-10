import { useEffect, useRef } from 'react';

/**
 * Form ve onay diyaloglarının kabuğu.
 *
 * Esc ile kapanır, arka plan tıklaması kapatır, açıkken sayfa kaydırması durur
 * ve odak diyalogun içine alınır — form doldururken sekmeyle arkadaki tabloya
 * düşmek istemiyoruz.
 *
 * @param {{ open: boolean, title: string, onClose: () => void, children: React.ReactNode, footer?: React.ReactNode, size?: 'sm' | 'md' | 'lg' }} props
 */
export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Açılışta ilk odaklanabilir alana geç (klavyeyle kullanım).
    const firstField = panelRef.current?.querySelector('input, select, textarea, button');
    firstField?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${widths[size]} rounded-lg bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="rounded p-1 text-2xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
