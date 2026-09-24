/**
 * Aktör paneli kuralları (modül 12) — saf fonksiyonlar.
 *
 * Panel iki soruyu koda bakmadan cevaplamalı:
 *
 * 1. **Bu aktör sağlıklı mı?** Son 24 saatte ne yaptı, hata ya da uyarı var mı,
 *    personele iş düşürüyor mu.
 * 2. **Kapatırsam ne olur?** Dinlediği olayların işi manuel göreve düşer;
 *    yayınladığı olayları bekleyen aktörler o olayları bu aktörden alamaz.
 *
 * İkisi de bildirgeden (`defineActor`) ve sayaçlardan hesaplanır.
 */

/**
 * Aktörün son pencere içindeki durumu.
 *
 * - `OFF`: bu otelde kapalı (işleri manuel göreve düşüyor).
 * - `UNAVAILABLE`: sunucuda kurulu değil (ör. model anahtarı yok).
 * - `ERROR` / `WARN`: pencerede hata / uyarı var.
 * - `OK`: çalıştı, sorun yok.
 * - `IDLE`: pencerede hiç iş gelmedi.
 *
 * @param {{ registered: boolean, enabled: boolean, runs: number, warnings: number, errors: number }} state
 * @returns {'OFF' | 'UNAVAILABLE' | 'ERROR' | 'WARN' | 'OK' | 'IDLE'}
 */
export function actorHealth({ registered, enabled, runs, warnings, errors }) {
  if (!registered) return 'UNAVAILABLE';
  if (!enabled) return 'OFF';
  if (errors > 0) return 'ERROR';
  if (warnings > 0) return 'WARN';
  return runs > 0 ? 'OK' : 'IDLE';
}

/**
 * "Kapatırsam ne olur": aktörün olay bağlantıları.
 *
 * - `subscribes`: dinlediği her olay ve o olayı yayınlayan diğer aktörler
 *   (olay bir servisten de gelebilir; liste yalnızca aktörleri gösterir).
 * - `publishes`: yayınladığı her olay ve onu dinleyen diğer aktörler.
 * - `downstream`: bu aktörün yayınladığı olaylarla tetiklenen aktörler
 *   (tekrarsız) — kapatılınca zinciri kesilenler.
 *
 * @param {{ name: string, subscribes: readonly string[], publishes: readonly string[] }} manifest
 * @param {ReadonlyArray<{ name: string, subscribes: readonly string[], publishes: readonly string[] }>} manifests bütün aktörler
 */
export function actorImpact(manifest, manifests) {
  const others = manifests.filter((other) => other.name !== manifest.name);
  const publishersOf = (event) => others.filter((other) => other.publishes.includes(event)).map((other) => other.name);
  const subscribersOf = (event) => others.filter((other) => other.subscribes.includes(event)).map((other) => other.name);
  const publishes = manifest.publishes.map((event) => ({ event, consumedBy: subscribersOf(event) }));
  return {
    subscribes: manifest.subscribes.map((event) => ({ event, publishedBy: publishersOf(event) })),
    publishes,
    downstream: [...new Set(publishes.flatMap((entry) => entry.consumedBy))].sort(),
  };
}

/** Listede tür sırası: önce kural tabanlı aktörler, sonra LLM ajanları. */
const TYPE_ORDER = Object.freeze({ worker: 0, agent: 1 });

/**
 * Panel listesi: bildirge + otel ayarı + sayaçlar tek satırda.
 *
 * @param {Array<{ manifest: any, registered: boolean, unavailableReason: string | null, backlog: { running: number, queued: number } | null }>} catalog
 * @param {{
 *   settings: Map<string, { enabled: boolean, note: string | null, updatedBy: string | null, updatedAt: Date | string }>,
 *   stats: Map<string, { runs: number, lastAt: Date | string | null, lastLevel: string | null, lastMessage: string | null }>,
 *   problems: Map<string, { warnings: number, errors: number }>,
 *   openTasks: Map<string, number>,
 *   costToday: Map<string, string>,
 * }} sources
 */
export function buildActorRows(catalog, { settings, stats, problems, openTasks, costToday }) {
  const iso = (value) => (value ? new Date(value).toISOString() : null);
  return catalog
    .map(({ manifest, registered, unavailableReason, backlog }) => {
      const setting = settings.get(manifest.name) ?? null;
      const stat = stats.get(manifest.name) ?? { runs: 0, lastAt: null, lastLevel: null, lastMessage: null };
      const problem = problems.get(manifest.name) ?? { warnings: 0, errors: 0 };
      const enabled = setting?.enabled ?? true;
      return {
        name: manifest.name,
        title: manifest.title ?? manifest.name,
        type: manifest.type,
        packageName: manifest.packageName ?? null,
        description: manifest.description,
        fallbackModule: manifest.fallbackModule ?? manifest.name,
        registered,
        unavailableReason,
        enabled,
        changedBy: setting?.updatedBy ?? null,
        changedAt: setting ? iso(setting.updatedAt) : null,
        note: setting?.note ?? null,
        health: actorHealth({ registered, enabled, runs: stat.runs, warnings: problem.warnings, errors: problem.errors }),
        stats: {
          runs: stat.runs,
          warnings: problem.warnings,
          errors: problem.errors,
          lastAt: iso(stat.lastAt),
          lastLevel: stat.lastLevel,
          lastMessage: stat.lastMessage,
        },
        openTasks: openTasks.get(manifest.name) ?? 0,
        background: Boolean(manifest.background),
        backlog: manifest.background ? backlog ?? { running: 0, queued: 0 } : null,
        costTodayUsd: manifest.type === 'agent' ? costToday.get(manifest.name) ?? '0.000000' : null,
      };
    })
    .sort(
      (a, b) =>
        (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || a.title.localeCompare(b.title, 'tr') || a.name.localeCompare(b.name),
    );
}

/**
 * Görevin bağlı olduğu kayıtlar: olay gövdesindeki kimliklerden ekranda
 * "kayda git" bağlantıları. Gövde gösterilmeden de personel işi yapacağı
 * kayda (rezervasyon, konuşma, oda) tek tıkla gider.
 *
 * `requestId` yalnızca misafir isteği olaylarında misafir isteğidir;
 * `reservation.requested`'daki `requestId` kanalın istek numarasıdır.
 *
 * @param {{ name?: string | null, payload?: Record<string, unknown> | null } | null | undefined} originalEvent
 * @returns {Array<{ kind: 'reservation' | 'conversation' | 'room' | 'request' | 'approval', id: string }>}
 */
export function taskLinks(originalEvent) {
  const payload = originalEvent?.payload;
  if (!payload || typeof payload !== 'object') return [];
  const name = originalEvent?.name ?? '';
  const links = [];
  const add = (kind, value) => {
    if (typeof value === 'string' && value.length > 0 && value.length <= 100) links.push({ kind, id: value });
  };
  add('reservation', payload.reservationId);
  add('conversation', payload.conversationId);
  add('room', payload.roomId);
  if (name.startsWith('guest.request.')) add('request', payload.requestId);
  add('approval', payload.approvalId);
  return links;
}
