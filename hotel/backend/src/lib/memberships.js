import { prisma } from '../db.js';
import { createReadCache } from './read-cache.js';

/**
 * Otel erişimi (modül 63): bir kullanıcının ana oteli dışındaki otellerde, o otele özgü rolü (`UserHotel`).
 *
 * Kimlik doğrulama (her istek, soket bağlantısı, token yenileme), personel kimliği (`lib/staff.js`) ve zincir
 * konsolu aynı çözümü kullanır: rol, token'ın söylediği değil veritabanındaki erişimdir. Erişim kaldırılınca ya da rolü
 * değişince en geç önbellek ömrü kadar sonra (aynı süreçte hemen: değişiklik önbelleği siler) etkili olur.
 *
 * `lib` katmanında: `app.js` ve `lib/staff.js` modüllere bağımlı olmasın.
 */

const MEMBERSHIP_TTL_MS = 30_000;
const MEMBERSHIP_MAX_ENTRIES = 20_000;
const membershipCache = createReadCache({ ttlMs: MEMBERSHIP_TTL_MS, maxEntries: MEMBERSHIP_MAX_ENTRIES });

const key = (userId, hotelId) => `${userId}:${hotelId}`;

/**
 * Kullanıcının bir otele (ana oteli DIŞINDA) erişim rolü; erişim yoksa, kullanıcı pasif / silinmişse `null`.
 * Önbellekli: her istekte çağrılır.
 *
 * @param {string} userId
 * @param {string} hotelId
 * @returns {Promise<string | null>}
 */
export function membershipRole(userId, hotelId) {
  return membershipCache.get(key(userId, hotelId), async () => {
    const row = await prisma.userHotel.findFirst({
      where: { userId, hotelId, user: { isActive: true, deletedAt: null } },
      select: { role: true },
    });
    return row?.role ?? null;
  });
}

/**
 * Erişim token'ının o anki rolü: ana otelin token'ında rol token'dan (15 dk ömürlü), başka otelin token'ında her seferinde
 * erişimden okunur; erişim yoksa `null`. HTTP isteği (`app.js`) ve soket bağlantısı (`server.js`) aynı kuralı kullanır.
 * Ana otel bilgisi olmayan eski token'lar ana otelindir.
 *
 * @param {{ userId: string, hotelId: string, homeHotelId?: string, role: string }} payload
 * @returns {Promise<string | null>}
 */
export async function sessionRole(payload) {
  const homeHotelId = payload.homeHotelId ?? payload.hotelId;
  return homeHotelId === payload.hotelId ? payload.role : membershipRole(payload.userId, payload.hotelId);
}

/**
 * Kullanıcının bir oteldeki rolü (ana otelse kaydın rolü). Önbelleksiz: yazma yollarında (oturum açma, otel geçişi,
 * token yenileme) kullanılır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | import('@prisma/client').PrismaClient} client
 * @param {{ id: string, hotelId: string, role: string }} user aktif kullanıcı
 * @param {string} hotelId
 * @returns {Promise<string | null>}
 */
export async function roleForHotel(client, user, hotelId) {
  if (user.hotelId === hotelId) return user.role;
  const row = await client.userHotel.findFirst({ where: { userId: user.id, hotelId }, select: { role: true } });
  return row?.role ?? null;
}

/**
 * Erişim değiştiğinde (verildi, rolü değişti, kaldırıldı) önbellekten düşürür.
 * @param {string} userId
 * @param {string} hotelId
 */
export function invalidateMembership(userId, hotelId) {
  membershipCache.delete(key(userId, hotelId));
}

/** Testler için. */
export function clearMembershipCache() {
  membershipCache.clear();
}
