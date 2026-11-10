import { currentActor, toIsoDay } from '@hotelos/core';
import { SURVEY_FOLLOW_UP_OUTCOME_LABELS } from '@hotelos/hotel-contracts';
import { recordAudit } from '../../lib/audit.js';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError } from '../../lib/errors.js';
import { buildPage, toSkipTake } from '../../lib/pagination.js';
import { SQL_NOW } from '../../lib/sql-time.js';
import { findActiveStaffByEmail } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { fullGuestName, iso, prisma } from './shared.js';

/**
 * Düşük puan takibi (modül 55). Düşük puanlı her cevap bir takip kaydı açar (cevapla aynı işlemde): kim üstlendi,
 * misafirle görüşmeler ve notlar (değişmez), sonuç ve nasıl kapandığı. Hedef süre içerideki misafirde 2 saat,
 * çıkmışta 48 saat; geçen takip listede üstte ve işaretli. Durum değişiklikleri `updatedAt` ile iyimser kilitli.
 */

const NOTE_LIMIT = 100;
/** Atama seçicisindeki en fazla kişi (otelin aktif personeli; ada göre). */
const ASSIGNEE_LIMIT = 500;
const EXCERPT = 200;

const LIST_SELECT = Object.freeze({
  id: true,
  kind: true,
  status: true,
  assignedTo: true,
  dueAt: true,
  outcome: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { notes: true } },
  response: {
    select: {
      id: true,
      npsScore: true,
      ratingAverage: true,
      commentText: true,
      sentiment: true,
      submittedAt: true,
      reservation: { select: { id: true, confirmationCode: true, status: true, checkIn: true, checkOut: true, room: { select: { number: true } }, guest: { select: { firstName: true, lastName: true } } } },
    },
  },
});

/** @param {any} row @param {Date} now */
const followUpView = (row, now = new Date()) => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  assignedTo: row.assignedTo,
  dueAt: iso(row.dueAt),
  overdue: row.status !== 'RESOLVED' && row.dueAt < now,
  outcome: row.outcome,
  resolvedAt: iso(row.resolvedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  noteCount: row._count?.notes ?? 0,
  response: {
    id: row.response.id,
    npsScore: row.response.npsScore,
    ratingAverage: row.response.ratingAverage === null ? null : Number(row.response.ratingAverage),
    sentiment: row.response.sentiment,
    submittedAt: iso(row.response.submittedAt),
    comment: row.response.commentText ? (row.response.commentText.length > EXCERPT ? `${row.response.commentText.slice(0, EXCERPT - 1)}…` : row.response.commentText) : null,
  },
  reservation: {
    id: row.response.reservation.id,
    confirmationCode: row.response.reservation.confirmationCode,
    status: row.response.reservation.status,
    checkIn: toIsoDay(row.response.reservation.checkIn),
    checkOut: toIsoDay(row.response.reservation.checkOut),
    roomNumber: row.response.reservation.room?.number ?? null,
    guestName: fullGuestName(row.response.reservation.guest),
  },
});

/**
 * Takip listesi. Açıklar (varsayılan) hedef süreye göre (geciken önce); kapananlar son kapanan önce.
 * @param {string} hotelId @param {{ view: 'ACTIVE' | 'RESOLVED' | 'ALL', mine: boolean, page: number, pageSize: number }} query
 */
export async function listFollowUps(hotelId, query) {
  /** @type {any} */
  const where = { hotelId };
  if (query.view === 'ACTIVE') where.status = { in: ['OPEN', 'IN_PROGRESS'] };
  if (query.view === 'RESOLVED') where.status = 'RESOLVED';
  if (query.mine) where.assignedTo = currentActor();
  const orderBy = query.view === 'RESOLVED' ? [{ resolvedAt: 'desc' }, { id: 'desc' }] : [{ dueAt: 'asc' }, { id: 'asc' }];
  const [rows, total, counts] = await Promise.all([
    prisma.surveyFollowUp.findMany({ where, select: LIST_SELECT, orderBy, ...toSkipTake(query) }),
    prisma.surveyFollowUp.count({ where }),
    prisma.$queryRaw`
      SELECT count(*) FILTER (WHERE "status" = 'OPEN')::int AS "open",
             count(*) FILTER (WHERE "status" = 'IN_PROGRESS')::int AS "inProgress",
             count(*) FILTER (WHERE "status" <> 'RESOLVED' AND "dueAt" < ${SQL_NOW})::int AS "overdue"
      FROM "SurveyFollowUp" WHERE "hotelId" = ${hotelId} AND "status" <> 'RESOLVED'`,
  ]);
  const now = new Date();
  return { ...buildPage(rows.map((row) => followUpView(row, now)), total, query), counts: /** @type {any[]} */ (counts)[0] };
}

/**
 * Takibin ayrıntısı: cevabın tamamı, notlar (en yeni önce), misafirin iletişim bilgisi.
 * @param {string} hotelId @param {string} followUpId
 */
export async function getFollowUp(hotelId, followUpId) {
  const row = await prisma.surveyFollowUp.findFirst({
    where: { id: followUpId, hotelId },
    select: {
      ...LIST_SELECT,
      resolution: true,
      resolvedBy: true,
      notes: { orderBy: { createdAt: 'desc' }, take: NOTE_LIMIT, select: { id: true, kind: true, text: true, createdBy: true, createdAt: true } },
      response: { select: { ...LIST_SELECT.response.select, reservation: { select: { ...LIST_SELECT.response.select.reservation.select, guest: { select: { firstName: true, lastName: true, email: true, phone: true } } } } } },
    },
  });
  if (!row) throw new NotFoundError('Takip bulunamadı');
  return {
    ...followUpView(row),
    resolution: row.resolution,
    resolvedBy: row.resolvedBy,
    comment: row.response.commentText,
    contact: { email: row.response.reservation.guest?.email ?? null, phone: row.response.reservation.guest?.phone ?? null },
    notes: row.notes.map((note) => ({ ...note, createdAt: iso(note.createdAt) })),
  };
}

/**
 * Durum değişikliğinin ortak gövdesi: sürüm denetimi, güncelleme, işlem kaydı, olay.
 * @param {string} hotelId @param {string} followUpId @param {Date} expectedUpdatedAt
 * @param {(current: any) => { data: object, note?: { kind: 'NOTE' | 'CONTACT', text: string } | null, change: string }} plan
 */
async function changeFollowUp(hotelId, followUpId, expectedUpdatedAt, plan) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const current = await tx.surveyFollowUp.findFirst({ where: { id: followUpId, hotelId } });
    if (!current) throw new NotFoundError('Takip bulunamadı');
    if (current.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) throw new StaleWriteError();
    const { data, note, change } = plan(current);
    const updated = await tx.surveyFollowUp.updateMany({ where: { id: followUpId, hotelId, updatedAt: current.updatedAt }, data });
    if (updated.count === 0) throw new StaleWriteError();
    if (note) await tx.surveyFollowUpNote.create({ data: { hotelId, followUpId, kind: note.kind, text: note.text, createdBy: actor } });
    await recordAudit(tx, { hotelId, entity: 'SurveyFollowUp', entityId: followUpId, action: 'UPDATE', before: { status: current.status, assignedTo: current.assignedTo }, after: { ...data, change } });
    await stage('survey.followup.changed', { hotelId, followUpId, change });
  });
  return getFollowUp(hotelId, followUpId);
}

/**
 * Üstlen / başkasına ver / bırak. Açık takip üstlenilince "ilgileniliyor"a geçer.
 * @param {string} hotelId @param {string} followUpId @param {{ expectedUpdatedAt: Date, assignedTo: string | null }} input
 */
export async function assignFollowUp(hotelId, followUpId, { expectedUpdatedAt, assignedTo }) {
  const email = assignedTo?.toLowerCase() ?? null;
  if (email && !(await findActiveStaffByEmail(prisma, hotelId, email))) throw new ValidationError('Bu kişi otelin aktif personeli değil', { field: 'assignedTo' });
  return changeFollowUp(hotelId, followUpId, expectedUpdatedAt, (current) => {
    if (current.status === 'RESOLVED') throw new ConflictError('Kapanmış takip devredilmez; önce yeniden açın.', 'FOLLOW_UP_RESOLVED');
    return {
      data: { assignedTo: email, status: email ? 'IN_PROGRESS' : current.status },
      note: { kind: 'NOTE', text: email ? `Üstlenen: ${email}` : 'Takip bırakıldı' },
      change: 'ASSIGNED',
    };
  });
}

/**
 * Not ya da misafirle görüşme kaydı (değişmez). Görüşme açık takibi "ilgileniliyor"a geçirir. Kapanmış takibe yazılmaz.
 * @param {string} hotelId @param {string} followUpId @param {{ kind: 'NOTE' | 'CONTACT', text: string }} input
 */
export async function addFollowUpNote(hotelId, followUpId, { kind, text }) {
  const actor = currentActor();
  await writeWithEvents(async (tx, stage) => {
    const current = await tx.surveyFollowUp.findFirst({ where: { id: followUpId, hotelId }, select: { status: true } });
    if (!current) throw new NotFoundError('Takip bulunamadı');
    if (current.status === 'RESOLVED') throw new ConflictError('Kapanmış takibe not yazılmaz; gerekirse yeniden açın.', 'FOLLOW_UP_RESOLVED');
    await tx.surveyFollowUpNote.create({ data: { hotelId, followUpId, kind, text, createdBy: actor } });
    // Takibin sürümü ilerler (açık ekranlar tazelenir); görüşme açık takibi ilgilenilene alır.
    await tx.surveyFollowUp.update({ where: { id: followUpId }, data: kind === 'CONTACT' && current.status === 'OPEN' ? { status: 'IN_PROGRESS' } : { updatedAt: new Date() } });
    await recordAudit(tx, { hotelId, entity: 'SurveyFollowUp', entityId: followUpId, action: 'UPDATE', after: { note: kind } });
    await stage('survey.followup.changed', { hotelId, followUpId, change: 'NOTED' });
  });
  return getFollowUp(hotelId, followUpId);
}

/**
 * Kapat: sonuç ve nasıl kapandığı zorunlu (kayıt kısıtı).
 * @param {string} hotelId @param {string} followUpId @param {{ expectedUpdatedAt: Date, outcome: string, resolution: string }} input
 */
export async function resolveFollowUp(hotelId, followUpId, { expectedUpdatedAt, outcome, resolution }) {
  const actor = currentActor();
  return changeFollowUp(hotelId, followUpId, expectedUpdatedAt, (current) => {
    if (current.status === 'RESOLVED') throw new ConflictError('Takip zaten kapalı.', 'FOLLOW_UP_RESOLVED');
    return {
      data: { status: 'RESOLVED', outcome, resolution, resolvedAt: new Date(), resolvedBy: actor, assignedTo: current.assignedTo ?? actor },
      note: { kind: 'NOTE', text: `Kapandı · ${SURVEY_FOLLOW_UP_OUTCOME_LABELS[outcome]}: ${resolution}` },
      change: 'RESOLVED',
    };
  });
}

/**
 * Yeniden aç: önceki sonuç notlarda kalır, kayıttan temizlenir.
 * @param {string} hotelId @param {string} followUpId @param {{ expectedUpdatedAt: Date }} input
 */
export async function reopenFollowUp(hotelId, followUpId, { expectedUpdatedAt }) {
  return changeFollowUp(hotelId, followUpId, expectedUpdatedAt, (current) => {
    if (current.status !== 'RESOLVED') throw new ConflictError('Takip zaten açık.', 'FOLLOW_UP_OPEN');
    return {
      data: { status: current.assignedTo ? 'IN_PROGRESS' : 'OPEN', outcome: null, resolution: null, resolvedAt: null, resolvedBy: null },
      note: { kind: 'NOTE', text: `Yeniden açıldı (önceki sonuç: ${SURVEY_FOLLOW_UP_OUTCOME_LABELS[current.outcome] ?? '—'})` },
      change: 'REOPENED',
    };
  });
}

/**
 * Takibi üstlenebilecek kişiler: otelin aktif personeli (ad, e-posta), ada göre; seçicide aranır.
 * @param {string} hotelId
 */
export async function listAssignees(hotelId) {
  const rows = await prisma.user.findMany({ where: { hotelId, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: ASSIGNEE_LIMIT, select: { name: true, email: true, role: true } });
  return rows;
}
