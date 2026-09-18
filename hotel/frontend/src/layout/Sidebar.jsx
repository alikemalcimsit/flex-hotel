import { forwardRef, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '@hotelos/ui';
import { Logo } from '../components/Logo.jsx';
import { visibleSections } from './navigation.js';

const LINK_BASE =
  'group flex w-full items-center gap-3 rounded-control text-sm font-semibold transition-colors duration-200';
const LINK_IDLE = 'text-sidebar-muted hover:bg-white/[0.06] hover:text-sidebar-ink';
const LINK_ACTIVE = 'bg-white text-ink';

/**
 * Yan menü — Spark Admin'in koyu `sidebar-custom`'ı, FlexAI renkleriyle.
 *
 * Etkin sayfa beyaz hap, ikonu kırmızı. Alt sayfası olan maddeler açılır
 * liste; bulunulan bölüm kendiliğinden açık gelir. Daraltılmış rayda yalnızca
 * bölüm ikonları kalır — alt sayfalara bölüm içindeki sekmelerden geçilir.
 *
 * Mesajlar ve İstekler maddelerinde sayı rozeti var (cevap bekleyen
 * konuşma, açık istek). Süresi aşılmış iş varsa rozet kırmızıdır; daraltılmış
 * rayda yalnızca nokta kalır. Sayının anlamı ekran okuyucuya cümle olarak
 * okunur.
 *
 * Konumlandırma (masaüstünde sabit, dar ekranda çekmece) `AppLayout`'ta.
 *
 * @param {{
 *   role?: string,
 *   hotel?: { name?: string, code?: string } | null,
 *   badges?: Record<string, { count: number, urgent: boolean, label: string } | null>,
 *   isCollapsed: boolean,
 *   onNavigate?: () => void,
 *   onClose?: () => void,
 *   showClose?: boolean,
 * }} props
 */
export const Sidebar = forwardRef(function Sidebar(
  { role, permissions, hotel, badges = {}, isCollapsed, onNavigate, onClose, showClose = false },
  firstLinkRef,
) {
  const sections = visibleSections(role, permissions);
  const badgeFor = (item) => (item.badge ? badges[item.badge] ?? null : null);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-ink">
      <div
        className={`flex h-[74px] shrink-0 items-center border-b border-sidebar-line xl:h-[86px] ${
          isCollapsed ? 'justify-center px-3' : 'justify-between px-7'
        }`}
      >
        <NavLink
          ref={firstLinkRef}
          to="/"
          onClick={onNavigate}
          aria-label="FlexHotel — panel ana sayfası"
          className="rounded-item"
        >
          <Logo compact={isCollapsed} className="text-[1.6rem]" />
        </NavLink>
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Menüyü kapat"
            className="grid size-10 place-items-center rounded-control text-sidebar-muted transition-colors duration-200 hover:bg-white/[0.08] hover:text-sidebar-ink"
          >
            <Icon name="close" className="size-5" />
          </button>
        )}
      </div>

      {hotel?.name && !isCollapsed && (
        <div className="mx-5 mt-5 flex items-center gap-3 rounded-panel border border-sidebar-line bg-white/[0.04] px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-item bg-sec/15 text-sec">
            <Icon name="building" className="size-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-sidebar-ink">{hotel.name}</span>
            {hotel.code && <span className="block text-xs text-sidebar-muted">Kod: {hotel.code}</span>}
          </span>
        </div>
      )}

      <nav aria-label="Ana menü" className="flex-1 overflow-y-auto overscroll-contain px-4 py-5">
        {sections.map((section) => (
          <div key={section.title} className="mb-5 last:mb-0">
            {isCollapsed ? (
              <div aria-hidden="true" className="mx-auto mb-3 h-px w-8 bg-sidebar-line" />
            ) : (
              <p className="mb-2 px-3 text-[0.7rem] font-bold uppercase tracking-[0.12em] text-sidebar-muted/80">
                {section.title}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {section.items.map((item) => (
                <li key={item.to}>
                  {item.children && !isCollapsed ? (
                    <NavGroup item={item} onNavigate={onNavigate} />
                  ) : (
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      title={isCollapsed ? [item.label, badgeFor(item)?.label].filter(Boolean).join(' — ') : undefined}
                      className={({ isActive }) =>
                        `${LINK_BASE} ${isCollapsed ? 'justify-center px-0 py-3' : 'px-3 py-2.5'} ${
                          isActive ? LINK_ACTIVE : LINK_IDLE
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span className="relative shrink-0">
                            <Icon name={item.icon} className={`size-5 ${isActive ? 'text-sec' : ''}`} />
                            {isCollapsed && <CollapsedDot badge={badgeFor(item)} />}
                          </span>
                          <span className={isCollapsed ? 'sr-only' : 'flex-1 truncate'}>{item.label}</span>
                          <NavBadge badge={badgeFor(item)} isActive={isActive} isCollapsed={isCollapsed} />
                        </>
                      )}
                    </NavLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
});

/** Rozette gösterilecek en büyük sayı; üstü "99+" olur. */
const MAX_BADGE_COUNT = 99;

/**
 * Menü maddesinin sayı rozeti. Sayı sıfırsa çizilmez; anlamı ekran okuyucuya
 * tam cümleyle verilir (görünen sayı `aria-hidden`).
 *
 * @param {{ badge: { count: number, urgent: boolean, label: string } | null, isActive: boolean, isCollapsed: boolean }} props
 */
function NavBadge({ badge, isActive, isCollapsed }) {
  if (!badge || badge.count <= 0) return null;
  if (isCollapsed) return <span className="sr-only">{badge.label}</span>;

  const tone = badge.urgent
    ? 'bg-sec-strong text-white'
    : isActive
      ? 'bg-ink text-white'
      : 'bg-white/[0.14] text-sidebar-ink';
  return (
    <>
      <span
        aria-hidden="true"
        title={badge.label}
        className={`ml-auto min-w-6 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[0.7rem] font-bold tabular-nums leading-4 ${tone}`}
      >
        {badge.count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : badge.count}
      </span>
      <span className="sr-only">{badge.label}</span>
    </>
  );
}

/** Daraltılmış rayda ikonun köşesindeki nokta. */
function CollapsedDot({ badge }) {
  if (!badge || badge.count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={`absolute -right-1 -top-1 size-2.5 rounded-full ring-2 ring-sidebar ${
        badge.urgent ? 'bg-sec' : 'bg-sidebar-ink'
      }`}
    />
  );
}

/**
 * Alt sayfaları olan menü maddesi. Açık/kapalı kullanıcının elinde; bölüme
 * her girişte (adres değişince) yeniden açılır.
 *
 * @param {{ item: { label: string, to: string, icon: string, children: Array<{ label: string, to: string, icon?: string }> }, onNavigate?: () => void }} props
 */
function NavGroup({ item, onNavigate }) {
  const { pathname } = useLocation();
  const isInside = pathname === item.to || pathname.startsWith(`${item.to}/`);
  const [isOpen, setIsOpen] = useState(isInside);
  const listId = `nav-${item.to.replace(/\W+/g, '')}`;

  useEffect(() => {
    if (isInside) setIsOpen(true);
  }, [isInside]);

  return (
    <>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={listId}
        onClick={() => setIsOpen((open) => !open)}
        className={`${LINK_BASE} px-3 py-2.5 ${isInside ? 'text-sidebar-ink' : LINK_IDLE}`}
      >
        <Icon name={item.icon} className={`size-5 shrink-0 ${isInside ? 'text-sec' : ''}`} />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <Icon
          name="chevronDown"
          className={`size-4 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <ul id={listId} hidden={!isOpen} className="mt-1 flex flex-col gap-0.5 border-l border-sidebar-line pl-3 ml-[1.35rem]">
        {item.children.map((child) => (
          <li key={child.to}>
            <NavLink
              to={child.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `${LINK_BASE} rounded-item px-3 py-2 text-[0.85rem] ${isActive ? LINK_ACTIVE : LINK_IDLE}`
              }
            >
              {child.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </>
  );
}
