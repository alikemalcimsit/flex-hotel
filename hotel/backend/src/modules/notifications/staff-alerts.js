import { randomUUID } from 'node:crypto';
import { STAFF_ALERT_BADGE_CAP, STAFF_ALERT_RETENTION_DAYS } from '@hotelos/hotel-contracts';
import { prisma, prismaUnfiltered } from '../../db.js';
import { encodeCursor, olderThan, parseCursor } from '../../lib/cursor.js';
import { NotFoundError } from '../../lib/errors.js';
import { permissionsForRole } from '../../lib/permissions.js';
import { currentStaff } from '../../lib/staff.js';

/**
 * Personel uyarıları — üst bardaki zil (modül 9).
 *
 * ### Kime
 *
 * Uyarı ya bir kişiye (`userId`: konuşmanın ya da isteğin sahibi) ya da bir
 * izne (`permission`: o izne sahip herkes) gider. 2500 kişilik otelde her
 * uyarı için 2500 satır yazılmaz; kişi listeyi açınca kendi izinleriyle süzülür.
 *
 * ### Birleşme
 *
 * Aynı konu (`dedupeKey`) tek uyarıda toplanır: aynı konuşmadan art arda gelen
 * beş mesaj beş satır değil, öne çıkan tek satırdır ("5 mesaj"). Birleşen
 * uyarı okunmamış sayılır.
 *
 * ### Rozet
 *
 * Rozet "son bakıştan sonra gelenler"dir (kişinin `lastSeenAt`'i). Sunucu
 * görülmemiş uyarıların kimliklerini (üst sınırlı) verir; panel sonra gelen
 * uyarıları socket haberinden kendisi ekler — her uyarıda 2500 panel sunucuya
 * sormaz.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 300;

/** "Tümünü okundu say" en fazla bu kadar uyarıyı işaretler (saklama süresi içinde). */
const MARK_ALL_LIMIT = 1000;

/** Saklama süresi dolanlar bu boyutta paketlerle silinir (uzun kilit tutmamak için). */
const PURGE_BATCH = 5000;

const ALERT_SELECT = Object.freeze({
  id: true,
  kind: true,
  severity: true,
  title: true,
  body: true,
  link: true,
  count: true,
  occurredAt: true,
  userId: true,
});

/** @param {string | null | undefined} value @param {number} max */
function clip(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const retentionCut = (now = new Date()) => new Date(now.getTime() - STAFF_ALERT_RETENTION_DAYS * DAY_MS);

/**
 * Uyarı açar ya da aynı konudaki uyarıyı öne çıkarır. Çağıranın
 * transaction'ında çalışır; event commit sonrası dağıtılır.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {(name: string, payload: object) => Promise<void>} stage
 * @param {{
 *   hotelId: string,
 *   kind: string,
 *   severity?: 'INFO' | 'WARNING' | 'CRITICAL',
 *   title: string,
 *   body?: string | null,
 *   link?: string | null,
 *   userId?: string | null,
 *   permission?: string | null,
 *   entityType?: string | null,
 *   entityId?: string | null,
 *   dedupeKey?: string | null,
 * }} alert
 * @returns {Promise<string>} uyarı kimliği
 */
export async function raiseStaffAlert(tx, stage, alert) {
  const {
    hotelId,
    kind,
    severity = 'INFO',
    link = null,
    userId = null,
    permission = null,
    entityType = null,
    entityId = null,
    dedupeKey = null,
  } = alert;
  if (!userId && !permission) throw new Error('Personel uyarısının alıcısı (kişi ya da izin) yok');
  const title = clip(alert.title, MAX_TITLE_LENGTH);
  const body = clip(alert.body, MAX_BODY_LENGTH);

  let id;
  if (dedupeKey) {
    // `xmax <> 0`: satır eklenmedi, var olan güncellendi (birleşti).
    const [row] = await tx.$queryRaw`
      INSERT INTO "StaffAlert" ("id", "hotelId", "kind", "severity", "title", "body", "link", "userId",
                                "permission", "entityType", "entityId", "dedupeKey", "occurredAt", "count",
                                "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${hotelId}, ${kind}::"StaffAlertKind", ${severity}::"StaffAlertSeverity", ${title},
              ${body}, ${link}, ${userId}, ${permission}, ${entityType}, ${entityId}, ${dedupeKey}, now(), 1,
              now(), now())
      ON CONFLICT ("hotelId", "dedupeKey") WHERE "dedupeKey" IS NOT NULL
      DO UPDATE SET "occurredAt" = now(),
                    "count" = "StaffAlert"."count" + 1,
                    "title" = EXCLUDED."title",
                    "body" = EXCLUDED."body",
                    "severity" = EXCLUDED."severity",
                    "link" = EXCLUDED."link",
                    "userId" = EXCLUDED."userId",
                    "permission" = EXCLUDED."permission",
                    "updatedAt" = now()
      RETURNING "id", ("xmax" <> 0) AS "collapsed"`;
    id = row.id;
    // Birleşen uyarı yeniden okunmamış: yeni bir şey oldu.
    if (row.collapsed) await tx.staffAlertRead.deleteMany({ where: { alertId: id } });
  } else {
    const created = await tx.staffAlert.create({
      data: { hotelId, kind, severity, title, body, link, userId, permission, entityType, entityId },
      select: { id: true },
    });
    id = created.id;
  }

  await stage('staff.alert.raised', { hotelId, alertId: id, kind, userId, permission });
  return id;
}

/* ══════════════════ Kişinin zili ══════════════════ */

/**
 * İsteği yapan personel ve zil durumu. Personel kaydı bulunamazsa `null`
 * (geçici kimlik: `x-actor`, bkz. `lib/staff.js`).
 * @param {string} hotelId
 */
async function viewer(hotelId) {
  const staff = await currentStaff(prisma, hotelId);
  if (!staff) return null;
  const state = await prisma.staffAlertState.findFirst({
    where: { userId: staff.id },
    select: { lastSeenAt: true, mutedKinds: true },
  });
  return {
    id: staff.id,
    permissions: [...permissionsForRole(staff.role)],
    lastSeenAt: state?.lastSeenAt ?? null,
    mutedKinds: state?.mutedKinds ?? [],
  };
}

/**
 * Kişinin görebildiği uyarılar.
 * @param {string} hotelId
 * @param {{ id: string, permissions: string[], mutedKinds: string[] }} me
 * @param {Date} since
 */
function visibleWhere(hotelId, me, since) {
  return {
    hotelId,
    occurredAt: { gt: since },
    OR: [{ userId: me.id }, { userId: null, permission: { in: me.permissions } }],
    ...(me.mutedKinds.length > 0 ? { kind: { notIn: me.mutedKinds } } : {}),
  };
}

/** @param {Date | null} lastSeenAt @param {Date} cut */
const unseenSince = (lastSeenAt, cut) => (lastSeenAt && lastSeenAt > cut ? lastSeenAt : cut);

/**
 * Zil listesi (en yeni önce, imleçle).
 * @param {string} hotelId
 * @param {{ cursor?: string, limit: number }} query
 */
export async function listStaffAlerts(hotelId, query) {
  const cursor = parseCursor(query.cursor);
  const me = await viewer(hotelId);
  if (!me) return { items: [], nextCursor: null, staffKnown: false };

  const rows = await prisma.staffAlert.findMany({
    where: { ...visibleWhere(hotelId, me, retentionCut()), ...(cursor ? { AND: [olderThan('occurredAt', cursor)] } : {}) },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: ALERT_SELECT,
  });
  const page = rows.slice(0, query.limit);
  const reads = page.length
    ? await prisma.staffAlertRead.findMany({
        where: { userId: me.id, alertId: { in: page.map((row) => row.id) } },
        select: { alertId: true },
      })
    : [];
  const readIds = new Set(reads.map((row) => row.alertId));
  const last = page.at(-1);

  return {
    staffKnown: true,
    items: page.map((row) => ({
      id: row.id,
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      body: row.body,
      link: row.link,
      count: row.count,
      personal: row.userId === me.id,
      occurredAt: row.occurredAt.toISOString(),
      read: readIds.has(row.id),
      unseen: !me.lastSeenAt || row.occurredAt > me.lastSeenAt,
    })),
    nextCursor: rows.length > query.limit && last ? encodeCursor({ at: last.occurredAt, id: last.id }) : null,
  };
}

/**
 * Rozet: son bakıştan sonra gelen uyarıların kimlikleri (üst sınırlı).
 * @param {string} hotelId
 */
export async function getStaffAlertSummary(hotelId) {
  const me = await viewer(hotelId);
  if (!me) {
    return { staffKnown: false, unseenIds: [], unseenCount: 0, capped: false, lastSeenAt: null, mutedKinds: [] };
  }
  const since = unseenSince(me.lastSeenAt, retentionCut());
  const rows = await prisma.staffAlert.findMany({
    where: visibleWhere(hotelId, me, since),
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: STAFF_ALERT_BADGE_CAP + 1,
    select: { id: true },
  });
  const capped = rows.length > STAFF_ALERT_BADGE_CAP;
  return {
    staffKnown: true,
    unseenIds: rows.slice(0, STAFF_ALERT_BADGE_CAP).map((row) => row.id),
    unseenCount: Math.min(rows.length, STAFF_ALERT_BADGE_CAP),
    capped,
    lastSeenAt: me.lastSeenAt?.toISOString() ?? null,
    mutedKinds: me.mutedKinds,
    permissions: me.permissions,
    userId: me.id,
  };
}

/** @param {string} hotelId @param {string} userId @param {object} data */
function saveState(hotelId, userId, data) {
  return prisma.staffAlertState.upsert({
    where: { userId },
    create: { userId, hotelId, ...data },
    update: data,
    select: { lastSeenAt: true, mutedKinds: true },
  });
}

/** Zil açıldı: rozet sıfırlanır. @param {string} hotelId */
export async function markStaffAlertsSeen(hotelId) {
  const me = await viewer(hotelId);
  if (!me) throw new NotFoundError('Personel kaydı bulunamadı');
  const state = await saveState(hotelId, me.id, { lastSeenAt: new Date() });
  return { lastSeenAt: state.lastSeenAt.toISOString() };
}

/**
 * @param {string} hotelId
 * @param {string} alertId
 */
export async function markStaffAlertRead(hotelId, alertId) {
  const me = await viewer(hotelId);
  if (!me) throw new NotFoundError('Personel kaydı bulunamadı');
  const alert = await prisma.staffAlert.findFirst({
    where: { id: alertId, ...visibleWhere(hotelId, { ...me, mutedKinds: [] }, retentionCut()) },
    select: { id: true },
  });
  if (!alert) throw new NotFoundError('Uyarı bulunamadı');
  await prisma.staffAlertRead.createMany({ data: [{ alertId, userId: me.id }], skipDuplicates: true });
  return { read: true };
}

/** Görünen bütün uyarıları okundu say ve rozeti sıfırla. @param {string} hotelId */
export async function markAllStaffAlertsRead(hotelId) {
  const me = await viewer(hotelId);
  if (!me) throw new NotFoundError('Personel kaydı bulunamadı');
  const muted = me.mutedKinds;
  const marked = await prisma.$executeRaw`
    INSERT INTO "StaffAlertRead" ("alertId", "userId", "readAt")
    SELECT a."id", ${me.id}, now()
    FROM "StaffAlert" a
    WHERE a."hotelId" = ${hotelId}
      AND a."occurredAt" > ${retentionCut()}
      AND (a."userId" = ${me.id} OR (a."userId" IS NULL AND a."permission" = ANY(${me.permissions}::text[])))
      AND NOT (a."kind"::text = ANY(${muted}::text[]))
      AND NOT EXISTS (SELECT 1 FROM "StaffAlertRead" r WHERE r."alertId" = a."id" AND r."userId" = ${me.id})
    ORDER BY a."occurredAt" DESC
    LIMIT ${MARK_ALL_LIMIT}
    ON CONFLICT DO NOTHING`;
  const state = await saveState(hotelId, me.id, { lastSeenAt: new Date() });
  return { marked, lastSeenAt: state.lastSeenAt.toISOString() };
}

/**
 * @param {string} hotelId
 * @param {{ mutedKinds: string[] }} input
 */
export async function updateStaffAlertPreferences(hotelId, { mutedKinds }) {
  const me = await viewer(hotelId);
  if (!me) throw new NotFoundError('Personel kaydı bulunamadı');
  const state = await saveState(hotelId, me.id, { mutedKinds });
  return { mutedKinds: state.mutedKinds };
}

/**
 * Saklama süresi dolan uyarıları siler (okunma kayıtları zincirleme gider).
 * @param {Date} [now]
 * @returns {Promise<number>} silinen uyarı
 */
export async function purgeExpiredStaffAlerts(now = new Date()) {
  const cut = retentionCut(now);
  let total = 0;
  for (;;) {
    const deleted = await prismaUnfiltered.$executeRaw`
      DELETE FROM "StaffAlert"
      WHERE "id" IN (SELECT "id" FROM "StaffAlert" WHERE "occurredAt" < ${cut} LIMIT ${PURGE_BATCH})`;
    total += deleted;
    if (deleted < PURGE_BATCH) return total;
  }
}
