import { create } from 'zustand';

const STORAGE_KEY = 'hotelos.ui';

function readSidebarCollapsed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).sidebarCollapsed === true : false;
  } catch {
    return false;
  }
}

/**
 * Kabuğun görünüm durumu.
 *
 * - `isSidebarCollapsed`: masaüstünde yan menünün ikon rayına daraltılması.
 *   Kullanıcının tercihi; sayfa yenilense de korunur.
 * - `isMobileNavOpen`: dar ekranda çekmecenin açık olması. Kalıcı değil — panel
 *   her açılışta çekmece kapalı başlamalı.
 */
export const useUiStore = create((set, get) => ({
  isSidebarCollapsed: readSidebarCollapsed(),
  isMobileNavOpen: false,

  toggleSidebar: () => {
    const next = !get().isSidebarCollapsed;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sidebarCollapsed: next }));
    } catch {
      // Depolama kapalıysa (gizli pencere) tercih yalnızca bu oturumda geçerli olur.
    }
    set({ isSidebarCollapsed: next });
  },
  openMobileNav: () => set({ isMobileNavOpen: true }),
  closeMobileNav: () => set({ isMobileNavOpen: false }),
}));
