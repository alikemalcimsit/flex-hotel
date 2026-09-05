import { create } from 'zustand';

const STORAGE_KEY = 'hotelos.auth';

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Oturum durumu. Şimdilik sahte giriş; modül 2'de gerçek API'ye bağlanır.
 */
export const useAuthStore = create((set) => ({
  user: readStored(),
  login: (user) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    set({ user });
  },
  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ user: null });
  },
}));
