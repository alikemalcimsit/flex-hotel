import { PERMISSIONS, defaultPermissionsForRole } from '@hotelos/hotel-contracts';
import { ForbiddenError, UnauthorizedError } from './errors.js';

/**
 * RBAC izin kontrolü (modül 2).
 *
 * İzin kataloğu tek kaynakta: `@hotelos/hotel-contracts/permissions.js`. Sunucu
 * ve tarayıcı aynı adları kullanır. Burada yalnızca sunucu tarafı kontrol var.
 *
 * Kimlik ve izinler `app.js`'in `onRequest` hook'unda çözülüp `request.auth`'a
 * konur (`{ userId, email, hotelId, role, permissions }`). Bu preHandler yalnızca
 * o hazır listeyi kontrol eder — böylece izin çözümü (DB, cache'li) istek başına
 * bir kez yapılır ve `lib` katmanı `modules`'e bağımlı olmaz.
 */

export { PERMISSIONS };

/**
 * Yalnızca "giriş yapılmış olmalı" diyen preHandler (belirli bir izin
 * gerektirmeyen uçlar için: `/auth/me`, `/auth/logout`).
 * @param {import('fastify').FastifyRequest} request
 */
export async function requireAuth(request) {
  if (!request.auth) throw new UnauthorizedError();
}

/**
 * Bir rolün **varsayılan** (koddaki) izinleri. Gerçek/etkin izinler DB matrisinden
 * gelir (`modules/roles`); bu yalnızca DB henüz düzenlenmemişken ve socket'in
 * personel-zili filtresi gibi hotelId'siz bağlamlarda kullanılır.
 *
 * @param {string | null | undefined} role
 * @returns {readonly string[]}
 */
export function permissionsForRole(role) {
  return defaultPermissionsForRole(role);
}

/**
 * Route'un gerektirdiği izni zorlar.
 * - Kimlik yoksa (token yok/geçersiz) 401.
 * - Rolün izni yetmiyorsa 403.
 *
 * @param {string} permission `PERMISSIONS` içinden bir değer
 * @returns {(request: import('fastify').FastifyRequest) => Promise<void>} Fastify preHandler
 */
export function requirePermission(permission) {
  return async function permissionPreHandler(request) {
    // Denetim izi için: audit ve modül 10 zincir ekranı bunu okur.
    request.requiredPermission = permission;

    const auth = request.auth;
    if (!auth) throw new UnauthorizedError();
    if (!auth.permissions.includes(permission)) {
      throw new ForbiddenError();
    }
  };
}

/**
 * Gövdeye bağlı yetki (ör. rezervasyonda elle fiyat): route'un izni yetmez,
 * istek belirli bir şey isterse ek izin gerekir. `request.auth`'taki etkin
 * izinlerden okunur — `requirePermission` ile aynı kaynak.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {string} permission `PERMISSIONS` içinden bir değer
 * @param {string} [message] kullanıcıya gösterilecek sebep
 */
export function assertRequestPermission(request, permission, message) {
  if (!request.auth) throw new UnauthorizedError();
  if (!request.auth.permissions.includes(permission)) throw new ForbiddenError(message, { permission });
}
