import { actorRegistry } from '@hotelos/actor-kit';
import { EVENT_CATALOG } from '@hotelos/core';
import { actorKind, AUDIT_ENTITY_LABELS, redactPayload } from '@hotelos/hotel-contracts';
import { prisma } from '../../db.js';
import { encodeCursor, olderThan, parseCursor } from '../../lib/cursor.js';
import { NotFoundError } from '../../lib/errors.js';
import { buildChain, changedValues, groupEntityChains } from './rules.js';

/**
 * Aktivite akışı, olay listesi, işlem zinciri ve denetim listesi (modül 10).
 *
 * ### Yük
 *
 * Üç tablo da en hızlı büyüyen tablolar: yoğun otelde günde yüz binlerce
 * satır. Her liste otel başına, en yeni önce ve **imleçle** okunur; her
 * süzgecin kendi index'i var (migration `20260925090000_activity_feed`):
 * aktör, olay adı, seviye, kişi, kayıt türü. Sayfa numarası ve toplam sayı
 * yok — milyonluk tabloda `COUNT` ve derin `OFFSET` ekranı kilitlerdi.
 * Zincir tek index'ten (`correlationId`) ve üst sınırla okunur.
 *
 * ### Kişisel veri
 *
 * Olay gövdeleri teknik bir görünümde gösterilir; telefon, e-posta, kimlik
 * numarası maskelenir (`redactPayload`). Değişikliklerin eski/yeni değerleri
 * yalnızca denetim izni olana gider (`audit.view`).
 */

/** Zincirde her kaynaktan okunan en fazla satır (fazlası "kesildi" işaretiyle). */
export const CHAIN_LIMIT = 500;
/** Bir kaydın zincirleri için okunan en fazla denetim satırı ve gösterilen zincir. */
const ENTITY_AUDIT_SCAN = 2000;
const ENTITY_CHAIN_LIMIT = 100;
/** "Sorunlar" süzgecinin okuduğu seviyeler (ayrı ayrı taranıp birleştirilir). */
const PROBLEM_LEVELS = Object.freeze(['WARN', 'ERROR']);

/** @param {Date | null | undefined} value */
const iso = (value) => (value ? value.toISOString() : null);

/** Zaman aralığı koşulu. @param {{ from?: Date, to?: Date }} query */
function rangeWhere(field, { from, to }) {
  if (!from && !to) return {};
  return { [field]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } };
}

/**
 * E-posta ile yazılmış kişilerin adları (sayfadaki bütün kişiler tek sorguda).
 * @param {string} hotelId
 * @param {Array<string | null | undefined>} actors
 * @returns {Promise<Map<string, string>>}
 */
async function userNames(hotelId, actors) {
  const emails = [...new Set(actors.filter((actor) => actorKind(actor) === 'USER'))];
  if (emails.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { hotelId, email: { in: emails } }, select: { email: true, name: true } });
  return new Map(users.map((user) => [user.email, user.name]));
}

/**
 * İmleçli sayfa: bir fazlası okunur, varsa sonraki sayfanın imleci döner.
 * @param {any[]} rows
 * @param {number} limit
 * @param {string} timeField
 */
function page(rows, limit, timeField) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ at: last[timeField], id: last.id }) : null };
}

/* ══════════════════ Aktivite akışı ══════════════════ */

function toActivityDto(row) {
  return {
    id: row.id,
    actorName: row.actorName,
    eventId: row.eventId,
    eventName: row.eventName,
    correlationId: row.correlationId,
    level: row.level,
    message: row.message,
    meta: redactPayload(row.meta ?? {}),
    durationMs: row.durationMs,
    createdAt: iso(row.createdAt),
  };
}

const ACTIVITY_SELECT = Object.freeze({
  id: true,
  actorName: true,
  eventId: true,
  eventName: true,
  correlationId: true,
  level: true,
  message: true,
  meta: true,
  durationMs: true,
  createdAt: true,
});

/**
 * Aktivite akışı: en yeni önce, imleçli. `ids` verilirse (canlı akış) yalnızca
 * o satırlar — süzgeçler yine uygulanır; başka otelin satırı dönmez.
 *
 * @param {string} hotelId
 * @param {object} query `activityFeedQuerySchema` çıktısı
 */
export async function listActivity(hotelId, query) {
  const cursor = parseCursor(query.cursor);
  const base = {
    hotelId,
    ...(query.actorName ? { actorName: query.actorName } : {}),
    ...(query.eventName ? { eventName: query.eventName } : {}),
    ...(query.correlationId ? { correlationId: query.correlationId } : {}),
    ...rangeWhere('createdAt', query),
    ...(query.ids ? { id: { in: query.ids } } : {}),
    ...(cursor ? olderThan('createdAt', cursor) : {}),
  };
  const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }];
  const take = query.ids ? query.ids.length : query.limit + 1;

  let rows;
  if (query.level === 'PROBLEMS') {
    // İki seviye ayrı index taramasıyla; birleşip yeniden sıralanır.
    const parts = await Promise.all(
      PROBLEM_LEVELS.map((level) => prisma.activityLog.findMany({ where: { ...base, level }, orderBy, take, select: ACTIVITY_SELECT })),
    );
    rows = parts
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .slice(0, take);
  } else {
    rows = await prisma.activityLog.findMany({
      where: { ...base, ...(query.level ? { level: query.level } : {}) },
      orderBy,
      take,
      select: ACTIVITY_SELECT,
    });
  }

  if (query.ids) return { items: rows.map(toActivityDto), nextCursor: null };
  const result = page(rows, query.limit, 'createdAt');
  return { items: result.items.map(toActivityDto), nextCursor: result.nextCursor };
}

/* ══════════════════ Olaylar ══════════════════ */

function toEventDto(row) {
  return {
    id: row.id,
    name: row.name,
    actor: row.actor,
    actorKind: actorKind(row.actor),
    correlationId: row.correlationId,
    causationId: row.causationId,
    hop: row.hop,
    occurredAt: iso(row.occurredAt),
    publishedAt: iso(row.publishedAt),
    payload: redactPayload(row.payload),
  };
}

/**
 * Olay listesi. `unpublished`: dağıtılamamış (outbox'ta bekleyen) olaylar —
 * kısmi index `EventLog_unpublished_idx`.
 *
 * @param {string} hotelId
 * @param {object} query `eventLogQuerySchema` çıktısı
 */
export async function listEvents(hotelId, query) {
  const cursor = parseCursor(query.cursor);
  const rows = await prisma.eventLog.findMany({
    where: {
      hotelId,
      ...(query.name ? { name: query.name } : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
      ...(query.unpublished ? { publishedAt: null } : {}),
      ...rangeWhere('occurredAt', query),
      ...(cursor ? olderThan('occurredAt', cursor) : {}),
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: {
      id: true,
      name: true,
      actor: true,
      correlationId: true,
      causationId: true,
      hop: true,
      occurredAt: true,
      publishedAt: true,
      payload: true,
    },
  });
  const result = page(rows, query.limit, 'occurredAt');
  return { items: result.items.map(toEventDto), nextCursor: result.nextCursor };
}

/* ══════════════════ Zincir ══════════════════ */

/**
 * Bir zincirin bütün adımları, ağaç olarak (bkz. `rules.js → buildChain`).
 *
 * @param {string} hotelId
 * @param {string} correlationId
 * @param {{ includeValues: boolean }} options değişikliklerin eski/yeni değerleri (denetim izni)
 */
export async function getChain(hotelId, correlationId, { includeValues }) {
  const take = CHAIN_LIMIT + 1;
  const [events, activities, audits] = await Promise.all([
    prisma.eventLog.findMany({
      where: { hotelId, correlationId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take,
      select: { id: true, name: true, actor: true, occurredAt: true, publishedAt: true, hop: true, causationId: true, payload: true },
    }),
    prisma.activityLog.findMany({
      where: { hotelId, correlationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: ACTIVITY_SELECT,
    }),
    prisma.auditLog.findMany({
      where: { hotelId, correlationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: {
        id: true,
        entity: true,
        entityId: true,
        action: true,
        actor: true,
        changedFields: true,
        createdAt: true,
        ...(includeValues ? { before: true, after: true } : {}),
      },
    }),
  ]);
  if (events.length + activities.length + audits.length === 0) throw new NotFoundError('Bu zincire ait kayıt bulunamadı');

  const truncated = [events, activities, audits].some((rows) => rows.length > CHAIN_LIMIT);
  const chain = buildChain({
    events: events.slice(0, CHAIN_LIMIT).map((event) => ({ ...event, payload: redactPayload(event.payload) })),
    activities: activities.slice(0, CHAIN_LIMIT).map((activity) => ({ ...activity, meta: redactPayload(activity.meta ?? {}) })),
    audits: audits.slice(0, CHAIN_LIMIT).map((audit) => ({
      ...audit,
      values: includeValues ? changedValues(audit) : null,
    })),
  });

  const people = await userNames(hotelId, [...events.map((event) => event.actor), ...audits.map((audit) => audit.actor)]);
  return { correlationId, truncated, valuesIncluded: includeValues, people: Object.fromEntries(people), ...chain };
}

/**
 * Bir kaydın (ör. rezervasyonun) bütün zincirleri: oluşturulması, oda
 * ataması, girişi… Denetim satırlarından (kaydın index'i) gruplanır.
 *
 * @param {string} hotelId
 * @param {{ entity: string, entityId: string }} params
 */
export async function listEntityChains(hotelId, { entity, entityId }) {
  const rows = await prisma.auditLog.findMany({
    where: { hotelId, entity, entityId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: ENTITY_AUDIT_SCAN,
    select: { correlationId: true, action: true, actor: true, changedFields: true, createdAt: true },
  });
  if (rows.length === 0) throw new NotFoundError('Bu kayda ait işlem izi bulunamadı');
  const chains = groupEntityChains(rows, ENTITY_CHAIN_LIMIT);
  const people = await userNames(hotelId, chains.map((chain) => chain.actor));
  return {
    entity,
    entityLabel: AUDIT_ENTITY_LABELS[entity] ?? entity,
    entityId,
    truncated: rows.length >= ENTITY_AUDIT_SCAN,
    chains: chains.map((chain) => ({ ...chain, actorKind: actorKind(chain.actor), actorLabel: people.get(chain.actor) ?? null })),
  };
}

/* ══════════════════ Denetim listesi ══════════════════ */

/**
 * Denetim kaydı: kim, ne zaman, hangi kayıt, eski/yeni değer.
 *
 * @param {string} hotelId
 * @param {object} query `auditQuerySchema` çıktısı
 */
export async function listAudit(hotelId, query) {
  const cursor = parseCursor(query.cursor);
  const rows = await prisma.auditLog.findMany({
    where: {
      hotelId,
      ...(query.actor ? { actor: query.actor } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...rangeWhere('createdAt', query),
      ...(cursor ? olderThan('createdAt', cursor) : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
  });
  const result = page(rows, query.limit, 'createdAt');
  const people = await userNames(hotelId, result.items.map((row) => row.actor));
  return {
    items: result.items.map((row) => ({
      id: row.id,
      entity: row.entity,
      entityLabel: AUDIT_ENTITY_LABELS[row.entity] ?? row.entity,
      entityId: row.entityId,
      action: row.action,
      actor: row.actor,
      actorKind: actorKind(row.actor),
      actorLabel: people.get(row.actor) ?? null,
      changedFields: row.changedFields,
      before: row.before ?? null,
      after: row.after ?? null,
      correlationId: row.correlationId,
      createdAt: iso(row.createdAt),
    })),
    nextCursor: result.nextCursor,
  };
}

/* ══════════════════ Süzgeç seçenekleri ══════════════════ */

/**
 * Süzgeç seçenekleri: kayıtlı aktörler (bildirgeden) ve olay kataloğu. Kodun
 * kendisinden okunur; tabloda `DISTINCT` taranmaz.
 */
export function activityOptions() {
  return {
    actors: actorRegistry
      .list()
      .map((manifest) => ({ name: manifest.name, type: manifest.type, description: manifest.description }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    events: Object.keys(EVENT_CATALOG).sort(),
  };
}
