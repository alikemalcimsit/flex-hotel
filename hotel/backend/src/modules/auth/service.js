import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db.js';
import { ForbiddenError, UnauthorizedError } from '../../lib/errors.js';
import { roleForHotel } from '../../lib/memberships.js';
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
  return { id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive, locale: user.locale ?? 'tr', displayCurrency: user.displayCurrency ?? null };
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
 * Oturum için hâlâ geçerli kullanıcı (`/me`), oturumun otelindeki rolüyle. Pasife alınmış / silinmişse ya da o otele
 * erişimi kalmadıysa 401.
 * @param {string} hotelId
 * @param {string} userId
 * @returns {Promise<import('@prisma/client').User>}
 */
export async function findSessionUser(hotelId, userId) {
  const user = await prisma.user.findFirst({ where: { id: userId, isActive: true } });
  if (!user) throw new UnauthorizedError();
  const role = await roleForHotel(prisma, user, hotelId);
  if (!role) throw new UnauthorizedError();
  return { ...user, role };
}

/**
 * Oturumun oteli (üst bar, panelin önbellek ayrımı).
 * @param {string} hotelId
 */
export async function sessionHotel(hotelId) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId }, select: { id: true, name: true, code: true, groupId: true, group: { select: { name: true } } } });
  if (!hotel) throw new UnauthorizedError();
  return { id: hotel.id, name: hotel.name, code: hotel.code, groupId: hotel.groupId, groupName: hotel.group?.name ?? null };
}

/**
 * Kişinin erişebildiği otel sayısı (ana otel + erişimler). 1'den fazlaysa panel otel seçiciyi gösterir.
 * @param {string} userId
 */
export async function countUserHotels(userId) {
  return 1 + (await prisma.userHotel.count({ where: { userId, hotel: { deletedAt: null } } }));
}

const HOTEL_CHOICE_SELECT = Object.freeze({ id: true, name: true, code: true, groupId: true, group: { select: { name: true } } });

/**
 * Otel seçicinin listesi: ana otel önce, sonra erişimler ada göre (sayfa sınırlı, aramalı).
 * @param {string} userId
 * @param {string} currentHotelId
 * @param {{ search?: string, limit: number }} query
 */
export async function listUserHotels(userId, currentHotelId, { search, limit }) {
  const user = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { hotelId: true, role: true } });
  if (!user) throw new UnauthorizedError();
  const filter = search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] } : {};
  const [home, memberships] = await Promise.all([
    prisma.hotel.findFirst({ where: { id: user.hotelId, ...filter }, select: HOTEL_CHOICE_SELECT }),
    prisma.userHotel.findMany({
      where: { userId, hotel: { deletedAt: null, ...filter } },
      select: { role: true, hotel: { select: HOTEL_CHOICE_SELECT } },
      orderBy: [{ hotel: { name: 'asc' } }, { hotelId: 'asc' }],
      take: limit + 1,
    }),
  ]);
  const row = (hotel, role, isHome) => ({ id: hotel.id, name: hotel.name, code: hotel.code, groupId: hotel.groupId, groupName: hotel.group?.name ?? null, role, isHome, isCurrent: hotel.id === currentHotelId });
  return {
    items: [...(home ? [row(home, user.role, true)] : []), ...memberships.slice(0, limit).map((membership) => row(membership.hotel, membership.role, false))],
    hasMore: memberships.length > limit,
  };
}

/**
 * Başka otele geçiş (modül 63). Yenileme token'ı kişinin kendisinin ve geçerli olmalı (401); hedef otele erişimi
 * olmalı (403 — otel yoksa da aynı cevap: var olup olmadığı sızmaz). Eski token iptal edilir, hedef otel için yenisi
 * verilir.
 *
 * @param {string} userId
 * @param {{ hotelId: string, refreshToken: string }} input
 */
export async function switchHotel(userId, { hotelId, refreshToken }) {
  return writeWithEvents(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, isActive: true } });
    if (!user) throw new UnauthorizedError('Hesap pasif');
    const existing = await tx.refreshToken.findFirst({ where: { token: refreshToken, userId } });
    if (!existing || existing.expiresAt <= new Date()) throw new UnauthorizedError('Oturum süresi doldu, tekrar giriş yapın');
    const hotel = await tx.hotel.findFirst({ where: { id: hotelId }, select: { id: true } });
    const role = hotel ? await roleForHotel(tx, user, hotelId) : null;
    if (!role) throw new ForbiddenError('Bu otele erişiminiz yok');

    await tx.refreshToken.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    const token = newRefreshTokenValue();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await tx.refreshToken.create({ data: { hotelId, userId, token, expiresAt } });
    return { user, hotelId, role, token, expiresAt };
  });
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
 *
 * Oturum token'ın otelinde sürer; kişinin o otele erişimi kaldırıldıysa ana oteline döner (modül 63: kişi atılmaz,
 * yalnız o otelden çıkar).
 * @param {string} oldToken
 * @returns {Promise<{ user: import('@prisma/client').User, hotelId: string, role: string, token: string, expiresAt: Date }>}
 */
export async function rotateRefreshToken(oldToken) {
  return writeWithEvents(async (tx) => {
    const existing = await tx.refreshToken.findFirst({ where: { token: oldToken }, include: { user: true } });
    if (!existing || existing.expiresAt <= new Date()) {
      throw new UnauthorizedError('Oturum süresi doldu, tekrar giriş yapın');
    }
    if (!existing.user || !existing.user.isActive) throw new UnauthorizedError('Hesap pasif');

    await tx.refreshToken.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });

    const sessionRole = await roleForHotel(tx, existing.user, existing.hotelId);
    const hotelId = sessionRole ? existing.hotelId : existing.user.hotelId;
    const role = sessionRole ?? existing.user.role;
    const token = newRefreshTokenValue();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await tx.refreshToken.create({ data: { hotelId, userId: existing.userId, token, expiresAt } });

    return { user: existing.user, hotelId, role, token, expiresAt };
  });
}

/**
 * Çıkış: verilen refresh token'ı iptal eder (idempotent — yoksa sessiz geçer).
 * @param {string} token
 */
export async function revokeRefreshToken(token) {
  await prisma.refreshToken.updateMany({ where: { token }, data: { deletedAt: new Date() } });
}

/**
 * Kullanıcının arayüz dili ve gösterim para birimi (modül 60). Kendi kaydı; izin gerekmez.
 * @param {string} hotelId @param {string} userId @param {{ locale?: string, displayCurrency?: string | null }} input
 */
export async function updatePreferences(hotelId, userId, input) {
  const data = {
    ...(input.locale ? { locale: input.locale } : {}),
    ...(input.displayCurrency !== undefined ? { displayCurrency: input.displayCurrency ?? null } : {}),
  };
  // Tercih kişinin kendisinindir, otelin değil: zincir üyesi başka bir otelde (erişimle) de değiştirebilmeli (modül 63);
  // `User.hotelId` ana oteldir. O otele erişimin hâlâ sürdüğünü önce `findSessionUser` denetler (erişimi kalkmış oturum
  // tercih yazamaz).
  const session = await findSessionUser(hotelId, userId);
  const updated = await prisma.user.update({ where: { id: userId }, data });
  return toUserDto({ ...updated, role: session.role });
}
