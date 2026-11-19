import { currentActor } from '@hotelos/core';
import { SPA_MAX_ADVANCE_DAYS, spaDaysBetween, spaRepeatDays } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { AppError, ConflictError, NotFoundError, StaleWriteError, ValidationError, rethrowPrismaError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';
import { APPOINTMENT_SELECT, appointmentView, completeLocked, lockedAppointment, spaViewContext } from './appointments.js';
import { sendSpaNotification } from './notify.js';
import { spaListPrice, spaTotal } from './rules.js';
import { loadBookableService, placeOnBoard, writeHolds } from './schedule.js';
import { adjustSeats, promoteWaitlist, resolveSpaCustomer } from './seats.js';
import { dayBounds, iso, loadSpaSettings, lockSpaSessions, minutesAfter, money, nextSpaCode, prisma, sameVersion, spaContext, wallParts, wallToUtc } from './shared.js';

/**
 * Grup dersi (modül 57): seans (eğitmen + salon + kontenjan) ve kayıtlar.
 *
 * - Seans eğitmeni ve salonu birebir randevuyla **aynı tutma tablosunda** tutar: eğitmenin o saatte randevusu, salonun
 *   başka dersi olamaz.
 * - Kayıt bir `SpaAppointment` satırıdır (`sessionId` dolu): ücret, iptal bedeli, ödeme ve odaya yazma birebir
 *   randevuyla aynı kurallarla işler. Kontenjan seans satırı kilitliyken sayılır; dolunca istenirse **yedek liste**,
 *   yer açılınca sırayla asıla geçer.
 * - "Her hafta tekrarla" seçilen günlere ayrı ayrı seans açar; çakışan gün atlanır ve sebebiyle döner (diğerleri açılır).
 * - Dersi tamamlamak katılanların ücretini işler: oteldeki misafirin odasına, diğerlerinin bakiyesine. Kalabalık derste
 *   iş süre bütçesiyle parça parça yürür (`pending`; ekran kendiliğinden devam eder).
 */

/** Seans ekranında gösterilen en fazla kayıt (kontenjan 500 + yedekler + iptaller). */
const ENROLLMENT_LIMIT = 1000;
/** Toplu tamamlamanın süre bütçesi. */
const COMPLETE_BUDGET_MS = 20_000;
/** Saati değişen seansın kayıtlılarına bir seferde gönderilen en fazla bildirim. */
const NOTIFY_LIMIT = 200;

const SESSION_SELECT = Object.freeze({
  id: true,
  serviceId: true,
  serviceName: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  price: true,
  status: true,
  note: true,
  bookedCount: true,
  waitlistCount: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  completedAt: true,
  holds: { select: { therapistId: true, roomId: true, endsAt: true, therapist: { select: { name: true } }, room: { select: { name: true } } } },
});

/** @param {any} row @param {{ timezone: string, taxes: any[], now: Date }} view */
export function sessionView(row, { timezone, taxes, now }) {
  const start = wallParts(row.startsAt, timezone);
  const instructor = row.holds.find((hold) => hold.therapistId);
  const room = row.holds.find((hold) => hold.roomId);
  const price = money(row.price);
  return {
    id: row.id,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    startsAtWall: start.wall,
    day: start.day,
    time: start.time,
    endTime: wallParts(row.endsAt, timezone).time,
    started: row.startsAt <= now,
    capacity: row.capacity,
    bookedCount: row.bookedCount,
    waitlistCount: row.waitlistCount,
    free: Math.max(0, row.capacity - row.bookedCount),
    price,
    priceTotal: spaTotal(price, taxes),
    status: row.status,
    note: row.note,
    instructor: instructor ? { id: instructor.therapistId, name: instructor.therapist?.name ?? '—' } : null,
    room: room ? { id: room.roomId, name: room.room?.name ?? '—' } : null,
    updatedAt: iso(row.updatedAt),
    cancelledAt: iso(row.cancelledAt),
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
    completedAt: iso(row.completedAt),
  };
}

/* ══════════════════ Okuma ══════════════════ */

/**
 * Seans listesi (gün aralığı, başlangıç sırasıyla).
 * @param {string} hotelId @param {{ from: string, to: string, serviceId?: string, status?: string, page: number, pageSize: number }} query
 */
export async function listSpaSessions(hotelId, query) {
  const view = await spaViewContext(hotelId);
  const where = {
    hotelId,
    startsAt: { gte: dayBounds(query.from, view.timezone).start, lt: dayBounds(query.to, view.timezone).end },
    ...(query.serviceId ? { serviceId: query.serviceId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.spaSession.findMany({ where, select: SESSION_SELECT, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], ...toSkipTake(query) }),
    prisma.spaSession.count({ where }),
  ]);
  return { ...buildPage(rows.map((row) => sessionView(row, view)), total, query), currency: view.currency };
}

/**
 * Seansın ayrıntısı ve kayıtları (asıl → yedek → kapananlar; kayıt sırasıyla).
 * @param {string} hotelId @param {string} sessionId
 */
export async function getSpaSession(hotelId, sessionId) {
  const view = await spaViewContext(hotelId);
  const [row, enrollments] = await Promise.all([
    prisma.spaSession.findFirst({ where: { id: sessionId, hotelId }, select: SESSION_SELECT }),
    prisma.spaAppointment.findMany({ where: { hotelId, sessionId }, select: APPOINTMENT_SELECT, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: ENROLLMENT_LIMIT }),
  ]);
  if (!row) throw new NotFoundError('Seans bulunamadı');
  const order = { BOOKED: 0, COMPLETED: 0, WAITLISTED: 1, NO_SHOW: 2, CANCELLED: 3 };
  return {
    session: sessionView(row, view),
    currency: view.currency,
    enrollments: enrollments.map((item) => appointmentView(item, view)).sort((a, b) => order[a.status] - order[b.status]),
  };
}

/* ══════════════════ Seans aç ══════════════════ */

/**
 * Seans(lar) açar. Tekrar verilmişse seçilen hafta günlerine bitiş gününe kadar ayrı seanslar; her gün kendi
 * işleminde — eğitmen ya da salon dolu olan gün atlanır ve sebebi döner.
 *
 * @param {string} hotelId
 * @param {{ serviceId: string, startsAt: string, therapistId: string | null, roomId: string | null, capacity: number | null, price: string | null, note?: string | null, repeat: { weekdays: number[], until: string } | null }} input
 * @param {{ now?: Date }} [options]
 */
export async function createSpaSessions(hotelId, input, { now = new Date() } = {}) {
  const [context, settings] = await Promise.all([spaContext(hotelId, now), loadSpaSettings(prisma, hotelId)]);
  const service = await loadBookableService(prisma, hotelId, input.serviceId, { kind: 'GROUP' });
  const firstDay = input.startsAt.slice(0, 10);
  const time = input.startsAt.slice(11);
  if (firstDay < context.today) throw new ValidationError('Geçmiş güne seans açılmaz.', { field: 'startsAt' });
  if (spaDaysBetween(context.today, firstDay) > SPA_MAX_ADVANCE_DAYS) throw new ValidationError(`Seans en fazla ${SPA_MAX_ADVANCE_DAYS} gün ileriye açılır.`, { field: 'startsAt' });
  if (service.therapistCount === 0 && input.therapistId) throw new ValidationError('Bu ders eğitmen gerektirmez.', { field: 'therapistId' });
  if (!service.requiresRoom && input.roomId) throw new ValidationError('Bu ders salon gerektirmez.', { field: 'roomId' });
  const days = input.repeat ? spaRepeatDays({ day: firstDay, weekdays: input.repeat.weekdays, until: input.repeat.until }) : [firstDay];
  const capacity = input.capacity ?? /** @type {number} */ (service.capacity);
  const price = input.price ?? money(service.price);
  const actor = currentActor();

  const created = [];
  const skipped = [];
  for (const localDay of days) {
    const startsAt = wallToUtc(`${localDay}T${time}`, context.timezone);
    try {
      const id = await writeWithEvents(async (tx, stage) => {
        const place = await placeOnBoard(tx, hotelId, { service, startsAt, timezone: context.timezone, settings, therapistIds: input.therapistId ? [input.therapistId] : null, roomId: input.roomId });
        const row = await tx.spaSession.create({
          data: { hotelId, serviceId: service.id, serviceName: service.name, startsAt, endsAt: place.endsAt, capacity, price, note: input.note ?? null, createdBy: actor },
          select: { id: true },
        });
        await writeHolds(tx, hotelId, { sessionId: row.id, therapistIds: place.therapistIds, roomId: place.roomId, startsAt, busyUntil: place.busyUntil });
        await recordAudit(tx, { hotelId, entity: 'SpaSession', entityId: row.id, action: 'CREATE', after: { service: service.name, startsAt: iso(startsAt), capacity, price, therapistIds: place.therapistIds, roomId: place.roomId } });
        await stage('spa.session.changed', { hotelId, sessionId: row.id, change: 'CREATED' });
        return row.id;
      });
      created.push({ id, day: localDay });
    } catch (error) {
      let mapped = error;
      try {
        rethrowPrismaError(error);
      } catch (typed) {
        mapped = typed;
      }
      // Tek seansta hata doğrudan döner (form alanın altına yazar); tekrarda o gün atlanır.
      if (days.length === 1 || !(mapped instanceof AppError) || mapped.statusCode >= 500) throw mapped;
      skipped.push({ day: localDay, message: mapped.message });
    }
  }
  return { created, skipped };
}

/* ══════════════════ Seansı düzenle ══════════════════ */

/**
 * Planlı seansı düzenler: saat, eğitmen, salon, kontenjan, not. Saat değişince kayıtların saati de değişir ve
 * kayıtlı misafirlere yeni saatle onay gider; kontenjan artınca yedek liste asıla geçer; kontenjan asıl listenin
 * altına inemez.
 *
 * @param {string} hotelId @param {string} sessionId
 * @param {{ expectedUpdatedAt: Date, startsAt?: string, therapistId?: string | null, roomId?: string | null, capacity?: number, note?: string | null }} input
 * @param {{ now?: Date, logger?: any }} [options]
 */
export async function updateSpaSession(hotelId, sessionId, input, { now = new Date(), logger = console } = {}) {
  const [context, settings] = await Promise.all([spaContext(hotelId, now), loadSpaSettings(prisma, hotelId)]);
  /** @type {string[]} */
  let notify = [];
  try {
    notify = await writeWithEvents(async (tx, stage) => {
      if (!(await lockSpaSessions(tx, hotelId, [sessionId])).has(sessionId)) throw new NotFoundError('Seans bulunamadı');
      const row = await tx.spaSession.findFirst({ where: { id: sessionId, hotelId }, select: SESSION_SELECT });
      if (!sameVersion(row.updatedAt, input.expectedUpdatedAt)) throw new StaleWriteError();
      if (row.status !== 'SCHEDULED') throw new ConflictError('Yalnız planlı seans düzenlenir.', 'SPA_NOT_OPEN');
      /** @type {any} */
      const data = {};
      if (input.note !== undefined) data.note = input.note;
      if (input.capacity !== undefined) {
        if (input.capacity < row.bookedCount) throw new ValidationError(`Asıl listede ${row.bookedCount} kişi var; kontenjan bunun altına inemez.`, { field: 'capacity' });
        data.capacity = input.capacity;
      }
      let timeChanged = false;
      let placement = null;
      if (input.startsAt !== undefined || input.therapistId !== undefined || input.roomId !== undefined) {
        const startsAt = input.startsAt !== undefined ? wallToUtc(input.startsAt, context.timezone) : row.startsAt;
        timeChanged = startsAt.getTime() !== row.startsAt.getTime();
        if (timeChanged && input.startsAt.slice(0, 10) < context.today) throw new ValidationError('Seans geçmiş güne taşınamaz.', { field: 'startsAt' });
        const instructor = row.holds.find((hold) => hold.therapistId);
        const room = row.holds.find((hold) => hold.roomId);
        const durationMinutes = Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);
        // Tutma, dersin bitişi + temizlik arasına kadar sürer: ara oradan okunur.
        const holdEnd = (instructor ?? room)?.endsAt ?? row.endsAt;
        const bufferMinutes = Math.max(0, Math.round((holdEnd.getTime() - row.endsAt.getTime()) / 60_000));
        const therapistId = input.therapistId === undefined ? (instructor?.therapistId ?? null) : input.therapistId;
        const roomId = input.roomId === undefined ? (room?.roomId ?? null) : input.roomId;
        if (instructor && !therapistId) throw new ValidationError('Eğitmen seçin.', { field: 'therapistId' });
        if (room && !roomId) throw new ValidationError('Salon seçin.', { field: 'roomId' });
        if (!instructor && therapistId) throw new ValidationError('Bu ders eğitmen gerektirmez.', { field: 'therapistId' });
        if (!room && roomId) throw new ValidationError('Bu ders salon gerektirmez.', { field: 'roomId' });
        placement = await placeOnBoard(tx, hotelId, {
          service: { id: row.serviceId, therapistCount: instructor ? 1 : 0, requiresRoom: Boolean(room), durationMinutes, bufferMinutes },
          startsAt,
          timezone: context.timezone,
          settings,
          therapistIds: therapistId ? [therapistId] : null,
          roomId,
          ignoreSessionId: row.id,
          onGrid: timeChanged,
        });
        await tx.spaHold.deleteMany({ where: { sessionId: row.id } });
        await writeHolds(tx, hotelId, { sessionId: row.id, therapistIds: placement.therapistIds, roomId: placement.roomId, startsAt, busyUntil: placement.busyUntil });
        if (timeChanged) {
          Object.assign(data, { startsAt, endsAt: placement.endsAt });
          await tx.spaAppointment.updateMany({ where: { sessionId: row.id, status: { in: ['BOOKED', 'WAITLISTED'] } }, data: { startsAt, endsAt: placement.endsAt, busyUntil: placement.endsAt, reminderSentAt: null } });
        }
      }
      await tx.spaSession.update({ where: { id: row.id }, data: { ...data, updatedAt: new Date() } });
      const promoted = data.capacity !== undefined && data.capacity > row.capacity ? await promoteWaitlist(tx, stage, { hotelId, sessionId: row.id }) : [];
      await recordAudit(tx, {
        hotelId,
        entity: 'SpaSession',
        entityId: row.id,
        action: 'UPDATE',
        before: { startsAt: iso(row.startsAt), capacity: row.capacity, note: row.note, therapistId: row.holds.find((hold) => hold.therapistId)?.therapistId ?? null, roomId: row.holds.find((hold) => hold.roomId)?.roomId ?? null },
        after: { startsAt: iso(data.startsAt ?? row.startsAt), capacity: data.capacity ?? row.capacity, note: data.note ?? row.note, therapistIds: placement?.therapistIds, roomId: placement?.roomId },
      });
      await stage('spa.session.changed', { hotelId, sessionId: row.id, change: 'UPDATED' });
      if (!timeChanged) return promoted;
      const booked = await tx.spaAppointment.findMany({ where: { sessionId: row.id, status: 'BOOKED', reservationId: { not: null } }, select: { id: true }, take: NOTIFY_LIMIT });
      return [...new Set([...promoted, ...booked.map((item) => item.id)])];
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  for (const id of notify) await sendSpaNotification(hotelId, id, 'SPA_BOOKED', logger);
  return getSpaSession(hotelId, sessionId);
}

/* ══════════════════ Seansı iptal et ══════════════════ */

/**
 * Seansı iptal eder: eğitmen ve salon boşalır, asıl ve yedek bütün kayıtlar **bedelsiz** kapanır (tek ifadeyle —
 * kalabalık derste de tek işlem). Ön ödemesi olan kayıtlar eksi bakiyeyle "Açık bakiyeler"de kalır (iade edilecek).
 * Kayıtlı misafirlere haber vermek spa'nın işidir; kaç kişi olduğu cevapta ve zilde yazar.
 *
 * @param {string} hotelId @param {string} sessionId @param {{ expectedUpdatedAt: Date, reason: string }} input
 * @param {{ now?: Date }} [options]
 */
export async function cancelSpaSession(hotelId, sessionId, input, { now = new Date() } = {}) {
  const actor = currentActor();
  const { timezone } = await spaContext(hotelId, now);
  let summary;
  try {
    summary = await writeWithEvents(async (tx, stage) => {
      if (!(await lockSpaSessions(tx, hotelId, [sessionId])).has(sessionId)) throw new NotFoundError('Seans bulunamadı');
      const row = await tx.spaSession.findFirst({ where: { id: sessionId, hotelId }, select: SESSION_SELECT });
      if (!sameVersion(row.updatedAt, input.expectedUpdatedAt)) throw new StaleWriteError();
      if (row.status !== 'SCHEDULED') throw new ConflictError('Yalnız planlı seans iptal edilir.', 'SPA_NOT_OPEN');
      await tx.spaSession.update({ where: { id: sessionId }, data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: actor, cancelReason: input.reason, bookedCount: 0, waitlistCount: 0 } });
      await tx.spaHold.updateMany({ where: { sessionId }, data: { active: false } });
      const stamp = sqlTimestamp(now);
      const closed = /** @type {Array<{ id: string, prepaid: boolean }>} */ (
        await tx.$queryRaw`
          UPDATE "SpaAppointment"
          SET "status" = 'CANCELLED', "cancelledAt" = ${stamp}, "cancelledBy" = ${actor}, "cancelReason" = ${`Seans iptal edildi: ${input.reason}`.slice(0, 300)},
              "feePct" = 0, "amountDue" = 0, "totalDue" = 0, "balance" = 0 - "paidTotal" - "roomChargeTotal", "updatedAt" = ${stamp}
          WHERE "hotelId" = ${hotelId} AND "sessionId" = ${sessionId} AND "status" IN ('BOOKED', 'WAITLISTED')
          RETURNING "id", ("paidTotal" > 0) AS "prepaid"`
      );
      const prepaid = closed.filter((item) => item.prepaid).length;
      await recordAudit(tx, { hotelId, entity: 'SpaSession', entityId: sessionId, action: 'UPDATE', before: { status: 'SCHEDULED', booked: row.bookedCount, waitlisted: row.waitlistCount }, after: { status: 'CANCELLED', reason: input.reason, closedEnrollments: closed.length, prepaid, by: actor } });
      await stage('spa.session.changed', { hotelId, sessionId, change: 'CANCELLED' });
      if (closed.length) {
        const local = wallParts(row.startsAt, timezone);
        await raiseStaffAlert(tx, stage, {
          hotelId,
          kind: 'SPA',
          severity: 'WARNING',
          title: `Ders iptal edildi: ${row.serviceName} · ${local.day.split('-').reverse().join('.')} ${local.time}`.slice(0, 200),
          body: `${closed.length} kayıt bedelsiz kapandı; misafirlere haber verin.${prepaid ? ` ${prepaid} kaydın ön ödemesi iade edilecek (Randevular → Açık bakiyeler).` : ''}`,
          link: `/spa/dersler/${sessionId}`,
          permission: PERMISSIONS.SPA_BOOK,
          entityType: 'SpaSession',
          entityId: sessionId,
          dedupeKey: `spa-session-cancelled:${sessionId}`,
        });
      }
      return { closed: closed.length, prepaid };
    });
  } catch (error) {
    rethrowPrismaError(error);
  }
  return { ...(await getSpaSession(hotelId, sessionId)), ...summary };
}

/* ══════════════════ Dersi tamamla ══════════════════ */

/**
 * Dersi "yapıldı" olarak kapatır ve katılanların ücretini işler: asıl listedeki her kayıt tamamlanır — oteldeki
 * misafirin odasına yazılır (kasada ödeme almışsa bakiyesine), diğerleri bakiyede kalır (kasada alınır). Gelmeyenler
 * önceden tek tek "gelmedi" işaretlenir. Yedek listede kalanlar bedelsiz kapanır.
 *
 * İlk çağrı seansı kapatır; kayıtlar ayrı işlemlerde, süre bütçesiyle işlenir. Bütçe dolarsa `pending` > 0 döner,
 * aynı çağrı yinelenince kaldığı yerden sürer (kapanmış seansta sürüm aranmaz).
 *
 * @param {string} hotelId @param {string} sessionId @param {{ expectedUpdatedAt: Date }} input
 * @param {{ now?: Date, budgetMs?: number }} [options]
 */
export async function completeSpaSession(hotelId, sessionId, input, { now = new Date(), budgetMs = COMPLETE_BUDGET_MS } = {}) {
  const view = await spaViewContext(hotelId, now);
  const actor = currentActor();
  try {
    await writeWithEvents(async (tx, stage) => {
      if (!(await lockSpaSessions(tx, hotelId, [sessionId])).has(sessionId)) throw new NotFoundError('Seans bulunamadı');
      const row = await tx.spaSession.findFirst({ where: { id: sessionId, hotelId }, select: { status: true, startsAt: true, updatedAt: true, waitlistCount: true } });
      if (row.status === 'COMPLETED') return;
      if (!sameVersion(row.updatedAt, input.expectedUpdatedAt)) throw new StaleWriteError();
      if (row.status !== 'SCHEDULED') throw new ConflictError('İptal edilmiş seans tamamlanamaz.', 'SPA_NOT_OPEN');
      if (row.startsAt > now) throw new ConflictError('Ders henüz başlamadı; saati gelince tamamlanır.', 'SPA_NOT_STARTED');
      const stamp = sqlTimestamp(now);
      // Yedekte kalanlar derse giremedi: bedelsiz kapanır.
      const waitlisted = await tx.$executeRaw`
        UPDATE "SpaAppointment"
        SET "status" = 'CANCELLED', "cancelledAt" = ${stamp}, "cancelledBy" = ${actor}, "cancelReason" = 'Ders doldu; yedek listeden yer açılmadı',
            "feePct" = 0, "balance" = 0 - "paidTotal" - "roomChargeTotal", "updatedAt" = ${stamp}
        WHERE "hotelId" = ${hotelId} AND "sessionId" = ${sessionId} AND "status" = 'WAITLISTED'`;
      await tx.spaSession.update({ where: { id: sessionId }, data: { status: 'COMPLETED', completedAt: now, waitlistCount: 0 } });
      await recordAudit(tx, { hotelId, entity: 'SpaSession', entityId: sessionId, action: 'UPDATE', before: { status: 'SCHEDULED' }, after: { status: 'COMPLETED', waitlistClosed: Number(waitlisted), by: actor } });
      await stage('spa.session.changed', { hotelId, sessionId, change: 'COMPLETED' });
    });
  } catch (error) {
    rethrowPrismaError(error);
  }

  const started = Date.now();
  const open = await prisma.spaAppointment.findMany({ where: { hotelId, sessionId, status: 'BOOKED' }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: ENROLLMENT_LIMIT });
  let completed = 0;
  let charged = 0;
  const failed = [];
  let pending = 0;
  for (const { id } of open) {
    if (Date.now() - started > budgetMs) {
      pending += 1;
      continue;
    }
    try {
      const toRoom = await writeWithEvents(async (tx, stage) => {
        const row = await lockedAppointment(tx, hotelId, id);
        if (row.status !== 'BOOKED') return null;
        // Oteldeki misafir ve kasada ödeme yok: odaya. Değilse bakiyede kalır (ön ödeme varsa ondan düşer).
        const settle = row.reservation?.status === 'CHECKED_IN' && Number(row.paidTotal) === 0 ? 'ROOM' : 'DESK';
        await completeLocked(tx, stage, { hotelId, row, settle, taxes: view.taxes, today: view.today, now });
        return settle === 'ROOM';
      });
      if (toRoom !== null) completed += 1;
      if (toRoom) charged += 1;
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
      failed.push({ id, message: error.message });
    }
  }
  return { ...(await getSpaSession(hotelId, sessionId)), completed, charged, failed, pending };
}

/* ══════════════════ Kayıt ══════════════════ */

/**
 * Derse kayıt (seans kilitliyken): yer varsa asıl listeye, yoksa — istenmişse — yedek listeye. Aynı konaklama aynı
 * seansa ikinci kez kaydolamaz (kişi sayısı kayıtta girilir). Aynı istek kimliği ikinci kayıt açmaz.
 *
 * @param {string} hotelId @param {string} sessionId
 * @param {{ requestId: string, reservationId: string | null, customerName?: string | null, customerPhone?: string | null, guestCount: number, waitlist: boolean, note?: string | null }} input
 * @param {{ source?: 'STAFF' | 'PORTAL', earliest?: Date | null, now?: Date, logger?: any }} [options]
 */
export async function enrollSpaSession(hotelId, sessionId, input, { source = 'STAFF', earliest = null, now = new Date(), logger = console } = {}) {
  const context = await spaContext(hotelId, now);
  const requestKey = `${source === 'PORTAL' ? 'portal' : 'staff'}:${input.requestId}`;
  const actor = currentActor();
  let outcome;
  try {
    outcome = await writeWithEvents(async (tx, stage) => {
      if (!(await lockSpaSessions(tx, hotelId, [sessionId])).has(sessionId)) throw new NotFoundError('Seans bulunamadı');
      const existing = await tx.spaAppointment.findFirst({ where: { hotelId, requestKey }, select: { id: true, sessionId: true, status: true } });
      if (existing) {
        if (existing.sessionId !== sessionId) throw new ConflictError('Bu istek başka bir kayıtta kullanıldı; ekranı yenileyin.', 'DUPLICATE_REQUEST');
        return { id: existing.id, created: false, status: existing.status };
      }
      const session = await tx.spaSession.findFirst({ where: { id: sessionId, hotelId }, select: { id: true, serviceId: true, serviceName: true, startsAt: true, endsAt: true, capacity: true, bookedCount: true, price: true, status: true, service: { select: { category: true, portalBookable: true } } } });
      if (session.status !== 'SCHEDULED') throw new ConflictError('Bu seans kapanmış (yapıldı ya da iptal); kayıt alınmıyor.', 'SPA_NOT_OPEN');
      if (session.endsAt <= now) throw new ConflictError('Bu seansın saati geçti.', 'SPA_NOT_OPEN');
      if (source === 'PORTAL' && (!session.service.portalBookable || session.startsAt <= (earliest ?? now))) throw new ConflictError('Bu ders için artık kayıt alınmıyor.', 'SPA_NOT_OPEN');
      const customer = await resolveSpaCustomer(tx, hotelId, input);
      if (customer.reservationId && (await tx.spaAppointment.count({ where: { sessionId, reservationId: customer.reservationId, status: { in: ['BOOKED', 'WAITLISTED'] } } }))) {
        throw new ConflictError('Bu misafir bu derse zaten kayıtlı; kişi sayısını değiştirmek için kaydı iptal edip yeniden açın.', 'SPA_ALREADY_ENROLLED');
      }
      const free = session.capacity - session.bookedCount;
      const fits = input.guestCount <= free;
      if (!fits && !input.waitlist) {
        throw new ConflictError(free > 0 ? `Derste ${free} kişilik yer kaldı; ${input.guestCount} kişi sığmıyor.` : 'Ders dolu. İsterseniz yedek listeye yazın.', 'SPA_SESSION_FULL', { free });
      }
      const status = fits ? 'BOOKED' : 'WAITLISTED';
      const listPrice = spaListPrice(money(session.price), input.guestCount);
      const row = await tx.spaAppointment.create({
        data: {
          hotelId,
          code: await nextSpaCode(tx, hotelId, Number(wallParts(session.startsAt, context.timezone).day.slice(0, 4))),
          serviceId: session.serviceId,
          sessionId,
          serviceName: session.serviceName,
          category: session.service.category,
          kind: 'GROUP',
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          busyUntil: session.endsAt,
          guestCount: input.guestCount,
          ...customer,
          status,
          source,
          note: input.note ?? null,
          listPrice,
          price: listPrice,
          requestKey,
          createdBy: actor,
        },
        select: { id: true, code: true },
      });
      await adjustSeats(tx, sessionId, fits ? { booked: input.guestCount } : { waitlisted: input.guestCount });
      await recordAudit(tx, { hotelId, entity: 'SpaAppointment', entityId: row.id, action: 'CREATE', after: { code: row.code, session: sessionId, service: session.serviceName, status, guestCount: input.guestCount, customer: customer.customerName, source } });
      await stage('spa.appointment.changed', { hotelId, appointmentId: row.id, sessionId, change: status, source });
      if (source === 'PORTAL') {
        const local = wallParts(session.startsAt, context.timezone);
        await raiseStaffAlert(tx, stage, {
          hotelId,
          kind: 'SPA',
          severity: 'INFO',
          title: `Portaldan ders kaydı${fits ? '' : ' (yedek)'}: ${session.serviceName} · ${local.day.split('-').reverse().join('.')} ${local.time}`.slice(0, 200),
          body: `${customer.customerName}${customer.roomNumber ? ` · oda ${customer.roomNumber}` : ''} · ${input.guestCount} kişi · ${row.code}`,
          link: `/spa/dersler/${sessionId}`,
          permission: PERMISSIONS.SPA_BOOK,
          entityType: 'SpaAppointment',
          entityId: row.id,
          dedupeKey: `spa-booked:${row.id}`,
        });
      }
      return { id: row.id, created: true, status };
    });
  } catch (error) {
    rethrowPrismaError(error, { uniqueMessage: 'Bu kayıt az önce alındı; ekranı yenileyin.' });
  }
  if (outcome.created && outcome.status === 'BOOKED') await sendSpaNotification(hotelId, outcome.id, 'SPA_BOOKED', logger);
  return { ...(await getSpaSession(hotelId, sessionId)), appointmentId: outcome.id, created: outcome.created, waitlisted: outcome.status === 'WAITLISTED' };
}
