import { create } from 'zustand';
import { apiPost } from '../lib/api.js';

const STORAGE_KEY = 'hotelos.auth';

/** Boş oturum. */
const EMPTY = { user: null, permissions: [], hotel: null, hotelCount: 1, accessToken: null, refreshToken: null };

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      user: parsed.user ?? null,
      permissions: parsed.permissions ?? [],
      hotel: parsed.hotel ?? null,
      hotelCount: parsed.hotelCount ?? 1,
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
 * Backend `/auth/login` yanıtı `{ user, permissions, hotel, hotelCount, accessToken, refreshToken }`
 * saklanır. `hotel`: oturumun açık olduğu otel (zincirde otel seçiciyle değişir, modül 63);
 * `hotelCount`: kişinin erişebildiği otel sayısı (1'den fazlaysa üst barda seçici çıkar).
 * `permissions` sunucudan gelir ve açık otelin rol matrisindendir — arayüzdeki
 * menü/buton gizleme buna bakar (asıl kontrol yine sunucuda). Token yenileme
 * `lib/api.js`'te.
 */
export const useAuthStore = create((set, get) => ({
  ...readStored(),

  /** Giriş/yenileme sonrası tam oturumu yazar. */
  setSession: (session) => {
    const next = {
      user: session.user ?? null,
      permissions: session.permissions ?? [],
      hotel: session.hotel ?? null,
      hotelCount: session.hotelCount ?? 1,
      accessToken: session.accessToken ?? null,
      refreshToken: session.refreshToken ?? null,
    };
    persist(next);
    set(next);
  },

  /**
   * Oturumdaki kullanıcıyı yeni bir kopyayla günceller (ör. dil / gösterim para birimi tercihi — modül 60);
   * token'lar ve izinler aynı kalır. Oturum yoksa bir şey yapmaz.
   * @param {Record<string, unknown>} patch
   */
  updateUser: (patch) => {
    const { user, permissions, hotel, hotelCount, accessToken, refreshToken } = get();
    if (!user) return;
    // Oturumun oteli de saklanır (modül 63): yoksa sayfa yenilenince üst bar ve otel seçici oteli kaybeder.
    const next = { user: { ...user, ...patch }, permissions, hotel, hotelCount, accessToken, refreshToken };
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
