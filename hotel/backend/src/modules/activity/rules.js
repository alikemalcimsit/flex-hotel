/**
 * İşlem zinciri (modül 10) — saf kurallar, test edilir.
 *
 * Bir zincir, tek bir tetikle (personelin tıklaması, misafirin mesajı,
 * zamanlanmış iş) başlayan her şeydir; hepsi aynı `correlationId`'yi taşır:
 *
 * - **Olay** (`EventLog`): yayınlandığı an, kimin yayınladığı, zincirdeki
 *   derinliği (`hop`) ve hangi olayın sonucu olduğu (`causationId`).
 * - **İşleyiş** (`ActivityLog`): bir aktörün bir olayı işlemesi — sonucu,
 *   seviyesi, süresi. Satır iş **bittiğinde** yazılır; başlangıç = bitiş − süre.
 * - **Değişiklik** (`AuditLog`): bir kaydın değişmesi.
 *
 * Ağaç şöyle kurulur:
 *
 * ```
 * olay (kök: sebebi zincirde olmayan)
 *   └─ işleyiş (aktör bu olayı işledi)
 *        ├─ değişiklik (aktör işlerken yazdı: aynı aktör, işleyişin süresi içinde)
 *        └─ olay (aktör işlerken yayınladı: sebebi üstteki olay, yayınlayan bu aktör)
 * ```
 *
 * Aktöre bağlanamayan değişiklik (personelin HTTP isteğinde yazdığı) ve
 * olayı zincirde bulunamayan işleyiş kökte, zamana göre sıralı durur.
 */

/** Değişikliğin işleyişe bağlanırken tanınan saat kayması (ms). */
export const AUDIT_ATTACH_TOLERANCE_MS = 50;

/** @param {Date | string} value */
const ms = (value) => (value instanceof Date ? value.getTime() : Date.parse(value));
/** @param {Date | string} value */
const iso = (value) => new Date(ms(value)).toISOString();

/** Düğümün sıralama anı: işleyiş için başlangıcı (bitişte yazılır), diğerleri için anı. */
const sortKey = (node) => (node.kind === 'HANDLER' ? ms(node.startedAt) : ms(node.at));

/** @param {Array<{ kind: string, at: string, startedAt?: string, id: string }>} nodes */
function sortNodes(nodes) {
  nodes.sort((a, b) => sortKey(a) - sortKey(b) || a.id.localeCompare(b.id));
  for (const node of nodes) if (node.children) sortNodes(node.children);
  return nodes;
}

/**
 * Zinciri ağaca çevirir.
 *
 * @param {{
 *   events: Array<{ id: string, name: string, actor: string, occurredAt: Date | string, publishedAt: Date | string | null,
 *                   hop: number, causationId: string | null, payload?: unknown }>,
 *   activities: Array<{ id: string, actorName: string, eventId: string | null, eventName: string | null, level: string,
 *                       message: string, durationMs: number | null, createdAt: Date | string, meta?: unknown }>,
 *   audits: Array<{ id: string, entity: string, entityId: string, action: string, actor: string,
 *                   changedFields: string[], createdAt: Date | string, values?: unknown }>,
 * }} input
 */
export function buildChain({ events, activities, audits }) {
  /** @type {Map<string, any>} */
  const eventNodes = new Map(
    events.map((event) => [
      event.id,
      {
        kind: 'EVENT',
        id: event.id,
        name: event.name,
        actor: event.actor,
        at: iso(event.occurredAt),
        hop: event.hop,
        causationId: event.causationId ?? null,
        published: Boolean(event.publishedAt),
        payload: event.payload ?? null,
        children: [],
      },
    ]),
  );

  const handlers = activities.map((activity) => {
    const endedAt = ms(activity.createdAt);
    const duration = Math.max(0, activity.durationMs ?? 0);
    return {
      kind: 'HANDLER',
      id: activity.id,
      actorName: activity.actorName,
      eventId: activity.eventId ?? null,
      eventName: activity.eventName ?? null,
      level: activity.level,
      message: activity.message,
      durationMs: activity.durationMs ?? null,
      meta: activity.meta ?? null,
      startedAt: new Date(endedAt - duration).toISOString(),
      at: new Date(endedAt).toISOString(),
      children: [],
    };
  });

  const roots = [];

  // İşleyiş → işlediği olay.
  for (const handler of handlers) {
    const event = handler.eventId ? eventNodes.get(handler.eventId) : null;
    if (event) event.children.push(handler);
    else roots.push(handler);
  }

  // Olay → sebebi olan olayın, onu yayınlayan aktörün işleyişi altına.
  const parentOf = (event) => (event.causationId ? eventNodes.get(event.causationId) ?? null : null);
  /** Döngü koruması: bozuk kayıtta (A'nın sebebi B, B'nin sebebi A) sonsuz ağaç olmasın. */
  const hasCycle = (event) => {
    const seen = new Set([event.id]);
    for (let parent = parentOf(event); parent; parent = parentOf(parent)) {
      if (seen.has(parent.id)) return true;
      seen.add(parent.id);
    }
    return false;
  };
  for (const event of eventNodes.values()) {
    const parent = parentOf(event);
    if (!parent || hasCycle(event)) {
      roots.push(event);
      continue;
    }
    const handler = parent.children.find((child) => child.kind === 'HANDLER' && child.actorName === event.actor);
    (handler ?? parent).children.push(event);
  }

  // Değişiklik → onu yazan aktörün, süresi içinde kalan işleyişi; yoksa kök.
  for (const audit of audits) {
    const at = ms(audit.createdAt);
    const node = {
      kind: 'AUDIT',
      id: audit.id,
      entity: audit.entity,
      entityId: audit.entityId,
      action: audit.action,
      actor: audit.actor,
      changedFields: audit.changedFields ?? [],
      values: audit.values ?? null,
      at: new Date(at).toISOString(),
    };
    const owner = handlers.find(
      (handler) =>
        handler.actorName === audit.actor &&
        at >= ms(handler.startedAt) - AUDIT_ATTACH_TOLERANCE_MS &&
        at <= ms(handler.at) + AUDIT_ATTACH_TOLERANCE_MS,
    );
    if (owner) owner.children.push(node);
    else roots.push(node);
  }

  sortNodes(roots);

  const times = [
    ...[...eventNodes.values()].map((node) => ms(node.at)),
    ...handlers.flatMap((node) => [ms(node.startedAt), ms(node.at)]),
    ...audits.map((audit) => ms(audit.createdAt)),
  ];
  const startedAt = times.length ? Math.min(...times) : null;
  const endedAt = times.length ? Math.max(...times) : null;

  return {
    startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
    endedAt: endedAt === null ? null : new Date(endedAt).toISOString(),
    spanMs: startedAt === null ? 0 : endedAt - startedAt,
    counts: {
      events: eventNodes.size,
      handlers: handlers.length,
      audits: audits.length,
      errors: handlers.filter((handler) => handler.level === 'ERROR').length,
      warnings: handlers.filter((handler) => handler.level === 'WARN').length,
      unpublished: [...eventNodes.values()].filter((node) => !node.published).length,
    },
    actors: [...new Set(handlers.map((handler) => handler.actorName))].sort(),
    roots,
  };
}

/**
 * Değişikliğin eski → yeni değerleri, yalnızca değişen alanlar (zincirde
 * gösterilir; bütün kayıt anlık görüntüsü denetim ekranında).
 *
 * @param {{ action: string, before: any, after: any, changedFields: string[] }} audit
 * @param {number} [maxFields] en fazla alan
 * @returns {Array<{ field: string, before: unknown, after: unknown }>}
 */
export function changedValues(audit, maxFields = 20) {
  if (audit.action !== 'UPDATE') return [];
  return (audit.changedFields ?? []).slice(0, maxFields).map((field) => ({
    field,
    before: audit.before?.[field] ?? null,
    after: audit.after?.[field] ?? null,
  }));
}

/**
 * Bir kaydın zincirleri: kaydın denetim satırları zincire göre gruplanır,
 * en yeni zincir önce. Her zincirin ilk işlemi ve kimin başlattığı özetlenir.
 *
 * @param {Array<{ correlationId: string, action: string, actor: string, changedFields: string[], createdAt: Date | string }>} rows
 * @param {number} limit
 */
export function groupEntityChains(rows, limit) {
  /** @type {Map<string, { correlationId: string, startedAt: number, endedAt: number, changes: number, firstAction: string, actor: string, fields: Set<string> }>} */
  const chains = new Map();
  for (const row of rows) {
    const at = ms(row.createdAt);
    const chain = chains.get(row.correlationId);
    if (!chain) {
      chains.set(row.correlationId, {
        correlationId: row.correlationId,
        startedAt: at,
        endedAt: at,
        changes: 1,
        firstAction: row.action,
        actor: row.actor,
        fields: new Set(row.changedFields ?? []),
      });
      continue;
    }
    chain.changes += 1;
    for (const field of row.changedFields ?? []) chain.fields.add(field);
    if (at < chain.startedAt) {
      chain.startedAt = at;
      chain.firstAction = row.action;
      chain.actor = row.actor;
    }
    if (at > chain.endedAt) chain.endedAt = at;
  }
  return [...chains.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
    .map((chain) => ({
      correlationId: chain.correlationId,
      startedAt: new Date(chain.startedAt).toISOString(),
      endedAt: new Date(chain.endedAt).toISOString(),
      changes: chain.changes,
      firstAction: chain.firstAction,
      actor: chain.actor,
      fields: [...chain.fields].sort(),
    }));
}
