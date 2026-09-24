import { randomUUID } from 'node:crypto';
import { currentActor, currentCorrelationId, toDecimal } from '@hotelos/core';
import { ACTOR_RECENT_ACTIVITY_LIMIT, ACTOR_STATS_WINDOW_HOURS, eventLabel } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { publishActivity } from '../../lib/activity-stream.js';
import { invalidateActorSettings } from '../../lib/actor-settings.js';
import { actorCatalog } from '../../lib/actors.js';
import { recordAudit } from '../../lib/audit.js';
import { getBusinessDate } from '../../lib/business-date.js';
import { NotFoundError } from '../../lib/errors.js';
import { SQL_NOW, sqlTimestamp } from '../../lib/sql-time.js';
import { writeWithEvents } from '../../lib/write.js';
import { getAgentUsage } from '../concierge/llm.js';
import { agentModel, aiKeyConfigured, getAiSettingsCached } from '../concierge/settings.js';
import { actorImpact, buildActorRows } from './rules.js';

/**
 * Aktör yönetim paneli (modül 12).
 *
 * ### Okuma yükü
 *
 * Aktör sayısı küçük (bugün 7, dikeyler eklenince birkaç düzine); tablolar
 * büyük (Activity Feed günde on binlerce satır). Liste, aktör başına sorgu
 * atmaz — dört sorgu, hepsi otel kapsamlı index'ten:
 *
 * 1. Otelin aktör ayarları (`(hotelId, actorName)` tekil).
 * 2. Son 24 saatin iş sayısı ve son iş: aktör adları tek diziyle verilir,
 *    her aktör için `(hotelId, actorName, createdAt, id)` index'inde sayım ve
 *    en yeni satır (LATERAL).
 * 3. Uyarı / hata sayıları: `(hotelId, level, createdAt, id)`; sorunsuz
 *    günde neredeyse boş tarama.
 * 4. Açık manuel görevler (aktör başına): `(hotelId, actorName, closedAt, …)`.
 *
 * LLM ajanlarının bugünkü harcaması günlük özetten (`LlmUsageDaily`).
 *
 * Activity Feed satırları sistemin defteri: silinmez, soft-delete edilmez;
 * ham sorgular `deletedAt`'e bakmaz (index'ten okunan sayım bozulmasın).
 */

const HOUR_MS = 60 * 60 * 1000;

/**
 * @param {string} name
 */
function findActor(name) {
  const entry = actorCatalog().find((candidate) => candidate.manifest.name === name);
  if (!entry) throw new NotFoundError('Aktör bulunamadı');
  return entry;
}

/** @param {{ worker: any, manifest: any }} entry */
const backlogOf = (entry) => (entry.manifest.background ? entry.worker?.backlog?.() ?? { running: 0, queued: 0 } : null);

const SETTING_SELECT = Object.freeze({
  id: true,
  actorName: true,
  enabled: true,
  note: true,
  updatedBy: true,
  updatedAt: true,
});

/**
 * Pencere içindeki iş sayısı ve son iş, aktör başına.
 * @param {string} hotelId
 * @param {string[]} names
 * @param {Date} since
 */
async function activityStats(hotelId, names, since) {
  if (names.length === 0) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT a."name" AS "actorName",
           (SELECT COUNT(*)::int FROM "ActivityLog" c
             WHERE c."hotelId" = ${hotelId} AND c."actorName" = a."name"
               AND c."createdAt" >= ${sqlTimestamp(since)}) AS "runs",
           last."createdAt" AS "lastAt", last."level"::text AS "lastLevel", last."message" AS "lastMessage"
    FROM unnest(${names}::text[]) AS a("name")
    LEFT JOIN LATERAL (
      SELECT l."createdAt", l."level", l."message"
      FROM "ActivityLog" l
      WHERE l."hotelId" = ${hotelId} AND l."actorName" = a."name"
      ORDER BY l."createdAt" DESC, l."id" DESC
      LIMIT 1
    ) last ON true`;
  return new Map(
    rows.map((row) => [
      row.actorName,
      {
        runs: Number(row.runs ?? 0),
        lastAt: row.lastAt ?? null,
        lastLevel: row.lastLevel ?? null,
        lastMessage: row.lastMessage ?? null,
      },
    ]),
  );
}

/**
 * Pencere içindeki uyarı ve hatalar, aktör başına.
 * @param {string} hotelId
 * @param {Date} since
 * @param {string | null} [actorName] tek aktör
 */
async function problemCounts(hotelId, since, actorName = null) {
  const groups = await prisma.activityLog.groupBy({
    by: ['actorName', 'level'],
    where: { hotelId, level: { in: ['WARN', 'ERROR'] }, createdAt: { gte: since }, ...(actorName ? { actorName } : {}) },
    _count: { _all: true },
  });
  const counts = new Map();
  for (const group of groups) {
    const entry = counts.get(group.actorName) ?? { warnings: 0, errors: 0 };
    if (group.level === 'WARN') entry.warnings += group._count._all;
    if (group.level === 'ERROR') entry.errors += group._count._all;
    counts.set(group.actorName, entry);
  }
  return counts;
}

/**
 * Kişi e-postalarının adları (kapatanın adı). Tek sorgu.
 * @param {string} hotelId
 * @param {Array<string | null | undefined>} emails
 */
async function peopleByEmail(hotelId, emails) {
  const wanted = [...new Set(emails.filter((email) => email && email.includes('@')).map((email) => email.toLowerCase()))];
  if (wanted.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { hotelId, email: { in: wanted } }, select: { email: true, name: true } });
  return new Map(users.map((user) => [user.email.toLowerCase(), user.name]));
}

/**
 * Aktör listesi: bildirge, bu oteldeki durum, son 24 saat, açık görevler,
 * LLM ajanlarının bugünkü harcaması ve otelin AI bütçesi.
 *
 * @param {string} hotelId
 */
export async function listActors(hotelId) {
  const catalog = actorCatalog();
  const names = catalog.map((entry) => entry.manifest.name);
  const since = new Date(Date.now() - ACTOR_STATS_WINDOW_HOURS * HOUR_MS);
  const today = await getBusinessDate(hotelId);
  const [settingRows, stats, problems, taskGroups, costGroups, aiSettings] = await Promise.all([
    prisma.actorSetting.findMany({ where: { hotelId, actorName: { in: names } }, select: SETTING_SELECT }),
    activityStats(hotelId, names, since),
    problemCounts(hotelId, since),
    prisma.manualTask.groupBy({
      by: ['actorName'],
      where: { hotelId, closedAt: null, actorName: { in: names } },
      _count: { _all: true },
    }),
    prisma.llmUsageDaily.groupBy({ by: ['actorName'], where: { hotelId, date: today }, _sum: { costUsd: true } }),
    getAiSettingsCached(hotelId),
  ]);

  const people = await peopleByEmail(hotelId, settingRows.map((row) => row.updatedBy));
  const settings = new Map(settingRows.map((row) => [row.actorName, row]));
  const costToday = new Map(costGroups.map((group) => [group.actorName, toDecimal(group._sum.costUsd ?? 0).toFixed(6)]));
  const hotelSpent = costGroups.reduce((total, group) => total.plus(toDecimal(group._sum.costUsd ?? 0)), toDecimal(0));

  const rows = buildActorRows(
    catalog.map((entry) => ({ ...entry, backlog: backlogOf(entry) })),
    {
      settings,
      stats,
      problems,
      openTasks: new Map(taskGroups.map((group) => [group.actorName, group._count._all])),
      costToday,
    },
  );
  return {
    items: rows.map((row) => ({
      ...row,
      changedByLabel: row.changedBy ? people.get(row.changedBy.toLowerCase()) ?? null : null,
    })),
    windowHours: ACTOR_STATS_WINDOW_HOURS,
    llm: {
      keyConfigured: aiKeyConfigured(),
      aiEnabled: aiSettings.enabled,
      date: today.toISOString().slice(0, 10),
      spentUsd: hotelSpent.toFixed(6),
      budgetUsd: aiSettings.dailyBudgetUsd,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Aktör detayı: bildirgenin tamamı ("kapatırsam ne olur" dahil), bu oteldeki
 * durum, son işler, açık görevler; LLM ajanıysa modeli.
 *
 * @param {string} hotelId
 * @param {string} name
 */
export async function getActor(hotelId, name) {
  const entry = findActor(name);
  const { manifest } = entry;
  const since = new Date(Date.now() - ACTOR_STATS_WINDOW_HOURS * HOUR_MS);
  const [setting, stats, problems, openTasks, oldestOpen, recent, aiSettings] = await Promise.all([
    prisma.actorSetting.findFirst({ where: { hotelId, actorName: name }, select: SETTING_SELECT }),
    activityStats(hotelId, [name], since),
    problemCounts(hotelId, since, name),
    prisma.manualTask.count({ where: { hotelId, actorName: name, closedAt: null } }),
    prisma.manualTask.findFirst({
      where: { hotelId, actorName: name, closedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { createdAt: true },
    }),
    prisma.activityLog.findMany({
      where: { hotelId, actorName: name },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ACTOR_RECENT_ACTIVITY_LIMIT,
      select: {
        id: true,
        eventName: true,
        correlationId: true,
        level: true,
        message: true,
        durationMs: true,
        createdAt: true,
      },
    }),
    manifest.type === 'agent' ? getAiSettingsCached(hotelId) : Promise.resolve(null),
  ]);

  const people = await peopleByEmail(hotelId, [setting?.updatedBy]);
  // Bugünkü harcama detayda ayrı uçtan (ajan kartı dönemi seçilebilir).
  const [{ costTodayUsd: _cost, ...row }] = buildActorRows([{ ...entry, backlog: backlogOf(entry) }], {
    settings: new Map(setting ? [[name, setting]] : []),
    stats,
    problems,
    openTasks: new Map([[name, openTasks]]),
    costToday: new Map(),
  });
  const manifests = actorCatalog().map((candidate) => candidate.manifest);
  const impact = actorImpact(manifest, manifests);
  const titles = new Map(manifests.map((other) => [other.name, other.title ?? other.name]));
  const named = (actorNames) => actorNames.map((actorName) => ({ name: actorName, title: titles.get(actorName) ?? actorName }));

  return {
    ...row,
    changedByLabel: row.changedBy ? people.get(row.changedBy.toLowerCase()) ?? null : null,
    oldestOpenTaskAt: oldestOpen?.createdAt.toISOString() ?? null,
    retry: { attempts: manifest.retry.attempts, backoffMs: manifest.retry.backoffMs },
    backgroundLimits: manifest.background
      ? { maxConcurrent: manifest.background.maxConcurrent, maxQueued: manifest.background.maxQueued, onOverflow: manifest.background.onOverflow }
      : null,
    requiresApproval: [...manifest.requiresApproval],
    subscribes: impact.subscribes.map((link) => ({ event: link.event, label: eventLabel(link.event), publishedBy: named(link.publishedBy) })),
    publishes: impact.publishes.map((link) => ({ event: link.event, label: eventLabel(link.event), consumedBy: named(link.consumedBy) })),
    downstream: named(impact.downstream),
    llm:
      manifest.type === 'agent'
        ? { model: agentModel(name, aiSettings), keyConfigured: aiKeyConfigured(), aiEnabled: aiSettings?.enabled ?? false }
        : null,
    recent: recent.map((activity) => ({
      id: activity.id,
      eventName: activity.eventName,
      eventLabel: eventLabel(activity.eventName),
      correlationId: activity.correlationId,
      level: activity.level,
      message: activity.message,
      durationMs: activity.durationMs,
      createdAt: activity.createdAt.toISOString(),
    })),
  };
}

/**
 * LLM ajanının günlük kullanımı (ajan kartı).
 * @param {string} hotelId
 * @param {string} name
 * @param {{ days: number }} query
 */
export async function getActorUsage(hotelId, name, query) {
  const { manifest } = findActor(name);
  if (manifest.type !== 'agent') throw new NotFoundError('Bu aktör model kullanmıyor');
  return getAgentUsage(hotelId, name, query);
}

/** Denetim izine giden alanlar. @param {{ enabled: boolean, note: string | null }} row */
const snapshot = (row) => ({ enabled: row.enabled, note: row.note ?? null });

/**
 * Aktörü bu otelde açar ya da kapatır.
 *
 * Satır yoksa önce (açık olarak) eklenir, sonra kilitlenir: aynı anda iki
 * yönetici değiştirse de sırayla işlenir ve denetim izi doğru "önce"yi görür.
 * Açık/kapalı açıkça verilir (anahtar değil): iki kişi aynı anda "kapat"
 * derse ikincisi değişiklik yapmaz, iz de bırakmaz.
 *
 * Kapatınca aktör bir sonraki olayda durur (her olayda ayarı okur); işi
 * manuel göreve düşer. AI ajanları kapanınca yeni konuşmalar personelde
 * açılır (bkz. `aiActiveFor`). Aktivite akışına da satır düşer: akışı
 * izleyen yönetici aktörün neden sustuğunu görür.
 *
 * @param {string} hotelId
 * @param {string} name
 * @param {boolean} enabled
 * @param {{ note?: string }} input
 */
export async function setActorEnabled(hotelId, name, enabled, { note } = {}) {
  findActor(name);
  const by = currentActor();
  const cleanNote = note?.trim() || null;
  await writeWithEvents(async (tx, stage, afterCommit) => {
    await tx.$executeRaw`
      INSERT INTO "ActorSetting" ("id", "hotelId", "actorName", "enabled", "config", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${hotelId}, ${name}, true, '{}'::jsonb, ${SQL_NOW}, ${SQL_NOW})
      ON CONFLICT ("hotelId", "actorName") DO NOTHING`;
    const [locked] = await tx.$queryRaw`
      SELECT "id", "enabled", "note", "deletedAt" FROM "ActorSetting"
      WHERE "hotelId" = ${hotelId} AND "actorName" = ${name}
      FOR UPDATE`;
    // Silinmiş (soft-delete) ayar yok hükmündedir: aktör varsayılan olarak açık.
    const current = locked.deletedAt ? { enabled: true, note: null } : locked;
    if (current.enabled === enabled) return;

    const updated = await tx.actorSetting.update({
      where: { id: locked.id },
      data: { enabled, note: cleanNote, updatedBy: by, deletedAt: null },
      select: { enabled: true, note: true },
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'ActorSetting',
      entityId: locked.id,
      action: 'UPDATE',
      before: { actorName: name, ...snapshot(current) },
      after: { actorName: name, ...snapshot(updated) },
    });
    await stage('actor.setting.changed', { hotelId, actorName: name, enabled });
    const activity = await tx.activityLog.create({
      data: {
        hotelId,
        actorName: name,
        eventName: 'actor.setting.changed',
        correlationId: currentCorrelationId(),
        level: enabled ? 'INFO' : 'WARN',
        message: enabled
          ? `Aktör açıldı (${by})`
          : `Aktör kapatıldı (${by}); işleri manuel göreve düşecek`,
        meta: { event: 'actor.setting.changed', by, ...(cleanNote ? { note: cleanNote } : {}) },
      },
      select: { id: true, hotelId: true, level: true },
    });
    afterCommit(() => publishActivity(activity));
  });
  // Bu süreçteki önbellek (AI modu kararı) hemen; başka süreçler kısa TTL ile.
  invalidateActorSettings(hotelId);
  return getActor(hotelId, name);
}
