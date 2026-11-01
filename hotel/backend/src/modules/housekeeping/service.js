import { addDays, toIsoDay } from '@hotelos/core';
import {
  HOUSEKEEPING_CHECKOUT_PRIORITY,
  HOUSEKEEPING_CLEANING_TYPES,
  HOUSEKEEPING_DEFAULT_PRIORITY,
  HOUSEKEEPING_TASK_OPEN_STATUSES,
  housekeepingInspectionError,
  housekeepingPriorityForRequest,
  housekeepingTaskTransitionError,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { lockHousekeepingTasks, lockRooms } from '../../lib/locks.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { currentStaff } from '../../lib/staff.js';
import { updateWithVersionCheck } from '../../lib/versioned-update.js';
import { writeWithEvents } from '../../lib/write.js';
import { buildFloorMap, buildStayoverPlan, isCleaningTask, summarizeTasks } from './rules.js';

/**
 * Kat hizmetleri servisi (modül 14).
 *
 * Görev kaydı odanın kat hizmeti durumunu **yazmaz**. Görev olay yayınlar
 * (`housekeeping.task.started/completed`, `housekeeping.room.inspected`);
 * odayı housekeeping-worker günceller (`applySystemRoomState`). Aktör
 * kapalıysa iş manuel göreve düşer — görev kaydı yine doğrudur, yalnızca
 * odanın rengini personel elle değiştirir (modül 3 ekranı). Tek yazıcı
 * kuralı bozulmaz: personel ucu `PATCH /rooms/:id/housekeeping`, sistem ucu
 * aktör.
 *
 * Kilit sırası: oda → görev (bkz. `lib/locks.js`).
 */

const USER_SELECT = Object.freeze({ id: true, name: true });

const TASK_INCLUDE = Object.freeze({
  room: { select: { id: true, number: true, floor: true, occupancy: true, housekeepingStatus: true } },
  assignedTo: { select: USER_SELECT },
  completedBy: { select: USER_SELECT },
  inspectedBy: { select: USER_SELECT },
  guestRequest: { select: { id: true, title: true, category: true, priority: true, status: true } },
});

/** Denetim izine yazılan alanlar — DTO değil, ham kayıt anlık görüntüsü. */
function taskSnapshot(task) {
  return {
    type: task.type,
    status: task.status,
    priority: task.priority,
    scheduledFor: task.scheduledFor,
    assignedToId: task.assignedToId ?? null,
    notes: task.notes ?? null,
    completionNote: task.completionNote ?? null,
    inspectionPassed: task.inspectionPassed ?? null,
    inspectionNote: task.inspectionNote ?? null,
    issueNote: task.issueNote ?? null,
    cancelReason: task.cancelReason ?? null,
  };
}

/**
 * @param {object} row TASK_INCLUDE ile yüklenmiş satır
 * @param {{ businessDate?: Date, arrivalRoomIds?: Set<string> }} [context]
 */
export function toTaskDto(row, context = {}) {
  const { businessDate, arrivalRoomIds } = context;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    priority: row.priority,
    scheduledFor: toIsoDay(row.scheduledFor),
    source: row.source,
    notes: row.notes ?? null,
    room: row.room
      ? {
          id: row.room.id,
          number: row.room.number,
          floor: row.room.floor,
          occupancy: row.room.occupancy,
          housekeepingStatus: row.room.housekeepingStatus,
        }
      : null,
    assignedTo: row.assignedTo ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    completedBy: row.completedBy ?? null,
    completionNote: row.completionNote ?? null,
    inspection:
      row.inspectionPassed === null || row.inspectionPassed === undefined
        ? null
        : { passed: row.inspectionPassed, note: row.inspectionNote ?? null, at: row.inspectedAt, by: row.inspectedBy ?? null },
    issue: row.issueNote ? { note: row.issueNote, at: row.issueReportedAt } : null,
    cancelReason: row.cancelReason ?? null,
    guestRequest: row.guestRequest ?? null,
    /** Bugün bu odaya giriş var: temizlik öne alınmalı (atama temiz odayı seçer). */
    arrivalToday: arrivalRoomIds ? arrivalRoomIds.has(row.roomId) : false,
    /** Önceki günden devreden açık görev. */
    carriedOver: businessDate ? row.scheduledFor.getTime() < businessDate.getTime() : false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Görevin günü penceresi: [gün, ertesi gün). */
function dayWindow(day) {
  return { gte: day, lt: addDays(day, 1) };
}

/**
 * Liste süzgeci. Bugün görüntülenirken önceki günlerden **açık** kalan
 * görevler de dahildir (devreden iş kaybolmaz); geçmiş bir gün istenirse
 * yalnızca o günün kayıtları.
 *
 * @param {string} hotelId
 * @param {Date} day istenen gün (UTC gün başı)
 * @param {Date} businessDate otelin iş günü
 */
function listWhere(hotelId, day, businessDate) {
  const isToday = day.getTime() === businessDate.getTime();
  if (!isToday) return { hotelId, scheduledFor: dayWindow(day) };
  return {
    hotelId,
    OR: [
      { scheduledFor: dayWindow(day) },
      { status: { in: [...HOUSEKEEPING_TASK_OPEN_STATUSES] }, scheduledFor: { lt: day } },
    ],
  };
}

/**
 * Bugün girişi olan odalar: temizlik listesi "oda satışa dönecek" rozetini
 * bununla basar. Opsiyonlu (PENDING) rezervasyon da sayılır — oda atanmışsa
 * akşama misafir bekleniyor demektir.
 *
 * @param {string} hotelId
 * @param {Date} businessDate
 * @param {string[]} roomIds
 * @returns {Promise<Set<string>>}
 */
async function arrivalRoomIdSet(hotelId, businessDate, roomIds) {
  if (roomIds.length === 0) return new Set();
  const rows = await prisma.reservation.findMany({
    where: {
      hotelId,
      roomId: { in: roomIds },
      status: { in: ['PENDING', 'CONFIRMED'] },
      checkIn: dayWindow(businessDate),
    },
    select: { roomId: true },
  });
  return new Set(rows.map((row) => row.roomId));
}

/**
 * Günlük görev listesi (sayfalı).
 *
 * Sıralama iş sırasıdır: açıklar önce (bekleyen → temizlenen), aynı durumda
 * acil olan önce, sonra oda numarası — görevli listeyi yukarıdan aşağı işler.
 *
 * @param {string} hotelId
 * @param {{ date?: Date, status?: string, type?: string, assignedToId?: string, roomId?: string, floor?: number, onlyIssues?: boolean, page: number, pageSize: number }} query
 */
export async function listTasks(hotelId, query) {
  const businessDate = await getBusinessDate(hotelId);
  const day = query.date ?? businessDate;

  const where = { ...listWhere(hotelId, day, businessDate) };
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.assignedToId) where.assignedToId = query.assignedToId;
  if (query.roomId) where.roomId = query.roomId;
  if (query.floor !== undefined) where.room = { floor: query.floor };
  if (query.onlyIssues) where.issueNote = { not: null };

  const [rows, total] = await Promise.all([
    prisma.housekeepingTask.findMany({
      where,
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { room: { number: 'asc' } }],
      ...toSkipTake(query),
      include: TASK_INCLUDE,
    }),
    prisma.housekeepingTask.count({ where }),
  ]);

  const arrivals = await arrivalRoomIdSet(hotelId, businessDate, [...new Set(rows.map((row) => row.roomId))]);
  const page = buildPage(
    rows.map((row) => toTaskDto(row, { businessDate, arrivalRoomIds: arrivals })),
    total,
    query,
  );
  return { ...page, meta: { ...page.meta, date: toIsoDay(day), today: toIsoDay(businessDate) } };
}

/**
 * Günlük özet kartları: bekleyen / temizlenen / biten, kontrol bekleyen ve
 * sorun bildirilen sayıları.
 *
 * @param {string} hotelId
 * @param {{ date?: Date }} [query]
 */
export async function taskSummary(hotelId, query = {}) {
  const businessDate = await getBusinessDate(hotelId);
  const day = query.date ?? businessDate;
  const where = listWhere(hotelId, day, businessDate);

  const [groups, awaitingInspection, issues] = await Promise.all([
    prisma.housekeepingTask.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.housekeepingTask.count({
      where: { ...where, status: 'DONE', type: { in: [...HOUSEKEEPING_CLEANING_TYPES] }, inspectionPassed: null },
    }),
    prisma.housekeepingTask.count({
      where: { ...where, status: { in: [...HOUSEKEEPING_TASK_OPEN_STATUSES] }, issueNote: { not: null } },
    }),
  ]);

  return { date: toIsoDay(day), today: toIsoDay(businessDate), ...summarizeTasks(groups, { awaitingInspection, issues }) };
}

/**
 * Oda durum haritası: kat kat renkli kutular. Kutu rengi odanın kat hizmeti
 * durumudur; açık görev, bugünkü giriş / çıkış ve arıza işaretleri iliştirilir.
 *
 * @param {string} hotelId
 */
export async function floorMap(hotelId) {
  const businessDate = await getBusinessDate(hotelId);
  const today = dayWindow(businessDate);

  const [rooms, openTasks, arrivals, departures, blocks] = await Promise.all([
    prisma.room.findMany({
      select: { id: true, number: true, floor: true, occupancy: true, housekeepingStatus: true },
    }),
    prisma.housekeepingTask.findMany({
      where: { hotelId, status: { in: [...HOUSEKEEPING_TASK_OPEN_STATUSES] } },
      include: { assignedTo: { select: USER_SELECT } },
    }),
    prisma.reservation.findMany({
      where: { hotelId, roomId: { not: null }, status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: today },
      select: { roomId: true },
    }),
    prisma.reservation.findMany({
      where: { hotelId, status: 'CHECKED_IN', checkOut: { lte: businessDate } },
      select: { roomId: true },
    }),
    prisma.roomBlock.findMany({
      where: {
        hotelId,
        startDate: { lte: businessDate },
        OR: [{ endDate: null }, { endDate: { gt: businessDate } }],
      },
      select: { roomId: true },
    }),
  ]);

  const openTaskByRoom = new Map(
    openTasks.map((task) => [
      task.roomId,
      {
        id: task.id,
        type: task.type,
        status: task.status,
        priority: task.priority,
        assignedTo: task.assignedTo ?? null,
        issue: Boolean(task.issueNote),
      },
    ]),
  );

  return {
    date: toIsoDay(businessDate),
    floors: buildFloorMap(
      rooms,
      openTaskByRoom,
      new Set(arrivals.map((row) => row.roomId)),
      new Set(departures.map((row) => row.roomId).filter(Boolean)),
      new Set(blocks.map((row) => row.roomId)),
    ),
  };
}

/**
 * Atama seçicisi: kat hizmeti rolündeki aktif personel ve bugünkü açık görev
 * yükü — toplu atamada şef yükü dengeli dağıtsın.
 *
 * @param {string} hotelId
 */
export async function housekeepingStaff(hotelId) {
  const [staff, loads] = await Promise.all([
    prisma.user.findMany({
      where: { hotelId, isActive: true, role: 'HOUSEKEEPING' },
      select: USER_SELECT,
      orderBy: { name: 'asc' },
    }),
    prisma.housekeepingTask.groupBy({
      by: ['assignedToId'],
      where: { hotelId, status: { in: [...HOUSEKEEPING_TASK_OPEN_STATUSES] }, assignedToId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const loadByUser = new Map(loads.map((row) => [row.assignedToId, row._count._all]));
  return staff.map((user) => ({ ...user, openTasks: loadByUser.get(user.id) ?? 0 }));
}

/**
 * Odanın açık temizlik görevi (varsa) — tekilleştirme buradan okur.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} roomId
 */
function openCleaningTask(tx, hotelId, roomId) {
  return tx.housekeepingTask.findFirst({
    where: {
      hotelId,
      roomId,
      status: { in: [...HOUSEKEEPING_TASK_OPEN_STATUSES] },
      type: { in: [...HOUSEKEEPING_CLEANING_TYPES] },
    },
    include: TASK_INCLUDE,
  });
}

/**
 * Görev oluşturmanın ortak gövdesi — oda kilitliyken çağrılır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<object>} stage
 * @param {string} hotelId
 * @param {{ id: string, number: string }} room
 * @param {{ type: string, priority: number, scheduledFor: Date, notes?: string | null, assignedToId?: string | null, source: string, guestRequestId?: string | null }} input
 */
async function insertTask(tx, stage, hotelId, room, input) {
  const created = await tx.housekeepingTask.create({
    data: {
      hotelId,
      roomId: room.id,
      type: input.type,
      priority: input.priority,
      scheduledFor: input.scheduledFor,
      notes: input.notes ?? null,
      assignedToId: input.assignedToId ?? null,
      source: input.source,
      guestRequestId: input.guestRequestId ?? null,
    },
    include: TASK_INCLUDE,
  });
  await recordAudit(tx, {
    hotelId,
    entity: 'HousekeepingTask',
    entityId: created.id,
    action: 'CREATE',
    before: null,
    after: taskSnapshot(created),
  });
  await stage('housekeeping.task.created', {
    hotelId,
    taskId: created.id,
    roomId: room.id,
    roomNumber: room.number,
    type: created.type,
    priority: created.priority,
    source: input.source,
  });
  return created;
}

/**
 * Personelin elle görev açması (kat şefi).
 *
 * @param {string} hotelId
 * @param {{ roomId: string, type: string, priority: number, scheduledFor?: Date, notes?: string | null, assignedToId?: string | null }} input
 */
export async function createTask(hotelId, input) {
  const businessDate = await getBusinessDate(hotelId);
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockRooms(tx, hotelId, [input.roomId])).has(input.roomId)) throw new NotFoundError('Oda bulunamadı');
    const room = await tx.room.findFirst({ where: { id: input.roomId, hotelId }, select: { id: true, number: true } });

    if (isCleaningTask(input.type)) {
      const existing = await openCleaningTask(tx, hotelId, input.roomId);
      if (existing) {
        throw new ConflictError(`${room.number} odasının zaten açık bir temizlik görevi var`, 'DUPLICATE_TASK');
      }
    }
    if (input.assignedToId) await assertAssignable(tx, hotelId, input.assignedToId);

    const created = await insertTask(tx, stage, hotelId, room, {
      type: input.type,
      priority: input.priority,
      scheduledFor: input.scheduledFor ?? businessDate,
      notes: input.notes,
      assignedToId: input.assignedToId,
      source: 'staff',
    });
    return toTaskDto(created, { businessDate });
  });
}

/**
 * Sistem kaynaklı temizlik görevi (aktör ve zamanlayıcı) — **tekilleştirir**:
 * odanın açık temizlik görevi varsa yenisini açmaz, olanı döndürür. Aynı olay
 * iki yoldan gelirse (çıkış olayı + oda "kirli" haberi) ikinci yol sessizce
 * "zaten var" okur.
 *
 * @param {string} hotelId
 * @param {{ roomId: string, type: string, priority?: number, notes?: string | null }} input
 * @returns {Promise<{ created: boolean, task: object }>}
 */
export async function createSystemCleaningTask(hotelId, input) {
  const businessDate = await getBusinessDate(hotelId);
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockRooms(tx, hotelId, [input.roomId])).has(input.roomId)) throw new NotFoundError('Oda bulunamadı');
    const room = await tx.room.findFirst({ where: { id: input.roomId, hotelId }, select: { id: true, number: true } });

    const existing = await openCleaningTask(tx, hotelId, input.roomId);
    if (existing) return { created: false, task: toTaskDto(existing, { businessDate }) };

    const created = await insertTask(tx, stage, hotelId, room, {
      type: input.type,
      priority: input.priority ?? HOUSEKEEPING_CHECKOUT_PRIORITY,
      scheduledFor: businessDate,
      notes: input.notes,
      source: 'system',
    });
    return { created: true, task: toTaskDto(created, { businessDate }) };
  });
}

/**
 * Misafir isteğinden görev (modül 7 → 14). İstek başına tek açık görev.
 *
 * @param {string} hotelId
 * @param {{ requestId: string, roomId: string, priority: string }} input istek olayının yükü
 * @returns {Promise<{ created: boolean, task: object | null }>}
 */
export async function createRequestTask(hotelId, input) {
  const businessDate = await getBusinessDate(hotelId);
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockRooms(tx, hotelId, [input.roomId])).has(input.roomId)) throw new NotFoundError('Oda bulunamadı');
    const room = await tx.room.findFirst({ where: { id: input.roomId, hotelId }, select: { id: true, number: true } });

    const request = await tx.guestRequest.findFirst({
      where: { id: input.requestId, hotelId },
      select: { id: true, title: true, status: true },
    });
    if (!request) throw new NotFoundError('İstek bulunamadı');
    // İstek bu arada kapanmış olabilir (personel istek ekranından halletti).
    if (!['OPEN', 'IN_PROGRESS'].includes(request.status)) return { created: false, task: null };

    const existing = await tx.housekeepingTask.findFirst({
      where: { hotelId, guestRequestId: request.id, status: { in: [...HOUSEKEEPING_TASK_OPEN_STATUSES] } },
      include: TASK_INCLUDE,
    });
    if (existing) return { created: false, task: toTaskDto(existing, { businessDate }) };

    const created = await insertTask(tx, stage, hotelId, room, {
      type: 'GUEST_REQUEST',
      priority: housekeepingPriorityForRequest(input.priority),
      scheduledFor: businessDate,
      notes: request.title,
      source: 'system',
      guestRequestId: request.id,
    });
    return { created: true, task: toTaskDto(created, { businessDate }) };
  });
}

/**
 * Çıkış geri alındı: odanın açık çıkış temizliği görevi iptal edilir (misafir
 * hâlâ içeride; görevli kapıyı çalmasın).
 *
 * @param {string} hotelId
 * @param {string} roomId
 * @param {string} reason
 * @returns {Promise<{ cancelled: number }>}
 */
export async function cancelOpenCheckoutTasks(hotelId, roomId, reason) {
  return writeWithEvents(async (tx, stage) => {
    if (!(await lockRooms(tx, hotelId, [roomId])).has(roomId)) throw new NotFoundError('Oda bulunamadı');
    const open = await tx.housekeepingTask.findMany({
      where: { hotelId, roomId, type: 'CHECKOUT_CLEAN', status: { in: [...HOUSEKEEPING_TASK_OPEN_STATUSES] } },
      include: TASK_INCLUDE,
    });
    await lockHousekeepingTasks(tx, hotelId, open.map((task) => task.id));

    for (const task of open) {
      const updated = await tx.housekeepingTask.update({
        where: { id: task.id },
        data: { status: 'CANCELLED', cancelReason: reason },
        include: TASK_INCLUDE,
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'HousekeepingTask',
        entityId: task.id,
        action: 'UPDATE',
        before: taskSnapshot(task),
        after: taskSnapshot(updated),
      });
      await stage('housekeeping.task.changed', {
        hotelId,
        taskId: task.id,
        roomId,
        changedFields: ['status', 'cancelReason'],
      });
    }
    return { cancelled: open.length };
  });
}

/**
 * Atanacak kişi bu otelin aktif personeli mi?
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} userId
 */
async function assertAssignable(tx, hotelId, userId) {
  const user = await tx.user.findFirst({ where: { id: userId, hotelId, isActive: true }, select: { id: true } });
  if (!user) throw new ConflictError('Görevli bulunamadı ya da pasif', 'ASSIGNEE_NOT_FOUND');
}

/**
 * Toplu atama (kat şefi sabah dağıtımı). Yalnızca açık görevler atanır;
 * kapanmış görev sessizce atlanmaz, hata döner — şef bayat listeye bakıyordur.
 *
 * @param {string} hotelId
 * @param {{ taskIds: string[], assignedToId: string | null }} input
 */
export async function assignTasks(hotelId, input) {
  const businessDate = await getBusinessDate(hotelId);
  return writeWithEvents(async (tx, stage) => {
    if (input.assignedToId) await assertAssignable(tx, hotelId, input.assignedToId);

    const locked = await lockHousekeepingTasks(tx, hotelId, input.taskIds);
    const missing = input.taskIds.filter((id) => !locked.has(id));
    if (missing.length > 0) throw new NotFoundError('Görev bulunamadı (listeyi yenileyin)');

    const tasks = await tx.housekeepingTask.findMany({
      where: { id: { in: input.taskIds }, hotelId },
      include: TASK_INCLUDE,
    });
    const closed = tasks.filter((task) => !HOUSEKEEPING_TASK_OPEN_STATUSES.includes(task.status));
    if (closed.length > 0) {
      throw new ConflictError(
        `${closed.length} görev kapanmış (bitti / iptal); listeyi yenileyip tekrar deneyin`,
        'TASK_CLOSED',
      );
    }

    for (const task of tasks) {
      if (task.assignedToId === input.assignedToId) continue;
      const updated = await tx.housekeepingTask.update({
        where: { id: task.id },
        data: { assignedToId: input.assignedToId },
        include: TASK_INCLUDE,
      });
      await recordAudit(tx, {
        hotelId,
        entity: 'HousekeepingTask',
        entityId: task.id,
        action: 'UPDATE',
        before: taskSnapshot(task),
        after: taskSnapshot(updated),
      });
    }

    await stage('housekeeping.tasks.assigned', {
      hotelId,
      taskIds: input.taskIds,
      assignedToId: input.assignedToId,
    });

    const fresh = await tx.housekeepingTask.findMany({ where: { id: { in: input.taskIds } }, include: TASK_INCLUDE });
    return fresh.map((task) => toTaskDto(task, { businessDate }));
  });
}

/**
 * Görevi yazım için yükler: oda → görev kilit sırası korunur.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} hotelId
 * @param {string} taskId
 */
async function loadTaskForUpdate(tx, hotelId, taskId) {
  const stub = await tx.housekeepingTask.findFirst({ where: { id: taskId, hotelId }, select: { roomId: true } });
  if (!stub) throw new NotFoundError('Görev bulunamadı');
  await lockRooms(tx, hotelId, [stub.roomId]);
  if (!(await lockHousekeepingTasks(tx, hotelId, [taskId])).has(taskId)) throw new NotFoundError('Görev bulunamadı');
  return tx.housekeepingTask.findFirst({ where: { id: taskId, hotelId }, include: TASK_INCLUDE });
}

/**
 * Durum geçişli güncellemenin ortak gövdesi.
 *
 * @param {string} hotelId
 * @param {string} taskId
 * @param {{
 *   to?: string,
 *   expectedUpdatedAt: Date,
 *   data: (task: object, staff: { id: string } | null) => object | Promise<object>,
 *   guard?: (task: object, staff: { id: string } | null) => void | Promise<void>,
 *   events: (task: object, updated: object) => Array<{ name: string, payload: object }>,
 * }} input
 */
async function transitionTask(hotelId, taskId, { to, expectedUpdatedAt, data, guard, events }) {
  const businessDate = await getBusinessDate(hotelId);
  return writeWithEvents(async (tx, stage) => {
    const task = await loadTaskForUpdate(tx, hotelId, taskId);
    const staff = await currentStaff(tx, hotelId);

    if (to) {
      const transitionError = housekeepingTaskTransitionError(task.status, to);
      if (transitionError) throw new ConflictError(transitionError, 'INVALID_TRANSITION');
    }
    if (guard) await guard(task, staff);

    await updateWithVersionCheck(
      tx,
      'housekeepingTask',
      { id: taskId, hotelId },
      expectedUpdatedAt,
      await data(task, staff),
      'Görev bulunamadı',
    );

    const updated = await tx.housekeepingTask.findFirst({ where: { id: taskId, hotelId }, include: TASK_INCLUDE });
    await recordAudit(tx, {
      hotelId,
      entity: 'HousekeepingTask',
      entityId: taskId,
      action: 'UPDATE',
      before: taskSnapshot(task),
      after: taskSnapshot(updated),
    });
    for (const event of events(task, updated)) await stage(event.name, event.payload);
    return { task, updated, businessDate };
  });
}

/**
 * "Başladım": görev temizlenene geçer; sahipsizse üstlenen kişiye atanır.
 * Başkasına atanmış görevi başlatmak hata — şef önce atamayı değiştirsin.
 *
 * @param {string} hotelId
 * @param {string} taskId
 * @param {{ expectedUpdatedAt: Date }} input
 */
export async function startTask(hotelId, taskId, input) {
  const { updated, businessDate } = await transitionTask(hotelId, taskId, {
    to: 'IN_PROGRESS',
    expectedUpdatedAt: input.expectedUpdatedAt,
    guard: (task, staff) => {
      if (task.assignedToId && staff && task.assignedToId !== staff.id) {
        throw new ConflictError('Görev başka görevliye atanmış; önce atamayı değiştirin', 'ASSIGNED_ELSEWHERE');
      }
    },
    data: (task, staff) => ({
      status: 'IN_PROGRESS',
      startedAt: task.startedAt ?? new Date(),
      assignedToId: task.assignedToId ?? staff?.id ?? null,
    }),
    events: (task, fresh) => [
      {
        name: 'housekeeping.task.started',
        payload: { hotelId, taskId, roomId: fresh.roomId, roomNumber: fresh.room.number, type: fresh.type },
      },
    ],
  });
  return toTaskDto(updated, { businessDate });
}

/**
 * "Bitti": görev kapanır. Oda durumunu aktör günceller; bağlı misafir isteğini
 * de aktör kapatır (`housekeeping.task.completed` dinleyicisi).
 *
 * @param {string} hotelId
 * @param {string} taskId
 * @param {{ expectedUpdatedAt: Date, note?: string | null }} input
 */
export async function completeTask(hotelId, taskId, input) {
  const now = new Date();
  const { updated, businessDate } = await transitionTask(hotelId, taskId, {
    to: 'DONE',
    expectedUpdatedAt: input.expectedUpdatedAt,
    data: (task, staff) => ({
      status: 'DONE',
      startedAt: task.startedAt ?? now,
      completedAt: now,
      completedById: staff?.id ?? null,
      completionNote: input.note ?? null,
      assignedToId: task.assignedToId ?? staff?.id ?? null,
    }),
    events: (task, fresh) => [
      {
        name: 'housekeeping.task.completed',
        payload: {
          hotelId,
          taskId,
          roomId: fresh.roomId,
          roomNumber: fresh.room.number,
          type: fresh.type,
          guestRequestId: fresh.guestRequestId ?? null,
        },
      },
    ],
  });
  return toTaskDto(updated, { businessDate });
}

/**
 * "Sorun var": görev açık kalır (temizlik yarım), sorun kaydedilir ve teknik
 * servise haber gider. Arıza kaydını bu modül açmaz — `blockRoom` modül 3'te,
 * kaydı `rooms.operate` yetkilisi açar (modül 20 gelene dek manuel görev).
 *
 * @param {string} hotelId
 * @param {string} taskId
 * @param {{ expectedUpdatedAt: Date, note: string }} input
 */
export async function reportIssue(hotelId, taskId, input) {
  const { updated, businessDate } = await transitionTask(hotelId, taskId, {
    expectedUpdatedAt: input.expectedUpdatedAt,
    guard: (task) => {
      if (!HOUSEKEEPING_TASK_OPEN_STATUSES.includes(task.status)) {
        throw new ConflictError('Kapanmış göreve sorun bildirilemez', 'TASK_CLOSED');
      }
    },
    data: () => ({ issueNote: input.note, issueReportedAt: new Date() }),
    events: (task, fresh) => [
      {
        name: 'housekeeping.issue.reported',
        payload: { hotelId, taskId, roomId: fresh.roomId, roomNumber: fresh.room.number, note: input.note },
      },
    ],
  });
  return toTaskDto(updated, { businessDate });
}

/**
 * Kat şefi kontrolü. Geçtiyse oda "kontrol edildi"ye, kalırsa yeniden
 * "kirli"ye döner (ikisini de aktör yazar) ve **aynı işlemde** öncelikli bir
 * düzeltme görevi açılır — reddedilen oda sahipsiz kalmaz.
 *
 * @param {string} hotelId
 * @param {string} taskId
 * @param {{ expectedUpdatedAt: Date, passed: boolean, note?: string | null }} input
 */
export async function inspectTask(hotelId, taskId, input) {
  const businessDate = await getBusinessDate(hotelId);
  return writeWithEvents(async (tx, stage) => {
    const task = await loadTaskForUpdate(tx, hotelId, taskId);
    const staff = await currentStaff(tx, hotelId);

    const inspectionError = housekeepingInspectionError(task, staff?.id ?? null);
    if (inspectionError) throw new ConflictError(inspectionError, 'INSPECTION_NOT_ALLOWED');

    await updateWithVersionCheck(
      tx,
      'housekeepingTask',
      { id: taskId, hotelId },
      input.expectedUpdatedAt,
      {
        inspectionPassed: input.passed,
        inspectedById: staff?.id ?? null,
        inspectedAt: new Date(),
        inspectionNote: input.note ?? null,
      },
      'Görev bulunamadı',
    );
    const updated = await tx.housekeepingTask.findFirst({ where: { id: taskId, hotelId }, include: TASK_INCLUDE });
    await recordAudit(tx, {
      hotelId,
      entity: 'HousekeepingTask',
      entityId: taskId,
      action: 'UPDATE',
      before: taskSnapshot(task),
      after: taskSnapshot(updated),
    });
    await stage('housekeeping.room.inspected', {
      hotelId,
      taskId,
      roomId: updated.roomId,
      roomNumber: updated.room.number,
      passed: input.passed,
      note: input.note ?? null,
    });

    let followUp = null;
    if (!input.passed) {
      followUp = await insertTask(tx, stage, hotelId, updated.room, {
        type: updated.type,
        priority: Math.min(updated.priority, HOUSEKEEPING_CHECKOUT_PRIORITY),
        scheduledFor: businessDate,
        notes: `Kontrolden döndü: ${input.note}`,
        assignedToId: updated.assignedToId,
        source: 'system',
      });
    }

    return {
      task: toTaskDto(updated, { businessDate }),
      followUpTask: followUp ? toTaskDto(followUp, { businessDate }) : null,
    };
  });
}

/**
 * Görev iptali (şef): sebep zorunlu, kapanmış görev iptal edilemez.
 *
 * @param {string} hotelId
 * @param {string} taskId
 * @param {{ expectedUpdatedAt: Date, reason: string }} input
 */
export async function cancelTask(hotelId, taskId, input) {
  const { updated, businessDate } = await transitionTask(hotelId, taskId, {
    to: 'CANCELLED',
    expectedUpdatedAt: input.expectedUpdatedAt,
    data: () => ({ status: 'CANCELLED', cancelReason: input.reason }),
    events: (task, fresh) => [
      {
        name: 'housekeeping.task.changed',
        payload: { hotelId, taskId, roomId: fresh.roomId, changedFields: ['status', 'cancelReason'] },
      },
    ],
  });
  return toTaskDto(updated, { businessDate });
}

/**
 * Sabah üretimi: içeride misafiri olan ve bugün çıkmayacak her odaya STAYOVER
 * görevi. Her 10 dakikada bir koşar; o güne görevi (hangi durumda olursa
 * olsun) ya da açık temizlik görevi olan oda atlanır — ikinci koşu hiçbir şey
 * üretmez (idempotent). Oda kilitleri çıkış olayını işleyen aktörle yarışı
 * sıraya sokar; kısmi tekil index son emniyettir.
 *
 * @param {{ now?: Date }} [options]
 * @returns {Promise<number>} açılan görev sayısı (bütün oteller)
 */
export async function generateStayoverTasks({ now = new Date() } = {}) {
  const hotels = await prisma.hotel.findMany({ select: { id: true } });
  let createdTotal = 0;

  for (const { id: hotelId } of hotels) {
    const businessDate = await getBusinessDate(hotelId, now);
    const today = dayWindow(businessDate);

    const [stays, existing] = await Promise.all([
      prisma.reservation.findMany({
        where: { hotelId, status: 'CHECKED_IN', roomId: { not: null } },
        select: { roomId: true, checkOut: true },
      }),
      prisma.housekeepingTask.findMany({
        where: {
          hotelId,
          type: { in: [...HOUSEKEEPING_CLEANING_TYPES] },
          OR: [{ scheduledFor: today }, { status: { in: [...HOUSEKEEPING_TASK_OPEN_STATUSES] } }],
        },
        select: { roomId: true },
      }),
    ]);

    const plan = buildStayoverPlan({
      businessDate,
      stays,
      skipRoomIds: existing.map((row) => row.roomId),
    });
    if (plan.length === 0) continue;

    const created = await writeWithEvents(async (tx, stage) => {
      const lockedRooms = await lockRooms(tx, hotelId, plan);
      // Kilit altında yeniden bak: olay işleyen aktör bu arada görev açmış olabilir.
      const nowExisting = await tx.housekeepingTask.findMany({
        where: {
          hotelId,
          roomId: { in: [...lockedRooms] },
          type: { in: [...HOUSEKEEPING_CLEANING_TYPES] },
          OR: [{ scheduledFor: today }, { status: { in: [...HOUSEKEEPING_TASK_OPEN_STATUSES] } }],
        },
        select: { roomId: true },
      });
      const skip = new Set(nowExisting.map((row) => row.roomId));
      const roomIds = [...lockedRooms].filter((roomId) => !skip.has(roomId));
      if (roomIds.length === 0) return 0;

      await tx.housekeepingTask.createMany({
        data: roomIds.map((roomId) => ({
          hotelId,
          roomId,
          type: 'STAYOVER',
          priority: HOUSEKEEPING_DEFAULT_PRIORITY,
          scheduledFor: businessDate,
          source: 'system',
        })),
      });
      await stage('housekeeping.tasks.generated', {
        hotelId,
        date: toIsoDay(businessDate),
        count: roomIds.length,
      });
      return roomIds.length;
    });
    createdTotal += created;
  }

  return createdTotal;
}
