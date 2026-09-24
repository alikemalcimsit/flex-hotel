import { currentActor } from '@hotelos/core';
import {
  MANUAL_TASK_KNOWN_MODULES,
  canHandleManualTask,
  eventLabel,
  manualTaskActionError,
  manualTaskScope,
} from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { encodeCursor, newerThan, olderThan, parseCursor } from '../../lib/cursor.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { createReadCache } from '../../lib/read-cache.js';
import { currentStaff, currentStaffCached } from '../../lib/staff.js';
import { writeWithEvents } from '../../lib/write.js';
import { taskLinks } from '../actors/rules.js';

/**
 * Manuel görevler (modül 12): aktörün yapamadığı işler.
 *
 * ### Kim görür
 *
 * Görev, işin modülüne yetkili personele görünür (`manualTaskScope`): oda
 * atama görevi oda işlemleri iznine, cevapsız misafir mesajı mesaj yazma
 * iznine. Zil uyarısı da aynı izne gider; uyarıyı gören görevi açabilir.
 *
 * ### Yarışlar
 *
 * 2500 kişilik otelde aynı görevi iki kişi aynı anda açabilir. Her işlem
 * satırı kilitler (`FOR UPDATE`) ve durumu kilit altında yeniden okur:
 *
 * - İki kişi "üstlen" derse ikincisi "başka biri üstlendi" alır.
 * - İki kişi "tamamla" derse ikincisi "zaten kapatılmış" alır.
 * - Kapanmış görev yeniden açılmaz (veritabanı kısıtı da durum ile kapanış
 *   anını birlikte tutar).
 *
 * ### Olay gövdesi
 *
 * Liste gövde taşımaz: görevin başlığı ve bağlı kayıtları (rezervasyon,
 * konuşma, oda) yeter, liste hafif kalır. Gövde görev açılınca (detay)
 * gelir ve **maskesizdir**: işi yapacak kişi (ör. kanaldan gelen rezervasyonu
 * elle açacak resepsiyonist) misafirin iletişim bilgisine ihtiyaç duyar;
 * zaten o modülün yetkisine sahip.
 */

/** Özet önbelleği: otel × sürüm × dakika (en eski görevin yaşı zamanla değişir). */
const SUMMARY_CACHE_TTL_MS = 30_000;
const SUMMARY_CACHE_MAX_ENTRIES = 5000;
const summaryCache = createReadCache({ ttlMs: SUMMARY_CACHE_TTL_MS, maxEntries: SUMMARY_CACHE_MAX_ENTRIES });
const MINUTE_MS = 60_000;

const TASK_SELECT = Object.freeze({
  id: true,
  module: true,
  title: true,
  description: true,
  status: true,
  actorName: true,
  correlationId: true,
  assignedTo: true,
  assignedAt: true,
  completedAt: true,
  closedAt: true,
  resolvedBy: true,
  resolution: true,
  createdAt: true,
  updatedAt: true,
});

const iso = (value) => (value ? value.toISOString() : null);

/**
 * Kişinin görebildiği görevler (Prisma koşulu); hepsi ise `null`.
 * @param {readonly string[]} permissions
 */
function scopeWhere(permissions) {
  const scope = manualTaskScope(permissions);
  if (scope.empty) throw new ForbiddenError('Manuel görevleri görme yetkiniz yok');
  if (scope.all) return null;
  const or = [];
  if (scope.modules.length > 0) or.push({ module: { in: scope.modules } });
  if (scope.others) or.push({ module: { notIn: [...MANUAL_TASK_KNOWN_MODULES] } });
  return { OR: or };
}

/**
 * Üstlenen (kimlik) ve kapatan (e-posta) kişilerin adları — tek sorgu.
 * @param {string} hotelId
 * @param {Array<{ assignedTo: string | null, resolvedBy: string | null }>} rows
 */
async function peopleFor(hotelId, rows) {
  const ids = [...new Set(rows.map((row) => row.assignedTo).filter(Boolean))];
  const emails = [...new Set(rows.map((row) => row.resolvedBy).filter((value) => value?.includes('@')).map((value) => value.toLowerCase()))];
  if (ids.length === 0 && emails.length === 0) return { byId: new Map(), byEmail: new Map() };
  const users = await prisma.user.findMany({
    where: { hotelId, OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(emails.length ? [{ email: { in: emails } }] : [])] },
    select: { id: true, name: true, email: true },
  });
  return {
    byId: new Map(users.map((user) => [user.id, user.name])),
    byEmail: new Map(users.map((user) => [user.email.toLowerCase(), user.name])),
  };
}

/**
 * @param {object} row `TASK_SELECT` + `originalEvent`
 * @param {{ byId: Map<string, string>, byEmail: Map<string, string> }} people
 * @param {string | null} meId
 * @param {readonly string[]} permissions
 */
function toTaskDto(row, people, meId, permissions) {
  const event = /** @type {{ id?: string, name?: string | null, payload?: object } | null} */ (row.originalEvent ?? null);
  return {
    id: row.id,
    module: row.module,
    title: row.title,
    description: row.description,
    status: row.status,
    actorName: row.actorName,
    correlationId: row.correlationId,
    event: event?.name ? { id: event.id ?? null, name: event.name, label: eventLabel(event.name) } : null,
    links: taskLinks(event),
    assignedTo: row.assignedTo ? { id: row.assignedTo, name: people.byId.get(row.assignedTo) ?? null } : null,
    assignedAt: iso(row.assignedAt),
    mine: Boolean(meId && row.assignedTo === meId),
    closedAt: iso(row.closedAt),
    resolvedBy: row.resolvedBy,
    resolvedByLabel: row.resolvedBy ? people.byEmail.get(row.resolvedBy.toLowerCase()) ?? null : null,
    resolution: row.resolution,
    canHandle: canHandleManualTask(permissions, row.module),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Görev listesi (imleçli). Açıklar en eski önce (en uzun bekleyen en üstte),
 * kapananlar en yeni kapanan önce.
 *
 * @param {string} hotelId
 * @param {readonly string[]} permissions
 * @param {{ view: 'OPEN' | 'CLOSED', module?: string, actor?: string, cursor?: string, limit: number }} query
 */
export async function listManualTasks(hotelId, permissions, query) {
  const scope = scopeWhere(permissions);
  if (query.module && !canHandleManualTask(permissions, query.module)) {
    throw new ForbiddenError('Bu modülün görevlerini görme yetkiniz yok');
  }
  const cursor = parseCursor(query.cursor);
  const open = query.view === 'OPEN';
  const timeField = open ? 'createdAt' : 'closedAt';
  const and = [];
  if (scope) and.push(scope);
  if (cursor) and.push(open ? newerThan(timeField, cursor) : olderThan(timeField, cursor));

  const [rows, me] = await Promise.all([
    prisma.manualTask.findMany({
      where: {
        hotelId,
        closedAt: open ? null : { not: null },
        ...(query.module ? { module: query.module } : {}),
        ...(query.actor ? { actorName: query.actor } : {}),
        ...(and.length ? { AND: and } : {}),
      },
      orderBy: open ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ closedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: { ...TASK_SELECT, originalEvent: true },
    }),
    currentStaffCached(prisma, hotelId),
  ]);
  const page = rows.slice(0, query.limit);
  const people = await peopleFor(hotelId, page);
  const last = page.at(-1);
  return {
    items: page.map((row) => toTaskDto(row, people, me?.id ?? null, permissions)),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last[timeField], id: last.id }) : null,
  };
}

/**
 * Tek görev: olayın gövdesi dahil (maskesiz; bkz. dosya başı).
 *
 * @param {string} hotelId
 * @param {readonly string[]} permissions
 * @param {string} taskId
 */
export async function getManualTask(hotelId, permissions, taskId) {
  scopeWhere(permissions);
  const row = await prisma.manualTask.findFirst({
    where: { id: taskId, hotelId },
    select: { ...TASK_SELECT, originalEvent: true },
  });
  if (!row) throw new NotFoundError('Görev bulunamadı');
  if (!canHandleManualTask(permissions, row.module)) throw new ForbiddenError('Bu görevi görme yetkiniz yok');
  const [people, me] = await Promise.all([peopleFor(hotelId, [row]), currentStaffCached(prisma, hotelId)]);
  const event = /** @type {{ payload?: object } | null} */ (row.originalEvent ?? null);
  return { ...toTaskDto(row, people, me?.id ?? null, permissions), payload: event?.payload ?? null };
}

/**
 * Açık görevlerin özeti (yan menü rozeti, modül 13'ün "bekleyen işler"
 * kutusu). Otelin tamamı sürüm + dakika anahtarıyla bir kez hesaplanır;
 * kişinin kapsamı bellekte süzülür — 2500 panelin aynı dakikadaki sorusu
 * tek sorgu.
 *
 * @param {string} hotelId
 * @param {readonly string[]} permissions
 */
export async function getManualTaskSummary(hotelId, permissions) {
  const scope = manualTaskScope(permissions);
  if (scope.empty) throw new ForbiddenError('Manuel görevleri görme yetkiniz yok');
  const now = new Date();
  const minute = Math.floor(now.getTime() / MINUTE_MS);
  const key = `${hotelId}:${liveVersion(LIVE_SCOPES.MANUAL_TASKS, hotelId)}:${minute}`;
  const groups = await summaryCache.get(key, () =>
    prisma.manualTask.groupBy({
      by: ['module', 'status'],
      where: { hotelId, closedAt: null },
      _count: { _all: true },
      _min: { createdAt: true },
    }),
  );
  const visible = (module) =>
    scope.all || scope.modules.includes(module) || (scope.others && !MANUAL_TASK_KNOWN_MODULES.includes(module));
  /** @type {Map<string, { module: string, open: number, claimed: number, oldestAt: Date | null }>} */
  const byModule = new Map();
  for (const group of groups) {
    if (!visible(group.module)) continue;
    const entry = byModule.get(group.module) ?? { module: group.module, open: 0, claimed: 0, oldestAt: null };
    entry.open += group._count._all;
    if (group.status === 'IN_PROGRESS') entry.claimed += group._count._all;
    const oldest = group._min.createdAt;
    if (oldest && (!entry.oldestAt || oldest < entry.oldestAt)) entry.oldestAt = oldest;
    byModule.set(group.module, entry);
  }
  const modules = [...byModule.values()].sort((a, b) => b.open - a.open || a.module.localeCompare(b.module, 'tr'));
  const oldest = modules.reduce((min, entry) => (entry.oldestAt && (!min || entry.oldestAt < min) ? entry.oldestAt : min), null);
  return {
    open: modules.reduce((total, entry) => total + entry.open, 0),
    claimed: modules.reduce((total, entry) => total + entry.claimed, 0),
    oldestOpenAt: iso(oldest),
    byModule: modules.map((entry) => ({ ...entry, oldestAt: iso(entry.oldestAt) })),
    generatedAt: now.toISOString(),
  };
}

/** Testler için. */
export function clearManualTaskCache() {
  summaryCache.clear();
}

/** Denetim izine giden alanlar. */
const snapshot = (row) => ({
  status: row.status,
  assignedTo: row.assignedTo ?? null,
  resolvedBy: row.resolvedBy ?? null,
  resolution: row.resolution ?? null,
});

/**
 * Görev üzerinde tek işlem: kilitle, izni ve durumu kilit altında denetle,
 * yaz, iz bırak, olay yayınla.
 *
 * @param {string} hotelId
 * @param {readonly string[]} permissions
 * @param {string} taskId
 * @param {'claim' | 'release' | 'complete' | 'cancel'} action
 * @param {(row: object, context: { now: Date, me: { id: string } | null, by: string }) => object} changes
 */
async function transition(hotelId, permissions, taskId, action, changes) {
  const me = await currentStaff(prisma, hotelId);
  if (action === 'claim' && !me) {
    throw new ForbiddenError('Görevi üstlenmek için personel kaydınız bulunamadı');
  }
  const by = currentActor();
  const row = await writeWithEvents(async (tx, stage) => {
    const [locked] = await tx.$queryRaw`
      SELECT "id" FROM "ManualTask"
      WHERE "id" = ${taskId} AND "hotelId" = ${hotelId} AND "deletedAt" IS NULL
      FOR UPDATE`;
    if (!locked) throw new NotFoundError('Görev bulunamadı');
    const current = await tx.manualTask.findFirst({ where: { id: taskId, hotelId }, select: TASK_SELECT });
    if (!current) throw new NotFoundError('Görev bulunamadı');
    if (!canHandleManualTask(permissions, current.module)) throw new ForbiddenError('Bu görev üzerinde işlem yetkiniz yok');

    const blocked = manualTaskActionError(current, action, me?.id ?? null);
    if (blocked) throw new ConflictError(blocked.message, blocked.code);
    // Kendi üstlendiği görevi yeniden üstlenmek: değişiklik yok, iz yok.
    if (action === 'claim' && current.status === 'IN_PROGRESS' && current.assignedTo === me?.id) return current;

    const updated = await tx.manualTask.update({
      where: { id: taskId },
      data: changes(current, { now: new Date(), me, by }),
      select: TASK_SELECT,
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'ManualTask',
      entityId: taskId,
      action: 'UPDATE',
      before: snapshot(current),
      after: snapshot(updated),
    });
    await stage('manual_task.updated', { hotelId, taskId, module: updated.module, status: updated.status });
    return updated;
  });
  return getManualTask(hotelId, permissions, row.id);
}

/**
 * Görevi üstlenir: "ben yapıyorum" — başkası aynı işe girişmesin.
 * @param {string} hotelId
 * @param {readonly string[]} permissions
 * @param {string} taskId
 */
export function claimManualTask(hotelId, permissions, taskId) {
  return transition(hotelId, permissions, taskId, 'claim', (_row, { now, me }) => ({
    status: 'IN_PROGRESS',
    assignedTo: me.id,
    assignedAt: now,
  }));
}

/**
 * Üstlenilen görevi bırakır (vardiya bitti, başkası yapsın).
 * @param {string} hotelId
 * @param {readonly string[]} permissions
 * @param {string} taskId
 */
export function releaseManualTask(hotelId, permissions, taskId) {
  return transition(hotelId, permissions, taskId, 'release', () => ({
    status: 'PENDING',
    assignedTo: null,
    assignedAt: null,
  }));
}

/**
 * Görevi tamamlar: iş elle yapıldı. Başkasının üstlendiği görev de
 * tamamlanabilir (iş acildir; üstlenen vardiyadan çıkmış olabilir) — izde
 * kimin tamamladığı yazar.
 *
 * @param {string} hotelId
 * @param {readonly string[]} permissions
 * @param {string} taskId
 * @param {{ note?: string }} input
 */
export function completeManualTask(hotelId, permissions, taskId, { note } = {}) {
  return transition(hotelId, permissions, taskId, 'complete', (_row, { now, by }) => ({
    status: 'DONE',
    completedAt: now,
    closedAt: now,
    resolvedBy: by,
    resolution: note?.trim() || null,
  }));
}

/**
 * "Gerek kalmadı": iş yapılmadan kapanır (ör. oda atanacak rezervasyon bu
 * arada iptal oldu). Gerekçe zorunlu.
 *
 * @param {string} hotelId
 * @param {readonly string[]} permissions
 * @param {string} taskId
 * @param {{ reason: string }} input
 */
export function cancelManualTask(hotelId, permissions, taskId, { reason }) {
  return transition(hotelId, permissions, taskId, 'cancel', (_row, { now, by }) => ({
    status: 'CANCELLED',
    closedAt: now,
    resolvedBy: by,
    resolution: reason.trim(),
  }));
}
