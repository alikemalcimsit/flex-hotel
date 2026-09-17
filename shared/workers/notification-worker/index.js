import { BaseWorker, defineActor } from '@hotelos/actor-kit';

/**
 * Bildirim aktörü (LLM'siz, sektörden bağımsız).
 *
 * Bir olay olunca (rezervasyon, oda ataması, giriş, çıkış) misafire gidecek
 * bildirimleri **kuyruğa yazdırır**. Gönderimin kendisi burada değil:
 * backend'in göndericisi kuyruğu arka planda işler. Böylece yavaş bir e-posta
 * sunucusu ne olay dağıtımını ne de personelin tıkladığı düğmeyi bekletir.
 *
 * Paket hangi olayın hangi bildirim olduğunu bilmez; eşlemeyi ve kuyruğa
 * yazan servisi dışarıdan alır (otel dışı dikey paketler kendi eşlemesini verir).
 *
 * Kapatılırsa misafire bildirim gitmez ve iş "manuel görev" olarak personele
 * düşer ("misafire onay bildirimini elle gönderin").
 */

const ACTOR_NAME = 'notification-worker';

/**
 * Hata iş kuralından mı (4xx: rezervasyon yok) geliyor? Denemekle düzelmez.
 * @param {unknown} error
 */
function markBusinessErrorsFinal(error) {
  const status = /** @type {{ statusCode?: number }} */ (error)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    /** @type {{ retryable?: boolean }} */ (error).retryable = false;
  }
  return error;
}

/**
 * @typedef {{ trigger: string, label: string }} TriggerSpec
 * @typedef {{
 *   triggers: Record<string, TriggerSpec>,
 *   enqueue: (hotelId: string, trigger: string, subject: { reservationId: string, roomId: string | null }) =>
 *     Promise<{ queued: Array<{ channel: string, status: string }>, skipped: string | null, duplicates: number }>,
 *   channelLabels?: Record<string, string>,
 * }} NotificationWorkerService
 */

/**
 * @param {Record<string, TriggerSpec>} triggers
 */
export function notificationWorkerManifest(triggers) {
  return defineActor({
    name: ACTOR_NAME,
    type: 'worker',
    description:
      'Rezervasyon onayı, oda bilgisi, hoş geldiniz ve teşekkür bildirimlerini şablondan hazırlayıp gönderim ' +
      'kuyruğuna yazar. Kapalıyken misafire bildirim gitmez; iş personele manuel görev olarak düşer.',
    subscribes: Object.keys(triggers),
    publishes: ['notification.send.requested', 'notification.cancelled', 'notification.failed'],
    retry: { attempts: 3, backoffMs: 400 },
    fallbackModule: 'Bildirim merkezi',
  });
}

/**
 * Kuyruk sonucunu Activity Feed için tek cümleye çevirir.
 * @param {{ queued: Array<{ channel: string, status: string }>, skipped: string | null, duplicates: number }} result
 * @param {Record<string, string>} channelLabels
 */
export function describeResult(result, channelLabels = {}) {
  const label = (channel) => channelLabels[channel] ?? channel;
  const pending = result.queued.filter((row) => row.status === 'PENDING').map((row) => label(row.channel));
  const other = result.queued.filter((row) => row.status !== 'PENDING');
  const parts = [];
  if (pending.length) parts.push(`${pending.length} bildirim sıraya alındı (${pending.join(', ')})`);
  if (other.length) parts.push(`${other.length} bildirim gönderilmedi`);
  if (result.duplicates) parts.push(`${result.duplicates} bildirim zaten sıradaydı`);
  if (result.skipped) parts.push(result.skipped);
  return parts.join('; ') || 'Gönderilecek bildirim yok';
}

class NotificationWorker extends BaseWorker {
  #triggers;

  /**
   * @param {NotificationWorkerService} service
   * @param {object} deps BaseWorker bağımlılıkları
   */
  constructor(service, deps) {
    const handlers = Object.fromEntries(
      Object.entries(service.triggers).map(([eventName, spec]) => [
        eventName,
        async (payload) => {
          let result;
          try {
            result = await service.enqueue(payload.hotelId, spec.trigger, {
              reservationId: payload.reservationId,
              roomId: payload.roomId ?? null,
            });
          } catch (error) {
            throw markBusinessErrorsFinal(error);
          }
          return {
            message: describeResult(result, service.channelLabels),
            meta: { trigger: spec.trigger, reservationId: payload.reservationId, queued: result.queued.length },
          };
        },
      ]),
    );
    super(notificationWorkerManifest(service.triggers), handlers, deps);
    this.#triggers = service.triggers;
  }

  /**
   * @param {string} eventName
   * @param {{ reservationId?: string }} payload
   */
  describeFallback(eventName, payload) {
    const spec = this.#triggers[eventName];
    if (!spec) return super.describeFallback(eventName, payload);
    return `Misafire "${spec.label}" bildirimini elle gönderin`;
  }
}

/**
 * @param {NotificationWorkerService} service
 * @param {object} deps
 */
export function createNotificationWorker(service, deps) {
  return new NotificationWorker(service, deps);
}

export const NOTIFICATION_WORKER_NAME = ACTOR_NAME;
