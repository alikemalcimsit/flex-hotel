import { apiPatch } from '../lib/api.js';
import { useAuthStore } from '../store/auth.js';

/**
 * Kullanıcı tercihini (arayüz dili, gösterim para birimi) kaydeder: oturumdaki kullanıcı hemen güncellenir,
 * sunucu cevabıyla kesinleşir; hata olursa eski değere döner ve hata yukarı atılır.
 * @param {{ locale?: string, displayCurrency?: string | null }} patch
 */
export async function savePreferences(patch) {
  const previous = useAuthStore.getState().user;
  if (!previous) return;
  useAuthStore.getState().updateUser(patch);
  try {
    const data = await apiPatch('/auth/me/preferences', patch);
    if (data?.user) useAuthStore.getState().updateUser({ locale: data.user.locale, displayCurrency: data.user.displayCurrency ?? null });
  } catch (error) {
    useAuthStore.getState().updateUser({ locale: previous.locale, displayCurrency: previous.displayCurrency ?? null });
    throw error;
  }
}
