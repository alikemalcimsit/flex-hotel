import { randomUUID } from 'node:crypto';
import { currentActor } from '@hotelos/core';
import {
  APPROVAL_DECIDED_STATUSES,
  APPROVAL_DEFAULT_TTL_MS,
  APPROVAL_EXPIRING_SOON_MS,
  APPROVAL_TYPE_LABELS,
  approvalDecisionError,
  approvalRequestSchema,
  approvalTiming,
  toFieldErrors,
} from '@hotelos/hotel-contracts';
import { prisma, prismaUnfiltered } from '../../db.js';
import { recordAudit } from '../../lib/audit.js';
import { encodeCursor, newerThan, olderThan, parseCursor } from '../../lib/cursor.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { LIVE_SCOPES, liveVersion } from '../../lib/live-version.js';
import { lockApprovals } from '../../lib/locks.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { createReadCache } from '../../lib/read-cache.js';
import { containsText, MIN_FUZZY_TOKEN_LENGTH } from '../../lib/search.js';
import { publishActivity } from '../../lib/activity-stream.js';
import { sqlTimestamp } from '../../lib/sql-time.js';
import { writeWithEvents } from '../../lib/write.js';
import { raiseStaffAlert } from '../notifications/staff-alerts.js';

/**
 * Onay kuyruğu servisi (modül 11).
 *
 * Bir iş personelin kararına bırakılır: para iadesi, büyük ödeme, toplu fiyat
 * değişimi. İsteyen çoğunlukla bir aktördür (`requestApproval` içindeki
 * `event`): onay verilince aktör **aynı olayla** kaldığı yerden devam eder
 * (`subscribers.js`), reddedilince ya da süre dolunca olay o aktör için
 * işlenmiş sayılır ve bir daha ele alınmaz. Bir servis de olay vermeden
 * onay açabilir; o zaman "onaylandı" haberini kendi dinler.
 *
 * ### Neden devam bus'a değil aktöre gider
 *
 * Onaylanan olay bus'a yeniden verilseydi aynı olayı dinleyen **diğer**
 * aktörler de (yeni kimlikle gelen olayı tanımadan) işi ikinci kez yapardı:
 * rezervasyon onayı misafire iki kez giderdi. Bu yüzden devam, yalnızca
 * isteyen aktörün işleyicisine, aynı olay kimliğiyle yapılır.
 *
 * ### Yarışlar
 *
 * - İki yönetici aynı anda karar verirse satır kilidi ikinciyi bekletir; o da
 *   "zaten karara bağlanmış" alır.
 * - Süresi dolmuş ama tarayıcı henüz düşürmemiş onaya karar verilemez; o anda
 *   düşürülür.
 * - Aynı olay yeniden dağıtılırsa (outbox) ikinci onay açılmaz
 *   (`PendingAction` tekil: aktör + olay).
 * - Onaylandı haberi iki kez gelirse (outbox tekrarı) devam bir kez yapılır
 *   (`resumedAt` üstlenme işareti).
 */

/** Özet önbelleği: otel × sürüm × dakika (kalan süreler zamanla değişir). */
const SUMMARY_CACHE_TTL_MS = 30_000;
const SUMMARY_CACHE_MAX_ENTRIES = 5000;
const summaryCache = createReadCache({ ttlMs: SUMMARY_CACHE_TTL_MS, maxEntries: SUMMARY_CACHE_MAX_ENTRIES });

const MINUTE_MS = 60_000;

/** Bir taramada düşürülen en fazla onay (uzun kilit tutmamak için). */
const EXPIRE_BATCH = 200;

/** Onay kuyruğu modülünün manuel görevlerde ve zilde görünen adı. */
export const APPROVAL_MODULE_LABEL = 'Onay kuyruğu';

const APPROVAL_SELECT = Object.freeze({
  id: true,
  hotelId: true,
  type: true,
  summary: true,
  reason: true,
  amount: true,
  currency: true,
  status: true,
  actorName: true,
  action: true,
  requestedBy: true,
  decidedBy: true,
  decidedAt: true,
  note: true,
  entityType: true,
  entityId: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
});

const PENDING_ACTION_SELECT = Object.freeze({
  id: true,
  actorName: true,
  eventId: true,
  resumeEvent: true,
  resumedAt: true,
});

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);

/** @param {unknown} value */
const money = (value) => (value === null || value === undefined ? null : String(value));

/** @param {string} approvalId */
export const approvalLink = (approvalId) => `/onaylar/bekleyen?onay=${approvalId}`;

/**
 * @param {object} row
 * @param {Date} now
 */
function toApprovalDto(row, now) {
  const timing = approvalTiming(row, now);
  return {
    id: row.id,
    type: row.type,
    typeLabel: APPROVAL_TYPE_LABELS[row.type] ?? row.type,
    summary: row.summary,
    reason: row.reason,
    amount: money(row.amount),
    currency: row.currency,
    status: row.status,
    actorName: row.actorName,
    action: row.action,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    decidedAt: iso(row.decidedAt),
    note: row.note,
    entityType: row.entityType,
    entityId: row.entityId,
    expiresAt: iso(row.expiresAt),
    minutesLeft: timing.minutesLeft,
    expiringSoon: timing.expiringSoon,
    expired: timing.expired,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Denetim izine yazılan alanlar. */
function snapshot(row) {
  return {
    type: row.type,
    summary: row.summary,
    status: row.status,
    amount: money(row.amount),
    currency: row.currency,
    actorName: row.actorName,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    decidedAt: iso(row.decidedAt),
    note: row.note,
    expiresAt: iso(row.expiresAt),
  };
}

/**
 * Onayın ne olduğunu tek satırda: "Para iadesi · 1250.00 TRY".
 * @param {{ type: string, amount?: unknown, currency?: string | null }} row
 */
function describeApproval(row) {
  const parts = [APPROVAL_TYPE_LABELS[row.type] ?? row.type];
  if (row.amount !== null && row.amount !== undefined) parts.push(`${money(row.amount)} ${row.currency ?? ''}`.trim());
  return parts.join(' · ');
}

/**
 * Zile "onay bekliyor" uyarısı. Aynı onay için tek uyarı (`dedupeKey`).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {object} row
 */
function alertRequested(tx, stage, row) {
  return raiseStaffAlert(tx, stage, {
    hotelId: row.hotelId,
    kind: 'APPROVAL_REQUESTED',
    severity: 'WARNING',
    title: `Onay bekliyor: ${row.summary}`,
    body: describeApproval(row),
    link: approvalLink(row.id),
    permission: PERMISSIONS.APPROVALS_DECIDE,
    entityType: 'Approval',
    entityId: row.id,
    dedupeKey: `approval:${row.id}`,
  });
}

/* ══════════════════ İstek ══════════════════ */

/**
 * Onay isteği açar. Çağıranın transaction'ında çalışır; olay ve zil
 * uyarısı commit sonrası dağıtılır.
 *
 * `event` verilirse bu bir aktör isteğidir: olayın zarfı bekleyen işe
 * yazılır ve onaylanınca aynı aktör aynı olayla devam eder. Aynı (aktör,
 * olay) için ikinci istek açılmaz; var olan döner (`created: false`).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{
 *   hotelId: string,
 *   type: string,
 *   summary: string,
 *   reason?: string | null,
 *   data?: Record<string, unknown>,
 *   amount?: string | number | null,
 *   currency?: string | null,
 *   actorName?: string | null,
 *   action?: string | null,
 *   entityType?: string | null,
 *   entityId?: string | null,
 *   expiresInMs?: number | null,
 *   requestedBy?: string | null,
 *   event?: { id: string, name: string, payload: object } & Record<string, unknown> | null,
 * }} input
 * @returns {Promise<{ approvalId: string, created: boolean, status: string }>}
 */
export async function requestApproval(tx, stage, input) {
  const parsed = approvalRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Onay isteği geçersiz', { fields: toFieldErrors(parsed.error) });
  }
  const { hotelId, event = null } = input;
  if (!hotelId) throw new ValidationError('Onay isteğinin oteli yok');
  const request = parsed.data;
  if (event && !request.actorName) throw new ValidationError('Olayla açılan onay isteğinin aktörü olmalı');

  if (event) {
    const existing = await tx.pendingAction.findFirst({
      where: { actorName: request.actorName, eventId: event.id },
      select: { approvalId: true, approval: { select: { status: true } } },
    });
    if (existing) return { approvalId: existing.approvalId, created: false, status: existing.approval.status };
  }

  const now = new Date();
  const expiresAt =
    request.expiresInMs === undefined
      ? new Date(now.getTime() + APPROVAL_DEFAULT_TTL_MS)
      : request.expiresInMs === null
        ? null
        : new Date(now.getTime() + request.expiresInMs);

  const created = await tx.approval.create({
    data: {
      hotelId,
      type: request.type,
      summary: request.summary,
      reason: request.reason ?? null,
      data: /** @type {any} */ (request.data ?? {}),
      amount: request.amount ?? null,
      currency: request.currency ?? null,
      actorName: request.actorName ?? null,
      action: request.action ?? null,
      requestedBy: input.requestedBy ?? request.actorName ?? currentActor(),
      entityType: request.entityType ?? null,
      entityId: request.entityId ?? null,
      expiresAt,
    },
    select: APPROVAL_SELECT,
  });

  if (event) {
    // Yarış: aynı olay için iki istek aynı anda gelirse tekil kısıt birini
    // reddeder. Hata fırlatmak transaction'ı bozardı; ON CONFLICT ile
    // sessizce vazgeçilir ve az önce açılan kayıt geri alınır.
    const inserted = await tx.$queryRaw`
      INSERT INTO "PendingAction" ("id", "hotelId", "actorName", "approvalId", "eventId", "resumeEvent", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${hotelId}, ${request.actorName}, ${created.id}, ${event.id},
              ${JSON.stringify(event)}::jsonb, ${sqlTimestamp(now)}, ${sqlTimestamp(now)})
      ON CONFLICT ("actorName", "eventId") DO NOTHING
      RETURNING "id"`;
    if (inserted.length === 0) {
      await tx.approval.delete({ where: { id: created.id } });
      const winner = await tx.pendingAction.findFirst({
        where: { actorName: request.actorName, eventId: event.id },
        select: { approvalId: true, approval: { select: { status: true } } },
      });
      if (!winner) throw new ConflictError('Onay isteği aynı anda başka bir işlemle çakıştı', 'APPROVAL_RACE');
      return { approvalId: winner.approvalId, created: false, status: winner.approval.status };
    }
  }

  await recordAudit(tx, { hotelId, entity: 'Approval', entityId: created.id, action: 'CREATE', after: snapshot(created) });
  await stage('approval.requested', {
    hotelId,
    approvalId: created.id,
    type: created.type,
    actorName: created.actorName,
    expiresAt: created.expiresAt,
  });
  await alertRequested(tx, stage, created);

  return { approvalId: created.id, created: true, status: created.status };
}

/**
 * Kendi transaction'ında onay isteği (aktör bağımlılığı için).
 * @param {Parameters<typeof requestApproval>[2]} input
 */
export function requestApprovalStandalone(input) {
  return writeWithEvents((tx, stage) => requestApproval(tx, stage, input));
}

/* ══════════════════ Okuma ══════════════════ */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string | undefined} search
 * @returns {object | null}
 */
function searchWhere(search) {
  const text = search?.trim();
  if (!text) return null;
  if (UUID_PATTERN.test(text)) return { OR: [{ id: text }, { entityId: text }] };
  // Üç harften kısa arama trigram index'ine oturmaz; ekran da göndermez.
  if (text.length < MIN_FUZZY_TOKEN_LENGTH) return null;
  return { OR: [{ summary: containsText(text) }, { requestedBy: containsText(text) }, { decidedBy: containsText(text) }] };
}

/**
 * Onay listesi (imleçli). Bekleyenler eskiden yeniye, geçmiş yeni karar önce.
 *
 * @param {string} hotelId
 * @param {{ view: string, status?: string, type?: string, search?: string, cursor?: string, limit: number }} query
 */
export async function listApprovals(hotelId, query) {
  const cursor = parseCursor(query.cursor);
  const now = new Date();
  const pending = query.view === 'PENDING';
  const timeField = pending ? 'createdAt' : 'decidedAt';
  const and = [];
  const search = searchWhere(query.search);
  if (search) and.push(search);
  if (cursor) and.push(pending ? newerThan(timeField, cursor) : olderThan(timeField, cursor));

  const rows = await prisma.approval.findMany({
    where: {
      hotelId,
      status: pending ? 'PENDING' : query.status ?? { in: [...APPROVAL_DECIDED_STATUSES] },
      ...(query.type ? { type: query.type } : {}),
      ...(and.length ? { AND: and } : {}),
    },
    orderBy: pending ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ decidedAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: APPROVAL_SELECT,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => toApprovalDto(row, now)),
    nextCursor:
      rows.length > query.limit && last ? encodeCursor({ at: last[timeField] ?? last.createdAt, id: last.id }) : null,
  };
}

/**
 * Tek onayın dökümü: isteyenin verdiği veri, gerekçe ve varsa bekleyen aktör işi.
 *
 * @param {string} hotelId
 * @param {string} approvalId
 */
export async function getApproval(hotelId, approvalId) {
  const row = await prisma.approval.findFirst({
    where: { id: approvalId, hotelId },
    select: { ...APPROVAL_SELECT, data: true, pendingActions: { select: PENDING_ACTION_SELECT, take: 1 } },
  });
  if (!row) throw new NotFoundError('Onay bulunamadı');
  const action = row.pendingActions[0] ?? null;
  return {
    ...toApprovalDto(row, new Date()),
    data: row.data ?? {},
    pendingAction: action
      ? {
          actorName: action.actorName,
          eventId: action.eventId,
          eventName: /** @type {any} */ (action.resumeEvent)?.name ?? null,
          resumedAt: iso(action.resumedAt),
        }
      : null,
  };
}

/**
 * Bekleyen sayısı, süresi yaklaşan sayısı ve en eski bekleyen (üst bar sayacı,
 * yan menü rozeti, modül 13'ün "bekleyen işler" kutusu). Sürüm + dakika
 * anahtarlı önbellek: 2500 panelin aynı dakikadaki sorusu tek hesaplama.
 *
 * @param {string} hotelId
 */
export function getApprovalSummary(hotelId) {
  const now = new Date();
  const minute = Math.floor(now.getTime() / MINUTE_MS);
  const key = `${hotelId}:${liveVersion(LIVE_SCOPES.APPROVALS, hotelId)}:${minute}`;
  return summaryCache.get(key, async () => {
    const soon = new Date(now.getTime() + APPROVAL_EXPIRING_SOON_MS);
    const [aggregate, expiringSoon] = await Promise.all([
      prisma.approval.aggregate({
        where: { hotelId, status: 'PENDING' },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
      prisma.approval.count({ where: { hotelId, status: 'PENDING', expiresAt: { lte: soon } } }),
    ]);
    return {
      pending: aggregate._count._all,
      expiringSoon,
      oldestPendingAt: iso(aggregate._min.createdAt),
      generatedAt: now.toISOString(),
    };
  });
}

/** Sağlık ucu için. */
export function approvalCacheStats() {
  return summaryCache.stats();
}

/** Testler için. */
export function clearApprovalCache() {
  summaryCache.clear();
}

/* ══════════════════ Karar ══════════════════ */

/**
 * Bekleyen aktör işlerini kapatır: olay o aktör için işlenmiş sayılır
 * (bir daha ele alınmaz) ve Activity Feed'e neden yapılmadığı yazılır.
 *
 * `ProcessedEvent` tekil kısıtı `ON CONFLICT` ile aşılır: aktör bu arada
 * olayı başka bir yoldan işaretlemiş olabilir; hata transaction'ı bozardı.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{ id: string, hotelId: string, summary: string }} approval
 * @param {Array<{ actorName: string, eventId: string, resumeEvent: unknown }>} actions
 * @param {string} message
 * @param {Date} now
 * @param {(fn: () => void) => void} afterCommit canlı akış haberi commit'ten sonra
 */
async function closePendingActions(tx, approval, actions, message, now, afterCommit) {
  for (const action of actions) {
    await tx.$executeRaw`
      INSERT INTO "ProcessedEvent" ("id", "hotelId", "actorName", "eventId", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${approval.hotelId}, ${action.actorName}, ${action.eventId},
              ${sqlTimestamp(now)}, ${sqlTimestamp(now)})
      ON CONFLICT ("actorName", "eventId") DO NOTHING`;
    const resumeEvent = /** @type {any} */ (action.resumeEvent) ?? {};
    const row = await tx.activityLog.create({
      data: {
        hotelId: approval.hotelId,
        actorName: action.actorName,
        eventId: action.eventId,
        eventName: resumeEvent.name ?? null,
        correlationId: resumeEvent.correlationId ?? null,
        level: 'WARN',
        message: `${message}: ${approval.summary}`,
        meta: { approvalId: approval.id, event: /** @type {any} */ (action.resumeEvent)?.name ?? null },
      },
    });
    // Canlı akış satırı commit'ten sonra görsün.
    afterCommit(() => publishActivity({ id: row.id, hotelId: row.hotelId, level: row.level }));
  }
}

/**
 * Onaylar ya da reddeder. Satır kilitlenir: aynı anda iki karar verilemez.
 * Süresi dolmuş onaya karar verilemez; o anda düşürülür.
 *
 * Ret, bekleyen aktör işini kapatır. Onayda devam commit'ten **sonra**
 * olur (`approval.granted` dinleyicisi): aktör işi yaparken bu transaction
 * çoktan bitmiş olmalı, yoksa aktör kendi yazdıklarını okuyamaz ve karar
 * yazılmadan iş yapılmış olur.
 *
 * Süre dolumu ayrı transaction'da yapılır: karar transaction'ı hata ile
 * bittiğinde (409) geri alınır, düşürme onunla birlikte kaybolurdu.
 *
 * @param {string} hotelId
 * @param {string} approvalId
 * @param {'GRANTED' | 'DENIED'} decision
 * @param {{ note?: string | null }} input
 */
export async function decideApproval(hotelId, approvalId, decision, { note = null } = {}) {
  const outcome = await writeWithEvents(async (tx, stage, afterCommit) => {
    await lockApprovals(tx, hotelId, [approvalId]);
    const row = await tx.approval.findFirst({
      where: { id: approvalId, hotelId },
      select: { ...APPROVAL_SELECT, pendingActions: { select: PENDING_ACTION_SELECT } },
    });
    if (!row) throw new NotFoundError('Onay bulunamadı');

    const now = new Date();
    const blocked = approvalDecisionError(row, now);
    if (blocked) return { blocked, expiredNow: row.status === 'PENDING' };

    const decidedBy = currentActor();
    const updated = await tx.approval.update({
      where: { id: approvalId },
      data: { status: decision, decidedBy, decidedAt: now, note: note || null },
      select: APPROVAL_SELECT,
    });
    await recordAudit(tx, {
      hotelId,
      entity: 'Approval',
      entityId: approvalId,
      action: 'UPDATE',
      before: snapshot(row),
      after: snapshot(updated),
    });
    await stage(decision === 'GRANTED' ? 'approval.granted' : 'approval.denied', {
      hotelId,
      approvalId,
      type: row.type,
      actorName: row.actorName,
      decidedBy,
    });
    if (decision === 'DENIED') {
      await closePendingActions(tx, row, row.pendingActions, `Onay reddedildi (${decidedBy})`, now, afterCommit);
    }
    return { dto: toApprovalDto(updated, now) };
  });

  if (outcome.blocked) {
    if (outcome.expiredNow) await expireIfDue(hotelId, approvalId);
    throw new ConflictError(outcome.blocked, 'NOT_PENDING');
  }
  return outcome.dto;
}

/**
 * Süresi geçmiş tek onayı düşürür (kendi transaction'ında, kilitli). Bu
 * arada tarayıcı ya da başka bir karar düşürdüyse dokunmaz.
 *
 * @param {string} hotelId
 * @param {string} approvalId
 * @returns {Promise<boolean>}
 */
function expireIfDue(hotelId, approvalId) {
  return writeWithEvents(async (tx, stage, afterCommit) => {
    await lockApprovals(tx, hotelId, [approvalId]);
    const row = await tx.approval.findFirst({
      where: { id: approvalId, hotelId, status: 'PENDING' },
      select: { ...APPROVAL_SELECT, pendingActions: { select: PENDING_ACTION_SELECT } },
    });
    const now = new Date();
    if (!row || !approvalTiming(row, now).expired) return false;
    await expireOne(tx, stage, row, now, afterCommit);
    return true;
  });
}

/**
 * Tek onayı düşürür (kilitli satır): durum, olay, aktör işinin kapatılması,
 * zile uyarı. Hem tarayıcı hem "süresi geçmişe karar" yolu kullanır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {object} row `pendingActions` dahil
 * @param {Date} now
 * @param {(fn: () => void) => void} afterCommit
 */
async function expireOne(tx, stage, row, now, afterCommit) {
  await tx.approval.update({ where: { id: row.id }, data: { status: 'EXPIRED', decidedAt: now } });
  await stage('approval.expired', { hotelId: row.hotelId, approvalId: row.id, type: row.type, actorName: row.actorName });
  await closePendingActions(tx, row, row.pendingActions ?? [], 'Onay süresi doldu', now, afterCommit);
  await raiseStaffAlert(tx, stage, {
    hotelId: row.hotelId,
    kind: 'APPROVAL_REQUESTED',
    severity: 'WARNING',
    title: `Süresi doldu, yapılmadı: ${row.summary}`,
    body: describeApproval(row),
    link: `/onaylar/gecmis?onay=${row.id}`,
    permission: PERMISSIONS.APPROVALS_DECIDE,
    entityType: 'Approval',
    entityId: row.id,
    dedupeKey: `approval-expired:${row.id}`,
  });
}

/**
 * Süresi dolan bekleyen onayları düşürür (zamanlanmış iş, dakikada bir).
 *
 * Satırlar `FOR UPDATE SKIP LOCKED` ile alınır: birden fazla sunucu süreci
 * aynı onayı iki kez düşürmez; o anda karar verilmekte olan satır atlanır
 * (karar veren kendi kilidinde süreyi kontrol eder).
 *
 * @param {Date} [now]
 * @returns {Promise<number>} düşürülen onay
 */
export function expireApprovals(now = new Date()) {
  return writeWithEvents(async (tx, stage, afterCommit) => {
    const ids = await tx.$queryRaw`
      SELECT "id" FROM "Approval"
      WHERE "status" = 'PENDING' AND "expiresAt" IS NOT NULL AND "expiresAt" < ${sqlTimestamp(now)}
        AND "deletedAt" IS NULL
      ORDER BY "expiresAt"
      LIMIT ${EXPIRE_BATCH}
      FOR UPDATE SKIP LOCKED`;
    if (ids.length === 0) return 0;
    const rows = await tx.approval.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      select: { ...APPROVAL_SELECT, pendingActions: { select: PENDING_ACTION_SELECT } },
    });
    for (const row of rows) await expireOne(tx, stage, row, now, afterCommit);
    return rows.length;
  });
}

/* ══════════════════ Devam ══════════════════ */

/**
 * Onaylanan işi üstlenir: bekleyen aktör işini bir kez ve yalnızca bir kez
 * geri verir. Haber iki kez gelirse (outbox tekrarı, iki süreç) ikinci çağrı
 * `null` alır.
 *
 * @param {string} approvalId
 * @returns {Promise<{ approval: object, action: { id: string, actorName: string, eventId: string, resumeEvent: object } } | null>}
 */
export async function claimPendingAction(approvalId) {
  const action = await prismaUnfiltered.pendingAction.findFirst({
    where: { approvalId, resumedAt: null, approval: { status: 'GRANTED' } },
    select: { ...PENDING_ACTION_SELECT, approval: { select: APPROVAL_SELECT } },
  });
  if (!action) return null;
  const claimed = await prismaUnfiltered.pendingAction.updateMany({
    where: { id: action.id, resumedAt: null },
    data: { resumedAt: new Date() },
  });
  if (claimed.count === 0) return null;
  return {
    approval: toApprovalDto(action.approval, new Date()),
    action: {
      id: action.id,
      actorName: action.actorName,
      eventId: action.eventId,
      resumeEvent: /** @type {object} */ (action.resumeEvent),
    },
  };
}

/**
 * Üstlenilen iş yapılamadıysa (aktör kayıtlı değil) işareti geri almak
 * **yanlış** olurdu: aynı iş sonsuza kadar yeniden denenirdi. Bu yüzden geri
 * alma yok; çağıran işi manuel göreve düşürür, olay o aktör için kapanır.
 *
 * @param {string} hotelId
 * @param {{ actorName: string, eventId: string }} action
 * @param {Date} now
 */
export function markPendingActionAbandoned(hotelId, action, now = new Date()) {
  return prismaUnfiltered.$executeRaw`
    INSERT INTO "ProcessedEvent" ("id", "hotelId", "actorName", "eventId", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${hotelId}, ${action.actorName}, ${action.eventId}, ${sqlTimestamp(now)}, ${sqlTimestamp(now)})
    ON CONFLICT ("actorName", "eventId") DO NOTHING`;
}
