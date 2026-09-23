import { PERMISSION_VALUES, ROLES, defaultPermissionsForRole } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { cache } from '../../lib/cache.js';
import { writeWithEvents } from '../../lib/write.js';

/**
 * Rol → izin matrisi (modül 2 — RBAC).
 *
 * Etkin izinler otelin `RolePermission` satırlarından gelir; hiç satır yoksa
 * koddaki varsayılanlara (`DEFAULT_ROLE_PERMISSIONS`) düşülür. Matris kaydedilince
 * tüm roller için satır yazılır ve DB kaynak olur.
 *
 * Matris kaydedildiğinde katalogda olan izinler `Hotel.permissionCatalog`'a
 * yazılır. Sonradan eklenen bir izin (yeni modül) o listede yoktur; onun için
 * rolün varsayılanı geçerlidir. Böylece yeni modülün izni, matrisi daha önce
 * kaydetmiş otelde herkese kapalı kalmaz; yöneticinin bilerek kaldırdığı izin
 * de geri gelmez (o izin listededir, satırı yoktur).
 *
 * ADMIN hiçbir zaman satır tutmaz: çözüm her zaman ADMIN'e tüm izinleri verir —
 * matris ekranından yanlışlıkla yönetici kilitlenmesin.
 */

const MATRIX_CACHE_TTL_MS = 5 * 60_000;
const ADMIN_ROLE = 'ADMIN';

/** Anahtar formatı: `<alan>:<hotelId>:<detay>` (bkz. cache.js). */
const cacheKey = (hotelId) => `roles:${hotelId}:matrix`;

/** Katalogdan kaldırılmış (eskimiş) izinleri DB'den okurken süzmek için. */
const VALID_PERMISSIONS = new Set(PERMISSION_VALUES);

/**
 * Otelin rol→izin haritasını DB'den (yoksa varsayılanlardan) yükler.
 * ADMIN dahil edilmez.
 * @param {string} hotelId
 * @returns {Promise<Record<string, string[]>>}
 */
async function loadGrants(hotelId) {
  const [rows, hotel] = await Promise.all([
    prisma.rolePermission.findMany({ where: { hotelId }, select: { role: true, permission: true } }),
    prisma.hotel.findUnique({ where: { id: hotelId }, select: { permissionCatalog: true } }),
  ]);

  /** @type {Record<string, string[]>} */
  const map = {};
  for (const role of ROLES) {
    if (role !== ADMIN_ROLE) map[role] = [];
  }

  if (rows.length === 0) {
    for (const role of Object.keys(map)) map[role] = [...defaultPermissionsForRole(role)];
    return map;
  }

  for (const { role, permission } of rows) {
    if (role === ADMIN_ROLE || !VALID_PERMISSIONS.has(permission)) continue;
    (map[role] ??= []).push(permission);
  }

  // Matris kaydedildikten sonra kataloğa eklenen izinler: rolün varsayılanı.
  const decided = new Set(hotel?.permissionCatalog ?? []);
  for (const role of Object.keys(map)) {
    for (const permission of defaultPermissionsForRole(role)) {
      if (!decided.has(permission) && !map[role].includes(permission)) map[role].push(permission);
    }
  }
  return map;
}

/** Cache'li harita (istek başına DB'ye gidilmesin). */
function grantsMap(hotelId) {
  return cache.getOrSet(cacheKey(hotelId), () => loadGrants(hotelId), MATRIX_CACHE_TTL_MS);
}

/**
 * Bir rolün etkin izinleri. ADMIN → tüm izinler.
 * @param {string} hotelId
 * @param {string | null | undefined} role
 * @returns {Promise<string[]>}
 */
export async function resolveEffectivePermissions(hotelId, role) {
  if (role === ADMIN_ROLE) return [...PERMISSION_VALUES];
  const map = await grantsMap(hotelId);
  return map[role] ? [...map[role]] : [];
}

/**
 * Tüm roller için matris (ekran + /me). ADMIN satırı tüm izinlerle döner.
 * @param {string} hotelId
 * @returns {Promise<{ grants: Array<{ role: string, permissions: string[] }> }>}
 */
export async function getMatrix(hotelId) {
  const map = await grantsMap(hotelId);
  const grants = ROLES.map((role) => ({
    role,
    permissions: role === ADMIN_ROLE ? [...PERMISSION_VALUES] : [...(map[role] ?? [])],
  }));
  return { grants };
}

/** Denetim izine yazılabilir, karşılaştırılabilir biçim: `{ rol: sıralı izinler }`. */
function toAuditShape(grants) {
  const shape = {};
  for (const { role, permissions } of grants) {
    if (role === ADMIN_ROLE) continue;
    shape[role] = [...new Set(permissions)].filter((p) => VALID_PERMISSIONS.has(p)).sort();
  }
  return shape;
}

/**
 * Matrisi kaydeder: otelin tüm satırlarını silip gönderilenleri yazar. ADMIN
 * yok sayılır, geçersiz izinler süzülür. Cache geçersiz kılınır.
 * @param {string} hotelId
 * @param {{ grants: Array<{ role: string, permissions: string[] }> }} input
 * @returns {Promise<{ grants: Array<{ role: string, permissions: string[] }> }>}
 */
export async function setMatrix(hotelId, { grants }) {
  const before = await getMatrix(hotelId);

  await writeWithEvents(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { hotelId } });

    const rows = [];
    for (const { role, permissions } of grants) {
      if (role === ADMIN_ROLE) continue;
      for (const permission of new Set(permissions)) {
        if (VALID_PERMISSIONS.has(permission)) rows.push({ hotelId, role, permission });
      }
    }
    if (rows.length > 0) await tx.rolePermission.createMany({ data: rows });
    // Bu kayıtla karar verilmiş izinler (sonradan eklenenler varsayılana düşer).
    // Ham SQL: otel kartının `updatedAt`'i değişmesin — ayarlar ekranındaki
    // sürüm denetimi matris kaydı yüzünden "başkası değiştirdi" demesin.
    await tx.$executeRaw`UPDATE "Hotel" SET "permissionCatalog" = ${[...PERMISSION_VALUES]}::text[] WHERE "id" = ${hotelId}`;

    await recordAudit(tx, {
      hotelId,
      entity: 'RolePermission',
      entityId: hotelId,
      action: 'UPDATE',
      before: toAuditShape(before.grants),
      after: toAuditShape(grants),
    });
  });

  cache.invalidatePrefix(`roles:${hotelId}:`);
  return getMatrix(hotelId);
}
