import { create } from 'zustand';

/**
 * Kullanıcıya işlem sonucunu bildiren kısa mesajlar.
 *
 * Zustand seçildi çünkü oturum durumu da (`store/auth.js`) zaten burada;
 * ekranların bildirim için ayrı bir context sarmalayıcısı kurmasına gerek yok.
 */

const AUTO_DISMISS_MS = 4000;

let nextId = 0;

export const useToastStore = create((set, get) => ({
  toasts: [],

  /**
   * @param {{ message: string, variant?: 'success' | 'error' | 'info', durationMs?: number }} toast
   */
  push: ({ message, variant = 'info', durationMs = AUTO_DISMISS_MS }) => {
    const id = ++nextId;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    if (durationMs > 0) {
      setTimeout(() => get().dismiss(id), durationMs);
    }
    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** @param {string} message */
export const toastSuccess = (message) => useToastStore.getState().push({ message, variant: 'success' });

/** Hatalar daha uzun durur: kullanıcı okuyup ne yapacağına karar vermeli. */
export const toastError = (message) => useToastStore.getState().push({ message, variant: 'error', durationMs: 7000 });
