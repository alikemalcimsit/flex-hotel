import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@hotelos/ui';
import { initialsFor } from './initials.js';

/**
 * Üst bardaki kullanıcı menüsü — Spark Admin'in profil açılır menüsü.
 *
 * Şablonda "Hesabım / Ayarlar / Ekranı kilitle" vardı; panelde bu ekranların
 * karşılığı yok, işe yaramayan bağlantı konmadı. Menüde gerçekte olan: kim
 * olarak girildiği ve çıkış.
 *
 * Klavye: açılınca odak ilk maddeye gider; Esc kapatıp düğmeye döner; Tab ile
 * dışarı çıkınca ya da dışarı tıklanınca kapanır.
 *
 * @param {{ name: string, email?: string, roleLabel?: string, onLogout: () => void }} props
 */
export function UserMenu({ name, email, roleLabel, onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const firstItemRef = useRef(null);
  const menuId = useId();
  const buttonId = useId();

  useEffect(() => {
    if (!isOpen) return undefined;
    firstItemRef.current?.focus();

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setIsOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-2.5 rounded-control py-1 pl-1 pr-2 transition-colors duration-200 hover:bg-black/[0.04]"
      >
        <span
          aria-hidden="true"
          className="grid size-[38px] place-items-center rounded-control bg-ink text-sm font-bold text-white"
        >
          {initialsFor(name)}
        </span>
        <span className="hidden text-left md:block">
          <span className="block max-w-[11rem] truncate text-sm font-bold leading-tight text-ink">{name}</span>
          {roleLabel && <span className="block text-xs leading-tight text-ink-muted">{roleLabel}</span>}
        </span>
        <span className="sr-only md:hidden">{name}</span>
        <Icon
          name="chevronDown"
          className={`size-4 text-ink-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-30 mt-2 w-64 animate-pop-in rounded-panel border border-line bg-surface py-2 shadow-float">
          <div className="border-b border-line px-5 pb-3 pt-1.5">
            <p className="truncate text-sm font-bold text-ink">{name}</p>
            {email && <p className="truncate text-xs text-ink-muted">{email}</p>}
            {roleLabel && (
              <p className="mt-2 inline-flex rounded-full bg-black/[0.05] px-2 py-0.5 text-xs font-bold text-ink-soft">
                {roleLabel}
              </p>
            )}
          </div>
          <div id={menuId} role="menu" aria-labelledby={buttonId} className="pt-1.5">
            <button
              ref={firstItemRef}
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm font-semibold text-sec-strong transition-colors duration-150 hover:bg-danger-soft focus:bg-danger-soft focus:outline-none"
            >
              <Icon name="logout" className="size-[18px]" />
              Çıkış yap
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
