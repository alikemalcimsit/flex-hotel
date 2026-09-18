import { create } from 'zustand';
import { apiPost } from '../lib/api.js';

const STORAGE_KEY = 'hotelos.auth';

/** Boş oturum. */
const EMPTY = { user: null, permissions: [], accessToken: null, refreshToken: null };

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      user: parsed.user ?? null,
      permissions: parsed.permissions ?? [],
      accessToken: parsed.accessToken ?? null,
      refreshToken: parsed.refreshToken ?? null,
    };
  } catch {
    return { ...EMPTY };
  }
}

function persist(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

/**
 * Oturum durumu (modül 2 — gerçek giriş).
 *
 * Backend `/auth/login` yanıtı `{ user, permissions, accessToken, refreshToken }`
 * saklanır. `permissions` sunucudan gelir — arayüzdeki menü/buton gizleme buna
 * bakar (asıl kontrol yine sunucuda). Token yenileme `lib/api.js`'te.
 */
export const useAuthStore = create((set, get) => ({
  ...readStored(),

  /** Giriş/yenileme sonrası tam oturumu yazar. */
  setSession: (session) => {
    const next = {
      user: session.user ?? null,
      permissions: session.permissions ?? [],
      accessToken: session.accessToken ?? null,
      refreshToken: session.refreshToken ?? null,
    };
    persist(next);
    set(next);
  },

  logout: () => {
    const { refreshToken } = get();
    // Sunucuda refresh token'ı iptal et (best-effort — ağ hatası oturumu yine kapatır).
    if (refreshToken) apiPost('/auth/logout', { refreshToken }).catch(() => {});
    localStorage.removeItem(STORAGE_KEY);
    set({ ...EMPTY });
  },
}));
