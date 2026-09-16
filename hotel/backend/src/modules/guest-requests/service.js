import { currentActor } from '@hotelos/core';
import {
  defaultGuestRequestPriority,
  GUEST_REQUEST_ACTIVE_STATUSES,
  GUEST_REQUEST_DUE_SOON_MINUTES,
  guestRequestDueAt,
  guestRequestTiming,
  guestRequestTransitionError,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError } from '../../lib/errors.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { lockGuestRequests } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { createReadCache } from '../../lib/read-cache.js';
import { assertAssignableStaff, currentStaff, currentStaffCached, listAssignableStaff } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { loadConversationForRequest } from '../messaging/service.js';
import { openSliceStart } from '../rooms/rules.js';

/**
 * Misafir istekleri servisi (modül 7).
 *
 * Bir istek misafirin bir şey beklediği andır: havlu, arıza, uyandırma,
 * şikâyet. Üç şey önemli:
 *
 * - **Kim, nerede:** istek odaya ve (varsa) içerideki konaklamaya bağlanır.
 *   Resepsiyon yalnızca odayı seçer; içerideki misafir kendiliğinden bulunur.
 * - **Ne zamana kadar:** önceliğe göre hizmet süresi (`dueAt`) sunucuda
 *   hesaplanır; uyandırma gibi zamanlı isteklerde istenen saattir. Liste en
 *   acilden sıralanır, geciken işaretlenir.
 * - **Kim ilgileniyor:** atama ve durum geçişleri denetim izine yazılır;
 *   durum kuralı sözleşmede tek yerde (`guestRequestTransitionError`).
 *
 * Kat hizmetleri (modül 14) ve teknik servis (modül 20) kendi görev
 * tablolarını kuracak; `guest.request.created` event'ini dinleyip ilgili
 * kategorideki isteklerden görev üretebilirler.
 */

const SUMMARY_CACHE_TTL_MS = 30_000;
const SUMMARY_CACHE_MAX_ENTRIES = 5000;
const summaryCache = createReadCache({ ttlMs: SUMMARY_CACHE_TTL_MS, maxEntries: SUMMARY_CACHE_MAX_ENTRIES });

/**
 * Liste önbelleği (aramasız sorgular). Anahtar sürüm ve dakikayı içerir:
 * "gecikmiş" görünümü ve kalan süre zamanla değişir.
 */
const LIST_CACHE_TTL_MS = 15_000;
const LIST_CACHE_MAX_ENTRIES = 2000;
const listCache = createReadCache({ ttlMs: LIST_CACHE_TTL_MS, maxEntries: LIST_CACHE_MAX_ENTRIES });

const MINUTE_MS = 60_000;

/** Aramada dikkate alınan en fazla kelime. */
const MAX_SEARCH_TOKENS = 3;

const REQUEST_INCLUDE = Object.freeze({
  room: { select: { id: true, number: true, floor: true } },
  guest: { select: { id: true, firstName: true, lastName: true } },
  reservation: { select: { id: true, confirmationCode: true, status: true } },
  assignedTo: { select: { id: true, name: true } },
  conversation: { select: { id: true, channel: true } },
});

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);

/** @param {{ firstName: string, lastName: string } | null | undefined} guest */
const guestName = (guest) => (guest ? `${guest.firstName} ${guest.lastName}`.trim() : null);

/**
 * @param {object} row
 * @param {Date} now
 */
function toRequestDto(row, now) {
  const timing = guestRequestTiming(row, now);
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    source: row.source,
    dueAt: iso(row.dueAt),
    scheduledFor: iso(row.scheduledFor),
    overdue: timing.overdue,
    minutesLeft: timing.active ? timing.minutesLeft : null,
    room: row.room ? { id: row.room.id, number: row.room.number, floor: row.room.floor } : null,
    guest: row.guest ? { id: row.guest.id, name: guestName(row.guest) } : null,
    reservation: row.reservation
      ? { id: row.reservation.id, confirmationCode: row.reservation.confirmationCode, status: row.reservation.status }
      : null,
    conversation: row.conversation ? { id: row.conversation.id, channel: row.conversation.channel } : null,
    messageId: row.messageId,
    assignedTo: row.assignedTo ? { id: row.assignedTo.id, name: row.assignedTo.name } : null,
    createdBy: row.createdBy,
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    completedBy: row.completedBy,
    resolutionNote: row.resolutionNote,
    cancelledReason: row.cancelledReason,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Denetim izine yazılacak alanlar (ilişkiler ve türetilmiş alanlar hariç). */
function snapshot(row) {
  return {
    category: row.category,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    dueAt: iso(row.dueAt),
    scheduledFor: iso(row.scheduledFor),
    roomId: row.roomId,
    reservationId: row.reservationId,
    assignedToId: row.assignedToId,
    completedAt: iso(row.completedAt),
    completedBy: row.completedBy,
    resolutionNote: row.resolutionNote,
    cancelledReason: row.cancelledReason,
  };
}

/**
 * Odanın bu gece içeride olan konaklaması (oda değiştirmiş misafir dahil:
 * açık dilim bu odadaysa).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} client
 * @param {string} hotelId
 * @param {string} roomId
 * @param {Date} businessDate
 */
async function findInHouseStay(client, hotelId, roomId, businessDate) {
  const candidates = await client.reservation.findMany({
    where: { hotelId, roomId, status: 'CHECKED_IN', checkOut: { gt: businessDate } },
    select: {
      id: true,
      guestId: true,
      checkIn: true,
      roomSince: true,
      confirmationCode: true,
      guest: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ checkIn: 'desc' }],
  });
  return (
    candidates.find((row) => new Date(openSliceStart(row)).getTime() <= businessDate.getTime()) ??
    candidates[0] ??
    null
  );
}

/**
 * Formdaki oda/konaklama seçimini doğrular ve birbirine bağlar.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {{ roomId?: string | null, reservationId?: string | null }} input
 * @param {Date} businessDate
 * @returns {Promise<{ roomId: string | null, reservationId: string | null, guestId: string | null }>}
 */
async function resolveLocation(tx, hotelId, { roomId, reservationId }, businessDate) {
  if (reservationId) {
    const reservation = await tx.reservation.findFirst({
      where: { id: reservationId, hotelId },
      select: { id: true, roomId: true, guestId: true },
    });
    if (!reservation) throw new ValidationError('Konaklama bulunamadı', { field: 'reservationId' });
    if (roomId && reservation.roomId && roomId !== reservation.roomId) {
      throw new ValidationError('Seçilen oda bu konaklamanın odası değil.', { field: 'roomId' });
    }
    return { roomId: roomId ?? reservation.roomId, reservationId: reservation.id, guestId: reservation.guestId };
  }

  if (!roomId) return { roomId: null, reservationId: null, guestId: null };

  const room = await tx.room.findFirst({ where: { id: roomId, hotelId }, select: { id: true } });
  if (!room) throw new ValidationError('Oda bulunamadı', { field: 'roomId' });
  // İçeride misafir varsa isteği ona bağla: "103 havlu" → Ayşe Yılmaz'ın konaklaması.
  const stay = await findInHouseStay(tx, hotelId, roomId, businessDate);
  return { roomId, reservationId: stay?.id ?? null, guestId: stay?.guestId ?? null };
}

/**
 * @param {string} view
 * @param {{ id: string } | null} staff
 * @param {Date} now
 */
function viewWhere(view, staff, now) {
  const active = { status: { in: [...GUEST_REQUEST_ACTIVE_STATUSES] } };
  switch (view) {
    case 'OVERDUE':
      return { ...active, dueAt: { lt: now } };
    case 'MINE':
      return { ...active, assignedToId: staff?.id ?? '00000000-0000-0000-0000-000000000000' };
    case 'DONE':
      return { status: 'DONE' };
    case 'CANCELLED':
      return { status: 'CANCELLED' };
    case 'ALL':
      return {};
    default:
      return active;
  }
}

/** Görünüme göre sıra: açık işte en acil önce, bitenlerde en yeni önce. */
function viewOrder(view) {
  switch (view) {
    case 'DONE':
      return [{ completedAt: 'desc' }, { id: 'desc' }];
    case 'CANCELLED':
      return [{ updatedAt: 'desc' }, { id: 'desc' }];
    case 'ALL':
      return [{ createdAt: 'desc' }, { id: 'desc' }];
    default:
      return [{ dueAt: 'asc' }, { id: 'asc' }];
  }
}

/** @param {string | undefined} search */
function searchWhere(search) {
  const tokens = (search ?? '').split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TOKENS);
  if (tokens.length === 0) return {};
  return {
    AND: tokens.map((token) => ({
      OR: [
        { title: { contains: token, mode: 'insensitive' } },
        { description: { contains: token, mode: 'insensitive' } },
        { room: { number: { equals: token } } },
        { guest: { firstName: { contains: token, mode: 'insensitive' } } },
        { guest: { lastName: { contains: token, mode: 'insensitive' } } },
      ],
    })),
  };
}

/**
 * @param {string} hotelId
 * @param {object} query `guestRequestListQuerySchema`
 */
export async function listRequests(hotelId, query) {
  const staff = query.view === 'MINE' ? await currentStaffCached(prisma, hotelId) : null;
  if (query.search) return queryRequests(hotelId, query, staff, new Date());

  const minute = Math.floor(Date.now() / MINUTE_MS);
  const key = JSON.stringify([hotelId, liveVersion(LIVE_SCOPES.REQUESTS, hotelId), minute, staff?.id ?? '', query]);
  return listCache.get(key, () => queryRequests(hotelId, query, staff, new Date(minute * MINUTE_MS)));
}

/**
 * @param {string} hotelId
 * @param {object} query
 * @param {{ id: string } | null} staff
 * @param {Date} now
 */
async function queryRequests(hotelId, query, staff, now) {
  const where = {
    hotelId,
    ...viewWhere(query.view, staff, now),
    ...(query.category ? { category: query.category } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.roomId ? { roomId: query.roomId } : {}),
    ...(query.conversationId ? { conversationId: query.conversationId } : {}),
    ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
    ...(query.unassigned ? { assignedToId: null } : {}),
    ...searchWhere(query.search),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.guestRequest.findMany({ where, include: REQUEST_INCLUDE, orderBy: viewOrder(query.view), ...toSkipTake(query) }),
    prisma.guestRequest.count({ where }),
  ]);

  return buildPage(
    rows.map((row) => toRequestDto(row, now)),
    total,
    query,
  );
}

/**
 * Yan menü rozeti ve sekme sayıları.
 * @param {string} hotelId
 */
export async function getRequestSummary(hotelId) {
  const staff = await currentStaffCached(prisma, hotelId);
  const version = liveVersion(LIVE_SCOPES.REQUESTS, hotelId);
  const minute = Math.floor(Date.now() / MINUTE_MS);
  const active = { hotelId, status: { in: [...GUEST_REQUEST_ACTIVE_STATUSES] } };

  // Otel geneli sayılar bütün personelde ortak; yalnızca "bana atanan" kişiye özel
  // (bkz. gelen kutusu özeti).
  const [shared, mine] = await Promise.all([
    summaryCache.get(JSON.stringify(['requests', hotelId, version, minute]), async () => {
      const now = new Date(minute * MINUTE_MS);
      const soon = new Date(now.getTime() + GUEST_REQUEST_DUE_SOON_MINUTES * MINUTE_MS);
      const [open, overdue, dueSoon, unassigned, byCategory] = await Promise.all([
        prisma.guestRequest.count({ where: active }),
        prisma.guestRequest.count({ where: { ...active, dueAt: { lt: now } } }),
        prisma.guestRequest.count({ where: { ...active, dueAt: { gte: now, lt: soon } } }),
        prisma.guestRequest.count({ where: { ...active, assignedToId: null } }),
        prisma.guestRequest.groupBy({ by: ['category'], where: active, _count: { _all: true } }),
      ]);
      return {
        open,
        overdue,
        dueSoon,
        unassigned,
        byCategory: Object.fromEntries(byCategory.map((row) => [row.category, row._count._all])),
      };
    }),
    staff
      ? summaryCache.get(JSON.stringify(['requests-mine', hotelId, version, staff.id]), () =>
          prisma.guestRequest.count({ where: { ...active, assignedToId: staff.id } }),
        )
      : 0,
  ]);

  return { ...shared, mine, dueSoonMinutes: GUEST_REQUEST_DUE_SOON_MINUTES };
}

/** Sağlık ucu için önbellek isabet bilgisi. */
export function requestCacheStats() {
  return { list: listCache.stats(), summary: summaryCache.stats() };
}

/**
 * @param {string} hotelId
 * @param {string} requestId
 */
export async function getRequest(hotelId, requestId) {
  const row = await prisma.guestRequest.findFirst({ where: { id: requestId, hotelId }, include: REQUEST_INCLUDE });
  if (!row) throw new NotFoundError('İstek bulunamadı');
  return toRequestDto(row, new Date());
}

/**
 * Formdaki oda seçildiğinde "içeride kim var" bilgisi.
 * @param {string} hotelId
 * @param {string} roomId
 */
export async function getRoomContext(hotelId, roomId) {
  const [room, businessDate] = await Promise.all([
    prisma.room.findFirst({ where: { id: roomId, hotelId }, select: { id: true, number: true, floor: true } }),
    getBusinessDate(hotelId),
  ]);
  if (!room) throw new NotFoundError('Oda bulunamadı');
  const stay = await findInHouseStay(prisma, hotelId, roomId, businessDate);
  const openRequests = await prisma.guestRequest.count({
    where: { hotelId, roomId, status: { in: [...GUEST_REQUEST_ACTIVE_STATUSES] } },
  });
  return {
    room,
    stay: stay
      ? {
          reservationId: stay.id,
          confirmationCode: stay.confirmationCode,
          guestId: stay.guestId,
          guestName: guestName(stay.guest),
        }
      : null,
    openRequests,
  };
}

/**
 * İstek oluşturmanın ortak çekirdeği.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {string} hotelId
 * @param {{
 *   category: string, title: string, description?: string | null, priority?: string,
 *   source: string, scheduledFor?: Date | null, assignedToId?: string | null,
 *   roomId: string | null, reservationId: string | null, guestId: string | null,
 *   conversationId?: string | null, messageId?: string | null,
 * }} input
 */
async function insertRequest(tx, stage, hotelId, input) {
  await assertAssignableStaff(tx, hotelId, input.assignedToId);
  const priority = input.priority ?? defaultGuestRequestPriority(input.category);
  const createdAt = new Date();

  const created = await tx.guestRequest.create({
    data: {
      hotelId,
      category: input.category,
      title: input.title,
      description: input.description || null,
      priority,
      source: input.source,
      scheduledFor: input.scheduledFor ?? null,
      dueAt: guestRequestDueAt({ priority, createdAt, scheduledFor: input.scheduledFor }),
      assignedToId: input.assignedToId ?? null,
      roomId: input.roomId,
      reservationId: input.reservationId,
      guestId: input.guestId,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      createdBy: currentActor(),
      createdAt,
    },
    include: REQUEST_INCLUDE,
  });

  await recordAudit(tx, {
    hotelId,
    entity: 'GuestRequest',
    entityId: created.id,
    action: 'CREATE',
    after: snapshot(created),
  });
  await stage('guest.request.created', {
    hotelId,
    requestId: created.id,
    category: created.category,
    priority: created.priority,
    roomId: created.roomId,
    conversationId: created.conversationId,
  });
  return created;
}

/**
 * Resepsiyon / telefon / personel isteği.
 * @param {string} hotelId
 * @param {object} input `createGuestRequestSchema`
 */
export async function createRequest(hotelId, input) {
  const businessDate = await getBusinessDate(hotelId);
  const created = await writeWithEvents(async (tx, stage) => {
    const location = await resolveLocation(tx, hotelId, input, businessDate);
    return insertRequest(tx, stage, hotelId, { ...input, ...location });
  });
  return toRequestDto(created, new Date());
}

/**
 * Konuşmadan istek: misafir ve konaklama konuşmadan alınır.
 *
 * @param {string} hotelId
 * @param {string} conversationId
 * @param {object} input `createRequestFromConversationSchema`
 */
export async function createRequestFromConversation(hotelId, conversationId, input) {
  const businessDate = await getBusinessDate(hotelId);
  const created = await writeWithEvents(async (tx, stage) => {
    const conversation = await loadConversationForRequest(tx, hotelId, conversationId);

    if (input.messageId) {
      const message = await tx.message.findFirst({
        where: { id: input.messageId, conversationId, hotelId },
        select: { id: true },
      });
      if (!message) throw new ValidationError('Mesaj bu konuşmaya ait değil', { field: 'messageId' });
    }

    let location;
    if (conversation.reservationId) {
      location = await resolveLocation(
        tx,
        hotelId,
        { reservationId: conversation.reservationId, roomId: input.roomId ?? null },
        businessDate,
      );
    } else if (input.roomId) {
      location = await resolveLocation(tx, hotelId, { roomId: input.roomId }, businessDate);
    } else {
      throw new ValidationError('Konuşma bir konaklamaya bağlı değil; isteğin odasını seçin.', { field: 'roomId' });
    }

    return insertRequest(tx, stage, hotelId, {
      ...input,
      ...location,
      guestId: location.guestId ?? conversation.guestId,
      source: 'CONVERSATION',
      conversationId,
      messageId: input.messageId ?? null,
    });
  });
  return toRequestDto(created, new Date());
}

/**
 * Başlık, açıklama, öncelik, atama, saat, oda.
 *
 * Öncelik ya da zaman değişirse hizmet süresi yeniden hesaplanır (başlangıç
 * noktası isteğin açıldığı an: öncelik yükseltmek süreyi uzatmamalı).
 *
 * @param {string} hotelId
 * @param {string} requestId
 * @param {object} input `updateGuestRequestSchema`
 */
export async function updateRequest(hotelId, requestId, input) {
  const businessDate = await getBusinessDate(hotelId);
  const updated = await writeWithEvents(async (tx, stage) => {
    if (!(await lockGuestRequests(tx, hotelId, [requestId])).has(requestId)) {
      throw new NotFoundError('İstek bulunamadı');
    }
    const before = await tx.guestRequest.findFirst({ where: { id: requestId, hotelId } });
    if (before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError();

    const data = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description || null;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.assignedToId !== undefined) {
      await assertAssignableStaff(tx, hotelId, input.assignedToId);
      data.assignedToId = input.assignedToId;
    }
    if (input.scheduledFor !== undefined) {
      if (before.category === 'WAKE_UP' && !input.scheduledFor) {
        throw new ValidationError('Uyandırma için saat seçin', { field: 'scheduledFor' });
      }
      data.scheduledFor = input.scheduledFor;
    }
    if (input.roomId !== undefined && input.roomId !== before.roomId) {
      const location = await resolveLocation(tx, hotelId, { roomId: input.roomId }, businessDate);
      Object.assign(data, location);
    }

    const priority = data.priority ?? before.priority;
    const scheduledFor = data.scheduledFor !== undefined ? data.scheduledFor : before.scheduledFor;
    if (
      GUEST_REQUEST_ACTIVE_STATUSES.includes(before.status) &&
      (data.priority !== undefined || data.scheduledFor !== undefined)
    ) {
      data.dueAt = guestRequestDueAt({ priority, createdAt: before.createdAt, scheduledFor });
    }

    const after = await tx.guestRequest.update({ where: { id: requestId }, data, include: REQUEST_INCLUDE });
    const changedFields = await recordAudit(tx, {
      hotelId,
      entity: 'GuestRequest',
      entityId: requestId,
      action: 'UPDATE',
      before: snapshot(before),
      after: snapshot(after),
    });
    await stage('guest.request.updated', { hotelId, requestId, status: after.status, changedFields });
    return after;
  });
  return toRequestDto(updated, new Date());
}

/**
 * Durum değişikliği: başlat, tamamla, iptal et, yeniden aç.
 *
 * - Başlatan kişi isteğe atanmamışsa kendisine atanır (kim ilgileniyor belli olsun).
 * - Tamamlamada not çözüm notu, iptalde sebep olarak yazılır.
 * - Tamamlanmış ya da iptal edilmiş istek yeniden açılırsa misafir tekrar
 *   bekliyordur: hizmet süresi şimdiden itibaren yeniden başlar. Başlatılmış
 *   işi bekleyene geri almak ise süreyi değiştirmez.
 *
 * @param {string} hotelId
 * @param {string} requestId
 * @param {{ status: string, note?: string | null, expectedUpdatedAt: Date }} input
 */
export async function changeRequestStatus(hotelId, requestId, input) {
  const updated = await writeWithEvents(async (tx, stage) => {
    if (!(await lockGuestRequests(tx, hotelId, [requestId])).has(requestId)) {
      throw new NotFoundError('İstek bulunamadı');
    }
    const before = await tx.guestRequest.findFirst({ where: { id: requestId, hotelId } });
    if (before.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new StaleWriteError();

    const transitionError = guestRequestTransitionError(before.status, input.status);
    if (transitionError) throw new ConflictError(transitionError, 'INVALID_TRANSITION');
    if (before.status === input.status) return tx.guestRequest.findFirst({ where: { id: requestId }, include: REQUEST_INCLUDE });

    const now = new Date();
    const actor = currentActor();
    const data = { status: input.status };

    if (input.status === 'IN_PROGRESS') {
      data.startedAt = before.startedAt ?? now;
      if (!before.assignedToId) {
        const staff = await currentStaff(tx, hotelId);
        if (staff) data.assignedToId = staff.id;
      }
    }
    if (input.status === 'DONE') {
      Object.assign(data, { completedAt: now, completedBy: actor, resolutionNote: input.note || null });
    }
    if (input.status === 'CANCELLED') {
      data.cancelledReason = input.note;
    }
    if (input.status === 'OPEN' && before.status === 'IN_PROGRESS') {
      // "Başlatmayı geri al": iş hâlâ aynı iş, süre kaldığı yerden akar. Süreyi
      // sıfırlamak başlat/geri al ile gecikmeyi gizlemeye izin verirdi.
      data.startedAt = null;
    } else if (input.status === 'OPEN') {
      // Kapanmış işin yeniden açılması: misafir yeniden bekliyor, süre baştan.
      Object.assign(data, {
        startedAt: null,
        completedAt: null,
        completedBy: null,
        resolutionNote: null,
        cancelledReason: null,
        dueAt:
          before.scheduledFor && before.scheduledFor > now
            ? before.scheduledFor
            : guestRequestDueAt({ priority: before.priority, createdAt: now }),
      });
    }

    const after = await tx.guestRequest.update({ where: { id: requestId }, data, include: REQUEST_INCLUDE });
    const changedFields = await recordAudit(tx, {
      hotelId,
      entity: 'GuestRequest',
      entityId: requestId,
      action: 'UPDATE',
      before: snapshot(before),
      after: snapshot(after),
    });
    await stage('guest.request.updated', { hotelId, requestId, status: after.status, changedFields });
    return after;
  });
  return toRequestDto(updated, new Date());
}

/**
 * Atama seçicisi. E-posta, ekranın "Üstlen" düğmesi için oturumdaki
 * kullanıcıyı listede bulmasına yarar (modül 2'ye kadar kimlik e-postadır).
 * @param {string} hotelId
 */
export async function listAssignees(hotelId) {
  const users = await listAssignableStaff(prisma, hotelId);
  return users.map((user) => ({ id: user.id, name: user.name, role: user.role, email: user.email }));
}
