import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { writeWithEvents } from '../../lib/write.js';

/**
 * Kimlik doğrulama servisi (modül 2).
 *
 * Erişim token'ı (JWT) route'ta imzalanır — imza anahtarı Fastify eklentisinde
 * (`app.jwt`). Burada parola doğrulama ve **refresh token** yaşam döngüsü var:
 * refresh token rastgele bir dizedir, DB'de saklanır; yenilemede döndürülür
 * (rotation), çıkışta iptal edilir (soft-delete).
 */

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_TTL_DAYS = 30;
const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Kullanıcı yoksa da sabit bir hash'le karşılaştırma yapılır: yanıt süresi
 * "kullanıcı var mı" bilgisini sızdırmasın (enumeration).
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-never-matches', 10);

/** Girişte/`/me`'de dönen kullanıcı görünümü — parola hash'i asla sızmaz. */
export function toUserDto(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive };
}

function newRefreshTokenValue() {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * E-posta + şifreyle kimlik doğrular. Başarısızsa 401 (kullanıcının var olup
 * olmadığını sızdırmamak için mesaj hep aynı). Pasif kullanıcı giremez.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<import('@prisma/client').User>}
 */
export async function authenticate(email, password) {
  const user = await prisma.user.findFirst({ where: { email: email.toLowerCase(), isActive: true } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !ok) throw new UnauthorizedError('E-posta veya şifre hatalı');
  return user;
}

/**
 * Oturum için hâlâ geçerli kullanıcı (`/me`). Pasife alınmış/silinmişse 401.
 * @param {string} hotelId
 * @param {string} userId
 * @returns {Promise<import('@prisma/client').User>}
 */
export async function findSessionUser(hotelId, userId) {
  const user = await prisma.user.findFirst({ where: { id: userId, hotelId, isActive: true } });
  if (!user) throw new UnauthorizedError();
  return user;
}

/**
 * Yeni refresh token üretir ve saklar.
 * @param {string} hotelId
 * @param {string} userId
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function issueRefreshToken(hotelId, userId) {
  const token = newRefreshTokenValue();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await prisma.refreshToken.create({ data: { hotelId, userId, token, expiresAt } });
  return { token, expiresAt };
}

/**
 * Refresh token'ı doğrular ve döndürür (rotation): eskiyi iptal eder, yenisini
 * verir. Böylece sızmış eski token tekrar kullanılamaz. Geçersiz/süresi dolmuş/
 * iptal edilmiş token → 401.
 *
 * Soft-delete filtresi sayesinde iptal edilmiş token `findFirst`'te görünmez.
 * @param {string} oldToken
 * @returns {Promise<{ user: import('@prisma/client').User, token: string, expiresAt: Date }>}
 */
export async function rotateRefreshToken(oldToken) {
  return writeWithEvents(async (tx) => {
    const existing = await tx.refreshToken.findFirst({ where: { token: oldToken }, include: { user: true } });
    if (!existing || existing.expiresAt <= new Date()) {
      throw new UnauthorizedError('Oturum süresi doldu, tekrar giriş yapın');
    }
    if (!existing.user || !existing.user.isActive) throw new UnauthorizedError('Hesap pasif');

    await tx.refreshToken.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

    const token = newRefreshTokenValue();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await tx.refreshToken.create({ data: { hotelId: existing.hotelId, userId: existing.userId, token, expiresAt } });

    return { user: existing.user, token, expiresAt };
  });
}

/**
 * Çıkış: verilen refresh token'ı iptal eder (idempotent — yoksa sessiz geçer).
 * @param {string} token
 */
export async function revokeRefreshToken(token) {
  await prisma.refreshToken.updateMany({ where: { token }, data: { deletedAt: new Date() } });
}
