/**
 * ⚠️ GEÇİCİ (STOPGAP) — GERÇEK YETKİ KONTROLÜ HENÜZ YOK.
 *
 * Modül 2 (Kullanıcı, rol, yetki — Ali Kemal) `shared/auth` içinde gerçek
 * JWT + RBAC'ı kurana kadar bu dosya izin kontrolünün *şeklini* sağlar ama
 * hiçbir şeyi engellemez. Kasıtlı olarak sahte bir kontrol yazılmadı: var
 * olmayan güvenliği varmış gibi göstermek, hiç olmamasından tehlikelidir.
 *
 * RBAC hazır olduğunda yapılacak tek şey: aşağıdaki `requirePermission`
 * gövdesini `shared/auth`'un gerçek hook'una devretmek. Route'lara dokunmaya
 * gerek kalmayacak — hepsi zaten izin adıyla işaretli.
 */

/**
 * Bu modülün ihtiyaç duyduğu izinler. Modül 2'nin rol→izin matrisi bu
 * katalogdan beslenecek; izin adları tek yerde tanımlı olsun diye burada.
 */
export const PERMISSIONS = Object.freeze({
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',

  /** Oda listesi, müsaitlik takvimi — görüntüleme. */
  ROOMS_VIEW: 'rooms.view',
  /** Envanter tanımı: oda ekleme/silme, bloklama. Yönetim işi. */
  ROOMS_MANAGE: 'rooms.manage',
  /** Günlük operasyon: oda atama, durum değiştirme. Ön büro ve kat hizmetleri. */
  ROOMS_OPERATE: 'rooms.operate',

  /** Misafir konuşmalarını okumak. */
  MESSAGES_VIEW: 'messages.view',
  /** Misafire yazmak, konuşmayı atamak/kapatmak/manuele almak. */
  MESSAGES_REPLY: 'messages.reply',
  /** Misafir isteklerini görmek. */
  REQUESTS_VIEW: 'requests.view',
  /** İstek açmak, atamak, durumunu değiştirmek (kat hizmetleri dahil). */
  REQUESTS_MANAGE: 'requests.manage',
});

let warned = false;

/**
 * Route'a gereken izni işaretler.
 * @param {string} permission `PERMISSIONS` içinden bir değer
 * @returns {(request: import('fastify').FastifyRequest) => Promise<void>} Fastify preHandler
 */
export function requirePermission(permission) {
  return async function permissionPreHandler(request) {
    // İz bırakır: audit log ve ileride gerçek kontrol bunu okuyacak.
    request.requiredPermission = permission;

    if (!warned) {
      warned = true;
      request.log.warn(
        { module: 'permissions' },
        'RBAC henüz aktif değil (modül 2 bekleniyor): tüm korumalı route\'lar şu an herkese açık.',
      );
    }

    // TODO(modül 2 / Ali Kemal): burası şuna dönecek —
    //   const { user } = await request.jwtVerify();
    //   await assertPermission(user, permission);  // shared/auth
  };
}
