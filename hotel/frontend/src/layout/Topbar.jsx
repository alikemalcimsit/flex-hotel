import { forwardRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '@hotelos/ui';
import { AlertBell } from './AlertBell.jsx';
import { findLocation } from './navigation.js';
import { UserMenu } from './UserMenu.jsx';
import { useFullscreen } from './useFullscreen.js';

// Görünürlük (`inline-flex` / `hidden`) her düğmede ayrıca verilir: taban
// sınıfta `inline-flex` olsaydı `hidden` ile çakışır, kırılımda gizlenmezdi.
const ICON_BUTTON =
  'size-[42px] shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink shadow-soft transition duration-200 hover:bg-line';

/**
 * Üst bar — Spark Admin'in `.navbar-custom`'ı: yapışkan, yarı saydam, bulanık
 * zemin.
 *
 * Şablondan alınmayanlar: "Oluştur" hızlı eylemleri ve ortadaki genel arama.
 * İkisinin de henüz panelde karşılığı yok; sahte veriyle doldurmak yerine hiç
 * konmadı. Ortada arama yerine konum satırı var: bölüm › sayfa › sekme.
 * Bildirim listesi şablondaki gibi zilde: personele düşen gerçek uyarılar
 * (modül 9, `AlertBell`).
 *
 * @param {{
 *   user: { name?: string, email?: string } | null,
 *   roleLabel?: string,
 *   approvals?: { count: number, urgent: boolean, label: string } | null,
 *   isSidebarCollapsed: boolean,
 *   isMobileNavOpen: boolean,
 *   onToggleSidebar: () => void,
 *   onOpenMobileNav: () => void,
 *   onLogout: () => void,
 * }} props
 */
/**
 * Bekleyen onay sayacı (modül 11). Yalnızca onayları görebilen kişiye ve
 * bekleyen iş varsa görünür; süresi yaklaşan varsa kırmızı. Tıklayınca
 * bekleyenler listesine gider. Sayı socket haberiyle güncellenir
 * (`useApprovalBadge`).
 *
 * @param {{ approvals: { count: number, urgent: boolean, label: string } | null }} props
 */
function ApprovalCounter({ approvals }) {
  if (!approvals || approvals.count <= 0) return null;
  const tone = approvals.urgent
    ? 'border-sec/40 bg-danger-soft text-sec-strong hover:bg-danger-soft/80'
    : 'border-warning-ink/30 bg-warning-soft text-warning-ink hover:bg-warning-soft/80';
  return (
    <Link
      to="/onaylar/bekleyen"
      title={approvals.label}
      aria-label={approvals.label}
      className={`inline-flex h-[42px] shrink-0 items-center gap-2 rounded-control border px-3 text-sm font-bold shadow-soft transition duration-200 ${tone}`}
    >
      <Icon name="checkCheck" className="size-[18px]" />
      <span>{approvals.count}</span>
      <span className="hidden sm:inline">onay</span>
    </Link>
  );
}

export const Topbar = forwardRef(function Topbar(
  { user, roleLabel, approvals = null, isSidebarCollapsed, isMobileNavOpen, onToggleSidebar, onOpenMobileNav, onLogout },
  menuButtonRef,
) {
  const { pathname } = useLocation();
  const location = findLocation(pathname);
  const fullscreen = useFullscreen();

  const crumbs = location
    ? [location.section, location.item.label, location.child?.label].filter(Boolean)
    : [];

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-black/5 bg-canvas/85 px-5 py-4 backdrop-blur-md sm:px-8 xl:px-10 xl:py-5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Menüyü aç"
          aria-controls="app-sidebar"
          aria-expanded={isMobileNavOpen}
          className={`${ICON_BUTTON} inline-flex xl:hidden`}
        >
          <Icon name="menu" className="size-5" />
        </button>
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={isSidebarCollapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
          title={isSidebarCollapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
          aria-controls="app-sidebar"
          aria-expanded={!isSidebarCollapsed}
          className={`${ICON_BUTTON} hidden xl:inline-flex`}
        >
          <Icon name={isSidebarCollapsed ? 'sidebarExpand' : 'sidebarCollapse'} className="size-5" />
        </button>

        {crumbs.length > 0 && (
          <nav aria-label="Konum" className="min-w-0">
            <ol className="flex items-center gap-2 text-sm">
              {crumbs.map((crumb, index) => {
                const isLast = index === crumbs.length - 1;
                return (
                  <li
                    key={crumb}
                    aria-current={isLast ? 'page' : undefined}
                    className={`flex min-w-0 items-center gap-2 ${isLast ? '' : 'hidden sm:flex'}`}
                  >
                    <span className={`truncate ${isLast ? 'font-bold text-ink' : 'text-ink-muted'}`}>{crumb}</span>
                    {!isLast && <Icon name="chevronRight" className="size-3.5 shrink-0 text-ink-muted/60" />}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <ApprovalCounter approvals={approvals} />
        <AlertBell />
        {fullscreen.isSupported && (
          <button
            type="button"
            onClick={fullscreen.toggle}
            aria-pressed={fullscreen.isFullscreen}
            aria-label="Tam ekran"
            title={fullscreen.isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
            className={`${ICON_BUTTON} hidden sm:inline-flex`}
          >
            <Icon name={fullscreen.isFullscreen ? 'minimize' : 'maximize'} className="size-[18px]" />
          </button>
        )}
        <UserMenu name={user?.name ?? user?.email ?? 'Kullanıcı'} email={user?.email} roleLabel={roleLabel} onLogout={onLogout} />
      </div>
    </header>
  );
});
