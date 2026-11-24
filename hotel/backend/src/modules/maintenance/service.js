import { currentActor, toIsoDay } from '@hotelos/core';
import { PERMISSIONS } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { writeWithEvents } from '../../lib/write.js';
import { currentStaffCached } from '../../lib/staff.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { blockRoom, removeBlock } from '../rooms/service.js';
import { applyRequestStatus } from '../guest-requests/service.js';
import { isPlanDue } from './rules.js';

const OPEN_STATUSES = ['PENDING', 'IN_PROGRESS'];
const TICKET_INCLUDE = { room: { select: { number: true } }, photos: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } };

/* ───────────────────────── DTO ───────────────────────── */

function toTicketDto(row) {
  return {
    id: row.id,
    roomId: row.roomId,
    roomNumber: row.room?.number ?? null,
    locationText: row.locationText,
    category: row.category,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    source: row.source,
    reportedBy: row.reportedBy,
    assignedTo: row.assignedTo,
    assignedAt: row.assignedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
    resolutionNote: row.resolutionNote,
    cancelReason: row.cancelReason,
    roomBlockId: row.roomBlockId,
    guestRequestId: row.guestRequestId,
    planId: row.planId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    photos: (row.photos ?? []).map((p) => ({ id: p.id, contentType: p.contentType, createdAt: p.createdAt.toISOString() })),
  };
}

/** @param {{ status: string }} ticket */
function assertOpen(ticket) {
  if (!OPEN_STATUSES.includes(ticket.status)) throw new ConflictError('Bilet kapandı; işlem yapılamaz.', 'TICKET_CLOSED');
}

/* ───────────────────────── Okuma ───────────────────────── */

/** @param {string} hotelId @param {any} query */
export async function listTickets(hotelId, query) {
  const { skip, take } = toSkipTake(query);
  const where = { hotelId, deletedAt: null };
  if (query.view === 'OPEN') where.status = { in: OPEN_STATUSES };
  if (query.view === 'MINE') {
    const staff = await currentStaffCached(prisma, hotelId);
    // Personel çözülemezse (kimliksiz) kimse eşleşmesin.
    Object.assign(where, { assignedTo: staff?.id ?? '00000000-0000-0000-0000-000000000000', status: { in: OPEN_STATUSES } });
  }
  if (query.status) where.status = query.status;
  if (query.roomId) where.roomId = query.roomId;
  if (query.category) where.category = query.category;

  const [rows, total] = await Promise.all([
    prisma.maintenanceTicket.findMany({ where, include: TICKET_INCLUDE, orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }], skip, take }),
    prisma.maintenanceTicket.count({ where }),
  ]);
  return buildPage(rows.map(toTicketDto), total, query);
}

/** @param {string} hotelId @param {string} id */
export async function getTicket(hotelId, id) {
  const row = await prisma.maintenanceTicket.findFirst({ where: { id, hotelId, deletedAt: null }, include: TICKET_INCLUDE });
  if (!row) throw new NotFoundError('Arıza bileti bulunamadı');
  return toTicketDto(row);
}

/** Bilet servisinin içinden bilet kaydını kilitleyip getirir. */
async function lockTicket(tx, hotelId, id) {
  const [row] = await tx.$queryRaw`SELECT * FROM "MaintenanceTicket" WHERE "id" = ${id} AND "hotelId" = ${hotelId} AND "deletedAt" IS NULL FOR UPDATE`;
  if (!row) throw new NotFoundError('Arıza bileti bulunamadı');
  return row;
}

/* ───────────────────────── Bilet yaşam döngüsü ───────────────────────── */

async function roomNumberOf(hotelId, roomId) {
  if (!roomId) return null;
  const room = await prisma.room.findFirst({ where: { id: roomId, hotelId }, select: { number: true } });
  return room?.number ?? null;
}

/**
 * Arıza bileti açar. `closeRoom` verilirse önce odayı arızaya alır (RoomBlock);
 * oda o tarihlerde doluysa `blockRoom` 409 atar (ekran "misafiri taşı" der) ve
 * bilet açılmaz. `guestRequestId` verilirse istek IN_PROGRESS'e çekilir.
 *
 * @param {string} hotelId
 * @param {object} input
 */
export async function createTicket(hotelId, input) {
  const businessDate = await getBusinessDate(hotelId);
  const roomNumber = await roomNumberOf(hotelId, input.roomId);

  let roomBlockId = null;
  if (input.closeRoom && input.roomId) {
    const block = await blockRoom(hotelId, input.roomId, {
      type: input.closeRoom.type,
      startDate: toIsoDay(businessDate),
      endDate: input.closeRoom.endDate ?? null,
      reason: `Arıza: ${input.title}`,
    });
    roomBlockId = block.id;
  }

  const id = await writeWithEvents(async (tx, stage) => {
    const actor = currentActor();
    const ticket = await tx.maintenanceTicket.create({
      data: {
        hotelId,
        roomId: input.roomId ?? null,
        locationText: input.locationText ?? null,
        category: input.category ?? 'OTHER',
        title: input.title,
        description: input.description,
        priority: input.priority ?? 3,
        source: input.source ?? 'staff',
        reportedBy: actor,
        assignedTo: input.assignedTo ?? null,
        assignedAt: input.assignedTo ? new Date() : null,
        roomBlockId,
        housekeepingTaskId: input.housekeepingTaskId ?? null,
        guestRequestId: input.guestRequestId ?? null,
        planId: input.planId ?? null,
      },
    });

    if (input.guestRequestId) await syncRequest(tx, stage, hotelId, input.guestRequestId, 'IN_PROGRESS');

    await recordAudit(tx, { hotelId, entity: 'MaintenanceTicket', entityId: ticket.id, action: 'CREATE', after: { title: ticket.title, roomId: ticket.roomId, priority: ticket.priority, roomBlockId } });
    await raiseStaffAlert(tx, stage, {
      hotelId,
      kind: 'MAINTENANCE',
      severity: ticket.priority <= 2 ? 'CRITICAL' : 'WARNING',
      title: `${roomNumber ? roomNumber + ' — ' : ''}${ticket.title}`,
      body: ticket.description,
      link: `/teknik-servis/${ticket.id}`,
      userId: ticket.assignedTo ?? null,
      permission: ticket.assignedTo ? null : PERMISSIONS.MAINTENANCE_OPERATE,
      entityType: 'MaintenanceTicket',
      entityId: ticket.id,
      dedupeKey: input.roomId ? `maintenance:${input.roomId}` : null,
    });
    await stage('maintenance.ticket.created', { hotelId, ticketId: ticket.id, roomId: ticket.roomId, priority: ticket.priority, source: ticket.source, roomBlockId });
    return ticket.id;
  });

  return getTicket(hotelId, id);
}

/**
 * Kat görevlisinin "sorun var" bildiriminden bilet açar (housekeeping.issue.reported).
 * Aynı görev için açık bilet varsa tekrar açmaz (idempotent).
 *
 * @param {{ hotelId: string, taskId: string, roomId: string, roomNumber: string, note: string }} payload
 */
export async function createTicketFromIssue(payload) {
  const existing = await prisma.maintenanceTicket.findFirst({
    where: { hotelId: payload.hotelId, housekeepingTaskId: payload.taskId, status: { in: OPEN_STATUSES }, deletedAt: null },
    select: { id: true },
  });
  if (existing) return getTicket(payload.hotelId, existing.id);

  return createTicket(payload.hotelId, {
    roomId: payload.roomId,
    category: 'OTHER',
    title: `${payload.roomNumber} odasında sorun`,
    description: payload.note,
    priority: 3,
    source: 'housekeeping',
    housekeepingTaskId: payload.taskId,
  });
}

/** @param {string} hotelId @param {string} id @param {{ assignedTo: string | null }} input */
export async function assignTicket(hotelId, id, input) {
  await writeWithEvents(async (tx, stage) => {
    const ticket = await lockTicket(tx, hotelId, id);
    assertOpen(ticket);
    await tx.maintenanceTicket.update({ where: { id }, data: { assignedTo: input.assignedTo, assignedAt: input.assignedTo ? new Date() : null } });
    await recordAudit(tx, { hotelId, entity: 'MaintenanceTicket', entityId: id, action: 'UPDATE', after: { assignedTo: input.assignedTo } });
    if (input.assignedTo) {
      await raiseStaffAlert(tx, stage, {
        hotelId, kind: 'MAINTENANCE', severity: 'INFO',
        title: `Size arıza atandı: ${ticket.title}`, body: ticket.description,
        link: `/teknik-servis/${id}`, userId: input.assignedTo,
        entityType: 'MaintenanceTicket', entityId: id,
      });
    }
    await stage('maintenance.ticket.assigned', { hotelId, ticketId: id, assignedTo: input.assignedTo });
  });
  return getTicket(hotelId, id);
}

/** @param {string} hotelId @param {string} id */
export async function startTicket(hotelId, id) {
  // Başlatan kişi (teknisyen) atanmamış bileti üstlenir — atama userId olmalı
  // (currentActor e-posta döndürür; event ve "bana atananlar" uuid ister).
  const staff = await currentStaffCached(prisma, hotelId);
  await writeWithEvents(async (tx, stage) => {
    const ticket = await lockTicket(tx, hotelId, id);
    assertOpen(ticket);
    if (ticket.status === 'IN_PROGRESS') return;
    const assignee = ticket.assignedTo ?? staff?.id ?? null;
    const newlyAssigned = !ticket.assignedTo && assignee;
    await tx.maintenanceTicket.update({
      where: { id },
      data: { status: 'IN_PROGRESS', startedAt: ticket.startedAt ?? new Date(), assignedTo: assignee, assignedAt: ticket.assignedAt ?? (newlyAssigned ? new Date() : null) },
    });
    await recordAudit(tx, { hotelId, entity: 'MaintenanceTicket', entityId: id, action: 'UPDATE', after: { status: 'IN_PROGRESS' } });
    if (newlyAssigned) await stage('maintenance.ticket.assigned', { hotelId, ticketId: id, assignedTo: assignee });
  });
  return getTicket(hotelId, id);
}

/**
 * Bileti çözer. Oda kapatılmışsa arıza kaydını kaldırır (oda kirliye düşer,
 * modül 14 temizlik üretir). Misafir isteğine bağlıysa isteği DONE yapar.
 *
 * @param {string} hotelId @param {string} id @param {{ resolutionNote?: string }} input
 */
export async function resolveTicket(hotelId, id, input) {
  const ticket = await getTicket(hotelId, id);
  assertOpen(ticket);
  if (ticket.roomBlockId) await safeRemoveBlock(hotelId, ticket.roomBlockId);

  await writeWithEvents(async (tx, stage) => {
    const locked = await lockTicket(tx, hotelId, id);
    assertOpen(locked);
    const actor = currentActor();
    await tx.maintenanceTicket.update({ where: { id }, data: { status: 'DONE', resolvedAt: new Date(), resolvedBy: actor, resolutionNote: input.resolutionNote ?? null } });
    if (locked.guestRequestId) await syncRequest(tx, stage, hotelId, locked.guestRequestId, 'DONE', input.resolutionNote);
    await recordAudit(tx, { hotelId, entity: 'MaintenanceTicket', entityId: id, action: 'UPDATE', after: { status: 'DONE' } });
    await stage('maintenance.ticket.resolved', { hotelId, ticketId: id, roomId: locked.roomId });
  });
  return getTicket(hotelId, id);
}

/** @param {string} hotelId @param {string} id @param {{ reason: string }} input */
export async function cancelTicket(hotelId, id, input) {
  const ticket = await getTicket(hotelId, id);
  assertOpen(ticket);
  if (ticket.roomBlockId) await safeRemoveBlock(hotelId, ticket.roomBlockId);

  await writeWithEvents(async (tx, stage) => {
    const locked = await lockTicket(tx, hotelId, id);
    assertOpen(locked);
    await tx.maintenanceTicket.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: input.reason } });
    await recordAudit(tx, { hotelId, entity: 'MaintenanceTicket', entityId: id, action: 'UPDATE', after: { status: 'CANCELLED', reason: input.reason } });
    await stage('maintenance.ticket.cancelled', { hotelId, ticketId: id });
  });
  return getTicket(hotelId, id);
}

/** @param {string} hotelId @param {string} id @param {object} input */
export async function updateTicket(hotelId, id, input) {
  await writeWithEvents(async (tx, stage) => {
    const ticket = await lockTicket(tx, hotelId, id);
    assertOpen(ticket);
    const data = {};
    for (const field of ['category', 'title', 'description', 'priority']) {
      if (input[field] !== undefined) data[field] = input[field];
    }
    if (Object.keys(data).length === 0) return;
    await tx.maintenanceTicket.update({ where: { id }, data });
    await recordAudit(tx, { hotelId, entity: 'MaintenanceTicket', entityId: id, action: 'UPDATE', after: data });
  });
  return getTicket(hotelId, id);
}

/* ───────────────────────── Yardımcılar ───────────────────────── */

/** İstek durumunu bilete göre günceller; geçersiz geçişte sessizce geçer (istek ayrı kapanmış olabilir). */
async function syncRequest(tx, stage, hotelId, requestId, status, note) {
  try {
    await applyRequestStatus(tx, stage, hotelId, requestId, { status, note });
  } catch (error) {
    if (error.code !== 'INVALID_TRANSITION' && error.code !== 'NOT_FOUND') throw error;
  }
}

/** Arıza kaydını kaldırır; zaten kaldırılmışsa / yoksa yutar (çözüm idempotent kalsın). */
async function safeRemoveBlock(hotelId, blockId) {
  try {
    await removeBlock(hotelId, blockId);
  } catch (error) {
    if (error.code !== 'NOT_FOUND' && error.code !== 'BLOCK_ENDED') throw error;
  }
}

/* ───────────────────────── Periyodik bakım planı ───────────────────────── */

export async function listPlans(hotelId, query) {
  const { skip, take } = toSkipTake(query);
  const where = { hotelId, deletedAt: null };
  if (query.active === 'true') where.active = true;
  if (query.active === 'false') where.active = false;
  const [rows, total] = await Promise.all([
    prisma.maintenancePlan.findMany({ where, include: { room: { select: { number: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.maintenancePlan.count({ where }),
  ]);
  return buildPage(rows.map(toPlanDto), total, query);
}

function toPlanDto(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    roomId: row.roomId,
    roomNumber: row.room?.number ?? null,
    locationText: row.locationText,
    intervalDays: row.intervalDays,
    priority: row.priority,
    checklist: row.checklist,
    active: row.active,
    lastRunOn: row.lastRunOn ? toIsoDay(row.lastRunOn) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createPlan(hotelId, input) {
  const plan = await writeWithEvents(async (tx) => {
    const created = await tx.maintenancePlan.create({
      data: {
        hotelId, title: input.title, description: input.description ?? null, category: input.category ?? 'OTHER',
        roomId: input.roomId ?? null, locationText: input.locationText ?? null,
        intervalDays: input.intervalDays, priority: input.priority ?? 3, checklist: input.checklist ?? [], active: input.active ?? true,
      },
    });
    await recordAudit(tx, { hotelId, entity: 'MaintenancePlan', entityId: created.id, action: 'CREATE', after: { title: created.title, intervalDays: created.intervalDays } });
    return created;
  });
  return toPlanDto(plan);
}

export async function updatePlan(hotelId, id, input) {
  const plan = await writeWithEvents(async (tx) => {
    const existing = await tx.maintenancePlan.findFirst({ where: { id, hotelId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Bakım planı bulunamadı');
    const data = {};
    for (const field of ['title', 'description', 'category', 'roomId', 'locationText', 'intervalDays', 'priority', 'checklist', 'active']) {
      if (input[field] !== undefined) data[field] = input[field];
    }
    const updated = await tx.maintenancePlan.update({ where: { id }, data });
    await recordAudit(tx, { hotelId, entity: 'MaintenancePlan', entityId: id, action: 'UPDATE', after: data });
    return updated;
  });
  return toPlanDto(plan);
}

export async function deletePlan(hotelId, id) {
  await writeWithEvents(async (tx) => {
    const existing = await tx.maintenancePlan.findFirst({ where: { id, hotelId, deletedAt: null } });
    if (!existing) throw new NotFoundError('Bakım planı bulunamadı');
    await tx.maintenancePlan.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await recordAudit(tx, { hotelId, entity: 'MaintenancePlan', entityId: id, action: 'DELETE' });
  });
  return { id };
}

/**
 * Zamanlanmış iş: süresi gelen periyodik planlardan bilet üretir. Plan başına
 * en fazla bir açık bilet (tekrar üretmez). Üretince `lastRunOn` iş gününe çekilir.
 *
 * @param {Date} [now]
 * @returns {Promise<number>} üretilen bilet sayısı
 */
export async function generateDuePlanTickets(now = new Date()) {
  const plans = await prisma.maintenancePlan.findMany({ where: { active: true, deletedAt: null }, include: { hotel: { select: { id: true } } } });
  let created = 0;
  for (const plan of plans) {
    const businessDate = await getBusinessDate(plan.hotelId, now);
    if (!isPlanDue(plan, businessDate)) continue;

    // Plandan açık bilet duruyorsa yeni üretme (önceki tamamlanmamış).
    const open = await prisma.maintenanceTicket.findFirst({ where: { planId: plan.id, status: { in: OPEN_STATUSES }, deletedAt: null }, select: { id: true } });
    if (!open) {
      const checklist = Array.isArray(plan.checklist) ? plan.checklist : [];
      const description = checklist.length ? `Kontrol listesi:\n- ${checklist.join('\n- ')}` : (plan.description ?? 'Periyodik bakım');
      await createTicket(plan.hotelId, {
        roomId: plan.roomId ?? undefined,
        locationText: plan.locationText ?? undefined,
        category: plan.category,
        title: plan.title,
        description,
        priority: plan.priority,
        source: 'plan',
        planId: plan.id,
      });
      created += 1;
    }
    await prisma.maintenancePlan.update({ where: { id: plan.id }, data: { lastRunOn: businessDate } });
  }
  return created;
}
