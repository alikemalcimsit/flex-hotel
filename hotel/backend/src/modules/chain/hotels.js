import { CHAIN_MAX_HOTELS, PERMISSIONS, hotelAttachError } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { invalidateMembership } from '../../lib/memberships.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { isValidTimeZone } from '../settings/rules.js';
import { accessIn, requireGroupOf } from './access.js';
import { TEMPLATE_FIELDS, TEMPLATE_MAX_ROWS, decodeNameCursor, encodeNameCursor, generalSettingsCopy } from './rules.js';

/**
 * Zincir ve otelleri (modül 63): zincir kurma / adlandırma, zincirin otel listesi, yeni otel sihirbazı (kaynak otelden
 * ayar kopyası), var olan oteli zincire ekleme / çıkarma.
 */

const iso = (value) => (value ? value.toISOString() : null);
const DUPLICATE_CODE = 'Bu otel kodu başka bir otelde kullanılıyor';

/** Zincirin otel listesini ve sınırını değiştiren işlemler sıraya girsin (aynı anda iki sihirbaz sınırı aşmasın). */
function lockGroup(tx, groupId) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`hotel-group:${groupId}`}, 0))`;
}

/** @param {{ id: string, name: string, createdAt: Date, updatedAt: Date }} group */
function toGroupDto(group, hotelCount) {
  return { id: group.id, name: group.name, hotelCount, createdAt: iso(group.createdAt), updatedAt: iso(group.updatedAt) };
}

/* ─────────────── Genel görünüm ─────────────── */

/**
 * Konsolun girişi: açık otel, zinciri (varsa), kişinin bu oteldeki zincir yetkileri.
 * @param {Awaited<ReturnType<typeof import('./access.js').loadActor>>} actor
 * @param {readonly string[]} permissions açık oteldeki izinler
 */
export async function getChainOverview(actor, permissions) {
  const hotel = await prisma.hotel.findFirst({
    where: { id: actor.currentHotelId },
    select: { id: true, name: true, code: true, group: { select: { id: true, name: true, createdAt: true, updatedAt: true, _count: { select: { hotels: true } } } } },
  });
  if (!hotel) throw new NotFoundError('Otel bulunamadı');
  const role = (await accessIn(actor, hotel.id)).role;
  return {
    hotel: { id: hotel.id, name: hotel.name, code: hotel.code },
    group: hotel.group ? toGroupDto(hotel.group, hotel.group._count.hotels) : null,
    access: {
      canView: permissions.includes(PERMISSIONS.CHAIN_VIEW),
      canManage: permissions.includes(PERMISSIONS.CHAIN_MANAGE),
      canManageUsers: permissions.includes(PERMISSIONS.CHAIN_USERS),
      isHotelAdmin: role === 'ADMIN',
    },
    limits: { maxHotels: CHAIN_MAX_HOTELS },
  };
}

/* ─────────────── Zincir ─────────────── */

/**
 * Açık oteli ilk oteli olarak yeni zincir kurar. Otelin rakamları zincire açılacağı için kişi o otelin yöneticisi
 * olmalı.
 */
export async function createGroup(actor, { name }) {
  const { role } = await accessIn(actor, actor.currentHotelId);
  const blocked = hotelAttachError({ roleInHotel: role, canManageChain: true });
  if (blocked) throw new ForbiddenError(blocked);

  return writeWithEvents(async (tx) => {
    const group = await tx.hotelGroup.create({ data: { name, createdBy: actor.email } });
    // Koşullu bağlama: aynı anda iki kişi zincir kurarsa ikincisi boşa açılmış zinciri geri alır (transaction).
    const { count } = await tx.hotel.updateMany({ where: { id: actor.currentHotelId, groupId: null }, data: { groupId: group.id } });
    if (count === 0) throw new ConflictError('Bu otel zaten bir zincirde', 'ALREADY_IN_GROUP');
    const dto = toGroupDto(group, 1);
    await recordAudit(tx, { hotelId: actor.currentHotelId, entity: 'HotelGroup', entityId: group.id, action: 'CREATE', after: { name, hotelIds: [actor.currentHotelId] } });
    return dto;
  });
}

export async function renameGroup(actor, { name, expectedUpdatedAt }) {
  const group = await requireGroupOf(actor.currentHotelId);
  return writeWithEvents(async (tx) => {
    const before = await tx.hotelGroup.findFirst({ where: { id: group.id } });
    await updateWithVersionCheck(tx, 'hotelGroup', { id: group.id }, expectedUpdatedAt, { name }, 'Zincir bulunamadı');
    const after = await tx.hotelGroup.findFirst({ where: { id: group.id }, include: { _count: { select: { hotels: true } } } });
    await recordAudit(tx, { hotelId: actor.currentHotelId, entity: 'HotelGroup', entityId: group.id, action: 'UPDATE', before: { name: before.name }, after: { name } });
    return toGroupDto(after, after._count.hotels);
  });
}

/* ─────────────── Otel listesi ─────────────── */

/**
 * Zincirin otelleri (ada göre, imleçli). Her satırda kişinin oradaki rolü (erişimi yoksa `null`) ve oda sayısı.
 * @param {{ search?: string, cursor?: string, limit: number }} query
 */
export async function listGroupHotels(actor, { search, cursor, limit }) {
  const group = await requireGroupOf(actor.currentHotelId);
  const after = decodeNameCursor(cursor);
  if (cursor && !after) throw new ValidationError('Sayfa imleci geçersiz', { field: 'cursor' });

  const and = [{ groupId: group.id }];
  if (search) and.push({ OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] });
  if (after) and.push({ OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }] });
  const rows = await prisma.hotel.findMany({
    where: { AND: and },
    select: { id: true, name: true, code: true, currency: true, timezone: true, address: true, createdAt: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const ids = page.map((row) => row.id);
  const rooms = ids.length
    ? await prisma.room.groupBy({ by: ['hotelId'], where: { hotelId: { in: ids }, deletedAt: null }, _count: { _all: true } })
    : [];
  const roomCount = new Map(rooms.map((row) => [row.hotelId, row._count._all]));
  const items = [];
  for (const row of page) {
    const { role } = await accessIn(actor, row.id);
    items.push({ ...row, createdAt: iso(row.createdAt), rooms: roomCount.get(row.id) ?? 0, myRole: role, isCurrent: row.id === actor.currentHotelId });
  }
  return { items, nextCursor: rows.length > limit ? encodeNameCursor(page.at(-1)) : null };
}

/* ─────────────── Yeni otel (şablondan) ─────────────── */

async function copyRows(tx, model, sourceHotelId, targetHotelId, fields) {
  const select = Object.fromEntries(fields.map((field) => [field, true]));
  const rows = await tx[model].findMany({ where: { hotelId: sourceHotelId }, select, take: TEMPLATE_MAX_ROWS + 1, orderBy: { id: 'asc' } });
  if (rows.length > TEMPLATE_MAX_ROWS) throw new ValidationError(`Kaynak otelde ${TEMPLATE_MAX_ROWS} satırdan fazla kayıt var; kopyalanamaz`, { field: 'copy' });
  if (rows.length) await tx[model].createMany({ data: rows.map((row) => ({ ...row, hotelId: targetHotelId })) });
  return rows.length;
}

/**
 * Kaynak otelin ayarlarından yeni otel kurar (transaction içinde). Servis fonksiyonu olarak dışa açık: göç sihirbazı
 * (modül 69) ve eğitim oteli kurulumu (modül 77) aynı fonksiyonu çağırır.
 *
 * Kopyalanan: genel parametreler, oda tipleri, vergiler, sezonlar, rol matrisi (seçilenler). Kopyalanmayan: odalar,
 * kullanıcılar, misafir / rezervasyon / para hareketi, yasal kimlikler ve dış sistem şifreleri. Para birimi farklıysa
 * tutarlı genel parametreler varsayılana döner ve oda tipi kopyası reddedilir (fiyatlar başka birimde).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{
 *   identity: { name: string, code: string, timezone: string, currency: string, address?: string | null, phone?: string | null, email?: string | null },
 *   source: Record<string, any>,  kaynak `Hotel` satırı (tam)
 *   copy: string[],
 *   groupId: string | null,
 * }} input
 */
export async function createHotelFromTemplate(tx, { identity, source, copy, groupId }) {
  if (!isValidTimeZone(identity.timezone)) throw new ValidationError('Geçersiz saat dilimi', { field: 'timezone' });
  const sameCurrency = source.currency === identity.currency;
  if (copy.includes('ROOM_TYPES') && !sameCurrency) {
    throw new ValidationError('Para birimi farklı otelden oda tipi kopyalanamaz (taban fiyatlar başka birimde)', { field: 'copy' });
  }
  const general = copy.includes('GENERAL') ? generalSettingsCopy(source, { sameCurrency }) : { data: {}, skipped: [] };
  const empty = (value) => (value === '' || value === undefined ? null : value);

  let hotel;
  try {
    hotel = await tx.hotel.create({
      data: {
        ...general.data,
        name: identity.name,
        code: identity.code,
        timezone: identity.timezone,
        currency: identity.currency,
        address: empty(identity.address),
        phone: empty(identity.phone),
        email: empty(identity.email),
        groupId,
        ...(copy.includes('ROLE_MATRIX') ? { permissionCatalog: source.permissionCatalog } : {}),
      },
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: DUPLICATE_CODE });
  }

  const copied = { roomTypes: 0, taxes: 0, seasons: 0, rolePermissions: 0 };
  if (copy.includes('ROOM_TYPES')) copied.roomTypes = await copyRows(tx, 'roomType', source.id, hotel.id, TEMPLATE_FIELDS.RoomType);
  if (copy.includes('TAXES')) copied.taxes = await copyRows(tx, 'tax', source.id, hotel.id, TEMPLATE_FIELDS.Tax);
  if (copy.includes('SEASONS')) copied.seasons = await copyRows(tx, 'season', source.id, hotel.id, TEMPLATE_FIELDS.Season);
  if (copy.includes('ROLE_MATRIX')) copied.rolePermissions = await copyRows(tx, 'rolePermission', source.id, hotel.id, TEMPLATE_FIELDS.RolePermission);
  return { hotel, copied, skipped: general.skipped };
}

/**
 * Sihirbaz: zincire yeni otel. Kaynak otel zincirde ve kişinin erişimi olan bir otel olmalı; kuran kişi yeni otelin
 * yöneticisi olur (otel erişimi olarak).
 *
 * @param {{ name: string, code: string, timezone: string, currency: string, address?: string | null, phone?: string | null,
 *   email?: string | null, sourceHotelId: string, copy: string[] }} input
 */
export async function createChainHotel(actor, input) {
  const group = await requireGroupOf(actor.currentHotelId);
  const { role: sourceRole } = await accessIn(actor, input.sourceHotelId);
  if (!sourceRole) throw new ValidationError('Kaynak otele erişiminiz yok', { field: 'sourceHotelId' });

  const created = await writeWithEvents(async (tx) => {
    await lockGroup(tx, group.id);
    const source = await tx.hotel.findFirst({ where: { id: input.sourceHotelId, groupId: group.id } });
    if (!source) throw new ValidationError('Kaynak otel bu zincirde değil', { field: 'sourceHotelId' });
    const count = await tx.hotel.count({ where: { groupId: group.id } });
    if (count >= CHAIN_MAX_HOTELS) throw new ConflictError(`Bir zincirde en fazla ${CHAIN_MAX_HOTELS} otel olur`, 'CHAIN_LIMIT');

    const { sourceHotelId, copy, ...identity } = input;
    const { hotel, copied, skipped } = await createHotelFromTemplate(tx, { identity, source, copy, groupId: group.id });
    await tx.userHotel.create({ data: { userId: actor.id, hotelId: hotel.id, role: 'ADMIN', createdBy: actor.email } });

    const summary = { name: hotel.name, code: hotel.code, timezone: hotel.timezone, currency: hotel.currency, groupId: group.id, sourceHotelId, copy, copied, skipped };
    await recordAudit(tx, { hotelId: hotel.id, entity: 'Hotel', entityId: hotel.id, action: 'CREATE', after: summary });
    await recordAudit(tx, { hotelId: actor.currentHotelId, entity: 'HotelGroup', entityId: group.id, action: 'UPDATE', before: { hotelCount: count }, after: { hotelCount: count + 1, addedHotel: { id: hotel.id, code: hotel.code } } });
    return { hotel: { id: hotel.id, name: hotel.name, code: hotel.code, currency: hotel.currency, timezone: hotel.timezone }, copy, copied, skipped };
  });
  // Commit'ten sonra: transaction içindeki silme, commit'ten önce gelen bir okumayla eski ("erişim yok") değeri yeniden
  // önbelleğe yazdırabilirdi.
  invalidateMembership(actor.id, created.hotel.id);
  return created;
}

/* ─────────────── Var olan oteli ekleme / çıkarma ─────────────── */

/**
 * Kişinin yöneticisi olduğu, zincirde olmayan bir oteli açık otelin zincirine ekler.
 * @param {string} hotelId
 */
export async function attachHotel(actor, hotelId) {
  const group = await requireGroupOf(actor.currentHotelId);
  const { role } = await accessIn(actor, hotelId);
  const blocked = hotelAttachError({ roleInHotel: role, canManageChain: true });
  if (blocked) throw new ForbiddenError(blocked);

  return writeWithEvents(async (tx) => {
    await lockGroup(tx, group.id);
    const count = await tx.hotel.count({ where: { groupId: group.id } });
    if (count >= CHAIN_MAX_HOTELS) throw new ConflictError(`Bir zincirde en fazla ${CHAIN_MAX_HOTELS} otel olur`, 'CHAIN_LIMIT');
    const { count: updated } = await tx.hotel.updateMany({ where: { id: hotelId, groupId: null }, data: { groupId: group.id } });
    if (updated === 0) {
      const exists = await tx.hotel.findFirst({ where: { id: hotelId }, select: { groupId: true } });
      if (!exists) throw new NotFoundError('Otel bulunamadı');
      throw new ConflictError(exists.groupId === group.id ? 'Otel zaten bu zincirde' : 'Otel başka bir zincirde; önce oradan çıkarılmalı', 'ALREADY_IN_GROUP');
    }
    await recordAudit(tx, { hotelId, entity: 'Hotel', entityId: hotelId, action: 'UPDATE', before: { groupId: null }, after: { groupId: group.id } });
    await recordAudit(tx, { hotelId: actor.currentHotelId, entity: 'HotelGroup', entityId: group.id, action: 'UPDATE', before: { hotelCount: count }, after: { hotelCount: count + 1, addedHotel: { id: hotelId } } });
    return { ok: true };
  });
}

/**
 * Oteli zincirden çıkarır (kişi o otelin yöneticisi olmalı). Zincirde otel kalmazsa zincir de silinir. Kişilerin otel
 * erişimleri kalır (otel zincirden çıksa da orada çalışan genel müdür çalışmaya devam eder); zincir görünümünden düşer.
 * @param {string} hotelId
 */
export async function detachHotel(actor, hotelId) {
  const group = await requireGroupOf(actor.currentHotelId);
  const { role } = await accessIn(actor, hotelId);
  const blocked = hotelAttachError({ roleInHotel: role, canManageChain: true });
  if (blocked) throw new ForbiddenError(blocked);

  return writeWithEvents(async (tx) => {
    await lockGroup(tx, group.id);
    const { count: updated } = await tx.hotel.updateMany({ where: { id: hotelId, groupId: group.id }, data: { groupId: null } });
    if (updated === 0) throw new NotFoundError('Otel bu zincirde değil');
    const remaining = await tx.hotel.count({ where: { groupId: group.id } });
    if (remaining === 0) await tx.hotelGroup.delete({ where: { id: group.id } });
    await recordAudit(tx, { hotelId, entity: 'Hotel', entityId: hotelId, action: 'UPDATE', before: { groupId: group.id }, after: { groupId: null } });
    // Açık otel çıkarıldıysa yukarıdaki iz zaten o otelde.
    if (hotelId !== actor.currentHotelId) {
      await recordAudit(tx, {
        hotelId: actor.currentHotelId,
        entity: 'HotelGroup',
        entityId: group.id,
        action: remaining === 0 ? 'DELETE' : 'UPDATE',
        before: { hotelCount: remaining + 1 },
        after: { hotelCount: remaining, removedHotel: { id: hotelId } },
      });
    }
    return { ok: true, groupDeleted: remaining === 0 };
  });
}
