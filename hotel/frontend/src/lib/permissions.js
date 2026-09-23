import { PERMISSIONS } from '@hotelos/hotel-contracts';
import { useAuthStore } from '../store/auth.js';

/**
 * Arayüzde buton/menü gizleme için izin kontrolü (modül 2 — RBAC).
 *
 * İzin kataloğu tek kaynakta: `@hotelos/hotel-contracts`. Giriş yapan kullanıcının
 * **etkin izinleri** sunucudan gelir ve oturum store'unda tutulur; `useCan` onu
 * okur. Bu görsel bir kolaylık — asıl yetki kontrolü sunucuda (`requirePermission`).
 */
export { PERMISSIONS };

/**
 * @returns {(permission: string) => boolean}
 */
export function useCan() {
  const granted = useAuthStore((state) => state.permissions);
  const set = granted ?? [];
  return (permission) => set.includes(permission);
}
