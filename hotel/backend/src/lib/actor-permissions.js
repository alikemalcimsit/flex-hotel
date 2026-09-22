import { prisma } from '../db.js';
import { AppError } from './errors.js';
import { permissionsForRole } from './permissions.js';
import { currentStaffCached } from './staff.js';

/**
 * İsteği yapan personelin **rolüne** göre izin denetimi.
 *
 * Route seviyesindeki `requirePermission` modül 2'ye (gerçek RBAC) kadar
 * yalnızca iz bırakıyor. Bazı yetkiler ise istek gövdesine bağlı (ör.
 * rezervasyonda elle fiyat): düğmeyi gizlemek yetmez, sunucu da reddetmeli.
 * Bu yardımcı geçici rol → izin eşlemesini (`permissionsForRole`) kullanır;
 * kimlik şimdilik `x-actor` (bkz. `lib/staff.js`). Modül 2 geldiğinde
 * değişecek tek şey kimliğin kaynağı ve eşlemenin kaynağı.
 *
 * Personel kaydı bulunamazsa izin yoktur.
 *
 * @param {string} hotelId
 * @param {string} permission
 * @returns {Promise<boolean>}
 */
export async function actorHasPermission(hotelId, permission) {
  const staff = await currentStaffCached(prisma, hotelId);
  if (!staff) return false;
  return permissionsForRole(staff.role).includes(permission);
}

/**
 * @param {string} hotelId
 * @param {string} permission
 * @param {string} message kullanıcıya gösterilecek sebep
 */
export async function assertActorPermission(hotelId, permission, message) {
  if (!(await actorHasPermission(hotelId, permission))) {
    throw new AppError(message, { statusCode: 403, code: 'FORBIDDEN', details: { permission } });
  }
}
