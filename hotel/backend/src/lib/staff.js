import { currentActor } from '@hotelos/core';
import { ValidationError } from './errors.js';
import { createReadCache } from './read-cache.js';

/**
 * Personel dizini — atama seçicileri ve "bana atanan" görünümü için.
 *
 * ⚠️ GEÇİCİ kimlik kaynağı: modül 2 (gerçek giriş) gelene kadar "şu anki
 * personel", isteğin `x-actor` başlığındaki e-postadır (bkz. `app.js`).
 * Modül 2 geldiğinde değişecek tek yer `currentStaff`: kimliği JWT'den okur.
 * Kullanıcı tablosunun yönetimi (ekleme, rol, pasife alma) modül 2'nin işi;
 * burada yalnızca okunur.
 */

const STAFF_SELECT = Object.freeze({ id: true, name: true, email: true, role: true });

/**
 * İsteği yapan personel; bulunamazsa `null` ("bana atanan" boş döner, işlem
 * yine de yapılır — denetim izinde e-posta zaten var).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} client
 * @param {string} hotelId
 */
export async function currentStaff(client, hotelId) {
  const actor = currentActor();
  if (!actor || !actor.includes('@')) return null;
  return client.user.findFirst({
    where: { hotelId, email: actor.toLowerCase(), isActive: true },
    select: STAFF_SELECT,
  });
}

/** Kimlik önbelleğinin ömrü: pasife alınan personel en geç bu kadar sonra "bana atanan"dan düşer. */
const STAFF_CACHE_TTL_MS = 60_000;
const STAFF_CACHE_MAX_ENTRIES = 5000;
const staffCache = createReadCache({ ttlMs: STAFF_CACHE_TTL_MS, maxEntries: STAFF_CACHE_MAX_ENTRIES });

/**
 * `currentStaff`'ın önbellekli hâli — yalnızca okuma uçları (rozet özeti,
 * "bana atanan" listesi) için.
 *
 * Yan menü rozeti her panelde dakikada bir ve her değişiklikte sorulur; her
 * seferinde kullanıcı tablosuna gitmek 2500 panelde gereksiz yük. Yazma
 * işlemleri (atama, başlatma) önbelleksiz `currentStaff` kullanmaya devam eder.
 *
 * @param {import('@prisma/client').PrismaClient} client
 * @param {string} hotelId
 */
export function currentStaffCached(client, hotelId) {
  const actor = currentActor();
  if (!actor || !actor.includes('@')) return Promise.resolve(null);
  return staffCache.get(`${hotelId}:${actor.toLowerCase()}`, () => currentStaff(client, hotelId));
}

/** Testler için: personel önbelleğini boşaltır. */
export function clearStaffCache() {
  staffCache.clear();
}

/**
 * Atanacak kişi bu otelin aktif personeli mi?
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} client
 * @param {string} hotelId
 * @param {string | null | undefined} userId
 * @returns {Promise<{ id: string, name: string } | null>}
 */
export async function assertAssignableStaff(client, hotelId, userId) {
  if (!userId) return null;
  const user = await client.user.findFirst({
    where: { id: userId, hotelId, isActive: true },
    select: STAFF_SELECT,
  });
  if (!user) throw new ValidationError('Seçilen personel bulunamadı ya da pasif', { field: 'assignedToId' });
  return user;
}

/**
 * Atanabilir personel listesi (ada göre).
 *
 * @param {import('@prisma/client').PrismaClient} client
 * @param {string} hotelId
 */
export function listAssignableStaff(client, hotelId) {
  return client.user.findMany({
    where: { hotelId, isActive: true },
    select: STAFF_SELECT,
    orderBy: [{ name: 'asc' }],
  });
}
