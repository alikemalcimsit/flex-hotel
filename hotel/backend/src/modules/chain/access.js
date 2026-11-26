import { CHAIN_MAX_HOTELS, CHAIN_MAX_MEMBERSHIPS_PER_USER, roleInHotel } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { ConflictError, UnauthorizedError } from '../../lib/errors.js';
import { resolveEffectivePermissions } from '../roles/service.js';

/**
 * Zincir konsolunda "kim, hangi otelde, hangi izinle" çözümü (modül 63).
 *
 * İstek hangi otelde açılmış olursa olsun (token'daki otel), başka bir otelin verisine dokunan her işlem kişinin O
 * OTELDEKİ rolüne ve o otelin rol matrisine bakar: ana otelde yönetici olmak, erişimi olmayan otelin rakamını açmaz.
 */

/**
 * İsteği yapan kişi: ana oteli, rolü ve bütün otel erişimleri (kişi başına sınırlı).
 *
 * @param {{ userId: string, hotelId: string }} auth `request.auth`
 * @returns {Promise<{ id: string, email: string, name: string, hotelId: string, role: string, currentHotelId: string,
 *   memberships: Array<{ hotelId: string, role: string }> }>}
 */
export async function loadActor(auth) {
  const user = await prisma.user.findFirst({
    where: { id: auth.userId, isActive: true },
    select: {
      id: true,
      email: true,
      name: true,
      hotelId: true,
      role: true,
      hotels: { select: { hotelId: true, role: true }, take: CHAIN_MAX_MEMBERSHIPS_PER_USER },
    },
  });
  if (!user) throw new UnauthorizedError();
  const { hotels, ...rest } = user;
  return { ...rest, currentHotelId: auth.hotelId, memberships: hotels };
}

/**
 * Kişinin bir oteldeki rolü ve o otelin matrisine göre izinleri.
 * @param {Awaited<ReturnType<typeof loadActor>>} actor
 * @param {string} hotelId
 */
export async function accessIn(actor, hotelId) {
  const role = roleInHotel(actor, actor.memberships, hotelId);
  return { role, permissions: role ? await resolveEffectivePermissions(hotelId, role) : [] };
}

/**
 * İsteğin açıldığı otelin zinciri; otel zincirde değilse 409 `NO_GROUP`.
 * @param {string} hotelId
 */
export async function requireGroupOf(hotelId) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId }, select: { groupId: true, group: { select: { id: true, name: true } } } });
  if (!hotel?.group) throw new ConflictError('Bu otel bir zincire bağlı değil', 'NO_GROUP');
  return hotel.group;
}

/**
 * Zincirin otelleri (ada göre; zincir sınırı kadar).
 * @param {string} groupId
 */
export function groupHotels(groupId) {
  return prisma.hotel.findMany({
    where: { groupId },
    select: { id: true, name: true, code: true, currency: true, timezone: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: CHAIN_MAX_HOTELS,
  });
}

/**
 * Zincirin, kişinin erişimi olan VE oradaki rolü `permission` taşıyan otelleri. `hidden`: zincirde olup kişinin bu
 * izinle göremediği otel sayısı (ekran "şu kadar otel yetkiniz olmadığı için gösterilmiyor" der; adlarını değil).
 *
 * @param {Awaited<ReturnType<typeof loadActor>>} actor
 * @param {string} groupId
 * @param {string} permission
 */
export async function visibleGroupHotels(actor, groupId, permission) {
  const hotels = await groupHotels(groupId);
  const visible = [];
  for (const hotel of hotels) {
    const { role, permissions } = await accessIn(actor, hotel.id);
    if (role && permissions.includes(permission)) visible.push({ ...hotel, role });
  }
  return { hotels: visible, hidden: hotels.length - visible.length };
}
