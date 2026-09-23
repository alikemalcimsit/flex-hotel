import bcrypt from 'bcryptjs';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';

/**
 * Kullanıcı yönetimi (modül 2). Ayarlar modülünün CRUD deseniyle aynı: liste
 * sayfalı, güncelleme optimistic lock'lu, her yazma denetim izine geçer.
 *
 * Parola hash'i asla DTO'ya ya da denetim izine yazılmaz.
 */

const BCRYPT_ROUNDS = 10;
const ADMIN_ROLE = 'ADMIN';
const DUPLICATE_EMAIL_MESSAGE = 'Bu e-posta ile bir kullanıcı zaten var';

const iso = (value) => (value ? value.toISOString() : null);

/** @param {import('@prisma/client').User} user */
export function toUserDto(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: iso(user.createdAt),
    updatedAt: iso(user.updatedAt),
  };
}

/**
 * @param {string} hotelId
 * @param {{ page: number, pageSize: number, search?: string }} query
 */
export async function listUsers(hotelId, { page, pageSize, search }) {
  const where = {
    hotelId,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  // Liste ve sayım aynı transaction'da: sayfa ile toplam tutarlı olsun.
  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({ where, orderBy: [{ name: 'asc' }], ...toSkipTake({ page, pageSize }) }),
    prisma.user.count({ where }),
  ]);

  return buildPage(rows.map(toUserDto), total, { page, pageSize });
}

/**
 * @param {string} hotelId
 * @param {{ email: string, name: string, role: string, password: string, isActive?: boolean }} input
 */
export async function createUser(hotelId, { email, name, role, password, isActive = true }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  return writeWithEvents(async (tx) => {
    let created;
    try {
      created = await tx.user.create({ data: { hotelId, email, name, role, isActive, passwordHash } });
    } catch (error) {
      rethrowPrismaError(error, { uniqueMessage: DUPLICATE_EMAIL_MESSAGE });
    }
    const dto = toUserDto(created);
    await recordAudit(tx, { hotelId, entity: 'User', entityId: created.id, action: 'CREATE', after: dto });
    return dto;
  });
}

/**
 * Son aktif yöneticiyi pasife almak / rolünü düşürmek panele kimsenin
 * girememesine yol açar; engelle.
 */
async function assertNotLastAdmin(tx, hotelId, before, nextRole, nextActive) {
  const losesAdmin = before.role === ADMIN_ROLE && (!nextActive || nextRole !== ADMIN_ROLE);
  if (!losesAdmin) return;
  const otherAdmins = await tx.user.count({
    where: { hotelId, role: ADMIN_ROLE, isActive: true, id: { not: before.id } },
  });
  if (otherAdmins === 0) {
    throw new ValidationError('Son aktif yöneticiyi pasife alamaz ya da rolünü değiştiremezsiniz', { field: 'role' });
  }
}

/**
 * @param {string} hotelId
 * @param {string} id
 * @param {{ email: string, name: string, role: string, isActive: boolean, expectedUpdatedAt: Date }} input
 */
export async function updateUser(hotelId, id, { email, name, role, isActive, expectedUpdatedAt }) {
  return writeWithEvents(async (tx) => {
    const before = await tx.user.findFirst({ where: { id, hotelId } });
    if (!before) throw new NotFoundError('Kullanıcı bulunamadı');

    await assertNotLastAdmin(tx, hotelId, before, role, isActive);

    try {
      await updateWithVersionCheck(
        tx,
        'user',
        { id, hotelId },
        expectedUpdatedAt,
        { email, name, role, isActive },
        'Kullanıcı bulunamadı',
      );
    } catch (error) {
      rethrowPrismaError(error, { uniqueMessage: DUPLICATE_EMAIL_MESSAGE });
    }

    // Pasife alındıysa açık oturumları kapat: refresh token'ları iptal et.
    if (before.isActive && !isActive) {
      await tx.refreshToken.updateMany({ where: { userId: id }, data: { deletedAt: new Date() } });
    }

    const after = await tx.user.findFirst({ where: { id, hotelId } });
    const beforeDto = toUserDto(before);
    const afterDto = toUserDto(after);
    await recordAudit(tx, { hotelId, entity: 'User', entityId: id, action: 'UPDATE', before: beforeDto, after: afterDto });
    return afterDto;
  });
}

/**
 * Şifre sıfırlama: yeni hash yazılır, kullanıcının tüm açık oturumları iptal
 * edilir (yeni şifreyle yeniden girmeli). Denetim izine hash yazılmaz.
 * @param {string} hotelId
 * @param {string} id
 * @param {string} password
 */
export async function resetPassword(hotelId, id, password) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  return writeWithEvents(async (tx) => {
    const existing = await tx.user.findFirst({ where: { id, hotelId }, select: { id: true } });
    if (!existing) throw new NotFoundError('Kullanıcı bulunamadı');

    await tx.user.update({ where: { id }, data: { passwordHash } });
    await tx.refreshToken.updateMany({ where: { userId: id }, data: { deletedAt: new Date() } });

    await recordAudit(tx, {
      hotelId,
      entity: 'User',
      entityId: id,
      action: 'UPDATE',
      before: { passwordReset: false },
      after: { passwordReset: true },
    });
    return { id };
  });
}
