import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '@hotelos/ui';

/**
 * Bölüm sayfalarının sekmeleri (Odalar, Ayarlar). Her sekme ayrı bir adres —
 * WAI-ARIA sekme deseni değil, bağlantılı gezinme: geri tuşu ve yer imi çalışır.
 * Etkin sekme `aria-current="page"` taşır (NavLink).
 *
 * Dar ekranda şerit yatay kayar; sayfa açılınca etkin sekme görünür alana
 * getirilir, yoksa sağda kalan sekme yarım görünür ve seçili olduğu anlaşılmaz.
 *
 * @param {{ label: string, tabs: Array<{ to: string, label: string, icon?: string }> }} props
 */
export function TabNav({ label, tabs }) {
  const scrollerRef = useRef(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const scroller = scrollerRef.current;
    const active = scroller?.querySelector('[aria-current="page"]');
    if (!scroller || !active) return;
    const overflowLeft = active.offsetLeft - scroller.scrollLeft;
    const overflowRight = active.offsetLeft + active.offsetWidth - (scroller.scrollLeft + scroller.clientWidth);
    if (overflowLeft < 0) scroller.scrollLeft += overflowLeft;
    else if (overflowRight > 0) scroller.scrollLeft += overflowRight;
  }, [pathname]);

  return (
    <nav ref={scrollerRef} aria-label={label} className="relative -mx-1 overflow-x-auto px-1 pb-1">
      <ul className="inline-flex min-w-max gap-1 rounded-control border border-line bg-surface p-1 shadow-soft">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                `inline-flex items-center gap-2 whitespace-nowrap rounded-item px-4 py-2 text-sm font-semibold transition-colors duration-200 ${
                  isActive ? 'bg-ink text-white' : 'text-ink-muted hover:bg-black/[0.04] hover:text-ink'
                }`
              }
            >
              {tab.icon && <Icon name={tab.icon} className="size-4" />}
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
