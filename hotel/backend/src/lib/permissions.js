import { PERMISSIONS, defaultPermissionsForRole } from '@hotelos/hotel-contracts';
import { ForbiddenError, UnauthorizedError } from './errors.js';

/**
 * RBAC izin kontrolü (modül 2).
 *
 * İzin kataloğu tek kaynakta: `@hotelos/hotel-contracts/permissions.js`. Sunucu
 * ve tarayıcı aynı adları kullanır. Burada yalnızca sunucu tarafı kontrol var.
 *
 * Kimlik ve izinler `app.js`'in `onRequest` hook'unda çözülüp `request.auth`'a
 * konur (`{ userId, email, hotelId, role, permissions }`). Buradaki guard'lar
 * yalnızca o hazır listeyi kontrol eder — böylece izin çözümü (DB, cache'li)
 * istek başına bir kez yapılır ve `lib` katmanı `modules`'e bağımlı olmaz.
 *
 * **Guard'lar `preValidation`'da çalışır, `preHandler`'da değil.** Fastify şema
 * doğrulamasını `preValidation` ile `preHandler` arasında yapar; guard
 * `preHandler`'da kalırsa anonim/yetkisiz istek bozuk gövdeyle 401/403 yerine
 * alan bazlı 400 alır — korumalı ucun şeması herkese görünür. Doğru kalıp:
 *
 *   const guard = (permission) => ({ preValidation: [withHotelContext, requirePermission(permission)] });
 *
 * `app.js` her route kaydında `assertGuardsBeforeValidation`'ı çalıştırır:
 * guard `preHandler`'a yazılmışsa uygulama açılmaz (sessiz gerileme olmasın).
 * Gövdeye bağlı ek yetki (`assertRequestPermission`) handler içinde, doğrulanmış
 * gövdeyle çalışmaya devam eder.
 */

export { PERMISSIONS };

/** Kimlik/yetki guard'ı işareti (bkz. `assertGuardsBeforeValidation`). */
const AUTH_GUARD = Symbol('hotelos.authGuard');

/**
 * Bir hook fonksiyonunu kimlik/yetki guard'ı olarak işaretler. İşaretli
 * fonksiyon route'un `preHandler`'ında bulunursa route kaydı hata verir.
 *
 * @template {Function} T
 * @param {T} fn
 * @returns {T}
 */
export function markAuthGuard(fn) {
  Object.defineProperty(fn, AUTH_GUARD, { value: true });
  return fn;
}

/**
 * @param {unknown} fn
 * @returns {boolean}
 */
export function isAuthGuard(fn) {
  return typeof fn === 'function' && /** @type {any} */ (fn)[AUTH_GUARD] === true;
}

/**
 * `onRoute` denetimi: kimlik/yetki guard'ı `preHandler`'a yazılmışsa route
 * kaydını reddeder. Hata açılışta (testte, `npm run dev`'de) hemen görünür;
 * çalışma anında sessizce "önce doğrulama, sonra 401" davranışına dönülmez.
 *
 * @param {{ method: string | string[], url: string, preHandler?: unknown }} routeOptions
 */
export function assertGuardsBeforeValidation(routeOptions) {
  const misplaced = [routeOptions.preHandler].flat().filter(isAuthGuard);
  if (misplaced.length === 0) return;
  const method = [routeOptions.method].flat().join(',');
  const names = misplaced.map((fn) => fn.name || 'anonim').join(', ');
  throw new Error(
    `${method} ${routeOptions.url}: kimlik/yetki guard'ı (${names}) preHandler'da. ` +
      "Şema doğrulamasından önce çalışması için preValidation'a taşıyın: " +
      '{ preValidation: [withHotelContext, requirePermission(...)] } (bkz. lib/permissions.js).',
  );
}

/**
 * Yalnızca "giriş yapılmış olmalı" diyen guard (belirli bir izin gerektirmeyen
 * uçlar için: `/auth/me`, `/auth/logout`). `preValidation`'da kullanılır.
 * @param {import('fastify').FastifyRequest} request
 */
export async function requireAuth(request) {
  if (!request.auth) throw new UnauthorizedError();
}
markAuthGuard(requireAuth);

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
 * İkisi de şema doğrulamasından önce döner (guard `preValidation`'da).
 *
 * @param {string} permission `PERMISSIONS` içinden bir değer
 * @returns {(request: import('fastify').FastifyRequest) => Promise<void>} Fastify preValidation guard'ı
 */
export function requirePermission(permission) {
  return markAuthGuard(async function permissionGuard(request) {
    // Denetim izi için: audit ve modül 10 zincir ekranı bunu okur.
    request.requiredPermission = permission;

    const auth = request.auth;
    if (!auth) throw new UnauthorizedError();
    if (!auth.permissions.includes(permission)) {
      throw new ForbiddenError();
    }
  });
}

/**
 * İzinlerden **biri** yeterli (ör. kur listesini ödeme alan da, kasayı gören
 * de, kuru giren de okur). Denetim izine ilk izin yazılır.
 *
 * @param {...string} permissions `PERMISSIONS` içinden değerler
 * @returns {(request: import('fastify').FastifyRequest) => Promise<void>} Fastify preValidation guard'ı
 */
export function requireAnyPermission(...permissions) {
  return markAuthGuard(async function anyPermissionGuard(request) {
    request.requiredPermission = permissions[0];
    const auth = request.auth;
    if (!auth) throw new UnauthorizedError();
    if (!permissions.some((permission) => auth.permissions.includes(permission))) throw new ForbiddenError();
  });
}

/**
 * Gövdeye bağlı yetki (ör. rezervasyonda elle fiyat): route'un izni yetmez,
 * istek belirli bir şey isterse ek izin gerekir. `request.auth`'taki etkin
 * izinlerden okunur — `requirePermission` ile aynı kaynak. Handler içinde,
 * doğrulanmış gövdeyle çağrılır (route guard'ı zaten 401'i vermiştir).
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {string} permission `PERMISSIONS` içinden bir değer
 * @param {string} [message] kullanıcıya gösterilecek sebep
 */
export function assertRequestPermission(request, permission, message) {
  if (!request.auth) throw new UnauthorizedError();
  if (!request.auth.permissions.includes(permission)) throw new ForbiddenError(message, { permission });
}
