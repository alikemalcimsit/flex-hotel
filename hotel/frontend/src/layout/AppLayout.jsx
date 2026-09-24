import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useManualTaskBadge } from '../lib/actors.js';
import { useApprovalBadge } from '../lib/approvals.js';
import { useFrontOfficeBadges } from '../lib/frontOffice.js';
import { useHotelSettings } from '../lib/useHotel.js';
import { useAuthStore } from '../store/auth.js';
import { useUiStore } from '../store/ui.js';
import { ROLE_LABELS } from './navigation.js';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { useMediaQuery } from './useMediaQuery.js';

/** Tailwind'in `xl` kırılımı: bunun üstünde yan menü sabit, altında çekmece. */
const DESKTOP_QUERY = '(min-width: 80rem)';

/** Sekme başlığı; cevap bekleyen mesaj varsa önüne sayısı eklenir. */
const DOCUMENT_TITLE = 'FlexHotel';

/**
 * Panelin kabuğu — Spark Admin düzeni: koyu yan menü, yapışkan üst bar, açık
 * zeminde içerik.
 *
 * Dar ekranda yan menü çekmeceye döner. Kapalı çekmece `inert`: klavyeyle
 * görünmeyen bağlantılara düşülmez. Açıkken arkadaki sayfa `inert` olur, odak
 * menüye taşınır; Esc ya da gezinme çekmeceyi kapatıp odağı menü düğmesine
 * geri verir.
 */
export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const { isSidebarCollapsed, isMobileNavOpen, toggleSidebar, openMobileNav, closeMobileNav } = useUiStore();

  const menuButtonRef = useRef(null);
  const drawerFirstLinkRef = useRef(null);

  const hotelQuery = useHotelSettings();
  const frontOfficeBadges = useFrontOfficeBadges();
  const approvals = useApprovalBadge();
  const tasks = useManualTaskBadge();
  const badges = { ...frontOfficeBadges, approvals, tasks };
  const waitingCount = frontOfficeBadges.messages?.count ?? 0;

  // Panel başka sekmedeyken de "misafir yazdı" görülsün: sekme başlığında sayı.
  useEffect(() => {
    document.title = waitingCount > 0 ? `(${waitingCount}) ${DOCUMENT_TITLE}` : DOCUMENT_TITLE;
  }, [waitingCount]);
  useEffect(() => () => {
    document.title = DOCUMENT_TITLE;
  }, []);

  const isCollapsed = isDesktop && isSidebarCollapsed;
  const isDrawerOpen = !isDesktop && isMobileNavOpen;

  // Sayfa değişince ya da ekran genişleyince çekmece açık kalmasın.
  useEffect(() => {
    closeMobileNav();
  }, [pathname, isDesktop, closeMobileNav]);

  useEffect(() => {
    if (!isDrawerOpen) return undefined;

    drawerFirstLinkRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      closeMobileNav();
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isDrawerOpen, closeMobileNav]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-control focus:bg-ink focus:px-4 focus:py-2.5 focus:text-sm focus:font-bold focus:text-white"
      >
        İçeriğe geç
      </a>

      {isDrawerOpen && (
        <div aria-hidden="true" onClick={closeMobileNav} className="fixed inset-0 z-40 animate-fade-in bg-ink/50 backdrop-blur-[2px]" />
      )}

      <aside
        id="app-sidebar"
        aria-label="Yan menü"
        inert={!isDesktop && !isMobileNavOpen}
        className={`fixed inset-y-0 left-0 z-50 w-[17.5rem] transition-[transform,width] duration-300 ease-out xl:z-30 xl:translate-x-0 ${
          isCollapsed ? 'xl:w-[5.5rem]' : 'xl:w-[17.5rem]'
        } ${isDrawerOpen ? 'translate-x-0 shadow-float' : '-translate-x-full'}`}
      >
        <Sidebar
          ref={drawerFirstLinkRef}
          role={user?.role}
          permissions={permissions}
          hotel={hotelQuery.data}
          badges={badges}
          isCollapsed={isCollapsed}
          showClose={!isDesktop}
          onClose={() => {
            closeMobileNav();
            menuButtonRef.current?.focus();
          }}
        />
      </aside>

      <div
        inert={isDrawerOpen}
        className={`flex min-h-screen flex-col transition-[padding] duration-300 ease-out ${
          isCollapsed ? 'xl:pl-[5.5rem]' : 'xl:pl-[17.5rem]'
        }`}
      >
        <Topbar
          ref={menuButtonRef}
          user={user}
          roleLabel={ROLE_LABELS[user?.role]}
          approvals={approvals}
          isSidebarCollapsed={isSidebarCollapsed}
          isMobileNavOpen={isDrawerOpen}
          onToggleSidebar={toggleSidebar}
          onOpenMobileNav={openMobileNav}
          onLogout={handleLogout}
        />
        <main id="main-content" tabIndex={-1} className="flex-1 px-5 py-7 outline-none sm:px-8 sm:py-8 xl:px-10">
          <div className="mx-auto w-full max-w-[100rem]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
