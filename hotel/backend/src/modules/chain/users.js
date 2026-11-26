import { CHAIN_MAX_HOTELS, CHAIN_MAX_MEMBERSHIPS_PER_USER, PERMISSIONS, ROLE_LABELS, membershipChangeError } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { invalidateMembership } from '../../lib/memberships.js';
import { writeWithEvents } from '../../lib/write.js';
import { createUser } from '../users/service.js';
import { accessIn, groupHotels, requireGroupOf } from './access.js';
import { decodeNameCursor, encodeNameCursor } from './rules.js';

/**
 * Merkezi kullanıcı yönetimi (modül 63): zincirin bütün otellerindeki kişiler, her birinin zincirdeki otel erişimleri;
 * erişim verme / rolünü değiştirme / kaldırma, zincirden yeni kullanıcı açma.
 *
 * Her değişiklik HEDEF OTELDEKİ yetkiye bakar (`membershipChangeError`): açık otelde zincir kullanıcılarını yönetmek,
 * yetkisi olmadığı otelde kimseye erişim vermeye yetmez.
 */

const iso = (value) => (value ? value.toISOString() : null);

/** Zincir kişisi: ana oteli zincirde ya da zincirdeki bir otele erişimi var. */
const inChain = (hotelIds) => ({ OR: [{ hotelId: { in: hotelIds } }, { hotels: { some: { hotelId: { in: hotelIds } } } }] });

const USER_SELECT = (hotelIds) => ({
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  hotelId: true,
  updatedAt: true,
  hotels: { where: { hotelId: { in: hotelIds } }, select: { hotelId: true, role: true, createdAt: true, createdBy: true }, take: CHAIN_MAX_HOTELS },
});

function toChainUserDto(user, hotelById) {
  const home = hotelById.get(user.hotelId);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isActive: user.isActive,
    updatedAt: iso(user.updatedAt),
    // Ana otel zincir dışındaysa adı gösterilmez (başka işletmenin bilgisi).
    home: home ? { hotelId: home.id, name: home.name, code: home.code, role: user.role } : { hotelId: null, name: null, code: null, role: null },
    memberships: user.hotels
      .map((row) => ({ hotelId: row.hotelId, name: hotelById.get(row.hotelId)?.name ?? '', code: hotelById.get(row.hotelId)?.code ?? '', role: row.role, createdAt: iso(row.createdAt), createdBy: row.createdBy }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
  };
}

async function chainContext(actor) {
  const group = await requireGroupOf(actor.currentHotelId);
  const hotels = await groupHotels(group.id);
  return { group, hotels, hotelIds: hotels.map((hotel) => hotel.id), hotelById: new Map(hotels.map((hotel) => [hotel.id, hotel])) };
}

/**
 * @param {{ search?: string, hotelId?: string, cursor?: string, limit: number }} query
 */
export async function listChainUsers(actor, { search, hotelId, cursor, limit }) {
  const { hotelIds, hotelById } = await chainContext(actor);
  if (hotelId && !hotelById.has(hotelId)) throw new ValidationError('Otel bu zincirde değil', { field: 'hotelId' });
  const after = decodeNameCursor(cursor);
  if (cursor && !after) throw new ValidationError('Sayfa imleci geçersiz', { field: 'cursor' });

  const and = [inChain(hotelId ? [hotelId] : hotelIds)];
  if (search) and.push({ OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] });
  if (after) and.push({ OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }] });
  const rows = await prisma.user.findMany({
    where: { AND: and },
    select: USER_SELECT(hotelIds),
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => toChainUserDto(row, hotelById)),
    hotels: await actorHotelRights(actor, hotelById),
    nextCursor: rows.length > limit ? encodeNameCursor(page.at(-1)) : null,
  };
}

/**
 * Zincirin otelleri ve kişinin her birindeki rolü / kullanıcı yönetme izni: ekran erişim düğmelerini sözleşmedeki
 * aynı kuralla (`membershipChangeError`) gösterip gizler; asıl kontrol yine sunucuda.
 */
async function actorHotelRights(actor, hotelById) {
  const rights = [];
  for (const hotel of hotelById.values()) {
    const { role, permissions } = await accessIn(actor, hotel.id);
    rights.push({ id: hotel.id, name: hotel.name, code: hotel.code, myRole: role, canManageUsers: Boolean(role) && permissions.includes(PERMISSIONS.USERS_MANAGE) });
  }
  return rights;
}

/** Zincirdeki bir kişi (değilse 404: başka zincirin kişisi kimliğiyle bulunamaz). */
async function findChainUser(client, userId, hotelIds) {
  const user = await client.user.findFirst({ where: { id: userId, ...inChain(hotelIds) }, select: USER_SELECT(hotelIds) });
  if (!user) throw new NotFoundError('Kullanıcı bu zincirde bulunamadı');
  return user;
}

export async function getChainUser(actor, userId) {
  const { hotelIds, hotelById } = await chainContext(actor);
  return toChainUserDto(await findChainUser(prisma, userId, hotelIds), hotelById);
}

/**
 * Zincirden yeni kullanıcı: ana oteli zincirde olmalı ve kişi orada kullanıcı yönetebilmeli; yönetici rolüyle açmak
 * için orada yönetici olmalı.
 * @param {{ homeHotelId: string, email: string, name: string, role: string, password: string }} input
 */
export async function createChainUser(actor, { homeHotelId, ...input }) {
  const { hotelById } = await chainContext(actor);
  if (!hotelById.has(homeHotelId)) throw new ValidationError('Ana otel bu zincirde değil', { field: 'homeHotelId' });
  const { role, permissions } = await accessIn(actor, homeHotelId);
  if (!role || !permissions.includes(PERMISSIONS.USERS_MANAGE)) throw new ForbiddenError('Seçilen otelde kullanıcı yönetme yetkiniz yok');
  if (input.role === 'ADMIN' && role !== 'ADMIN') throw new ForbiddenError('Yönetici rolüyle kullanıcıyı yalnız o otelin yöneticisi açar');
  return createUser(homeHotelId, { ...input, isActive: true });
}

/**
 * Kişiye zincirdeki bir otelde erişim verir ya da rolünü değiştirir.
 * @param {string} userId
 * @param {string} hotelId
 * @param {{ role: string }} input
 */
export async function setMembership(actor, userId, hotelId, { role: nextRole }) {
  const { hotelIds, hotelById } = await chainContext(actor);
  if (!hotelById.has(hotelId)) throw new ValidationError('Otel bu zincirde değil', { field: 'hotelId' });
  const actorAccess = await accessIn(actor, hotelId);

  const result = await writeWithEvents(async (tx) => {
    // Aynı kişinin erişimleri sıraya girsin: sınır ve "önceki rol" kontrolü yarışmasın.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`user-hotels:${userId}`}, 0))`;
    const target = await findChainUser(tx, userId, hotelIds);
    const current = await tx.userHotel.findFirst({ where: { userId, hotelId } });
    const blocked = membershipChangeError({
      actorId: actor.id,
      actorRole: actorAccess.role,
      actorPermissions: actorAccess.permissions,
      targetUserId: target.id,
      targetHomeHotelId: target.hotelId,
      hotelId,
      currentRole: current?.role ?? null,
      nextRole,
    });
    if (blocked) throw new ForbiddenError(blocked);
    if (current?.role === nextRole) return { changed: false };

    if (!current) {
      const total = await tx.userHotel.count({ where: { userId } });
      if (total >= CHAIN_MAX_MEMBERSHIPS_PER_USER) throw new ConflictError(`Bir kişiye en fazla ${CHAIN_MAX_MEMBERSHIPS_PER_USER} otel erişimi verilir`, 'MEMBERSHIP_LIMIT');
      await tx.userHotel.create({ data: { userId, hotelId, role: nextRole, createdBy: actor.email } });
      await recordAudit(tx, { hotelId, entity: 'UserHotel', entityId: userId, action: 'CREATE', after: { userId, email: target.email, role: nextRole } });
    } else {
      await tx.userHotel.update({ where: { id: current.id }, data: { role: nextRole, updatedBy: actor.email } });
      await recordAudit(tx, { hotelId, entity: 'UserHotel', entityId: userId, action: 'UPDATE', before: { role: current.role }, after: { role: nextRole } });
    }
    return { changed: true };
  });
  invalidateMembership(userId, hotelId);
  const user = await getChainUser(actor, userId);
  return { ...result, user, roleLabel: ROLE_LABELS[nextRole] ?? nextRole };
}

/**
 * Kişinin bir oteldeki erişimini kaldırır. O otelde açık oturumu bir sonraki istekte düşer (erişim her istekte
 * denetlenir); token yenilemesi kişiyi ana oteline döndürür. Soket bağlantısını route keser.
 * @param {string} userId
 * @param {string} hotelId
 */
export async function removeMembership(actor, userId, hotelId) {
  const { hotelIds, hotelById } = await chainContext(actor);
  if (!hotelById.has(hotelId)) throw new ValidationError('Otel bu zincirde değil', { field: 'hotelId' });
  const actorAccess = await accessIn(actor, hotelId);

  await writeWithEvents(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`user-hotels:${userId}`}, 0))`;
    const target = await findChainUser(tx, userId, hotelIds);
    const current = await tx.userHotel.findFirst({ where: { userId, hotelId } });
    if (!current) throw new NotFoundError('Kişinin bu otelde erişimi yok');
    const blocked = membershipChangeError({
      actorId: actor.id,
      actorRole: actorAccess.role,
      actorPermissions: actorAccess.permissions,
      targetUserId: target.id,
      targetHomeHotelId: target.hotelId,
      hotelId,
      currentRole: current.role,
      nextRole: null,
    });
    if (blocked) throw new ForbiddenError(blocked);
    await tx.userHotel.delete({ where: { id: current.id } });
    await recordAudit(tx, { hotelId, entity: 'UserHotel', entityId: userId, action: 'DELETE', before: { userId, email: target.email, role: current.role } });
  });
  invalidateMembership(userId, hotelId);
  return getChainUser(actor, userId);
}
