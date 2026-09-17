import { useAuthStore } from '../store/auth.js';

/**
 * ⚠️ GEÇİCİ — arayüzde buton gizleme için rol → izin eşlemesi.
 *
 * Modül 2 (RBAC) gerçek matrisi sunucudan getirecek; o gün yalnızca
 * `ROLE_PERMISSIONS` kaynağı değişir, ekranlar `useCan` ile sormaya devam eder.
 * Bu bir güvenlik sınırı değil: yetkisiz kişinin görmemesi gereken düğmeyi
 * gizler, asıl kontrol sunucudadır. İzin adları backend
 * `hotel/backend/src/lib/permissions.js` içindeki `PERMISSIONS` ile birebir.
 */
export const PERMISSIONS = Object.freeze({
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',
  ROOMS_VIEW: 'rooms.view',
  ROOMS_MANAGE: 'rooms.manage',
  ROOMS_OPERATE: 'rooms.operate',
  MESSAGES_VIEW: 'messages.view',
  MESSAGES_REPLY: 'messages.reply',
  REQUESTS_VIEW: 'requests.view',
  REQUESTS_MANAGE: 'requests.manage',
  NOTIFICATIONS_VIEW: 'notifications.view',
  NOTIFICATIONS_MANAGE: 'notifications.manage',
  APPROVALS_VIEW: 'approvals.view',
  APPROVALS_DECIDE: 'approvals.decide',
});

export const ROLE_PERMISSIONS = Object.freeze({
  ADMIN: Object.values(PERMISSIONS),
  // Ön büro odaları görür, atar ve kat hizmeti durumunu işler; envanteri
  // (oda ekleme, arıza kaydı) yönetim değiştirir. Misafirle yazışma ve
  // istek takibi ön büronun asıl işidir. Misafire giden bildirimlerin
  // geçmişini görür ("onay e-postası gitti mi?"); şablon ve kanal ayarı yönetimde.
  FRONT_DESK: [
    PERMISSIONS.ROOMS_VIEW,
    PERMISSIONS.ROOMS_OPERATE,
    PERMISSIONS.MESSAGES_VIEW,
    PERMISSIONS.MESSAGES_REPLY,
    PERMISSIONS.REQUESTS_VIEW,
    PERMISSIONS.REQUESTS_MANAGE,
    PERMISSIONS.NOTIFICATIONS_VIEW,
  ],
});

/**
 * @returns {(permission: string) => boolean}
 */
export function useCan() {
  const role = useAuthStore((state) => state.user?.role);
  const granted = ROLE_PERMISSIONS[role] ?? [];
  return (permission) => granted.includes(permission);
}
